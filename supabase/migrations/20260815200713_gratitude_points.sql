-- 12. 07-4. 親の完了報告（対等な参加）— スキーマ変更要否の確認メモ
-- ============================================================
-- [2026-08-15追加] 要件定義書.md v0.6 07-4章・05章「設計判断（親の完了報告対応）」
-- （本部長採点100点）を受けた確認結果。企画部の申し送りどおり、本機能は
-- 既存スキーマへの構造変更を必要としないことを設計部として確認した。
-- 以下、確認した内容と根拠を明記する（設計部CLAUDE.mdの「変更理由と影響範囲の明記」
-- は「変更しない」という判断についても適用されると考え、確認プロセスを残す）。
--
-- [確認1: chores.assigned_to / chore_completions.reported_by]
-- 4章 chores.assigned_to は既にNULL許容（NULL=誰でも実行可）であり、値を持つ場合も
-- family_members全般（roleを問わない）を参照するFKである。5章 chore_completions.reported_by
-- も同様にfamily_members全般を参照する。したがって保護者自身が担当する家事を
-- choreとして登録し、保護者自身がchore_completionsへ完了報告することは、
-- 追加の列・テーブルなしで既存の構造がそのまま受け入れる。変更なし。
--
-- [確認2: chore_completions_insert_self RLSポリシー（5章）]
-- `WITH CHECK (family_id = current_family_id() AND reported_by = current_family_member_id())`
-- という条件はreported_byが「自分自身のfamily_member_id」であることのみを見ており、
-- その主体の role（parent/child）を一切問わない。したがって保護者が自分の完了報告を
-- INSERTする操作は、本ポリシーの変更なしにそのまま許可される。変更なし。
--
-- [確認3: chore_completions_before_insertトリガー（5a章）の実行回数上限チェック]
-- daily_limitチェックは (chore_id, reported_by, 当日日付) の組み合わせでカウントする
-- 設計であり、reported_byの役割を分岐条件に一切使っていない。保護者が担当する
-- 繰り返し家事にdaily_limitを設定した場合も、子どもの場合と全く同じロジックで
-- 正しく機能する。変更なし。
--
-- [確認4: chore_reactions_insert_by_parent RLSポリシー（5b章）]
-- 07-4章4「保護者同士が互いの完了報告にスタンプ／コメントでリアクションを送り合う
-- ことは可能とする」という要件について、既存の条件
-- `is_current_user_parent() AND reacted_by = current_family_member_id()` は
-- 「リアクションする側が保護者であること」だけを問い、「リアクションされる対象
-- （completion.reported_by）が子どもか保護者か」を一切区別していない。そのため
-- 保護者Aの完了報告に対して保護者Bがリアクションする操作は、本ポリシーの変更なしに
-- 既に許可されている。変更なし。
--   [検討したが採用しなかった追加制約] 「保護者は“自分自身”の完了報告には
--   リアクションできない」という自己リアクション禁止を追加することも検討したが、
--   要件定義書07章・07-4章のいずれにもそのような制約の記載は無く、企画部の要件に
--   無い独自の制限を設計部の判断で追加すべきではないため見送った（設計部CLAUDE.md
--   「企画部の要件定義にない独自の仕様変更をしないこと」）。将来この挙動の是非が
--   論点になった場合は、chore_reactions_insert_by_parentのWITH CHECKに
--   `reacted_by <> (SELECT reported_by FROM chore_completions WHERE id = completion_id)`
--   を追加するだけで実現でき、影響範囲は本ポリシーのみに限定される。
--
-- [確認5: UIトーンの書き分け（子ども向け＝達成を称える／保護者向け＝淡々とした記録）
--  を実現するための、choresへの区分用新規列の要否 — 設計部の判断]
-- 05章の申し送りは「chore自体に区分用の新規列（対象が『子ども向け』か『大人向け』かを
-- 明示する列）を追加するかどうかは設計部の判断に委ねる」としている。設計部の判断は
-- 「追加しない」。理由は以下のとおり。
--   (a) UIトーンは「そのchore自体が持つ固定的な属性」ではなく「実際に誰が完了報告
--       したか／どの画面（子ども向けサーフェス or 保護者向けサーフェス）で表示するか」
--       という**行為・表示コンテキスト側の属性**である。同じchore（例:
--       assigned_to=NULL の「郵便物を取り込む」）を子どもが実行すれば達成を称える
--       演出、保護者が実行すれば淡々とした記録、という書き分けは、chore単位の固定
--       フラグでは表現できない（1つのchoreに複数の意味を同時に持たせる必要がある）。
--   (b) 既に `chore_completions.reported_by -> family_members.role` という経路で
--       「その完了報告を行ったのが子どもか保護者か」を判定する情報がある。開発部は
--       完了報告一覧・実施履歴カレンダー・じぶんの通帳などの表示時に、
--       `chore_completions.select('*, family_members!reported_by(role)')` のように
--       reported_by先のroleをJOINして取得し、role='child'なら達成演出、role='parent'
--       なら淡々とした表示、という分岐をクライアント側で行えばよい（API仕様.md
--       4章に追記）。
--   (c) 「やることリスト」等、完了報告前の一覧表示についても、UIサーフェス自体が
--       子ども用（app/child配下）と保護者用（app/parent配下）で既に分離されている
--       （認証・データ管理設計書.md1章のとおりログイン主体からして別れている）ため、
--       どちらの画面で一覧を描画しているか自体がトーンを決定でき、chore側に
--       追加の区分列を持たせる必要がない。
--   (d) 区分列を追加すると、assigned_to=NULLの「誰でも実行可」choreに対して
--       「子ども向け」「保護者向け」のどちらのタグを付けるかという新たな二重管理・
--       矛盾（例: assigned_to=NULLかつ区分列='child'のchoreを保護者が実行した場合に
--       どちらのトーンを適用するか）を生む。既存の`assigned_to`単独の設計の方が
--       単純で一貫している。
-- 影響範囲: スキーマ変更なし。API仕様.md 4章に、UIトーン判定はreported_byの
-- family_members.roleをJOINして取得する方式であることを明記する。


