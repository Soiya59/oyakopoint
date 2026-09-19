-- ============================================================
-- シール帳の全面作り替え（メンバー単位・1人1冊・1冊100マス固定、
-- 2026-09-19新設）
-- ============================================================
-- 参照:
--   企画部/参考資料/シール帳の作り替え依頼（2026-09-19・本部長より）.md
--     （統括決定1〜16の正本）
--   企画部/成果物/要件定義書.md 07-28章（2026-09-19全面改訂・決定25〜33）
--   設計部/成果物/スキーマ設計.sql 57章（本マイグレーションはこの章を
--     そのまま実装したもの）・API仕様.md 17章
--   置き換え対象（現行実装）: 20260925010000_habit_cards_and_figures.sql・
--     20260926010000_habit_figure_spirit_and_rename.sql・
--     20260926020000_habit_card_limit_message_rename.sql
--
-- [破壊的変更の記録・本部長指示どおり実行前に成果物へ記録済み]
-- 開発部/成果物/実装メモ.md 256章に事前記録。統括決定14「既存のシール帳型
-- クエストは削除でよい。移行の仕組みは作らない」（依頼文決定14）に基づき、
-- 本マイグレーションは以下を破壊的に行う。
--   - 既存の reward_mode='habit_card' なクエスト（chores行）を削除する
--     （手順7）。対応する chore_completions.chore_id はON DELETE SET NULLで
--     NULLになるが、完了報告そのもの・獲得ポイント・シール帳の累計は失われない。
--   - 家族の木にまだ飾っていない獲得済みフィギュア（habit_figure_grants）は
--     削除する（手順3）。木に飾られた獲得物は削除しない（FK ON DELETE
--     RESTRICTで保護される）。
--   - 進行中だった旧構造の habit_cards（習慣ごとの台紙）はすべて「完成」
--     扱いにしたうえで、家族の木に一度もフィギュアを飾っていないものは
--     削除する（手順1・4）。木に飾られたフィギュアの元になった行だけが
--     「しまったシール帳」の履歴として残る。
-- 件数（0件〜数百件のいずれでも安全に完了する設計、スキーマ設計.sql 57.11章）は
-- ローカル検証時に検証SQL（開発部/成果物/検証SQL_57_シール帳全面作り替え.sql）
-- で確認する。**本番适用（npx supabase db push）は本部長が統括の承認を得て
-- 別途行う。本タスクではローカル適用のみ行う。**
-- ============================================================

-- ------------------------------------------------------------
-- 手順0（下準備・列追加のみ、データは変えない。57.3章）
-- ------------------------------------------------------------
ALTER TABLE habit_cards ADD COLUMN IF NOT EXISTS kind_key TEXT NULL;

-- ------------------------------------------------------------
-- 手順1（進行中の旧habit_cards行をすべて完成扱いにする）
-- ------------------------------------------------------------
-- [理由] 57.3章で追加する`uq_habit_cards_active_per_member`（メンバーにつき
-- activeは高々1件）を安全に追加するため、旧設計の「1人が複数のactive行を
-- 持ちうる」状態を先に解消する。55.3a章の`habit_cards_before_write()`は
-- BEFORE INSERTのみに発火するため、本UPDATEはトリガーの影響を受けず安全に
-- 実行できる。
UPDATE habit_cards SET status = 'archived', archived_at = now(), archive_reason = 'manual'
WHERE status = 'active';

-- ------------------------------------------------------------
-- 手順2（kind_keyを旧chore_idの由来からbackfillする）
-- ------------------------------------------------------------
UPDATE habit_cards hc SET kind_key = c.habit_kind_key
FROM chores c WHERE c.id = hc.chore_id AND hc.kind_key IS NULL;

-- ------------------------------------------------------------
-- 手順3（木に飾られていないフィギュアの記録を削除する。件数に依存しない
-- 安全側の判定）
-- ------------------------------------------------------------
-- [理由] 「まだ木に飾っていない獲得記録」は家族にまだ何も見せていない情報
-- であり、削除してもユーザーから見える喪失は無い。木に飾られた記録は
-- `family_tree_decorations.habit_figure_grant_id`（ON DELETE RESTRICT）が
-- 守るため、このDELETEは対象外になる（消そうとしてもFK制約がブロックし、
-- 安全側に倒れる）。
DELETE FROM habit_figure_grants
WHERE id NOT IN (
  SELECT habit_figure_grant_id FROM family_tree_decorations
  WHERE habit_figure_grant_id IS NOT NULL
);

