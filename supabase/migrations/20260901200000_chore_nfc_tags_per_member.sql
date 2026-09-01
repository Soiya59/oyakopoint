-- ============================================================
-- NFCタグの人ごと化（chore_nfc_tags新設・代理報告RPC新設、2026-09-01）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-2章「作り直し：タグの人ごと化（2026-08-30改訂）」
--   設計部/成果物/スキーマ設計.sql 39章（本部長採点100点で承認済み）
--   設計部/成果物/API仕様.md 3a-2章・4a-2章
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 7.6節
--   開発部/成果物/実装メモ.md 108章
--
-- [本ファイルの内容] 以下はスキーマ設計.sql 39.2〜39.4章・39.6〜39.7章のDDL・
-- トリガー・RPC・RLS・EXECUTE権限を**そのまま転記**したものである（開発部の
-- 判断で内容を変更していない。実装メモ.md 108章参照）。39.1章（前提）・
-- 39.5章（代理報告の実装方式の比較検討）・39.8〜39.12章（進捗取得の確認・
-- chores.nfc_tag_id凍結の方針・移行手順・照査スイート増分・開発部への申し送り）
-- はプローズ（設計判断の記録）でありSQL本体を含まないため、本マイグレーション
-- ファイルには含めない（該当内容は実装メモ.md 108章に転記済み）。
--
-- [破壊性] 非破壊的な変更のみ。新規テーブル1件（chore_nfc_tags）・新規トリガー
-- 1件・新規関数2件（ヘルパー1件・RPC1件）の追加のみで、既存テーブル・既存関数
-- （chore_completions_insert_selfを含む）への変更は一切無い。既存の
-- chores.nfc_tag_id列・uq_chores_nfc_tag_idインデックスも変更しない（39.9章の
-- 方針どおり凍結〈新規の読み書きをしない〉のみで、DDL上は物理的に何も変えない）。
--
-- [本ファイルの適用範囲についての重要な注意]
-- **本マイグレーションは作成のみであり、適用（`npx supabase db push`）はしない。**
-- 適用は本部長の操作を待つ（実装メモ.md 108章参照）。
-- ------------------------------------------------------------