-- ============================================================
-- 13. gratitude_points（新規：感謝ポイント）
-- ============================================================
-- [2026-08-15新設] 要件定義書.md v0.6 07-5章「感謝ポイント」・05章「gratitude_points
-- （新規・仮称）」の申し送り事項（本部長採点100点）を受けて新設する。
-- 事前登録タスクの自己申告（chore_completions）でも、事後の無償リアクション
-- （chore_reactions、ポイントは動かない）でもない、「他者が代理でポイント付きの
-- 記録を作成する」第三の記録種別。
--
-- [設計判断: テーブル名]
-- 05章の仮称どおり `gratitude_points` を採用した（他の妥当な候補として
-- `gratitude_grants` 等も検討したが、要件定義書内で既に `gratitude_points` という
-- 名称が繰り返し使われており、開発部・企画部・UIUXデザイン部との会話でも
-- この名称が定着しているため、独自に改名する積極的な理由が無いと判断した）。
--
-- [設計判断: 週次原資（giveable points）の管理方式 — 別テーブル配布/消費ログ方式 vs
--  直近集計View方式]
-- 05章は「別テーブルでの配布・消費ログ管理」「直近7日以内の集計View」のいずれかを
-- 設計部の判断に委ねている。本設計では**後者に近い方式（gratitude_pointsテーブル
-- 自体をSUMするヘルパー関数、13a章）を採用**し、原資の配布記録・消費記録用の
-- 別テーブルは作らない。理由:
--   (a) 07-5章・05章の原資方針は「週次で定額配布・繰越なし・週の切り替わりで失効」
--       であり、これは「毎週固定額をリセットする」性質のものである。実際に
--       「配布」という行為（原資テーブルへの週次INSERT）をバッチ処理等で行う設計は、
--       (i) 定額をコード側の定数として持てば足りるものをわざわざ行として物理化する
--       必要が薄いこと、(ii) 新しい家族メンバーが追加された週や、家族が長期間
--       使わなかった週の「配布漏れ」を防ぐための追加のバッチ運用・監視が必要になる
--       ことから、MVPの複雑性に見合わないと判断した。
--   (b) 「直近7日以内の集計」という表現は本設計ではそのまま採用せず、**JST基準の
--       固定暦週（月曜0時始まり〜翌週月曜0時まで）**で区切ることにした（13a章
--       `jst_week_start_date`）。理由: 05章・07-5章・10章はいずれも「週の切り替わりで
--       失効」「配布サイクル（毎週月曜0時等）」という**固定の週境界でリセットされる**
--       挙動を想定した記述をしており、「常に直近7日をローリングで見る」方式（無限に
--       スライドする窓）とは意味が異なる。ローリング7日窓では「切り替わり」という
--       瞬間が存在せず、原資は常に連続的に回復し続けるため、要件が意図する
--       「週明けにリセットされる」体験と一致しない。固定暦週の方が要件に忠実。
--   (c) 消費側（=誰が今週いくら贈ったか）は `gratitude_points` 自体の
--       `SUM(points) WHERE sender_id = :self AND revoked_at IS NULL AND
--       (created_at AT TIME ZONE 'Asia/Tokyo')::date が当該週内` という集計だけで
--       過不足なく求まる（送った記録＝消費記録そのものであり、別に消費ログを
--       持つ意味が無い）。「原資の残高」は「定数（週次配布額） − 今週の消費集計」
--       という都度計算値で表現でき、状態を持つテーブルが不要になる。
--   これにより、原資管理のための新規テーブルが1つも増えず、gratitude_points本体の
--   1テーブルのみで「贈答ログ」と「原資消費の実績」の両方の役割を兼ねる設計となった。
--
-- [設計判断: 原資チェックの実装（トリガー）]
-- INSERT時にBEFORE INSERTトリガー（13b章）で「今週の消費合計＋今回の贈呈量」が
-- 週次配布額を超えないことをチェックし、超える場合は`check_violation`で拒否する。
-- family-todoのreward_redemptions残高チェック（本ファイル7a章）と同じ「DBトリガーで
-- 拒否する」パターンを踏襲する（要件定義書02章「そのまま継承する設計」）。
--
-- [設計判断: 受領分のmember_points合算／原資消費の別会計化]
-- 受け取った側の合計は14章でmember_points Viewに合算する。贈る側の原資消費は
-- 「gratitude_points.sender_id視点の集計」であり、member_pointsのcurrent_points
-- （＝chore_completions由来の残高±ごほうび消費±感謝ポイント受領）には一切含めない。
-- 贈る行為自体は贈る側の残高を減らさない（05章・07-5章のとおり別会計）。
--
-- [設計判断: ネガティブアクション（取消）の実装方式 — 物理DELETE vs 論理取消(revoked_at)]
-- `revoked_at TIMESTAMPTZ NULL` による論理取消を採用し、物理DELETEポリシーは
-- 一切作らない。理由:
--   (a) chore_completionsが確立した「加算のみ・追記専用ログ」という会計モデルの
--       設計思想（5章）を、性質の近い本テーブルでも踏襲する。物理DELETEを許すと
--       「取消された感謝ポイントが実在した」という記録自体が消え、家族間の
--       行き違い（「贈ったのに届いていない」等）が起きた際に追跡できなくなる。
--   (b) 論理取消であれば、14章のmember_points（受領側の合算）・13a章の週次消費集計
--       （贈る側の原資回復）の両方で `WHERE revoked_at IS NULL` を条件に加えるだけで
--       「取消＝無かったことにする」を一貫して表現できる。
--   (c) 「送信から5分以内のみ」「取消できるのは送信者本人のみ」「一度取消したら
--       元に戻せない」という制約は、UPDATEポリシー単体では表現しきれないため、
--       13c章のBEFORE UPDATEトリガーで多層的に強制する。
--
-- [設計判断: 誤操作取消の猶予時間]
-- 企画部案（07-5章6・05章・10章未決事項）どおり**5分**を採用する。10章は
-- 「具体値は設計部・UIUXデザイン部との検討事項」としており、5分という値自体は
-- 企画部が明示した案をそのまま踏襲した（設計部が独自に変更する積極的な理由が
-- 無いため）。値は13a章の定数関数化はせずトリガー内に直接埋め込むが、将来
-- 変更が必要になった場合は13c章のトリガー関数1箇所の書き換えのみで完結する。
--
-- [設計判断: 公開範囲・ランキング防止]
-- 05章・07-5章の「個々のログは家族内で閲覧可能だが、『合計贈った数／もらった数』の
-- ランキング・順位表示は作らない」という方針を踏まえ、本設計では以下の2点を徹底する。
--   (a) gratitude_pointsのSELECT RLSは「同じ家族なら誰でも個々のログ（1行単位）を
--       読める」という、chore_completionsと同水準の透明性に留める（ログ自体を隠す
--       設計にはしない。05章は「個々のログは家族内で閲覧可能」と明記しているため）。
--   (b) 一方、「メンバー横断で贈った/もらった合計を一望できる集計View」は意図的に
--       作らない（例えば `SELECT sender_id, SUM(points) FROM gratitude_points
--       GROUP BY sender_id` のような集計をあらかじめVIewとして用意すると、開発部が
--       画面実装時にそれをそのまま「週間MVPランキング」的なUIへ転用しやすくなって
--       しまう）。13e章で用意する `my_gratitude_giveable_balance()` はSECURITY
--       DEFINER関数として**呼び出した本人自身の残存原資のみ**を返す設計にし、
--       他メンバーの残存原資・贈った/もらった合計を一括取得できるView/関数は
--       一切用意しない。API仕様.md にも同様の注記を行う。
-- ============================================================

