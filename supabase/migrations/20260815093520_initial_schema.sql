-- ============================================================
-- 「おやこポイント」 データベーススキーマ設計
-- 設計部 成果物 / 対象: Supabase (PostgreSQL 15+)
-- 参照元:
--   企画部/成果物/要件定義書.md v0.5 (05章 データモデル設計案 / 06章 認証・データ管理設計 /
--     07章 完了報告・保護者リアクションフロー / 07-3章 実施履歴カレンダー)
--   family-todo (C:\App_cursor\family-todo\supabase_setup.sql) の設計思想
--
-- 本ファイルは要件定義書05章の「案」を、実際にSupabaseへデプロイできる粒度まで
-- 具体化したものである。05章からの変更・追加箇所には必ず [変更] コメントで
-- 理由と影響範囲を明記する（設計部CLAUDE.mdの遵守事項）。
--
-- [2026-08-15改訂] 要件定義書.md v0.5（本部長採点100点）で「承認フローの全面廃止
-- （即時ポイント加算＋任意の保護者リアクション）」「実施履歴カレンダー機能の追加」
-- という大規模な方針転換があったことを受け、chore_completions関連（5章）・
-- chores.requires_approval（4章）・member_points（8章）を再設計し、
-- chore_reactions（5b章）・chore_completion_daily_summary（8a章）を新設した。
-- 変更点の詳細・理由は各章の[変更]/[廃止]/[新設]コメントを参照。
-- ============================================================


-- ============================================================
-- 0. 前提: RLSマルチテナント分離の基盤
-- ============================================================
-- [設計判断] 全ポリシーが「auth.uid() -> family_members -> family_id」の
-- ルックアップを個別に書くと実装がぶれるため、共通のヘルパー関数に集約する
-- （設計部CLAUDE.mdの遵守事項）。
--
-- 子ども（role='child'）は要件定義書06章の方針により auth.users に
-- 独立アカウントを持たない。子どもは Edge Function が発行するカスタムJWTで
-- ログインし、そのJWTには auth.users を経由しない独自クレーム
-- (family_id, family_member_id, role) を含める。
-- そのため current_family_id() は
--   1) まず auth.jwt() のカスタムクレーム family_id を見る（子ども・保護者共通で使える）
--   2) 無ければ auth_user_id からの通常ルックアップにフォールバックする（保護者の通常ログイン）
-- という二段構えにする。保護者のJWTにも同じカスタムクレームを付与すれば
-- 常に1)だけで済むが、Supabase Authの標準マジックリンク発行トークンには
-- カスタムクレームが無いため、フォールバックを用意しておく。
-- ============================================================

-- [2026-08-15修正] LANGUAGE sql → plpgsqlに変更。sql関数は作成時に本文が参照する
-- リレーションの存在を検証するため、family_membersテーブルより前に定義される
-- このセクションではCREATE自体が失敗する（実際にsupabase db pushで検出）。
-- plpgsqlは本文を実行時まで検証しないため同じ順序のままCREATE可能。
-- ロジック・戻り値は変更していない。
CREATE OR REPLACE FUNCTION public.current_family_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'family_id',
    (SELECT fm.family_id::text FROM family_members fm WHERE fm.auth_user_id = auth.uid() AND fm.is_active)
  )::uuid;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_family_member_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'family_member_id',
    (SELECT fm.id::text FROM family_members fm WHERE fm.auth_user_id = auth.uid() AND fm.is_active)
  )::uuid;
END;
$$;

-- 現在の呼び出し主が「保護者」かどうか。
-- [注意] SupabaseのJWTには元々「role」というトップレベルクレームがあり、
-- これはPostgREST/Supabaseが接続先Postgresロール(authenticated/anon/service_role)を
-- 選択するための予約済みクレームである。アプリ独自の「parent/child」区分をここに
-- 混在させると衝突するため、子どもJWT発行時は区別してカスタムクレーム名
-- app_role を使う（認証・データ管理設計書.md参照）。標準roleクレームは
-- 両者とも常に 'authenticated' を設定する。
CREATE OR REPLACE FUNCTION public.current_family_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'app_role',
    (SELECT fm.role FROM family_members fm WHERE fm.auth_user_id = auth.uid() AND fm.is_active)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_current_user_parent()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_family_role() = 'parent';
$$;

COMMENT ON FUNCTION public.current_family_id() IS
  'RLS共通ヘルパー。auth.jwt()のfamily_idカスタムクレーム(子ども/Edge Function発行トークン用)を優先し、無ければauth_user_id経由でfamily_membersから解決する（保護者の通常ログイン用）。全RLSポリシーはこの関数経由でfamily_idを参照すること。';

-- 汎用: updated_at 自動更新
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 招待コード生成（紛らわしい文字 0/O, 1/I を除いた8桁）
CREATE OR REPLACE FUNCTION public.generate_invite_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result text := '';
  i int;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END;
$$;


-- ============================================================
-- 1. families
-- ============================================================
CREATE TABLE IF NOT EXISTS families (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
  invite_code TEXT NOT NULL UNIQUE DEFAULT generate_invite_code(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_families_invite_code ON families(invite_code);

DROP TRIGGER IF EXISTS trg_families_updated_at ON families;
CREATE TRIGGER trg_families_updated_at
  BEFORE UPDATE ON families
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE families ENABLE ROW LEVEL SECURITY;

-- 自分の家族のみ参照可（招待コードでの参加/検証はSECURITY DEFINER関数経由なので
-- 未参加ユーザーはこのSELECTポリシーの対象外でよい＝コード漏洩以外の経路で
-- 他家族のfamiliesレコードは見えない）
DROP POLICY IF EXISTS "families_select_own" ON families;
CREATE POLICY "families_select_own" ON families
  FOR SELECT
  USING (id = current_family_id());

-- 家族名の変更・招待コード再発行は保護者のみ
DROP POLICY IF EXISTS "families_update_by_parent" ON families;
CREATE POLICY "families_update_by_parent" ON families
  FOR UPDATE
  USING (id = current_family_id() AND is_current_user_parent())
  WITH CHECK (id = current_family_id() AND is_current_user_parent());

-- INSERT/DELETEはクライアントに直接開放しない。
-- 家族作成は create_family_with_owner() (下記)、家族削除(退会処理)は
-- service_role のEdge Functionに限定する（要件定義書06章「特権操作」）。


-- ============================================================
-- 2. family_members
-- ============================================================
-- [変更/追加] 05章の定義には無かった is_owner / is_active / created_at / updated_at
-- を追加する。
--   is_owner: 06章「家族オーナーが『家族を削除』操作で…」という記述があり、
--     保護者間で対等ではあるものの「家族削除」を実行できる主体を一意に
--     識別する必要があるため追加。影響範囲: create_family_with_owner()が
--     最初の保護者にtrueを設定する。家族削除APIはis_owner=trueの保護者のみ許可。
--   is_active: 子どもの退会・保護者の脱退時に、chore_completions.reported_byや
--     chore_reactions.reacted_by（[2026-08-15改訂] 旧reviewed_byは承認フロー廃止に
--     伴い廃止。5章参照）の参照整合性を壊さずに「表示しない」ためのソフトデリート運用。
--     05章にはハードデリート前提の記述しか無かったが、履歴（会計データ）を
--     破壊しないために必須と判断（下記5章のFK設計とセットで参照）。
--   created_at/updated_at: 運用上ほぼ必須のため補完。
-- ============================================================
CREATE TABLE IF NOT EXISTS family_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(trim(display_name)) BETWEEN 1 AND 30),
  role TEXT NOT NULL CHECK (role IN ('parent', 'child')),
  avatar_color TEXT,
  auth_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  is_owner BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 子どもは独立アカウントを持たない設計（要件定義書06章）→ auth_user_idはparentのみ許容
  CONSTRAINT chk_child_has_no_auth_user CHECK (role = 'parent' OR auth_user_id IS NULL)
);

-- 1つのauth.usersアカウントは1つのfamily_memberにのみ対応（MVPは1保護者1家族専属）
CREATE UNIQUE INDEX IF NOT EXISTS uq_family_members_auth_user_id
  ON family_members(auth_user_id) WHERE auth_user_id IS NOT NULL;

-- 1家族につきownerは1人のみ
CREATE UNIQUE INDEX IF NOT EXISTS uq_family_members_one_owner
  ON family_members(family_id) WHERE is_owner = true;

CREATE INDEX IF NOT EXISTS idx_family_members_family_id ON family_members(family_id);
CREATE INDEX IF NOT EXISTS idx_family_members_family_role ON family_members(family_id, role);