-- 39.2 chore_nfc_tags テーブル DDL
-- ------------------------------------------------------------
-- [列設計の要点]
--   - family_id: chore_completions（5章）・chores（19章）等と同じ「サブクエリ
--     JOINに頼らずfamily_id = current_family_id()の単純な形にRLSを揃える」
--     既存方針を踏襲し、chore_id/member_idを辿れば分かる値だが直接列として
--     持たせる。値はクライアントを信用せず、下記39.3トリガーがchore側の値で
--     強制上書きする（改ざん防止パターン）。
--   - chore_id: ON DELETE CASCADE。chore_completions.chore_id（5章）は会計
--     履歴のスナップショットを保持するためON DELETE SET NULLだが、
--     chore_nfc_tagsは「今どのクエストに使えるか」という運用上の紐づけ情報
--     でしかなく、過去の実績を表示する画面が存在しない（29a章gacha_member_
--     progressと同じ理由づけ）。クエストが物理削除されれば（3章2026-09-01
--     追記のdeleteChore）そのタグは無条件に無意味になるため、履歴として
--     残す理由が無く、CASCADEで一緒に消えるのが最も単純で分かりやすい。
--   - member_id: ON DELETE RESTRICT。chore_completions.reported_by（5章）・
--     family_drawings.artist_member_id（33b章）と同じ「会計・記録の当事者は
--     物理削除させない」方針を踏襲する（もっとも family_members 自体が2章の
--     is_active運用により物理削除されないため、実務上は発動しない防御線）。
--   - tag_value: 3a章の`chores.nfc_tag_id`と同じ性質（アプリ生成の不透明な
--     ランダムトークン。物理NFCタグの工場出荷UIDではない）。
--   - revoked_at: null=有効。企画部の推奨（要件定義書05章申し送り事項6.）
--     どおり論理削除とする（07-15章で確立した「不可逆な削除は避ける」方針との
--     一貫性）。
--   - created_by（発行者）は持たせない。企画部が要件レベルで求めている情報は
--     「chore_id・member_id・family_id・タグ値・revoked_at・created_at」の
--     6点のみであり（05章申し送り事項）、「誰が物理タグに書き込んだか」まで
--     記録する要求は無い。発行UIは常に保護者（家族共有chore）またはみまもり
--     メンバー本人（自分専用chore）に権限が限定される（39.4章RLS）ため、
--     発行者は「そのchoreへの書込権限を持つ人」という形で既に一意に絞り込め、
--     追加の列を持たせる実益が薄いと判断した。
--
-- [ユニーク制約の設計判断: 部分ユニークインデックスではなく単純UNIQUE制約]
-- `chores.nfc_tag_id`（4章`uq_chores_nfc_tag_id`）はnullable列（未登録=NULL）
-- のため「NULLは複数行許容・NOT NULLの値だけ一意」という部分ユニーク
-- インデックスが必要だった。本テーブルは「行が存在する＝タグが発行された」
-- という設計（未登録という空の状態を表す行を持たない）であり、tag_valueは
-- 常にNOT NULLである。したがって単純な列制約`UNIQUE`で足り、WHERE句付きの
-- 部分インデックスは不要（PostgreSQLは列のUNIQUE制約を通常のB-treeインデックス
-- として実装するため、3a章のNFCタグ読み取り（`.eq('tag_value', tagValue)`）
-- は単一行lookupとして同等の速度で処理される）。
--
-- [一意性の範囲: 家族をまたいだグローバル一意、かつ解除後も再利用不可]
-- 要件定義書05章申し送り事項のとおり、既存`uq_chores_nfc_tag_id`と同じ
-- 「家族をまたいだグローバル一意」の考え方を維持する（4章コメント「多層防御」
-- の理由をそのまま継承。tag_valueがアプリ生成のランダム値である以上、家族内
-- 一意に限定する積極的な理由が無い）。加えて、解除済み（revoked_at IS NOT
-- NULL）の行も物理削除せず残すため、UNIQUE制約に例外（WHERE revoked_at IS
-- NULL等）を設けない限り、一度使われたtag_valueは解除後も自動的に再利用
-- 不可のままになる。これは企画部の推奨（「実装の単純さを優先し、値自体は
-- 再利用不可のままでよい」）と一致する、単純なUNIQUE制約が持つ副作用としての
-- 挙動である（そのための追加ロジックは一切書いていない）。
--
-- [tag_valueの上限長] `chores.nfc_tag_id`（4章）には上限長のCHECKが無かったが、
-- 本テーブルは新規設計のため多層防御として上限を追加する（改造クライアントが
-- 巨大な文字列を送りつけてインデックスを肥大化させる事故・攻撃への保険。
-- 33b章`is_valid_drawing_line_data`と同種の「サイズに上限を設ける」設計思想）。
-- クライアントが生成する`crypto.randomUUID()`相当のトークンは36文字程度で
-- 十分収まるため、512文字は実用上余裕を持った上限である。
CREATE TABLE IF NOT EXISTS chore_nfc_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  chore_id UUID NOT NULL REFERENCES chores(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  tag_value TEXT NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_chore_nfc_tags_tag_value_len CHECK (
    char_length(trim(tag_value)) > 0 AND char_length(tag_value) <= 512
  ),
  CONSTRAINT uq_chore_nfc_tags_tag_value UNIQUE (tag_value)
);

CREATE INDEX IF NOT EXISTS idx_chore_nfc_tags_family_id ON chore_nfc_tags(family_id);
-- [発行済み一覧・上限チェックの両方を支えるインデックス] 「そのクエスト・
-- そのメンバーに現在有効なタグが何枚あるか」（39.3章上限チェック）と、
-- 「そのクエストに発行済みのタグ一覧」（要件定義書07-2章判断事項4の編集画面
-- 表示、`.eq('chore_id', choreId).is('revoked_at', null)`）の両方のクエリを
-- 支える。解除済み行はどちらのクエリの対象にもならないため部分インデックスとする
-- （33b章`idx_family_drawings_artist_unpublished`と同じ設計判断）。
CREATE INDEX IF NOT EXISTS idx_chore_nfc_tags_chore_member_active
  ON chore_nfc_tags(chore_id, member_id) WHERE revoked_at IS NULL;

