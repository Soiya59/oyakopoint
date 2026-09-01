-- 開発部/成果物/実装メモ.md 100章。UIUXデザイン部/成果物/デザイントークン.md 1.3節（2026-09-01改訂）。
--
-- 背景: 実装メモ99章の調査で、本番家族（在籍6人・退会4人）が8色のメンバーカラー
-- パレットを使い切り、在籍中の2人（ちひろ・ばあば）が同じミントグリーンになっていた
-- ことが判明した。統括判断（2026-09-01）により、お絵かきパレットは増やさないが
-- メンバーカラーは8色→10色に拡張することが決まった（新色: ライム#C8E8A8、
-- モーブ#F0C2EC。選定根拠はデザイントークン.md 1.3節参照）。
--
-- 本マイグレーションは、クライアント側 src/theme/theme.ts の memberColorPalette に
-- 追加した2色を、DB側の色採番関数 next_member_avatar_color() の配列にも同じ順序・
-- 同じ値で追加する。片方だけを直すのはこのプロジェクトで繰り返されている失敗と
-- 同型（実装メモ88・89・93・94章の教訓）であるため、theme.tsとこのファイルの
-- 配列は必ず一致させること。
--
-- 破壊性: 非破壊的。CREATE OR REPLACE FUNCTIONによる関数定義の更新のみで、
-- 既存データ（family_members.avatar_color）の値は一切変更しない。
-- 引数・戻り値の型、SECURITY DEFINER・search_path等の属性も変更しない。
-- 効果は「新規に色を採番する際の候補が8色から10色に増える」ことのみであり、
-- 既存メンバーの色が遡って変わることはない（重複していたちひろ・ばあばの色を
-- このマイグレーションが自動的に直すことはなく、直したい場合はP14の色変更機能
-- （本章で実装）を使って保護者が個別に変更する）。

CREATE OR REPLACE FUNCTION public.next_member_avatar_color(p_family_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- src/theme/theme.ts memberColorPalette と同じ並び・同じ値で保つこと（2026-09-01拡張）。
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
    '#F0C2EC'  -- モーブ [2026-09-01追加]
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
  '同じ家族内で重複しないメンバーカラーを1色返す。10色（デザイントークン.md 1.3節、2026-09-01に8色から拡張）を使い切った場合のみ重複を許容して循環割り当てする。';