DROP TRIGGER IF EXISTS trg_family_members_updated_at ON family_members;
CREATE TRIGGER trg_family_members_updated_at
  BEFORE UPDATE ON family_members
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE family_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "family_members_select_same_family" ON family_members;
CREATE POLICY "family_members_select_same_family" ON family_members
  FOR SELECT
  USING (family_id = current_family_id());

-- 子どもプロフィールの追加は保護者のみ（保護者自身の追加はjoin_family_with_invite_codeを使う）
DROP POLICY IF EXISTS "family_members_insert_by_parent" ON family_members;
CREATE POLICY "family_members_insert_by_parent" ON family_members
  FOR INSERT
  WITH CHECK (family_id = current_family_id() AND is_current_user_parent());

-- 更新: 保護者は家族内の誰でも更新可。子どもは自分の行（表示名・アバター色）のみ更新可。
-- role / is_owner / auth_user_id / family_id の書き換えは下記トリガーで禁止する
-- （子ども自身が保護者に昇格する等の権限昇格を防ぐ多層防御）。
DROP POLICY IF EXISTS "family_members_update_scoped" ON family_members;
CREATE POLICY "family_members_update_scoped" ON family_members
  FOR UPDATE
  USING (family_id = current_family_id() AND (is_current_user_parent() OR id = current_family_member_id()))
  WITH CHECK (family_id = current_family_id() AND (is_current_user_parent() OR id = current_family_member_id()));

CREATE OR REPLACE FUNCTION public.family_members_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- service_role（Edge Function経由の管理操作。3.3/3.4章のset-child-pin/
  -- remove-member等）はこのトリガーの対象外とする。業務ルール（オーナー不在
  -- 防止等）はEdge Function側で担保済みのため、ここでブロックすると
  -- 正規の退会処理・オーナー移譲まで失敗してしまう。
  -- PostgRESTはJWTのroleクレームに応じて実行時のPostgresロールを
  -- SET LOCAL ROLE するため、current_userで確実に判定できる。
  IF current_user = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- is_active（退会/復帰）はクライアントから直接変更させない。
  -- 退会処理は認証・データ管理設計書.mdのremove-member(Edge Function)を経由する
  -- 運用のため、通常のUPDATEでは変更不可とする。
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION '退会処理はEdge Function(remove-member)経由でのみ行えます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT is_current_user_parent() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.is_owner IS DISTINCT FROM OLD.is_owner
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.family_id IS DISTINCT FROM OLD.family_id THEN
      RAISE EXCEPTION '権限のない項目を変更しようとしました' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_members_before_update ON family_members;
CREATE TRIGGER trg_family_members_before_update
  BEFORE UPDATE ON family_members
  FOR EACH ROW EXECUTE FUNCTION public.family_members_before_update();

-- DELETE: クライアントには開放しない。退会処理はEdge Function(service_role)が
-- is_active=false のソフトデリート、または家族全体削除時のみ実施する。


-- ------------------------------------------------------------
-- 2b. family_member_pins（子どものPINシークレット。専用テーブルに分離）
-- ------------------------------------------------------------
-- [追加] 05章のfamily_membersにはPIN関連カラムが無いが、06章の子ども認証
-- （招待コード+4桁PIN）を実装するには保存先が必要。
-- family_membersに直接pin_hash列を持たせず別テーブルに分離した理由:
--   - RLSは行単位でしか制御できず、列単位でpin_hashだけを隠すことができない。
--     family_membersは家族全員が通常参照するテーブルであり、そこにPINハッシュを
--     置くと「SELECTポリシーの書き方next第で誤ってハッシュ値まで返してしまう」
--     事故のリスクが常につきまとう。
--   - 本テーブルはRLSを有効化した上でauthenticated/anonに対するポリシーを
--     一切定義しない（=デフォルト拒否）。service_role（Edge Function経由）
--     のみがPIN照合・再設定を行える。
-- failed_attempts / locked_until はPINが4桁(1万通り)しかなく総当たり耐性が
-- 低いため、Edge Function側でのレート制限用に追加。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_member_pins (
  member_id UUID PRIMARY KEY REFERENCES family_members(id) ON DELETE CASCADE,
  pin_hash TEXT NOT NULL,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- role='child'であることの検証はサブクエリを使うCHECK制約では書けないため、
  -- 下記トリガー(family_member_pins_before_write)で担保する。
);

CREATE OR REPLACE FUNCTION public.family_member_pins_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM family_members WHERE id = NEW.member_id;
  IF v_role IS DISTINCT FROM 'child' THEN
    RAISE EXCEPTION 'PINはrole=childのメンバーにのみ設定できます' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_member_pins_before_write ON family_member_pins;
CREATE TRIGGER trg_family_member_pins_before_write
  BEFORE INSERT OR UPDATE ON family_member_pins
  FOR EACH ROW EXECUTE FUNCTION public.family_member_pins_before_write();

ALTER TABLE family_member_pins ENABLE ROW LEVEL SECURITY;
-- ポリシーを一切作らない = authenticated/anonからは常に空集合。service_roleはRLSをバイパスする。


-- ------------------------------------------------------------
-- 3. categories（family-todo踏襲。要件定義書05章では明記されていないが
-- 04章「カテゴリー・担当・ポイントを設定」および02章の継承方針に基づき、
-- family-todoのcategoriesテーブルをfamily_id対応させて踏襲する）
-- ------------------------------------------------------------
-- [追加] 要件定義書05章の本文には無いテーブルだが、04章の機能要件
-- （お手伝いをカテゴリーでグルーピング）と次章chores.category_idの参照先として
-- 必須のため、family-todoのcategoriesをfamily_id対応させて追加する。
-- chores（次章）がcategory_idのFKでこのテーブルを参照するため、choresより
-- 先に定義する必要がある。
-- 影響範囲: 05章のchores定義が前提とするcategory_id FKの参照先を補完するのみで、
-- 他テーブルへの影響はない。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 50),
  color TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (family_id, name)
);

CREATE INDEX IF NOT EXISTS idx_categories_family_id ON categories(family_id);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select_same_family" ON categories;
CREATE POLICY "categories_select_same_family" ON categories
  FOR SELECT
  USING (family_id = current_family_id());

DROP POLICY IF EXISTS "categories_write_by_parent" ON categories;
CREATE POLICY "categories_write_by_parent" ON categories
  FOR ALL
  USING (family_id = current_family_id() AND is_current_user_parent())
  WITH CHECK (family_id = current_family_id() AND is_current_user_parent());


