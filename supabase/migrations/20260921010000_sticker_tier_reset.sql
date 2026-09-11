-- ============================================================
-- メダルの段階リセット（本部長からの業務指示・2026-09-11、統括判断）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-25-1章「件4（新規）：メダルの段階の
--     リセット」（決定19〜27）・「件1×件4に共通する論点」（決定28〜29）
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 40章（決定1〜14）
--   設計部/成果物/スキーマ設計.sql 52章（決定52-1〜52-9、本部長採点100点）
--   開発部/成果物/実装メモ.md 200章
--
-- 統括の要望（07-25-1章「経緯」より）: 「ゲームクリア後に再度一からやり
-- たい」。一度開いた段階（銀・金・クリスタル）を閉じ直し、銅からまた
-- 集め直せるようにする。
--
-- [唯一かつ絶対的な制約（企画部決定22・27）] 購入履歴
-- （ornament_sticker_purchases）・木への配置記録（family_tree_decorations）・
-- 累計バッジ（member_badges）のいずれに対しても、本マイグレーションは
-- DELETE・UPDATEを一切発行しない。以下のDDL・RPC本体を見れば、この3表への
-- 書き込み文が1件も存在しないことが直接確認できる（設計部52.8章）。
--
-- [破壊性] 新規テーブル1つ（sticker_tier_resets）を追加する以外は破壊的操作
-- を含まない。`purchase_sticker(UUID)`はCREATE OR REPLACE（シグネチャ無変更、
-- ハードカットオーバー不要）。
--
-- [設計部52章との対応] 本ファイルの52.2〜52.5章のSQL本体は、設計部
-- スキーマ設計.sql 52章の記述をそのまま適用したものであり、独自の変更は
-- 加えていない（本部長からの業務指示のとおり）。
-- ============================================================


-- ------------------------------------------------------------
-- 52.2 sticker_tier_resets（新設：家族×形のリセット起点を記録する
--      追記専用ログ、決定21・決定22(C)）
-- ------------------------------------------------------------
-- [shape列にCHECK制約を重複させない、という設計部の判断]
-- sticker_catalog.shapeのCHECK制約を複製せず、実在チェックは下記
-- reset_sticker_tier() RPC内でsticker_catalogへのEXISTSにより動的に行う
-- （形の追加のたびに2箇所のCHECK制約を張り替える必要を避けるため。
-- 20260917010000のドラゴン追加の実例と同じ考え方）。
CREATE TABLE IF NOT EXISTS sticker_tier_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- 07-25-1章決定21: リセットの単位は形（shape）ごと。値域はsticker_
  -- catalog.shapeと同じだが、CHECK制約は重複させない（上記コメント参照。
  -- 実在チェックはreset_sticker_tier() RPC側で行う）。
  shape TEXT NOT NULL CHECK (char_length(trim(shape)) BETWEEN 1 AND 30),
  -- 07-25-1章決定22(C): このリセット以降に行われた購入だけを「解放済み」
  -- とみなす起点。UPDATEはしない（新しいリセットは新しい行として追記
  -- する。決定24「取り消しは実装しない」と表裏一体の設計）。
  reset_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 07-25-1章決定22(C)・決定24: 実行した保護者。決定24の「押す前にどう
  -- 確かめさせるか」の監査記録・UIUXデザイン部40.1節決定4（家族の現在の
  -- 解放状況表示）の裏付けにもなる。退会等でfamily_membersの行自体は
  -- 論理削除（is_active=false）される設計であり物理削除されないため、
  -- ON DELETE RESTRICTで十分（ornament_sticker_purchases.member_idと
  -- 同じ方針）。
  reset_by UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT
);

-- [インデックス] purchase_sticker()（52.5章）・クライアントの読み取り
-- （52.6章・52.7章）はいずれも「family_id×shapeで絞ってreset_atの
-- 最大値を取る」アクセスパターンのみのため、この3列の複合インデックス
-- 1本で足りる。
CREATE INDEX IF NOT EXISTS idx_sticker_tier_resets_family_shape_reset_at
  ON sticker_tier_resets (family_id, shape, reset_at DESC);