-- [順序上の理由] 週次配布額（giveable points）の定数を返す関数を、本来は13a章に
-- まとめて置きたいところだが、直後のCREATE TABLE内のCHECK制約
-- （chk_gratitude_points_within_allowance）がこの関数を参照するため、テーブル定義
-- より先に定義する必要がある（Postgresは未定義の関数を参照するCHECK制約を作れない）。
-- 家族テーブル本体には依存しない純粋な定数関数のため、この順序で問題は無い。
-- 週次配布額（giveable points）の定数。企画部案どおり週50pt（要件定義書.md v0.6
-- 07-5章・05章・10章）。IMMUTABLE関数として定義することで、CHECK制約からも
-- 参照できる。
-- [設計判断] 家庭ごとのカスタマイズは要件定義書10章のとおりMVP対象外・次フェーズ
-- 検討事項のため、設定用テーブルは作らずコード定数として持つ。将来家庭ごとに
-- 変更可能にする場合は、本関数をfamiliesテーブルの列参照に置き換えるか、
-- 専用の設定テーブルを追加する形になる（影響範囲: 本関数の実装と、本関数に
-- 依存するCHECK制約・13b章トリガーのみ）。
CREATE OR REPLACE FUNCTION public.gratitude_weekly_allowance()
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 50;
$$;