-- ============================================================
-- 4. chores（family-todoのtasks+questsを統合）
-- ============================================================
-- [補完] 05章の定義に無かった created_at/updated_at/is_active を追加。
--   is_active: choreの論理削除フラグ。物理削除するとchore_completions.chore_id
--   のFKが壊れる/CASCADEで過去の会計履歴が消えてしまうため、chore自体は
--   物理削除させず非表示化する運用とする（詳細は5章のFK設計コメント参照）。
--
-- [追加] 開発部/成果物/実装メモ.md 6.1章の指摘（実装を止めるレベルの不整合）
--   への対応: デザイントークン.md「アイコン・イラスト方針」および
--   主要画面ワイヤーフレーム.md（C5やることリスト／C6完了報告）は、
--   family-todoの`QuestsTab.tsx`の`quest.emoji || "📝"`パターンを継承し、
--   choreごとに保護者が選んだ固有の絵文字が表示される前提で設計されていた。
--   しかし05章由来の本テーブル定義には絵文字を保存する列が無く、開発部が
--   実装時にモック型へ暫定でemojiフィールドを追加する対応を取らざるを得ず、
--   本番のSupabase接続ではそのままでは動作しない状態だった。emoji列
--   （NULL許容）を追加してこれを解消する。NULL時のフォールバック（例: 📝）は
--   family-todoと同様クライアント側の責務とし、DB側はNULL許容のままでよい
--   （フォールバック値をDB側で強制・デフォルト化する必要はない）。
--   影響範囲: 新規列の追加のみ。既存の列・トリガー・RLSポリシーには影響しない。
--
-- [追加] NFCタグでのクイック完了（企画部/成果物/要件定義書.md 04章機能一覧・
--   07-2章「NFCクイック完了フロー」、05章「設計判断（NFCタグ識別子・案）」で
--   MVPスコープとして正式追加され、UIUXデザイン部/成果物/画面一覧・遷移図.md
--   3.7節・主要画面ワイヤーフレーム.md 7章（いずれも本部長採点100点で承認済み）
--   で画面化された機能の実装に必要なため、nfc_tag_id列を追加する。
--
--   値の性質: 物理NFCタグの工場出荷UID（製造シリアル）ではなく、保護者が
--   P11拡張モーダルでタグに書き込む操作を行った際に、クライアントアプリが
--   生成した不透明なランダムトークン（例: crypto.randomUUID() 相当。
--   要件定義書07-2章1「保護者のスマホのNFC書き込み機能で、そのchoreに対応する
--   識別子をタグへ書き込むイメージ」に対応）をNDEFペイロードとしてタグへ
--   書き込み、同じ値をchores.nfc_tag_idにも保存する。工場UIDを使わない理由は
--   (1) iOSはCore NFCで生のUID取得が制限されておりNDEF読み取りの方が
--   プラットフォーム互換性が高いこと、(2) アプリ生成トークンにすることで
--   下記のグローバル一意性をDB側のコストなしで保証できることの2点。
--
--   ユニーク制約の設計判断（家族をまたいだ一意性 vs 家族内一意性）:
--   本列は「家族をまたいだグローバル一意」（下記 uq_chores_nfc_tag_id、
--   nfc_tag_id IS NOT NULL の部分ユニークインデックス）とする。
--   家族内一意で十分という考え方もあり得るが、以下の理由でグローバル一意を
--   採用した。
--     - トークンはアプリ生成のランダム値であり、グローバル一意にしても
--       衝突確率上のコスト・運用上のデメリットが実質ゼロ（家族内一意に
--       限定する積極的な理由がない）。
--     - 多層防御: chores_select_same_family（family_id = current_family_id()）
--       のRLSにより通常のクライアント経路では他家族のchoreは原理的に
--       見えないが、グローバル一意にしておくことで「値そのものが常に
--       最大1家族にしか属さない」という制約がDBスキーマレベルでも保証される。
--       将来service_role実行のバッチ処理や新規Edge Function等、RLSを
--       バイパスする経路でfamily_idの絞り込みを書き漏らす実装ミスが
--       あったとしても、値の一致だけで別家族のchoreへ誤到達することは
--       構造的に起こり得ない。
--   衝突時（=同じトークンをUPDATEしようとして一意制約違反）は開発部/
--   API仕様.md 3a節のとおりunique_violationとして扱い、クライアントは
--   トークンを生成し直して再試行する（衝突確率は実用上無視できるほど低いが、
--   保護者操作のUXとしてリトライを用意しておく）。
--
--   エラーハンドリング方針（タグ未登録／他家族のタグ／削除済みchoreのタグ）:
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 7.0決定3・7.3節は
--   「原因を問わず同一の前向きな文言」でC14のエラー状態を表示する設計としている。
--   本設計ではDB側に専用のエラーコードや例外を一切設けず、
--     SELECT ... FROM chores WHERE nfc_tag_id = :tagValue AND is_active
--   のクエリが「0件ヒット」になるという単一の結果に、以下3ケースすべてが
--   自然に収束するようにする。
--     (a) タグ未登録: nfc_tag_idに一致する行がそもそも存在しない → 0件。
--     (b) 他家族のタグ: 該当行は存在するが、SELECTポリシー
--         chores_select_same_family（family_id = current_family_id()）に
--         より、呼び出し元の家族と一致しない行はRLSがそもそも返さない
--         → 0件（PostgRESTからは「見つからない」以外の情報が一切漏れない。
--         403等のエラーにもならず、他家族のタグが存在すること自体も
--         判別できない）。
--     (c) 削除済み（is_active=false）choreのタグ: is_activeはRLSの対象外
--         （RLSはfamily_idのみで絞り込む）だが、クライアント側クエリに
--         `.eq('is_active', true)` を含めることで0件に揃える
--         （API仕様.md 4a節に明記。この一致をクライアント側の責務とする
--         理由は、is_activeによるフィルタは「削除済みを見せない」という
--         表示上のポリシーであり、chore_completionsへのINSERT自体は
--         chore_completions_before_insert トリガーの
--         `WHERE id = NEW.chore_id AND is_active` がINSERT時点でも
--         別途強制しており、DBは二重に保護されている）。
--   この結果、開発部はC14表示の分岐を「取得できたか／できなかったか」の
--   1点のみで実装すればよく、原因種別によるハンドリング分岐が一切不要になる
--   （UIUXデザイン部の設計意図と一致）。
--   影響範囲: 新規列（nfc_tag_id）と部分ユニークインデックスの追加のみ。
--   既存の列・トリガー・RLSポリシー・chore_completions側には一切変更を
--   加えていない（chore_completions_before_insertの`AND is_active`条件は
--   既存のまま流用でき、NFC経由の完了報告も通常の完了報告と全く同じ
--   トリガー・RLSを通る。要件定義書07-2章4「NFC読み取りは入力手段が
--   変わるだけ」の方針どおり）。API仕様.md 3a節・4a節もあわせて追記する。
-- ============================================================
CREATE TABLE IF NOT EXISTS chores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  category_id UUID NULL REFERENCES categories(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 100),
  emoji TEXT NULL, -- [追加] 保護者がお手伝い登録時に選ぶ絵文字（例: 🦷）。family-todoのquests.emoji踏襲。NULLの場合のフォールバックはクライアント側で行う（実装メモ.md 6.1章対応）。
  points INT NOT NULL CHECK (points > 0),
  is_repeatable BOOLEAN NOT NULL DEFAULT false,
  -- is_repeatable=true のデフォルトは1（05章の記載どおり）。false の場合は
  -- 「1日の実行回数」という概念自体が無い（一回きりのタスク）のでNULL運用とする。
  daily_limit INT NULL CHECK (daily_limit IS NULL OR daily_limit > 0),
  assigned_to UUID NULL REFERENCES family_members(id) ON DELETE SET NULL,
  -- [削除] 要件定義書.md v0.5（2026-08-15改訂）で承認フローが全面廃止されたことに伴い、
  -- 05章の requires_approval（「保護者承認が必要か」）は列としての意味を失ったため削除する。
  -- 転用（別用途への流用）ではなく削除を選んだ理由:
  --   (1) 07章は「ポイント付与に保護者の承認は不要。差し戻し・非承認に相当するネガティブな
  --       アクションは設けない」と明言しており、chore単位で承認要否を切り替えるという概念自体が
  --       仕様から消えている。
  --   (2) reward_redemptions.status（7章）とは異なり、00章変更履歴・05章のいずれにも
  --       「chore完了報告の承認可否を家庭ごとに選べるようにする」次フェーズ検討事項の記載が無く、
  --       将来の用途を予約しておく積極的な理由が無い。
  --   (3) 意味の無い列を「念のため」残すと、開発部が実装時に「この列は何に使うのか」で
  --       迷う原因になる（設計部CLAUDE.mdの「開発部が実装に迷わない具体性」の遵守事項に反する）。
  --   将来「家庭ごとに承認制を選べるオプション」（05章rewardsの前例と同種の方向性）が
  --   本当に必要になった場合は、その時点で目的の明確な新しい列（例: chores.approval_mode等）を
  --   追加すればよく、意味を失ったboolean列を先取りで残置するメリットは無いと判断した。
  -- 影響範囲: chore_completions_before_insertトリガー（5a章）のrequires_approval分岐を削除。
  -- API仕様.md 3章（chores登録ペイロード）・4章・4a章（NFC完了報告のselect列）から
  -- requires_approvalの記述を削除する。他テーブル・他トリガー・他RLSポリシーへの影響はない。
  is_active BOOLEAN NOT NULL DEFAULT true,
  nfc_tag_id TEXT NULL, -- [追加] 保護者がP11拡張モーダルで物理NFCタグへ書き込む、アプリ生成の不透明トークン。1chore=1タグ（要件定義書07-2章1）。NULL=タグ未登録。家族をまたいだグローバル一意性はuq_chores_nfc_tag_id（下記）で担保。詳細は本CREATE TABLE直前の[追加]コメント参照。
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- [追加] 空文字列のトークンが誤って登録されるのを防ぐ（NULL=未登録とは
  -- 明確に区別する）。push_tokens.expo_push_tokenの非空チェックと同じ方針。
  CONSTRAINT chk_chores_nfc_tag_id_not_blank CHECK (nfc_tag_id IS NULL OR char_length(trim(nfc_tag_id)) > 0)
);

