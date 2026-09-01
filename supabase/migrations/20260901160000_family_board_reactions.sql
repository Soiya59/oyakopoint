-- ============================================================
-- 家族の書き込みボードへのリアクション（スタンプ）新設
-- （要件定義書07-14章「リアクション（スタンプ）の追加」2026-09-01改訂・
--   主要画面ワイヤーフレーム.md 22.0節決定8・22.2.1節、2026-09-01）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 05章「family_board_reactions（新規、2026-09-01追加）」
--   企画部/成果物/要件定義書.md 07-14章「リアクション（スタンプ）の追加」
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 22.0節決定8・22.2.1節
--   開発部/成果物/実装メモ.md 103章
--
-- [設計方針] chore_reactions（20260815093520_initial_schema.sql:823-898）の設計
-- パターンをそのまま踏襲する（本部長指示）。異なる点は以下のみ:
--   (a) 対象がchore_completionsではなくfamily_board_posts
--   (b) 種類はstamp固定（comment相当は無い。07-14章「コメント（返信）は対象外」）
--   (c) 誰が誰に送れるかが3ロール対等・非対称制限なし（chore_reactionsは保護者限定＋
--       子どもは保護者の完了報告にのみ、という非対称制限を持つが、07-14章「誰が誰に
--       送れるか」はこの制限が掲示板には当てはまらないと明記している）
--   (d) 1人1投稿1スタンプまで（chore_reactionsは1人が複数種のスタンプを送れるが、
--       本テーブルは(post_id, reactor_member_id)の一意制約で1件のみに制限する）
--   (e) 自己リアクション禁止のチェックが必要（chore_reactionsには対象外の検討記録が
--       あるのみで実装されていないが、07-14章は本テーブルに必須要件として明記している）
--
-- [破壊性] 非破壊的な変更のみ。新規テーブル1件（family_board_reactions）・
--   新規トリガー1件（同テーブルへのBEFORE INSERT）・新規関数1件
--   （family_board_reactions_before_insert）の追加のみで、既存テーブル・既存関数への
--   変更は一切無い。
--
-- [本ファイルの適用範囲についての重要な注意]
-- **本マイグレーションは作成のみであり、適用（`npx supabase db push`）はしない。**
-- 適用は統括の操作を待つ（開発部/成果物/実装メモ.md 103章参照）。
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- 1. CREATE TABLE
-- ------------------------------------------------------------
-- [列設計の判断]
--   - family_id: クライアントを信用せず、下記トリガーが対象投稿
--     （family_board_posts）から自動補完する（chore_reactions_before_insertと
--     同じ「改ざん防止」パターン。author_member_idの家族ではなく、対象投稿の
--     家族から補完する点に注意。post_idの検証と同時に行うため）。
--   - stamp_key: chore_reactions.stamp_keyと同じくTEXT（enumではない）。理由も同じ
--     （企画部要件定義書05章「chore_reactions.stamp_keyと同じ4値を初期セットとして
--     流用することを企画部として推奨する」。将来スタンプの種類を追加・変更しても
--     マイグレーション無しでクライアント側の選択肢を変更できるようにするため）。
--     kind列は作らない（chore_reactionsと異なり本テーブルはstamp専用でcomment相当が
--     存在しないため、kind/comment_bodyの列自体が不要）。
--   - 取消不可（07-14章「取消の可否」）: UPDATE/DELETEポリシーを一切作らない
--     （chore_reactionsと同じ、下記2.参照）。取消不可のためdeleted_at等の削除系
--     列も不要（企画部要件定義書05章の申し送りどおり）。
--   - 一意制約 (post_id, reactor_member_id): 07-14章「上限」= 1人1投稿1スタンプまで。
--     chore_reactionsの部分ユニークインデックス（stamp_keyまで含めて重複防止）とは
--     異なり、本テーブルはstamp_keyを含めない素の一意制約でよい。複数種類のスタンプを
--     later追加しても「1人1投稿1件」の意味は変わらないため、stamp_keyを含めると
--     かえって「異なるスタンプなら複数送れる」という誤った挙動になってしまう
--     （07-14章「1人1投稿につき1スタンプまで（複数スタンプの重ね送りは不可）」に
--     反する）。
--   - post_idはON DELETE CASCADE。family_board_postsは論理削除のみのため物理削除の
--     経路は無いが（家族の削除カスケード以外では物理削除されない）、chore_reactionsの
--     completion_idと同じ設計判断を踏襲する。
--
-- [論理削除された投稿への新規リアクションの扱い（明示的な決定）]
-- 企画部要件定義書05章「対象投稿が論理削除されている場合は新規リアクションを
-- 受け付けないこと」を、下記4.のBEFORE INSERTトリガーが実現する。
-- トリガー関数はSECURITY DEFINERではないため、対象投稿を検索するSELECTには
-- 呼び出し元（authenticated）のRLSがそのまま適用される。family_board_posts側の
-- SELECTポリシー（family_board_posts_select_same_family）はdeleted_at IS NULLを
-- 常に要求するため、論理削除済みの投稿はこのSELECTで自動的に「見つからない」扱いに
-- なり、トリガーがFOUND判定で例外を送出する。deleted_atを本テーブル側で明示的に
-- 二重チェックする必要はない（RLSによる除外を「新規リアクション拒否」の実装として
-- 積極的に利用する設計判断。詳細は開発部/成果物/実装メモ.md 103章参照）。
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_board_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  post_id UUID NOT NULL REFERENCES family_board_posts(id) ON DELETE CASCADE,
  reactor_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  stamp_key TEXT NOT NULL CHECK (char_length(trim(stamp_key)) BETWEEN 1 AND 50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_family_board_reactions_post_reactor UNIQUE (post_id, reactor_member_id)
);