-- ------------------------------------------------------------
-- 手順4（手順3の結果、参照が無くなった旧habit_cards行を削除する）
-- ------------------------------------------------------------
DELETE FROM habit_cards
WHERE id NOT IN (SELECT habit_card_id FROM habit_figure_grants);

-- ------------------------------------------------------------
-- 手順5（生き残った旧habit_cards行の列を新構造へ揃える。57.3章のDDLを
-- この位置で適用する）
-- ------------------------------------------------------------
ALTER TABLE habit_cards DROP COLUMN IF EXISTS chore_id;
ALTER TABLE habit_cards DROP COLUMN IF EXISTS chore_title;
ALTER TABLE habit_cards DROP COLUMN IF EXISTS chore_emoji;
ALTER TABLE habit_cards DROP COLUMN IF EXISTS archive_reason;
ALTER TABLE habit_cards ALTER COLUMN kind_key SET NOT NULL;

-- ------------------------------------------------------------
-- 手順6（0ポイントの移行準備。chore_completions.pointsのNULLを0に
-- backfillしてからNOT NULLへ戻す。57.1章のDDLをこの位置で適用）
-- ------------------------------------------------------------
-- [設計書との食い違い・実装上の訂正・開発部が発見し報告する点]
-- スキーマ設計.sql 57.11章の手順6は「chore_completions.points／
-- chores.pointsのNULLを0にbackfillしてからNOT NULLへ戻す」を手順8より
-- **前**に置いているが、この時点（手順8適用前）では旧CHECK制約
-- `chk_chore_completions_points`（`points IS NULL OR points > 0`）が
-- まだ有効なままであり、`UPDATE ... SET points = 0`は0が`points > 0`を
-- 満たさないため必ず制約違反で失敗する（ローカルDockerで実際に検証データを
-- 投入して確認した。開発部/成果物/実装メモ.md 256章参照）。**この1点は
-- 設計書の文字どおりの手順では実行不可能であり、開発部の判断で最小限の
-- 実装上の是正を行った**（決定事項・仕様を変えるものではなく、DDLの適用
-- 順序のみの是正）。
--   (a) `chores.points`側の0backfillはそもそも不要と判断し削除した:
--       NULLを持つchoresは常にreward_mode='habit_card'の行のみであり
--       （55.1章決定55-2）、その行は直前の手順7で全件DELETEされるため、
--       backfillしてもその直後に消える無意味な操作だった。
--   (b) `chore_completions.points`側は、後続の完了報告データ
--       （`chore_id`がON DELETE SET NULLでNULLになった後も行自体は残る）
--       であるため、backfillは引き続き必要。ただし制約の緩和
--       （`chk_chore_completions_points`の撤去・`>=0`への置き換え）を
--       backfillより先に行う形へ、本節内でのみ順序を入れ替えた（57.1章の
--       他の変更点の位置は動かしていない）。
ALTER TABLE chore_completions DROP CONSTRAINT IF EXISTS chk_chore_completions_points;
ALTER TABLE chore_completions DROP CONSTRAINT IF EXISTS chk_chore_completions_points_nonnegative;
ALTER TABLE chore_completions ADD CONSTRAINT chk_chore_completions_points_nonnegative
  CHECK (points >= 0);
UPDATE chore_completions SET points = 0 WHERE points IS NULL;

-- ------------------------------------------------------------
-- 手順7（旧シール帳型クエストを削除する。ON DELETE SET NULLの挙動を承知の
-- うえで実行、依頼文決定14）
-- ------------------------------------------------------------
-- [影響] 該当chore_idを持つchore_completions行は`chore_id`列のみNULLに
-- なる（ON DELETE SET NULL、5章）。完了報告の履歴自体・獲得ポイント
-- （points列、backfill済み）・シール帳の累計（57.5章のCOUNTはchore_idを
-- 見ない）はいずれも失われない。
DELETE FROM chores WHERE reward_mode = 'habit_card';

-- ------------------------------------------------------------
-- 手順8（57.1章のDDLを適用する。reward_mode・habit_kind_key列の撤去、
-- pointsのNOT NULL化とCHECK緩和）
-- ------------------------------------------------------------
ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_reward_mode_payload;
ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_reward_mode_values;