CREATE TABLE IF NOT EXISTS gratitude_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  recipient_id UUID NOT NULL REFERENCES family_members(id) ON DELETE RESTRICT,
  points INT NOT NULL CHECK (points > 0),
  note TEXT NOT NULL CHECK (char_length(trim(note)) BETWEEN 1 AND 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL,

  -- 自己贈呈の禁止（05章・07-5章「自分自身への自己贈呈はできない」）。
  -- CHECK制約はservice_role実行時も含め常に評価されるため、RLSに頼らない
  -- 最も強い防御になる。
  CONSTRAINT chk_gratitude_no_self_gift CHECK (sender_id <> recipient_id),

  -- [防御的二重チェック] 1回の贈呈量は週次配布額を超えられない（13b章の
  -- BEFORE INSERTトリガーが本来の残存原資チェックを行うが、万一トリガーが
  -- 何らかの理由でスキップされた場合でも、単発の贈呈量が定数を超えることは
  -- このCHECK制約により常に防止される）。gratitude_weekly_allowance()は
  -- IMMUTABLEな定数関数のためCHECK制約内で使用可能。
  CONSTRAINT chk_gratitude_points_within_allowance CHECK (points <= public.gratitude_weekly_allowance())
);

-- reported_by（chore_completions）と同様、sender_id/recipient_idともON DELETE RESTRICT。
-- family_membersは通常is_active論理削除のみで運用され（2章参照）、物理削除は
-- 家族全体削除（families経由のCASCADE）時のみ発生するため、通常運用でこの
-- RESTRICTが発動することはない。