-- assigned_to は family_id が一致するメンバーでなければならない（クロス家族の
-- 参照事故防止）。FKだけでは家族またぎを防げないためトリガーでチェックする。
CREATE OR REPLACE FUNCTION public.chores_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.assigned_to IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = NEW.assigned_to AND fm.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'assigned_toは同じ家族のメンバーである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.category_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'category_idは同じ家族のカテゴリーである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  -- is_repeatable=true かつ daily_limit未指定のchore新規作成時はデフォルト1を補完（05章の記載どおり）
  IF TG_OP = 'INSERT' AND NEW.is_repeatable AND NEW.daily_limit IS NULL THEN
    NEW.daily_limit := 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chores_before_write ON chores;
CREATE TRIGGER trg_chores_before_write
  BEFORE INSERT OR UPDATE ON chores
  FOR EACH ROW EXECUTE FUNCTION public.chores_before_write();

DROP TRIGGER IF EXISTS trg_chores_updated_at ON chores;
CREATE TRIGGER trg_chores_updated_at
  BEFORE UPDATE ON chores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_chores_family_id ON chores(family_id);
CREATE INDEX IF NOT EXISTS idx_chores_family_active ON chores(family_id, is_active);
CREATE INDEX IF NOT EXISTS idx_chores_assigned_to ON chores(assigned_to);
CREATE INDEX IF NOT EXISTS idx_chores_category_id ON chores(category_id);

-- [追加] nfc_tag_idの家族をまたいだグローバル一意性を担保する部分ユニーク
-- インデックス（NULL=未登録は複数行許容。family_members.auth_user_idの
-- uq_family_members_auth_user_idと同じ「nullable列に対する部分ユニーク
-- インデックス」パターンを踏襲）。API仕様.md 4a節のNFCタグ読み取り
-- （`chores.select().eq('nfc_tag_id', tagValue)`）はこのインデックスにより
-- 単一行lookupとして高速に処理される。
CREATE UNIQUE INDEX IF NOT EXISTS uq_chores_nfc_tag_id
  ON chores(nfc_tag_id) WHERE nfc_tag_id IS NOT NULL;

ALTER TABLE chores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chores_select_same_family" ON chores;
CREATE POLICY "chores_select_same_family" ON chores
  FOR SELECT
  USING (family_id = current_family_id());

DROP POLICY IF EXISTS "chores_write_by_parent" ON chores;
CREATE POLICY "chores_write_by_parent" ON chores
  FOR ALL
  USING (family_id = current_family_id() AND is_current_user_parent())
  WITH CHECK (family_id = current_family_id() AND is_current_user_parent());


-- ============================================================
-- 5. chore_completions（即時ポイント加算の核。加算のみの会計台帳）
-- ============================================================
-- [変更/大幅改訂] 要件定義書.md v0.5（2026-08-15改訂、本部長採点100点）05章の
-- 申し送り事項を受け、承認フロー廃止に伴い本テーブルを再設計する。
--
-- [廃止] status enum(pending/approved/rejected) 列を廃止する（転用しない）。
--   理由:
--   (1) 07章のとおり、完了報告は「報告と同時に確定」し、審査待ち状態は存在しない。
--       pending/approved/rejectedのいずれの値も意味を失った。
--   (2) 05章申し送り事項は「次フェーズの不正申告対策向けに『取消済みか否か』等に
--       転用する」選択肢も示していたが、企画部は04章・07章で不正申告対策の実装方式
--       として「対象completionを直接UPDATE/DELETEするのではなく、打ち消しの逆方向
--       エントリ（別行としてマイナスのエントリを追加）を推奨する」と明言している。
--       この方式では取消は新しい行の追加で表現され、元の完了報告行そのものを
--       「取消済みフラグ」に書き換える必要が無い。したがってstatusを「取消済みか
--       否か」に転用する設計は、企画部が推奨する将来方式とそもそも噛み合わない。
--       転用よりも廃止の方が将来の実装方針と整合的と判断した。
--   (3) 本テーブルはこれによりUPDATE経路そのものが不要になり（後述）、
--       「子どもの完了報告は不変」という会計モデルの性質がスキーマレベルで
--       より強く保証されるようになった（副次的なメリット）。
--   将来の打ち消しエントリ方式への配慮は本章末尾のコメントを参照。
--
-- [廃止] reviewed_by / reviewed_at 列を廃止する。
--   05章申し送り事項のとおり「保護者リアクション（スタンプ／コメント）」機能に
--   置き換わる。ただし単純な列の転用（reviewed_by→reacted_by等のリネーム）では
--   実現できないと判断し、新設の chore_reactions テーブル（本章末尾）に分離した。
--   理由（テーブル分離を選んだ理由）:
--   (a) 07章4「保護者は任意でスタンプ／コメントのいずれか、または両方を付与できる」
--       かつ03章「パパ・ママ双方が対等にリアクション付与できる」ことから、
--       1件の完了報告に対して複数回・複数人（両親それぞれ）がリアクションできる
--       必要がある。reviewed_by/reviewed_atのような「1完了報告につき1組」の
--       列ペアでは最初のリアクションで埋まってしまい、2人目の保護者や2回目の
--       スタンプを記録できない。1:N の別テーブルでなければ表現できない。
--   (b) スタンプ（定型・複数種あり得る）とコメント（自由記述）という異なる形の
--       データを1完了報告1行に持たせようとすると、NULL許容列が横に増え続け
--       スキーマが複雑化する。1リアクション=1行の別テーブルの方が単純。
--   (c) 別テーブルに分離した結果、chore_completions は「INSERTのみ・UPDATE
--       不可」の完全な追記専用ログになる（下記RLS参照）。子どもの完了報告本体を
--       「不変のまま」に保つという要件を、UPDATE権限を細かく制限するトリガーでは
--       なく、そもそもUPDATEポリシーを一切作らないという最も強い形で満たせる。
--
-- [廃止] review_note 列を廃止する。保護者の差し戻しメッセージという用途自体が
--   無くなったため。任意コメントは chore_reactions.comment_body に置き換わる。
--
-- [変更] 05章の定義に無かった family_id / chore_title(スナップショット) を
-- 追加する。
--   family_id: 05章は「chore_idを辿ればfamily_idはわかる」前提だったが、
--     RLSポリシーを全テーブルで「family_id = current_family_id()」という
--     単純な形に統一するため（サブクエリJOINのRLSはインデックスが効きにくく
--     ポリシー間で書き方がぶれるリスクがある）、family_idを直接持たせる方針
--     にした（設計部CLAUDE.mdの「family_idを辿れるFK」要件は満たしつつ、
--     実装はより単純・高速な直接列を選択）。値はトリガーでchoresから自動コピー
--     するため、クライアントが誤ったfamily_idを送っても上書きされる。
--   chore_title: family-todoのquest_history.quest_title / point_records.category_name
--     と同じ「発生時点のラベルをスナップショットする」パターンを踏襲。
--     chore.title変更後や、chore自体をis_active=falseにした後も、過去の
--     完了履歴の表示が壊れないようにするため。
--
-- [追加] 開発部/成果物/実装メモ.md 6.1章の指摘への対応（4章chores.emoji追加と
--   セット）: chore_title と同じ「発生時点のラベルをスナップショットする」
--   パターンを chore_emoji にも適用する。choreが削除（is_active=false）・
--   絵文字変更された後も、過去の完了履歴（C8通帳・実施履歴カレンダー等）の
--   絵文字表示が壊れないようにするため。値は下記5aトリガーでchoresから自動コピーする。
--
-- note列（子どもが完了報告時に書くひとことメモ、任意）は従来どおり残す。
-- UPDATE経路が無くなったため「不変性」を守るためのトリガーチェックは不要に
-- なったが、note自体の存在理由（子どもの一言メモ）はそのまま有効である。
-- ============================================================
CREATE TABLE IF NOT EXISTS chore_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  chore_id UUID NULL REFERENCES chores(id) ON DELETE SET NULL,
  chore_title TEXT NOT NULL,
  chore_emoji TEXT NULL, -- choreのemoji列と同様NULL許容のスナップショット。フォールバックはクライアント側（実装メモ.md 6.1章対応）。
  reported_by UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  points INT NOT NULL CHECK (points > 0), -- [将来配慮] 本章末尾「打ち消しの逆方向エントリ方式への配慮」コメント参照
  photo_url TEXT NULL,
  note TEXT NULL, -- 子どもが完了報告時に書くひとことメモ（任意）。INSERT後の変更経路が存在しないため常に不変。
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- reported_by は ON DELETE RESTRICT とし、子どものfamily_membersレコードは
-- 物理削除させない（2章のis_active運用を参照）。会計履歴の当事者を消せなくする
-- ことで、ポイント履歴の追跡可能性を保証する。