ALTER TABLE chores ALTER COLUMN points SET NOT NULL;
ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_points_nonnegative;
ALTER TABLE chores ADD CONSTRAINT chk_chores_points_nonnegative
  CHECK (points >= 0);

ALTER TABLE chores DROP COLUMN IF EXISTS reward_mode;
ALTER TABLE chores DROP COLUMN IF EXISTS habit_kind_key;

-- [注記] chore_completions側のCHECK制約の入れ替えは、上記「手順6」の位置
-- （本ファイル前方）へ繰り上げ済み（設計書との食い違いの是正、手順6の
-- コメント参照）。ここではNOT NULL化のみを行う（backfillは手順6で完了済み）。
ALTER TABLE chore_completions ALTER COLUMN points SET NOT NULL;

-- [chores_before_write()の改訂・決定57-2] 55章が追加した4点（reward_mode/
-- habit_kind_keyの作成後不変・is_repeatable等の強制補正・担当者必須・
-- habit_kind_keyの実在確認）をすべて撤去し、45.4章の土台（scope分岐・
-- 37章updated_by・is_repeatableデフォルト補完）のみに戻す。
CREATE OR REPLACE FUNCTION public.chores_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.scope IS DISTINCT FROM OLD.scope THEN
    RAISE EXCEPTION '公開範囲（scope）は作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.assigned_to IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM family_members fm
      WHERE fm.id = NEW.assigned_to AND fm.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'assigned_toは同じ家族のメンバーである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;
  IF NEW.category_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.family_id = NEW.family_id
    ) THEN
      RAISE EXCEPTION 'category_idは同じ家族のカテゴリーである必要があります' USING ERRCODE = 'foreign_key_violation';
    END IF;
  END IF;

  -- [45.4章・無変更] scopeごとのcreated_by/assigned_to補正。
  IF NEW.scope = 'personal' THEN
    NEW.created_by := current_family_member_id();
    NEW.assigned_to := NEW.created_by;
  ELSIF NEW.scope = 'supporter_shared' THEN
    NEW.assigned_to := NULL;
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := current_family_member_id();
    ELSE
      NEW.created_by := OLD.created_by;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    NEW.created_by := current_family_member_id();
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.created_by := OLD.created_by;
  END IF;

  -- [37章・無変更] updated_byの記録（許可リスト方式）。
  IF TG_OP = 'UPDATE' AND (
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.emoji IS DISTINCT FROM OLD.emoji OR
    NEW.points IS DISTINCT FROM OLD.points OR
    NEW.category_id IS DISTINCT FROM OLD.category_id OR
    NEW.assigned_to IS DISTINCT FROM OLD.assigned_to OR
    NEW.is_repeatable IS DISTINCT FROM OLD.is_repeatable OR
    NEW.daily_limit IS DISTINCT FROM OLD.daily_limit OR
    NEW.nfc_tag_id IS DISTINCT FROM OLD.nfc_tag_id
  ) THEN
    NEW.updated_by := current_family_member_id();
  END IF;

  IF TG_OP = 'INSERT' AND NEW.is_repeatable AND NEW.daily_limit IS NULL THEN
    NEW.daily_limit := 1;
  END IF;
  RETURN NEW;
END;
$$;
-- トリガー本体（trg_chores_before_write・trg_chores_updated_at）は既存の
-- ものをそのまま再利用する（再作成不要）。

-- [撤去] 55.6章の担当者必須トリガー・関数は丸ごと不要になる。
DROP TRIGGER IF EXISTS trg_chores_after_insert_create_habit_card ON chores;
DROP FUNCTION IF EXISTS public.chores_after_insert_create_habit_card();