-- ------------------------------------------------------------
-- 39.3 発行枚数上限（5枚）・不変性・スコープ整合を強制するトリガー
-- ------------------------------------------------------------
-- [上限をCHECKではなくトリガーにした理由] CHECK制約は同一行の列同士の比較しか
-- できず、「同じ(chore_id, member_id)の既存行が何件あるか」という他行を跨いだ
-- 集計はCHECK制約で表現できない。33d章`family_drawings_before_insert`の
-- 未公開絵の保有上限チェックと全く同じ理由・同じパターン（SELECT count(*) ...
-- ならばRAISE EXCEPTION）を採用する（要件定義書05章申し送り事項が明示的に
-- この踏襲を推奨している）。
--
-- 単一のSQL関数にハードコードし、将来の調整（企画部案「5枚」は運用データを
-- 見て見直す前提。要件定義書07-2章判断事項5）が1箇所のCREATE OR REPLACEで
-- 完結するようにする（33b章`max_unpublished_drawings_per_member()`と同じ
-- 設計判断）。
CREATE OR REPLACE FUNCTION public.max_nfc_tags_per_chore_member()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 5; $$;

COMMENT ON FUNCTION public.max_nfc_tags_per_chore_member() IS
  '要件定義書07-2章判断事項5「1人×1クエストにつき最大5枚」の単一の定義箇所（企画部初期案。運用データを見て調整する前提）。';

-- [INSERT/UPDATEを1本の関数にまとめる理由] 4章`chores_before_write()`と同じく、
-- 同一テーブルへのBEFORE INSERT/UPDATEをTG_OPで分岐する1関数に集約する。
CREATE OR REPLACE FUNCTION public.chore_nfc_tags_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_chore_family_id UUID;
  v_chore_scope TEXT;
  v_chore_created_by UUID;
  v_chore_is_active BOOLEAN;
  v_member_family_id UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- [不変性・改ざん防止] 「解除」（revoked_atをNULLから非NULLへ変える）
    -- 以外のUPDATEを一切禁止する。誰の・どのクエストの・どの物理タグかという
    -- 紐づけは発行時に確定する一回きりの情報であり、後から付け替えられると
    -- 39.6章RPCが「代理報告として誰の分を報告したか」を判定する根拠が発行時と
    -- 食い違ってしまう。
    IF NEW.family_id IS DISTINCT FROM OLD.family_id
       OR NEW.chore_id IS DISTINCT FROM OLD.chore_id
       OR NEW.member_id IS DISTINCT FROM OLD.member_id
       OR NEW.tag_value IS DISTINCT FROM OLD.tag_value
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'タグの発行内容（クエスト・持ち主・タグ値）は変更できません。解除してから新しく発行し直してください' USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF OLD.revoked_at IS NOT NULL THEN
      RAISE EXCEPTION 'このタグはすでに解除されています' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.revoked_at IS NULL THEN
      RAISE EXCEPTION '解除操作（revoked_atの設定）以外のUPDATEはできません' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- クライアントが送った日時は信用せず、常にサーバー時刻を強制する
    -- （改ざん防止パターン。33d章decorate_tree_with_gacha_prize()等と同じ）。
    NEW.revoked_at := now();
    RETURN NEW;
  END IF;

  -- ここから TG_OP = 'INSERT'
  SELECT family_id, scope, created_by, is_active
    INTO v_chore_family_id, v_chore_scope, v_chore_created_by, v_chore_is_active
  FROM chores
  WHERE id = NEW.chore_id;

  IF NOT FOUND OR NOT v_chore_is_active THEN
    RAISE EXCEPTION '指定されたクエストが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT family_id INTO v_member_family_id FROM family_members fm WHERE fm.id = NEW.member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたメンバーが存在しません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- [クロス家族防止] chore・memberのfamily_idが一致しなければならない
  -- （4章`chores_before_write`のassigned_to検証と同じパターン）。family_idは
  -- クライアントを信用せず、常にchore側の値で上書きする（改ざん防止）。
  IF v_chore_family_id <> v_member_family_id THEN
    RAISE EXCEPTION 'クエストとメンバーが同じ家族に属していません' USING ERRCODE = 'foreign_key_violation';
  END IF;
  NEW.family_id := v_chore_family_id;

  -- [要件定義書07-2章判断事項7] 自分専用クエスト（scope='personal'）に発行
  -- できるタグの持ち主は常に作成者本人のみ（「持ち主を選ぶステップ自体を
  -- 省略できる」＝選択の余地が無い）。39.4章RLS側でも同条件を課しているが、
  -- トリガー側でも二重に強制する（21a章`chore_completions_before_insert`と
  -- chore_completions_insert_scopedポリシーの多層防御と同じ設計）。
  IF v_chore_scope = 'personal' AND NEW.member_id <> v_chore_created_by THEN
    RAISE EXCEPTION '自分専用クエストのタグは作成者本人の分のみ発行できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- [要件定義書07-2章判断事項5] 1人×1クエストにつき最大5枚。上限到達時は
  -- 新規発行をブロックするのみで、既存タグは無効化しない（33d章
  -- family_drawings_before_insertと同じ「新規追加のみブロックし、既存データは
  -- 削除・無効化しない」という07-11章由来の原則を踏襲）。
  IF (
    SELECT count(*) FROM chore_nfc_tags
    WHERE chore_id = NEW.chore_id AND member_id = NEW.member_id AND revoked_at IS NULL
  ) >= public.max_nfc_tags_per_chore_member() THEN
    RAISE EXCEPTION 'このクエスト・このメンバーにはすでにタグが上限枚数（%枚）発行されています', public.max_nfc_tags_per_chore_member()
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.revoked_at := NULL; -- 新規発行時は常に有効な状態から始まる（改ざん防止）
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chore_nfc_tags_before_write ON chore_nfc_tags;
CREATE TRIGGER trg_chore_nfc_tags_before_write
  BEFORE INSERT OR UPDATE ON chore_nfc_tags
  FOR EACH ROW EXECUTE FUNCTION public.chore_nfc_tags_before_write();

