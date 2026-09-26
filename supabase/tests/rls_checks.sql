-- ============================================================
-- RLS・権限の照査（B層＝家族内のロール境界／C層＝定義のスナップショット）
--
-- [2026-08-31作成・本部長]
--
-- [2026-09-01更新・開発部] 家族の書き込みボードへのリアクション（スタンプ）新設
-- （supabase/migrations/20260901160000_family_board_reactions.sql、開発部/成果物/
-- 実装メモ.md 103章）に伴い、S1（21→22）・S3（41→43本、family_board_reactionsの
-- SELECT/INSERT各1本を追加）・S4（43→44件、family_board_reactions_before_insertを
-- 追加）のスナップショットを更新した。上記マイグレーションは103章時点では**未適用**
-- （96.5章のとおりFAILを消すための更新ではなく、意図した変更を先取りして記録した
-- ものであり、適用後に本ファイルを実際に実行して差分が0件であることを別途確認する
-- 必要がある。103章参照）。他の項目（S2・S4の他関数・B層）には変更を加えていない。
--
-- [2026-09-01再更新・開発部] 統括フィードバック（掲示板リアクションをLINE風の
-- 個数表示へ作り直す）を受け、supabase/migrations/
-- 20260901180000_family_board_reactions_line_style.sql（開発部/成果物/実装メモ.md
-- 104章）でSELECTポリシーを「閲覧者自身の行のみ」→「家族全員が読める」へ置き換えた
-- （ポリシー名も`family_board_reactions_select_own`→
-- `family_board_reactions_select_same_family`に改名。理由は104章・上記マイグレーション
-- 本体のコメント参照）。これに伴いS3の該当1行のみを更新した。S1（22のまま。テーブル
-- の追加・削除は無い）・S4（44のまま。関数の追加・削除は無い）は変更していない。
-- 一意制約の張り替え（(post_id, reactor_member_id) →
-- (post_id, reactor_member_id, stamp_key)）はRLS・関数のいずれにも影響しないため
-- 本ファイルのスナップショットには現れない。104章時点では上記マイグレーションは
-- **未適用**であり、S3の新ハッシュは推定値である（104章参照。適用後に本部長が
-- 実測して確認する）。
--
-- ■ なぜ作ったか
-- 48本のRLSポリシー（2026-09-01時点。作成当初は41本）は、子どものデータを守っている
-- 唯一の壁である。
-- そしてRLSの不備は**エラーを出さない**。厳しすぎれば画面が空になって気づくが、
-- 緩すぎれば「見えてはいけないものが、ただ見える」だけで無症状のまま残る。
-- 目視・手動操作では原理的に発見できないため、機械で照査する。
--
-- ■ 実際に起きた事故（このテストが守ろうとしているもの）
-- 実装メモ.md 84章: gratitude_daily_allowance() のEXECUTE権限を剥奪し、
--                    感謝ポイント機能が本番で全滅した（→ C層のS4が検出する）
-- 実装メモ.md 95章: gratitude_points のRLSを絞ろうとして、member_points
--                    （security_invoker=true）経由で他人の残高が静かに狂う
--                    ことが実行前に判明した（→ C層のS3が変更を検出する）
-- 削除が0行になった件・論理削除が失敗した件も、いずれも家族内の境界（B層）。
--
-- ■ このテストの範囲と限界（正直に書く）
-- 【やること】
--   - SELECT系ポリシーを、実際に別人になりすまして読んで確認する
--   - ポリシー定義と関数のEXECUTE権限を、承認済みスナップショットと照合する
-- 【やらないこと】
--   - **書き込み（INSERT/UPDATE/DELETE）を一切実行しない。** 本番に対して
--     実行するため、ROLLBACK漏れの危険をそもそも作らない方針とした。
--     書き込み系ポリシーは「定義が変わっていないこと」の照合で代替している。
--     挙動そのものの検証ではないため、**書き込みの正しさは保証しない**。
--   - **書いた検査しか通らない。** 「全部PASS＝安全」ではない。
--
-- [2026-09-01追加・開発部] A層（家族間の分離）を追加した（開発部/成果物/
-- 実装メモ.md 105章）。96.5章で「家族が2つ以上ないと検査できない。本番には
-- 家族が1つしかなく、テスト用の家族を本番に作らない方針のためDocker導入後に
-- ローカルDBで追加する」と先送りしていたものの本実装。
--   - ローカル（`supabase/seed.sql` を読み込んだ状態。`supabase db reset` /
--     `supabase start` でのみ投入される）では、テスト家族が2つ存在するため
--     A層が実際に実行される。
--   - 本番（家族が1つしかない）では「家族が2つ以上あるか」を実行時に判定し、
--     該当しないためA層は**SKIP**と表示される（FAILではない。正常な挙動）。
--     判定方法・SKIPの実装はB層の直前のコメント、および各A層チェックの
--     コメントを参照。
--   - B層についても、対象ロールのメンバーが1人も存在しない環境（ローカルの
--     空DB等）で `set_config` に空文字を渡してクラッシュしていた不具合を
--     本改訂であわせて修正した（B層直前のコメント参照）。B層の各チェックの
--     検査内容・期待値そのものは一切変更していない。
--
-- [2026-09-01再追加・開発部] NFCタグの人ごと化（新規テーブル`chore_nfc_tags`、
-- 設計部/成果物/スキーマ設計.sql 39章・開発部/成果物/実装メモ.md 108章）に伴い、
-- S1（22→23）・S3（43→48本、chore_nfc_tagsの5ポリシーを追加）・
-- S4（44→47件、chore_nfc_tags_before_write・max_nfc_tags_per_chore_member・
-- report_chore_completion_by_nfc_tagを追加）、A層にA22（保護者:
-- chore_nfc_tagsに他家族の行が見えない）を追加した。既存の`chore_completions_
-- insert_self`を含む既存ポリシー・関数は1本も変更していない（39.5章の設計判断
-- どおり、代理報告はRLS緩和ではなく別RPCで実現したため）。マイグレーション
-- `20260901200000_chore_nfc_tags_per_member.sql`は108章時点で**未適用**であり、
-- 本ファイルの新規ハッシュはローカルDocker環境で実測済み（108章参照。96.5章
-- 「FAILを消すためにスナップショットを更新してはならない」の遵守として、実測
-- した上で記録している）。
--
-- [2026-09-02追加・開発部] 招待受諾フローにおける可視範囲の説明と同意取得
-- （新規テーブル`join_consents`、設計部/成果物/スキーマ設計.sql 40章・開発部/
-- 成果物/実装メモ.md 111章）に伴い、S1（23→24）・S3（48→50本、join_consents
-- のSELECT2本を追加）・S4（47→48件、current_join_consent_versionを追加。
-- join_family_with_invite_code/accept_family_inviteは3引数の新シグネチャに
-- 差し替わったが、S4は関数名のみを見る照合のため件数上は動かない）、A層に
-- A23（保護者: join_consentsに他家族の行が見えない）を追加した。
-- `join_family_with_invite_code(text, text)`・`accept_family_invite(text, text)`
-- の旧2引数シグネチャは本マイグレーションでDROP FUNCTIONされ、
-- `pg_get_function_identity_arguments`で3引数の新シグネチャのみが残って
-- いることをローカルで確認済み（実装メモ.md 111章）。マイグレーション
-- `20260902010000_join_visibility_consent.sql`は111章時点で**未適用**であり、
-- 本ファイルの新規ハッシュはローカルDocker環境で実測済み（96.5章の遵守として、
-- 実測した上で記録している）。
--
-- [2026-09-02再追加・開発部] お絵かきの題名（タイトル）（family_drawingsへの
-- 列追加`title`、設計部/成果物/スキーマ設計.sql 42章・開発部/成果物/実装メモ.md
-- 118章）に伴い、S1（24のまま。新規テーブルを追加していない）・S3（50本の
-- まま。新しいCREATE POLICYを追加していない。既存のfamily_drawings_*3本の
-- 条件式も一切変更していない）はいずれも±0。S4は`edit_unpublished_drawing`が
-- 2引数→3引数に改訂され旧シグネチャはDROP FUNCTIONされたが、S4は関数名のみを
-- 見る照合のため件数上は動かない（48件のまま。42.6章の申し送りどおり、
-- `pg_get_function_identity_arguments`で引数まで別途確認する必要がある。
-- 開発部/成果物/実装メモ.md 118章で確認済み）。マイグレーション
-- `20260902030000_drawing_title.sql`は118章時点で**未適用**である。
--
-- [2026-09-03追加・開発部] 完了報告の直後の取消（新規RPC`cancel_chore_completion`、
-- 設計部/成果物/スキーマ設計.sql 43章・開発部/成果物/実装メモ.md 120章）に伴い、
-- S1（24のまま。新規テーブルを追加していない）・S3（50本のまま。新しい
-- CREATE POLICYを追加していない。`chore_completions`へのDELETEポリシーも
-- 追加しない。既存ポリシーの条件式も一切変更していない）はいずれも±0。
-- S4（48→49件、`cancel_chore_completion`をauthenticatedへ明示的にGRANT）。
-- マイグレーション`20260903010000_cancel_chore_completion.sql`は120章時点で
-- ローカルDocker環境に適用済み・実測済み（96.5章の遵守として、実測した上で
-- 記録している）。本番へは未適用（本部長の操作を待つ）。
--
-- [2026-09-07追加・開発部] 木を飾るステッカー購入とバッジ（新規テーブル
-- `sticker_catalog`・`ornament_sticker_purchases`・`member_badges`、
-- 設計部/成果物/スキーマ設計.sql 47章・開発部/成果物/実装メモ.md 138章）に伴い、
-- S1（24→27、上記3テーブルをENABLE ROW LEVEL SECURITY）・S3（52→55本、
-- 各テーブルのSELECTポリシー1本ずつを追加。`sticker_catalog_select_authenticated`は
-- `gacha_preset_ornaments_select_authenticated`と条件式が文字通り同一のため同じ
-- ハッシュ、`ornament_sticker_purchases_select_same_family`・
-- `member_badges_select_same_family`は他の多数の`family_id = current_family_id()`
-- のみのSELECTポリシーと同じハッシュになる。104章の教訓どおり、いずれも既存の
-- 承認済みハッシュから引き写せる形であることをローカルDockerで実測して確認した）を
-- 更新した。
--
-- **S4は設計部の見込み（49→51、47.8章）と実測が食い違った。実測は49→56。**
-- 96.5章「FAILを消すためにスナップショットを更新してはならない。期待値が実測と
-- 違ったら期待値を書き換えず報告する」に従い、以下のとおり報告したうえで実測値に
-- 更新する（詳細は実装メモ.md 138章）。
--   - 設計部の見込みは新規RPC`purchase_sticker`・`decorate_tree_with_sticker`への
--     明示的なGRANTのみを+2として数えていた（ここは実測と一致）。
--   - しかし設計部47.8章は「4本のトリガー関数（`member_badges_check_*`）は
--     RETURNS TRIGGERでありPostgREST経由で呼び出せないため、`gacha_member_
--     progress_bump()`と同様にS4に影響しない」としていたが、**この一覧
--     （`expected(f)`）自体に`gacha_member_progress_bump`が既に含まれている**
--     （本ファイル該当行参照）。S4の実際の判定はRETURNS TRIGGERかどうかを見ず
--     `has_function_privilege('authenticated', ..., 'EXECUTE')`のみで機械的に
--     数えるため、REVOKEしていないトリガー関数は他の既存トリガー関数
--     （`chore_completions_before_insert`・`family_board_reactions_before_insert`
--     等）と同じくS4に含まれる。したがって新規4本のトリガー関数
--     （`member_badges_check_chore_completion`・`member_badges_check_family_drawing`・
--     `member_badges_check_gacha_draw`・`member_badges_check_sticker_purchase`）も
--     S4に含まれる（+4）。
--   - 同様に47.8章は`badge_tier_thresholds`を「`is_valid_drawing_line_data`等と
--     同じ理由でS4のカウント対象外」としていたが、**`is_valid_drawing_line_data`
--     自体が本ファイルのS4一覧に既に含まれている**（該当行参照）。REVOKEして
--     いないSQL関数はPostgreSQLがCREATE FUNCTION時にPUBLICへEXECUTEを自動付与する
--     （34.5章の既知の挙動）ため、`badge_tier_thresholds`もS4に含まれる（+1）。
--   - 合計 49 + 2（明示GRANT）+ 4（トリガー関数）+ 1（badge_tier_thresholds）= 56。
--     ローカルDocker環境で実測し、設計部の見込み文書（47.8章）の記述誤りを
--     確認した（下流〈開発部〉が上流〈設計部〉の記述の誤りを発見した事例として
--     実装メモ.md 138章に記録する。マイグレーション自体〈GRANT/REVOKEの実装〉は
--     設計SQLをそのまま書き写しており正しい。誤っていたのは47.8章の影響見積り
--     コメントのみで、DDL本体・セキュリティ上の扱いに問題は無い）。
-- マイグレーション`20260907020000_sticker_purchases_and_badges.sql`は138章時点で
-- ローカルDocker環境に適用済み・実測済み（96.5章の遵守）。本番へは未適用（本部長の
-- 操作を待つ）。
--
-- [2026-09-07更新・開発部] みまもりメンバーを感謝ポイントの送受信対象に含める
-- 改訂（スキーマ設計.sql 48章、マイグレーション`20260907030000_gratitude_points_
-- supporter_send_receive.sql`、開発部/成果物/実装メモ.md 141章）に伴い、S1（27の
-- まま。テーブルの追加・削除もENABLE/DISABLEの変更も無い）・S4（56のまま。新しい
-- 関数の追加・削除も無い）は無変更。S3は本数55本のまま、
-- `gratitude_points.gratitude_points_insert_self`の1行だけハッシュが変わった
-- （設計部の見込みどおり。48.8章参照）。ローカルDocker環境に上記マイグレーション
-- 適用後に実測した値（`3a333e6d1714c61877e086de96092891`）へ更新済み（手計算・
-- 推定値のまま書き込んでいない。96.5章・103.4章の運用を遵守）。本番へは未適用
-- （本部長の操作を待つ）。
--
-- [2026-09-08追加・開発部] ステッカーの自由配置化（新規RPC`move_tree_sticker`・
-- `decorate_tree_with_sticker`のシグネチャ変更、設計部/成果物/スキーマ設計.sql
-- 49章・開発部/成果物/実装メモ.md 142章）に伴い、S1（27のまま。新しいテーブルを
-- 追加していない。既存の`family_tree_decorations`へのALTER TABLEのみ）・
-- S3（55本のまま。新規ポリシーを追加せず、`family_tree_decorations_select_same_
-- family`のUSING句も一切書き換えていない）はいずれも±0（設計部49.9章・49.15章の
-- 見込みどおり、ローカルDockerで実測して確認した）。
-- S4は設計部見込み（49.15章「+1、56→57」）どおり**実測も56→57で一致**した
-- （96.5章「実測が違ったら期待値を書き換えず報告する」の運用に従い、まず見込みと
-- 実測を照合し、一致したためローカル実測値をそのまま採用した）。内訳:
-- `decorate_tree_with_sticker`はシグネチャを`(UUID,UUID)`→`(UUID,INT,INT)`へ
-- 変更したが、S4は関数名のみを見る照合（42.6章・118章と同じ）のため名前の
-- 出現数は変わらず±0。新規`move_tree_sticker`への明示GRANTで+1。
-- 部分UNIQUEインデックスの置き換え（`uq_family_tree_decorations_sticker_per_
-- season`→`uq_family_tree_decorations_sticker_once`）はS1/S3/S4のいずれの
-- 判定対象（テーブルのRLS有効化・ポリシー本数・関数のEXECUTE権限）にも含まれない
-- ため、本ファイルのスナップショットには現れない。
-- マイグレーション`20260908010000_sticker_free_placement.sql`は142章時点で
-- ローカルDocker環境に適用済み・実測済み（96.5章の遵守）。本番へは未適用
-- （本部長の操作を待つ）。
--
-- [2026-09-10追加・開発部] 完了報告へのスタンプ（絵文字）リアクションの取消・切替
-- （統括指示、開発部/成果物/実装メモ.md 157章、マイグレーション
-- `20260910020000_toggle_chore_reaction_stamp.sql`）に伴い、S1（27のまま。
-- 新規テーブルを追加していない）・S3（55本のまま。新規ポリシーを追加せず、
-- 既存の`chore_reactions_insert_scoped`1行にのみ`kind = 'comment'`条件を追加した。
-- 本数は変わらずハッシュのみ変化）・S4（57→58、新規SECURITY DEFINER関数
-- `toggle_chore_reaction_stamp`をauthenticatedへ明示的にGRANT）を更新した。
-- いずれもローカルDocker環境で実測した値（96.5章の遵守。手計算していない）。
-- 本マイグレーションは157章時点でローカルDocker環境に適用済み・実測済み。
-- 本番へは未適用（本部長の操作を待つ）。
--
-- [**訂正・2026-09-08発見**] 上記「既存の`chore_reactions_insert_scoped`1行にのみ
-- `kind = 'comment'`条件を追加した」は不正確だった。実際には送信者側の条件も
-- `current_family_role() IN ('parent', 'supporter')`から`is_current_user_parent()`
-- （parentのみ）へ書き換えており、みまもりメンバーが送信できなくなるデグレを
-- 生んでいた（本部長の実機確認で発覚）。詳細・修正は本ファイル末尾の
-- [2026-09-08追加・開発部・デグレ修正]、開発部/成果物/実装メモ.md 170章を参照。
--
-- [2026-09-10再追加・開発部] 家族の掲示板へのスタンプ（絵文字）リアクションの
-- 取消・切替（統括指示「掲示板も同じくで」、開発部/成果物/実装メモ.md 159章、
-- マイグレーション`20260910030000_toggle_family_board_reaction_stamp.sql`）に伴い、
-- S1（27のまま。新規テーブルを追加していない）・
-- **S3（55→54、157章とは異なり本数が1本減る）**・S4（58→59、新規SECURITY
-- DEFINER関数`toggle_family_board_reaction_stamp`をauthenticatedへ明示的にGRANT）
-- を更新した。
-- S3が157章と異なり「置き換え」ではなく「純減」になった理由: chore_reactionsは
-- `kind`列（'stamp'/'comment'）を持ち、スタンプの直接INSERTだけを塞ぐために
-- 既存ポリシーへ`kind = 'comment'`条件を追加する「置き換え」で済んだが、
-- family_board_reactionsには`kind`列が無く（このテーブルへの書き込みは100%
-- スタンプであり、残すべき直接INSERT経路が1つも無い）、既存の
-- `family_board_reactions_insert_self`ポリシーをDROPし置き換えを作らなかった
-- （マイグレーション本体・実装メモ.md 159章に判断理由を記録）。
-- いずれもローカルDocker環境で実測した値（96.5章の遵守。手計算していない）。
-- 本マイグレーションは159章時点でローカルDocker環境に適用済み・実測済み。
-- 本番へは未適用（本部長の操作を待つ）。
--
-- [2026-09-12追加・開発部] ごほうびへの担当者新設（rewards.assigned_to）・
-- クエストの担当者をDBでも効かせる（統括判断B、設計部/成果物/スキーマ設計.sql
-- 50章・51章、開発部/成果物/実装メモ.md 163章、マイグレーション
-- `20260912010000_reward_assigned_to_and_chore_assigned_to_enforced.sql`）に伴い、
-- S1（27のまま。新規テーブルを追加していない）・S4（59のまま。新しい関数の
-- 追加・削除も無い。rewards_before_write・chore_completions_before_insertは
-- いずれも既存の名前・シグネチャのままCREATE OR REPLACEしたのみ）は無変更。
-- **S3は本数54本のまま増減なし（+0）だが、2本のハッシュが変化する**
-- （設計部50.11章・51.10章の見込みどおり）。
--   - `chore_completions.chore_completions_insert_self`（INSERT）: scope='family'
--     分岐に`(c.assigned_to IS NULL OR c.assigned_to = reported_by)`を追加。
--   - `reward_redemptions.reward_redemptions_insert_scoped`（INSERT）: scope='family'
--     分岐に`(r.assigned_to IS NULL OR r.assigned_to = member_id)`を追加。
-- 他のいずれのポリシーのUSING/WITH CHECK句も変更していない。CHECK制約
-- `chk_rewards_personal_self_assigned`・インデックス`idx_rewards_assigned_to`は
-- 49.14章の教訓のとおりS1/S3/S4のいずれにも数えない（本ファイルのスナップ
-- ショットには現れない）。いずれもローカルDocker環境で実測した値（96.5章の
-- 遵守。手計算していない）。本マイグレーションは163章時点でローカルDocker
-- 環境に適用済み・実測済み。本番へは未適用（本部長の操作を待つ）。
--
-- [2026-09-13追加・開発部] generate_weekly_family_digest()（引数なし版、死んだ
-- オーバーロード）のDROP（やること.md 4-7、開発部/成果物/実装メモ.md 165章、
-- マイグレーション`20260913010000_drop_generate_weekly_family_digest_no_arg_
-- overload.sql`）に伴い、S1（27のまま。テーブルの追加・削除は無い）・S3（54本の
-- まま。ポリシーの追加・変更は無い）は無変更。**S4は59→58に減った**
-- （見込みどおり、実測して確認。96.5章の遵守。手計算していない）。理由:
-- 現行版generate_weekly_family_digest(uuid,date)は元々service_roleにのみ
-- EXECUTE権限があり（authenticated/anonへは明示REVOKE済み）authenticatedからは
-- 実行できない状態のままだったが、DROPした引数なし版は8月の作成時に明示REVOKEを
-- 一度も受けておらず、本プロジェクトの既知の挙動（34.5章）でauthenticated・anon
-- の両方にEXECUTE権限が自動付与されたまま本番に残っていた（本DROPで発覚・解消。
-- 詳細はマイグレーション本体のコメント参照）。DROPによりproname
-- `generate_weekly_family_digest`自体がS4の一覧（`DISTINCT proname`で集計）から
-- 消える。本マイグレーションは165章時点でローカルDocker環境に適用済み・実測済み。
-- 本番へは未適用（本部長の操作を待つ）。
--
-- [2026-09-08追加・開発部・デグレ修正] 157章（`20260910020000_toggle_chore_
-- reaction_stamp.sql`）が`chore_reactions_insert_scoped`の送信者側の条件を
-- `current_family_role() IN ('parent', 'supporter')`から`is_current_user_parent()`
-- （parentのみ）へ誤って書き換えており、みまもりメンバーが完了報告へスタンプ・
-- コメントを送れなくなるデグレが本番で発生していた（本部長の実機確認、本番
-- `chore_reactions`にみまもりの過去投稿が実在することで裏付け済み）。**下記
-- [2026-09-10追加]の「家族・ロールの境界条件自体は変更していない」という記述は
-- 誤りだった**（実際には境界条件を書き換えていた）。同じ誤りが
-- `toggle_chore_reaction_stamp()`関数本体の権限判定にも複製されていた。
-- `20260914010000_fix_chore_reactions_supporter_dropped.sql`（開発部/成果物/
-- 実装メモ.md 170章）で両方を`current_family_role() IN ('parent', 'supporter')`に
-- 訂正した。これに伴い、S1（27のまま。テーブルの追加・削除は無い）・S3（54本の
-- まま。`chore_reactions_insert_scoped`1行のみハッシュが変わる）・S4（58のまま。
-- 関数の追加・削除は無く、GRANT/REVOKEもシグネチャ不変のCREATE OR REPLACEで
-- 維持されるため変わらない）を更新した（S1・S4は実測しても差分0件だったため
-- 数値上の変更は無い）。いずれもローカルDocker環境で実測した値（96.5章の遵守。
-- 手計算していない）。本マイグレーションは170章時点でローカルDocker環境に
-- 適用済み・実測済み。本番へは未適用（本部長の操作を待つ）。
--
-- [**訂正・2026-09-08発見（本部長）・170章の取りこぼし**] 170章は
-- `chore_reactions_insert_scoped`・`toggle_chore_reaction_stamp()`の**第1項
-- （送信者側）のみ**を訂正しており、**第2項（EXISTS。子どもがどの完了報告に
-- 反応できるかの条件）は`fm.role = 'parent'`のまま取り残されていた**。本来の
-- 確定仕様（`20260823070000_supporter_chore_public_visibility.sql`22番、実装メモ
-- 64章）は`fm.role IN ('parent', 'supporter')`であり、170章時点でこの部分を
-- 見落としていた。この見落としにより、170章の本番適用（2026-09-08）後も
-- 「子どもが、みまもりメンバーの完了報告に反応できない」状態が続いていた
-- （逆方向＝みまもりが送信できないデグレは170章で直っていたが、みまもりが
-- 反応の対象になる側は直っていなかった）。統括の2026-09-09の実機確認
-- （「子供モードで完了報告のリアクションやコメントできない」）で発覚した。
-- 170章のローカル検証（実装メモ170.4節シナリオ6b「子どもが保護者自身の完了報告に
-- コメント」）は第1項の訂正確認が目的でPASSしており、対象が保護者だったため
-- 第2項の見落としを検出できなかった（対象をみまもりにした検証をしていなかった）。
--
-- 詳細は`20260916010000_fix_chore_reactions_supporter_target_dropped.sql`
-- （開発部/成果物/実装メモ.md 174章）を参照。これに伴い、S1（27のまま）・
-- S3（54本のまま。`chore_reactions_insert_scoped`1行のみハッシュが再度変わる）・
-- S4（58のまま。関数の追加・削除は無い）を更新した。いずれもローカルDocker
-- 環境で実測した値（96.5章の遵守。手計算していない）。本マイグレーションは
-- 174章時点でローカルDocker環境に適用済み・実測済み。本番へは未適用
-- （本部長の操作を待つ）。
--
-- [96.5章の遵守についての記録・174章] 170章時点で本スイートを実行した結果は
-- 46項目すべてPASSだったが、これは「バグが無いことの確認」ではなく「本番の
-- 実際の状態（まだ第2項にバグが残っていた状態）と、このファイルに記録された
-- 承認済みスナップショットが一致していること」の確認にすぎない。**S3のハッシュ
-- 照合は、承認済みスナップショット自体が誤りを含んでいた場合、その誤りを
-- 検出できない**（スナップショット更新時に「まだ壊れている状態」を正として
-- 記録してしまうと、以後はそれが基準になる）。170章はまさにこれで、第2項の
-- バグが残ったままの定義を「承認済み」として記録してしまっていた。174章の
-- 修正はこの反省を踏まえ、`20260823070000_supporter_chore_public_visibility.sql`
-- 22番（本来の確定仕様）と1文字ずつ突き合わせたうえでハッシュを更新した
-- （174章参照）。
--
-- [2026-09-09再更新・開発部] 子どもどうしの完了報告リアクション解禁・自己
-- リアクション禁止（企画部/成果物/要件定義書.md 07-23章決定1・決定2、開発部/
-- 成果物/実装メモ.md 175章、マイグレーション
-- `20260916020000_chore_reactions_open_to_all_and_self_ban.sql`）に伴い、
-- `chore_reactions_insert_scoped`の役割による絞り込み（送信者側・対象側の第1項・
-- 第2項）を撤廃し、自己リアクション禁止（`NOT EXISTS (... cc.reported_by =
-- chore_reactions.reacted_by)`）に置き換えた。`toggle_chore_reaction_stamp()`
-- 関数本体の権限判定も同じ内容に揃えた（175章参照。第1項/第2項の役割条件を
-- IF文ごと自己リアクション禁止チェックに差し替えた）。
-- **本部長依頼の「1文字ずつの突き合わせ」の結果**: `20260916010000_fix_chore_
-- reactions_supporter_target_dropped.sql`（本ファイルの直前の確定仕様）の
-- ポリシー定義・関数本体と突き合わせたところ、差分はいずれも上記の意図した
-- 1箇所（役割条件→自己リアクション禁止条件の置き換え）のみであり、
-- `family_id = current_family_id()`・`reacted_by = current_family_member_id()`・
-- `kind = 'comment'`制約、関数本体のステップ1（対象completionの存在確認・
-- 自家族限定）・ステップ3〜5（トグル判定・DELETE・INSERT）はいずれも文字通り
-- 無変更だった（175章に差分の詳細を記録）。
-- これに伴い、S1（27のまま。テーブルの追加・削除は無い）・S3（54本のまま。
-- `chore_reactions_insert_scoped`1行のみハッシュが変わる）・S4（58のまま。
-- 関数の追加・削除は無く、GRANT/REVOKEもシグネチャ不変のCREATE OR REPLACEで
-- 維持されるため変わらない）を更新した。いずれもローカルDocker環境で実測した値
-- （96.5章の遵守。手計算していない。修正前に本スイートを実行し46項目すべて
-- PASSであることを確認したうえで、修正後に想定どおりS3のみFAILすることを確認
-- してからハッシュを更新した。実測結果は175.4節参照）。本マイグレーションは
-- 175章時点でローカルDocker環境に適用済み・実測済み。本番へは未適用
-- （`20260916010000`とあわせて本部長の操作を待つ）。
--
-- [2026-09-09追加・開発部] 利用規約への同意取得＋Play Families安全リマインダー
-- （やること.md 2-22、市場調査部レポート サマリー表#1・#7、開発部/成果物/
-- 実装メモ.md 181章、マイグレーション`20260918010000_terms_consent.sql`）に伴い、
-- 新規テーブル`terms_consents`を追加した（join_consentsと同じ設計：追記専用、
-- SELECTポリシー2本のみでINSERT/UPDATE/DELETEポリシーは無し、書き込みは
-- SECURITY DEFINER関数`record_terms_consent()`のみに閉じる）。
-- S1（27→28）・S3（54→56本、下記2本を追加）・S4（58→61件、
-- `current_terms_consent_version`・`has_agreed_to_current_terms`・
-- `record_terms_consent`を追加）を更新した。terms_consents_select_by_parentの
-- 条件式`(family_id = current_family_id()) AND is_current_user_parent()`は
-- join_consents_select_by_parentと文字通り同一、terms_consents_select_ownの
-- 条件式`family_member_id = current_family_member_id()`はjoin_consents_
-- select_ownと文字通り同一のため、いずれもハッシュが一致することをローカル
-- Dockerで実測して確認した（104章の教訓どおり、手計算ではなく実測。96.5章の
-- 遵守）。A層にA26（保護者: terms_consentsに他家族の行が見えない）を追加した
-- （A23〜A25と同じ形）。本マイグレーションは181章時点でローカルDocker環境に
-- 適用済み・実測済み。本番へは未適用（本部長の操作を待つ）。
--
-- [2026-09-17更新・開発部／実装メモ237章] 習慣カード（台紙）とフィギュア
-- （要件定義書07-28章、設計部/成果物/スキーマ設計.sql 55章、
-- supabase/migrations/20260925010000_habit_cards_and_figures.sql）対応で
-- S1（31→34、habit_figure_catalog・habit_cards・habit_figure_grantsを追加）・
-- S3（60→63本、上記3テーブルのSELECTポリシー3本を追加）・
-- S4（65→71件、chores_after_insert_create_habit_card・habit_cards_before_write・
-- habit_card_progress_bump・end_habit_card・decorate_tree_with_habit_figure・
-- move_tree_habit_figureの6件を追加）を更新した。A層にA29（habit_cards）・
-- A30（habit_figure_grants）を追加した（A23〜A28と同じ形）。ハッシュ・件数は
-- いずれもローカルDockerで実測して確認した（96.5章の遵守）。ローカルで全52件
-- PASSを確認済み（開発部/成果物/実装メモ.md 237章）。本番へは未適用（本部長の
-- 操作を待つ）。
--
-- [同時修正・pre-existing gapの発見] 上記の実測時、本ファイルを更新する前の
-- 時点で既にS1=31・S4=65（30・63ではない）とズレていることを発見した。原因は
-- `20260924010000_member_avatars.sql`（07-28章とは無関係の別タスク「アバターを
-- お絵かきにする」の成果物）がmember_avatarsテーブル・2ポリシー・2関数
-- （is_valid_avatar_line_data・member_avatars_before_write）を追加していたに
-- もかかわらず、当時このファイルへ一度も反映されていなかったこと
-- （同マイグレーション30行目に「S1: +1」との自己申告コメントがあったが、
-- 本ファイル側の更新が漏れていた）。「既存の検査が全部通ること」を満たすため、
-- 07-28章の担当外だがこのタスクの中であわせて反映した（S1に+1、S3に+2、
-- S4に+2、A31を新設）。
--
-- [2026-09-19更新・開発部・実装メモ.md 256章] シール帳の全面作り替え
-- （要件定義書07-28章2026-09-19全面改訂・決定25〜33、設計部/成果物/
-- スキーマ設計.sql 57章、`supabase/migrations/
-- 20260927010000_habit_cards_full_rebuild.sql`）に伴い、S1（34のまま。
-- 新しいテーブルは追加していない。`habit_card_chore_breakdown`はViewの
-- ためS1には数えない）・S3（63のまま。既存3ポリシー〈habit_cards_select_
-- same_family・habit_figure_catalog_select_authenticated・habit_figure_
-- grants_select_same_family〉はいずれも無変更、新規ポリシーも追加して
-- いない）を確認した。**S4は71→70（-2+1）**：撤去した
-- `chores_after_insert_create_habit_card`・`end_habit_card`の2件を一覧
-- から削除し、新設した`choose_habit_card_kind`を1件追加した。
-- `habit_card_progress_bump`・`habit_cards_before_write`・
-- `chores_before_write`はいずれも`CREATE OR REPLACE`（名前を変えていない）
-- ため一覧の増減には影響しない。新設した
-- `family_members_after_insert_create_habit_card`（トリガー関数、
-- SECURITY DEFINERだが明示的なREVOKEを行っていない）も一覧に追加した
-- （+1）。したがって内訳は「-2（撤去2件）+1（choose_habit_card_kind）
-- +1（family_members_after_insert_create_habit_card）=70」。設計部57.10章の
-- 見込み「S4は±0（内訳-1+1）」とは、`family_members_after_insert_create_
-- habit_card`をトリガー関数のため対象外とした前提が実測と食い違った
-- （89章〜149行目の教訓と同じパターン：トリガー関数もS4の対象になる）。
-- ローカルDockerで実測して確認したうえで報告し、期待値を実測どおりに
-- 更新した（96.5章「期待値が実測と違ったら期待値を書き換えず報告する」を
-- 遵守。詳細は開発部/成果物/実装メモ.md 256章）。ローカルDocker環境に
-- 適用済み・実測済み。本番へは未適用（本部長の操作を待つ）。
--
-- [2026-09-20更新・開発部] 本部長依頼「5件のDBマイグレーションを1回にまとめる」
-- （content_reports・hidden_contents・保護者トグル1つ・4-70の文言修正・4-58の
-- DB側）に伴い、S1（34→36、content_reports・hidden_contentsを追加）・
-- S3（63→65、下記2本を追加）・S4（→78、下記7件を追加）を更新した。
--   - content_reports（設計部/成果物/スキーマ設計.sql 65章）:
--     SELECTポリシー`content_reports_select_own`1本のみ
--     （`reporter_member_id = current_family_member_id()`。family_idで絞る
--     条件・is_current_user_parent()はいずれも意図的に置かない。65.3章の
--     核心）。INSERT/UPDATE/DELETEポリシーは無い（書き込みは
--     submit_content_report()のみ）。ハッシュはローカルDockerで実測した
--     （新規の条件式のため既存ハッシュの引き写しはできない）。
--   - hidden_contents（設計部/成果物/スキーマ設計.sql 66章）:
--     SELECTポリシー`hidden_contents_select_same_family`1本のみ
--     （`family_id = current_family_id()`）。既存の多数のSELECTポリシーと
--     条件式が文字通り同一のため、承認済み一覧からハッシュを引き写せた
--     （104章の教訓）。INSERT/UPDATE/DELETEポリシーは無い（運営が
--     service_roleでhide_content()/unhide_content()を使う。アプリからは
--     誰も書けない）。
--   - 保護者トグル1つ（設計部/成果物/スキーマ設計.sql 67章）: familiesに
--     列3つ（social_interactions_enabled・social_settings_updated_by・
--     _at）を追加したが、familiesの既存ポリシーは1本も変更していないため
--     S3には影響しない。新設した関数`set_family_social_settings`・
--     `is_family_social_interactions_enabled`と、トリガー関数4本
--     （family_board_posts_social_toggle_guard・
--     family_board_reactions_social_toggle_guard・
--     chore_reactions_social_toggle_guard・
--     gratitude_points_social_toggle_guard）をS4に追加した（計6件）。
--     いずれもauthenticatedへのEXECUTE権限を持つ（前者2つは明示GRANT、
--     後者4つはトリガー関数につき既存の同種関数と同じ理由で自動付与。
--     34.5章の既知の挙動）。
--   - content_reportsの書き込み経路`submit_content_report`もS4に追加
--     （明示的にauthenticatedへGRANT）。したがってS4の増分は7件
--     （is_family_social_interactions_enabled・set_family_social_settings・
--     submit_content_report・トリガー関数4本）。
--   - `hide_content`・`unhide_content`（運営専用）はauthenticated・anon・
--     PUBLICすべてからREVOKEしてあるため、S4には**含めない**（アプリの
--     操作UIを持たない決定7のとおり）。
--   - gratitude_points.noteのNULL許容化（67.3章）・chore_completionsへの
--     activity_date列追加（58章）・chore_completions_before_insert()の
--     改訂（58章・4-70）はいずれもRLSポリシー・S4対象関数の権限に影響
--     しないため、S1/S3/S4のいずれにも別途の増減は無い
--     （chore_completions_before_insert()はCREATE OR REPLACEだが
--     トリガー本体は既存のものを再利用、シグネチャ不変のためS4の一覧
--     自体には変化なし）。
--   - [同時発見・ラベル文言のみのpre-existing gap] 本更新の実測時、
--     S4のラベル文言が「70件」のままだったが、`expected` CTEの実際の
--     要素数は71件だった（重複・過不足は無いことを確認済み。中身は
--     正しいまま、説明文言の数字だけが1件古かった）。中身（判定ロジック）
--     は書き換えず、ラベルの数字表記のみ実測どおりに直した。
--   ハッシュ・件数はいずれもローカルDockerで`supabase db reset`後に実測
--   して確認した（96.5章の遵守）。ローカルDocker環境に適用済み・実測済み。
--   本番へは未適用（本部長の操作を待つ）。詳細は開発部/成果物/実装メモ.md
--   参照。
--
-- [2026-09-20再更新・開発部] 本部長依頼「ブロックとNGワードフィルタを実装」に伴い、
-- member_blocks（要件定義書07-32章 決定11〜14、設計部/成果物/スキーマ設計.sql
-- 69章、`supabase/migrations/20260930050000_member_blocks.sql`）を追加した。
-- S1（36→37）・S3（65→68、下記3本を追加）を更新した。**S4は変更なし**
-- （member_blocksはSECURITY DEFINER関数を1本も新設しない設計。69.5章
-- 「最低限でよい」という統括の条件に照らし、書き込みはPostgRESTの直接操作
-- のみで完結させた）。NGワードフィルタ（決定15〜19、スキーマ設計.sql 70章）は
-- DBに何も作らない確認メモのため、S1/S3/S4のいずれにも変更は無い（クライアント
-- 側の定数ファイル・判定関数のみ、`src/lib/ngWordFilter.ts`）。
--   - member_blocks_select_own（SELECT、`blocker_member_id =
--     current_family_member_id()`）: 既存の多数のSELECTポリシー
--     （categories_select_same_family等、条件式`family_id = current_family_id()`）
--     とは条件式が異なる新しい形のため、承認済み一覧からの引き写しはできず、
--     ローカルDockerで実測した。
--   - member_blocks_insert_own（INSERT、`family_id = current_family_id() AND
--     blocker_member_id = current_family_member_id() AND EXISTS(...)`）:
--     新しい形のため実測した。
--   - member_blocks_delete_own（DELETE、`blocker_member_id =
--     current_family_member_id()`）: select_ownと条件式が文字通り同一のため
--     同じハッシュになる（104章の教訓どおり）。
--   [2026-09-20訂正・本部長からの当日指示についての記録] 07-32-7と07-32-9の
--   矛盾（子どもの画面にブロックの導線を置くか）が見つかり、本部長の判断で
--   「置かない」（07-32-7が正）に確定した。**この制限はDB・RLSでは持たせて
--   いない**（RLSは3ロールとも読み書きできる設計のまま、69.3章・上記の
--   member_blocks_*_own 3本を参照）。したがってこの訂正はS1/S3/S4のいずれの
--   数値・ハッシュにも影響しない。制限はアプリ側
--   （`src/data/store.tsx`の`blockMember`/`unblockMember`）が持つ。
--   ハッシュ・件数はローカルDockerで`supabase db reset`後に実測して確認した
--   （96.5章の遵守）。ローカルDocker環境に適用済み・実測済み。本番へは
--   未適用（本部長の操作を待つ）。詳細は開発部/成果物/実装メモ.md参照。
--
-- [2026-09-21追加・開発部] 退会・アカウント削除・家族削除（要件定義書07-33章、
-- 設計部/成果物/スキーマ設計.sql 68章、開発部/成果物/実装メモ.md 273章）に
-- 伴い、S4（79→80、`account_deletion_preview`を追加）を更新した。
-- S1（37のまま。新しいテーブルを追加していない。68章は新しいテーブルを
-- 1つも作らない）はいずれも±0。
-- `transfer_family_ownership`はservice_roleにのみGRANTしており
-- （authenticated/anonは明示REVOKE）、S4には含めない。
--
-- [2026-09-21再追加・開発部] 「自分で目標を決める」（要件定義書07-36章、
-- 設計部/成果物/スキーマ設計.sql 71章、開発部/成果物/実装メモ.md参照）に伴い、
-- member_goalsテーブルを新設。S1（37→38）。S3（68→70、member_goalsの
-- SELECT（`family_id = current_family_id()`のみのため既存の多数のSELECT
-- ポリシーと同一ハッシュ`ba5f17c68a4ed3412761e44aff4d2f47`）・UPDATE
-- （`is_current_user_parent() AND retired_at IS NULL`を含む新しい条件式の
-- ため新規ハッシュ）の2本を追加。S4（80→82、トリガー関数
-- `member_goals_before_write`・SECURITY DEFINER関数`set_member_goal`を
-- 追加）。**設計部/成果物/スキーマ設計.sql 71.7章は「S4+1」の見込みを示して
-- いたが、実測は+2だった**（トリガー関数はEXECUTEを明示GRANTしていなくても
-- デフォルトでPUBLIC実行可のためS4に数えられる。既存のhabit_cards_before_
-- write・chore_nfc_tags_before_write等のトリガー関数も同じ理由でS4に含まれて
-- おり、本件も同じ扱いが正しい。本部長に報告済み）。ハッシュ・件数はローカル
-- Dockerで`supabase db reset`後に実測して確認した（96.5章の遵守）。ローカル
-- Docker環境に適用済み・実測済み。本番へは未適用（本部長の操作を待つ）。
--
-- [2026-09-22追加・開発部] プッシュ通知（要件定義書07-37章、設計部/成果物/
-- スキーマ設計.sql 74章、API仕様.md 31章）に伴い、S1（38のまま。新しい
-- テーブルを追加していない。families・push_tokensの2表へのALTERのみ）・
-- S3（70のまま。RLSポリシーを1本も追加・変更していない）はいずれも±0。
-- S4（82→84、トリガー関数`family_board_posts_after_insert_notify`・
-- SECURITY DEFINER関数`set_family_push_notifications_enabled`の2本を
-- 追加）。**設計部/成果物/スキーマ設計.sql 74.11章は「トリガー関数は
-- S4に数えない（271.2.1節の既存分類にならい対象外）」としていたが、実測は
-- +2だった**（member_goals_before_writeのときと同じ食い違いパターン——
-- トリガー関数はEXECUTEを明示GRANTしていなくてもデフォルトでPUBLIC実行可
-- のためS4に数えられる。content_reports_after_insert_notify自身も同じ
-- 理由でS4に含まれており、本件も同じ扱いが正しい）。ハッシュ・件数は
-- ローカルDockerで`supabase db reset`後に実測して確認した（96.5章の
-- 遵守）。ローカルDocker環境に適用済み・実測済み。本番へは未適用（本部長の
-- 操作を待つ）。詳細は開発部/成果物/実装メモ.md参照。
--
-- あわせて「振り返る機会」（要件定義書07-35章、スキーマ設計.sql 72章）で
-- 新設した`chore_weekly_completion_counts`はViewであり、既存の
-- `chore_completions_select_scoped`（security_invoker=true）がそのまま
-- 適用されるため、S1/S3/S4のいずれにも変化は無い（72.5章の見込みどおり。
-- ローカルDockerで実測し、差分が出ないことを確認した）。
-- `family_members_before_update()`はCREATE OR REPLACEで改訂した
-- （バイパス条件にsupabase_auth_adminを追加・is_ownerの変更を保護者かどうか
-- 問わず禁止）が、トリガー関数の名前・シグネチャ自体は変わっていないため、
-- S4の集計（`DISTINCT proname`）には現れない。
--
-- **S3は68本のまま（±0）だが、`family_members_update_scoped`（UPDATE）
-- 1本のハッシュが変わった。**設計部の68.4章には無い、開発部が動作確認中に
-- 発見した3つ目の必須修正である。`supabase functions serve`＋実際のGoTrue
-- 管理APIで`delete-account`を通しで実行したところ、
-- `ERROR: function is_current_user_parent() does not exist (SQLSTATE 42883)`
-- という500エラーが実際に発生した。原因はトリガーではなくRLSポリシー
-- 自身——`supabase_auth_admin`ロールはBYPASSRLSを持たず、かつ
-- `search_path=auth`が既定設定されているため（`pg_roles.rolconfig`で確認）、
-- `family_members_update_scoped`のスキーマ修飾の無い関数呼び出し
-- （`current_family_id()`等）を解決できなかった。ポリシーに
-- `current_user IN ('service_role','supabase_auth_admin')`のバイパスを足し、
-- 既存3関数呼び出しを`public.`で完全修飾する形に改めた（条件の意味は
-- 変えていない）。詳細はマイグレーション
-- `20260930070000_account_and_family_deletion.sql`4節、実装メモ.md 273章。
-- いずれもローカルDocker環境で`supabase db reset`後に実測した値（96.5章の
-- 遵守。手計算していない）。本番へは未適用（本部長の操作を待つ）。
--
-- [2026-09-25追加・開発部] Supabaseの自動GRANT廃止対応（やること.md 4-78、
-- 開発部/成果物/実装メモ.md 295章）に伴い、C層にS5を新設した。
-- `20260930150000_explicit_public_grants_pre_2026_10_30.sql`で本番と同じ権限
-- （anon・authenticated・service_role の3ロール×7権限×54個〈表42＋ビュー12〉）
-- を明示的なGRANTとして書き下したが、これはS1〜S4のいずれの判定対象
-- （RLS有効化・ポリシー本数・関数のEXECUTE権限）にも含まれないため、本ファイル
-- の既存項目だけでは「GRANTを付け忘れたこと」自体を検出できない。S5はこの穴を
-- 埋めるためのテーブル横断チェックであり、10月30日以降に新しい表を作る
-- マイグレーションでGRANTを書き忘れた場合、`supabase db reset`後の本スイート
-- 実行でFAILとして検出できる（詳細はS5本体のコメント参照）。上記マイグレーション
-- はローカルDockerで実測し、本番の権限（3ロール×7権限×54個）と一致すること・
-- 本スイート52件（S5追加後は53件）全てPASSすることを確認済み（実装メモ.md
-- 295章）。本番へは未適用（本部長の操作を待つ）。
--
-- [2026-09-25再追加・開発部] ごほうびの交換の直後の取消（要件定義書07-39章、
-- 設計部/成果物/スキーマ設計.sql 77章、開発部/成果物/実装メモ.md 298章）に
-- 伴い、S4（98→99、SECURITY DEFINER関数`cancel_reward_redemption`を
-- `cancel_chore_completion`と同じ方式で追加）を更新した。S1（新しいテーブル
-- を追加していない）・S3（`reward_redemptions`への新しいポリシーを追加して
-- いない）はいずれも±0（77.6章の見込みどおり。ローカルDockerで
-- `supabase db reset`後に実測して一致を確認した。96.5章の遵守）。ローカル
-- Docker環境に適用済み・実測済み。本番へは未適用（本部長の操作を待つ）。
--
-- [2026-09-26再追加・開発部] みまもり共通クエスト（scope='supporter_shared'）
-- でもNFCタグを使えるようにする対応（やること.md 4-10、設計部/成果物/
-- スキーマ設計.sql 78章、開発部/成果物/実装メモ.md 307章）に伴い、S3
-- （76→78、`chore_nfc_tags_insert_supporter_shared_by_creator`・
-- `chore_nfc_tags_revoke_supporter_shared_by_creator`の2本を追加）を更新した。
-- S1（新しいテーブルを追加していない）・S4（`chore_nfc_tags_before_write`は
-- 既存の名前・シグネチャのままCREATE OR REPLACEするのみ）はいずれも±0
-- （78.7章の見積りどおり。ローカルDockerで実測して一致を確認した。96.5章の
-- 遵守）。ローカルDocker環境に適用済み・実測済み。本番へは未適用（本部長の
-- 操作を待つ）。
--
-- ■ 実行方法（本番に対して読み取りのみ。最後にROLLBACKする）
--   cd oyakopoint-app
--   npx supabase db query --linked -f supabase/tests/rls_checks.sql
--
-- ■ ローカルでの実行方法（A層も含めて全件検査する場合）
--   1. `supabase start` または `supabase db reset` でローカルDBに
--      `supabase/seed.sql`（テスト家族2件）を投入しておく。
--   2. `docker exec -i supabase_db_<project>-app psql -U postgres -d postgres -q -f - < supabase/tests/rls_checks.sql`
--      （`npx supabase db query` はローカル対象だと挙動が異なるため使わない。
--      開発部/成果物/実装メモ.md 105章参照）
--
-- ■ FAILしたときの対応
--   S3/S4がFAILしたら、それは「意図した変更」か「事故」かを必ず判断すること。
--   意図した変更なら、このファイルのスナップショットを更新する（＝レビューの機会）。
--   **FAILを消すためにスナップショットを更新するのは禁止。** それをやると、
--   テストは「通すことが目的の形骸化した記録」に変わり、無いより悪くなる。
--   SKIPはFAILではない（本番のA層など、検査対象がそもそも存在しない場合の
--   正常な表示）。SKIPが出るべきでない環境（ローカルの全層検査時）でSKIPが
--   出た場合は、ガード条件の判定ミスを疑うこと。
-- ============================================================