-- ------------------------------------------------------------
-- 手順9（57.3章の残りのDDLを適用する。ステータス語彙の変更・UNIQUE
-- インデックスの張り替え・トリガーの再作成）
-- ------------------------------------------------------------
-- [設計書との食い違い・実装上の訂正・開発部が発見し報告する点・その2]
-- スキーマ設計.sql 57.3章の文字どおりの順序は「UPDATE habit_cards SET
-- status='completed' ... を先に実行し、そのあとCHECK制約
-- `habit_cards_status_check`（旧: status IN ('active','archived')）を
-- 落として新しい制約を足す」だが、この順序では旧制約がまだ'completed'を
-- 許していないため、UPDATE自体が必ず制約違反で失敗する（手順6と同種の
-- バグ。ローカルDockerで実際に検証データを投入して確認した。開発部/
-- 成果物/実装メモ.md 256章参照）。**逆に「制約を先に張り替えてから
-- UPDATE」でも、張り替えた瞬間の新制約はまだ残っている'archived'行を
-- 許さないため今度はCHECK制約の追加自体が失敗する**（1回目の是正だけでは
-- 不十分だったことも実機検証で確認した）。正しい順序は「(1)旧制約を
-- DROPして値の制約を一時的に外す→(2)UPDATEで値を書き換える→(3)新しい
-- 制約を追加する」の3段階であるため、その順に組み替えた（決定事項・
-- 値そのものは変えていない）。
ALTER TABLE habit_cards DROP CONSTRAINT IF EXISTS habit_cards_status_check;
UPDATE habit_cards SET status = 'completed' WHERE status = 'archived';
ALTER TABLE habit_cards ADD CONSTRAINT habit_cards_status_check
  CHECK (status IN ('active', 'completed'));
ALTER TABLE habit_cards RENAME COLUMN archived_at TO completed_at;

ALTER TABLE habit_cards DROP CONSTRAINT IF EXISTS habit_cards_check; -- 旧CHECK（status/archived_at整合）
ALTER TABLE habit_cards ADD CONSTRAINT chk_habit_cards_status_completed_at CHECK (
  (status = 'active' AND completed_at IS NULL)
  OR
  (status = 'completed' AND completed_at IS NOT NULL)
);

-- [決定27「1人1冊ずつ」をDBで保証する部分UNIQUEインデックス]
DROP INDEX IF EXISTS uq_habit_cards_active_per_chore_member;
CREATE UNIQUE INDEX IF NOT EXISTS uq_habit_cards_active_per_member
  ON habit_cards (member_id) WHERE status = 'active';

-- [habit_cards_before_write()の作り替え・決定57-8] 3さつ上限の検査
-- （55.3a章）を撤去し、家族・メンバーの整合性検証とkind_keyの実在確認
-- （BEFORE INSERT・BEFORE UPDATEの両方）だけを残す。
CREATE OR REPLACE FUNCTION public.habit_cards_before_write()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.family_id IS DISTINCT FROM OLD.family_id OR
    NEW.member_id IS DISTINCT FROM OLD.member_id
  ) THEN
    RAISE EXCEPTION 'シール帳の持ち主はあとから変更できません' USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM family_members fm WHERE fm.id = NEW.member_id AND fm.family_id = NEW.family_id
  ) THEN
    RAISE EXCEPTION 'member_idは同じ家族のメンバーである必要があります' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM habit_figure_catalog hfc
    WHERE hfc.kind_key = NEW.kind_key AND hfc.is_active
  ) THEN
    RAISE EXCEPTION '指定された絵柄が存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_habit_cards_before_write ON habit_cards;
CREATE TRIGGER trg_habit_cards_before_write
  BEFORE INSERT OR UPDATE ON habit_cards
  FOR EACH ROW EXECUTE FUNCTION public.habit_cards_before_write();

-- [撤去] end_habit_card()は「おわりにする」の廃止（決定19撤回）に伴い
-- 丸ごと不要になる。
DROP FUNCTION IF EXISTS public.end_habit_card(UUID);

-- ------------------------------------------------------------
-- 手順10（57.4章のfamily_membersトリガーを作成したあと、既存の全
-- family_membersに対して1冊も持っていないメンバーがいないかを確認し、
-- 無ければbackfillする）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.family_members_after_insert_create_habit_card()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_kind_key TEXT;
BEGIN
  SELECT hfc.kind_key INTO v_default_kind_key
  FROM habit_figure_catalog hfc
  WHERE hfc.is_active
  ORDER BY hfc.sort_order ASC, hfc.kind_key ASC
  LIMIT 1;

  -- [防御的フォールバック] カタログが1行も無い場合はメンバー作成そのものを
  -- 失敗させない。この場合は57.5章の自己修復ロジックが後日カタログが整い
  -- 次第、初回完了報告時に1冊作る。
  IF v_default_kind_key IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO habit_cards (family_id, member_id, kind_key)
  VALUES (NEW.family_id, NEW.id, v_default_kind_key);

  RETURN NULL; -- AFTER ROWトリガーのため戻り値は無視される
