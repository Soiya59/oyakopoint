-- ============================================================
-- 感謝ポイントへの「スタンプの返し」（gratitude_reactions）（2026-10-03）
-- ============================================================
-- 参照（すべて2026-10-03にコミット済みの設計）:
--   企画部/成果物/要件定義書.md 07-45章（決定1〜13）
--   設計部/成果物/スキーマ設計.sql 83章（決定83-1〜83-16。DDLは83.3〜83.7章のとおり）
--   設計部/成果物/API仕様.md 39章
--   開発部/成果物/実装メモ.md 347章
--
-- [内容（追加のみ。破壊的な操作は無い）]
--   1. 許可リスト関数 gratitude_stamp_keys()   ※表のCHECKが参照するので表より先
--   2. 表 gratitude_reactions（列は4つだけ。押した人のメンバーIDを持たない）
--   3. 索引・RLS（SELECTは贈った人と受け取った人の2人だけ）・GRANT/REVOKE
--   4. RPC toggle_gratitude_stamp()（書き込みはこれだけ）
--   5. 感謝ポイントの取り消し（revoked_at のUPDATE）に連動してスタンプを消すトリガー
--
-- [変えないもの] gratitude_points の列・CHECK・RLS3本・既存トリガー、通知（notify-gratitude・
-- Vault）、chore_reactions・family_board_reactions・family_drawing_reactions。
--
-- [出す順序] DB（本マイグレーション）が先、アプリ（OTA）があと。DBが先なら古いアプリは何も変わらない。
-- [ロールバック] スキーマ設計.sql 83.12章（トリガー→RPC→表→関数の順にDROP。OTAを先に戻す）。
-- [通知] しない。この表にトリガーを付けないこと（要件定義書07-45章 決定6）。

-- ------------------------------------------------------------
-- 83.3 許可リスト関数 gratitude_stamp_keys()
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gratitude_stamp_keys()
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ARRAY['ganbatta', 'arigato', 'sugoi', 'tasukatta']::text[];
$$;

COMMENT ON FUNCTION public.gratitude_stamp_keys() IS
  '感謝ポイントへのスタンプ（gratitude_reactions）に使える種類（stamp_key）の許可リスト。要件定義書07-45章。完了報告・掲示板・お絵かきと同じ4種（src/theme/theme.tsのstampDefinitionsのkeyと同じ。tasukattaは旧「たすかったよ」のキーのまま）。表のCHECK制約とtoggle_gratitude_stamp()の両方がこの関数だけを見る（定義は1か所）。減らすときは、先に該当キーの行をDELETEしてから差し替える（スキーマ設計.sql 83.2章 判断G）。完了報告・掲示板・お絵かきのスタンプはこの関数を使わない（別の系統）。';

-- クライアントから直接呼べる必要が無い（CHECK制約とRPCの中からしか使わない）のでREVOKEする。
REVOKE ALL ON FUNCTION public.gratitude_stamp_keys() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 83.4 表 gratitude_reactions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gratitude_reactions (
  gratitude_id UUID PRIMARY KEY REFERENCES gratitude_points(id) ON DELETE CASCADE,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  stamp_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT chk_gratitude_reactions_stamp_key CHECK (stamp_key = ANY (public.gratitude_stamp_keys()))
);

CREATE INDEX IF NOT EXISTS idx_gratitude_reactions_family_id ON gratitude_reactions(family_id);

ALTER TABLE gratitude_reactions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE gratitude_reactions IS
  '感謝ポイント（gratitude_points）へのスタンプの返し（要件定義書07-45章）。1つの感謝に最大1行（gratitude_idが主キー）。押せるのは受け取った本人だけ（toggle_gratitude_stamp()が確かめる）。読めるのは贈った人と受け取った人の2人だけ（RLS）。押した人のメンバーIDは持たない（gratitude_points.recipient_idで分かる。family_membersへの外部キーを足さない）。感謝が取り消されたら一緒に消える（取消トリガー＋RLS）。家族を削除すると消える（ON DELETE CASCADE）。種類はgratitude_stamp_keys()の4種だけ（CHECK）。**プッシュ通知は鳴らさない。この表にトリガーを付けないこと**（07-45章決定6。スタンプでは鳴らさないという統括判断U2・07-43章2-4節に揃える。届き方は贈った人のベルだけ）。**「家族のやりとりを使う」トグル（families.social_interactions_enabled）のガードは付けない**（07-45章決定11。スタンプは自由記述ではなく、完了報告のスタンプ4種が止まらないのと同じ。トグルがオフでも押せる）。集計・順位・横断のView・関数を作らない（決定10）。直接のINSERT・UPDATE・DELETEは権限ごと閉じてあり、書き込みはRPCだけ。';