COMMENT ON TABLE sticker_tier_resets IS
  '要件定義書07-25-1章 決定20〜27。段階購入制（07-19-14章決定32〜34）の判定が参照する「解放済み」の起点を、家族×形ごとにリセットする追記専用ログ。UPDATE・DELETEは一切行わない（取り消し不可、決定24）。ornament_sticker_purchases・family_tree_decorations・member_badgesはこの機能により一切変更されない（決定22・27の絶対制約）。';


-- ------------------------------------------------------------
-- 52.3 RLSポリシー
-- ------------------------------------------------------------
-- [SELECT] ornament_sticker_purchases_select_same_familyと全く同じ流儀に
-- 揃える。ロールによる絞り込みは行わない。理由は2点:
--   (1) リセットされた事実は子ども向けの買う画面（C30）にも新しい文言
--       として表示する必要があり、子どもにも本テーブルの読み取りが必要。
--   (2) 07-19-14章決定33「購入した本人が誰であるかは問わない」と同じ
--       設計思想により、家族内のメンバー間で「誰が買ったか」「いつ
--       リセットしたか」を隠す設計を採っていない。
ALTER TABLE sticker_tier_resets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sticker_tier_resets_select_same_family" ON sticker_tier_resets;
CREATE POLICY "sticker_tier_resets_select_same_family" ON sticker_tier_resets
  FOR SELECT
  USING (family_id = current_family_id());

-- [INSERT/UPDATE/DELETEポリシーは一切定義しない] ornament_sticker_
-- purchases・member_badgesと同じ設計。書き込みは下記52.4章の
-- reset_sticker_tier()（SECURITY DEFINER）のみが行う。UPDATE・DELETEの
-- 経路自体をRLSレベルでも用意しないことで、決定24「取り消しは実装
-- しない」を構造的に担保する。


