/**
 * ドメイン型定義。
 * 参照: 設計部/成果物/スキーマ設計.sql
 * 各テーブル・Viewの列構成にできる限り対応させている。
 */

export type FamilyRole = "parent" | "child";

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
