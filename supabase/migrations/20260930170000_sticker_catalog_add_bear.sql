-- ============================================================
-- メダル（入れ替え後の呼び名「フィギュア」）の新しい形「くま」をカタログに
-- 追加する（本部長指示・2026-09-25、統括が原画〈銅・銀・金・クリスタル〉を制作）
-- ============================================================
-- 参照:
--   開発チームのやること.md 4-75（ポイントで買う側の絵文字🪙を🧸に替える。
--   統括決定「くまのフィギュアを作ったら替える」）
--   開発部/成果物/実装メモ.md 304章（本migrationの章）
--   前例: supabase/migrations/20260917010000_sticker_catalog_add_dragon.sql
--   （実装メモ177章）。本migrationは177章と同じ手順を踏襲する。
--
-- 前提（本部長が実コードで確認済み・2026-09-25）:
--   `assets/stickers/`に`bear_bronze/silver/gold/crystal`と各`@sm`版（計8枚）、
--   `assets/figures/`に`figure_bear_bronze/silver/gold/crystal`（計4枚）が
--   既に揃っている（統括の原本`figure_collection/bear/0N_*.jpg`をPIL変換）。
--   現行のカタログ（20260917010000時点）は16行（形4種=beetle/butterfly/
--   flower/dragon×レアリティ4段）。
--
-- 破壊性:
--   (1) `sticker_catalog_shape_check`（CHECK制約）を張り替える。
--       `ARRAY['beetle','butterfly','flower','dragon']`→
--       `ARRAY['beetle','butterfly','flower','dragon','bear']`。既存16行は
--       一切書き換えない（値の追加のみ、削除・変更なし）。177章と同じ理由で
--       DROP→ADD→INSERTの順序で問題ない（今回もUPDATEではなくINSERTが新しい
--       値を使う側のため）。
--   (2) `sticker_catalog`へ4行INSERT（bear×bronze/silver/gold/crystal）。
--       既存16行は一切変更しない。
--
-- 価格・命名の流儀: 既存4形と同じ 銅10／銀30／金50／クリスタル100pt。
--   `display_name`は既存の「レアリティ＋の＋形」の並び（どうの◯◯／
--   ぎんの◯◯／きんの◯◯／クリスタルの◯◯）を踏襲し、◯◯は「くま」
--   （ひらがな）とした。「くま」は和語で自然なひらがな表記があるため、
--   カブトムシ・ちょうちょ・おはなと同じくひらがな寄りの表記にする
--   （ドラゴン・クリスタルを外来語としてカタカナにした177.1章・173.3章の
--   判断とは逆の理由づけで、一貫している）。
--
-- 段階購入制・月次購入上限撤廃は、いずれも`sticker_key`・`display_name`の
-- 追加ではなく`shape`カラムをキーにEXISTS判定する既存の`purchase_sticker(UUID)`
-- ロジックがそのまま機能する（177章で確認済みの一般化された条件、今回も
-- 変更不要）。追加直後は「くまの銅だけ買える、他3つは家族解放待ちで買えない」
-- が期待動作になる。
--
-- 新しい表は作っていないため、開発部CLAUDE.md「新しい表を作るときのGRANT」
-- （2026-09-25新設）は本migrationには適用対象外（既存表へのALTER・INSERTのみ）。
--
-- 既存の適用済みマイグレーションファイルは書き換えない（経緯が読めなくなる
-- ため。173章・176章・177章と同じ方針）。
--
-- [本部長への申し送り・2026-09-25時点] 本ファイルはローカル未適用・本番未適用
-- （作成のみ）。ローカルへの適用（`npx supabase db push --local`または
-- `npx supabase start`後の自動適用）と、`supabase/tests/rls_checks.sql`の
-- 全件PASS確認は次の作業として残っている（実装メモ304章に明記）。
-- ============================================================


-- ------------------------------------------------------------
-- 1. CHECK制約を張り替える
-- ------------------------------------------------------------
ALTER TABLE sticker_catalog DROP CONSTRAINT IF EXISTS sticker_catalog_shape_check;

ALTER TABLE sticker_catalog ADD CONSTRAINT sticker_catalog_shape_check
  CHECK (shape IN ('beetle', 'butterfly', 'flower', 'dragon', 'bear'));


-- ------------------------------------------------------------
-- 2. くま4段階をINSERT
-- ------------------------------------------------------------
INSERT INTO sticker_catalog (shape, rarity, sticker_key, display_name, points_cost) VALUES
  ('bear', 'bronze',  'bear_bronze',  'どうのくま',       10),
  ('bear', 'silver',  'bear_silver',  'ぎんのくま',       30),
  ('bear', 'gold',    'bear_gold',    'きんのくま',       50),
  ('bear', 'crystal', 'bear_crystal', 'クリスタルのくま', 100)
ON CONFLICT (sticker_key) DO NOTHING;