-- ------------------------------------------------------------
-- 52.4 reset_sticker_tier()（書き込み用RPC、SECURITY DEFINER・
--      保護者限定、決定24）
-- ------------------------------------------------------------
-- [単一shape限定のRPCにした理由] 「ぜんぶ」はクライアントが対象の形の数
-- だけ本RPCを順に呼び出すことで実現する（決定52-5）。p_shapes TEXT[]の
-- 一括処理RPCは、部分成功の扱いという新しい設計課題が生じるため不採用。
CREATE OR REPLACE FUNCTION public.reset_sticker_tier(p_shape TEXT)
RETURNS TABLE (
  reset_id UUID,
  shape TEXT,
  reset_at TIMESTAMPTZ,
  reset_by UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_new_id UUID;
  v_reset_at TIMESTAMPTZ;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 07-25-1章決定24: 実行できるのは保護者のみ。みまもりメンバー・
  -- 子どもは一切操作できない。
  IF NOT public.is_current_user_parent() THEN
    RAISE EXCEPTION 'この操作は保護者のみ実行できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_shape IS NULL OR char_length(trim(p_shape)) = 0 THEN
    RAISE EXCEPTION '形を指定してください' USING ERRCODE = 'check_violation';
  END IF;

  -- [52.2章の判断の裏返し] shape列にCHECK制約を持たせない代わりに、
  -- ここでsticker_catalogに実在する形であることを動的に検証する。
  -- is_activeでは絞らない（過去に無効化された形であっても、その形の
  -- 購入実績・リセット履歴自体は意味を持ちうるため）。
  --
  -- [2026-09-11・開発部が発見・本部長判断で開発部が修正（120.4章の前例に
  -- 倣い設計部へ差し戻さない）] 本関数のRETURNS TABLEは`shape`という
  -- OUT列を持つ（105行目）。plpgsqlはこの列名と同名の暗黙変数を関数
  -- スコープに生成するため、下記のように無修飾で書くと
  -- `sticker_catalog.shape`なのかOUT変数`shape`なのかplpgsqlの既定設定
  -- （variable_conflict = error）により曖昧と判定され、呼び出すたびに
  -- 必ず`ambiguous`エラーで失敗する（実装メモ.md 200.1章に再現ログ）。
  -- テーブルエイリアス（sc）を付けて明示的に列を指定することで解消する。
  -- これは設計判断の変更ではなく、テーブルエイリアスの欠落という機械的
  -- な誤りである。**このプロジェクトで同種のバグは2回目**（1回目は
  -- 実装メモ.md 120.4章、`cancel_chore_completion()`の
  -- `family_tree_decorations.completion_id`とOUT列`completion_id`の
  -- 衝突）。
  IF NOT EXISTS (SELECT 1 FROM sticker_catalog sc WHERE sc.shape = p_shape) THEN
    RAISE EXCEPTION '指定された形が存在しません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- 07-25-1章決定22: 追記のみ。既存行のUPDATE・DELETEは一切行わない。
  INSERT INTO sticker_tier_resets (family_id, shape, reset_by)
  VALUES (v_family_id, p_shape, v_member_id)
  RETURNING id, sticker_tier_resets.reset_at INTO v_new_id, v_reset_at;

  RETURN QUERY SELECT v_new_id, p_shape, v_reset_at, v_member_id;
END;
$$;

COMMENT ON FUNCTION public.reset_sticker_tier(TEXT) IS
  '要件定義書07-25-1章 決定20〜27。指定した形（shape）について、家族×形ごとの段階購入制の判定起点をリセットする（sticker_tier_resetsへの追記のみ）。ornament_sticker_purchases・family_tree_decorations・member_badgesはDELETE・UPDATEしない（決定22・27）。保護者のみ実行可能（決定24）。取消経路は無い（決定24）。「クリア済み」を前提条件としない（決定25）。';

-- [権限] 新規関数のため、REVOKE/GRANTを明示する（PostgreSQLはCREATE
-- FUNCTION時にEXECUTEをPUBLICへ自動付与し、Supabaseはanon・authenticatedへ
-- 直接EXECUTEを付与するため、anonを明示的に含めてREVOKEする）。
REVOKE ALL ON FUNCTION public.reset_sticker_tier(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_sticker_tier(TEXT) TO authenticated;


-- ------------------------------------------------------------
-- 52.5 purchase_sticker()の改訂（段階判定にリセット起点を加味）
-- ------------------------------------------------------------
-- [破壊性] 20260915010000時点のpurchase_sticker(UUID)をCREATE OR
-- REPLACEする。引数・戻り値の列名は一切変更していない（シグネチャ
-- 無変更、ハードカットオーバー不要）。CREATE OR REPLACEは同一シグネチャ
-- なら既存のGRANT/REVOKE設定をそのまま保持するため、権限の再設定も不要。
--
-- [変更点は1つのみ] 段階購入制のEXISTS判定に「reset_atより後に
-- purchased_atを持つ購入か」という条件を1つ追加する。reset_atが
-- 存在しなければ（家族×その形のリセットが一度も無ければ）従来どおり
-- 全期間を対象にする。残高チェック・INSERT・RETURN QUERYの構造はすべて
-- 無変更。
CREATE OR REPLACE FUNCTION public.purchase_sticker(p_catalog_id UUID)
RETURNS TABLE (
  purchase_id UUID,
  sticker_catalog_id UUID,
  points_spent INT,
  purchased_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_catalog RECORD;
  v_required_rarity TEXT;
  v_reset_at TIMESTAMPTZ;
  v_balance INT;
  v_new_id UUID;
  v_purchased_at TIMESTAMPTZ;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT * INTO v_catalog FROM sticker_catalog WHERE id = p_catalog_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '指定されたメダルが存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- [重要・変更なし] 本関数のRETURNS TABLEはsticker_catalog_id・
  -- points_spent・purchased_atという列名を持ち、いずれもornament_
  -- sticker_purchasesの実列名と一致する。plpgsqlの既定
  -- （variable_conflict=error）により、テーブル別名（osp）を必ず付けて
  -- 列を修飾すること（20260907020000以来の既存コメントを踏襲）。

  IF v_catalog.rarity <> 'bronze' THEN
    v_required_rarity := CASE v_catalog.rarity
      WHEN 'silver' THEN 'bronze'
      WHEN 'gold' THEN 'silver'
      WHEN 'crystal' THEN 'gold'
    END;

    -- [2026-09-11新設・要件定義書07-25-1章決定22] 家族×同じ形の直近の
    -- リセット起点を取得する。一度もリセットしていなければNULL。
    SELECT MAX(reset_at) INTO v_reset_at
    FROM sticker_tier_resets
    WHERE family_id = v_family_id AND shape = v_catalog.shape;

    -- [段階購入制の判定・決定32〜34は変更なし。決定22の条件を1つ追加]
    -- v_reset_atがNULLの場合（家族×その形が一度もリセットされて
    -- いない場合）は、`purchased_at > v_reset_at`がSQLの三値論理で
    -- 常にUNKNOWN（偽扱い）になり、既存の購入実績があっても偽陽性で
    -- 「まだ買えない」と誤判定してしまう罠がある。これを避けるため
    -- `v_reset_at IS NULL OR ...`を先に置き、従来どおり全期間を対象と
    -- する既存動作を無条件に保つ。
    IF NOT EXISTS (
      SELECT 1
      FROM ornament_sticker_purchases osp
      JOIN sticker_catalog sc ON sc.id = osp.sticker_catalog_id
      WHERE osp.family_id = v_family_id
        AND sc.shape = v_catalog.shape
        AND sc.rarity = v_required_rarity
        AND (v_reset_at IS NULL OR osp.purchased_at > v_reset_at)
    ) THEN
      RAISE EXCEPTION 'このメダルはまだ買えません。家族の誰かがひとつ下のレアリティを買うと購入できるようになります'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- 残高チェック（無変更。ポイントは現金で発行・販売しない）。
  SELECT current_points INTO v_balance FROM member_points WHERE member_id = v_member_id;
  v_balance := COALESCE(v_balance, 0);

  IF v_balance < v_catalog.points_cost THEN
    RAISE EXCEPTION 'ポイントが不足しています。必要: %pt、保有: %pt', v_catalog.points_cost, v_balance
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO ornament_sticker_purchases AS osp (family_id, member_id, sticker_catalog_id, points_spent)
  VALUES (v_family_id, v_member_id, p_catalog_id, v_catalog.points_cost)
  RETURNING osp.id, osp.purchased_at INTO v_new_id, v_purchased_at;

  RETURN QUERY SELECT v_new_id, p_catalog_id, v_catalog.points_cost, v_purchased_at;
END;
$$;

COMMENT ON FUNCTION public.purchase_sticker(UUID) IS
  '要件定義書07-19-14章（決定32〜38）・07-25-1章決定22（2026-09-11改訂）。段階購入制（銅は無条件、銀・金・クリスタルは同じ形のひとつ下のレアリティを家族の誰かが「直近のリセット以降に」購入したことがある場合のみ購入可。リセットが一度も無ければ全期間が対象）・残高チェック（member_points）を満たした場合のみornament_sticker_purchasesへ記録する。月次購入上限は決定39により撤廃済み。取消経路は無い（決定24）。画面に出るメッセージの呼び名は「メダル」（152章）。';

-- [権限について] REVOKE/GRANTの再実行は不要。CREATE OR REPLACE
-- FUNCTIONは引数リスト（シグネチャ）が同一である限り同一のオブジェクト
-- （同一OID）を更新するだけであり、20260907020000で設定済みのGRANT
-- EXECUTE TO authenticated・REVOKE ALL FROM PUBLIC, anon はそのまま
-- 維持される（PostgreSQLの仕様。RLS照査スイートS4の実測でも変化が
-- 無いことを確認する）。