CREATE INDEX IF NOT EXISTS idx_chore_completions_family_id ON chore_completions(family_id);
CREATE INDEX IF NOT EXISTS idx_chore_completions_reported_by ON chore_completions(reported_by);
-- daily_limitチェック（下記トリガー）が (chore_id, reported_by, 当日) で
-- 絞り込むため、複合インデックスを用意する。
-- [変更] statusが廃止されたため WHERE status <> 'rejected' の部分インデックス条件を
-- 削除した。全行が等しく「確定済み」の実行回数としてカウント対象になる。
CREATE INDEX IF NOT EXISTS idx_chore_completions_daily_limit_lookup
  ON chore_completions(chore_id, reported_by, reported_at);
-- [追加] 実施履歴カレンダー（要件定義書07-3章）向け。family_id + 期間で範囲検索する
-- クエリ（週間バー・月間カレンダー・日別詳細のいずれも「対象期間のchore_completions」を
-- 取得する形になる）を支えるための複合インデックス。8a章 chore_completion_daily_summary
-- Viewの集計、およびAPI仕様.md「実施履歴カレンダー」節の詳細一覧取得の両方で使われる。
CREATE INDEX IF NOT EXISTS idx_chore_completions_family_reported_at
  ON chore_completions(family_id, reported_at);

ALTER TABLE chore_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chore_completions_select_same_family" ON chore_completions;
CREATE POLICY "chore_completions_select_same_family" ON chore_completions
  FOR SELECT
  USING (family_id = current_family_id());

-- 報告: 本人（子ども/保護者いずれも自分の実行分は自己申告できる）のみ
DROP POLICY IF EXISTS "chore_completions_insert_self" ON chore_completions;
CREATE POLICY "chore_completions_insert_self" ON chore_completions
  FOR INSERT
  WITH CHECK (family_id = current_family_id() AND reported_by = current_family_member_id());

-- [廃止] chore_completions_update_by_parent ポリシーを廃止する（UPDATEポリシーを
-- 一切作らない）。旧ポリシーは「承認/差し戻し」のためのUPDATE経路だったが、
-- 07章のとおり承認/差し戻しという操作自体が無くなり、reviewed_by/reviewed_at・
-- statusの列も廃止したため、chore_completionsにUPDATEすべき列がそもそも存在しない。
-- 保護者のリアクションはchore_reactions（本章末尾）への別テーブルINSERTとして
-- 表現するため、chore_completions自体はSELECT/INSERTのみの完全な追記専用ログになる。

-- DELETEポリシーは作らない（加算のみの会計モデル。物理削除は行わない。
-- family-todoのSSOT思想を踏襲。誤報告への対処は次フェーズの「打ち消しの
-- 逆方向エントリ」で行う想定であり、既存行のDELETE/UPDATEでは対処しない）。

-- ------------------------------------------------------------
-- 5a. INSERT時トリガー: family_id/points/chore_title/chore_emojiの自動補完
--      (改ざん防止) + 実行回数上限チェック
--   [変更] requires_approval分岐・status/reviewed_by/reviewed_at設定を全て削除。
--   承認フロー廃止（07章）に伴い、INSERTされた時点でそのまま確定済みの
--   完了報告になる。ポイントはINSERT成功と同時にmember_points（8章）へ反映される。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.chore_completions_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_family_id UUID;
  v_title TEXT;
  v_emoji TEXT;
  v_points INT;
  v_is_repeatable BOOLEAN;
  v_daily_limit INT;
  v_count INT;
  v_today DATE;
BEGIN
  SELECT family_id, title, emoji, points, is_repeatable, daily_limit
    INTO v_family_id, v_title, v_emoji, v_points, v_is_repeatable, v_daily_limit
  FROM chores
  WHERE id = NEW.chore_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたchoreが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- クライアントが送ってきた値は信用せず、常にDB側の最新値で上書きする
  -- （ポイント値の改ざん・他家族へのなりすまし報告を防ぐ）
  NEW.family_id := v_family_id;
  NEW.chore_title := v_title;
  NEW.chore_emoji := v_emoji; -- chore_titleと同様のスナップショット（実装メモ.md 6.1章対応）
  NEW.points := v_points;

  -- 実行回数上限チェック
  v_today := (now() AT TIME ZONE 'Asia/Tokyo')::date;

  IF NOT v_is_repeatable THEN
    -- [変更] statusが廃止されたため「rejectedを除く」という除外条件を削除。
    -- 単発choreは生涯で1回のみ（承認フロー廃止によりrejected相当の状態が
    -- 存在しなくなったため、無条件に「既存の完了報告があれば不可」でよい）。
    IF EXISTS (
      SELECT 1 FROM chore_completions
      WHERE chore_id = NEW.chore_id
    ) THEN
      RAISE EXCEPTION 'このお手伝いはすでに完了報告済みです' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF v_daily_limit IS NOT NULL THEN
    -- 繰り返しchoreは「メンバーごと・1日あたり」の上限とする。
    -- [設計判断] assigned_toがnull（誰でも実行可）の場合に複数きょうだいで
    -- 上限を共有すると早い者勝ちになり不公平なため、上限は
    -- (chore_id, reported_by) 単位でカウントする。
    -- [変更] statusが廃止されたため「rejectedを除く」という除外条件を削除。
    SELECT count(*) INTO v_count
    FROM chore_completions
    WHERE chore_id = NEW.chore_id
      AND reported_by = NEW.reported_by
      AND (reported_at AT TIME ZONE 'Asia/Tokyo')::date = v_today;

    IF v_count >= v_daily_limit THEN
      RAISE EXCEPTION '本日の実行回数上限（%回）に達しています', v_daily_limit
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chore_completions_before_insert ON chore_completions;
CREATE TRIGGER trg_chore_completions_before_insert
  BEFORE INSERT ON chore_completions
  FOR EACH ROW EXECUTE FUNCTION public.chore_completions_before_insert();

-- [廃止] 5b. UPDATE時トリガー（chore_completions_before_update）は廃止する。
-- 承認/差し戻しという状態遷移自体が無くなり、chore_completionsにUPDATEポリシーを
-- 一切設けない方針にしたため（上記RLS参照）、対応するUPDATEトリガーも不要になった。

-- ------------------------------------------------------------
-- 5b. chore_reactions（新規：保護者リアクション。スタンプ／コメント）
-- ------------------------------------------------------------
-- [新設] 要件定義書.md v0.5 05章の申し送り事項「reviewed_by/reviewed_atは
-- 『保護者リアクション』機能に置き換わる見込み」を受けて新設する。
-- chore_completions本体からの分離理由・列設計の背景は5章冒頭コメント(c)参照。
--
-- [設計判断: 1completionにつき何件まで/誰がリアクションできるか]
-- 「複数回・複数人（両親）がリアクションできる」設計とし、1件のみに制限しない。
-- 理由: 03章「パパ・ママ双方が対等にリアクション付与・管理できる」、07章4
-- 「スタンプ（例:『がんばったね』『ありがとう』）またはコメントのいずれか、
-- または両方を付与できる」という要件から、片方の保護者が先にスタンプを押しても
-- もう片方の保護者が別のスタンプやコメントを追加できる必要がある。
-- ただし「同じ保護者が全く同じ種類のスタンプを連打して増殖する」ことだけは
-- 下記の部分ユニークインデックス（uq_chore_reactions_stamp_dedup）で防ぐ
-- （Strava Kudosの「一度送ったら取り消せない・重複押下は増えない」という
-- 07章が参照するUXパターンの実装）。異なる種類のスタンプを複数付ける、
-- コメントを複数回書く、といった操作自体は禁止しない。
--
-- [設計判断: スタンプとコメントの表現方法]
-- 1行=1リアクションとし、kind列で 'stamp' か 'comment' かを区別する。
-- stamp行はstamp_key（定型スタンプの種類を表す文字列キー）を持ち、comment_bodyは
-- NULL。comment行はcomment_bodyを持ち、stamp_keyはNULL（chk_reaction_kind_payload
-- で強制）。stamp_keyはPostgresのCHECK enumではなくTEXT（非空チェックのみ）とした。
-- 理由: 10章未決事項「保護者リアクションのスタンプの具体的な文言・種類・デザインは
-- UIUXデザイン部と検討する」のとおり、スタンプの種類は本設計時点でまだ確定して
-- いない。TEXTにしておけば、UIUXデザイン部が種類を追加・変更してもマイグレーション
-- （enumの値追加はPostgresでは容易だが削除・リネームができない等の制約がある）
-- 無しでクライアント側の選択肢を変更できる。
--
-- [設計判断: 取消（DELETE/UPDATE）を許可するか]
-- 一切許可しない（UPDATE/DELETEポリシーを作らない）。07章「保護者のリアクションは
-- 常にポジティブな一方向コミュニケーションとして設計する…Strava Kudosの
-- 『一度送ると取り消せない・一方向ポジティブ』という設計思想を踏襲する」という
-- 要件を、そのままRLSレベルで強制する。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chore_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  completion_id UUID NOT NULL REFERENCES chore_completions(id) ON DELETE CASCADE,
  reacted_by UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK (kind IN ('stamp', 'comment')),
  stamp_key TEXT NULL CHECK (stamp_key IS NULL OR char_length(trim(stamp_key)) BETWEEN 1 AND 50),
  comment_body TEXT NULL CHECK (comment_body IS NULL OR char_length(trim(comment_body)) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_reaction_kind_payload CHECK (
    (kind = 'stamp' AND stamp_key IS NOT NULL AND comment_body IS NULL)
    OR (kind = 'comment' AND comment_body IS NOT NULL AND stamp_key IS NULL)
  )
);