COMMENT ON TABLE chore_nfc_tags IS
  '要件定義書07-2章「作り直し：タグの人ごと化（2026-08-30改訂）」。1つの(chore_id, member_id)組に最大5枚（max_nfc_tags_per_chore_member()）まで発行できる。tag_valueは家族をまたいでグローバル一意（uq_chore_nfc_tags_tag_value）かつ解除後も再利用不可。revoked_at IS NULLが「有効」。解除以外のUPDATEは一切できない（chore_nfc_tags_before_write）。物理削除（DELETE）経路は用意しない（39.4章）。代理報告RPCは39.6章report_chore_completion_by_nfc_tag()参照。';

-- ------------------------------------------------------------
-- 39.4 RLS（閲覧・発行・解除）
-- ------------------------------------------------------------
-- [書込ポリシーを chores（19章）と同じ2系統に分ける理由] 要件定義書07-2章
-- 判断事項4「引き続きクエスト編集画面に置く」（家族共有choreは保護者操作）・
-- 判断事項7「みまもりメンバー自身の自分専用クエスト管理画面にも同じ操作を
-- 追加」（自分専用choreは作成者本人操作）に対応する。19章
-- chores_write_family_by_parent / chores_write_personal_by_creator と全く
-- 同じ「scope別に2本の名前付きポリシーを立て、PostgreSQLがOR結合する」構成を
-- 踏襲する。
--
-- [FOR ALLではなく発行(INSERT)と解除(UPDATE)を別ポリシーにした理由] chores
-- （19章）はFOR ALL（INSERT/UPDATE/DELETEをまとめて許可）だが、本テーブルは
-- 要件定義書05章申し送り事項の企画部推奨（論理削除を優先）に従い、物理DELETEの
-- 経路を一切用意しない方針を採った。FOR ALLを使うとDELETEも同じ条件で許可
-- されてしまうため、意図的にINSERT/UPDATEを個別の名前付きポリシーとして定義し、
-- DELETEポリシーは定義しない（defaultで拒否＝chore_reactions・family_drawingsの
-- UPDATEポリシー省略と同じ「作らないことで禁止を表現する」設計）。
ALTER TABLE chore_nfc_tags ENABLE ROW LEVEL SECURITY;