END;
$$;

DROP TRIGGER IF EXISTS trg_family_members_after_insert_create_habit_card ON family_members;
CREATE TRIGGER trg_family_members_after_insert_create_habit_card
  AFTER INSERT ON family_members
  FOR EACH ROW EXECUTE FUNCTION public.family_members_after_insert_create_habit_card();

COMMENT ON TRIGGER trg_family_members_after_insert_create_habit_card ON family_members IS
  '要件定義書07-28章決定27・企画部3-3節(3)。家族に新しいメンバーが加わった瞬間（保護者・みまもり・子どものいずれも対象）に、既定の絵柄（habit_figure_catalogの並び順で先頭のkind_key）で進行中のシール帳を1冊自動的に作る。「冊は常に1冊存在する」という不変条件をテーブル構造で保証するための唯一の主経路（57.4章）。';

-- [理由] 57.4章のトリガーは「今後新しく作られるメンバー」にしか発火しない。
-- 既存の全メンバー（手順1〜5で完成扱いにした旧行しか持たないメンバーを
-- 含む）に対して「進行中の冊が1つも無い」状態を解消するのはこの
-- backfillの役目。件数に依存せず、対象0件でも安全に完了する（WHERE NOT
-- EXISTSが0件なら何も挿入しない）。
INSERT INTO habit_cards (family_id, member_id, kind_key)
SELECT fm.family_id, fm.id,
  (SELECT kind_key FROM habit_figure_catalog WHERE is_active
   ORDER BY sort_order, kind_key LIMIT 1)
FROM family_members fm
WHERE NOT EXISTS (
  SELECT 1 FROM habit_cards hc WHERE hc.member_id = fm.id AND hc.status = 'active'
);

-- ------------------------------------------------------------
-- 57.2 habit_figure_catalogへの課金区分（is_free）追加
-- ------------------------------------------------------------
ALTER TABLE habit_figure_catalog
  ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT false;

-- [初期データの是正] 現行実装の3種類（ドラゴン・うさぎ・星の精霊）は
-- 07-11章決定「無料版は現行3種類から選べる」により、いずれも無料。
UPDATE habit_figure_catalog SET is_free = true
WHERE kind_key IN ('dragon', 'rabbit', 'spirit');

-- ------------------------------------------------------------
-- 57.5 habit_card_progress_bump()の改訂（全クエスト対象・原子性）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.habit_card_progress_bump()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_card RECORD;
  v_count INT;
  v_tier TEXT;
  v_catalog_id UUID;
  v_default_kind_key TEXT;
