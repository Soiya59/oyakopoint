-- 本部長からの業務指示（2026-09-11）「メンバーカラーを15色から12色に減らし、
-- 並び順を色相順に変え、色を選ぶ画面に注意書きを足す」。
-- UIUXデザイン部/成果物/デザイントークン.md 1.3節（2026-09-11改訂v1.19、決定9〜14）。
-- 開発部/成果物/実装メモ.md 199章（10→15色化）・200章（本改訂、15→12色化）。
--
-- 経緯: 本日、10色→15色に拡張し本番へ適用・デプロイした（20260920010000）。
-- その後、統括が実機で「色について、確かに似ている色が多い。追加の５色に
-- ついては取り下げて…」とコメント。本部長が試算した結果、濃くしても見分け
-- やすさは上がらず（効いているのは色数）、濃くすると丸の上の名前の文字が
-- 読めなくなることが判明。統括の最終指示は「淡いままで12色でお願いします。
-- 似た色は隣同士にしてください。また、似た色は識別しにくい可能性を色を
-- 選択する画面に記載ください」。
--
-- 変更点:
--   1. 新規5色（アイスブルー・セルリアン・ペリウィンクル・オーキッド・ローズ）
--      のうち、既存10色との最小ΔE（CIE76）が小さい3色（ローズ・アイスブルー・
--      オーキッド）を取り下げ、最も独立している2色（セルリアン・ペリウィンクル）
--      のみ残す（決定9）。
--   2. 12色全体の並び順を、追加順（末尾追加）から色相（Hue）昇順へ組み替える
--      （決定10）。似た色同士が自然に隣接する。
--
-- 既存データへの影響: 無い。avatar_colorはメンバーごとに確定したhex値として
-- DBに保存され、配列のインデックスへの参照ではないため、パレットの並び替え・
-- 色数の増減は既存メンバーのavatar_colorの値を一切変更しない（決定11）。
-- 影響が出るのは、この改訂の後に新しく作られるメンバーの自動採番順だけ。
-- 本番の在籍メンバー（is_active）のavatar_colorを事前に確認済みで、取り下げる
-- 3色（#EDB6D3ローズ・#ADE6EB アイスブルー・#DEB6ED オーキッド）を使っている
-- メンバーは1人もいない（既存10色のみが使用されており、15色化以降に自動採番で
-- 新規5色が割り当てられたメンバーはまだ存在しない）。実装メモ200章に記録。
--
-- 本マイグレーションは、2026-09-20付 20260920010000（15色版）が定義した
-- next_member_avatar_color() を、このプロジェクトの方式（既存マイグレーションは
-- 書き換えず、新規マイグレーションでCREATE OR REPLACEにより打ち消す）に従って
-- 置き換える。あわせてクライアント側 src/theme/theme.ts の memberColorPalette にも
-- 同じ12色を同じ順序で反映済み。片方だけを直すのはこのプロジェクトで繰り返されている
-- 失敗と同型（実装メモ88・89・93・94章の教訓）であるため、theme.tsとこのファイルの
-- 配列は必ず一致させること。
--
-- 破壊性: 非破壊的。CREATE OR REPLACE FUNCTIONによる関数定義の更新のみで、
-- 既存データ（family_members.avatar_color）の値は一切変更しない。
-- 引数・戻り値の型、SECURITY DEFINER・search_path等の属性、既存10色の値は
-- 一切変更しない（並び順のみ変更）。効果は「新規に色を採番する際の候補・順序が
-- 15色（追加順）から12色（色相昇順）に変わる」ことのみ。

CREATE OR REPLACE FUNCTION public.next_member_avatar_color(p_family_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- src/theme/theme.ts memberColorPalette と同じ並び・同じ値で保つこと
  -- （2026-09-01拡張で8→10色、2026-09-11拡張で10→15色、同日中に15→12色へ縮小・
  -- 色相昇順へ並び替え）。
  v_palette TEXT[] := ARRAY[
    '#FFAFA3', -- コーラル
    '#FFE5B4', -- ピーチ
    '#FFF3B0', -- レモン
    '#C8E8A8', -- ライム
    '#A8D5BA', -- ミントグリーン
    '#C2F0E8', -- アクアミント
    '#ADD3EB', -- セルリアン [2026-09-11追加、決定9で維持]
    '#B4D4FF', -- スカイブルー
    '#B7B6ED', -- ペリウィンクル [2026-09-11追加、決定9で維持]
    '#D9C2FF', -- ラベンダー
    '#F0C2EC', -- モーブ
    '#FFC1CC'  -- ピンク
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
  '同じ家族内で重複しないメンバーカラーを1色返す。12色（デザイントークン.md 1.3節、2026-09-11に15色から縮小・色相昇順に並び替え）を使い切った場合のみ重複を許容して循環割り当てする。';
