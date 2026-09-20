-- ============================================================
-- member_blocks（ブロック＝相手の言葉を自分の画面に出さない）— 新設・2026-09-20
-- 参照: 設計部/成果物/スキーマ設計.sql 69章
-- 要件定義書 07-32章（決定11〜14。07-32-4・07-32-8の(3)）
-- ============================================================
-- [この回の位置づけ] 本部長依頼により、開発部が本日先に書いた4本
-- （content_reports・hidden_contents・保護者トグル・gratitude_points.noteの
-- NULL許容。20260930010000〜20260930040000）と同じ適用ラウンドに、5本目として
-- 合流させる（本番適用・統括の承認をいずれも1回で済ませるため。設計部69.6章）。
--
-- [統括の条件（先に）] 「非表示機能は本当にいるのか？家族内だよ」「iosもGoogleの
-- 記載の両方」「ほんとに最低限でよい」（2026-09-20）。本章は決定11〜14の範囲を
-- 超えない。新しい判定ロジック・新しい画面・新しい列は足さない。RLSも
-- 「新規テーブル自身の最小限のポリシー」以外は一切増やさない（既存4テーブルの
-- RLSは1つも触らない。設計部69.2章で確認済み）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. member_blocks テーブル（スキーマ設計.sql 69.1章）
-- ------------------------------------------------------------
-- [外部キーの方針] `family_members`を参照する列が2本
-- （blocker_member_id・blocked_member_id）あるが、**いずれもRESTRICTにしない**。
-- この表は会計・履歴の当事者を物理削除させないための記録ではなく、
-- chore_daily_flags（17章）やpush_tokens（10章）と同じ個人設定であるため。
-- したがって両方ともON DELETE CASCADEにする（family_idも同様）。
-- RESTRICTの本数は増えない。
CREATE TABLE IF NOT EXISTS member_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,

  -- 非表示にする側（設定した人）。
  blocker_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  -- 非表示にされる側（対象）。この人が書いた言葉が、blocker側の画面に
  -- 出なくなる。この人自身の画面・記録・ポイント・木には一切影響しない。
  blocked_member_id UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 自分自身を対象にできない（決定12「自分自身は対象外」）。
  CONSTRAINT chk_member_blocks_not_self CHECK (blocker_member_id <> blocked_member_id),
  -- 同じ組み合わせの重複を許さない（07-32-8の(3)）。2度押しても1行のまま。
  CONSTRAINT uq_member_blocks_pair UNIQUE (blocker_member_id, blocked_member_id)
);

CREATE INDEX IF NOT EXISTS idx_member_blocks_family_id ON member_blocks(family_id);
-- 「自分がブロックしている一覧」を引く経路（クライアントが毎回使う）。
CREATE INDEX IF NOT EXISTS idx_member_blocks_blocker ON member_blocks(blocker_member_id);

ALTER TABLE member_blocks ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE member_blocks IS
  '要件定義書07-32章 決定11〜14「ブロック」。相手を遮断するのではなく、相手が
   書いた言葉を自分の画面に出さないだけの機能（決定11）。効果はクライアント側の
   取得後フィルタで作る（設計部69.2・69.4章）——既存の各テーブルのRLSは
   一切変更しない（決定14）。誰が誰をブロックしているかを家族全員に見せる
   一覧は作らない（決定11）。';

COMMENT ON COLUMN member_blocks.blocker_member_id IS
  '非表示にする側（設定した人）。current_family_member_id()と一致する行のみ、
   本人がSELECT・DELETEできる（下記RLS）。';
COMMENT ON COLUMN member_blocks.blocked_member_id IS
  '非表示にされる側（対象）。この人自身は、自分がblocked_member_id側に
   入っている行を読めない——「誰が自分を非表示にしているか」は本人にも
   見せない設計にしてある（決定11「相手には一切伝わらない」）。';

