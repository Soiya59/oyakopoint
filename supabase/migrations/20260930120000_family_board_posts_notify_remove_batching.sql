-- ============================================================
-- 家族の掲示板の投稿通知: 連投15分据え置きの廃止 — 新設・2026-09-22
-- 参照: 開発部/成果物/実装メモ.md 285.4章（統括の決定・理由）・285.2章
--       （発見の経緯）、元の関数の定義は
--       supabase/migrations/20260930110000_push_notifications.sql
--       （このファイルは書き換えない。本番に適用済みのため）
-- ============================================================
-- [統括の決定・2026-09-22 本人発言] 「LINEでも同じだし、15分のはいらない
-- と思う」。掲示板に書き込みがあれば、同じ人が続けて書いた分も含めて
-- 毎回通知する。
--
-- 理由（実装メモ285.4章に詳細）:
--   - 通知の文面は「◯◯さんが書き込みました」だけで中身を出さないため、
--     2通目を抑えると2通目が書かれた事実そのものが誰にも伝わらない。
--   - 家族の掲示板は1日に何十回も動くものではなく、「鳴らしすぎ」より
--     「書かれたことが黙って流れる」ほうが損が大きい。
--   - LINE等の一般的なメッセージアプリと同じ挙動になり、利用者にとって
--     説明が要らない。
--
-- 却下した代替案（本部長提案・実装メモ285.3章候補A/B）: 取り消した投稿も
-- 連投の数に入れて穴を塞ぐ案。据え置きの仕組み自体を廃止したため不要に
-- なった。
--
-- [変更点] 元の関数（20260930110000）が持っていた4ブロックのうち、
--   (1) 家族単位トグル判定 → そのまま残す
--   (2) 連投15分据え置き判定 → ★このブロックを削除する
--   (3) 送信内容の組み立て（送り先0件なら何もしない） → そのまま残す
--   (4) Vault経由のnet.http_post・EXCEPTION WHEN OTHERS → そのまま残す
-- CREATE OR REPLACE FUNCTIONで置き換えるため、トリガー
-- （trg_family_board_posts_after_insert_notify）の再作成は不要
-- （関数名・シグネチャ・戻り値型はいずれも変えていない）。
-- ============================================================

CREATE OR REPLACE FUNCTION public.family_board_posts_after_insert_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_notify_enabled BOOLEAN;
  v_payload jsonb;
  v_url TEXT;
  v_bearer TEXT;
BEGIN
  -- (1) 家族単位トグル（要件定義書07-37章3章）。falseなら以降を一切行わない。
  -- 判定できないときは「送らない」側に倒す（スキーマ設計.sql 74.3章の既定
  -- falseと対にした安全側の選択）。
  SELECT f.push_notifications_enabled INTO v_family_notify_enabled
  FROM families f WHERE f.id = NEW.family_id;

  IF NOT COALESCE(v_family_notify_enabled, false) THEN
    RETURN NEW;
  END IF;

  -- (2) 送信内容の組み立て（family_board_post_notification_payload()）。
  -- 送り先が0件なら何もしない。
  v_payload := public.family_board_post_notification_payload(NEW.id);

  IF v_payload IS NULL
     OR jsonb_array_length(COALESCE(v_payload->'recipient_tokens', '[]'::jsonb)) = 0 THEN
    RETURN NEW;
  END IF;

  -- (3) Vaultから呼び出し先を読み、net.http_postで非同期に呼ぶ。
  BEGIN
    SELECT vs.decrypted_secret INTO v_url
    FROM vault.decrypted_secrets vs WHERE vs.name = 'family_board_post_notify_url';

    SELECT vs.decrypted_secret INTO v_bearer
    FROM vault.decrypted_secrets vs WHERE vs.name = 'family_board_post_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      RAISE WARNING 'family_board_posts notify skipped for % (vault secrets not configured)', NEW.id;
    ELSE
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || v_bearer),
        body    := v_payload
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'family_board_posts notify failed for %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.family_board_posts_after_insert_notify() IS
  '要件定義書07-37章2章。掲示板への新規投稿を受けて、家族単位トグルの判定を
   経たうえで、Edge Function notify-family-board-post（API仕様.md 31章）を
   net.http_postで非同期に呼ぶ。失敗はRAISE WARNINGに留め、投稿の記録
   （INSERT）を巻き戻さない（271章と同型）。
   【2026-09-22改訂】連投15分据え置き（旧07-37章2-2節）は統括判断により
   廃止した。同一投稿者の連続投稿も、家族単位トグルがONで送り先が1件以上
   いる限り毎回通知する（開発部/成果物/実装メモ.md 285.4章）。';

-- [トリガー本体は変更しない] trg_family_board_posts_after_insert_notify は
-- 20260930110000で作成済みのまま。AFTER INSERT ON family_board_postsの
-- 定義・FOR EACH ROWの指定はそのまま有効であり、CREATE OR REPLACE
-- FUNCTIONにより次回発火時から新しい関数本体が使われる。
