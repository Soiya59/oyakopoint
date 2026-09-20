-- ============================================================
-- content_reports の通知トリガー（運営へのメール通知）— 新設・2026-09-21
-- 参照: 設計部/成果物/スキーマ設計.sql 65.5章
--       設計部/成果物/API仕様.md 25.7章（具体的な実装手順）
--       開発部/成果物/実装メモ.md 271章
-- ============================================================
-- [位置づけ] 報告・お問い合わせが1件 content_reports に入っても、保護者の
-- 家族管理画面の入口は落ちており（要件定義書07-32章 未決12番の(A)確定）、
-- 運営が気づく経路はこのメール1本だけである（07-32-0d）。本マイグレー
-- ションは、その通知を送るための土台（AFTER INSERTトリガー→
-- net.http_post→Edge Function notify-content-report→Resend）を1本追加する。
--
-- [pg_net・supabase_vaultはCREATE EXTENSIONしない]
-- どちらもSupabaseの基盤拡張であり、ローカル（`supabase start`）・本番
-- いずれの環境にも既定で導入済みであることを確認済み（実装メモ271章）。
-- 本マイグレーションから新規にCREATE EXTENSIONは行わない
-- （supabase_vaultは`vault`スキーマの所有者がsupabase_adminであり、
-- 通常のマイグレーション実行ロールで作り直そうとすると環境によっては
-- 権限エラーになりうる。既に入っているものを前提にする）。
--
-- [絶対に守ること・スキーマ設計.sql 65.5章]
--   (1) 通知の失敗が、報告の記録を巻き戻さないこと（決定10）。
--   (2) 本文に個人情報を載せない。Edge Functionに渡すのはreport_idだけ。
--   (3) 秘密（呼び出し用のトークン等）をこの.sqlファイルに書かない。
--
-- [pg_netは非同期であることの確認]
-- net.http_post はリクエストをキューに積んで即座に制御を返す関数であり
-- （戻り値は request id のbigint）、実際のHTTPレスポンスは後続のバック
-- グラウンドワーカーが処理し、結果は net._http_response に記録される。
-- つまり「Edge Functionの呼び出しが実際に成功したか」は、この関数が
-- 実行される時点ではまだ分からない。したがって下のEXCEPTIONブロックが
-- 捕まえられるのは「net.http_post自体の呼び出しが失敗するケース」
-- （pg_netが使えない・vaultの値が読めない等）に限られる。
-- これは要件(1)にとってむしろ都合がよい——net.http_postが「キューに
-- 積むだけ」で完了する以上、実際のメール送達が何秒後に失敗しても、
-- INSERTを含むトランザクションは既にコミット済みであり、記録が巻き戻る
-- 余地がそもそも無い（Resend側の失敗については、Edge Function自身の
-- 実装側でも書き込みを一切行わない設計にしてある。実装メモ271章）。
--
-- [呼び出し先の特定方法・Vaultを使う理由（65.5章の設計どおり）]
-- Edge FunctionのURLは環境（ローカル／本番）で異なり、呼び出しに使う
-- Authorizationトークンは秘密情報である。どちらも.sqlに直書きせず、
-- Supabase Vault（vault.decrypted_secrets）から名前で引く。
--   - content_report_notify_url    : Edge FunctionのURL
--       （例: https://<project-ref>.supabase.co/functions/v1/notify-content-report）
--   - content_report_notify_bearer : 呼び出し用のAuthorizationトークン。
--       **新しい秘密を増やさず、プロジェクトの既存のservice_role key
--       をそのまま使う**（設計部方針「Resendの既存のAPIキーをそのまま
--       使い回してよい」と同じ考え方。API仕様.md 25.6章）。
--       Edge Function側（notify-content-report）は、受け取った
--       AuthorizationのJWTペイロードのroleクレームが'service_role'で
--       あることを確認したうえでのみ処理する（実装メモ271章）。これに
--       より、anon key（アプリに同梱され公開されている）しか持たない
--       第三者がこの関数を直接叩いても拒否される。
-- **この2つのVault secretはこのマイグレーションでは作らない。**値の
-- 設定は本部長・統括がSupabaseダッシュボード（SQL Editor）で行う
-- （実装メモ271章に手順を書いた）。
-- **未設定でも壊れない**——下の関数はどちらかがNULLならHTTP呼び出し
-- 自体をスキップしてRAISE WARNINGに留める。INSERTは常に成功する。
CREATE OR REPLACE FUNCTION public.content_reports_after_insert_notify()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    TEXT;
  v_bearer TEXT;
BEGIN
  BEGIN
    SELECT vs.decrypted_secret INTO v_url
    FROM vault.decrypted_secrets vs
    WHERE vs.name = 'content_report_notify_url';

    SELECT vs.decrypted_secret INTO v_bearer
    FROM vault.decrypted_secrets vs
    WHERE vs.name = 'content_report_notify_bearer';

    IF v_url IS NULL OR v_bearer IS NULL THEN
      -- Vaultが未設定の環境（新規ローカルDB・設定前の本番）向けの安全側
      -- フォールバック。報告の記録（INSERT）自体は通す。
      RAISE WARNING 'content_reports notify skipped for % (vault secrets not configured)', NEW.id;
    ELSE
      PERFORM net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Authorization', 'Bearer ' || v_bearer
                   ),
        -- 個人情報を載せない（65.5章(2)）。載せるのはreport_idだけ。
        -- 自由記述の本文・表示名・家族名・family_idはいずれも含めない。
        body    := jsonb_build_object('report_id', NEW.id)
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    -- 通知の失敗で報告の記録を巻き戻さない（65.5章(1)）。
    RAISE WARNING 'content_reports notify failed for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.content_reports_after_insert_notify() IS
  'content_reportsへのINSERT後、運営への通知メールを送るEdge Function
   (notify-content-report) をnet.http_postで非同期に呼び出すAFTER INSERT
   トリガー関数。渡すのはreport_idのみ（スキーマ設計.sql 65.5章）。
   呼び出し先URL・Bearerトークンはvault.decrypted_secretsから読む
   （名前は本ファイル冒頭コメント参照）。いずれか未設定、または
   net.http_post自体が例外を投げても、RAISE WARNINGに留めてNEWをそのまま
   返す——通知の失敗がcontent_reportsへのINSERTを巻き戻すことは無い
   （決定10）。';

DROP TRIGGER IF EXISTS trg_content_reports_after_insert_notify ON content_reports;
CREATE TRIGGER trg_content_reports_after_insert_notify
  AFTER INSERT ON content_reports
  FOR EACH ROW EXECUTE FUNCTION public.content_reports_after_insert_notify();

-- [S4（rls_checks.sql）への申し送り] 本関数はSECURITY DEFINERだが
-- RETURNS TRIGGERであり、明示的なREVOKEを行っていない。新規関数作成時の
-- 既定動作（34.5章の既知の挙動）により、PUBLIC/authenticatedへの
-- EXECUTE権限が自動付与される（他の`*_before_insert`・`*_social_toggle_
-- guard`等の既存トリガー関数と同じ扱い）。トリガー文脈の外で直接呼び出す
-- とNEW参照でエラーになるだけで実害は無いため、submit_content_report()の
-- ように明示REVOKE+GRANTはしていない。rls_checks.sql S4の一覧に
-- 'content_reports_after_insert_notify' を追加し、78件→79件に更新した
-- （実装メモ271章）。
