-- ============================================================
-- シール帳のメダルの絵柄「星の精霊」を「とり」に差し替える
-- （統括決定・2026-09-26「星の精霊の入れ替えは、とり」、実装メモ310章）
-- ============================================================
-- [背景] メダルは丸いコインの絵（src/components/StickerIcon.tsx の
-- ORNAMENT_CIRCLE_IMAGES）で表示する。星の精霊にはコインの絵が無く、⭐の
-- 絵文字で出ていた（統括「星の精霊のシール帳はないね。違うやつに変えたい」）。
-- とりのコインの絵は assets/stickers/bird_*.png に既にある。
--
-- [やり方] 行を増やしたり消したりせず、kind_key='spirit' の4行の表示名・
-- 絵文字・figure_key だけを書き換える（統括承認の「絵だけ差し替える」案）。
-- kind_key は 'spirit' のまま残す。habit_cards.kind_key と
-- habit_figure_grants.figure_catalog_id は、この行をそのまま指し続けるので、
-- 今この絵柄を使っている人（本番で3人・メダル1枚、2026-09-26本部長が確認）の
-- シール帳ともらったメダルは、そのまま「とり」に変わる。
--
-- 破壊性: 非破壊的（表示用の列の値を書き換えるだけ。行・制約・関数・権限は触らない）。
-- figure_key は UNIQUE。'figure_bird_*' はほかの行で使われていない。
-- 新しい表は無いので GRANT は不要。rls_checks の期待値も変わらない。
-- ============================================================

UPDATE habit_figure_catalog
SET
  kind_display_name = 'とりのシール帳',
  kind_display_name_child = 'とりの シールちょう',
  kind_emoji = '🐦',
  figure_key = 'figure_bird_' || tier,
  display_name = CASE tier
    WHEN 'bronze' THEN 'どうのとり'
    WHEN 'silver' THEN 'ぎんのとり'
    WHEN 'gold' THEN 'きんのとり'
    WHEN 'crystal' THEN 'クリスタルのとり'
  END
WHERE kind_key = 'spirit';