CREATE INDEX IF NOT EXISTS idx_family_board_reactions_post_id ON family_board_reactions(post_id);
CREATE INDEX IF NOT EXISTS idx_family_board_reactions_family_id ON family_board_reactions(family_id);

ALTER TABLE family_board_reactions ENABLE ROW LEVEL SECURITY;


-- ------------------------------------------------------------
-- 2. RLSポリシー
-- ------------------------------------------------------------
-- [SELECT: 閲覧者自身が送った行のみを返す（重要・必須）]
-- 企画部要件定義書05章「一覧画面での非表示要件（重要・必須）」・
-- UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 22.2.1節「企画部の必須要件との
-- 整合」根拠4「技術的にも、他者の反応情報を一覧取得APIのレスポンスに含めないことを
-- 設計部・開発部への申し送りとする」を受け、**クライアントのクエリ側でフィルタする
-- のではなく、RLSのSELECTポリシー自体で他メンバーの行を返さないようにする**。
--
-- [判断理由（実装メモ.md 103章にも記録）]
--   (a) 「取得はするが画面に出さない」ではなく「そもそも取ってこない」という要件
--       （本部長指示）を、UI側の実装忘れ・クエリ側の条件漏れに依存せず構造的に
--       保証できるのはRLSのみである。クライアントのクエリに`.eq("reactor_member_id",
--       myId)`を書き忘れても、DBが返す行は最初から自分の分しか無い。
--   (b) 一覧取得（fetchFamilyBoardPostsHistory）はfamily_board_postsに
--       family_board_reactionsをネストして取得する形を想定しており（開発部の実装）、
--       クエリ側フィルタだけに頼ると「投稿一覧のembedクエリ」「将来追加されるかも
--       しれない別画面のクエリ」等、呼び出し箇所が増えるたびに同じ条件を書き続ける
--       必要が生じ、1箇所でも書き漏らせば他者の反応者・スタンプ種別が漏洩する
--       （子どものデータを扱うアプリとして採れないリスク）。RLSに1本化すれば
--       呼び出し箇所の数に関わらず安全である。
--   (c) chore_reactionsは`family_id = current_family_id()`のみ（全員の反応が見える）
--       だが、これは07-6章・07-7章が「完了報告一覧に届いたリアクションを添えて表示する」
--       ことを前提要件にしているためであり、07-14章はその逆（一覧には自分の反応状態しか
--       出さない）を必須要件にしている。したがって同じ「chore_reactionsの設計パターンを
--       写す」指示は、SELECTポリシーの条件そのものではなく「テーブル設計・トリガー設計の
--       型」を指すと解釈し、SELECTの絞り込み条件だけは07-14章の要件に合わせて変更した。
DROP POLICY IF EXISTS "family_board_reactions_select_own" ON family_board_reactions;
CREATE POLICY "family_board_reactions_select_own" ON family_board_reactions
  FOR SELECT
  USING (family_id = current_family_id() AND reactor_member_id = current_family_member_id());

-- [INSERT] family_board_posts_insert_self・chore_reactions_insert_scopedと同じ型。
-- 家族の壁（family_id）・なりすまし防止（reactor_member_id = 呼び出し本人）のみを
-- ここで強制する。自己リアクション禁止・対象投稿の存在確認（論理削除済み投稿の拒否）は
-- 下記4.のBEFORE INSERTトリガーが担当する（family_id自体もトリガーが対象投稿から
-- 補完するため、ここでの`family_id = current_family_id()`はトリガー確定後の値に対する
-- 二重チェックとして機能する。family_board_posts_insert_selfと同じ設計）。
DROP POLICY IF EXISTS "family_board_reactions_insert_self" ON family_board_reactions;
CREATE POLICY "family_board_reactions_insert_self" ON family_board_reactions
  FOR INSERT
  WITH CHECK (family_id = current_family_id() AND reactor_member_id = current_family_member_id());

