-- ============================================================
-- おねがいのポイントを「頼むときに決める（0〜3pt・事前承認）」に変える
--   要件定義書07-43章 2026-09-30再改訂（決定20〜27）・統括回答U9〜U12（7-1節）・
--   決定25の補足、設計部/成果物/スキーマ設計.sql 82.19章（82.19.1〜82.19.14・決定82-23〜82-32）、
--   API仕様.md 38.14章、開発部/成果物/実装メモ.md 341章
-- ============================================================
-- [非破壊] 既存行は1行も変えない（本番のおねがいはすべて0ptのまま、「ポイントなしのおねがい」として残る。
--   決定27-8）。関数を1つ足し、関数を1つ再定義し、CHECK制約を1本差し替え、COMMENTを4件書くだけ。
--   表・列・索引・RLS・GRANT・トリガー本体・通知・感謝ポイント・chore_completions系の関数は変えない。
--   ロールバックは勧めない（ポイント付きのおねがいが1行でもあると、chk_chores_request_shapeに
--   points = 0 を戻せない）。問題が出たらアプリ（OTA）を1つ前に戻す。古いアプリは points:0 で
--   送るので、新しいDBでも動く（82.19.8章）。
-- [出す順序] このmigrationを先（DB）→ OTAをあと。逆にすると、新しいアプリのポイント付きの作成を
--   古いDBのguardが check_violation で断る（ローカルでPT28として確認した）。
-- [記述順] 上限の定数関数 → guardの再定義 → REVOKE → CHECKの差し替え → COMMENT。
-- [guardの差分] chores_request_guard()の本文は、配信済みの20261001010000の版と diff して、
--   差がINSERT検査の points の1ブロック（旧: points IS DISTINCT FROM 0 の検査）だけであることを確認した。
--   CREATE OR REPLACEは関数全体の書き換えで、55章→57章で chores_before_write() の検証が
--   丸ごと消えた前例があるため。消えていないことは rls_checks.sql のC-R13が本文の主要語で確かめる。
-- [再実行] CREATE OR REPLACE・DROP CONSTRAINT IF EXISTSのため、何度流しても同じ結果になる。
-- [列名衝突の確認（設計部CLAUDE.md）] 追加・再定義する関数はRETURNS TABLEを使わない
--   （max_request_pointsはRETURNS INT、guardはRETURNS TRIGGER）ため、column reference is ambiguousは
--   原理的に起きない。guard本文の表の列参照は20261001010000と同じく別名（fm・c・cc）付きで、
--   今回足したpointsの検査は NEW.points（トリガーの行変数）と定数関数の呼び出しだけ。
-- [1つのトランザクション] CHECKのDROP→ADDはACCESS EXCLUSIVEロックの下で行われ、コミットまで他の
--   セッションから「CHECKが無い状態」は見えない。choresは小さいので、ADD時の全件検証は一瞬。
-- ============================================================

-- (1) 上限の単一の定義（決定27-2。おねがいのポイントの上限）
-- 感謝ポイントの gratitude_daily_allowance() とは別の定数。値が同じ3でも、意図が違う
-- （感謝＝「贈る量」の1日の上限／これ＝おねがいの「約束の幅」）。片方から他方を呼ばない・
-- 片方の値を他方に代入しない（決定20。rls_checks.sqlのC-R12が本文を見て連動していないことを確かめる）。
-- REVOKEしない（max_open_requests_per_child()と同じ。guardがSECURITY INVOKERで、呼び出し元
-- authenticated・service_roleの権限でこの関数を呼ぶため。定数を返すだけで秘匿情報は無い。S4に+1）。
CREATE OR REPLACE FUNCTION public.max_request_points()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$ SELECT 3; $$;

COMMENT ON FUNCTION public.max_request_points() IS
  '要件定義書07-43章決定20・27（2026-09-30再改訂）。おねがいを頼むときに決めるポイント（chores.points）の上限の単一の定義箇所（値3。下限0は既存のchk_chores_points_nonnegativeが持つ）。chores_request_guard()が、おねがいの作成時に0以上この値以下であることを検査する。CHECK制約には上限を書かない（将来この値を下げても、既存のおねがいの行は違反にならず、題名の変更も失敗しない。値を上げる変更も既存データに影響しない）。感謝ポイントの1日の上限gratitude_daily_allowance()とは意図が別の定数で、連動させない。アプリのtheme.requestLimit.maxPointsとrls_checks.sqlのC-R11と必ず同じ値にする（自動でそろえる仕組みは無い）。上げるときはDB→アプリ、下げるときはアプリ→DBの順に当てる。';