CREATE INDEX IF NOT EXISTS idx_gratitude_points_family_id ON gratitude_points(family_id);
CREATE INDEX IF NOT EXISTS idx_gratitude_points_sender_created ON gratitude_points(sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_gratitude_points_recipient_id ON gratitude_points(recipient_id);

ALTER TABLE gratitude_points ENABLE ROW LEVEL SECURITY;

-- 個々のログは家族内で閲覧可能（05章・07-5章「公開範囲」参照）。
DROP POLICY IF EXISTS "gratitude_points_select_same_family" ON gratitude_points;
CREATE POLICY "gratitude_points_select_same_family" ON gratitude_points
  FOR SELECT
  USING (family_id = current_family_id());

-- 送付は本人（sender）のみ。他メンバーになりすまして贈ることはできない。
DROP POLICY IF EXISTS "gratitude_points_insert_self" ON gratitude_points;
CREATE POLICY "gratitude_points_insert_self" ON gratitude_points
  FOR INSERT
  WITH CHECK (family_id = current_family_id() AND sender_id = current_family_member_id());

-- 取消（revoked_atの設定）はsender本人のみ。13c章のトリガーが
-- 「未取消の行のみ／5分以内のみ／revoked_at以外は変更不可／revoked_atはNULLに
-- 戻せない」という不変条件をさらに強制する。
DROP POLICY IF EXISTS "gratitude_points_update_revoke_by_sender" ON gratitude_points;
CREATE POLICY "gratitude_points_update_revoke_by_sender" ON gratitude_points
  FOR UPDATE
  USING (family_id = current_family_id() AND sender_id = current_family_member_id())
  WITH CHECK (family_id = current_family_id() AND sender_id = current_family_member_id());

-- DELETEポリシーは作らない（論理取消のみ。上記[設計判断]参照）。


-- ------------------------------------------------------------
-- 13a. 週次原資ヘルパー関数
-- ------------------------------------------------------------
-- JST（Asia/Tokyo）基準の暦週（月曜0:00始まり）の開始日を返す。
-- ISO 8601の曜日番号（EXTRACT(ISODOW ...)、月曜=1〜日曜=7）を利用する。
-- chore_completions daily_limitトリガー等、既存の
-- `(reported_at AT TIME ZONE 'Asia/Tokyo')::date` パターンと一貫させている。
CREATE OR REPLACE FUNCTION public.jst_week_start_date(p_at TIMESTAMPTZ DEFAULT now())
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT ((p_at AT TIME ZONE 'Asia/Tokyo')::date)
         - (EXTRACT(ISODOW FROM (p_at AT TIME ZONE 'Asia/Tokyo')::date)::int - 1);
$$;

COMMENT ON FUNCTION public.jst_week_start_date(TIMESTAMPTZ) IS
  '与えられた時刻を含むJST暦週（月曜0:00始まり）の開始日を返す。gratitude_pointsの週次原資計算の基準に使う。';

-- [参照] 週次配布額の定数関数 public.gratitude_weekly_allowance() は、CREATE TABLE
-- gratitude_pointsのCHECK制約から参照されるため、本章冒頭（CREATE TABLEより前）で
-- 既に定義済み。理由は本章冒頭の「[順序上の理由]」コメント参照。

-- 指定したメンバーが、指定時刻を含む週に「すでに贈った」ポイント合計
-- （取消済みは除く）。13b章のINSERT時チェック、13e章の残存原資参照RPCの両方で使う。
-- SECURITY DEFINERとし、呼び出し元のgratitude_points SELECT RLSに依存せず
-- 常に正しい集計値を返せるようにする（トリガー内部からの呼び出しに対応するため。
-- current_family_id()等、本ファイル0章の既存ヘルパー関数と同じ設計パターン）。
CREATE OR REPLACE FUNCTION public.gratitude_points_weekly_used(p_sender_id UUID, p_at TIMESTAMPTZ DEFAULT now())
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(points), 0)::INT
  FROM gratitude_points
  WHERE sender_id = p_sender_id
    AND revoked_at IS NULL
    AND (created_at AT TIME ZONE 'Asia/Tokyo')::date >= public.jst_week_start_date(p_at)
    AND (created_at AT TIME ZONE 'Asia/Tokyo')::date < public.jst_week_start_date(p_at) + 7;
$$;

COMMENT ON FUNCTION public.gratitude_points_weekly_used(UUID, TIMESTAMPTZ) IS
  '指定メンバーが、指定時刻を含むJST暦週にsenderとして贈った（取消済みを除く）ポイント合計。原資チェック・残存原資参照の両方で使用。';