BEGIN;

CREATE TEMP TABLE _r(layer text, name text, expected text, actual text, ok boolean);
GRANT INSERT ON _r TO authenticated;


-- ============================================================
-- C層: 定義のスナップショット照合（管理者権限で実行）
-- ============================================================

-- S1. RLSが有効なテーブル数。新しいテーブルを追加してRLSを付け忘れると減る。
-- [2026-09-01更新] family_board_reactions（開発部/成果物/実装メモ.md 103章）の
-- 追加により21→22。他のテーブルには変更が無い（下記S3差分確認と同じ103章参照）。
-- [2026-09-01再更新] chore_nfc_tags（開発部/成果物/実装メモ.md 108章）の追加に
-- より22→23。
-- [2026-09-02再更新] join_consents（開発部/成果物/実装メモ.md 111章）の追加に
-- より23→24。
-- [2026-09-07再更新] sticker_catalog・ornament_sticker_purchases・member_badges
-- （開発部/成果物/実装メモ.md 138章）の追加により24→27。
-- [2026-09-09再更新] terms_consents（開発部/成果物/実装メモ.md 181章）の追加に
-- より27→28。
-- [2026-09-11再更新] メダルの段階リセット（要件定義書07-25-1章決定20〜27、
-- 設計部/成果物/スキーマ設計.sql 52章、開発部/成果物/実装メモ.md 200章）に伴い、
-- sticker_tier_resetsを追加。28→29。設計部52.10章の見込み（28→29）と一致した
-- （ローカルDockerで実測。96.5章の遵守）。
-- [2026-09-11再々更新] メダルの値段を家族ごとに編集できるようにする（要件定義書
-- 07-25-1章決定10〜18、設計部/成果物/スキーマ設計.sql 53章、開発部/成果物/
-- 実装メモ.md 201章）に伴い、family_sticker_pricesを追加。29→30。設計部53.12章の
-- 見込み（29→30）と一致した（ローカルDockerで実測。96.5章の遵守。
-- sticker_catalog_effective_pricesはViewのためS1には数えない）。
-- [2026-09-17再更新・開発部/成果物/実装メモ.md 237章] 07-28章「習慣カード（台紙）と
-- フィギュア」対応（supabase/migrations/20260925010000_habit_cards_and_figures.sql）で
-- habit_figure_catalog・habit_cards・habit_figure_grantsの3テーブルを追加。30→33。
--
-- [同時発見・pre-existing gap] ローカルDockerで実測したところ、本ファイルを更新する
-- 前の時点で既に実際の値が31（30ではない）だった。原因を調査した結果、
-- `20260924010000_member_avatars.sql`（アバターをお絵かきにする機能、本タスクとは
-- 無関係の別タスクの成果物）がmember_avatarsテーブルを新規にRLS有効化していたが
-- （同マイグレーション30行目に「S1: +1」との自己申告コメントがあるにもかかわらず）、
-- 本ファイルの当時の更新でこの分がS1・S3・S4のいずれにも反映されていなかった
-- （本ファイルにmember_avatarsの記載が1件も無いことで確認）。07-28章の担当外だが、
-- 「既存の検査が全部通ること」を満たすため、このタスクの中であわせて反映した
-- （開発部/成果物/実装メモ.md 237章に経緯を記録）。31+3=34。
-- [2026-09-20再更新] content_reports・hidden_contents（設計部/成果物/
-- スキーマ設計.sql 65章・66章）の2テーブルを追加。34→36。familiesへの
-- 列3つの追加（67章）は既存テーブルへのADD COLUMNのためS1には数えない。
-- [2026-09-20再々更新] member_blocks（設計部/成果物/スキーマ設計.sql 69章）を
-- 追加。36→37。NGワードフィルタ（70章）はDBに何も作らないためS1に影響しない。
-- families・push_tokensへの列追加のみのプッシュ通知（掲示板の通知、74章）は
-- 新規テーブルが無いためS1に影響しない。37のまま。
-- [2026-09-23再更新] 「メッセージ」（社内呼称: 定時アナウンス、要件定義書
-- 07-37章4章、開発部/成果物/実装メモ.md 292章）でfamily_scheduled_
-- announcementsを追加。38→39（ローカルDockerで実測。96.5章の遵守）。
-- family_membersへの列1本の追加のみはS1に影響しない。
-- [2026-09-23再々更新・やること.md 2-69・2-70・5-13、実装メモ.md 293章]
-- 掲示板のコメント・お絵かきのコメント・お絵かきのリアクション
-- （family_board_comments・family_drawing_comments・family_drawing_
-- reactions）の3テーブルを新設。39→42（ローカルDockerで実測。96.5章の
-- 遵守）。chore_reactionsへの列2本（deleted_at・deleted_by_member_id）の
-- 追加のみはS1に影響しない（既存テーブルへのADD COLUMN）。
INSERT INTO _r
SELECT 'C層', 'S1 RLSが有効なテーブル数', '42', count(*)::text, count(*) = 42
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;