-- completion_idはON DELETE CASCADEとする。chore_completions自体は加算のみの
-- 会計モデルにより通常物理削除されない（想定される消滅経路はfamilies経由の
-- 家族削除カスケードのみ）ため、通常運用でリアクションだけが孤立することはない。

CREATE INDEX IF NOT EXISTS idx_chore_reactions_completion_id ON chore_reactions(completion_id);
CREATE INDEX IF NOT EXISTS idx_chore_reactions_family_id ON chore_reactions(family_id);

-- 同一保護者が同一completionに同じstamp_keyのスタンプを連打しても1件に
-- 収束させる（上記[設計判断]参照）。comment（自由記述）には適用しない
-- （複数回コメントすること自体は自然な運用のため）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_chore_reactions_stamp_dedup
  ON chore_reactions(completion_id, reacted_by, stamp_key)
  WHERE kind = 'stamp';

ALTER TABLE chore_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chore_reactions_select_same_family" ON chore_reactions;
CREATE POLICY "chore_reactions_select_same_family" ON chore_reactions
  FOR SELECT
  USING (family_id = current_family_id());

-- リアクション付与は保護者のみ（子どもは自分の完了報告にリアクションできない）。
-- reacted_by = current_family_member_id() により、他の保護者になりすまして
-- リアクションを付与することもできない。
DROP POLICY IF EXISTS "chore_reactions_insert_by_parent" ON chore_reactions;
CREATE POLICY "chore_reactions_insert_by_parent" ON chore_reactions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND is_current_user_parent()
    AND reacted_by = current_family_member_id()
  );

-- UPDATE/DELETEポリシーは作らない（上記[設計判断: 取消を許可するか]参照）。

CREATE OR REPLACE FUNCTION public.chore_reactions_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  -- family_idはクライアントを信用せず、対象completionから自動補完する
  -- （chore_completions_before_insertと同じ「改ざん防止」パターン）。
  SELECT family_id INTO v_family_id FROM chore_completions WHERE id = NEW.completion_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の完了報告が存在しません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.family_id := v_family_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chore_reactions_before_insert ON chore_reactions;
CREATE TRIGGER trg_chore_reactions_before_insert
  BEFORE INSERT ON chore_reactions
  FOR EACH ROW EXECUTE FUNCTION public.chore_reactions_before_insert();

-- ------------------------------------------------------------
-- 5c. 将来の不正申告対策（次フェーズ）「打ち消しの逆方向エントリ」方式への配慮
-- ------------------------------------------------------------
-- [将来配慮・今回は実装しない] 要件定義書.md 04章・05章・07章のとおり、
-- 「保護者が事後に個別のポイント加算を取り消せる例外的な訂正機能」は次フェーズ
-- 検討事項でありMVPには含めない。企画部は将来実装する場合の方式として、
-- 既存completion行を直接UPDATE/DELETEするのではなく「打ち消しの逆方向エントリ
-- （マイナスのエントリを別行として追加する）」方式を推奨しており、以下の観点で
-- 本スキーマがその方式を将来追加しやすい形になっているかを確認した。
--
-- 適合している点:
--   - chore_completionsは既にINSERT専用（UPDATEポリシー無し）の追記専用ログに
--     なっており、「新しい行を追加する」方式は既存の設計思想（5章[廃止](3)）と
--     完全に一致する。UPDATE手段を新設する必要が無い。
--   - member_points（8章）はstatusフィルタを廃止したことで単純な
--     `SUM(chore_completions.points)` になった。これは「打ち消し行の points を
--     負の値にして追加するだけで、View側の変更なしに残高が自動的に正しく相殺
--     される」ことを意味する（符号付きの合計として正しく機能する）。
--
-- 将来実装時に見直しが必要になる点（今回は変更しない）:
--   - `points INT NOT NULL CHECK (points > 0)` は現状「正の値のみ」を強制して
--     おり、打ち消し行（負の値）をそのまま挿入することはできない。将来実装時は
--     (a) このCHECKを緩めて負の値を許可する、または (b) `entry_type`
--     enum('completion','reversal') のような列を追加し「reversalの場合は
--     points列を絶対値のまま持ち、SUM計算時にentry_typeで符号を掛ける」設計に
--     するか等の判断が必要になる。いずれもこの5章の変更のみで完結し、
--     chore_reactions・member_points（View定義自体）・他テーブルへの影響は
--     限定的である見込み。
--   - 打ち消し行と元の完了報告行を紐づける列（例: 自己参照FK
--     `reverses_completion_id UUID NULL REFERENCES chore_completions(id)`）が
--     無いため、これも将来実装時に追加が必要。ただし現状のスキーマにこれを
--     妨げる要素は無く、nullable列の追加として問題なく後付けできる。
-- 以上より、今回のスキーマ変更は将来の打ち消しエントリ方式の追加を妨げておらず、
-- むしろstatusフィルタ廃止によりmember_points側の追随変更が不要になる分、
-- 相性が良くなったと判断する。


-- ============================================================
-- 6. rewards
-- ============================================================
-- [追加] 開発部/成果物/実装メモ.md 6.1章の指摘への対応（4章chores.emojiと同一の
--   問題・同一の対応）: 主要画面ワイヤーフレーム.md C9〜C11（ごほうび交換）は
--   rewardごとに保護者が選んだ固有の絵文字（🍦アイス 等）が表示される前提で
--   設計されていたが、05章由来の本テーブル定義には絵文字を保存する列が無かった。
--   emoji列（NULL許容）を追加してこれを解消する。NULL時のフォールバックは
--   chores.emojiと同様クライアント側の責務とし、DB側はNULL許容のままでよい。
--   影響範囲: 新規列の追加のみ。既存の列・トリガー・RLSポリシーには影響しない。
-- ============================================================
CREATE TABLE IF NOT EXISTS rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 100),
  emoji TEXT NULL, -- [追加] 保護者がごほうび登録時に選ぶ絵文字（例: 🍦）。chores.emojiと同様の設計判断。NULLの場合のフォールバックはクライアント側で行う（実装メモ.md 6.1章対応）。
  cost INT NOT NULL CHECK (cost > 0),
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rewards_family_id ON rewards(family_id);
CREATE INDEX IF NOT EXISTS idx_rewards_family_active ON rewards(family_id, is_active);

DROP TRIGGER IF EXISTS trg_rewards_updated_at ON rewards;
CREATE TRIGGER trg_rewards_updated_at
  BEFORE UPDATE ON rewards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rewards_select_same_family" ON rewards;
CREATE POLICY "rewards_select_same_family" ON rewards
  FOR SELECT
  USING (family_id = current_family_id());

DROP POLICY IF EXISTS "rewards_write_by_parent" ON rewards;
CREATE POLICY "rewards_write_by_parent" ON rewards
  FOR ALL
  USING (family_id = current_family_id() AND is_current_user_parent())
  WITH CHECK (family_id = current_family_id() AND is_current_user_parent());