COMMENT ON COLUMN gratitude_reactions.gratitude_id IS
  '対象の感謝ポイント（gratitude_points.id）。主キー兼外部キー。感謝が消える（家族削除）と一緒に消える。';
COMMENT ON COLUMN gratitude_reactions.family_id IS
  '感謝ポイントの行から写した家族ID（toggle_gratitude_stamp()が入れる。クライアントは送らない）。家族削除のCASCADEと07-33章の検査のために持つ。メンバーIDではない。';
COMMENT ON COLUMN gratitude_reactions.stamp_key IS
  'スタンプの種類。gratitude_stamp_keys()の4種のどれか（CHECK制約）。';
COMMENT ON COLUMN gratitude_reactions.created_at IS
  '押した時刻。入れ替えたときは新しい時刻になる（贈った人のベルには新しいスタンプとして届く。07-45章決定2）。';

-- ------------------------------------------------------------
-- 83.5 RLSと権限（読めるのは2人だけ・書き込みはRPCだけ）
-- ------------------------------------------------------------
-- 保護者・みまもりでも、当事者（贈った人・受け取った人）でなければ読めない。
-- 取り消し済みの感謝のスタンプは読めない（取消トリガーとの二重の守り）。
DROP POLICY IF EXISTS "gratitude_reactions_select_sender_or_recipient" ON gratitude_reactions;
CREATE POLICY "gratitude_reactions_select_sender_or_recipient" ON gratitude_reactions
  FOR SELECT
  USING (
    family_id = current_family_id()
    AND EXISTS (
      SELECT 1
      FROM gratitude_points gp
      WHERE gp.id = gratitude_reactions.gratitude_id
        AND gp.revoked_at IS NULL
        AND (
          gp.sender_id = current_family_member_id()
          OR gp.recipient_id = current_family_member_id()
        )
    )
  );

-- INSERT・UPDATE・DELETEのポリシーは作らない（書き込みは下のRPCだけ）。

-- 開発部/CLAUDE.md「新しい表を作るときのGRANT」。決まり文句（4権限）より狭くする:
-- authenticatedにはSELECTだけ。anonには何も付けない。
REVOKE ALL ON public.gratitude_reactions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gratitude_reactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.gratitude_reactions TO service_role;