-- [SELECT] 家族全員に公開する。理由: (a) 3a章`chores.nfc_tag_id`も
-- `chores_select_scoped`（family_id一致のみ）で家族全員に読めており、本テーブルは
-- その代替であって新たな機微情報を追加するものではない。(b) 4a章のNFC読み取り
-- （`.eq('tag_value', tagValue)`検索）が「他家族のタグ・タグ未登録・削除済み
-- クエストのタグ」を単一の0件へ収束させる既存の設計思想（4章コメント）を
-- 維持するには、tag_value一致による検索自体は家族内で誰でも実行できる必要が
-- ある。(c) 家族境界（family_id）が本スキーマ全体の信頼境界であり、家族内の
-- 特定メンバーからだけ隠すという設計はどのテーブルにも存在しない（例:
-- gacha_member_progress・chore_completionsはいずれも家族全員に公開）ため、
-- 本テーブルだけ例外的に閲覧範囲を絞る積極的な理由が無い。
DROP POLICY IF EXISTS "chore_nfc_tags_select_same_family" ON chore_nfc_tags;
CREATE POLICY "chore_nfc_tags_select_same_family" ON chore_nfc_tags
  FOR SELECT
  USING (family_id = current_family_id());

-- [INSERT・家族共有chore] 保護者のみ。対象chore.scope='family'であることを
-- サブクエリで確認する（19章chores_write_family_by_parentと同じEXISTS句パターン）。
DROP POLICY IF EXISTS "chore_nfc_tags_insert_family_by_parent" ON chore_nfc_tags;
CREATE POLICY "chore_nfc_tags_insert_family_by_parent" ON chore_nfc_tags
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND is_current_user_parent()
    AND EXISTS (SELECT 1 FROM chores c WHERE c.id = chore_nfc_tags.chore_id AND c.scope = 'family')
  );

-- [INSERT・自分専用chore] みまもりメンバー本人のみ、かつ対象chore.scope=
-- 'personal'かつ自分が作成者であることを要求する（19章
-- chores_write_personal_by_creatorと同じ条件）。
DROP POLICY IF EXISTS "chore_nfc_tags_insert_personal_by_creator" ON chore_nfc_tags;
CREATE POLICY "chore_nfc_tags_insert_personal_by_creator" ON chore_nfc_tags
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND current_family_role() = 'supporter'
    AND EXISTS (
      SELECT 1 FROM chores c
      WHERE c.id = chore_nfc_tags.chore_id AND c.scope = 'personal' AND c.created_by = current_family_member_id()
    )
  );

-- [UPDATE（解除）・家族共有chore] 発行と同じ主体（保護者）のみが解除できる。
DROP POLICY IF EXISTS "chore_nfc_tags_revoke_family_by_parent" ON chore_nfc_tags;
CREATE POLICY "chore_nfc_tags_revoke_family_by_parent" ON chore_nfc_tags
  FOR UPDATE
  USING (
    family_id = current_family_id()
    AND is_current_user_parent()
    AND EXISTS (SELECT 1 FROM chores c WHERE c.id = chore_nfc_tags.chore_id AND c.scope = 'family')
  )
  WITH CHECK (
    family_id = current_family_id()
    AND is_current_user_parent()
    AND EXISTS (SELECT 1 FROM chores c WHERE c.id = chore_nfc_tags.chore_id AND c.scope = 'family')
  );

-- [UPDATE（解除）・自分専用chore] 発行と同じ主体（作成者本人のみまもり
-- メンバー）のみが解除できる。
DROP POLICY IF EXISTS "chore_nfc_tags_revoke_personal_by_creator" ON chore_nfc_tags;
CREATE POLICY "chore_nfc_tags_revoke_personal_by_creator" ON chore_nfc_tags
  FOR UPDATE
  USING (
    family_id = current_family_id()
    AND current_family_role() = 'supporter'
    AND EXISTS (
      SELECT 1 FROM chores c
      WHERE c.id = chore_nfc_tags.chore_id AND c.scope = 'personal' AND c.created_by = current_family_member_id()
    )
  )
  WITH CHECK (
    family_id = current_family_id()
    AND current_family_role() = 'supporter'
    AND EXISTS (
      SELECT 1 FROM chores c
      WHERE c.id = chore_nfc_tags.chore_id AND c.scope = 'personal' AND c.created_by = current_family_member_id()
    )
  );