-- ============================================================
-- 7. reward_redemptions
-- ============================================================
-- [変更] 05章では status enum(pending/approved) となっていたが、
-- 00章の変更履歴(2026-08-13)にある本部長決定「MVPは即時交換、statusは常にapproved」
-- を反映し、CHECK制約でapproved以外を受け付けないようにする。
-- 将来フェーズで家庭ごとの承認制オプションを追加する際は、この
-- CHECK制約を緩め、chore_completionsと同様のpending/approved/rejected
-- ステートマシン用トリガーに差し替えるマイグレーションが必要になる
-- （影響範囲: 本テーブルのCHECK制約とINSERTトリガーのみ。他テーブルへの影響なし）。
-- family_id / reward_nameスナップショットの追加理由はchore_completionsと同様。
-- ============================================================
CREATE TABLE IF NOT EXISTS reward_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  reward_id UUID NULL REFERENCES rewards(id) ON DELETE SET NULL,
  reward_name TEXT NOT NULL,
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  cost INT NOT NULL CHECK (cost > 0),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status = 'approved'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_redemptions_family_id ON reward_redemptions(family_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_member_id ON reward_redemptions(member_id);
CREATE INDEX IF NOT EXISTS idx_reward_redemptions_created_at ON reward_redemptions(created_at DESC);

ALTER TABLE reward_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reward_redemptions_select_same_family" ON reward_redemptions;
CREATE POLICY "reward_redemptions_select_same_family" ON reward_redemptions
  FOR SELECT
  USING (family_id = current_family_id());

-- 交換申請: 本人 または 保護者が代理で交換可
DROP POLICY IF EXISTS "reward_redemptions_insert_self_or_parent" ON reward_redemptions;
CREATE POLICY "reward_redemptions_insert_self_or_parent" ON reward_redemptions
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND (member_id = current_family_member_id() OR is_current_user_parent())
  );

-- UPDATE/DELETEポリシーは作らない（即時交換・不変の会計履歴）。

-- ------------------------------------------------------------
-- 7a. INSERT時トリガー: family_id/cost/reward_nameの自動補完 + 残高不足チェック
-- family-todoのcheck_reward_points_balance()を本スキーマ向けに移植したもの。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reward_redemptions_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_family_id UUID;
  v_name TEXT;
  v_cost INT;
  v_member_family_id UUID;
  v_available INT;
BEGIN
  SELECT family_id, name, cost INTO v_family_id, v_name, v_cost
  FROM rewards
  WHERE id = NEW.reward_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたごほうびが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT family_id INTO v_member_family_id FROM family_members WHERE id = NEW.member_id;
  IF v_member_family_id IS DISTINCT FROM v_family_id THEN
    RAISE EXCEPTION 'ごほうびと交換対象メンバーの家族が一致しません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.family_id := v_family_id;
  NEW.reward_name := v_name;
  NEW.cost := v_cost;
  NEW.status := 'approved';

  SELECT current_points INTO v_available
  FROM member_points
  WHERE member_id = NEW.member_id;

  v_available := COALESCE(v_available, 0);

  IF v_available < NEW.cost THEN
    RAISE EXCEPTION 'ポイントが不足しています。member_id: %, 必要: %, 保有: %',
      NEW.member_id, NEW.cost, v_available
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reward_redemptions_before_insert ON reward_redemptions;
CREATE TRIGGER trg_reward_redemptions_before_insert
  BEFORE INSERT ON reward_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.reward_redemptions_before_insert();


-- ============================================================
-- 8. member_points（View）
-- ============================================================
-- [設計判断] Postgres 15+ の security_invoker=true を明示指定する。
-- 指定しない場合、Viewはデフォルトで作成者(通常は特権ロール)の権限で実行され、
-- 元テーブルのRLSを素通りしてしまう（Supabaseで頻出する事故パターン）。
-- security_invoker=true にすることで、Viewを呼び出したユーザー自身のRLSが
-- chore_completions / reward_redemptions / family_members に対して適用される。
--
-- family-todoのuser_current_pointsはFULL OUTER JOIN方式だったが、
-- 本設計ではfamily_membersを起点にしたLEFT JOIN方式に変更した。
-- 理由: FULL OUTER JOINだと「一度も履歴の無いメンバー」が結果に出ない
-- ケースがあり、通帳画面で新規メンバーの残高0円行が表示されない不具合の
-- 元になるため。family_members起点にすることで全メンバーが必ず1行出る。
--
-- [変更] earned側の `WHERE status = 'approved'` を削除した。要件定義書.md v0.5
-- 05章の申し送り事項「承認フロー廃止に伴い、chore_completionsは完了報告時点で
-- 確定済みのため原則全件が集計対象となる想定。『承認済み』という絞り込み条件は
-- 不要になる見込み」のとおり、chore_completionsからstatus列自体を廃止した
-- （5章参照）ため、フィルタなしの単純なSUM(points)に変更した。
-- spent側（reward_redemptions.status = 'approved'）は本タスクのスコープ外で
-- あり変更していない。reward_redemptions.status は05章の別の設計判断（7章）で
-- 「MVPでは常にapproved固定・将来フェーズで家庭ごとの承認制オプションを検討」
-- という現役の意味を保ったままの列であり、chore_completions.statusとは廃止理由が
-- 異なるため、両者を混同しないよう明記しておく。
-- ============================================================
CREATE OR REPLACE VIEW member_points
WITH (security_invoker = true) AS
SELECT
  fm.id AS member_id,
  fm.family_id,
  fm.display_name,
  (COALESCE(earned.total, 0) - COALESCE(spent.total, 0))::INT AS current_points
FROM family_members fm
LEFT JOIN (
  SELECT reported_by AS member_id, SUM(points)::INT AS total
  FROM chore_completions
  GROUP BY reported_by
) earned ON earned.member_id = fm.id
LEFT JOIN (
  SELECT member_id, SUM(cost)::INT AS total
  FROM reward_redemptions
  WHERE status = 'approved'
  GROUP BY member_id
) spent ON spent.member_id = fm.id
WHERE fm.is_active;


-- ============================================================
-- 8a. chore_completion_daily_summary（View：実施履歴カレンダー用集計）
-- ============================================================
-- [新設] 要件定義書.md v0.5 05章・07-3章の申し送り事項「実施履歴カレンダーは
-- 既存のchore_completionsをそのまま集計に使える見込みであり、新規テーブルの
-- 追加は基本的に不要と考えられる。具体的な集計方法（View新設かクライアント側
-- 集計か等）は設計部の判断に委ねる」を受けての設計判断。
--
-- [判断: 新規テーブルは不要と確認した]
-- 07-3章が要求する情報（誰が・いつ・何をして・何ポイント得たか）は、既存の
-- chore_completions（family_id, reported_by, chore_title, chore_emoji, points,
-- reported_at）だけで過不足なく表現できる。完了報告と同時に確定するモデルに
-- なったことで「審査待ち行を除外する」といった追加考慮も不要になっており、
-- 新規テーブルを追加する積極的な理由は無いと判断した。
--
-- [判断: Viewを新設する（クライアント側集計のみに任せない）]
-- 07-3章1「週間バー→月間カレンダー→日別実績」という段階的開示のうち、
-- 週間バー・月間カレンダーの各セルは「その日の合計獲得ポイント」（07-3章6）と
-- 「その日に活動したメンバーの色分けドット」（07-3章2）というメンバー×日付単位の
-- 集計値を表示する。この集計は
--   (a) JST（Asia/Tokyo）基準の日付境界で区切る必要がある（4章daily_limit
--       トリガーと同じ `(reported_at AT TIME ZONE 'Asia/Tokyo')::date` を使う）
--   (b) 家族の全画面（複数の子ども×複数月）で繰り返し必要になる
-- という2点から、日付境界の計算をクライアント側の各画面で毎回書かせると
-- タイムゾーンの扱いがずれるバグを生みやすい。DB側で1箇所に集約する。
-- 一方、「日付をタップした後の日別詳細一覧（誰が・何を・何ポイント）」
-- （07-3章1の3段階目）は、この集計Viewではなく通常のchore_completionsを
-- 対象日でフィルタしたSELECTで十分であり、Viewを介する必要は無い
-- （API仕様.md「実施履歴カレンダー」節参照）。
--
-- member_pointsと同様 security_invoker=true を明示し、呼び出しユーザー自身の
-- chore_completions RLS（family_id = current_family_id()）がそのまま適用される
-- ようにする。
-- ============================================================
CREATE OR REPLACE VIEW chore_completion_daily_summary
WITH (security_invoker = true) AS
SELECT
  cc.family_id,
  cc.reported_by AS member_id,
  (cc.reported_at AT TIME ZONE 'Asia/Tokyo')::date AS activity_date,
  COUNT(*)::INT AS completion_count,
  SUM(cc.points)::INT AS total_points
FROM chore_completions cc
GROUP BY cc.family_id, cc.reported_by, (cc.reported_at AT TIME ZONE 'Asia/Tokyo')::date;