-- ------------------------------------------------------------
-- 2. RLS（スキーマ設計.sql 69.3章。新規テーブル自身の最小限のポリシーだけ）
-- ------------------------------------------------------------
-- [設計部の判断・★07-32-13の未決事項1番への回答]
--   要件定義書07-32-4「決定13」（保護者が「誰が誰を非表示にしているか」を
--   見られるか）はまだ確定していない未決事項である。本章ではSELECTを
--   「本人の行だけ」に絞る、より狭いほうを設計として採用する。
--   「同じ家族の保護者」を無条件でORすると、content_reports（65章・07-32-0c）が
--   実際に踏んだ構造上の破れと同じ形の問題が起きる——子どもが保護者Aを
--   非表示にした場合、is_current_user_parent()をORで足すと保護者A自身が
--   「自分が非表示にされている」行を読めてしまい、決定11「相手には一切
--   伝わらない」と正面から矛盾する。決定13が確定するまでは本人限定
--   （安全側）にしておく。決定13が「保護者は見られる」で確定した場合の
--   拡張手順は設計部スキーマ設計.sql 69.3章末尾のコメントを参照。
DROP POLICY IF EXISTS "member_blocks_select_own" ON member_blocks;
CREATE POLICY "member_blocks_select_own" ON member_blocks
  FOR SELECT
  USING (blocker_member_id = current_family_member_id());

-- 設定（ブロックする）は本人のみ。family_idもblocker_member_idもなりすませない。
DROP POLICY IF EXISTS "member_blocks_insert_own" ON member_blocks;
CREATE POLICY "member_blocks_insert_own" ON member_blocks
  FOR INSERT
  WITH CHECK (
    family_id = current_family_id()
    AND blocker_member_id = current_family_member_id()
    -- 対象が同じ家族のメンバーであることを確認する（他家族のUUIDを
    -- 渡す攻撃を防ぐ）。
    AND EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = blocked_member_id AND fm.family_id = current_family_id()
    )
  );

-- 解除（いつでも自分で解除できる。決定11）は本人のみ。
DROP POLICY IF EXISTS "member_blocks_delete_own" ON member_blocks;
CREATE POLICY "member_blocks_delete_own" ON member_blocks
  FOR DELETE
  USING (blocker_member_id = current_family_member_id());

-- [重要] UPDATEポリシーは意図的に置かない。設定の変更は「解除してから作り直す」
-- （DELETE→INSERT）だけで足りる単純な表であり、更新できる列も無い。RLS有効時、
-- 対応するポリシーが1本も無いコマンドは常に拒否される（デフォルト拒否）。

-- ------------------------------------------------------------
-- 3. 書き込み経路について（SECURITY DEFINER関数は新設しない）
-- ------------------------------------------------------------
-- [2026-09-20訂正・本部長からの当日指示] 07-32-7（子どもの画面には報告・
-- ブロックの導線を置かない）と07-32-9（子どもの画面にも隠す操作導線を出す）
-- が矛盾しており、本部長の判断で07-32-7が正となった。**ブロックを「送る側」
-- として操作できるのは保護者とみまもりメンバーのみで、子どもは操作できない**
-- （ブロックされる側に子どもが含まれることは変わらない）。**この制限はDB・
-- RLSでは強制しない**（下記のとおりRLSは3ロールとも自分の行を読み書き
-- できる設計のまま）。子ども用の画面自体を作らないため実質到達しないことと、
-- 「最低限でよい」という統括の条件に沿い、DB側に子ども判定のロジックを
-- 追加で持たせないため。制限はアプリ側（`src/data/store.tsx`の
-- `blockMember`/`unblockMember`）が持つ。
--
-- 決定14がクライアント側フィルタでよいとした前提のうえでは、このテーブル
-- 自体の書き込みに複雑な検証が要らない。INSERT/SELECT/DELETEのいずれも
-- 上記RLSポリシーの範囲で、PostgRESTの直接操作
-- （`supabase.from('member_blocks')...`）で完結する（RLS上は3ロールとも
-- 自分の行を直接読み書きできる。決定12。上記訂正のとおり、実際に送る側の
-- 操作を行うのは保護者・みまもりメンバーのみ）。「最低限でよい」という統括の条件に照らし、
-- 関数を1本も増やさない（設計部69.5章）。
