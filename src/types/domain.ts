/**
 * ドメイン型定義。
 * 参照: 設計部/成果物/スキーマ設計.sql
 * 各テーブル・Viewの列構成にできる限り対応させている。
 */

// [変更・2026-08-22] みまもりメンバー（要件定義書07-7章、スキーマ設計.sql 18章）
// 対応で "supporter" を追加。DBカラム値・呼称は設計部の決定どおり。
export type FamilyRole = "parent" | "child" | "supporter";

export interface Family {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
  updated_at: string;
}

export interface FamilyMember {
  id: string;
  family_id: string;
  display_name: string;
  role: FamilyRole;
  avatar_color: string | null;
  is_owner: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  family_id: string;
  name: string;
  color: string | null;
  sort_order: number;
}

export interface Chore {
  id: string;
  family_id: string;
  category_id: string | null;
  title: string;
  emoji: string;
  points: number;
  is_repeatable: boolean;
  daily_limit: number | null;
  assigned_to: string | null; // family_members.id、nullなら誰でも実行可
  // [削除] requires_approval（要件定義書.md v0.5 2026-08-15改訂・スキーマ設計.sql 4章[削除]）。
  // 承認フローが全面廃止され「chore単位で承認要否を切り替える」という概念自体が
  // 仕様から消えたため、列ごと削除した（転用しない。理由はスキーマ設計.sql 4章コメント参照）。
  is_active: boolean;
  // [追加] NFCクイック完了（要件定義書07-2章、スキーマ設計.sql chores.nfc_tag_id）。
  // 保護者がP11拡張モーダルで物理NFCタグへ書き込む、アプリ生成の不透明トークン。
  // 1chore=1タグ。null=タグ未登録。家族をまたいだグローバル一意
  // （uq_chores_nfc_tag_id、nfc_tag_id IS NOT NULLの部分ユニークインデックス）。
  nfc_tag_id: string | null;
  // [追加・2026-08-22] みまもりメンバー対応（要件定義書07-7章、スキーマ設計.sql 19章）。
  // scope='family'（家族共有・既存の全chores行はこの値）/ 'personal'（自分専用。
  // role='supporter'のみ新規登録可）。created_byはscope='personal'の場合は必須で、
  // assigned_toと同一値（自己指定）になる（DBトリガーで強制）。
  // [2026-08-23削除] is_shared_with_family（可視性トグル）は要件定義書07-7章
  // 4回目のスコープ変更（家族共有choreへの参加機能の撤回）により撤回した。
  // [2026-08-23再改訂・5回目のスコープ変更] scope='personal'のchoreは4回目時点では
  // 常に非公開だったが、ユーザーの要望「配慮とかはいらない、みんなで確認してもらい
  // ながら一緒に頑張るすたんす」を受け、常に家族全員に公開する方針へ反転した
  // （閲覧のみ。編集・完了報告は引き続きcreated_by本人に限定。要件定義書07-7章
  // 「自分専用choreの公開方針」参照）。
  created_by: string | null;
  scope: "family" | "personal";
}

// [削除] CompletionStatus型（pending/approved/rejected）はスキーマ設計.sql 5章の
// 承認フロー廃止に伴い廃止。chore_completionsは常に確定済みの完了報告のみを持つ。

export interface ChoreCompletion {
  id: string;
  family_id: string;
  chore_id: string | null;
  chore_title: string;
  chore_emoji: string;
  reported_by: string; // family_members.id
  // [削除] status/review_note/reviewed_by/reviewed_at（スキーマ設計.sql 5章「[廃止]」参照）。
  // 承認/差し戻しという状態遷移自体が無くなり、chore_completionsはINSERTのみの
  // 追記専用ログになった（UPDATE経路自体が存在しない）。
  points: number;
  photo_url: string | null;
  note: string | null; // 子どもが完了報告時に書くひとことメモ（任意）
  reported_at: string;
  // [2026-08-23削除] みまもりメンバー対応（要件定義書07-7章、スキーマ設計.sql 21章）で
  // 追加していたchore_scope/is_shared_with_familyスナップショット列は、4回目の
  // スコープ変更（家族共有choreへの参加機能・可視性トグルの撤回）に伴い撤回した。
  // [2026-08-23再改訂・5回目のスコープ変更] 可視性判定はいったん`chores`への都度JOINに
  // 一本化していたが（設計部/成果物/スキーマ設計.sql 21b章「可視性判定を都度JOINに
  // 変更した理由」）、自分専用choreの完了報告が家族全員に公開される方針へ反転した
  // ことに伴い、JOIN自体が不要な`family_id = current_family_id()`のみの単純な条件に
  // 戻った（要件定義書07-7章「自分専用choreの公開方針」参照）。
}

// [新設] chore_reactions（スキーマ設計.sql 5b章）。保護者リアクション（スタンプ／コメント）。
export type ReactionKind = "stamp" | "comment";