-- (2) 検証関数の再定義。変えるのはINSERT検査の points の1ブロックだけ（【2026-09-30再改訂】の印の箇所）。
CREATE OR REPLACE FUNCTION public.chores_request_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_assignee_ok BOOLEAN;
  v_open_count INT;
  v_is_client BOOLEAN := (current_user IN ('authenticated', 'anon'));
BEGIN
  -- ---- DELETE（おねがいの取り下げ）----
  IF TG_OP = 'DELETE' THEN
    -- やってくれたあと（完了報告が1件でもある）のおねがいは、クライアントからは取り下げられない。
    -- 家族の削除（テーブル所有者としてのCASCADE）・運営作業（service_role）は止めない。
    IF OLD.is_request AND v_is_client THEN
      IF EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.chore_id = OLD.id) THEN
        RAISE EXCEPTION 'やってくれたあとのおねがいは、取り下げられません'
          USING ERRCODE = 'insufficient_privilege', HINT = 'chore_request_completed';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- 通常のクエスト（is_request=false）は何も検査しない（決定19。既存の作成経路に影響しない）。
    IF NOT NEW.is_request THEN
      RETURN NEW;
    END IF;

    IF NEW.scope IS DISTINCT FROM 'family' THEN
      RAISE EXCEPTION 'おねがいは家族共有のクエストとしてだけ作れます' USING ERRCODE = 'check_violation';
    END IF;
    -- 【2026-09-30再改訂・要件定義書07-43章決定20・27】ポイントは「0以上max_request_points()以下」。
    -- NULLもここで断る（NOT NULL制約はBEFOREトリガーより後に評価されるため、NULLをここで見ないと
    -- 「ポイントは0〜3まで」ではなく別のエラーになる）。負の数も断る（既存のchk_chores_points_nonnegative
    -- と同じ向きの二重の守り）。断るときのSQLSTATEはcheck_violationのまま。上限の値は
    -- 定数関数の1か所にだけあり、CHECK制約には書かない（決定27-1）。
    IF NEW.points IS NULL
       OR NEW.points < 0
       OR NEW.points > public.max_request_points() THEN
      RAISE EXCEPTION 'おねがいのポイントは0〜%までです', public.max_request_points()
        USING ERRCODE = 'check_violation', HINT = 'chore_request_points_out_of_range';
    END IF;
    IF NEW.is_repeatable IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'おねがいは1回だけのものとして作ってください' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.daily_limit IS NOT NULL THEN
      RAISE EXCEPTION 'おねがいには1日の回数の上限を付けられません' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.category_id IS NOT NULL OR NEW.nfc_tag_id IS NOT NULL THEN
      RAISE EXCEPTION 'おねがいにはカテゴリー・NFCタグを付けられません' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'おねがいは有効な状態で作ってください' USING ERRCODE = 'check_violation';
    END IF;

    -- 担当: 同じ家族の在籍中の子ども（role='child'）1人。他表を見るのでCHECKでは書けない。
    -- （NULL＝誰でも実行可は、おねがいでは作れない。早い者勝ちになり比較を生むため。決定16）
    SELECT EXISTS (
      SELECT 1
      FROM family_members fm
      WHERE fm.id = NEW.assigned_to
        AND fm.family_id = NEW.family_id
        AND fm.role = 'child'
        AND fm.is_active
    ) INTO v_assignee_ok;

    IF NEW.assigned_to IS NULL OR NOT v_assignee_ok THEN
      RAISE EXCEPTION 'おねがいの相手は、この家族の在籍中の子どもを指定してください' USING ERRCODE = 'check_violation';
    END IF;

    -- 【統括の追加決定1】未完了のおねがいは子ども1人につき3つまで（82.4a章）。
    -- 同じ子どもへの同時の作成でも上限を超えないよう、その子どもを単位にした
    -- トランザクション単位のアドバイザリロックを先に取ってから数える。
    PERFORM pg_advisory_xact_lock(hashtextextended('chore_request_limit:' || NEW.assigned_to::text, 0));

    SELECT count(*) INTO v_open_count
    FROM chores c
    WHERE c.family_id = NEW.family_id
      AND c.assigned_to = NEW.assigned_to
      AND c.is_request
      AND c.is_active
      AND NOT EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.chore_id = c.id);

    IF v_open_count >= public.max_open_requests_per_child() THEN
      RAISE EXCEPTION 'この子への、まだ終わっていないおねがいがいっぱいです（%件まで）。やってくれたあと、または取り下げたあとで作れます',
        public.max_open_requests_per_child()
        USING ERRCODE = 'RQ001', HINT = 'chore_request_limit_reached';
    END IF;

    -- 絵文字はサーバーが💌に固定する（クライアントが入れ忘れても、別の絵文字を送っても、
    -- ここで上書きする。CHECK制約chk_chores_request_shapeがこの後で最終確認する）。
    NEW.emoji := '💌';
    RETURN NEW;
  END IF;

  -- ---- UPDATE ----
  -- おねがいかどうかは、どちらの向きにも変えられない。
  IF NEW.is_request IS DISTINCT FROM OLD.is_request THEN
    RAISE EXCEPTION 'おねがいかどうかは作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 通常のクエストの更新は何も検査しない（既存の編集経路に影響しない）。
  IF NOT OLD.is_request THEN
    RETURN NEW;
  END IF;

  -- おねがいの行で変えてよいのは、題名（title）・有効フラグ（is_active）・
  -- 担当が「値あり→NULL」になる変化（ON DELETE SET NULLの自動UPDATE）だけ。
  IF NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.scope IS DISTINCT FROM OLD.scope
     OR NEW.category_id IS DISTINCT FROM OLD.category_id
     OR NEW.emoji IS DISTINCT FROM OLD.emoji
     OR NEW.points IS DISTINCT FROM OLD.points
     OR NEW.is_repeatable IS DISTINCT FROM OLD.is_repeatable
     OR NEW.daily_limit IS DISTINCT FROM OLD.daily_limit
     OR NEW.nfc_tag_id IS DISTINCT FROM OLD.nfc_tag_id
     OR (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to AND NEW.assigned_to IS NOT NULL)
  THEN
    RAISE EXCEPTION 'おねがいは、題名のほかは作成後に変更できません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 【統括の追加決定4】やってくれたあと（完了報告が1件でもある）のおねがいは、題名の変更・
  -- 取り下げ（is_activeをfalseにする）ができない。クライアントのロールのときだけ働かせる
  -- （家族削除・運営作業・ON DELETE SET NULLの自動UPDATEを止めない）。
  IF v_is_client
     AND (NEW.title IS DISTINCT FROM OLD.title
          OR (OLD.is_active AND NOT NEW.is_active))
     AND EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.chore_id = OLD.id) THEN
    RAISE EXCEPTION 'やってくれたあとのおねがいは、題名を変えたり取り下げたりできません'
      USING ERRCODE = 'insufficient_privilege', HINT = 'chore_request_completed';
  END IF;

  -- 【統括の追加決定1】取り下げ済み（is_active=false）を有効に戻すことで、未完了のおねがいが
  -- 上限を超えてしまう抜け道を塞ぐ。未完了に戻る場合だけ、INSERTと同じ検査をする。
  -- （自分自身はis_active=falseの間は数えられていないので、count >= 上限 でよい）
  IF NEW.is_active AND NOT OLD.is_active
     AND NEW.assigned_to IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.chore_id = OLD.id) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('chore_request_limit:' || NEW.assigned_to::text, 0));

    SELECT count(*) INTO v_open_count
    FROM chores c
    WHERE c.family_id = NEW.family_id
      AND c.assigned_to = NEW.assigned_to
      AND c.is_request
      AND c.is_active
      AND c.id <> NEW.id
      AND NOT EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.chore_id = c.id);

    IF v_open_count >= public.max_open_requests_per_child() THEN
      RAISE EXCEPTION 'この子への、まだ終わっていないおねがいがいっぱいです（%件まで）。やってくれたあと、または取り下げたあとで作れます',
        public.max_open_requests_per_child()
        USING ERRCODE = 'RQ001', HINT = 'chore_request_limit_reached';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
