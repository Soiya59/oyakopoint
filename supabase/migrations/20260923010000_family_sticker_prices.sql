-- ============================================================
-- メダルの値段を家族ごとに編集できるようにする（本部長からの業務指示・2026-09-11）
-- ============================================================
-- 参照:
--   企画部/成果物/要件定義書.md 07-25-1章「件1の再検討：値段を家族ごとに
--     編集できるようにする」（決定10〜18）（本部長採点100点）
--   UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 41章（決定1〜16、
--     本部長採点100点）。※業務指示により配置は`app/parent/sticker-
--     settings.tsx`（メダル管理）に読み替え済み。DDL・RPCへの影響なし。
--   設計部/成果物/スキーマ設計.sql 53章（決定53-1〜53-10、本部長採点100点。
--     本ファイルはこの章のDDL・RPC本体をそのまま適用したものであり、
--     独自の変更は加えていない）。
--   設計部/成果物/スキーマ設計.sql 52章（メダルの段階リセット、本番適用済み）。
--     本ファイルはsticker_tier_resets・reset_sticker_tier()を一切変更しない。
--
-- [唯一かつ絶対的な制約（決定15・07-19-6章決定8・07-19-9a章決定24）]
-- 過去の購入履歴（ornament_sticker_purchases.points_spent）は購入確定時点の
-- スナップショットであり、値段を変更しても一切書き換わらない。本ファイルに
-- ornament_sticker_purchases・family_tree_decorations・member_badgesへの
-- UPDATE・DELETE文は1件も含まれない。
--
-- [破壊性] 新規テーブル1つ（family_sticker_prices）・新規View1つ
-- （sticker_catalog_effective_prices）・新規RPC1つ（set_family_sticker_
-- prices）を追加する以外は破壊的操作を含まない。`purchase_sticker(UUID)`は
-- CREATE OR REPLACE（シグネチャ無変更、ハードカットオーバー不要）。
-- ============================================================


-- ------------------------------------------------------------
-- 53.2 family_sticker_prices（新設：家族×レアリティの上書き価格）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS family_sticker_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  -- 決定13: 変更できる粒度はレアリティ4段階のみ。sticker_catalog.rarityの
  -- CHECK制約（20260915010000適用後の値）とそろえる。
  rarity TEXT NOT NULL CHECK (rarity IN ('bronze', 'silver', 'gold', 'crystal')),
  -- 決定12: 0pt禁止。既存のchores.points・rewards.costと同じ正の整数・
  -- 上限なしのCHECKに揃える。
  points_cost INT NOT NULL CHECK (points_cost > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 家族×レアリティにつき上書き行は高々1つ。set_family_sticker_prices()
  -- のON CONFLICT対象。
  UNIQUE (family_id, rarity)
);

ALTER TABLE family_sticker_prices ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_family_sticker_prices_updated_at ON family_sticker_prices;
CREATE TRIGGER trg_family_sticker_prices_updated_at
  BEFORE UPDATE ON family_sticker_prices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE family_sticker_prices IS
  '要件定義書07-25-1章 決定10〜18。家族がレアリティ（銅・銀・金・クリスタル）ごとに上書きできるメダルの値段。未設定のレアリティは行を持たず、その場合はsticker_catalog.points_costを使う（決定14の既定値）。sticker_catalogそのものは変更しない（他家族に影響を与えないため、決定11）。書き込みはset_family_sticker_prices()（SECURITY DEFINER・保護者限定）のみが行う。追記専用ログではなく、families.name等と同じ可変の現在値テーブルである（取り消し不可の要件が無いため）。';


-- ------------------------------------------------------------
-- 53.3 RLSポリシー
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "family_sticker_prices_select_same_family" ON family_sticker_prices;
CREATE POLICY "family_sticker_prices_select_same_family" ON family_sticker_prices
  FOR SELECT
  USING (family_id = current_family_id());