// 主要画面ワイヤーフレーム.md 3.0節で決定した4種のスタンプ（stamp_keyの値一覧）。
// DB側はTEXT列（enumではない）のため、この一覧はあくまでクライアント側の初期セット。
export type StampKey = "ganbatta" | "arigato" | "sugoi" | "tasukatta";

export interface ChoreReaction {
  id: string;
  family_id: string;
  completion_id: string; // chore_completions.id
  reacted_by: string; // family_members.id（保護者のみ。RLS: chore_reactions_insert_by_parent）
  kind: ReactionKind;
  stamp_key: StampKey | null; // kind='stamp'のときのみ非null
  comment_body: string | null; // kind='comment'のときのみ非null（1〜200文字）
  created_at: string;
}

// [新設] gratitude_points（スキーマ設計.sql 13章）。感謝ポイント（要件定義書.md v0.6
// 07-5章）。事前登録タスクの自己申告（chore_completions）でも事後の無償リアクション
// （chore_reactions）でもない、その場で気づいた自由記述の行動に気づいた家族が
// ポイント付きで贈る第三の記録種別。週次原資（giveable）は本テーブルとは別会計であり、
// 残存原資はこの型には含まれない（my_gratitude_giveable_balance() RPCで別途取得する。
// API仕様.md 7a.1章）。
export interface GratitudePoint {
  id: string;
  family_id: string;
  sender_id: string; // family_members.id
  recipient_id: string; // family_members.id
  points: number;
  note: string; // 自由記述必須（1〜200文字、DB側CHECK制約）
  created_at: string;
  revoked_at: string | null; // 非NULL=誤操作取消済み（送信から5分以内・sender本人のみ）
}

export interface Reward {
  id: string;
  family_id: string;
  name: string;
  emoji: string;
  cost: number;
  description: string | null;
  is_active: boolean;
  // [追加・2026-08-22] みまもりメンバー対応（要件定義書07-7章、スキーマ設計.sql 20章）。
  // chores.scope/created_byと同じ設計。scope='personal'のrewardには
  // is_shared_with_family相当の概念は無い（自分専用rewardは常に非公開のまま）。
  created_by: string | null;
  scope: "family" | "personal";
}

export interface RewardRedemption {
  id: string;
  family_id: string;
  reward_id: string | null;
  reward_name: string;
  member_id: string;
  cost: number;
  status: "approved";
  created_at: string;
}

// member_points View 相当
export interface MemberPoints {
  member_id: string;
  family_id: string;
  display_name: string;
  current_points: number;
}

// 通帳の履歴1行（獲得/消費どちらも表せる共通型。UI側でのみ使用）
export interface LedgerEntry {
  id: string;
  // [変更・2026-08-16] "gratitude"（感謝ポイント受領分）を追加。符号の扱いはearnと同じ
  // （+表示。gratitude_pointsは受け取った側のmember_pointsに合算されるため、通帳上は
  // 「増えた」履歴として扱う。スキーマ設計.sql 14章参照）。
  kind: "earn" | "spend" | "gratitude";
  label: string;
  emoji: string;
  points: number; // earn/gratitudeは+、spendは-の絶対値を格納しUI側で符号を付ける
  occurredAt: string;
  // [変更] 2026-08-15改訂: 承認フロー廃止に伴い「承認済み」等のstatusLabelは廃止した
  // （主要画面ワイヤーフレーム.md 4章「履歴行の末尾にあった『承認済』表示を削除した」）。
  // 代わりに、獲得履歴（kind='earn'）に届いた保護者リアクション（chore_reactions）を
  // そのまま添えて表示する（同章「届いたリアクションを併記」）。消費履歴には常に空配列。
  reactions: ChoreReaction[];
  // [新設・2026-08-16] kind='gratitude'（感謝ポイント受領分、gratitude_points由来）の
  // 自由記述メモ。通帳統合表示用（主要画面ワイヤーフレーム.md 4章「感謝ポイントの
  // 通帳への統合表示」）。kind='earn'/'spend'では未使用。
  note?: string;
}

// 実施履歴カレンダー（要件定義書07-3章、API仕様.md 6a章）の日別集計1行。
// chore_completion_daily_summary View 相当（member_id単位、JST日付基準）。
export interface DailySummaryEntry {
  activity_date: string; // "YYYY-MM-DD"（JST基準）
  member_id: string;
  family_id: string;
  completion_count: number;
  total_points: number;
}

// [新設・2026-08-22] family_invites（スキーマ設計.sql 25章）。みまもりメンバー招待
// （要件定義書06章・07-7章）。既存の共有シークレット方式（families.invite_code）とは
// 別の、宛先メールアドレス・ロールを1件ごとに固定した招待の仕組み。
export interface FamilyInvite {
  id: string;
  family_id: string;
  role: "supporter"; // 現時点ではみまもりメンバー招待専用（スキーマ設計.sql 25章）
  invited_email: string;
  token: string;
  status: "pending" | "accepted" | "revoked";
  created_by: string; // family_members.id（招待発行者＝保護者）
  accepted_by: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
}