-- （トリガー本体trg_chores_request_guardは作り直さない。関数を差し替えるだけで、BEFORE INSERT OR UPDATE
--   OR DELETEの1本のまま新しい本文で動く。rls_checks.sqlのC-R10が引き続き31を確認する）

COMMENT ON FUNCTION public.chores_request_guard() IS
  '要件定義書07-43章決定10・20・27・統括の追加決定（2026-09-30、再改訂で更新）。is_request=trueのchoresの作成時（ポイントは0以上max_request_points()以下・1回だけ・家族共有・担当は同じ家族の在籍中の子ども・絵文字は💌に上書き・未完了のおねがいは子ども1人につきmax_open_requests_per_child()件まで＝超えたらSQLSTATE RQ001）と、更新時（is_request不変・題名とis_active以外不変＝ポイントも変えられない。担当は値あり→NULLだけ許す＝ON DELETE SET NULL。やってくれたあとの題名変更・取り下げはクライアントのロールに限り拒否）と、削除時（やってくれたあとのおねがいはクライアントのロールに限り拒否）を検証する。ポイントの範囲外・NULL・負の数はSQLSTATE check_violation・HINT chore_request_points_out_of_range。通常のクエストは素通し（ポイントの上限は掛からない）。chores_before_write()には足さない（55章→57章で全面書き換えされて足した検証が消えた前例のため）。担当が必須のCHECK制約は作らない（assigned_toのON DELETE SET NULLと衝突し、子どもの削除が失敗するため）。未完了＝完了報告（chore_completions）が1件も無い有効なおねがい。';