-- [INSERT/UPDATE/DELETEポリシーは一切定義しない] 書き込みは下記
-- set_family_sticker_prices()（SECURITY DEFINER）のみが行う。決定17
-- 「保護者のみが変更できる」をRLSレベルでも担保する（クライアントから
-- 直接この表へUPSERTするような裏口経路が存在しない）。


-- ------------------------------------------------------------
-- 53.4 sticker_catalog_effective_prices（新設View：価格解決ロジックの
--      単一の置き場所、決定11「1箇所」要件への回答）
-- ------------------------------------------------------------
-- [security_invoker = true を必ず付けること] これを落とすとView定義者
-- （マイグレーション実行者、通常はpostgres/スーパーユーザー）の権限で
-- 評価され、呼び出し元のRLSを素通りして他の家族の上書き価格を拾う恐れが
-- ある。JOIN条件のcurrent_family_id()は「呼び出し元セッションのJWT
-- クレームを読む」関数であるため、security_invoker=trueで呼び出し元の
-- 権限のもとで評価させることと合わせて初めて正しく機能する。
CREATE OR REPLACE VIEW public.sticker_catalog_effective_prices
WITH (security_invoker = true) AS
SELECT
  sc.id,
  sc.shape,
  sc.rarity,
  sc.sticker_key,
  sc.display_name,
  COALESCE(fsp.points_cost, sc.points_cost) AS points_cost,
  sc.is_active,
  sc.created_at
FROM sticker_catalog sc
LEFT JOIN family_sticker_prices fsp
  ON fsp.family_id = current_family_id() AND fsp.rarity = sc.rarity;

COMMENT ON VIEW public.sticker_catalog_effective_prices IS
  '要件定義書07-25-1章 決定11。sticker_catalogの各行について、現在ログイン中の家族の上書き価格（family_sticker_prices）があればそれを、無ければsticker_catalog.points_costをそのまま返す。列構成はsticker_catalogと完全に一致させてあり、購入画面（StickerShopPanel.tsx）はこのViewをsticker_catalogの代わりに参照するだけで新しい価格を表示できる。purchase_sticker()もこのViewを参照し、価格解決ロジックを1箇所に集約する（決定11）。security_invoker=trueかつJOIN条件にcurrent_family_id()を埋め込むことで、他家族の上書き価格が漏れないようにしている。';

-- [明示的なGRANTを書かない理由] member_points等の既存Viewと同じ扱い。
-- Supabaseは新規テーブル・View作成時にanon・authenticatedへデフォルトで
-- SELECT権限相当を付与する設定になっており、実際のアクセス制御は
-- security_invoker=trueとfamily_sticker_prices・sticker_catalog双方の
-- RLSポリシーが担う。