// family_invite_lookup RPC の返り値（API仕様.md 2d章手順3）。
export interface FamilyInviteLookupResult {
  family_name: string;
  role: "supporter";
  status: "pending" | "accepted" | "revoked";
  expires_at: string;
}

// [新設・2026-08-23] 家族の木（要件定義書07-9章、スキーマ設計.sql 29章）・
// 色分けによる個人の可視化（07-10章）・今週のまとめメッセージ（07-8章）対応。
// 実装メモ.md 66章参照。

/** family_tree_seasons テーブル/family_tree_current_season Viewの1行（API仕様.md 9.1・9.4章）。 */
export interface FamilyTreeSeason {
  id: string;
  family_id: string;
  season_start: string; // "YYYY-MM-DD"（JST基準の暦月初日）
  season_end: string | null; // NULL=進行中シーズン
  completion_count: number; // シーズン内累計完了報告数（加算のみの単調増加）
  current_stage: number; // 0=種 1=芽 2=若木 3=花 4=実
  created_at: string;
  updated_at: string;
}

/** family_tree_member_breakdown Viewの1行（API仕様.md 9.3章「詳細内訳」）。 */
export interface FamilyTreeMemberBreakdown {
  family_id: string;
  season_id: string;
  season_start: string;
  member_id: string;
  display_name: string;
  avatar_color: string | null;
  member_created_at: string;
  completion_count: number;
}

// [新設・2026-08-26] お絵かき（要件定義書07-13-2章、スキーマ設計.sql 33b章
// family_drawings、API仕様.md 12.2章）。ガチャ・コレクター棚・木への飾り付け
// （07-13章の第3〜5段階）はここでは扱わない（第2段階のみの実装範囲。
// 開発部/成果物/実装メモ.md参照）。

/** line_data(JSONB)内の線1本。cは8色固定パレットのHEXコードのいずれか。 */
export interface FamilyDrawingLine {
  c: string;
  /** [x1,y1,x2,y2,...] のフラット配列。座標は0〜1000の整数（スキーマ設計.sql 33b章）。 */
  p: number[];
}

/** family_drawings.line_data(JSONB)本体。`is_valid_drawing_line_data()`が検証する形式と一致させる。 */
export interface FamilyDrawingLineData {
  v: 1;
  lines: FamilyDrawingLine[];
}

/** family_drawings テーブルの1行。 */
export interface FamilyDrawing {
  id: string;
  family_id: string;
  artist_member_id: string;
  line_data: FamilyDrawingLineData;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
}

// [新設・2026-08-26・第3段階] ガチャ（要件定義書07-13-1章、スキーマ設計.sql
// 33a章 gacha_member_progress_summary／33c章 gacha_preset_ornaments／
// 33d章 gacha_draws・draw_gacha()、API仕様.md 12.1・12.3章）。
// 木への飾り付け・コレクター棚（07-13章の第4〜5段階）はここでは扱わない
// （decorate_tree_with_gacha_prize()は第3段階の実装範囲外。
// 開発部/成果物/実装メモ.md参照）。

/** gacha_member_progress_summary Viewの1行（API仕様.md 12.1章）。 */
export interface GachaMemberProgressSummary {
  member_id: string;
  family_id: string;
  lifetime_completion_count: number;
  draw_count: number;
  next_draw_threshold: number;
  /** あと何回で次のガチャが引けるか。0なら引ける。 */
  remaining_until_next_draw: number;
  can_draw_now: boolean;
}

export type GachaPrizeKind = "preset_ornament" | "family_drawing";

/** draw_gacha()（引数なし）の戻り値1行（API仕様.md 12.3章）。 */
export interface GachaDrawResult {
  draw_id: string;
  prize_kind: GachaPrizeKind;
  preset_ornament_id: string | null;
  prize_drawing_id: string | null;
}

/** gacha_preset_ornaments テーブルの1行（既製の飾りカタログ、全家族共通）。 */
export interface GachaPresetOrnament {
  id: string;
  ornament_key: string;
  display_name: string;
  emoji: string | null;
  is_active: boolean;
  created_at: string;
}

/** weekly_family_digests テーブルの1行（API仕様.md 10章「今週のまとめメッセージ」）。 */
export type WeeklyDigestPattern =
  | "tree_growth"
  | "weekday_highlight"
  | "streak_highlight"
  | "week_comparison"
  | "default";

export interface WeeklyFamilyDigest {
  id: string;
  family_id: string;
  week_start: string; // "YYYY-MM-DD"（対象週の月曜日、JST基準）
  message: string;
  detected_pattern: WeeklyDigestPattern;
  detail: Record<string, unknown> | null;
  generated_at: string;
}