BEGIN
  -- [決定25] reward_modeによる分岐は無い。すべての完了報告がここに来る。
  SELECT hc.* INTO v_card FROM habit_cards hc
  WHERE hc.member_id = NEW.reported_by AND hc.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    -- [1回目のNOT FOUND] 待機中に別トランザクションが次の冊を作った直後
    -- である可能性があるため、新しい文で取り直す。
    SELECT hc.* INTO v_card FROM habit_cards hc
    WHERE hc.member_id = NEW.reported_by AND hc.status = 'active'
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    -- [2回目のNOT FOUND・自己修復] 57.4章のfamily_membersトリガーが通常は
    -- 必ず1冊作っているため、通常運用では到達しない（マイグレーション適用前
    -- に作られたメンバー等のデータ不整合の場合のみ到達しうる）。完了報告
    -- そのものは失敗させない（後退しない原則）。
    SELECT hfc.kind_key INTO v_default_kind_key
    FROM habit_figure_catalog hfc
    WHERE hfc.is_active
    ORDER BY hfc.sort_order ASC, hfc.kind_key ASC
    LIMIT 1;

    IF v_default_kind_key IS NULL THEN
      RETURN NULL; -- カタログ自体が空ならここでも諦める（後退しない）
    END IF;

    INSERT INTO habit_cards (family_id, member_id, kind_key)
    VALUES (NEW.family_id, NEW.reported_by, v_default_kind_key)
    RETURNING habit_cards.* INTO v_card;
  END IF;

  -- [決定28・企画部4-2節] chore_idでは絞らない。冊が始まって以降の全
  -- クエストの完了報告を数える。
  SELECT count(*) INTO v_count
  FROM chore_completions cc
  WHERE cc.reported_by = v_card.member_id
    AND cc.reported_at >= v_card.started_at;

  v_tier := CASE
    WHEN v_count >= 100 THEN 'crystal'
    WHEN v_count >= 50  THEN 'gold'
    WHEN v_count >= 30  THEN 'silver'
    WHEN v_count >= 10  THEN 'bronze'
    ELSE NULL
  END;

  IF v_tier IS NOT NULL THEN
    SELECT hfc.id INTO v_catalog_id
    FROM habit_figure_catalog hfc
    WHERE hfc.kind_key = v_card.kind_key AND hfc.tier = v_tier AND hfc.is_active;

    IF FOUND THEN
      -- [二重付与防止・決定9系の維持] ON CONFLICT DO NOTHINGが最終防衛線。
      INSERT INTO habit_figure_grants
        (family_id, habit_card_id, member_id, tier, figure_catalog_id, triggering_completion_id)
      VALUES
        (NEW.family_id, v_card.id, v_card.member_id, v_tier, v_catalog_id, NEW.id)
      ON CONFLICT (habit_card_id, tier) DO NOTHING;
    END IF;
    -- カタログにkind_key×tierの行が無い場合（データ不整合）は、完了報告
    -- そのものを失敗させない（後退しない原則）。

    IF v_tier = 'crystal' THEN
      -- [決定27] 完成→自動アーカイブ→間を置かず次の1冊、を同一トランザ
      -- クション内で連続して行う。
      UPDATE habit_cards
      SET status = 'completed', completed_at = now(), updated_at = now()
      WHERE id = v_card.id AND status = 'active';

      -- [企画部3-3節(1)「既定は前と同じ絵柄を引き継ぐ」]
      INSERT INTO habit_cards (family_id, member_id, kind_key)
      VALUES (v_card.family_id, v_card.member_id, v_card.kind_key);
    END IF;
  END IF;

  RETURN NULL; -- AFTER ROWトリガーのため戻り値は無視される
END;
$$;

DROP TRIGGER IF EXISTS trg_habit_card_progress_bump ON chore_completions;
CREATE TRIGGER trg_habit_card_progress_bump
  AFTER INSERT ON chore_completions
  FOR EACH ROW EXECUTE FUNCTION public.habit_card_progress_bump();

COMMENT ON TRIGGER trg_habit_card_progress_bump ON chore_completions IS
  '要件定義書07-28章決定25・27・28。すべての完了報告のたびに、報告者本人の進行中のシール帳（habit_cards）を取得し、started_at以降のchore_completionsをchore_idを問わずCOUNTして累計を求め、10/30/50/100到達時にhabit_figure_grantsへ自動付与する。100（クリスタル）到達時は同一トランザクション内で完成・次の1冊の自動作成まで行う。member_pointsには一切触れない。';

-- ------------------------------------------------------------
-- 57.6 絵柄の選び直し（choose_habit_card_kind()、企画部案3-3節(1)）
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.choose_habit_card_kind(
  p_habit_card_id UUID,
  p_kind_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID := current_family_member_id();
  v_family_id UUID := current_family_id();
  v_card RECORD;
  v_progress INT;
BEGIN
  IF v_member_id IS NULL OR v_family_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT hc.* INTO v_card FROM habit_cards hc
  WHERE hc.id = p_habit_card_id AND hc.family_id = v_family_id
    AND hc.member_id = v_member_id AND hc.status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '対象のシール帳が見つかりません' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM habit_figure_catalog hfc
    WHERE hfc.kind_key = p_kind_key AND hfc.is_active
  ) THEN
    RAISE EXCEPTION '指定された絵柄が存在しないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- [設計書との食い違い・実装上の訂正・開発部が発見し報告する点・その3
  -- 「境界の完了報告がどちらの冊に属するか」問題] クリスタル到達（100件目）の
  -- その完了報告は、`habit_card_progress_bump()`が同一トランザクション内で
  -- 「旧の冊を完成させる（completed_at=now()）」と「次の冊を作る
  -- （started_at=now()）」を連続して行うため、**その完了報告のreported_atと
  -- 次の冊のstarted_atが1マイクロ秒までまったく同じ値になる**（PostgreSQLの
  -- `now()`はトランザクション内で固定されるため、実運用の1件ずつの完了報告
  -- でも必ずこうなる。テスト環境固有の現象ではない）。下記のとおり`>=`
  -- （境界を含む）で判定すると、クリスタルを100件目にした完了報告そのものが
  -- 「次の冊」に属するとみなされてしまい、**冊が完成した直後は常に
  -- 進行中の冊の累計が0ではなく1になる**——つまり決定42「クリスタル到達の
  -- 直後に絵柄を選び直せる」が実運用で一度も成立しない（常にこの
  -- check_violationで拒否される）ことを、実際にREST API経由で100件到達
  -- させて確認した（開発部/成果物/実装メモ.md 256章）。**境界の完了報告は
  -- 「それを100件目にして完成させた旧の冊」に属するべきであり、「次の冊」に
  -- 属するべきではない**ため、下限を`>`（境界を含めない）に訂正する。
  SELECT count(*) INTO v_progress
  FROM chore_completions cc
  WHERE cc.reported_by = v_card.member_id AND cc.reported_at > v_card.started_at;

  IF v_progress > 0 THEN
    RAISE EXCEPTION 'すでに始まっているシール帳の絵柄は変えられません' USING ERRCODE = 'check_violation';
  END IF;

  -- [57.2章決定57-4] 課金判定は当面行わない（ベータ期間は全部使える）。
  UPDATE habit_cards SET kind_key = p_kind_key, updated_at = now()
  WHERE id = v_card.id;

  RETURN v_card.id;