-- UPDATE/DELETEポリシーは作らない（07-14章「取消の可否」＝取り消せない。
-- chore_reactionsと同じ設計判断。UPDATE/DELETEの経路自体をRLSレベルで封じることで
-- 「取り消せない」を構造的に保証する）。

COMMENT ON TABLE family_board_reactions IS
  '要件定義書07-14章「リアクション（スタンプ）の追加」。家族の書き込みボード投稿への一方向ポジティブなスタンプリアクション（chore_reactionsと同じStrava Kudos型、取消不可）。保護者・子ども・みまもりメンバーの3ロールが対等に送れる（自分の投稿を除く）。1人1投稿1スタンプまで（uq_family_board_reactions_post_reactor）。SELECT RLSは閲覧者自身が送った行のみを返す（主要画面ワイヤーフレーム.md 22.2.1節「一覧には自分の反応状態のみを表示する」というUI要件を、DB層でも徹底するため）。';


-- ------------------------------------------------------------
-- 3. 自己リアクション禁止・対象投稿の存在確認・family_id自動補完
--    （BEFORE INSERTトリガー）
-- ------------------------------------------------------------
-- [自己リアクション禁止の実装方法についての判断]
-- gratitude_pointsの自己贈呈禁止はテーブル自身の2列同士の比較のため単純なCHECK制約
-- （chk_gratitude_no_self_gift）で実現できたが、本テーブルの自己リアクション判定は
-- 「対象投稿（別テーブル）の投稿者」と「reactor_member_id（自テーブルの列）」の比較の
-- ため、単純なCHECK制約では書けない（他テーブルを参照する式はCHECK制約に使えない）。
-- したがってchore_reactions_before_insert・family_board_posts_before_insertと同じ
-- BEFORE INSERTトリガー（対象行を1回SELECTしてfamily_idを補完する）の中に検証を
-- 追加する形で実装する。
CREATE OR REPLACE FUNCTION public.family_board_reactions_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_family_id UUID;
  v_author_member_id UUID;
BEGIN
  -- family_idはクライアントを信用せず、対象投稿から自動補完する
  -- （chore_reactions_before_insertと同じ「改ざん防止」パターン）。
  -- SECURITY DEFINERではないため、このSELECTには呼び出し元のRLSがそのまま適用される。
  -- family_board_posts_select_same_family（family_id = current_family_id() AND
  -- deleted_at IS NULL）により、他家族の投稿・論理削除済みの投稿はここで
  -- 「見つからない」扱いになる（上記1.のコメント参照。要件定義書05章
  -- 「対象投稿が論理削除されている場合は新規リアクションを受け付けないこと」を
  -- このRLS経由の除外で実現する明示的な設計判断）。
  SELECT family_id, author_member_id INTO v_family_id, v_author_member_id
  FROM family_board_posts
  WHERE id = NEW.post_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象の投稿が見つからないか、すでに削除されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  NEW.family_id := v_family_id;
  NEW.created_at := now();

  -- 自己リアクション禁止（要件定義書07-14章「自分の投稿への自己リアクション」＝不可）。
  -- UI側も自分の投稿にはスタンプボタン自体を表示しない（主要画面ワイヤーフレーム.md
  -- 22.2.1節「自分の投稿での見え方」）が、DB側でも構造的に禁止する（多重防御）。
  IF v_author_member_id = NEW.reactor_member_id THEN
    RAISE EXCEPTION '自分の投稿にはリアクションできません' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_family_board_reactions_before_insert ON family_board_reactions;
CREATE TRIGGER trg_family_board_reactions_before_insert
  BEFORE INSERT ON family_board_reactions
  FOR EACH ROW EXECUTE FUNCTION public.family_board_reactions_before_insert();

-- [権限に関する注意（開発部CLAUDE.md・実装メモ34.3章/77章/78章の教訓）]
-- family_board_reactions_before_insert()はSECURITY DEFINERではないため、
-- 呼び出し元ロール（authenticated）として実行される。本関数はfamily_board_posts
-- テーブルへのSELECTのみを行い、権限付与が必要なヘルパー関数（family_board_posts_
-- daily_used()等）は呼ばないため、追加のGRANT EXECUTEは不要。
-- なお本プロジェクトは新規関数作成時にPUBLIC（延いてはanon/authenticated）へ
-- EXECUTE権限が自動付与される既知の挙動があり（34.5章）、これは他のBEFORE INSERT
-- トリガー関数（chore_reactions_before_insert・family_board_posts_before_insert等）と
-- 同じ扱いのため明示的なREVOKEは行わない（トリガー関数を直接SELECTで呼び出しても
-- NEW/OLDが存在せずエラーになるだけで実害が無いことは既存の同種トリガー関数と同じ）。
-- rls_checks.sql S4の期待値一覧にfamily_board_reactions_before_insertを追加すること
-- （開発部/成果物/実装メモ.md 103章参照）。