-- S2. family_member_pins（子どものPIN）は、RLSが有効でポリシーが1本も無い状態が正しい。
--     ポリシーゼロ＝誰も読めない・書けない。触れるのはservice_roleのEdge Functionのみ。
--     将来うっかりポリシーを1本足すと、PINハッシュが読める状態に変わる。無症状で。
INSERT INTO _r
SELECT 'C層', 'S2 PINテーブルのポリシー数（0が正しい）', '0', count(*)::text, count(*) = 0
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'family_member_pins';

-- S3. ポリシー52本の一覧と中身の照合（2026-09-01更新、family_board_reactions追加分含む。
--     2026-09-01再更新、family_board_reactionsのSELECTをLINE風個数表示対応で改名・
--     条件式変更。実装メモ.md 104章。2026-09-01再々更新、chore_nfc_tags
--     （NFCタグの人ごと化、実装メモ.md 108章）の5ポリシーを追加。43→48本）。
--     2026-09-02再々々更新、join_consents（招待受諾フローの可視範囲説明と同意
--     取得、設計部/成果物/スキーマ設計.sql 40章・実装メモ.md 111章）のSELECT
--     2本を追加。48→50本。
--     2026-09-06更新、みまもりメンバー同士でのクエスト共同実施（設計部/成果物/
--     スキーマ設計.sql 45章、開発部/成果物/実装メモ.md 133章）。新規ポリシー2本
--     （chores_write_supporter_shared_by_creator・
--     rewards_write_supporter_shared_by_creator）を追加し、既存2本
--     （chore_completions_insert_self・reward_redemptions_insert_scoped）の
--     条件式にsupporter_shared分岐を追加した（本数は変わらずハッシュのみ変化）。
--     50→52本。ハッシュはローカルDockerで実測した（96.5章の遵守。手計算していない）。
--     2026-09-07更新、木を飾るステッカー購入とバッジ（実装メモ.md 138章）で
--     3ポリシーを追加。52→55本。2026-09-10再更新、家族の掲示板へのスタンプ
--     リアクションの取消・切替（実装メモ.md 159章）で`family_board_reactions_
--     insert_self`をDROPし置き換えを作らなかったため1本減。55→54本。
--     2026-09-12再更新、ごほうびの担当者新設・クエストの担当者をDBでも効かせる
--     （設計部/成果物/スキーマ設計.sql 50章・51章、開発部/成果物/実装メモ.md
--     163章）で`chore_completions_insert_self`・`reward_redemptions_insert_scoped`
--     の2本にscope='family'分岐への担当者条件を追加した（本数は変わらず
--     ハッシュのみ変化）。54本のまま。
--     2026-09-09更新、利用規約への同意取得＋Play Families安全リマインダー
--     （開発部/成果物/実装メモ.md 181章）でterms_consentsの2ポリシーを追加。
--     54→56本。
--     2026-09-11更新、メダルの段階リセット（要件定義書07-25-1章決定19〜29、
--     設計部/成果物/スキーマ設計.sql 52.3章、開発部/成果物/実装メモ.md 200章）で
--     sticker_tier_resetsのSELECTポリシー1本のみを追加。INSERT/UPDATE/DELETE
--     ポリシーは定義しない（決定24「取り消しは実装しない」をRLSレベルでも
--     担保する設計）。条件式`family_id = current_family_id()`はロールによる
--     絞り込みを持たない多数の既存SELECTポリシーと文字通り同一のため、
--     ハッシュも同一の値を引き写せる（104章の教訓）。56→57本。設計部52.10章の
--     見込み（56→57）と一致した（ローカルDockerで実測。96.5章の遵守）。
--     2026-09-11再更新、メダルの値段を家族ごとに編集できるようにする（要件定義書
--     07-25-1章決定10〜18、設計部/成果物/スキーマ設計.sql 53.3章、開発部/成果物/
--     実装メモ.md 201章）でfamily_sticker_pricesのSELECTポリシー1本のみを追加。
--     INSERT/UPDATE/DELETEポリシーは定義しない（決定17「保護者のみが変更できる」を
--     書き込み経路のset_family_sticker_prices()〈SECURITY DEFINER〉一本化で
--     担保する設計）。57→58本。設計部53.12章の見込み（57→58）と一致した
--     （ローカルDockerで実測。96.5章の遵守）。
--     追加・削除・改名・条件式の書き換えのいずれも検出する。
--     ハッシュは USING と WITH CHECK を連結したもののmd5。
WITH expected(t, p, c, h) AS (VALUES
  ('categories','categories_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('categories','categories_write_by_parent','ALL','a9c21f23a1a0b9627d69fdb5a4d29425'),
  -- [2026-09-12改訂] scope='family'分岐に担当者条件`(c.assigned_to IS NULL OR
  -- c.assigned_to = reported_by)`を追加（設計部/成果物/スキーマ設計.sql 51.3章、
  -- 開発部/成果物/実装メモ.md 163章）。personal/supporter_shared分岐は無変更だが
  -- 条件式全体が変わるためハッシュも変わる。ローカルDockerで実測した値
  -- （96.5章の遵守）。
  ('chore_completions','chore_completions_insert_self','INSERT','f3035b6602138f5668f00138e928e179'),
  ('chore_completions','chore_completions_select_scoped','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('chore_daily_flags','chore_daily_flags_own_rows','ALL','00e6fbca582d21a92747412aa943e2c2'),
  -- [2026-09-01追加] chore_nfc_tags（NFCタグの人ごと化、設計部/成果物/スキーマ設計.sql
  -- 39.4章、開発部/成果物/実装メモ.md 108章）。SELECTの条件式は
  -- `(family_id = current_family_id())`のみであり、既存の多数のSELECTポリシー
  -- （categories_select_same_family等）と文字通り同一のため、承認済み一覧から
  -- ハッシュを引き写せる（104章の教訓）。INSERT/UPDATEの4本はいずれもEXISTSで
  -- choresテーブルのscope・created_byを参照する新しい形の条件式であり、承認済み
  -- 一覧に文字通り同一のものが無いため、ローカルDockerで実測した（108章参照）。
  ('chore_nfc_tags','chore_nfc_tags_insert_family_by_parent','INSERT','c65f6bcf088e0509ebc68287eb3a2697'),
  ('chore_nfc_tags','chore_nfc_tags_insert_personal_by_creator','INSERT','6573bb8d8e4ba72fe84636642dbc942b'),
  -- [2026-09-26追加] みまもり共通クエスト（scope='supporter_shared'）対応
  -- （設計部/成果物/スキーマ設計.sql 78.3章・78.4章、開発部/成果物/実装メモ.md
  -- 307章、やること.md 4-10）。EXISTSでchoresのscope・created_byを参照する
  -- family/personal分と同種の新しい条件式であり、承認済み一覧に文字通り同一の
  -- ものが無いため、ローカルDockerで実測した。
  ('chore_nfc_tags','chore_nfc_tags_insert_supporter_shared_by_creator','INSERT','612f4c6e06171583aebd99ec12610ebc'),
  ('chore_nfc_tags','chore_nfc_tags_revoke_family_by_parent','UPDATE','4363f0549d157159f7553c9de572d3f4'),
  ('chore_nfc_tags','chore_nfc_tags_revoke_personal_by_creator','UPDATE','a299667c176e888b5d809f234cf7c088'),
  ('chore_nfc_tags','chore_nfc_tags_revoke_supporter_shared_by_creator','UPDATE','7d2fa24a7cbe01a9c1a23a75efb294a0'),
  ('chore_nfc_tags','chore_nfc_tags_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  -- [2026-09-10改訂] スタンプ（絵文字）リアクションの取消・切替（開発部/成果物/
  -- 実装メモ.md 157章、マイグレーション`20260910020000_toggle_chore_reaction_stamp.sql`）
  -- に伴い、`kind = 'comment'`条件を追加した（スタンプの直接INSERTを塞ぎ、
  -- 新設のSECURITY DEFINER関数`toggle_chore_reaction_stamp`経由に一本化するため）。
  -- [**この行は誤りだった**] 「家族・ロールの境界条件（保護者は誰にでも、子どもは
  -- 対象completionの報告者がparentの場合のみ）自体は変更していない」としていたが、
  -- 実際には送信者側の条件を`current_family_role() IN ('parent', 'supporter')`から
  -- `is_current_user_parent()`（parentのみ）へ書き換えており、みまもりメンバーが
  -- 送信できなくなるデグレを生んでいた（本部長の実機確認・2026-09-08）。
  -- [2026-09-08改訂] `20260914010000_fix_chore_reactions_supporter_dropped.sql`
  -- （開発部/成果物/実装メモ.md 170章）で送信者側（第1項）の条件を
  -- `current_family_role() IN ('parent', 'supporter')`に戻した（`kind = 'comment'`
  -- 制約は無変更）。**この時点では第2項（EXISTS内、子ども向けの条件）が
  -- `fm.role = 'parent'`のまま取り残されており、見落としに気づいていなかった。**
  -- [2026-09-09改訂・170章の取りこぼしを修正]
  -- `20260916010000_fix_chore_reactions_supporter_target_dropped.sql`
  -- （開発部/成果物/実装メモ.md 174章）で第2項も
  -- `fm.role IN ('parent', 'supporter')`に戻した（第1項・`kind = 'comment'`制約は
  -- 無変更）。`20260823070000_supporter_chore_public_visibility.sql`22番
  -- （本来の確定仕様）と1文字ずつ突き合わせ、他に差分が無いことを確認したうえで
  -- ローカルDockerで実測した値。
  -- [2026-09-09再改訂・要件定義書07-23章決定1・決定2、開発部/成果物/実装メモ.md
  -- 175章] 子どもどうしの完了報告リアクション解禁に伴い、役割による絞り込み
  -- （送信者側・対象側の第1項・第2項）を撤廃し、自己リアクション禁止
  -- （`NOT EXISTS (SELECT 1 FROM chore_completions cc WHERE cc.id = ... AND
  -- cc.reported_by = chore_reactions.reacted_by)`）に置き換えた
  -- （`20260916020000_chore_reactions_open_to_all_and_self_ban.sql`）。
  -- `family_id`・`reacted_by`・`kind = 'comment'`の3条件は無変更。
  -- `20260916010000`時点の定義と1文字ずつ突き合わせ、差分がこの1箇所のみである
  -- ことを確認したうえでローカルDockerで実測した値。
  ('chore_reactions','chore_reactions_insert_scoped','INSERT','b7e8b9ad7f8cd74a9f752434770251f4'),
  -- [2026-09-23改訂・やること.md 5-13、実装メモ.md 293章] 完了報告への
  -- コメントを消せるようにする対応で、SELECT条件式に`AND deleted_at IS
  -- NULL`を追加した（削除済みコメントを除外する。kind='stamp'の行は
  -- deleted_atが常にNULLのため可視性は変わらない）。新しい条件式
  -- `family_id = current_family_id() AND deleted_at IS NULL`は
  -- family_board_posts_select_same_familyと文字通り同一のため、同じ
  -- ハッシュ`a5197b0b086df242e18aa62005bacd00`になることをローカル
  -- Dockerで実測して確認した。
  ('chore_reactions','chore_reactions_select_same_family','SELECT','a5197b0b086df242e18aa62005bacd00'),
  ('chores','chores_select_scoped','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('chores','chores_write_family_by_parent','ALL','db358d8f020247f149283dbae29932a2'),
  ('chores','chores_write_personal_by_creator','ALL','c6135ee6661c1603743441b1049cb23f'),
  -- [2026-09-06追加] みまもり共通クエストの編集・削除を作成者本人（role='supporter'）
  -- に限定する新規ポリシー（設計部/成果物/スキーマ設計.sql 45.6章、決定2・決定3）。
  -- rewards側の同名パターンと条件式が文字通り同一のため、
  -- rewards_write_supporter_shared_by_creatorと同じハッシュになる（ローカルDockerで実測）。
  ('chores','chores_write_supporter_shared_by_creator','ALL','2a93eb3b57c53aa6ed099607a18ffa26'),
  -- [2026-09-20追加] content_reports（アプリ内の報告／お問い合わせ、設計部/成果物/
  -- スキーマ設計.sql 65章）。SELECTポリシーは「送信した本人の行だけ」
  -- （`reporter_member_id = current_family_member_id()`）の1本のみ。
  -- **family_idで絞る条件・is_current_user_parent()はいずれも意図的に
  -- 置かない**（65.3章の核心。同じ家族の保護者にも送信内容を見せない
  -- ため）。新規の条件式のため既存ハッシュの引き写しはできず、ローカル
  -- Dockerで実測した。INSERT/UPDATE/DELETEポリシーは無い（書き込みは
  -- submit_content_report()のみ、デフォルト拒否）。
  ('content_reports','content_reports_select_own','SELECT','a49e8d1b8af90d450307f4b1574b8e99'),
  ('families','families_select_own','SELECT','722858ebf783bd99a2a4163f56dd1634'),
  ('families','families_update_by_parent','UPDATE','e5f50b299119f3b60ec261510beff957'),
  ('family_board_posts','family_board_posts_insert_self','INSERT','28574b1aee58588a3134af369c0c701a'),
  ('family_board_posts','family_board_posts_select_same_family','SELECT','a5197b0b086df242e18aa62005bacd00'),
  -- [2026-09-10改訂・削除] family_board_reactions_insert_self（開発部/成果物/
  -- 実装メモ.md 159章、マイグレーション
  -- `20260910030000_toggle_family_board_reaction_stamp.sql`）。掲示板スタンプの
  -- 取消・切替導入に伴い、新設のSECURITY DEFINER関数
  -- `toggle_family_board_reaction_stamp`経由に一本化するため、このINSERT
  -- ポリシー自体をDROPし置き換えを作らなかった（157章のchore_reactionsと異なり
  -- `kind`列が無く残すべき直接INSERT経路が無いため。マイグレーション本体・
  -- 159章に判断理由を記録）。よってこの一覧からも1行削除する（55→54）。
  -- [2026-09-01再改訂] SELECTを「閲覧者自身の行のみ」→「家族全員が読める」へ変更した
  -- ことに伴い、ポリシー名を`family_board_reactions_select_own`→
  -- `family_board_reactions_select_same_family`に改名（実装メモ.md 104章）。
  -- 条件式が`family_id = current_family_id()`のみになったため、同じ条件式を持つ
  -- 他の多数のSELECTポリシー（例: chores_select_scoped・chore_completions_select_scoped
  -- 等）と全く同じハッシュ`ba5f17c68a4ed3412761e44aff4d2f47`になる（実装メモ.md 104章、
  -- 手計算の根拠として明記。この値は既存の複数の承認済みハッシュと文字通り同一の
  -- SQL文から導かれるため、103章時点の逆算よりも確度が高い推定値ではあるが、
  -- あくまで推定であり実測ではない）。
  ('family_board_reactions','family_board_reactions_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  -- [2026-09-23追加・やること.md 2-69、実装メモ.md 293章] 掲示板のコメント
  -- （設計部/成果物/スキーマ設計.sql 76.1章）。SELECT条件式`family_id =
  -- current_family_id() AND deleted_at IS NULL`はfamily_board_posts_
  -- select_same_familyと文字通り同一のためハッシュを引き写せる（104章の
  -- 教訓）。INSERT条件式`family_id = current_family_id() AND
  -- commenter_member_id = current_family_member_id()`は承認済み一覧に
  -- 文字通り同一のものが無い新しい形のため、ローカルDockerで実測した。
  -- UPDATE/DELETEポリシーは無い（削除はdelete_family_comment()経由のみ）。
  ('family_board_comments','family_board_comments_insert_self','INSERT','e18c8dbf2b8922a9452f1d16345caf76'),
  ('family_board_comments','family_board_comments_select_same_family','SELECT','a5197b0b086df242e18aa62005bacd00'),
  ('family_drawings','family_drawings_delete_own_unpublished','DELETE','b288307c791de3293dbe0464121e47b2'),
  ('family_drawings','family_drawings_insert_self','INSERT','d5df22021847ff4c6881807027f61ff4'),
  ('family_drawings','family_drawings_select_scoped','SELECT','10deb005fa63c8ea72d3cc971d7f672d'),
  -- [2026-09-23追加・やること.md 2-70、実装メモ.md 293章] お絵かきの
  -- コメント（設計部/成果物/スキーマ設計.sql 76.2章）。SELECT/INSERTとも
  -- family_board_commentsの対応ポリシーと条件式が文字通り同一のため同じ
  -- ハッシュになる（ローカルDockerで実測して確認）。UPDATE/DELETEポリシー
  -- は無い（削除はdelete_family_comment()経由のみ）。
  ('family_drawing_comments','family_drawing_comments_insert_self','INSERT','e18c8dbf2b8922a9452f1d16345caf76'),
  ('family_drawing_comments','family_drawing_comments_select_same_family','SELECT','a5197b0b086df242e18aa62005bacd00'),
  -- [2026-09-23追加・やること.md 2-70、実装メモ.md 293章] お絵かきの
  -- リアクション（設計部/成果物/スキーマ設計.sql 76.3章）。SELECT条件式
  -- `family_id = current_family_id()`のみで、既存の多数のSELECTポリシーと
  -- 文字通り同一のためハッシュを引き写せる（104章の教訓）。INSERT/UPDATE/
  -- DELETEポリシーは無い（書き込みはtoggle_family_drawing_reaction_
  -- stamp()経由のみ）。
  ('family_drawing_reactions','family_drawing_reactions_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('family_invites','family_invites_insert_by_parent','INSERT','111d46a4a91a73e658bd8dec8250e658'),
  ('family_invites','family_invites_select_by_parent','SELECT','a64bcea5635a1759018a24e6bf16edc5'),
  ('family_invites','family_invites_update_revoke_by_parent','UPDATE','a9c21f23a1a0b9627d69fdb5a4d29425'),
  ('family_members','family_members_insert_by_parent','INSERT','ee67a7d134e4edcb37570a091be74c85'),
  ('family_members','family_members_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('family_members','family_members_update_scoped','UPDATE','0fbb7ad8a2fef05dc6e61c965d0d70b0'),
  -- [2026-09-11追加] メダルの値段を家族ごとに編集できるようにする（要件定義書
  -- 07-25-1章決定10〜18、設計部/成果物/スキーマ設計.sql 53.3章、開発部/成果物/
  -- 実装メモ.md 201章）。SELECT条件式`family_id = current_family_id()`は
  -- 既存の多数のSELECTポリシーと文字通り同一のためハッシュを引き写せる
  -- （104章の教訓）。INSERT/UPDATE/DELETEポリシーは定義しない（決定17
  -- 「保護者のみが変更できる」を、書き込み経路をset_family_sticker_prices()
  -- 〈SECURITY DEFINER〉のみに閉じることで担保する設計）。ローカルDockerで
  -- 実測して確認した。
  ('family_sticker_prices','family_sticker_prices_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  -- [2026-09-23追加] 「メッセージ」（社内呼称: 定時アナウンス、要件定義書
  -- 07-37章4章、開発部/成果物/実装メモ.md 292章）。SELECT条件式
  -- `family_id = current_family_id()`は既存の多数のSELECTポリシーと
  -- 文字通り同一のためハッシュを引き写せる（104章の教訓）。INSERT/UPDATE/
  -- DELETEポリシーは定義しない（書き込みはset_family_scheduled_
  -- announcement()・delete_family_scheduled_announcement()〈いずれも
  -- SECURITY DEFINER〉のみに閉じる設計）。ローカルDockerで実測して確認した。
  ('family_scheduled_announcements','family_scheduled_announcements_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('family_tree_decorations','family_tree_decorations_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('family_tree_seasons','family_tree_seasons_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('gacha_draws','gacha_draws_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('gacha_member_progress','gacha_member_progress_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('gacha_preset_ornaments','gacha_preset_ornaments_select_authenticated','SELECT','eb28d87532d6edd9b635727493ef89f7'),
  ('gratitude_points','gratitude_points_insert_self','INSERT','3a333e6d1714c61877e086de96092891'),
  ('gratitude_points','gratitude_points_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('gratitude_points','gratitude_points_update_revoke_by_sender','UPDATE','5cc6c5f5c30e0d1ecae492e233a49ac1'),
  -- [2026-09-17追加] 習慣カード（台紙）とフィギュア（要件定義書07-28章、設計部/
  -- 成果物/スキーマ設計.sql 55章、開発部/成果物/実装メモ.md 237章）。
  -- habit_cards・habit_figure_grantsのSELECT条件式`family_id = current_family_id()`は
  -- 既存の多数のSELECTポリシーと文字通り同一のためハッシュを引き写せる（104章の
  -- 教訓）。habit_figure_catalogのSELECT条件式`true`（TO authenticated）は
  -- sticker_catalog_select_authenticated等と文字通り同一のため同じハッシュに
  -- なる。いずれもローカルDockerで実測して確認した。INSERT/UPDATE/DELETE
  -- ポリシーは3テーブルとも一切定義しない（書き込みはトリガー・
  -- end_habit_card()等のSECURITY DEFINER関数のみに閉じる、55.10章）。
  ('habit_cards','habit_cards_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('habit_figure_catalog','habit_figure_catalog_select_authenticated','SELECT','eb28d87532d6edd9b635727493ef89f7'),
  ('habit_figure_grants','habit_figure_grants_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  -- [2026-09-20追加] hidden_contents（運営による非表示＝決定7の段階3、設計部/
  -- 成果物/スキーマ設計.sql 66章）。SELECTポリシーは`family_id =
  -- current_family_id()`のみで、既存の多数のSELECTポリシーと文字通り同一の
  -- ためハッシュを引き写せる（104章の教訓）。INSERT/UPDATE/DELETEポリシーは
  -- 無い（運営がservice_roleでhide_content()/unhide_content()を使う。
  -- 保護者が戻せないことを「戻すポリシーを書かない」ことで担保している）。
  ('hidden_contents','hidden_contents_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  -- [2026-09-02追加] join_consents（招待受諾フローにおける可視範囲の説明と同意
  -- 取得、設計部/成果物/スキーマ設計.sql 40.4章、開発部/成果物/実装メモ.md
  -- 111章）。INSERT/UPDATE/DELETEポリシーは1本も定義しない設計（40.4章、書込みは
  -- SECURITY DEFINER関数のみに閉じる）。join_consents_select_by_parentの条件式
  -- `(family_id = current_family_id()) AND is_current_user_parent()`は
  -- family_invites_select_by_parentと文字通り同一のため、ハッシュも同一の値を
  -- 引き写せる（104章の教訓）。join_consents_select_ownの条件式
  -- `family_member_id = current_family_member_id()`は承認済み一覧に文字通り
  -- 同一のものが無い新しい形であり、ローカルDockerで実測した（111章参照）。
  ('join_consents','join_consents_select_by_parent','SELECT','a64bcea5635a1759018a24e6bf16edc5'),
  ('join_consents','join_consents_select_own','SELECT','a81cabc4ac6fc746a840a3457e019f8e'),
  -- [2026-09-07追加] 木を飾るステッカー購入とバッジ（設計部/成果物/スキーマ設計.sql
  -- 47章、開発部/成果物/実装メモ.md 138章）。member_badges・ornament_sticker_purchasesの
  -- SELECT条件式は`family_id = current_family_id()`のみであり、既存の多数のSELECT
  -- ポリシーと文字通り同一のためハッシュを引き写せる（104章の教訓）。
  -- sticker_catalogのSELECT条件式`true`（TO authenticated）はgacha_preset_ornaments_
  -- select_authenticatedと文字通り同一のため同じハッシュになる。いずれもローカル
  -- Dockerで実測して確認した。
  -- [2026-09-17追加・pre-existing gap修正、開発部/成果物/実装メモ.md 237章]
  -- member_avatars（要件定義書07-27章、`20260924010000_member_avatars.sql`、
  -- 07-28章とは無関係の別タスクの成果物）が本ファイルに一度も反映されて
  -- いなかったことをローカルDockerでの実測時に発見し、あわせて追加した。
  -- SELECT条件式`family_id = current_family_id()`は既存の多数のSELECT
  -- ポリシーと文字通り同一のためハッシュを引き写せる（104章の教訓）。
  -- write_self_or_parent（FOR ALL）の条件式`family_id = current_family_id()
  -- AND (is_current_user_parent() OR member_id = current_family_member_id())`は
  -- 承認済み一覧に文字通り同一のものが無い新しい形であり、ローカルDockerで
  -- 実測した。
  ('member_avatars','member_avatars_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('member_avatars','member_avatars_write_self_or_parent','ALL','17f6d38cb67dc4f94ec44da5105695c5'),
  ('member_badges','member_badges_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  -- [2026-09-21追加] member_goals（自分で目標を決める、要件定義書07-36章、
  -- 設計部/成果物/スキーマ設計.sql 71章）。SELECTの条件式
  -- `family_id = current_family_id()`のみであり、既存の多数のSELECTポリシーと
  -- 文字通り同一のためハッシュを引き写せる（104章の教訓）。UPDATEの条件式
  -- `family_id = current_family_id() AND is_current_user_parent() AND
  -- retired_at IS NULL`（USING）／`family_id = current_family_id() AND
  -- is_current_user_parent()`（WITH CHECK）は承認済み一覧に文字通り同一のものが
  -- 無い新しい形のため、ローカルDockerで実測した。INSERT/DELETEポリシーは
  -- 無い（71.4章。新規登録はset_member_goal()のみ、過去の目標は削除しない）。
  ('member_goals','member_goals_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('member_goals','member_goals_update_active_by_parent','UPDATE','f0557167a29a0a996784264f99470e17'),
  -- [2026-09-20追加] member_blocks（ブロック、設計部/成果物/スキーマ設計.sql
  -- 69章）。member_blocks_select_ownの条件式`blocker_member_id =
  -- current_family_member_id()`は既存の承認済み一覧に文字通り同一のものが
  -- 無い新しい形のため、ローカルDockerで実測した。member_blocks_delete_ownは
  -- select_ownと条件式が文字通り同一のため同じハッシュになる（104章の教訓）。
  -- member_blocks_insert_ownは`family_id = current_family_id() AND
  -- blocker_member_id = current_family_member_id() AND EXISTS(...)`という
  -- 新しい形のため実測した。INSERT/SELECT/DELETEの3本のみ（UPDATEポリシーは
  -- 意図的に無い。69.3章末尾）。
  ('member_blocks','member_blocks_delete_own','DELETE','48c89e953875d0091250ab24758f818f'),
  ('member_blocks','member_blocks_insert_own','INSERT','77a2bf4cc25584713ea6ee7de467366a'),
  ('member_blocks','member_blocks_select_own','SELECT','48c89e953875d0091250ab24758f818f'),
  ('ornament_sticker_purchases','ornament_sticker_purchases_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('push_tokens','push_tokens_delete_self','DELETE','d2d83fd3535d0c4e22eba82950957a4e'),
  ('push_tokens','push_tokens_insert_self','INSERT','bf39c4ff3a8b4f2b96611ea9d852daae'),
  ('push_tokens','push_tokens_select_self','SELECT','d2d83fd3535d0c4e22eba82950957a4e'),
  ('push_tokens','push_tokens_update_self','UPDATE','606756f6b2c2e03c671c60f4c0ddecca'),
  -- [2026-09-12改訂] scope='family'分岐に担当者条件`(r.assigned_to IS NULL OR
  -- r.assigned_to = member_id)`を追加（設計部/成果物/スキーマ設計.sql 50.5章、
  -- 開発部/成果物/実装メモ.md 163章）。personal/supporter_shared分岐は無変更だが
  -- 条件式全体が変わるためハッシュも変わる。ローカルDockerで実測した値
  -- （96.5章の遵守）。
  ('reward_redemptions','reward_redemptions_insert_scoped','INSERT','8c62197f12dd20d85ad1e99ea1aefdf4'),
  ('reward_redemptions','reward_redemptions_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('rewards','rewards_select_scoped','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  ('rewards','rewards_write_family_by_parent','ALL','db358d8f020247f149283dbae29932a2'),
  ('rewards','rewards_write_personal_by_creator','ALL','c6135ee6661c1603743441b1049cb23f'),
  -- [2026-09-06追加] みまもり共通ごほうびの編集・削除を作成者本人に限定する新規
  -- ポリシー（設計部/成果物/スキーマ設計.sql 45.8章、決定6'-2）。chores側の
  -- chores_write_supporter_shared_by_creatorと条件式が文字通り同一のため同じハッシュ。
  ('rewards','rewards_write_supporter_shared_by_creator','ALL','2a93eb3b57c53aa6ed099607a18ffa26'),
  ('sticker_catalog','sticker_catalog_select_authenticated','SELECT','eb28d87532d6edd9b635727493ef89f7'),
  -- [2026-09-11追加] メダルの段階リセット（設計部/成果物/スキーマ設計.sql
  -- 52.3章、開発部/成果物/実装メモ.md 200章）。SELECT条件式
  -- `family_id = current_family_id()`は既存の多数のSELECTポリシーと
  -- 文字通り同一のためハッシュを引き写せる（104章の教訓）。ローカルDockerで
  -- 実測して確認した。
  ('sticker_tier_resets','sticker_tier_resets_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47'),
  -- [2026-09-09追加] 利用規約への同意取得＋Play Families安全リマインダー
  -- （やること.md 2-22、開発部/成果物/実装メモ.md 181章）。join_consentsと
  -- 完全に同じ設計（追記専用、SECURITY DEFINER関数のみが書き込む）のため、
  -- 2ポリシーとも条件式がjoin_consentsの対応ポリシーと文字通り同一で、
  -- 同じハッシュになることをローカルDockerで実測して確認した。
  ('terms_consents','terms_consents_select_by_parent','SELECT','a64bcea5635a1759018a24e6bf16edc5'),
  ('terms_consents','terms_consents_select_own','SELECT','a81cabc4ac6fc746a840a3457e019f8e'),
  ('weekly_family_digests','weekly_family_digests_select_same_family','SELECT','ba5f17c68a4ed3412761e44aff4d2f47')
),
actual_p AS (
  SELECT tablename t, policyname p, cmd::text c,
         md5(coalesce(qual,'') || '|' || coalesce(with_check,'')) h
  FROM pg_policies WHERE schemaname = 'public'
),
diff AS (
  SELECT coalesce(e.t, a.t) || '.' || coalesce(e.p, a.p) ||
         CASE WHEN e.p IS NULL THEN '（承認されていないポリシーが増えている）'
              WHEN a.p IS NULL THEN '（ポリシーが消えている）'
              ELSE '（条件式が書き換わっている）' END AS msg
  FROM expected e FULL OUTER JOIN actual_p a ON a.t = e.t AND a.p = e.p
  WHERE e.p IS NULL OR a.p IS NULL OR e.c <> a.c OR e.h <> a.h
)
INSERT INTO _r
SELECT 'C層', 'S3 ポリシー78本の定義が承認済みと一致',
       'ずれ0件',
       coalesce((SELECT string_agg(msg, ' / ') FROM diff), 'ずれ0件'),
       NOT EXISTS (SELECT 1 FROM diff);

-- S4. authenticated（ログイン済み利用者）が実行できる関数の一覧。
--     84章の事故は、ここから1つ消えたことで起きた。増えるほうも危険。
WITH expected(f) AS (VALUES
  ('accept_family_invite'),
  -- [2026-09-07追加] badge_tier_thresholds（累計到達バッジの階段閾値、設計部/成果物/
  -- スキーマ設計.sql 47.6章、開発部/成果物/実装メモ.md 138章）。is_valid_drawing_
  -- line_data等と同じくLANGUAGE SQL・IMMUTABLEでSECURITY DEFINERではないため、
  -- 新規関数作成時にauthenticatedへEXECUTE権限が自動付与される（34.5章の既知の
  -- 挙動）。明示的なREVOKEは行っていない。
  ('badge_tier_thresholds'),
  -- [2026-09-03追加] cancel_chore_completion（完了報告の直後の取消、設計部/成果物/
  -- スキーマ設計.sql 43章、開発部/成果物/実装メモ.md 120章）。draw_gacha()等と同じく
  -- SECURITY DEFINERであり、43.7章の方針どおりPUBLIC/anonから明示的にREVOKEした
  -- うえでauthenticatedへ明示的にGRANTしている。
  ('cancel_chore_completion'),
  -- [2026-09-25追加] cancel_reward_redemption（ごほうびの交換の直後の取消、
  -- 要件定義書07-39章、設計部/成果物/スキーマ設計.sql 77章、開発部/成果物/
  -- 実装メモ.md 298章）。cancel_chore_completion()と同じくSECURITY DEFINERで
  -- あり、77.5章の方針どおりPUBLIC/anonから明示的にREVOKEしたうえで
  -- authenticatedへ明示的にGRANTしている。
  ('cancel_reward_redemption'),
  ('chore_completions_before_insert'),
  -- [2026-09-01追加] chore_nfc_tags_before_write（NFCタグの人ごと化、設計部/成果物/
  -- スキーマ設計.sql 39.3章、開発部/成果物/実装メモ.md 108章）。他のBEFORE INSERT/
  -- UPDATEトリガー関数（chores_before_write等）と同じくSECURITY DEFINERではないため、
  -- 新規関数作成時にauthenticatedへEXECUTE権限が自動付与される（34.5章の既知の挙動）。
  ('chore_nfc_tags_before_write'),
  ('chore_reactions_before_insert'),
  -- [2026-09-20追加] chore_reactions_social_toggle_guard（保護者トグル
  -- 「家族のやりとりを使う」、設計部/成果物/スキーマ設計.sql 67.4章）。
  -- kind='comment'の行のみ止めるBEFORE INSERTトリガー関数。他の非SECURITY
  -- DEFINER／明示REVOKEなしのトリガー関数と同じ理由でS4に含まれる
  -- （34.5章の既知の挙動）。
  ('chore_reactions_social_toggle_guard'),
  -- [2026-09-19追加・シール帳の全面作り替え] choose_habit_card_kind
  -- （進行中のシール帳の絵柄を選び直す、要件定義書07-28章決定29、設計部/成果物/
  -- スキーマ設計.sql 57.6章、開発部/成果物/実装メモ.md 256章）。
  -- cancel_chore_completion()等と同じくSECURITY DEFINERであり、PUBLIC/anonから
  -- 明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  ('choose_habit_card_kind'),
  -- [2026-09-17追加・2026-09-19撤去] chores_after_insert_create_habit_card
  -- （習慣カードの台紙自動作成、旧要件定義書07-28章、設計部/成果物/スキーマ設計.sql
  -- 55.6章）は、シール帳の全面作り替え（57.1章決定57-1）によりreward_mode列
  -- そのものが撤去されたため、この関数・対応トリガーも不要になりDROP FUNCTIONで
  -- 撤去した（`20260927010000_habit_cards_full_rebuild.sql`手順8）。この一覧
  -- からも削除する。
  ('chores_before_write'),('create_family_with_owner'),('current_family_id'),
  ('current_family_member_id'),('current_family_role'),
  -- [2026-09-02追加] current_join_consent_version（招待受諾フローにおける可視範囲の
  -- 説明と同意取得、設計部/成果物/スキーマ設計.sql 40.5章、開発部/成果物/実装メモ.md
  -- 111章）。max_unpublished_drawings_per_member等の既存の定数取得用ヘルパー関数と
  -- 同じくLANGUAGE SQLでSECURITY DEFINERではないため、新規関数作成時にauthenticatedへ
  -- のEXECUTE権限が自動付与される（34.5章の既知の挙動）。明示的なREVOKEは行っていない。
  ('current_join_consent_version'),
  -- [2026-09-09追加] current_terms_consent_version（利用規約への同意取得＋Play
  -- Families安全リマインダー、やること.md 2-22、開発部/成果物/実装メモ.md
  -- 181章）。current_join_consent_version等と同じくLANGUAGE SQLでSECURITY
  -- DEFINERではないため、新規関数作成時にauthenticatedへのEXECUTE権限が
  -- 自動付与される（34.5章の既知の挙動）。明示的なREVOKEは行っていない。
  ('current_terms_consent_version'),
  ('decorate_tree_with_gacha_prize'),
  -- [2026-09-17追加] decorate_tree_with_habit_figure（習慣カードのフィギュアを
  -- 木に自由配置する、要件定義書07-28章決定21、設計部/成果物/スキーマ設計.sql
  -- 55.9章、開発部/成果物/実装メモ.md 237章）。decorate_tree_with_sticker()等と
  -- 同じくSECURITY DEFINERであり、PUBLIC/anonから明示的にREVOKEしたうえで
  -- authenticatedへ明示的にGRANTしている。
  ('decorate_tree_with_habit_figure'),
  -- [2026-09-07追加] decorate_tree_with_sticker（木を飾るステッカー購入とバッジ、
  -- 設計部/成果物/スキーマ設計.sql 47.3章、開発部/成果物/実装メモ.md 138章）。
  -- decorate_tree_with_gacha_prize()等と同じくSECURITY DEFINERであり、
  -- PUBLIC/anonから明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  ('decorate_tree_with_sticker'),
  ('delete_family_board_post'),('draw_gacha'),('edit_unpublished_drawing'),
  -- [2026-09-17追加・2026-09-19撤去] end_habit_card（習慣カードを「おわりにする」、
  -- 旧要件定義書07-28章決定18・19）は、シール帳の全面作り替え（依頼文決定4
  -- 「1人1冊ずつ・進行中は常に1冊」）により手動終了という操作自体が不要になった
  -- ため、DROP FUNCTIONで撤去した（設計部/成果物/スキーマ設計.sql 57.3章決定
  -- 57-6、`20260927010000_habit_cards_full_rebuild.sql`手順9）。この一覧からも
  -- 削除する。
  -- [2026-09-19追加] family_members_after_insert_create_habit_card（家族に
  -- 新しいメンバーが加わった瞬間に進行中のシール帳を1冊自動作成する、要件定義書
  -- 07-28章決定27、設計部/成果物/スキーマ設計.sql 57.4章、開発部/成果物/
  -- 実装メモ.md 256章）。SECURITY DEFINERのトリガー関数だが明示的なREVOKEを
  -- 行っていないため、他の非REVOKEトリガー関数（member_badges_check_*等）と
  -- 同じ理由でS4に含まれる（89〜149行目の教訓のとおり、RETURNS TRIGGERで
  -- あることはS4の対象外を意味しない）。
  ('family_members_after_insert_create_habit_card'),
  ('family_board_posts_before_insert'),
  ('family_board_posts_before_update'),('family_board_posts_daily_limit'),
  ('family_board_posts_daily_used'),
  -- [2026-09-20追加] family_board_posts_social_toggle_guard（保護者トグル
  -- 「家族のやりとりを使う」、設計部/成果物/スキーマ設計.sql 67.4章）。
  -- 他の非SECURITY DEFINER／明示REVOKEなしのトリガー関数と同じ理由でS4に
  -- 含まれる（34.5章の既知の挙動）。
  ('family_board_posts_social_toggle_guard'),
  -- [2026-09-01追加] family_board_reactions_before_insert（開発部/成果物/実装メモ.md
  -- 103章）。他のBEFORE INSERTトリガー関数（chore_reactions_before_insert等）と同じく
  -- SECURITY DEFINERではないため、本プロジェクトの既知の挙動（34.5章）により新規関数
  -- 作成時にauthenticatedへEXECUTE権限が自動付与される。明示的なREVOKEは行っていない
  -- （既存の同種トリガー関数と同じ扱い）ため、この一覧にも追加する。
  ('family_board_reactions_before_insert'),
  -- [2026-09-20追加] family_board_reactions_social_toggle_guard（保護者
  -- トグル「家族のやりとりを使う」、設計部/成果物/スキーマ設計.sql 67.4章）。
  -- family_board_posts_social_toggle_guardと同じ理由でS4に含まれる。
  ('family_board_reactions_social_toggle_guard'),
  ('family_drawings_before_insert'),('family_invite_lookup'),
  ('family_invites_before_insert'),('family_invites_before_update'),
  ('family_member_pins_before_write'),('family_members_before_update'),('family_tree_seasons_bump'),
  ('family_tree_stage_for_count'),('gacha_drawing_weight'),('gacha_member_progress_bump'),
  ('gacha_preset_ornaments_before_update'),('generate_invite_code'),
  -- [2026-09-13削除・やること.md 4-7、開発部/成果物/実装メモ.md 165章]
  -- generate_weekly_family_digest()（引数なし版、8月のマイグレーションで
  -- 2引数化した際にDROPし忘れていた死んだオーバーロード）を明示DROPした。
  -- 現行版generate_weekly_family_digest(uuid,date)はservice_roleにのみ
  -- EXECUTE権限がある設計どおりの状態のままのため、authenticatedが実行
  -- できる関数のこの一覧からはproname自体が消える。
  ('gratitude_daily_allowance'),('gratitude_points_before_insert'),
  ('gratitude_points_before_update'),('gratitude_points_daily_used'),
  -- [2026-09-20追加] gratitude_points_social_toggle_guard（保護者トグル
  -- 「家族のやりとりを使う」、設計部/成果物/スキーマ設計.sql 67.4章）。
  -- noteが非NULLの行のみ止めるBEFORE INSERTトリガー関数。感謝ポイントを
  -- 贈ること自体（note=NULL）は止めない。他の非SECURITY DEFINER／明示
  -- REVOKEなしのトリガー関数と同じ理由でS4に含まれる。
  ('gratitude_points_social_toggle_guard'),
  -- [2026-09-17追加] habit_card_progress_bump・habit_cards_before_write
  -- （習慣カードの累計カウント・自動付与、家族整合性検証・3枚上限の強制。
  -- 要件定義書07-28章、設計部/成果物/スキーマ設計.sql 55.5章・55.3a章、
  -- 開発部/成果物/実装メモ.md 237章）。他の非SECURITY DEFINER／明示REVOKEなしの
  -- トリガー関数と同じく、新規関数作成時にauthenticatedへEXECUTE権限が
  -- 自動付与される（34.5章の既知の挙動）。
  ('habit_card_progress_bump'),('habit_cards_before_write'),
  ('is_current_user_parent'),
  -- [2026-09-20追加] is_family_social_interactions_enabled（保護者トグル
  -- 「家族のやりとりを使う」の現在値を引く共通ヘルパー、設計部/成果物/
  -- スキーマ設計.sql 67.4章）。SECURITY DEFINER・STABLEだが、下の4本の
  -- トリガー関数（authenticatedロールで実行される）から呼ぶため明示的に
  -- authenticatedへGRANTしている（34.3章の教訓）。
  ('is_family_social_interactions_enabled'),
  -- [2026-09-17追加・pre-existing gap修正] is_valid_avatar_line_data
  -- （member_avatars、20260924010000_member_avatars.sql）。is_valid_drawing_
  -- line_data等と同じくLANGUAGE SQL・SECURITY DEFINERではないため、新規関数
  -- 作成時にauthenticatedへEXECUTE権限が自動付与される。本ファイルへの反映
  -- 漏れをローカルDockerでの実測時に発見し、あわせて追加した（開発部/成果物/
  -- 実装メモ.md 237章）。
  ('is_valid_avatar_line_data'),
  ('is_valid_drawing_line_data'),('join_family_with_invite_code'),('jst_week_start_date'),
  -- [2026-09-01追加] max_nfc_tags_per_chore_member（NFCタグの人ごと化、設計部/成果物/
  -- スキーマ設計.sql 39.3章、開発部/成果物/実装メモ.md 108章）。SECURITY DEFINERでは
  -- ないLANGUAGE SQL関数のため、他の同種ヘルパー関数（max_unpublished_drawings_
  -- per_member等）と同じくauthenticatedへEXECUTE権限が自動付与される。
  ('max_nfc_tags_per_chore_member'),
  ('max_unpublished_drawings_per_member'),('my_family_board_posts_remaining_today'),
  ('my_gratitude_giveable_balance'),
  -- [2026-09-07追加] 木を飾るステッカー購入とバッジの4本のAFTER INSERTトリガー関数
  -- （設計部/成果物/スキーマ設計.sql 47.6章、開発部/成果物/実装メモ.md 138章）。
  -- **設計部47.8章は「RETURNS TRIGGERのためS4に影響しない」としていたが、これは
  -- 誤りだった（実測で判明。本ファイル冒頭2026-09-07追加コメント参照）。**
  -- 他の既存トリガー関数（chore_completions_before_insert・chore_reactions_
  -- before_insert・family_board_reactions_before_insert等）と全く同じ理由
  -- （SECURITY DEFINERではないため新規関数作成時にauthenticatedへEXECUTE権限が
  -- 自動付与される、34.5章の既知の挙動）でS4に含まれる。明示的なREVOKEは行っていない。
  -- [2026-09-17追加・pre-existing gap修正] member_avatars_before_write
  -- （member_avatars、20260924010000_member_avatars.sql）。他の非SECURITY
  -- DEFINERトリガー関数と同じ理由でS4に含まれる。本ファイルへの反映漏れを
  -- ローカルDockerでの実測時に発見し、あわせて追加した（開発部/成果物/
  -- 実装メモ.md 237章）。
  ('member_avatars_before_write'),
  ('member_badges_check_chore_completion'),
  ('member_badges_check_family_drawing'),
  ('member_badges_check_gacha_draw'),
  ('member_badges_check_sticker_purchase'),
  -- [2026-09-17追加] move_tree_habit_figure（習慣カードのフィギュアの配置を
  -- その月のうちに動かす、要件定義書07-28章決定21、設計部/成果物/スキーマ設計.sql
  -- 55.9章、開発部/成果物/実装メモ.md 237章）。move_tree_sticker()等と同じく
  -- SECURITY DEFINERであり、PUBLIC/anonから明示的にREVOKEしたうえで
  -- authenticatedへ明示的にGRANTしている。
  ('move_tree_habit_figure'),
  -- [2026-09-08追加] move_tree_sticker（ステッカーの自由配置化、設計部/成果物/
  -- スキーマ設計.sql 49.13章、開発部/成果物/実装メモ.md 142章）。
  -- decorate_tree_with_gacha_prize()等と同じくSECURITY DEFINERであり、
  -- PUBLIC/anonから明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  ('move_tree_sticker'),
  -- [2026-09-01追加] report_chore_completion_by_nfc_tag（NFCタグの人ごと化・代理報告
  -- RPC、設計部/成果物/スキーマ設計.sql 39.6〜39.7章、開発部/成果物/実装メモ.md 108章）。
  -- draw_gacha()等と同じくSECURITY DEFINERであり、39.7章の方針どおりPUBLIC/anonから
  -- 明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  ('report_chore_completion_by_nfc_tag'),
  -- [2026-09-11追加] reset_sticker_tier（メダルの段階リセット、要件定義書
  -- 07-25-1章決定20〜27、設計部/成果物/スキーマ設計.sql 52.4章、開発部/成果物/
  -- 実装メモ.md 200章）。draw_gacha()等と同じくSECURITY DEFINERであり、
  -- PUBLIC/anonから明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  -- purchase_sticker(UUID)はシグネチャ無変更のCREATE OR REPLACEのため、この
  -- 一覧には変化を及ぼさない（増減±0、設計部52.10章の見込みどおり）。
  ('reset_sticker_tier'),
  ('reward_redemptions_before_insert'),('rewards_before_write'),
  ('set_updated_at'),
  -- [2026-09-07追加] purchase_sticker（設計部/成果物/スキーマ設計.sql 47.2章、
  -- 開発部/成果物/実装メモ.md 138章）。draw_gacha()等と同じくSECURITY DEFINERで
  -- あり、PUBLIC/anonから明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  ('purchase_sticker'),
  -- [2026-09-10追加] toggle_chore_reaction_stamp（完了報告へのスタンプ〈絵文字〉
  -- リアクションの取消・切替、開発部/成果物/実装メモ.md 157章）。
  -- cancel_chore_completion()等と同じくSECURITY DEFINERであり、PUBLIC/anonから
  -- 明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  ('toggle_chore_reaction_stamp'),
  -- [2026-09-10再追加] toggle_family_board_reaction_stamp（家族の掲示板への
  -- スタンプ〈絵文字〉リアクションの取消・切替、開発部/成果物/実装メモ.md
  -- 159章）。toggle_chore_reaction_stamp()等と同じくSECURITY DEFINERであり、
  -- PUBLIC/anonから明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  ('toggle_family_board_reaction_stamp'),
  -- [2026-09-09追加] 利用規約への同意取得＋Play Families安全リマインダー
  -- （やること.md 2-22、開発部/成果物/実装メモ.md 181章）の2関数。いずれも
  -- join_family_with_invite_code()等と同じくSECURITY DEFINERであり、
  -- PUBLIC/anonから明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  ('has_agreed_to_current_terms'),
  ('record_terms_consent'),
  -- [2026-09-11追加] set_family_sticker_prices（メダルの値段を家族ごとに
  -- 編集できるようにする、要件定義書07-25-1章決定10〜18、設計部/成果物/
  -- スキーマ設計.sql 53.5章、開発部/成果物/実装メモ.md 201章）。
  -- reset_sticker_tier()等と同じくSECURITY DEFINERであり、PUBLIC/anonから
  -- 明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。
  -- purchase_sticker(UUID)はシグネチャ無変更のCREATE OR REPLACEのため、この
  -- 一覧には変化を及ぼさない（増減±0、設計部53.12章の見込みどおり）。
  ('set_family_sticker_prices'),
  -- [2026-09-20追加] set_family_social_settings（保護者トグル「家族の
  -- やりとりを使う」の書き込み経路、設計部/成果物/スキーマ設計.sql 67.5章）。
  -- reset_sticker_tier()等と同じくSECURITY DEFINERであり、PUBLIC/anonから
  -- 明示的にREVOKEしたうえでauthenticatedへ明示的にGRANTしている。保護者
  -- のみ呼べる（関数内チェック。みまもり・子どもはinsufficient_privilege）。
  ('set_family_social_settings'),
  -- [2026-09-20追加] submit_content_report（アプリ内の報告／お問い合わせの
  -- 書き込み経路、設計部/成果物/スキーマ設計.sql 65.4章）。draw_gacha()等と
  -- 同じくSECURITY DEFINERであり、PUBLIC/anonから明示的にREVOKEしたうえで
  -- authenticatedへ明示的にGRANTしている。保護者とみまもりメンバーのみ
  -- 呼べる（子どものセッションからはinsufficient_privilege）。
  ('submit_content_report'),
  -- [2026-09-21追加] content_reports_after_insert_notify（報告の通知メール
  -- を送るEdge Functionを呼び出すAFTER INSERTトリガー関数、設計部/成果物/
  -- スキーマ設計.sql 65.5章、開発部/成果物/実装メモ.md 271章）。
  -- SECURITY DEFINERだがRETURNS TRIGGERであり、chore_reactions_social_
  -- toggle_guard等の既存トリガー関数と同じ理由（34.5章の既知の挙動）で
  -- 明示REVOKEしていないため、この一覧に含まれる。トリガー文脈の外で
  -- 直接呼び出すとNEW参照でエラーになるだけで実害は無い。
  ('content_reports_after_insert_notify'),
  -- [2026-09-21追加] account_deletion_preview（要件定義書07-33章 決定4・5・
  -- 10・17、設計部/成果物/スキーマ設計.sql 68.7章、開発部/成果物/実装メモ.md
  -- 273章）。「アカウントを削除する」「家族から抜ける」の確認画面に何を
  -- 出すかを1本で返す。SECURITY DEFINERであり、PUBLIC/anonから明示的に
  -- REVOKEしたうえでauthenticatedへ明示的にGRANTしている。子どものセッション
  -- からも呼べてしまうが、子どもの画面には削除の導線を1つも置かない
  -- （決定7）ため到達しない。transfer_family_ownership()は
  -- service_roleにのみGRANTしており、authenticatedからは呼べないため
  -- この一覧には含めない（PostgREST越しに呼ぶ経路が無いことを別途確認済み）。
  ('account_deletion_preview'),
  -- [2026-09-21追加] member_goals_before_write（自分で目標を決める、要件定義書
  -- 07-36章、設計部/成果物/スキーマ設計.sql 71.3章）。RETURNS TRIGGERの
  -- トリガー関数で、PUBLICからのEXECUTEを明示REVOKEしていないため（他の
  -- トリガー関数と同じ34.5章の既知の挙動）、デフォルトのままauthenticatedが
  -- 実行可能と判定されこの一覧に含まれる。トリガー文脈の外で直接呼び出すと
  -- TG_OP参照等でエラーになるだけで実害は無い。**設計部/成果物/スキーマ
  -- 設計.sql 71.7章は「トリガー関数はデフォルトのままでよい（S4に数えない）」
  -- としていたが、実測するとhabit_cards_before_write・chore_nfc_tags_
  -- before_write等の既存トリガー関数と同様にS4へ含まれることが判明した
  -- （本部長に報告済み）。
  ('member_goals_before_write'),
  -- [2026-09-21追加] set_member_goal（同上、71.5章）。SECURITY DEFINERで
  -- あり、PUBLIC/anonから明示的にREVOKEしたうえでauthenticatedへ明示的に
  -- GRANTしている（新規登録の唯一の書き込み経路、71.4章）。
  ('set_member_goal'),
  -- [2026-09-22追加] プッシュ通知（要件定義書07-37章、設計部/成果物/
  -- スキーマ設計.sql 74章、開発部/成果物/実装メモ.md）。
  -- family_board_posts_after_insert_notify（掲示板の投稿通知トリガー）。
  -- SECURITY DEFINERだがRETURNS TRIGGERであり、content_reports_after_
  -- insert_notify・member_goals_before_write等の既存トリガー関数と同じ
  -- 理由（34.5章の既知の挙動）で明示REVOKEしていないため、この一覧に
  -- 含まれる。トリガー文脈の外で直接呼び出すとNEW参照でエラーになるだけで
  -- 実害は無い。**設計部/成果物/スキーマ設計.sql 74.11章は「トリガー関数の
  -- ため対象外」としていたが、実測するとcontent_reports_after_insert_
  -- notify等と同様にS4へ含まれることが判明した（member_goals_before_write
  -- のときと同じ食い違いパターン。開発部の実装メモに記載・本部長へ報告）。
  ('family_board_posts_after_insert_notify'),
  -- [2026-09-22追加] set_family_push_notifications_enabled（保護者が
  -- 掲示板の通知トグルを設定する、スキーマ設計.sql 74.5章）。SECURITY
  -- DEFINERであり、PUBLIC/anonから明示的にREVOKEしたうえでauthenticated
  -- へ明示的にGRANTしている（設計部の見込みどおり）。
  ('set_family_push_notifications_enabled'),
  -- [2026-09-23追加] 「メッセージ」（社内呼称: 定時アナウンス、要件定義書
  -- 07-37章4章、開発部/成果物/実装メモ.md 292章）。set_family_scheduled_
  -- announcement（保護者が枠を保存、SECURITY DEFINER）・
  -- delete_family_scheduled_announcement（保護者が枠を消す、★スキーマ設計.sql
  -- 75章には無い本タスク追加のRPC、SECURITY DEFINER）・
  -- current_family_push_permission_needed（ソフトアスク表示条件、SECURITY
  -- INVOKER）の3本。いずれもPUBLIC/anonから明示的にREVOKEしたうえで
  -- authenticatedへ明示的にGRANTしている。family_scheduled_announcement_
  -- notification_payload・dispatch_due_family_scheduled_announcementsは
  -- いずれもPUBLIC/anon/authenticatedからREVOKEしているため、この一覧には
  -- 含まれない（ローカルDockerで実測して確認）。
  ('set_family_scheduled_announcement'),
  ('delete_family_scheduled_announcement'),
  ('current_family_push_permission_needed'),
  -- [2026-09-23追加・やること.md 2-69・2-70・5-13、実装メモ.md 293章]
  -- 掲示板のコメント・完了報告へのコメント削除・お絵かきの公開通知／
  -- リアクション／コメント（設計部/成果物/スキーマ設計.sql 76章）。
  -- SECURITY DEFINERでPUBLIC/anonから明示REVOKEのうえauthenticatedへ
  -- 明示GRANTしている2本。
  ('delete_family_comment'),
  ('toggle_family_drawing_reaction_stamp'),
  -- 以下9本はいずれもRETURNS TRIGGERのトリガー関数で、PUBLICからの
  -- EXECUTEを明示REVOKEしていないため（member_goals_before_write等の
  -- 既存トリガー関数と同じ34.5章の既知の挙動）、デフォルトのまま
  -- authenticatedが実行可能と判定されこの一覧に含まれる。トリガー文脈の
  -- 外で直接呼び出すとNEW参照でエラーになるだけで実害は無い。
  -- comment_notification_payload・drawing_published_notification_
  -- payloadの2本（いずれもRETURNS jsonbの通常のSECURITY DEFINER関数）は
  -- PUBLIC/anon/authenticatedすべてから明示REVOKEしているため、この
  -- 一覧には含まれない（ローカルDockerで実測して確認）。
  ('family_board_comments_before_insert'),
  ('family_drawing_comments_before_insert'),
  ('family_drawing_reactions_before_insert'),
  ('family_board_comments_social_toggle_guard'),
  ('family_drawing_comments_social_toggle_guard'),
  ('family_board_comments_after_insert_notify'),
  ('chore_reactions_after_insert_notify'),
  ('family_drawing_comments_after_insert_notify'),
  ('family_drawings_after_publish_notify')
),
actual_f AS (
  SELECT DISTINCT p.proname f FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
),
fdiff AS (
  SELECT coalesce(e.f, a.f) || CASE WHEN e.f IS NULL THEN '（権限が増えている）'
                                    ELSE '（権限が消えている）' END AS msg
  FROM expected e FULL OUTER JOIN actual_f a ON a.f = e.f
  WHERE e.f IS NULL OR a.f IS NULL
)
INSERT INTO _r
SELECT 'C層', 'S4 authenticatedが実行できる関数99件が承認済みと一致',
       'ずれ0件',
       coalesce((SELECT string_agg(msg, ' / ') FROM fdiff), 'ずれ0件'),
       NOT EXISTS (SELECT 1 FROM fdiff);

-- S5. publicの全テーブルに、authenticatedのSELECT権限が付いているか。
--     [2026-09-25追加・開発部/成果物/実装メモ.md 295章、やること.md 4-78]
--     Supabaseからの通知メール（2026-09-24受信）: 2026年10月30日から、public
--     スキーマに新しく作る表は、明示的なGRANT文が無いとData API
--     （supabase-js・PostgREST・GraphQL）から権限エラーになる（`supabase db
--     reset`・プレビューブランチ・新規プロジェクトも対象）。既存の本番の表は
--     対象外だが、10月30日以降にこの書き方のまま新しい表を作るマイグレーション
--     を書くと、GRANTの付け忘れに気づけないまま本番に反映してしまう危険がある。
--     S1（RLS有効テーブル数）・S3（ポリシー本数）は「新しいテーブルを作った
--     こと」自体は検出するが、「そのテーブルにGRANTを書き忘れたこと」は検出
--     しない。本チェックはその穴を埋める——10月30日以降、ローカルで
--     `supabase db reset` した結果を本チェックにかければ、GRANTの付け忘れを
--     機械的に見つけられる（開発部/成果物/CLAUDE.mdの「新しい表を作るときの
--     決まり文句」を書き忘れた場合の網）。
--     SELECTのみを見る理由: 4-78章の決まり文句はauthenticatedにSELECT/
--     INSERT/UPDATE/DELETEの4権限をまとめて書く1行のGRANT文であり、書き忘れ
--     れば4権限とも同時に無くなる（1権限だけ抜けることは通常ない）。よって
--     代表してSELECTの有無だけを見れば十分に検出できる。
WITH missing AS (
  SELECT schemaname || '.' || tablename AS t
  FROM pg_tables
  WHERE schemaname = 'public'
    AND NOT has_table_privilege('authenticated', (schemaname || '.' || tablename)::regclass, 'SELECT')
)
INSERT INTO _r
SELECT 'C層', 'S5 publicの全テーブルにauthenticatedのSELECTがある',
       '不足0件',
       coalesce((SELECT string_agg(t, ' / ') FROM missing), '不足0件'),
       NOT EXISTS (SELECT 1 FROM missing);


-- ============================================================
-- B層: 家族内のロール境界（実際になりすまして読む）
--
-- 対象者はIDを直書きせず、実行時にロールで選ぶ。メンバーが入れ替わっても
-- テストが陳腐化しないようにするため。
--
-- [2026-09-01改訂・開発部・実装メモ.md 105章] メンバーが1人もいない環境
-- （ローカルの空DB等）でのガード追加。
-- 従来は `SELECT set_config('t.child', (SELECT id::text FROM family_members
-- WHERE role='child' ...), true)` を無条件に実行しており、対象ロールの
-- メンバーが0人だと内側のSELECTがNULLを返し、`set_config('t.child', NULL,
-- true)` の結果 `current_setting('t.child')` が**空文字列 ''**になる
-- （NULLにはならない。実機で確認済み）。この空文字列がその後
-- `json_build_object('family_member_id', '')` 経由で
-- `current_family_member_id()` 内の `v_member_id_claim::uuid` キャストに渡り
-- `invalid input syntax for type uuid: ""` でクラッシュしていた。
-- 対策: `set_config` 自体を `WHERE EXISTS (...)` で対象ロールが実在する
-- ときだけ実行するよう改める。存在しない場合は `t.child` 等のGUCが
-- 一度も設定されず、`current_setting(..., true)` は（空文字列ではなく）
-- 正真正銘の SQL NULL を返すため、`json_build_object` はJSONの null を
-- 生成し、`current_family_member_id()` はクラッシュせずNULLを返す
-- （キャストするNULLは常に安全。危険なのは空文字列のキャストだけ）。
-- その上で、各チェックの期待値・実際の判定ロジック自体
-- （「他人の未公開の絵が見えない」等）は一切変更せず、対象ロールが
-- 存在しない場合にのみ結果を『SKIP』表示に切り替える分岐を追加した。
-- ============================================================

SELECT set_config('t.child', (SELECT id::text FROM family_members WHERE role = 'child' AND is_active ORDER BY created_at LIMIT 1), true)
  WHERE EXISTS (SELECT 1 FROM family_members WHERE role = 'child' AND is_active);
SELECT set_config('t.parent', (SELECT id::text FROM family_members WHERE role = 'parent' AND is_active ORDER BY created_at LIMIT 1), true)
  WHERE EXISTS (SELECT 1 FROM family_members WHERE role = 'parent' AND is_active);
SELECT set_config('t.supporter', (SELECT id::text FROM family_members WHERE role = 'supporter' AND is_active ORDER BY created_at LIMIT 1), true)
  WHERE EXISTS (SELECT 1 FROM family_members WHERE role = 'supporter' AND is_active);

-- [A層のガード用] 家族が2つ以上あるかを、まだ`SET LOCAL ROLE authenticated`に
-- 切り替える前（＝管理者権限のこの時点）で1回だけ判定し、GUCへ結果を
-- キャッシュしておく。**ここを`SET LOCAL ROLE authenticated`後に
-- `(SELECT count(*) FROM families)`という形で毎回問い合わせる実装にすると、
-- families テーブルのSELECTポリシー（families_select_own、
-- `id = current_family_id()`）がなりすまし中の本人にも適用され、
-- 常に「自分の家族1件」しか数えられず、ローカルでも家族が2つ以上あるのに
-- 誤ってfalse（＝A層が常にSKIP）になってしまう（実際にこの実装ミスを
-- ローカルで踏んでから気づき、修正した。開発部/成果物/実装メモ.md 105章）。
SELECT set_config('t.multi_family', ((SELECT count(*) FROM families) >= 2)::text, true);


-- ---------- 子どもの視点 ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', current_setting('t.child', true))::text, true);

-- B1. 他人の未公開のお絵かきが見えないこと。
--     このアプリで最も機微な秘匿。「ガチャで当たるまで本人以外に見えない」が
--     壊れると、子どもにとっての意味そのものが失われる。しかも無症状。
INSERT INTO _r SELECT 'B層', 'B1 子ども: 他人の未公開の絵が見えない', '0',
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにchildロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE NOT is_published AND artist_member_id <> current_family_member_id();

-- B2. PINハッシュが読めないこと。
INSERT INTO _r SELECT 'B層', 'B2 子ども: PINテーブルが読めない', '0',
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにchildロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_member_pins;

-- B3. 逆に厳しすぎないことの確認。家族のメンバーは見えなければ画面が壊れる。
INSERT INTO _r SELECT 'B層', 'B3 子ども: 家族のメンバーは見える（過剰遮断でない）', '1件以上',
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにchildロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*) > 0 ELSE NULL END
FROM family_members;

-- B4. 完了報告が見えること（同上）。
INSERT INTO _r SELECT 'B層', 'B4 子ども: 家族の完了報告は見える（過剰遮断でない）', '1件以上',
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにchildロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL THEN count(*) > 0 ELSE NULL END
FROM chore_completions;

-- ------------------------------------------------------------
-- A層（子どもロール分）: family_drawings / chore_completions / family_members は
-- 「特に重要なテーブル」として3ロールすべてで検査する（絞り方の理由は
-- 保護者の視点ブロック冒頭のA層コメントを参照。ここでは子ども分のみ追加）。
-- ------------------------------------------------------------
INSERT INTO _r SELECT 'A層', 'A-child family_drawings: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A-child chore_completions: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM chore_completions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A-child family_members: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.child', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM family_members WHERE family_id <> current_family_id();

RESET ROLE;


-- ---------- 保護者の視点 ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', current_setting('t.parent', true))::text, true);

-- B5. 保護者であっても、他人の未公開の絵は見えてはいけない。
--     「保護者だから何でも見える」は、この機能に限っては誤り。
INSERT INTO _r SELECT 'B層', 'B5 保護者: 他人の未公開の絵が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにparentロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE NOT is_published AND artist_member_id <> current_family_member_id();

-- B6. 保護者でもPINハッシュは読めない（PIN再設定はEdge Function経由のみ）。
INSERT INTO _r SELECT 'B層', 'B6 保護者: PINテーブルが読めない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにparentロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_member_pins;

-- B7. 保護者としての役割判定が正しく効いていること。
INSERT INTO _r SELECT 'B層', 'B7 保護者: 保護者として判定される', 'true',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN is_current_user_parent()::text ELSE 'SKIP（ローカルにparentロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL THEN is_current_user_parent() ELSE NULL END;

-- ============================================================
-- A層（保護者ロール分・代表ロール）: 家族間の分離
--
-- [2026-09-01新設・開発部・実装メモ.md 105章]
-- 検査内容: 家族Aのメンバーとしてなりすました状態で、家族Bのデータが
-- 1件も見えないこと。対象IDは直書きせず、「自分の家族以外
-- （family_id <> current_family_id()）のデータが0件であること」という
-- 形で実行時に判定する（B層と同じ「実在するデータを実行時に選ぶ」方針を
-- 踏襲。テスト家族2件は `supabase/seed.sql` がローカルのみに投入する）。
--
-- [絞り方とその理由]
--   [2026-09-07更新・開発部・実装メモ138章] この節の「◯テーブル」という数字は
--   新規テーブル追加のたびにずれる（GLOSSARY.mdの方針と同じ考え方）。2026-09-07
--   時点でRLSが有効な27テーブルのうち、gacha_preset_ornaments・sticker_catalog
--   （いずれも全家族共通のグローバルカタログ。family_id列を持たず、両家族が
--   同じ行を見えるのが正しい設計のため「他家族のデータが見えない」という
--   検査自体が意味を持たない）を除いた25テーブルを対象にする（A01〜A25）。
--   25テーブル全部を3ロール（保護者・こども・みまもり）でそれぞれ検査すると
--   件数が肥大化するため、以下のように絞った。
--     - 代表ロール（保護者）1つで対象テーブルすべてを検査する
--       （このブロック）。RLSポリシーの条件式自体はロールに関わらず
--       同じ形（family_id = current_family_id()）で書かれているものが
--       大半であり、代表1ロールでの検査でも「family_idによる分離が
--       構造的に効いているか」は十分に確認できる。
--     - 「特に重要な3テーブル」（family_drawings=秘匿性が最も高い、
--       chore_completions=ポイントの原資となる会計データ、
--       family_members=氏名等の個人識別情報）だけは、こども・みまもりの
--       2ロールでも重ねて検査する（子どもの視点ブロック・みまもりの視点
--       ブロックにそれぞれ追加）。理由: この3テーブルは、role別に条件式が
--       枝分かれしているポリシーが実際に存在する
--       （family_members_update_scoped等）ため、ロールによって挙動が
--       異なる可能性を排除しきれない。
--   （件数の内訳は代表ロール分＋「特に重要な3テーブル」×2ロール＋過剰遮断で
--   ないことの確認1件。追加のたびにずれるため、正確な合計は本ファイルの
--   A層の行数を直接数えること。2026-09-07時点ではA01〜A25＋A-supporter/A-child
--   の重ね分＋A-guard）
--
-- [「過剰に厳しくない」側の確認（96.3(3)の方針）]
--   家族Aの保護者から、家族A自身のfamily_membersが見えることを確認する
--   （A-guard-not-too-strict）。「他家族が見えない」だけを検査すると、
--   仮にRLSが誤って自分の家族まで含めて全部隠す設定になっていても
--   0件のままPASSしてしまい、検査として無意味になる（B3・B4と同じ発想）。
--
-- [ローカル/本番の分岐方法]
--   `current_setting('t.multi_family', true) = 'true'` を都度の副問い合わせで判定する。
--   本番は家族が1つしかないため常にfalseとなり、A層はすべてSKIP表示になる
--   （FAILではない）。ローカルは `supabase/seed.sql` が2家族を投入するため
--   trueになり、実際にチェックが走る。対象ロールのメンバー自体が
--   存在しない場合（`current_setting('t.parent', true) IS NOT NULL` 等）も
--   あわせてガードしている（B層と同じ理由）。
-- ============================================================

-- A-guard-not-too-strict. 家族Aの保護者から、自分の家族のメンバーは見える
-- （他家族を隠すあまり自分の家族まで消えていないかの確認、96.3(3)の方針）。
INSERT INTO _r SELECT 'A層', 'A-guard 保護者: 自分の家族のfamily_membersは見える（過剰遮断でない）', '1件以上',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) > 0 ELSE NULL END
FROM family_members WHERE family_id = current_family_id();

-- 以下21件、代表ロール（保護者）で「他家族の行が0件であること」を検査する。
-- families のみ主キー列が `id`（他は `family_id`）であることに注意。
-- family_member_pins / push_tokens は family_id 列を持たないため、
-- family_members への JOIN 経由で他家族のメンバーの行かどうかを判定する。
INSERT INTO _r SELECT 'A層', 'A01 保護者: categoriesに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM categories WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A02 保護者: chore_completionsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM chore_completions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A03 保護者: chore_daily_flagsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM chore_daily_flags WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A04 保護者: chore_reactionsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM chore_reactions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A05 保護者: choresに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM chores WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A06 保護者: familiesに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM families WHERE id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A07 保護者: family_board_postsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_board_posts WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A08 保護者: family_board_reactionsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_board_reactions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A09 保護者: family_drawingsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A10 保護者: family_invitesに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_invites WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A11 保護者: family_member_pinsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_member_pins fmp JOIN family_members fm ON fm.id = fmp.member_id WHERE fm.family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A12 保護者: family_membersに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_members WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A13 保護者: family_tree_decorationsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_tree_decorations WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A14 保護者: family_tree_seasonsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_tree_seasons WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A15 保護者: gacha_drawsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM gacha_draws WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A16 保護者: gacha_member_progressに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM gacha_member_progress WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A17 保護者: gratitude_pointsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM gratitude_points WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A18 保護者: push_tokensに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM push_tokens pt JOIN family_members fm ON fm.id = pt.member_id WHERE fm.family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A19 保護者: reward_redemptionsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM reward_redemptions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A20 保護者: rewardsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM rewards WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A21 保護者: weekly_family_digestsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM weekly_family_digests WHERE family_id <> current_family_id();

-- [2026-09-01追加] A22 chore_nfc_tags（NFCタグの人ごと化、開発部/成果物/実装メモ.md
-- 108章）。家族間で分離されるべき新規テーブルのため、既存のA01〜A21と同じ形で追加する。
INSERT INTO _r SELECT 'A層', 'A22 保護者: chore_nfc_tagsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM chore_nfc_tags WHERE family_id <> current_family_id();

-- [2026-09-02追加] A23 join_consents（招待受諾フローにおける可視範囲の説明と
-- 同意取得、設計部/成果物/スキーマ設計.sql 40.10章・開発部/成果物/実装メモ.md
-- 111章）。家族間で分離されるべき新規テーブルのため、既存のA01〜A22と同じ形で
-- 追加する。子ども・みまもりロール分の代表チェック（family_drawings/
-- chore_completions/family_membersの3テーブル）への追加は不要（40.10章の判断。
-- 子どもはjoin_family_with_invite_code/accept_family_inviteのいずれも呼び出せ
-- ないため本テーブルへのアクセスパターンを検査する意味が無く、みまもりの
-- 「自分の行しか見えない」懸念はjoin_consents_select_ownの存在だけで自明に
-- 満たされ、他家族分離の懸念とは性質が異なるため）。
INSERT INTO _r SELECT 'A層', 'A23 保護者: join_consentsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM join_consents WHERE family_id <> current_family_id();

-- [2026-09-07追加] A24・A25 木を飾るステッカー購入とバッジ（設計部/成果物/
-- スキーマ設計.sql 47章、開発部/成果物/実装メモ.md 138章）。ornament_sticker_
-- purchases・member_badgesはいずれもfamily_idを持つ家族間分離対象の新規テーブル
-- のため、既存のA01〜A23と同じ形で追加する。sticker_catalogはgacha_preset_
-- ornamentsと同じ全家族共通グローバルカタログ（family_id列を持たない）のため、
-- 「他家族のデータが見えない」という検査自体が意味を持たず対象外とする
-- （47.9章決定47-1、13章「絞り方とその理由」と同じ考え方）。
INSERT INTO _r SELECT 'A層', 'A24 保護者: ornament_sticker_purchasesに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM ornament_sticker_purchases WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A25 保護者: member_badgesに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM member_badges WHERE family_id <> current_family_id();

-- [2026-09-09追加] A26 terms_consents（利用規約への同意取得＋Play Families
-- 安全リマインダー、やること.md 2-22、開発部/成果物/実装メモ.md 181章）。
-- 家族間で分離されるべき新規テーブルのため、既存のA01〜A25と同じ形で追加する。
-- join_consents（A23）と異なり子ども・みまもりも書き込み経路
-- （record_terms_consent()）を持つが、terms_consents_select_by_parentの
-- 条件式は「保護者からfamily_idで絞る」点でjoin_consentsと同一のため、
-- A23と同じ「保護者ロール代表1本」の検査で十分（保護者以外の視点からの
-- 追加検査が要らない理由もA23と同じ: みまもり・子どもの「自分の行しか
-- 見えない」懸念はterms_consents_select_ownの存在だけで自明に満たされ、
-- 他家族分離の懸念とは性質が異なる）。
INSERT INTO _r SELECT 'A層', 'A26 保護者: terms_consentsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM terms_consents WHERE family_id <> current_family_id();

-- [2026-09-11追加] A27 sticker_tier_resets（メダルの段階リセット、要件定義書
-- 07-25-1章決定20〜27、設計部/成果物/スキーマ設計.sql 52.10章推奨、開発部/
-- 成果物/実装メモ.md 200章）。family_idを持つ家族間分離対象の新規テーブルの
-- ため、既存のA01〜A26と同じ形で追加する。
INSERT INTO _r SELECT 'A層', 'A27 保護者: sticker_tier_resetsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM sticker_tier_resets WHERE family_id <> current_family_id();

-- [2026-09-11追加] A28 family_sticker_prices（メダルの値段を家族ごとに編集
-- できるようにする、要件定義書07-25-1章決定10〜18、設計部/成果物/スキーマ
-- 設計.sql 53.12章推奨、開発部/成果物/実装メモ.md 201章）。family_idを持つ
-- 家族間分離対象の新規テーブルのため、既存のA01〜A27と同じ形で追加する。
-- [重要] sticker_catalog_effective_prices（新設View）自体はfamily_id列を
-- 持たないためこの機械的な検査の対象にできない。Viewのsecurity_invoker=true
-- が正しく他家族の上書き価格を漏らさないことは、実装メモ.md 201章の
-- BEGIN...ROLLBACKによる手動検証で別途確認済み（本番運用ではA28がこの
-- テーブル自体の家族間分離を検査し、Viewの計算ロジックは設計・実装レビュー
-- と手動検証で担保する2段構え）。
INSERT INTO _r SELECT 'A層', 'A28 保護者: family_sticker_pricesに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM family_sticker_prices WHERE family_id <> current_family_id();

-- [2026-09-17追加] A29・A30 習慣カード（台紙）とフィギュア（要件定義書07-28章、
-- 設計部/成果物/スキーマ設計.sql 55章、開発部/成果物/実装メモ.md 237章）。
-- habit_cards・habit_figure_grantsはいずれもfamily_idを持つ家族間分離対象の
-- 新規テーブルのため、既存のA01〜A28と同じ形で追加する。habit_figure_catalogは
-- sticker_catalog・gacha_preset_ornamentsと同じ全家族共通グローバルカタログ
-- （family_id列を持たない）のため対象外とする。
INSERT INTO _r SELECT 'A層', 'A29 保護者: habit_cardsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM habit_cards WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A30 保護者: habit_figure_grantsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM habit_figure_grants WHERE family_id <> current_family_id();

-- [2026-09-17追加・pre-existing gap修正] A31 member_avatars
-- （20260924010000_member_avatars.sql、07-28章とは無関係の別タスクの成果物）。
-- family_idを持つ家族間分離対象の新規テーブルだが、A層への反映が漏れていたことを
-- ローカルDockerでの実測時に発見し、あわせて追加した（開発部/成果物/実装メモ.md
-- 237章）。
INSERT INTO _r SELECT 'A層', 'A31 保護者: member_avatarsに他家族の行が見えない', '0',
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.parent', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true' THEN count(*) = 0 ELSE NULL END
FROM member_avatars WHERE family_id <> current_family_id();

-- [注記] 「特に重要な3テーブル」（family_drawings/chore_completions/
-- family_members）の保護者ロール分は、上のA09・A02・A12がそのまま該当する
-- （代表ロールが保護者のため）。二重に記録すると同じ検査が名前だけ変えて
-- 増えるだけなので、ここでは追加しない。

RESET ROLE;


-- ---------- みまもりメンバーの視点 ----------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('family_member_id', current_setting('t.supporter', true))::text, true);

-- B8. みまもりも他人の未公開の絵は見えない。
INSERT INTO _r SELECT 'B層', 'B8 みまもり: 他人の未公開の絵が見えない', '0',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにsupporterロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE NOT is_published AND artist_member_id <> current_family_member_id();

-- B9. みまもりはPINハッシュを読めない。
INSERT INTO _r SELECT 'B層', 'B9 みまもり: PINテーブルが読めない', '0',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN count(*)::text ELSE 'SKIP（ローカルにsupporterロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN count(*) = 0 ELSE NULL END
FROM family_member_pins;

-- B10. みまもりは保護者ではない。ここがtrueになると、家族用クエスト・ごほうびの
--      編集権限（rewards_write_family_by_parent 等）が丸ごと開いてしまう。
INSERT INTO _r SELECT 'B層', 'B10 みまもり: 保護者として判定されない', 'false',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN is_current_user_parent()::text ELSE 'SKIP（ローカルにsupporterロールのメンバーが存在しない）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL THEN NOT is_current_user_parent() ELSE NULL END;

-- ------------------------------------------------------------
-- A層（みまもりロール分）: 「特に重要な3テーブル」を重ねて検査する
-- （絞り方の理由は保護者の視点ブロック冒頭のA層コメントを参照）。
-- ------------------------------------------------------------
INSERT INTO _r SELECT 'A層', 'A-supporter family_drawings: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM family_drawings WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A-supporter chore_completions: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM chore_completions WHERE family_id <> current_family_id();

INSERT INTO _r SELECT 'A層', 'A-supporter family_members: 他家族の行が見えない', '0',
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*)::text ELSE 'SKIP（家族が1つのみ。本番はこのSKIPが正常）' END,
  CASE WHEN current_setting('t.supporter', true) IS NOT NULL AND current_setting('t.multi_family', true) = 'true'
       THEN count(*) = 0 ELSE NULL END
FROM family_members WHERE family_id <> current_family_id();

RESET ROLE;


-- ============================================================
-- 結果
-- ============================================================
SELECT layer, name, expected, actual,
  CASE WHEN ok IS NULL THEN 'SKIP' WHEN ok THEN 'PASS' ELSE '*** FAIL ***' END AS result
FROM _r ORDER BY layer, name;

ROLLBACK;