END;
$$;

COMMENT ON FUNCTION public.choose_habit_card_kind(UUID, TEXT) IS
  '要件定義書07-28章決定29・企画部3-3節(1)。自分の進行中のシール帳の絵柄を選び直す。何も積み上がっていない（累計0件の）間だけ変更できる（57.6章、設計部の判断）。課金によるプラン判定は今回実装しない（ベータ無料期間、07-11章）。';

REVOKE ALL ON FUNCTION public.choose_habit_card_kind(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.choose_habit_card_kind(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 57.7 内訳・期間のView（habit_card_chore_breakdown）
-- ------------------------------------------------------------
-- [設計書との食い違い・実装上の訂正・開発部が発見し報告する点・その3の続き]
-- `choose_habit_card_kind()`と同じ理由（上記コメント参照）で、本Viewの境界も
-- 訂正する。「冊が完成したちょうどその完了報告」は、旧の冊の内訳に含め
-- （`(hc.started_at, hc.completed_at]`、上限を`<=`にする）、次の冊の内訳には
-- 含めない（下限を`>`にする）。この訂正により、決定30「完成してしまわれた
-- 冊には内訳を付ける」が完成の決め手になった1件を取りこぼさなくなる
-- （旧`<`のままだと、100件目のクエストが内訳に一切現れないという別の実害も
-- あった）。
CREATE OR REPLACE VIEW habit_card_chore_breakdown
WITH (security_invoker = true) AS
SELECT
  hc.id AS habit_card_id,
  hc.family_id,
  hc.member_id,
  hc.started_at,
  hc.completed_at,
  cc.chore_id,
  COUNT(*)::INT AS completion_count
FROM habit_cards hc
JOIN chore_completions cc
  ON cc.reported_by = hc.member_id
  AND cc.family_id = hc.family_id
  AND cc.reported_at > hc.started_at
  AND (hc.completed_at IS NULL OR cc.reported_at <= hc.completed_at)
GROUP BY hc.id, hc.family_id, hc.member_id, hc.started_at, hc.completed_at, cc.chore_id;

COMMENT ON VIEW public.habit_card_chore_breakdown IS
  '要件定義書07-28章決定30・31。1冊（habit_card_id）ごとの、クエスト別の完了報告件数の内訳。進行中・完成済みのどちらの冊も対象になる（completed_atがNULLなら進行中で、now()までを範囲とみなす）。security_invoker=trueのためhabit_cards・chore_completionsそれぞれのRLSがそのまま適用される。「多い順に上位5件＋ほか◯件」（企画部3-3節(2)）は画面側の仕事（API仕様.md 17章参照）。';

-- [支える索引] habit_card_progress_bump()（完了報告のたびに必ず発火する
-- ホットパス）も全く同じ形の条件でCOUNTするため、新しい複合索引を追加する。
CREATE INDEX IF NOT EXISTS idx_chore_completions_reported_by_reported_at
  ON chore_completions(reported_by, reported_at);