-- [既知の限界・今回は対応しない] 同一senderからの複数INSERTがごく短時間に
-- 同時実行された場合、本関数を使ったチェックには理論上の競合状態（それぞれの
-- トランザクションが更新前の合計を読み、合算すると週次上限をわずかに超える
-- 余地がある）が存在する。chore_completions.daily_limitの実行回数チェック
-- （5a章）にも同種の限界があり、本ファイルは一貫してこの種の競合を
-- SERIALIZABLE分離レベルやアドバイザリロックで厳密に防ぐ設計を採用していない
-- （MVPの実利用規模・実運用上の実害の小ささに対して、実装・パフォーマンス上の
-- コストが見合わないと判断）。将来運用実績を踏まえ厳密化が必要になった場合は、
-- `SELECT ... FOR UPDATE` によるsender単位の行ロック等の追加を検討する。


-- ------------------------------------------------------------
-- 13b. gratitude_points BEFORE INSERTトリガー: family_id自動補完・
--       送受信者の家族一致チェック・週次原資チェック
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gratitude_points_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_sender_family_id UUID;
  v_recipient_family_id UUID;
  v_used INT;
  v_allowance INT;
BEGIN
  SELECT family_id INTO v_sender_family_id
  FROM family_members WHERE id = NEW.sender_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '送信者が見つからないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT family_id INTO v_recipient_family_id
  FROM family_members WHERE id = NEW.recipient_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION '受取人が見つからないか無効化されています' USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_sender_family_id IS DISTINCT FROM v_recipient_family_id THEN
    RAISE EXCEPTION '送信者と受取人は同じ家族のメンバーである必要があります' USING ERRCODE = 'foreign_key_violation';
  END IF;

  -- クライアントが送ってきたfamily_idは信用せず、常にDB側の最新値で上書きする
  -- （chore_completions_before_insert等と同じ「改ざん防止」パターン、5a章参照）。
  NEW.family_id := v_sender_family_id;

  v_allowance := public.gratitude_weekly_allowance();
  v_used := public.gratitude_points_weekly_used(NEW.sender_id, NEW.created_at);

  IF v_used + NEW.points > v_allowance THEN
    RAISE EXCEPTION '今週贈れる感謝ポイントの残り原資（%pt）を超えています（残り%pt）',
      v_allowance, GREATEST(v_allowance - v_used, 0)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gratitude_points_before_insert ON gratitude_points;
CREATE TRIGGER trg_gratitude_points_before_insert
  BEFORE INSERT ON gratitude_points
  FOR EACH ROW EXECUTE FUNCTION public.gratitude_points_before_insert();


-- ------------------------------------------------------------
-- 13c. gratitude_points BEFORE UPDATEトリガー: 誤操作取消（5分以内・sender限定・
--       revoked_at以外は不変・一度取消したら元に戻せない）の強制
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gratitude_points_before_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- revoked_at以外の列は一切変更させない（贈答ログとしての不変性を保つ）。
  IF NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.recipient_id IS DISTINCT FROM OLD.recipient_id
     OR NEW.points IS DISTINCT FROM OLD.points
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.family_id IS DISTINCT FROM OLD.family_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION '取消（revoked_atの設定）以外の変更はできません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 一度取消したら元に戻せない（再送信し直す運用とする。要件定義書07-5章6・05章）。
  IF OLD.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'この感謝ポイントはすでに取消済みです' USING ERRCODE = 'check_violation';
  END IF;

  -- revoked_atをNULLのままにするUPDATE（実質的に無意味な更新）は許可しない。
  -- このトリガーへ到達するUPDATEは「取消操作」以外に用途が無いため。
  IF NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'revoked_atを設定しないUPDATEは許可されていません' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 送信から5分を超えていたら取消不可（要件定義書07-5章6「誤操作時のみ、送信から
  -- 一定時間内（案：5分以内）は取消可能」。企画部案の5分をそのまま採用。13章冒頭参照）。
  IF now() > OLD.created_at + INTERVAL '5 minutes' THEN
    RAISE EXCEPTION '送信から5分を過ぎているため取消できません' USING ERRCODE = 'check_violation';
  END IF;

  -- クライアントが指定したrevoked_atの値は信用せず、サーバー時刻で確定させる
  -- （改ざん防止パターン、5a章・13b章と同様）。
  NEW.revoked_at := now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gratitude_points_before_update ON gratitude_points;
CREATE TRIGGER trg_gratitude_points_before_update
  BEFORE UPDATE ON gratitude_points
  FOR EACH ROW EXECUTE FUNCTION public.gratitude_points_before_update();


