-- ============================================================
-- メダルの形「花」の表示名を「ちいさなはな」→「おはな」に変更（2026-09-09）
-- ============================================================
-- 参照:
--   統括の提案「メダルのちいさな花を一輪の花にかえるのはどうかな」
--   → 本部長が「小さな花」は絵と合っていないと同意（メダルは4種とも同じ大きさで、
--     花だけ「小さな」と名乗る理由が無い。カブトムシ・ちょうちょ・ドラゴンは
--     大きさを言っていない）
--   → 統括「はなでお願いします。一輪は不要」
--   → 統括「おはなはどうかな？」→ 本部長が同意し「おはな」に確定。
--
-- [「おはな」を選んだ理由]
--   ひらがなの「はな」は**鼻とも読める**。「どうのはな」だと絵を見る前は何のことか
--   分からない。「おはな」なら花のほうに寄る。子どもへの語りかけとしても自然。
--   カブトムシやドラゴンに「お」が付かないのは不揃いではなく、「おはな」「おみず」の
--   ように、お が自然に付く言葉と付かない言葉があるだけである。
--
-- [変更するもの・しないもの]
--   変更する: sticker_catalog.display_name の4行のみ（shape='flower'）。
--   変更しない:
--     - shape の値（'flower'）。画像のファイル名（flower_bronze.png 等）と
--       結びついているため、触ると画像が出なくなる
--     - sticker_key（'flower_bronze' 等）。UNIQUE制約があり、他から参照されうる
--     - 画像そのもの
--
-- [アプリ側] `src/components/StickerShopPanel.tsx`・`CollectorShelfPanel.tsx` の
--   shapeLabel も同じコミットで「おはな」に揃える（大人向け・子ども向けとも同一）。
-- ============================================================

-- 事前確認: 対象が4行であること（想定と違えば中断する）
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM sticker_catalog WHERE shape = 'flower';
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'shape=flower の行が % 件です。想定（4件）と異なるため中断します。', v_count;
  END IF;
END $$;

UPDATE sticker_catalog SET display_name = 'どうのおはな'        WHERE sticker_key = 'flower_bronze';
UPDATE sticker_catalog SET display_name = 'ぎんのおはな'        WHERE sticker_key = 'flower_silver';
UPDATE sticker_catalog SET display_name = 'きんのおはな'        WHERE sticker_key = 'flower_gold';
UPDATE sticker_catalog SET display_name = 'クリスタルのおはな'  WHERE sticker_key = 'flower_crystal';

-- 事後確認: 「ちいさなはな」が残っていないこと
DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM sticker_catalog WHERE display_name LIKE '%ちいさなはな%';
  IF v_count <> 0 THEN
    RAISE EXCEPTION '「ちいさなはな」を含む行が % 件残っています。想定外です。', v_count;
  END IF;

  SELECT count(*) INTO v_count FROM sticker_catalog WHERE display_name LIKE '%おはな%';
  IF v_count <> 4 THEN
    RAISE EXCEPTION '「おはな」を含む行が % 件です。想定（4件）と異なります。', v_count;
  END IF;
END $$;
