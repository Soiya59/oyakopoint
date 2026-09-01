-- ============================================================
-- 家族の書き込みボードのリアクションを「LINE風（個数表示）」へ作り直す
-- （統括フィードバック2026-09-01「押しても相手に伝わっていない。完了報告みたいに
--   複数クリックできる感じでも良い。一覧に他人の反応を出してよい。LINEみたいに
--   個数もわかる感じで」を受けた改訂）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 05章「family_board_reactions」2026-09-01改訂・再改訂
--   企画部/成果物/要件定義書.md 07-14章「リアクション（スタンプ）の追加」2026-09-01改訂・再改訂
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 22.0節決定9・決定10・22.2.1節
--   開発部/成果物/実装メモ.md 103章（旧仕様）・104章（本改訂）
--
-- [本ファイルの位置づけ] 20260901160000_family_board_reactions.sql は本番適用済み
-- （実装メモ.md 103章「統括の許可を得て適用した」）のため、当該ファイル自体は編集しない。
-- 本ファイルはその後続の差分マイグレーションとして新規に作成する。
--
-- [破壊性の確認・実装メモ.md 104章に詳細記録]
-- 一意制約の張り替え（(post_id, reactor_member_id) → (post_id, reactor_member_id,
-- stamp_key)）は、列を1つ追加して制約を「緩める」変更であり、既存の一意制約を
-- 満たしていた行は新しい制約も自動的に満たす（列を絞り込む方向の変更ではないため、
-- 既存データがこの変更単体で制約違反になることは無い）。本番には現時点で
-- family_board_reactions が1行のみ存在する（ジィジの投稿に統括が押した😊）ことを
-- 確認済みであり、この1行のみであっても・複数行であっても、この変更は非破壊である。
--
-- [本マイグレーションの適用範囲についての重要な注意]
-- **本マイグレーションは作成のみであり、適用（`npx supabase db push`）はしない。**
-- 適用は統括の操作を待つ（開発部/成果物/実装メモ.md 104章参照）。
-- ------------------------------------------------------------


-- ------------------------------------------------------------
-- 1. 一意制約の張り替え: (post_id, reactor_member_id) → (post_id, reactor_member_id, stamp_key)
-- ------------------------------------------------------------
-- 要件定義書07-14章「上限」2026-09-01改訂: 「完了報告みたいな感じで、複数クリック
-- できる感じでも良い」との統括指摘を踏まえ、chore_reactionsの一意制約
-- `(completion_id, reacted_by, stamp_key)`と同じ形に揃える。1人が同じ投稿に対して
-- 4種類のスタンプすべてを送れるようになる（同じ種類を重ねて押した場合は1件に収束）。
ALTER TABLE family_board_reactions
  DROP CONSTRAINT IF EXISTS uq_family_board_reactions_post_reactor;

ALTER TABLE family_board_reactions
  ADD CONSTRAINT uq_family_board_reactions_post_reactor_stamp
  UNIQUE (post_id, reactor_member_id, stamp_key);


-- ------------------------------------------------------------
-- 2. SELECTポリシーの置き換え: 「閲覧者自身の行のみ」→「家族全員が読める」
-- ------------------------------------------------------------
-- [判断: ポリシー名を改名する（実装メモ.md 104章に判断理由を記録）]
-- 旧ポリシー名`family_board_reactions_select_own`は「本人の行のみ」という定義の
-- 実態を表した名前だったが、本改訂で定義そのものが「家族全員」に変わるため、
-- 名前を実態に合わせて`family_board_reactions_select_same_family`へ改名する
-- （chore_reactionsの既存の同種ポリシー`chore_reactions_select_same_family`と
-- 命名パターンを揃える。既存の命名規則との一貫性を優先した）。
-- 名前を変えずに定義だけ差し替える選択肢もあったが、「_select_own」という名前を
-- 残したまま「家族全員が読める」定義にすると、将来この関数を読む人（本部長・
-- 他の部員）が名前から誤った権限範囲を推測してしまうリスクのほうが、
-- 名前を変えることによるコスト（rls_checks.sqlのS3照合行の付け替え）より
-- 大きいと判断した。
--
-- 企画部要件定義書05章「family_board_reactionsのSELECTは、投稿者・反応者による
-- 絞り込みをせず、完了報告chore_reactionsと同じく家族全員が読める形に戻すこと。
-- 具体的には、読み取り条件をfamily_id = current_family_id()（家族単位の分離のみ）
-- とする」に対応する。
DROP POLICY IF EXISTS "family_board_reactions_select_own" ON family_board_reactions;
DROP POLICY IF EXISTS "family_board_reactions_select_same_family" ON family_board_reactions;
CREATE POLICY "family_board_reactions_select_same_family" ON family_board_reactions
  FOR SELECT
  USING (family_id = current_family_id());

-- INSERTポリシー・自己リアクション禁止トリガー・UPDATE/DELETEポリシーを作らない方針は
-- 変更しない（要件定義書07-14章「取消の可否」「自分の投稿への自己リアクション」は
-- 今回も変更が無いため）。family_board_reactions_insert_self・
-- trg_family_board_reactions_before_insert はいずれもそのまま。

COMMENT ON TABLE family_board_reactions IS
  '要件定義書07-14章「リアクション（スタンプ）の追加」2026-09-01再改訂。家族の書き込みボード投稿への一方向ポジティブなスタンプリアクション（chore_reactionsと同じStrava Kudos型、取消不可）。保護者・子ども・みまもりメンバーの3ロールが対等に送れる（自分の投稿を除く）。スタンプの種類ごとに1個まで＝1人が最大4種類送れる（uq_family_board_reactions_post_reactor_stamp）。SELECT RLSは家族全員の行を返す（主要画面ワイヤーフレーム.md 22.0節決定10「LINE風の個数表示」に対応するため、2026-09-01付で閲覧者自身の行のみ→家族全員へ変更）。';