-- ------------------------------------------------------------
-- 83.6 RPC toggle_gratitude_stamp()
-- ------------------------------------------------------------
-- 呼び出した人が「受け取った感謝」にだけスタンプを1つ押せる。同じ種類をもう一度＝取り消し、別の種類＝入れ替え。
-- 戻り値: removed（取り消したら true）・current_stamp_key（今付いている種類。取り消したら NULL）。
-- 列名衝突の自己確認: 出力列 removed・current_stamp_key は、触れる表の列名のどれとも一致しない。
-- 本文の列参照はすべて表の別名付き（gp.・fm.・gr.）。ON CONFLICT は使わない（DELETEしてからINSERT）。
CREATE OR REPLACE FUNCTION public.toggle_gratitude_stamp(
  p_gratitude_id UUID,
  p_stamp_key TEXT
)
RETURNS TABLE (
  removed BOOLEAN,
  current_stamp_key TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id UUID := current_family_id();
  v_member_id UUID := current_family_member_id();
  v_sender_id UUID;
  v_had_same BOOLEAN;
BEGIN
  IF v_family_id IS NULL OR v_member_id IS NULL THEN
    RAISE EXCEPTION 'ログインが必要です' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1. 種類の確認（許可リストは関数1か所。表のCHECKも同じ関数）。
  IF p_stamp_key IS NULL OR NOT (p_stamp_key = ANY (public.gratitude_stamp_keys())) THEN
    RAISE EXCEPTION 'このスタンプは使えません'
      USING ERRCODE = 'check_violation', HINT = 'gratitude_stamp_not_allowed';
  END IF;

  -- 2. 対象の感謝を探してロックする。自家族・自分が受け取った本人・取り消されていない、を1回のSELECTで確かめる。
  --    どれかが違う場合（存在しないID・他家族・贈った本人・第三者・取り消し済み）はすべて
  --    「見つかりません」に収束する（区別しない）。FOR UPDATEは二重タップと取り消しとの競合を防ぐ。
  SELECT gp.sender_id INTO v_sender_id
  FROM gratitude_points gp
  WHERE gp.id = p_gratitude_id
    AND gp.family_id = v_family_id
    AND gp.recipient_id = v_member_id
    AND gp.revoked_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'この感謝が見つかりません' USING ERRCODE = 'no_data_found';
  END IF;

  -- 3. 贈った人が在籍中であること（抜けていれば見る人がいない）。
  IF NOT EXISTS (
    SELECT 1
    FROM family_members fm
    WHERE fm.id = v_sender_id
      AND fm.family_id = v_family_id
      AND fm.is_active
  ) THEN
    RAISE EXCEPTION 'この感謝を贈った人は、もう家族にいないため、スタンプは押せません'
      USING ERRCODE = 'check_violation', HINT = 'gratitude_sender_left';
  END IF;

  -- 4. 同じ種類がすでに付いているか（取り消しの判定）。
  SELECT EXISTS (
    SELECT 1
    FROM gratitude_reactions gr
    WHERE gr.gratitude_id = p_gratitude_id
      AND gr.stamp_key = p_stamp_key
  ) INTO v_had_same;

  -- 5. 今付いているスタンプ（種類を問わず）をいったん消す。
  DELETE FROM gratitude_reactions gr
  WHERE gr.gratitude_id = p_gratitude_id;

  IF v_had_same THEN
    RETURN QUERY SELECT true, NULL::text;
    RETURN;
  END IF;

  -- 6. 新しい種類を付ける（未送信、または別の種類への入れ替え）。family_idは確かめた感謝の家族から写す。
  INSERT INTO gratitude_reactions (gratitude_id, family_id, stamp_key)
  VALUES (p_gratitude_id, v_family_id, p_stamp_key);

  RETURN QUERY SELECT false, p_stamp_key;
END;
$$;

COMMENT ON FUNCTION public.toggle_gratitude_stamp(UUID, TEXT) IS
  '感謝ポイントへのスタンプの返し（要件定義書07-45章）。呼び出した人が受け取った感謝にだけ、スタンプを1つ押せる。同じ種類をもう一度押すと取り消し、別の種類なら入れ替え。返り値は(removed, current_stamp_key)。種類はgratitude_stamp_keys()の4種だけ。感謝が無い・他家族・受け取った本人でない・取り消し済みはすべて「見つかりません」。贈った人が家族から抜けているときは押せない。感謝の行をFOR UPDATEでロックして二重タップ・取り消しとの競合を防ぐ。通知はしない。やりとりトグルのガードは付けない。直接のINSERT・UPDATE・DELETEは権限ごと閉じてあり、書き込みはこの関数だけ。（スキーマ設計.sql 83.6章）';

REVOKE ALL ON FUNCTION public.toggle_gratitude_stamp(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.toggle_gratitude_stamp(UUID, TEXT) TO authenticated;

-- ------------------------------------------------------------
-- 83.7 感謝ポイントの取り消しに連動してスタンプを消すトリガー
-- ------------------------------------------------------------
-- 取消は revoked_at を設定するUPDATEで、物理DELETEではないため ON DELETE CASCADE は働かない。
-- AFTER UPDATE なので、既存の BEFORE UPDATE トリガー（5分以内・送り手のみ・revoked_at以外は不変）を
-- すべて通ったあとにだけ動く。取り消しをするのは送り手でスタンプ表への権限が無いので SECURITY DEFINER。
CREATE OR REPLACE FUNCTION public.gratitude_points_after_revoke_delete_reaction()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM gratitude_reactions gr
  WHERE gr.gratitude_id = NEW.id;
  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.gratitude_points_after_revoke_delete_reaction() IS
  '感謝ポイントが取り消された（revoked_atが設定された）とき、その感謝へのスタンプを同じトランザクションで消す（要件定義書07-45章決定4）。取消はUPDATEでありON DELETE CASCADEが働かないため。gratitude_pointsの列・既存トリガーには触れない（スキーマ設計.sql 83.7章）。';

REVOKE ALL ON FUNCTION public.gratitude_points_after_revoke_delete_reaction() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_gratitude_points_after_revoke_delete_reaction ON gratitude_points;
CREATE TRIGGER trg_gratitude_points_after_revoke_delete_reaction
  AFTER UPDATE OF revoked_at ON gratitude_points
  FOR EACH ROW
  WHEN (OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL)
  EXECUTE FUNCTION public.gratitude_points_after_revoke_delete_reaction();
