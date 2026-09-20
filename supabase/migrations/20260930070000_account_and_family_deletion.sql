-- ============================================================
-- 退会・アカウント削除・家族削除 — 新設・2026-09-21
-- 参照: 設計部/成果物/スキーマ設計.sql 68章（68.3〜68.4・68.7）
--       設計部/成果物/API仕様.md 24章
--       要件定義書 07-33章（決定1〜22）／やること.md 2-27・5-5
-- ============================================================
-- [この回でやること・新しいテーブルは1つも作らない（68.0章のとおり）]
--   1. transfer_family_ownership()（オーナーの自動委譲・決定5・68.3章）
--   2. account_deletion_preview()（確認画面の内容を1本で返す・68.7章）
--   3. family_members_before_update() の改訂（68.4章の改訂案1・改訂案2の
--      両方を入れる。本部長判断・2026-09-21業務指示4章「本部長の判断:
--      入れてください」）
--
-- Edge Function側（delete-account新設・remove-member改訂）は
-- supabase/functions/ に別途実装する（本マイグレーションの対象外）。
-- ============================================================

-- ------------------------------------------------------------
-- 1. transfer_family_ownership()（オーナーの自動委譲・決定5・68.3章）
-- ------------------------------------------------------------
-- [要件] 家族に他の在籍保護者がいる場合、オーナー権限を「その家族でいちばん
-- 古い在籍保護者」（role='parent' かつ is_active=true のうち created_at
-- が最小の1人）へ自動的に移してから、本人を抜けさせる。
-- 移す相手を選ばせる画面は作らない。確認画面に「◯◯さんが、この家族の
-- 管理者になります」と必ず表示する（account_deletion_preview()側）。
--
-- [なぜ SECURITY INVOKER なのか] この関数はEdge Functionがservice_role
-- キーでRPCとして呼ぶ。SECURITY INVOKERにすれば、PostgRESTが
-- SET LOCAL ROLE service_role した状態のまま関数本体が走るため、
-- family_members_before_update()の「current_user = 'service_role'なら
-- 素通し」というバイパスにそのまま乗る（既存のトリガーを書き換えずに通る）。
-- service_roleはRLSも迂回するので、SECURITY DEFINERにする理由が無い。
--
-- [なぜEdge Function側で2回UPDATEしないのか] supabase-jsから2回に分けて
-- UPDATEすると別トランザクションになり、1回目（オーナーを外す）が成功し
-- 2回目が落ちるとオーナーが0人になり得る。1トランザクションで済む関数に
-- まとめる。
--
-- [UPDATEの順序] uq_family_members_one_owner は
-- ON family_members(family_id) WHERE is_owner = true の部分ユニーク
-- インデックスであり、遅延させられない。先に「いまのオーナーをfalseに
-- する」→後で「次の人をtrueにする」の順でなければ一意制約違反になる。
--
-- [列名衝突の確認・設計部CLAUDE.mdのルール] RETURNS uuid。RETURNS TABLE を
-- 使わない。表の列参照にはすべて fm. を付けている。引数はp_、変数はv_。
-- 衝突の余地は無い。
CREATE OR REPLACE FUNCTION public.transfer_family_ownership(
  p_family_id UUID,
  p_from_member_id UUID
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_new_owner_id UUID;
BEGIN
  -- いちばん古い在籍保護者を1人選ぶ（決定5）。created_at が同一の場合に
  -- 備え、id を第2キーにして結果を一意に定める。
  SELECT fm.id INTO v_new_owner_id
  FROM family_members fm
  WHERE fm.family_id = p_family_id
    AND fm.role = 'parent'
    AND fm.is_active = true
    AND fm.id <> p_from_member_id
  ORDER BY fm.created_at ASC, fm.id ASC
  LIMIT 1;

  -- 他に在籍保護者がいない＝決定4（家族ごと削除に合流）の分岐。
  -- ここでは何もせずNULLを返す。呼び出し側が分岐を決める。
  IF v_new_owner_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 順序が重要（上のコメント）。先に外す。
  UPDATE family_members fm SET is_owner = false
  WHERE fm.id = p_from_member_id AND fm.family_id = p_family_id;

  -- 後から付ける。chk_owner_is_parent（role='parent'のみ）は上のSELECTで
  -- 満たしている。
  UPDATE family_members fm SET is_owner = true
  WHERE fm.id = v_new_owner_id;

  RETURN v_new_owner_id;
END;
$$;

COMMENT ON FUNCTION public.transfer_family_ownership(UUID, UUID) IS
  '要件定義書07-33章 決定5。オーナーが抜けるとき、いちばん古い在籍保護者へ
   オーナー権限を移す。他に在籍保護者がいなければ何もせずNULLを返す
   （呼び出し側が決定4＝家族ごと削除へ合流させる）。
   SECURITY INVOKERであり、service_role（Edge Function）からのみ呼べる。
   1トランザクションで2行を更新するため、途中で落ちてオーナーが0人になる
   ことがない。';

REVOKE ALL ON FUNCTION public.transfer_family_ownership(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transfer_family_ownership(UUID, UUID) TO service_role;

-- ------------------------------------------------------------
-- 2. account_deletion_preview()（確認画面の内容を1本で返す・68.7章）
-- ------------------------------------------------------------
-- [なぜ要るか] 確認画面（決定17）に出す内容が、その人の立場で変わる。
--   - オーナーで、他に保護者がいない → 「この家族と、家族のデータは
--     すべて削除されます」＋家族名の入力（3段階。決定4・決定17）
--   - オーナーで、他に保護者がいる → 「◯◯さんが、この家族の管理者に
--     なります」（決定5。黙って権限が移らないこと）
--   - オーナーでない → 通常の2段階（決定17）
--   - 家族に属していない → 「アカウントを削除します」だけ（決定10）
-- クライアントが4本のクエリを組み立てて判定すると、条件を1つ書き間違え
-- ただけで「家族が消えると知らずに押す」ことが起きる。判定はDBに1本置く。
--
-- [なぜRETURNS jsonbなのか・設計部CLAUDE.mdのルールへの対応] family_name や
-- is_owner は families / family_members の実在する列名であり、
-- RETURNS TABLE の出力列名と本文中の無修飾の列参照が衝突すると
-- 「column reference "◯◯" is ambiguous」を呼ぶたびに必ず出す
-- （このプロジェクトで2026-09-11までに3回起きている失敗の型、設計部
-- CLAUDE.md）。RETURNS jsonbなら出力に列名が存在しないため、衝突が
-- 構造的に起こらない。
CREATE OR REPLACE FUNCTION public.account_deletion_preview()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member_id UUID;
  v_family_id UUID;
  v_is_owner BOOLEAN;
  v_family_name TEXT;
  v_next_owner_id UUID;
  v_next_owner_name TEXT;
BEGIN
  v_member_id := public.current_family_member_id();

  -- 家族に属していない（parentNoFamily の画面にいる人。決定10）。
  -- ここでNULLを返して終わらせないこと。画面は出す必要がある。
  IF v_member_id IS NULL THEN
    RETURN jsonb_build_object(
      'has_family', false,
      'is_owner', false,
      'will_delete_family', false,
      'family_name', NULL,
      'next_owner_display_name', NULL
    );
  END IF;

  SELECT fm.family_id, fm.is_owner INTO v_family_id, v_is_owner
  FROM family_members fm
  WHERE fm.id = v_member_id;

  SELECT f.name INTO v_family_name FROM families f WHERE f.id = v_family_id;

  IF v_is_owner THEN
    -- 次のオーナーになる人を、上のtransfer_family_ownership()と同じ並び順
    -- で1人選ぶ。ここと並び順がずれると、画面に出した名前と実際に管理者に
    -- なる人が食い違う。必ず同じORDER BYにすること。
    SELECT fm.id, fm.display_name INTO v_next_owner_id, v_next_owner_name
    FROM family_members fm
    WHERE fm.family_id = v_family_id
      AND fm.role = 'parent'
      AND fm.is_active = true
      AND fm.id <> v_member_id
    ORDER BY fm.created_at ASC, fm.id ASC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'has_family', true,
    'is_owner', COALESCE(v_is_owner, false),
    -- 決定4: オーナーで、他に在籍保護者が1人もいない → 家族ごと削除に合流
    -- （判定は表示名ではなくidで行う。表示名で判定すると、万一display_name
    --   が空の行があったときに「家族ごと消えます」を誤って出してしまう。
    --   transfer_family_ownership()の戻り値の有無と同じ意味になるよう揃える。）
    'will_delete_family', COALESCE(v_is_owner, false) AND v_next_owner_id IS NULL,
    -- 決定17: 家族の削除の3段目で、この名前を手で入力させる
    'family_name', v_family_name,
    -- 決定5: 「◯◯さんが、この家族の管理者になります」に使う
    'next_owner_display_name', v_next_owner_name
  );
END;
$$;

COMMENT ON FUNCTION public.account_deletion_preview() IS
  '要件定義書07-33章 決定4・5・10・17。「アカウントを削除する」の確認画面に
   何を出すかを1本で返す。will_delete_family が true のときは、家族ごと
   削除に合流する（3段階確認＋家族名の入力）。家族に属していない人が
   呼んでも必ずオブジェクトを返す（決定10）。
   RETURNS TABLE ではなく jsonb にしてあるのは、出力列名と表の列名の衝突を
   構造的に避けるため（設計部CLAUDE.md）。';

REVOKE ALL ON FUNCTION public.account_deletion_preview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_deletion_preview() TO authenticated;

-- [注意] 子どものセッションからもauthenticatedとして呼べてしまうが、子どもの
-- 画面にはアカウント削除の導線を1つも置かない（決定7）ので到達しない。
-- 仮に呼ばれても、返るのは自分の家族の名前と保護者の表示名だけで、いずれも
-- 子どもの画面に既に出ている情報である（新たな漏れは無い）。

-- ------------------------------------------------------------
-- 3. family_members_before_update() の改訂（68.4章の改訂案1・改訂案2）
-- ------------------------------------------------------------
-- [改訂案1・必須] auth.admin.deleteUser()でauth.usersの行を消すと、
-- family_members.auth_user_id の ON DELETE SET NULL が family_members への
-- UPDATEを発火させ、このトリガーを通る。auth.usersの削除はGoTrue
-- （Supabase Auth）がsupabase_auth_adminロールで行うため、いまは
-- current_family_role()がNULLを返しIF NOT NULLが偽扱いになり「たまたま」
-- 素通りしている（68.4章）。誰かがこのトリガーを「安全側に倒そう」として
-- COALESCE(is_current_user_parent(), false) と書き直した瞬間、アプリからの
-- アカウント削除が全部失敗するようになる。バイパス条件に
-- supabase_auth_admin を足し、偶然への依存を無くす。
--   影響範囲: supabase_auth_adminがfamily_membersを触る経路はこの
--   ON DELETE SET NULLだけ（アプリのコードからsupabase_auth_adminで書き込む
--   経路は存在しない）。広げすぎではない。
--
-- [改訂案2・本部長判断で採用（業務指示2026-09-21「入れてください」）]
-- いまは同じ家族の保護者ならPostgRESTから is_owner を書き換えられる
-- （このトリガーはis_ownerを「保護者以外」にしか禁じていない）。決定6
-- （家族全体のデータを消す操作だけは保護者どうしで対等にしない）が構造では
-- 守られていない。保護者かどうかに関わらずis_ownerの変更を止める。正規の
-- 委譲は上のtransfer_family_ownership()（service_roleのみ実行可）を通るため、
-- 塞いでも正規の経路は一切影響を受けない。
--   影響範囲: アプリにis_ownerを書き換えるコードは1行も無い
--   （07-33-1「オーナー権限の委譲は未実装」）。塞いでも既存の機能は
--   1つも壊れない。
--
-- [★開発部が動作確認中に発見・訂正: 改訂案1の前提そのものが誤りだった]
-- `supabase functions serve`＋実際のGoTrue管理API（`auth.admin.deleteUser`
-- 相当）で通しの動作確認を行ったところ、上のバイパス条件を足しただけでは
-- 直らず、`ERROR: function is_current_user_parent() does not exist`
-- （SQLSTATE 42883）が実際に発生した。原因を`SET SESSION AUTHORIZATION
-- supabase_auth_admin`で実接続を再現して追ったところ、**`auth.users`の
-- DELETEが`ON DELETE SET NULL`で発火させる`family_members`へのUPDATEは、
-- `current_user = 'supabase_auth_admin'`ではなく`current_user = 'postgres'`
-- （`family_members`の所有者）として実行される**ことが分かった——
-- PostgreSQLの外部キー参照アクション（CASCADE/SET NULL等）は、参照される
-- 側ではなく**参照している側のテーブルの所有者の権限**でトリガーを実行する
-- ため（`postgres`は`\du`で確認したとおりBYPASSRLS属性も持つため、RLSは
-- そもそも評価されない。この節のバイパス条件・68.4章の「4. RLSポリシーの
-- 改訂」はいずれもRLS/current_userの経路としては誤りではないが、**この
-- auth.users削除の失敗を直す効果は無かった**——念のため両方とも残してある。
-- 理由は下記）。
--
-- **実際に効いた修正はこれだけである**: このトリガー関数に
-- `SET search_path = public` を追加すること。`current_user`が`postgres`に
-- なる実行コンテキストは、`public`スキーマを含まない最小限のsearch_path
-- （このプロジェクトが他の関数に付けている`SET search_path TO 'public'`が
-- 無い関数はすべてこのリスクを持つ）で動くため、関数本体の
-- `is_current_user_parent()`という無修飾の呼び出しが解決できなかった。
-- `SET search_path = public`を関数自身に付ければ、呼び出し元が誰であっても
-- （`postgres`・`service_role`・`supabase_auth_admin`のいずれでも）関数内部の
-- 名前解決は常に`public`から始まるため、68.4章がもともと想定していた
-- 「NULL semantics（JWTクレームが無い→`is_current_user_parent()`がNULLを
-- 返す→`IF NOT NULL`は偽扱い）でそのまま通る」という筋書きどおりに動く
-- ようになる。**68.4章の「たまたま素通りする」という説明自体は正しかった
-- が、その前提（関数を呼び出せること）が、いまの本番同等ローカル環境では
-- 満たされていなかった**（設計部が「関数定義まで追って確認済み」とした
-- 範囲は、実際にコードを実行して確認したものではなかった）。
--
-- [current_user IN ('service_role', 'supabase_auth_admin') バイパスを
-- 残す理由] 上の発見により`supabase_auth_admin`分岐はauth.users削除の
-- 経路では実際には一度も真にならない（`postgres`になるため）。それでも
-- 消さずに残すのは、(1) 実害が無い、(2) 将来PostgreSQLやSupabaseの内部
-- 実装が変わって`current_user`の挙動が変化した場合の保険になる、
-- (3) 4節のRLSポリシーの同種のバイパスと対称にしておくほうが読み手に
-- 一貫した説明ができる、の3点による。**ただし実際に効いているのは
-- `SET search_path = public`のほうであることを、ここに明記しておく**
-- （このプロジェクトは「文書上は正しく見えるが動かない」失敗を過去3回
-- 踏んでいる。設計部CLAUDE.mdの列名衝突の項と同じ教訓——読むだけでなく
-- 実行して確かめること）。
CREATE OR REPLACE FUNCTION public.family_members_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- service_role（Edge Function経由の管理操作）と supabase_auth_admin
  -- （auth.usersの削除によるauth_user_idへのON DELETE SET NULL）はこの
  -- トリガーの対象外とする（68.4章改訂案1）。
  IF current_user IN ('service_role', 'supabase_auth_admin') THEN
    RETURN NEW;
  END IF;

  -- is_active（退会/復帰）はクライアントから直接変更させない。
  -- 退会処理は認証・データ管理設計書.mdのremove-member(Edge Function)を経由する
  -- 運用のため、通常のUPDATEでは変更不可とする。
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION '退会処理はEdge Function(remove-member)経由でのみ行えます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- is_owner の変更は、保護者かどうかを問わず禁止する（68.4章改訂案2）。
  -- 正規のオーナー委譲はtransfer_family_ownership()（service_roleのみ）を
  -- 経由すること。上のservice_roleバイパスで既に素通りしているため、
  -- ここに到達するのは正規の委譲経路以外からの試みだけである。
  IF NEW.is_owner IS DISTINCT FROM OLD.is_owner THEN
    RAISE EXCEPTION 'オーナーの変更はEdge Function経由でのみ行えます' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT is_current_user_parent() THEN
    IF NEW.role IS DISTINCT FROM OLD.role
       OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
       OR NEW.family_id IS DISTINCT FROM OLD.family_id THEN
      RAISE EXCEPTION '権限のない項目を変更しようとしました' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- トリガー本体（trg_family_members_before_update）は初回マイグレーションで
-- 作成済み・関数名も変わっていないため、CREATE TRIGGERの再実行は不要。

-- ------------------------------------------------------------
-- 4. family_members_update_scoped（RLSポリシー）の改訂
--    ★調査の途中経過（結論は「実害は無いが、原因ではなかった」）
-- ------------------------------------------------------------
-- [調査の経緯・訂正あり] `supabase functions serve` ＋実際のGoTrue管理APIで
-- `delete-account` を通しで実行したところ、GoTrueのログに
-- `ERROR: function is_current_user_parent() does not exist (SQLSTATE 42883)`
-- が出た。**最初はこれをRLSポリシー`family_members_update_scoped`の
-- search_path問題だと判断し、このポリシーへバイパス条件を足す修正を
-- 入れた**（下記CREATE POLICY）。
--
-- **しかしこれは原因ではなかった。**`SET SESSION AUTHORIZATION
-- supabase_auth_admin`で実接続を再現して追い直した結果、判明した事実は
-- 次のとおり:
--   - `auth.users`のDELETEが`family_members.auth_user_id`への
--     `ON DELETE SET NULL`を発火させたときの内部UPDATEは、
--     **`current_user = 'supabase_auth_admin'`ではなく
--     `current_user = 'postgres'`（`family_members`の所有者）として実行
--     される**（PostgreSQLの外部キー参照アクションは、参照している側の
--     テーブルの所有者の権限で動くため）。
--   - `postgres`ロールは`\du`のとおり**BYPASSRLS属性を持つ**ため、
--     RLSポリシーはそもそも一度も評価されない。**このポリシーの中身は、
--     この経路には無関係だった。**
--   - 本当の原因は3節のトリガー関数本体に`SET search_path`が無かった
--     ことであり、そちらの修正（`SET search_path = public`の追加）だけで
--     `delete-account`は最後まで成功することを確認した（3節のコメント
--     参照）。
--
-- **このポリシーの変更は、原因ではなかったが、実害も無い**（条件の意味は
-- 変えておらず、`public.`修飾と`current_user`バイパスを足しただけ）ため、
-- 元に戻さずそのまま残す。理由:
--   (1) `service_role`（既にBYPASSRLSだが対称性のため）・
--       `supabase_auth_admin`（この経路では実際には真にならないが、将来
--       PostgreSQL/Supabaseの内部実装が変わった場合の保険になる）への
--       明示的なバイパスは、3節のトリガーの書き方と一貫している。
--   (2) 関数呼び出しの完全修飾（`public.`)は、それ自体は堅牢化として
--       常に無害である。
-- **効いた修正がどちらかを正しく切り分けるため、本節と3節の両方の
-- コメントに調査結果を記録した**（設計部CLAUDE.mdの列名衝突の教訓と同じ
-- 「読むだけでなく実行して確かめる」の実例。開発部/成果物/実装メモ.md
-- 273章に詳細な時系列を記録する）。
DROP POLICY IF EXISTS "family_members_update_scoped" ON family_members;
CREATE POLICY "family_members_update_scoped" ON family_members
  FOR UPDATE
  USING (
    current_user IN ('service_role', 'supabase_auth_admin')
    OR (
      family_id = public.current_family_id()
      AND (public.is_current_user_parent() OR id = public.current_family_member_id())
    )
  )
  WITH CHECK (
    current_user IN ('service_role', 'supabase_auth_admin')
    OR (
      family_id = public.current_family_id()
      AND (public.is_current_user_parent() OR id = public.current_family_member_id())
    )
  );

COMMENT ON POLICY "family_members_update_scoped" ON family_members IS
  '保護者は家族内の誰でも更新可。子どもは自分の行のみ更新可（条件は初期
   スキーマから変更なし）。service_role / supabase_auth_admin への明示的な
   バイパスと関数呼び出しの完全修飾（public.）は、調査の過程で追加した
   防御的な改善であり、実害は無い。ただし auth.users 削除時に
   family_members.auth_user_id が正しくNULLになることの実際の理由は
   このポリシーではなく、family_members_before_update()トリガー関数の
   SET search_path = public である（外部キー参照アクションは参照元
   テーブルの所有者=postgresの権限で実行されるためRLSは評価されず、
   トリガー関数内の名前解決だけが問題だった。詳細は本ファイル4節・
   開発部/成果物/実装メモ.md 273章）。';