-- ------------------------------------------------------------
-- 53.5 set_family_sticker_prices()（書き込み用RPC、SECURITY DEFINER・
--      保護者限定・4値まとめて1回で保存）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_family_sticker_prices(
  p_bronze INT,
  p_silver INT,
  p_gold INT,
  p_crystal INT
)
RETURNS TABLE (
  rarity TEXT,
  points_cost INT,
  is_override BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
-- [2026-09-11・開発部が発見・本部長判断で開発部が修正] 本関数のRETURNS
-- TABLEが`rarity`・`points_cost`というOUT列を持つため、関数本文中で
-- これらと同名の裸の列参照（`ON CONFLICT (family_id, rarity)`のように
-- テーブルエイリアスを付けられない構文位置を含む）がplpgsqlの既定
-- （variable_conflict = error）のもとでは軒並み`ambiguous`エラーになる
-- （ローカルDockerで実測・実装メモ.md 201章に再現ログ）。53.5章コメントが
-- 想定していたテーブルエイリアス（sc）による個別解消だけでは
-- `ON CONFLICT (family_id, rarity)`のように別名を付けられない構文位置を
-- 救えないため、PostgreSQL公式が推奨するプラグマ`#variable_conflict
-- use_column`を関数本文の先頭に追加し、裸の列参照は常にテーブル列を優先
-- させる（OUT変数として読みたい箇所はr.rarity等、既に全てテーブル別名で
-- 明示修飾済みのため副作用は無い）。設計判断の変更ではなく、52.4章
-- reset_sticker_tier()の`shape`列衝突（120.4章の前例）と同種の機械的な
-- 誤りの修正であり、52.4章の前例（設計部へ差し戻さない）を踏襲した。
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_default_bronze INT;
  v_default_silver INT;
  v_default_gold INT;
  v_default_crystal INT;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 決定17: 実行できるのは保護者のみ。みまもりメンバー・子どもは
  -- 一切操作できない。
  IF NOT public.is_current_user_parent() THEN
    RAISE EXCEPTION 'この操作は保護者のみ実行できます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 決定12: 0pt禁止。正の整数のみ（chore-edit.tsx・reward-edit.tsxの
  -- 「1以上の整数」検証と同じ考え方、UIUXデザイン部41.4節決定6-1）。
  IF p_bronze IS NULL OR p_bronze <= 0
     OR p_silver IS NULL OR p_silver <= 0
     OR p_gold IS NULL OR p_gold <= 0
     OR p_crystal IS NULL OR p_crystal <= 0 THEN
    RAISE EXCEPTION '値段は1以上の整数で入力してください' USING ERRCODE = 'check_violation';
  END IF;

  -- 決定18: 単調性（銅≤銀≤金≤クリスタル）。「≤」なので同額は許す
  -- （逆転のみ禁止、業務指示・統括確認済み）。
  IF NOT (p_bronze <= p_silver AND p_silver <= p_gold AND p_gold <= p_crystal) THEN
    RAISE EXCEPTION '価格は「銅の値段 ≤ 銀の値段 ≤ 金の値段 ≤ クリスタルの値段」の順にしてください'
      USING ERRCODE = 'check_violation';
  END IF;

  -- レアリティごとの基準価格（sticker_catalogの既定値）を取得する
  -- （同一レアリティ内で価格が揃っている前提に立つ、決定13）。
  --
  -- [2026-09-11・開発部が発見・本部長判断で開発部が修正（52.4章
  -- reset_sticker_tier()の`shape`列衝突〈120.4章の前例〉と全く同じ失敗形）]
  -- 本関数のRETURNS TABLEは`rarity`・`points_cost`というOUT列を持つ（上記
  -- 宣言部）。plpgsqlはこれらの列名と同名の暗黙変数を関数スコープに生成する
  -- ため、下記のように無修飾で書くと`sticker_catalog.points_cost`/`rarity`
  -- なのかOUT変数なのかplpgsqlの既定設定（variable_conflict = error）に
  -- より曖昧と判定され、呼び出すたびに必ず`ambiguous`エラーで失敗する
  -- （開発部/成果物/実装メモ.md 201章に再現ログ）。テーブルエイリアス（sc）を
  -- 付けて明示的に列を指定することで解消する。設計判断の変更ではなく、
  -- テーブルエイリアスの欠落という機械的な誤りであり、52.4章と全く同一の
  -- 失敗パターンのため、52.4章の前例（120.4章に倣い設計部へ差し戻さない）を
  -- そのまま踏襲し、開発部の判断で修正した。
  SELECT sc.points_cost INTO v_default_bronze FROM sticker_catalog sc WHERE sc.rarity = 'bronze' ORDER BY sc.shape LIMIT 1;
  SELECT sc.points_cost INTO v_default_silver FROM sticker_catalog sc WHERE sc.rarity = 'silver' ORDER BY sc.shape LIMIT 1;
  SELECT sc.points_cost INTO v_default_gold FROM sticker_catalog sc WHERE sc.rarity = 'gold' ORDER BY sc.shape LIMIT 1;
  SELECT sc.points_cost INTO v_default_crystal FROM sticker_catalog sc WHERE sc.rarity = 'crystal' ORDER BY sc.shape LIMIT 1;

  IF v_default_bronze IS NULL OR v_default_silver IS NULL OR v_default_gold IS NULL OR v_default_crystal IS NULL THEN
    RAISE EXCEPTION 'システムエラー：基準となる価格を取得できませんでした' USING ERRCODE = 'internal_error';
  END IF;

  -- [決定9（UIUXデザイン部41.5節）を採用] 入力値が基準価格と一致する
  -- レアリティは上書き行を作らない／既存の上書き行を削除する。これに
  -- より「もとの値段にもどす」で保存した家族は、将来sticker_catalog側の
  -- 価格が変わった場合も自動的に追随する。一致しないレアリティのみ
  -- UPSERTする。1回のRPC呼び出し内でUPSERTとDELETEの両方を行うが、
  -- いずれもv_family_id一件分の最大4行にしか触れず、他家族の行には
  -- 一切触れない（family_idで必ず絞っている）。
  INSERT INTO family_sticker_prices (family_id, rarity, points_cost)
  SELECT v_family_id, r.rarity, r.points_cost
  FROM (VALUES
    ('bronze',  p_bronze,  v_default_bronze),
    ('silver',  p_silver,  v_default_silver),
    ('gold',    p_gold,    v_default_gold),
    ('crystal', p_crystal, v_default_crystal)
  ) AS r(rarity, points_cost, default_cost)
  WHERE r.points_cost <> r.default_cost
  ON CONFLICT (family_id, rarity) DO UPDATE
    SET points_cost = EXCLUDED.points_cost, updated_at = now();

  DELETE FROM family_sticker_prices fsp
  USING (VALUES
    ('bronze',  p_bronze,  v_default_bronze),
    ('silver',  p_silver,  v_default_silver),
    ('gold',    p_gold,    v_default_gold),
    ('crystal', p_crystal, v_default_crystal)
  ) AS r(rarity, points_cost, default_cost)
  WHERE fsp.family_id = v_family_id
    AND fsp.rarity = r.rarity
    AND r.points_cost = r.default_cost;

  RETURN QUERY
  SELECT r.rarity, r.points_cost, (r.points_cost <> r.default_cost)
  FROM (VALUES
    ('bronze',  p_bronze,  v_default_bronze),
    ('silver',  p_silver,  v_default_silver),
    ('gold',    p_gold,    v_default_gold),
    ('crystal', p_crystal, v_default_crystal)
  ) AS r(rarity, points_cost, default_cost);
END;
$$;

COMMENT ON FUNCTION public.set_family_sticker_prices(INT, INT, INT, INT) IS
  '要件定義書07-25-1章 決定10〜18。家族単位でメダルの値段（銅・銀・金・クリスタル）をまとめて1回で保存する。0pt禁止（決定12）・単調性（銅≤銀≤金≤クリスタル、決定18）をサーバー側でも検証し、違反時はcheck_violationで保存を拒否する。保存値がsticker_catalogの既定値と一致するレアリティは上書き行を削除する（決定9）。保護者のみ実行可能（決定17）。';

-- [権限] 新規関数のため、REVOKE/GRANTを明示する（PostgreSQLはCREATE
-- FUNCTION時にEXECUTEをPUBLICへ自動付与し、Supabaseはanon・authenticatedへ
-- 直接EXECUTEを付与するため、anonを明示的に含めてREVOKEする）。
REVOKE ALL ON FUNCTION public.set_family_sticker_prices(INT, INT, INT, INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_family_sticker_prices(INT, INT, INT, INT) TO authenticated;


-- ------------------------------------------------------------
-- 53.6 purchase_sticker()の改訂（52章の版に、価格解決の参照先変更を
--      1点追加）
-- ------------------------------------------------------------
-- [破壊性] 52章（20260921010000時点）のpurchase_sticker(UUID)をCREATE OR
-- REPLACEする。引数・戻り値の列名は一切変更していない（シグネチャ
-- 無変更）。
--
-- [変更点は1つのみ] 残高チェック・INSERT時のpoints_spent算出のいずれも、
-- これまでv_catalog.points_cost（sticker_catalog由来の共通価格）を
-- 直接使っていたが、53.4章のView（sticker_catalog_effective_prices）を
-- 1回だけ引いて求めたv_effective_cost（家族の上書きがあればそれ、
-- 無ければ共通価格）に差し替える。段階購入制の判定（決定32〜34、
-- 52章のreset_at加味）・52章が新設したロジックは一切変更しない。
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
  v_effective_cost INT;
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
  -- 列を修飾すること。

  -- [2026-09-11新設・要件定義書07-25-1章決定11]「価格解決ロジックを
  -- 1箇所に持つこと」への回答。53.4章のViewを1回だけ引き、残高チェックと
  -- INSERT時のpoints_spentの両方に同じ値を使う（RPC内で2回計算しない）。
  -- v_catalogが既にis_activeで取得できている以上、このViewは
  -- sticker_catalog全行を母体にしているため必ず1行返る（NULLにならない）。
  SELECT points_cost INTO v_effective_cost
  FROM sticker_catalog_effective_prices
  WHERE id = p_catalog_id;

  -- [変更なし・52章がそのまま] 段階購入制の判定（決定32〜34）は価格を
  -- 参照しないため、家族ごとの価格上書きによる影響を受けない。
  IF v_catalog.rarity <> 'bronze' THEN
    v_required_rarity := CASE v_catalog.rarity
      WHEN 'silver' THEN 'bronze'
      WHEN 'gold' THEN 'silver'
      WHEN 'crystal' THEN 'gold'
    END;

    SELECT MAX(reset_at) INTO v_reset_at
    FROM sticker_tier_resets
    WHERE family_id = v_family_id AND shape = v_catalog.shape;

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

  -- 残高チェック（決定22〈07-19-9a章〉: ポイントは現金で発行・販売しない）。
  -- [2026-09-11改訂] 比較対象をv_catalog.points_costからv_effective_cost
  -- （家族の上書き価格を加味した実効価格）に変更。
  SELECT current_points INTO v_balance FROM member_points WHERE member_id = v_member_id;
  v_balance := COALESCE(v_balance, 0);

  IF v_balance < v_effective_cost THEN
    RAISE EXCEPTION 'ポイントが不足しています。必要: %pt、保有: %pt', v_effective_cost, v_balance
      USING ERRCODE = 'check_violation';
  END IF;

  -- [2026-09-11改訂] points_spentにv_effective_costを記録する。決定15の
  -- スナップショット方式（購入確定の瞬間に読んだ価格を書き込む）は
  -- そのまま維持される。
  INSERT INTO ornament_sticker_purchases AS osp (family_id, member_id, sticker_catalog_id, points_spent)
  VALUES (v_family_id, v_member_id, p_catalog_id, v_effective_cost)
  RETURNING osp.id, osp.purchased_at INTO v_new_id, v_purchased_at;

  RETURN QUERY SELECT v_new_id, p_catalog_id, v_effective_cost, v_purchased_at;
END;
$$;

COMMENT ON FUNCTION public.purchase_sticker(UUID) IS
  '要件定義書07-19-14章（決定32〜38）・07-25-1章決定22（52章）・決定11・15（53章、2026-09-11改訂）。段階購入制（銅は無条件、銀・金・クリスタルは同じ形のひとつ下のレアリティを家族の誰かが「直近のリセット以降に」購入したことがある場合のみ購入可）・残高チェックのいずれも、家族の上書き価格を加味した実効価格（sticker_catalog_effective_prices経由）を使う。過去の購入記録（points_spent）は購入確定の瞬間の実効価格のスナップショットであり、後から値段を変えても書き換わらない。月次購入上限は決定39により撤廃済み。取消経路は無い（決定24）。画面に出るメッセージの呼び名は「メダル」（152章）。';

-- [権限について] REVOKE/GRANTの再実行は不要。CREATE OR REPLACE
-- FUNCTIONは引数リスト（シグネチャ）が同一である限り同一のオブジェクト
-- （同一OID）を更新するだけであり、20260907020000で設定済みのGRANT
-- EXECUTE TO authenticated・REVOKE ALL FROM PUBLIC, anon はそのまま
-- 維持される（PostgreSQLの仕様。RLS照査スイートS4の実測でも変化が
-- 無いことを確認する）。
