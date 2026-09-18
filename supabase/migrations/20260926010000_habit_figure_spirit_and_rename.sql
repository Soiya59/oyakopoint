-- ============================================================
-- 習慣カードの「種類」に「星の精霊」を追加し、呼び名を「シール帳」に統一する
-- （やること.md 2-50、要件定義書07-28章、実装メモ249章）
--
-- 【2026-09-18・統括】
--  1. 統括が3つ目の種類「星の精霊」の絵を4段階ぶん制作した。
--     設計部55.2章の決定どおり、**このカタログに4行INSERTするだけで種類が増える**
--     （kind_keyにCHECK IN(...)を置いていないため、DDLの変更は不要）。
--  2. 呼び名を「台紙」から「シール帳」に改める（統括指示「台帳でなく、シール帳に
--     してね」）。UI側の文言は別途アプリのコードで直すが、DBに持っている
--     kind_display_nameもここで揃える。
--
-- 破壊的変更ではない（INSERTとUPDATEのみ。既存の habit_cards・
-- habit_figure_grants の行には触れない）。
-- ============================================================

-- (1) 既存2種類の呼び名を「◯◯台紙」→「◯◯のシール帳」に
UPDATE habit_figure_catalog SET kind_display_name = 'ドラゴンのシール帳' WHERE kind_key = 'dragon';
UPDATE habit_figure_catalog SET kind_display_name = 'うさぎのシール帳'   WHERE kind_key = 'rabbit';

-- (2) 3つ目の種類「星の精霊」を追加
--     figure_key は画像アセット（assets/figures/figure_spirit_*.png）と対応させる。
INSERT INTO habit_figure_catalog (kind_key, kind_display_name, kind_emoji, tier, figure_key, display_name, sort_order) VALUES
  ('spirit', '星の精霊のシール帳', '⭐', 'bronze',  'figure_spirit_bronze',  'どうのせいれい',       3),
  ('spirit', '星の精霊のシール帳', '⭐', 'silver',  'figure_spirit_silver',  'ぎんのせいれい',       3),
  ('spirit', '星の精霊のシール帳', '⭐', 'gold',    'figure_spirit_gold',    'きんのせいれい',       3),
  ('spirit', '星の精霊のシール帳', '⭐', 'crystal', 'figure_spirit_crystal', 'クリスタルのせいれい', 3)
ON CONFLICT (figure_key) DO NOTHING;
