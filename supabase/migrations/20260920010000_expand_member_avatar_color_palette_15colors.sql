-- 本部長からの業務指示（2026-09-11）「メンバーカラーを10色から15色へ増やす」。
-- UIUXデザイン部/成果物/デザイントークン.md 1.3節（2026-09-11改訂・v1.18、決定1〜8）。
-- 開発部/成果物/実装メモ.md 199章。
--
-- 背景: 目的は「選ぶ楽しさ」であり、家族の人数を満たすためではない（統括の
-- ご家族は5人で現行10色でも足りている旨、本部長の業務指示に明記されている）。
-- 新規5色（アイスブルー・セルリアン・ペリウィンクル・オーキッド・ローズ）を
-- 既存10色の末尾に、色相の低い順（デザイントークン.md 決定6）で追加する。
--
-- 本マイグレーションは、2026-09-01付 20260901140000_expand_member_avatar_color_palette.sql
-- が定義した next_member_avatar_color() を、このプロジェクトの方式（既存マイグレーション
-- は書き換えず、新規マイグレーションで CREATE OR REPLACE により打ち消す）に従って
-- 置き換える。あわせてクライアント側 src/theme/theme.ts の memberColorPalette にも
-- 同じ5色を同じ順序で追加済み。片方だけを直すのはこのプロジェクトで繰り返されている
-- 失敗と同型（実装メモ88・89・93・94章の教訓）であるため、theme.tsとこのファイルの
-- 配列は必ず一致させること。
--
-- 破壊性: 非破壊的。CREATE OR REPLACE FUNCTIONによる関数定義の更新のみで、
-- 既存データ（family_members.avatar_color）の値は一切変更しない。
-- 引数・戻り値の型、SECURITY DEFINER・search_path等の属性、既存10色の値・順序も
-- 一切変更しない。効果は「新規に色を採番する際の候補が10色から15色に増える」ことのみ。

CREATE OR REPLACE FUNCTION public.next_member_avatar_color(p_family_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- src/theme/theme.ts memberColorPalette と同じ並び・同じ値で保つこと
  -- （2026-09-01拡張で8→10色、2026-09-11拡張で10→15色）。
  v_palette TEXT[] := ARRAY[
    '#A8D5BA', -- ミントグリーン
    '#FFE5B4', -- ピーチ
    '#B4D4FF', -- スカイブルー
    '#FFC1CC', -- ピンク
    '#D9C2FF', -- ラベンダー
    '#FFF3B0', -- レモン
    '#FFAFA3', -- コーラル
    '#C2F0E8', -- アクアミント
    '#C8E8A8', -- ライム [2026-09-01追加]
    '#F0C2EC', -- モーブ [2026-09-01追加]
    '#ADE6EB', -- アイスブルー [2026-09-11追加]
    '#ADD3EB', -- セルリアン [2026-09-11追加]
    '#B7B6ED', -- ペリウィンクル [2026-09-11追加]
    '#DEB6ED', -- オーキッド [2026-09-11追加]
    '#EDB6D3'  -- ローズ [2026-09-11追加]
  ];
  v_color TEXT;
  v_count INT;
BEGIN
  FOREACH v_color IN ARRAY v_palette LOOP
    IF NOT EXISTS (
      SELECT 1 FROM family_members
      WHERE family_id = p_family_id AND avatar_color = v_color
    ) THEN
      RETURN v_color;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_count FROM family_members WHERE family_id = p_family_id;
  RETURN v_palette[(v_count % array_length(v_palette, 1)) + 1];
END;
$$;

REVOKE EXECUTE ON FUNCTION public.next_member_avatar_color(UUID) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.next_member_avatar_color(UUID) IS
  '同じ家族内で重複しないメンバーカラーを1色返す。15色（デザイントークン.md 1.3節、2026-09-11に10色から拡張）を使い切った場合のみ重複を許容して循環割り当てする。';