-- 関数の権限は CREATE OR REPLACE では失われないが、念のため再度REVOKEする（20261001010000と同じ）。
REVOKE ALL ON FUNCTION public.chores_request_guard() FROM PUBLIC, anon, authenticated;

-- (3) 形のCHECK制約の差し替え（決定27-1）。points の項を外す。ポイントの下限（0以上）は既存の
--   chk_chores_points_nonnegativeが持ち、上限はguardが max_request_points() で見る。
--   制約の名前は変えない（rls_checks.sqlのC-R4が名前で有効性を確かめている）。
ALTER TABLE chores DROP CONSTRAINT IF EXISTS chk_chores_request_shape;
ALTER TABLE chores
  ADD CONSTRAINT chk_chores_request_shape
  CHECK (
    NOT is_request
    OR (
      is_repeatable = false
      AND daily_limit IS NULL
      AND scope = 'family'
      AND emoji IS NOT DISTINCT FROM '💌'
      AND category_id IS NULL
      AND nfc_tag_id IS NULL
    )
  );

COMMENT ON CONSTRAINT chk_chores_request_shape ON chores IS
  '要件定義書07-43章決定10・27。おねがい（is_request=true）の行の形: 1回だけ・daily_limitなし・家族共有・絵文字💌・カテゴリー/NFCなし。**pointsの項は意図的に含めない**（2026-09-30再改訂。上限を将来下げたときに既存のおねがいが違反にならないよう、ポイントの範囲はchores_request_guard()が作成時にだけmax_request_points()で検査する。下限0は既存のchk_chores_points_nonnegative）。assigned_toを含めない（ON DELETE SET NULLと衝突するため）。rls_checks.sqlのC-R15が、この定義にpointsが含まれないことを確かめている。';

-- (4) 列COMMENTの更新（メタデータのみ）
COMMENT ON COLUMN chores.is_request IS
  '要件定義書07-43章決定10・20・27。保護者が専用の入口「おねがいする」から作った依頼ならtrue。通常のクエスト（1回だけ・0ptを含む）は常にfalse。作成時にchores_request_guard()とchk_chores_request_shapeが形（ポイントは0以上max_request_points()以下＝頼むときに決める約束のポイント・1回だけ・担当は在籍中の子ども・家族共有・絵文字は💌固定）を強制し、作成後はこの列を変更できない（題名とis_active以外も変更不可＝約束のポイントも後から変えられない。担当がON DELETE SET NULLでNULLになる変化だけは許す）。担当がNULLのis_request行（担当だった子どもがいなくなった行）は、一覧に出さず通知も送らない。2026-09-30の再改訂より前に作られたおねがいはすべて0pt（ポイントなしのおねがい）のまま残る。';