-- ------------------------------------------------------------
-- 13d. （RLSポリシーは13章冒頭のCREATE TABLEブロック直後に配置済み）
-- ------------------------------------------------------------
-- gratitude_points_select_same_family / gratitude_points_insert_self /
-- gratitude_points_update_revoke_by_sender の3ポリシーを参照。


-- ------------------------------------------------------------
-- 13e. my_gratitude_giveable_balance()（本人限定・残存原資参照RPC）
-- ------------------------------------------------------------
-- [設計判断] 「感謝ポイントを贈る」画面で「今週あと何pt贈れるか」を表示するための
-- 専用RPC。Viewではなく**呼び出し本人の残存原資のみを返すSECURITY DEFINER関数**と
-- した理由は13章冒頭「公開範囲・ランキング防止」の設計判断を参照。
-- gratitude_pointsのSELECT RLSは家族内の全ログを返す設計のため、もし
-- 「メンバー横断で残存原資を一覧できるView」を用意すると、実質的に「誰が今週
-- どれだけ使ったか」を並べて見せる構造になり、05章・07-5章が明確に禁止する
-- ランキング的な可視化に転用されやすくなってしまう。本関数はcurrent_family_member_id()
-- で解決した「呼び出し本人」の残存原資1件のみを返すため、この懸念が生じない。
CREATE OR REPLACE FUNCTION public.my_gratitude_giveable_balance()
RETURNS INT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(
    public.gratitude_weekly_allowance() - public.gratitude_points_weekly_used(current_family_member_id()),
    0
  );
$$;

COMMENT ON FUNCTION public.my_gratitude_giveable_balance() IS
  '呼び出し本人（current_family_member_id()）が今週まだ贈れる感謝ポイントの残り原資。他メンバー分は取得できない（ランキング防止のための設計判断、13章参照）。';

GRANT EXECUTE ON FUNCTION public.my_gratitude_giveable_balance() TO authenticated;


-- ============================================================
-- 14. member_points（View）改訂 — 感謝ポイント受領分の合算
-- ============================================================
-- [2026-08-15改訂] 要件定義書.md v0.6 05章「既存ポイント経済との合算方針」・
-- 07-5章のとおり、感謝ポイントを**受け取った側**のポイントはmember_points（8章）に
-- 合算し、ごほうび交換に使えるようにする。**贈った側**の原資消費（13a章）は
-- この合算に一切含めない（別会計。13章冒頭参照）。
--
-- 8章の元のCREATE OR REPLACE VIEWをそのままの並び順で維持しつつ、
-- gratitude_points（受領分・取消除く）のLEFT JOINを1本追加しただけであり、
-- 8章で説明したsecurity_invoker=true・family_members起点のLEFT JOIN方式という
-- 設計方針そのものは変更していない。
--
-- [影響範囲] 本Viewを参照する既存オブジェクト（reward_redemptions_before_insert
-- トリガー、7a章）への影響は無い。同トリガーは `current_points` 列を
-- `member_id` で1行lookupしているだけであり、`current_points` の内訳計算式に
-- 感謝ポイントの受領分が追加されても、参照方法・返り値の型（INT）は変わらない
-- ため、7a章のロジックはそのまま動作する。
-- ============================================================
CREATE OR REPLACE VIEW member_points
WITH (security_invoker = true) AS
SELECT
  fm.id AS member_id,
  fm.family_id,
  fm.display_name,
  (
    COALESCE(earned.total, 0)
    - COALESCE(spent.total, 0)
    + COALESCE(gratitude_received.total, 0)
  )::INT AS current_points
FROM family_members fm
LEFT JOIN (
  SELECT reported_by AS member_id, SUM(points)::INT AS total
  FROM chore_completions
  GROUP BY reported_by
) earned ON earned.member_id = fm.id
LEFT JOIN (
  SELECT member_id, SUM(cost)::INT AS total
  FROM reward_redemptions
  WHERE status = 'approved'
  GROUP BY member_id
) spent ON spent.member_id = fm.id
LEFT JOIN (
  -- [新規] 感謝ポイント受領分（recipient視点でのSUM）。取消済み（revoked_at IS NOT NULL）
  -- は除外する。13章「取消の実装方式」のとおり、取消は「無かったことにする」ため
  -- 残高計算からも除外するのが一貫している。
  SELECT recipient_id AS member_id, SUM(points)::INT AS total
  FROM gratitude_points
  WHERE revoked_at IS NULL
  GROUP BY recipient_id
) gratitude_received ON gratitude_received.member_id = fm.id
WHERE fm.is_active;