-- ============================================================
-- 9. 家族作成・参加用 SECURITY DEFINER 関数
-- ============================================================
-- [設計判断] 家族作成・招待コードでの参加は「まだfamily_membersに行が無い
-- ユーザーが最初の行を作る」処理であり、通常のRLS INSERTポリシー
-- （current_family_id()に依存）では成立しない（鶏と卵問題）。
-- そのため、認証済みユーザー(auth.uid() IS NOT NULL)であることだけを条件に、
-- SECURITY DEFINER関数の中で必要な整合性チェックを行いRLSをバイパスして
-- 2テーブルへのINSERTをアトミックに実行する。
-- これらはservice_role専用ではなく、authenticatedロールにEXECUTEを許可し、
-- クライアントSDKから直接 supabase.rpc() で呼び出す想定（Edge Function化は不要）。
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_family_with_owner(p_family_name TEXT, p_display_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_members WHERE auth_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'このアカウントはすでにいずれかの家族に所属しています' USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO families (name) VALUES (p_family_name) RETURNING id INTO v_family_id;

  INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner)
  VALUES (v_family_id, p_display_name, 'parent', auth.uid(), true);

  RETURN v_family_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_family_with_invite_code(p_invite_code TEXT, p_display_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION '認証が必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM family_members WHERE auth_user_id = auth.uid()) THEN
    RAISE EXCEPTION 'このアカウントはすでにいずれかの家族に所属しています' USING ERRCODE = 'unique_violation';
  END IF;

  SELECT id INTO v_family_id FROM families WHERE invite_code = upper(p_invite_code);
  IF NOT FOUND THEN
    RAISE EXCEPTION '招待コードが無効です' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO family_members (family_id, display_name, role, auth_user_id, is_owner)
  VALUES (v_family_id, p_display_name, 'parent', auth.uid(), false);

  RETURN v_family_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_family_with_owner(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_family_with_invite_code(TEXT, TEXT) TO authenticated;

-- 子どもプロフィール作成(role='child', auth_user_id=NULL)は通常のRLS INSERTポリシー
-- (family_members_insert_by_parent)で保護者が直接INSERT可能。
-- PIN設定・子どもログインはfamily_member_pinsがservice_role専用のため、
-- 認証・データ管理設計書.mdで定義するEdge Functionが担当する。


-- ============================================================
-- 10. push_tokens
-- ============================================================
-- [追加] 本部長差し戻し（100点ルーブリック採点95点、不足点:
-- push_tokensテーブルの欠落）への対応。
--   API仕様.md 8章は当初「push_tokensは次フェーズ扱いとし、今回の
--   スキーマ設計.sqlには含めない」としていたが、企画部要件定義書04章の
--   機能一覧では「プッシュ通知（報告→保護者へ、承認/差し戻し→子どもへ）」
--   が明確にMVPスコープと定義されている（承認済み・100点）。プッシュ通知を
--   送るにはExpoのデバイストークンの保存先が必須であり、次フェーズへの
--   先送りは承認済みMVPスコープと矛盾し開発部が実装できないため、本テーブルを
--   追加しMVPスコープに含める。
--   影響範囲: 新規テーブルの追加のみ。既存テーブル定義・既存RLSポリシー・
--   既存トリガー・既存Viewには一切変更を加えていない（他テーブルへの
--   参照はfamily_members.idへのFKのみで、他テーブル側からpush_tokensを
--   参照する既存オブジェクトも無いため、追加による副作用は無い）。
--   API仕様.md 8章／認証・データ管理設計書.md 4章もあわせて更新する。
--
-- [設計判断] family_id列は持たせない。
--   他の家族データテーブル（chore_completions等）はRLSをシンプルに
--   「family_id = current_family_id()」の形に揃えるためfamily_idを直接
--   持たせているが、push_tokensは下記のとおり「本人のトークンのみ本人が
--   読み書きする」設計とし、家族単位でのSELECTを許可しないため、
--   family_id列を追加する理由が無い。通知送信バッチ（Edge Function /
--   DB Webhook、service_role実行。API仕様.md 8章参照）が家族単位で
--   トークンを引く際は push_tokens JOIN family_members ON member_id で
--   family_idを辿ればよく、service_roleはRLSをバイパスするため性能・
--   実装上の支障もない。列を増やさないことは「子どもの個人情報は最小限に
--   留める」方針（設計部CLAUDE.md）にも沿う。
-- ============================================================
CREATE TABLE IF NOT EXISTS push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  expo_push_token TEXT NOT NULL CHECK (char_length(trim(expo_push_token)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 同じメンバー・同じトークンの重複登録（アプリ起動のたびの再登録等）を
  -- 防ぐ。member_idを含めた複合UNIQUEにしているのは、家族共有タブレットで
  -- 複数の子どもプロフィールが同一デバイス（＝同一Expoトークン）を使う
  -- ケースを許容するため（1つのExpoトークンが複数memberに紐づくこと自体は
  -- 正常な運用であり、禁止すべきなのは「同一member×同一トークン」の重複のみ）。
  UNIQUE (member_id, expo_push_token)
);

-- member_id は ON DELETE CASCADE とする（chore_completions.reported_byの
-- ON DELETE RESTRICTとは異なる方針）。push_tokensは会計履歴のような
-- 追跡可能性が必要な情報ではなく、単なる通知先の付随情報のため、
-- メンバー物理削除時（2章のとおり通常はis_active論理削除だが、
-- 家族全体削除 remove-member(delete_family) 時はfamilies経由のCASCADEで
-- family_membersも物理削除される）は一緒に消えてよい。むしろ退会した
-- メンバーの端末に通知を送り続けないためにもCASCADEが望ましい。
CREATE INDEX IF NOT EXISTS idx_push_tokens_member_id ON push_tokens(member_id);

DROP TRIGGER IF EXISTS trg_push_tokens_updated_at ON push_tokens;
CREATE TRIGGER trg_push_tokens_updated_at
  BEFORE UPDATE ON push_tokens
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- [設計判断] SELECT/INSERT/UPDATE/DELETEすべて「本人のトークンのみ」に
-- 限定する（family_id内の他メンバーからの参照は許可しない）。
--   理由1（個人情報最小化）: Expoのpush tokenはその端末（＝物理デバイス）を
--     一意に特定できる識別子であり、要件定義書06章・認証・データ管理設計書.md
--     4章が徹底する「子どもの個人情報最小化」の対象になり得る情報である。
--     他の保護者・きょうだいがそれを閲覧する実益は無く、デフォルトで家族内に
--     公開する必要は無い。
--   理由2（保護者が家族全員へ通知を送る主体になりうる件の検討）:
--     完了報告時に保護者へ通知する、承認時に子どもへ通知する、といった
--     送信主体は常に「クライアントアプリの保護者ユーザー自身」ではなく、
--     Supabase RealtimeのDB変更購読、またはDB Webhook経由でservice_role
--     Edge Functionが自動送信する設計（API仕様.md 8章）。service_roleは
--     RLSを常にバイパスするため、他メンバーのトークンをクライアントから
--     直接SELECTできる必要は無い。したがって「保護者はfamily内の全
--     トークンをSELECTできる」という緩いポリシーを作る積極的な理由が無く、
--     最小権限の原則を優先し本人限定とした。
--   UPDATEポリシーを用意する理由: 8章のとおりトークン登録は
--     `upsert(..., { onConflict: 'member_id,expo_push_token' })` で行う想定であり、
--     ON CONFLICT DO UPDATE はRLS上UPDATE権限も必要とするため、本人限定の
--     UPDATEポリシーも合わせて用意する。
DROP POLICY IF EXISTS "push_tokens_select_self" ON push_tokens;
CREATE POLICY "push_tokens_select_self" ON push_tokens
  FOR SELECT
  USING (member_id = current_family_member_id());

DROP POLICY IF EXISTS "push_tokens_insert_self" ON push_tokens;
CREATE POLICY "push_tokens_insert_self" ON push_tokens
  FOR INSERT
  WITH CHECK (member_id = current_family_member_id());

DROP POLICY IF EXISTS "push_tokens_update_self" ON push_tokens;
CREATE POLICY "push_tokens_update_self" ON push_tokens
  FOR UPDATE
  USING (member_id = current_family_member_id())
  WITH CHECK (member_id = current_family_member_id());

DROP POLICY IF EXISTS "push_tokens_delete_self" ON push_tokens;
CREATE POLICY "push_tokens_delete_self" ON push_tokens
  FOR DELETE
  USING (member_id = current_family_member_id());