-- DELETEポリシーは定義しない（上記[FOR ALLではなく〜にした理由]参照。
-- 物理削除の経路は無く、default-denyにより常に拒否される）。

-- ------------------------------------------------------------
-- 39.5 代理報告の実装方式 — 選択肢の比較と却下理由
-- ------------------------------------------------------------
-- [問題設定] 要件定義書05章申し送り事項・07-2章「作り直し」により、タグの
-- 持ち主（chore_nfc_tags.member_id）と、その端末でログイン中の報告者
-- （current_family_member_id()）が異なる「代理報告」を許可する必要がある。
-- しかし5章`chore_completions_insert_self`は`reported_by =
-- current_family_member_id()`のみを許可しており、これを緩めると「家族の誰でも
-- 他人名義の完了報告を作れる」ようになりかねない（ポイントが動く操作のため
-- 慎重に扱う、というCLAUDE.md/本部長指示）。以下の2案を検討した。
--
-- [案A（却下）: chore_completions_insert_selfのWITH CHECKを直接緩める]
-- 例えば下記のような条件をORで追加する案。
--   reported_by = current_family_member_id()
--   OR EXISTS (
--     SELECT 1 FROM chore_nfc_tags t
--     WHERE t.chore_id = chore_completions.chore_id
--       AND t.member_id = chore_completions.reported_by
--       AND t.revoked_at IS NULL
--       AND t.family_id = current_family_id()
--   )
-- 一見「同じ家族内で、reported_byが実在する有効なタグの持ち主であること」を
-- 要求しているように見えるが、致命的な弱点がある。**この条件は「reported_by
-- 宛にそのクエストのタグが（誰かによって・いつか）発行されたことがある」を
-- 検証しているだけで、「今回のINSERTの直接の原因が実際にそのタグを読み取った
-- ことである」ことを一切検証できない。** つまりNFCを一度も読み取っていない
-- 状態でも、通常の完了報告UI（あるいはPostgRESTへの直接呼び出し）から
-- `reported_by`にきょうだいのIDを指定するだけで、そのきょうだいが当該クエスト
-- のタグを持っている限り、いつでも代理報告が成立してしまう。「NFCタグを実際に
-- かざした場合に限り」という要件定義書05章の必須条件（「通常の完了報告
-- （NFC経由でない、手動での完了報告）は、引き続きreported_by=自分自身のみに
-- 限定したままとする」）を、RLSポリシー1本の条件式だけでは表現できない。
-- これは企画部が要件定義書05章申し送り事項で指摘している懸念（「単一のRLS
-- ポリシー内で『NFC経由かどうか』をどう検証するかが複雑になりやすい」）と
-- 完全に一致する。
--   [対症療法として考えられる追加策とその限界] 「読み取った」という事実を
--   chore_completionsに新規列（例: via_nfc_tag_id）として持たせ、WITH CHECKで
--   その列の整合性まで検証する、という拡張も考えられるが、これは結局
--   「INSERT文1本のWITH CHECKの中に、タグ検索・所有者解決・チェックの3段階を
--   全て詰め込む」ことになり、可読性・保守性の面で案Bのストアド関数と大差ない
--   複雑さになる上、通常の手動完了報告のINSERTパス（4章API仕様.md）にも
--   「via_nfc_tag_idを送らなければ通常経路」という暗黙の分岐がAPI仕様として
--   染み出してしまう（クライアントの実装ミスで空文字列や無効な値を送っても
--   検出できない等、案Aより対応面が増える）。
--
-- [案B（採用）: SECURITY DEFINERのRPCに寄せる]
-- 33d章`draw_gacha()`・33g章`decorate_tree_with_gacha_prize()`・36章
-- `delete_family_board_post()`・38章`edit_unpublished_drawing()`と全く同じ、
-- 「書き込みを伴う複合操作はSECURITY DEFINERのRPCに寄せる」既存パターンを
-- 踏襲する。`report_chore_completion_by_nfc_tag(p_tag_value, p_note)`
-- （39.6章）を新設し、以下を1つの関数呼び出し（＝1トランザクション）に
-- 集約する。
--   1. 呼び出し元のfamily_id/member_idを解決する（ログイン必須）
--   2. p_tag_valueで`chore_nfc_tags`を検索し、有効（revoked_at IS NULL）かつ
--      同じ家族かつ対象クエストが有効（is_active）であることを確認する
--   3. 見つかったchore_id・member_id（＝タグの持ち主）で`chore_completions`
--      へINSERTする
-- **`chore_completions_insert_self`ポリシー自体は一切変更しない**（reported_by
-- =自分自身のみ、のまま）。本RPCはSECURITY DEFINERとして実行されるため、
-- この関数内部のINSERTはRLSではなく関数内の明示的なIF文（39.6章）でのみ
-- ガードされる。つまり「他人名義の完了報告を作れる経路」は、通常のPostgREST
-- 直接INSERT（RLSにより自分自身限定のまま）とは完全に分離された、この1関数
-- だけに限定される。
--
-- [案Bの利点]
--   - **「NFC経由かどうか」の判定が構造的に自明になる。** 通常の完了報告は
--     4章のPostgREST直接INSERT（chore_completions_insert_selfのまま）、
--     代理報告はこのRPCの呼び出し、という呼び出し経路そのものが分岐点になる。
--     RLSポリシーの条件式でNFC経由かどうかを判定するロジックが一切不要。
--   - **「有効なタグを読んだとき」の検証が、実際に読み取ったtag_valueの
--     提示を必須とする形で行われる。** クライアントの自己申告（「NFCタグを
--     読みました」というフラグを立てるだけ）では成立せず、実在する有効な
--     tag_valueを引数として渡さない限り、RPCは0行（39.6章「0件への収束」）を
--     返すだけで完了報告自体が作られない。
--   - **同一トランザクション内でタグの有効性確認とINSERTが行われる。**
--     38.2章「危険1」で述べた「2回の独立した呼び出しの間にトランザクション
--     境界が無い」問題（クライアントが先にタグ検索→後で別途INSERT、という
--     2ステップ方式だと、その間にタグが解除される競合が起こり得る）が構造的に
--     発生しない。
--   - **既存のdaily_limitチェック・自分専用chore作成者チェック（21a章）を
--     そのまま再利用できる。** RPC内部のINSERT文はchore_completions_before_
--     insertトリガー（5a・21a章）をそのまま発火させるため、要件定義書07-2章
--     「既存ルールの適用（NFC読み取りは入力手段が変わるだけ）」を、ロジックの
--     二重実装なしに満たせる。
--
-- [案Bの欠点・留意点]
--   - RPC呼び出し1回で完結するため、通常の完了報告（PostgREST直接INSERT）と
--     比べてクライアントの実装が変わる（`.insert()`ではなく`.rpc()`呼び出しに
--     なる。API仕様.md 4a章で明記）。
--   - SECURITY DEFINER関数は原則どおり最小権限・入力検証を徹底する必要がある
--     （33d〜38章で繰り返し確認されている一般的な留意点であり、本RPC固有の
--     新しいリスクではない）。
--
-- [家族境界を越えた代理報告が起きないことの確認] 39.6章RPCは
-- `t.family_id = v_caller_family_id`（呼び出し元のfamily_id）で絞り込んで
-- タグを検索するため、他家族のタグのtag_valueを（どうにかして）入手して
-- 呼び出しても0行に収束する。要件定義書05章申し送り事項の必須条件
-- 「家族をまたいだ代理報告（他家族のタグの持ち主になりすます等）は既存の
-- family_id = current_family_id()条件により引き続き不可のままとする」を満たす。
--
-- [結論] 案B（SECURITY DEFINERのRPC）を採用し、案Aは却下する。企画部の推奨
-- （要件定義書05章申し送り事項）とも一致する。
--
-- ------------------------------------------------------------
-- 39.6 report_chore_completion_by_nfc_tag()（代理報告RPC本体）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_chore_completion_by_nfc_tag(
  p_tag_value TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE (
  completion_id UUID,
  chore_id UUID,
  chore_title TEXT,
  chore_emoji TEXT,
  points INT,
  member_id UUID,
  member_display_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_family_id UUID := current_family_id();
  v_caller_member_id UUID := current_family_member_id();
  v_chore_id UUID;
  v_owner_id UUID;
  v_title TEXT;
  v_emoji TEXT;
  v_points INT;
  v_new_id UUID;
BEGIN
  IF v_caller_family_id IS NULL OR v_caller_member_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_tag_value IS NULL OR char_length(trim(p_tag_value)) = 0 THEN
    RETURN; -- 0行（下記と同じ収束先）
  END IF;

  -- [0件への収束・多層防御] タグ未登録／他家族のタグ／解除済みタグ／削除済み
  -- クエストのタグのいずれであっても、以下1本のクエリで単一の「0件」に収束
  -- させる（4章・API仕様.md 4a節の既存の設計思想をそのままRPC内に持ち込む。
  -- 開発部はC14相当の表示分岐を「取得できたか／できなかったか」の1点のみで
  -- 実装できる）。呼び出し元のfamily_idで絞り込むのは多層防御であり、
  -- tag_valueがグローバル一意（uq_chore_nfc_tags_tag_value）である以上本来は
  -- 不要だが、4章`chores.nfc_tag_id`と同じ設計判断を踏襲する。
  SELECT t.chore_id, t.member_id, c.title, c.emoji, c.points
    INTO v_chore_id, v_owner_id, v_title, v_emoji, v_points
  FROM chore_nfc_tags t
  JOIN chores c ON c.id = t.chore_id
  WHERE t.tag_value = p_tag_value
    AND t.family_id = v_caller_family_id
    AND t.revoked_at IS NULL
    AND c.is_active;

  IF NOT FOUND THEN
    RETURN; -- 0行
  END IF;

  -- [代理報告の核心] reported_byはタグの持ち主（v_owner_id）であり、呼び出し
  -- 本人（v_caller_member_id）ではない場合がある（＝代理報告）。本INSERTは
  -- SECURITY DEFINERの実行コンテキスト内で行われるため
  -- chore_completions_insert_self（reported_by=自分自身のみ）のRLSは評価
  -- されずバイパスされるが、**そのRLSポリシー自体は一切変更していない**
  -- （39.5章）。trg_chore_completions_before_insert（5a・21a章）はRLSとは
  -- 独立してそのまま発火し、family_id/chore_title/chore_emoji/pointsの自動
  -- 補完・実行回数上限チェック・自分専用choreの作成者チェックを行う
  -- （33d章draw_gacha()と同じ「トリガーはRLSバイパスの影響を受けない」性質を
  -- 利用する）。上限超過時はここで例外が飛び、本関数全体がロールバックされる。
  INSERT INTO chore_completions (chore_id, reported_by, note)
  VALUES (v_chore_id, v_owner_id, p_note)
  RETURNING id INTO v_new_id;

  RETURN QUERY
  SELECT v_new_id, v_chore_id, v_title, v_emoji, v_points, v_owner_id, fm.display_name
  FROM family_members fm
  WHERE fm.id = v_owner_id;
END;
$$;

COMMENT ON FUNCTION public.report_chore_completion_by_nfc_tag(TEXT, TEXT) IS
  '要件定義書07-2章「作り直し：タグの人ごと化」。tag_valueから有効なchore_nfc_tags行を解決し、タグの持ち主（member_id）名義でchore_completionsへ完了報告する（代理報告）。chore_completions_insert_selfポリシーは変更せず、本RPC（SECURITY DEFINER）のみが代理報告の入口になる（39.5章の設計判断）。未登録／他家族／解除済み／削除済みクエストのタグはいずれも0行に収束する（39.6章）。EXECUTE権限は39.7章参照。';

-- ------------------------------------------------------------
-- 39.7 EXECUTE権限
-- ------------------------------------------------------------
-- draw_gacha()・edit_unpublished_drawing()等と同じ扱いとする。33g章の教訓
-- （PUBLICからのREVOKEだけではSupabaseが直接付与するanonのEXECUTEは消えない）
-- を踏まえ、anonを明示的にREVOKEの対象に含める。
REVOKE ALL ON FUNCTION public.report_chore_completion_by_nfc_tag(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_chore_completion_by_nfc_tag(TEXT, TEXT) TO authenticated;