-- ============================================================
-- 15. 07-6. 双方向リアクション（子→親、次フェーズ）— 設計方針メモ
-- ============================================================
-- [2026-08-15追加・実装しない] 要件定義書.md v0.6 07-6章・05章「設計部への申し送り
-- 事項（双方向リアクション・次フェーズ）」（本部長採点100点）を受けたメモ。
-- 07-6章のとおりMVP対象外・次フェーズ扱いであり、**本章はテーブル定義・RLS変更を
-- 一切含まない**。次フェーズ着手時に参照するための設計方針のみを記録する。
--
-- [前提条件（07-6章より）] 次フェーズ着手は (1) 07-4章の親の完了報告がMVPで
-- リリース済みであること、(2) 少数家族でのベータテスト・定性ヒアリングを経ること、
-- が前提。本メモはあくまで「着手する場合の設計の見込み」であり、着手時期を
-- 決めるものではない。
--
-- [見込み1: 既存chore_reactionsの構造は作り直さない]
-- 05章申し送りのとおり、子→親方向のリアクションもスタンプ・コメントのみで
-- 承認/非承認や点数評価を持たないという制約（5b章のchk_reaction_kind_payload等）を
-- そのまま踏襲できる見込みである。kind/stamp_key/comment_body列の再設計は不要。
--
-- [見込み2: 中心になるのは「誰がリアクションできるか」という権限ロジックの拡張]
-- 現行の5b章 `chore_reactions_insert_by_parent` ポリシーは
-- `is_current_user_parent() AND reacted_by = current_family_member_id()` という
-- 「リアクションする側が保護者であること」だけを条件にしている。双方向化する場合は、
-- 概念的には次のような判定に拡張することになる見込み（あくまで方向性であり、
-- 実際のSQL文言は次フェーズ着手時に確定する）。
--   - 対象completionの`reported_by`のroleが'parent'の場合 → 保護者・子どものどちらも
--     リアクション可（子→親方向を新たに許可）
--   - 対象completionの`reported_by`のroleが'child'の場合 → 従来どおり保護者のみ
--     リアクション可（子ども同士の相互リアクションは07-6章の対象外であり、
--     要件定義書に記載が無いため次フェーズでも許可しない前提）
-- 実装方式の候補（次フェーズ確定時に選択）:
--   (a) chore_reactions_insert_by_parentポリシーのWITH CHECKに、対象completionの
--       reported_by先family_members.roleをサブクエリで参照する条件を追加する
--       （ポリシー名は実態に合わせ`chore_reactions_insert_scoped`等に変更する想定）。
--   (b) 判定ロジックが複雑になる場合は、`current_family_role()`（0章）等の既存
--       ヘルパー関数と同じ設計パターンで `can_react_to_completion(completion_id uuid)`
--       のようなSECURITY DEFINERヘルパー関数を新設し、ポリシーからはその関数を
--       呼ぶだけにする（ポリシー本体の可読性を保つため）。
-- いずれの方式でも、**新規テーブル・新規列は不要**であり、影響範囲はRLSポリシー
-- （および必要であれば上記ヘルパー関数）に限定される見込みである。
--
-- [見込み3: 導入しない機能（07-6章より再掲）]
-- 「親の家事に点数をつける」「子どもが親の完了報告を承認/差し戻しする」機能は、
-- parentification（役割逆転）研究のリスクを踏まえ導入しない。次フェーズで
-- スキーマを拡張する際も、承認/非承認や点数評価に相当する列・状態遷移を
-- chore_reactionsに追加しないこと。
--
-- [見込み4: 通知の扱い]
-- 08章のプッシュ通知イベント（8.2章参照）に「子ども→親リアクション時→保護者へ通知」
-- が追加される見込みだが、07-6章「対象年齢の低い子どもに対して機能を強く前面に
-- 出す・プッシュ通知で催促する等は行わない」の方針上、あくまで任意送信への
-- 事後通知にとどめ、催促・リマインドの類は設けない（07-5章の感謝ポイントと同じ
-- 方針）。
-- ============================================================
