/**
 * モックデータ（初期シード）。
 *
 * 実際のSupabaseプロジェクトを作成していないため、画面表示用に
 * スキーマ設計.sql の各テーブル構成へ準拠したダミーデータを用意する。
 * 主要画面ワイヤーフレーム.md の例（ちひろ／はみがき／しゅくだい等）に
 * 寄せることで、成果物と実装の対応が見た目からも追いやすいようにしている。
 */
import type {
  Category,
  Chore,
  ChoreCompletion,
  ChoreReaction,
  Family,
  FamilyMember,
  Reward,
  RewardRedemption,
} from "@/types/domain";

export const seedFamily: Family = {
  id: "family-1",
  name: "森下家",
  invite_code: "AB3CD9EF",
  created_at: "2026-07-01T00:00:00+09:00",
  updated_at: "2026-07-01T00:00:00+09:00",
};

export const seedMembers: FamilyMember[] = [
  {
    id: "member-parent-1",
    family_id: "family-1",
    display_name: "もりした ゆう",
    role: "parent",
    avatar_color: "#A8D5BA",
    is_owner: true,
    is_active: true,
    created_at: "2026-07-01T00:00:00+09:00",
    updated_at: "2026-07-01T00:00:00+09:00",
  },
  {
    id: "member-parent-2",
    family_id: "family-1",
    display_name: "もりした けい",
    role: "parent",
    avatar_color: "#FFE5B4",
    is_owner: false,
    is_active: true,
    created_at: "2026-07-01T00:00:00+09:00",
    updated_at: "2026-07-01T00:00:00+09:00",
  },
  {
    id: "member-child-1",
    family_id: "family-1",
    display_name: "ちひろ",
    role: "child",
    avatar_color: "#FFC1CC",
    is_owner: false,
    is_active: true,
    created_at: "2026-07-01T00:00:00+09:00",
    updated_at: "2026-07-01T00:00:00+09:00",
  },
  {
    id: "member-child-2",
    family_id: "family-1",
    display_name: "そら",
    role: "child",
    avatar_color: "#B4D4FF",
    is_owner: false,
    is_active: true,
    created_at: "2026-07-01T00:00:00+09:00",
    updated_at: "2026-07-01T00:00:00+09:00",
  },
];

export const seedCategories: Category[] = [
  { id: "cat-1", family_id: "family-1", name: "せいかつ", color: "#A8D5BA", sort_order: 0 },
  { id: "cat-2", family_id: "family-1", name: "べんきょう", color: "#B4D4FF", sort_order: 1 },
  { id: "cat-3", family_id: "family-1", name: "おてつだい", color: "#FFE5B4", sort_order: 2 },
];

// NFCタグのモック値。実機はexpo-crypto等のCrypto.randomUUID()で生成する想定
// （API仕様.md 3a章手順1、src/lib/nfc.ts の generateNfcTagToken() 参照）だが、
// シード値は再現性のため固定文字列にしている。
const MOCK_NFC_TOKENS = {
  chore1: "nfc-tag-a1111111-1111-4111-8111-111111111111",
  chore2: "nfc-tag-a2222222-2222-4222-8222-222222222222",
  chore3: "nfc-tag-a3333333-3333-4333-8333-333333333333",
  chore5: "nfc-tag-a5555555-5555-4555-8555-555555555555",
} as const;

// [2026-08-22追加、2026-08-23改訂] みまもりメンバー対応（要件定義書07-7章、
// スキーマ設計.sql 19章）で Chore型に created_by/scope が追加されたため、
// モックシードにも既存データ相当のデフォルト値（scope='family'・created_by=null）を
// 補完する。実DB側もADD COLUMN DEFAULTで同様にバックフィルされる（後方互換、19章
// コメント参照）。is_shared_with_family（可視性トグル）は4回目のスコープ変更により
// 撤回されたため、ここでの補完対象からも外した。
type LegacyChoreSeed = Omit<Chore, "created_by" | "scope">;

export const seedChores: Chore[] = (
  [
  {
    id: "chore-1",
    family_id: "family-1",
    category_id: "cat-1",
    title: "はみがき",
    emoji: "🦷",
    points: 5,
    is_repeatable: true,
    daily_limit: 2,
    assigned_to: null,
    is_active: true,
    nfc_tag_id: MOCK_NFC_TOKENS.chore1, // NFCタグ登録ずみ（daily_limit=2）
  },
  {
    id: "chore-2",
    family_id: "family-1",
    category_id: "cat-2",
    title: "しゅくだい",
    emoji: "📚",
    points: 10,
    is_repeatable: true,
    daily_limit: 1,
    assigned_to: null,
    is_active: true,
    // NFCタグ登録ずみ（daily_limit=1）。
    // 検証用シミュレーション導線で同じタグを2回続けて読み取ると、
    // 1回目=C14「即時加点」、2回目=C14「上限到達」を確認できる
    // （2026-08-15改訂：承認フロー廃止によりNFC経由の完了報告は常に即時加点の1状態のみ）。
    nfc_tag_id: MOCK_NFC_TOKENS.chore2,
  },
  {
    id: "chore-3",
    family_id: "family-1",
    category_id: "cat-3",
    title: "おそうじ",
    emoji: "🧹",
    points: 8,
    is_repeatable: true,
    daily_limit: 1,
    assigned_to: null,
    is_active: true,
    nfc_tag_id: MOCK_NFC_TOKENS.chore3, // NFCタグ登録ずみ（主要画面ワイヤーフレーム.md 7.3の例に対応）
  },
  {
    id: "chore-4",
    family_id: "family-1",
    category_id: "cat-3",
    title: "さんぽ",
    emoji: "🐶",
    points: 6,
    is_repeatable: true,
    daily_limit: 1,
    assigned_to: "member-child-1",
    is_active: true,
    nfc_tag_id: null, // NFCタグ未登録（P11拡張モーダルの「未登録」状態の確認用に残す）
  },
  {
    id: "chore-5",
    family_id: "family-1",
    category_id: "cat-1",
    title: "おさらあらい",
    emoji: "🍽️",
    points: 4,
    is_repeatable: false,
    daily_limit: null,
    assigned_to: null,
    is_active: true,
    // NFCタグ登録ずみ。検証用シミュレーション導線で読み取るとC14「即時加点」状態を確認できる
    // （2回目以降は非繰り返しchoreのため上限到達扱いになる）。
    nfc_tag_id: MOCK_NFC_TOKENS.chore5,
  },
  ] satisfies LegacyChoreSeed[]
).map((c) => ({ ...c, created_by: null, scope: "family" as const }));

// [変更/大幅改訂] 2026-08-15改訂: 承認フロー廃止(スキーマ設計.sql 5章「[廃止]」)に伴い、
// status/review_note/reviewed_by/reviewed_atを持つエントリから、確定済みの完了報告のみを
// 持つエントリへ書き換えた。あわせて実施履歴カレンダー（07-3章）の週間バー・月間カレンダーを
// 画面確認できるよう、直近1週間（システム日付2026-08-15基準）に日をまたいだ完了報告を
// 複数用意している。
// [2026-08-22追加・2026-08-23撤回] Chore型と同じ理由（19章・21章コメント参照）で
// 一時的にChoreCompletion型にchore_scope/is_shared_with_familyスナップショット列を
// 追加していたが、4回目のスコープ変更（可視性判定を都度JOINへ一本化）により
// ChoreCompletion型・実DBの両方から削除された。そのためモックシード側の補完も不要になった。
type LegacyCompletionSeed = ChoreCompletion;

export const seedCompletions: ChoreCompletion[] = (
  [
  {
    id: "completion-1",
    family_id: "family-1",
    chore_id: "chore-1",
    chore_title: "はみがき",
    chore_emoji: "🦷",
    reported_by: "member-child-1",
    points: 5,
    photo_url: null,
    note: null,
    reported_at: "2026-08-15T08:02:00+09:00",
  },
  {
    id: "completion-2",
    family_id: "family-1",
    chore_id: "chore-2",
    chore_title: "しゅくだい",
    chore_emoji: "📚",
    reported_by: "member-child-2",
    points: 10,
    photo_url: null,
    note: "さんすうのプリントおわった",
    reported_at: "2026-08-15T08:15:00+09:00",
  },
  {
    id: "completion-3",
    family_id: "family-1",
    chore_id: "chore-3",
    chore_title: "おそうじ",
    chore_emoji: "🧹",
    reported_by: "member-child-1",
    points: 8,
    photo_url: null,
    note: null,
    reported_at: "2026-08-15T08:20:00+09:00",
  },
  {
    id: "completion-4",
    family_id: "family-1",
    chore_id: "chore-2",
    chore_title: "しゅくだい",
    chore_emoji: "📚",
    reported_by: "member-child-1",
    points: 10,
    photo_url: null,
    note: null,
    reported_at: "2026-08-14T07:30:00+09:00",
  },
  {
    id: "completion-5",
    family_id: "family-1",
    chore_id: "chore-1",
    chore_title: "はみがき",
    chore_emoji: "🦷",
    reported_by: "member-child-1",
    points: 5,
    photo_url: null,
    note: null,
    reported_at: "2026-08-14T20:10:00+09:00",
  },
  {
    id: "completion-6",
    family_id: "family-1",
    chore_id: "chore-3",
    chore_title: "おそうじ",
    chore_emoji: "🧹",
    reported_by: "member-child-2",
    points: 8,
    photo_url: null,
    note: "おわった！",
    reported_at: "2026-08-13T17:00:00+09:00",
  },
  {
    id: "completion-7",
    family_id: "family-1",
    chore_id: "chore-4",
    chore_title: "さんぽ",
    chore_emoji: "🐶",
    reported_by: "member-child-1",
    points: 6,
    photo_url: null,
    note: null,
    reported_at: "2026-08-12T09:00:00+09:00",
  },
  {
    id: "completion-8",
    family_id: "family-1",
    chore_id: "chore-5",
    chore_title: "おさらあらい",
    chore_emoji: "🍽️",
    reported_by: "member-child-2",
    points: 4,
    photo_url: null,
    note: null,
    reported_at: "2026-08-11T18:00:00+09:00",
  },
  {
    id: "completion-9",
    family_id: "family-1",
    chore_id: "chore-1",
    chore_title: "はみがき",
    chore_emoji: "🦷",
    reported_by: "member-child-2",
    points: 5,
    photo_url: null,
    note: null,
    reported_at: "2026-08-10T08:00:00+09:00",
  },
  ] satisfies LegacyCompletionSeed[]
);

// [新設] chore_reactions（スキーマ設計.sql 5b章）。保護者リアクション（スタンプ／コメント）の
// モックデータ。主要画面ワイヤーフレーム.md 3.2章・4章の例文（ママ「がんばったね」等）に寄せている。
export const seedReactions: ChoreReaction[] = [
  {
    id: "reaction-1",
    family_id: "family-1",
    completion_id: "completion-1", // ちひろ・はみがき
    reacted_by: "member-parent-1",
    kind: "stamp",
    stamp_key: "ganbatta",
    comment_body: null,
    created_at: "2026-08-15T08:10:00+09:00",
  },
  {
    id: "reaction-2",
    family_id: "family-1",
    completion_id: "completion-1", // ちひろ・はみがき
    reacted_by: "member-parent-2",
    kind: "stamp",
    stamp_key: "arigato",
    comment_body: null,
    created_at: "2026-08-15T08:30:00+09:00",
  },
  {
    id: "reaction-3",
    family_id: "family-1",
    completion_id: "completion-2", // そら・しゅくだい
    reacted_by: "member-parent-1",
    kind: "stamp",
    stamp_key: "ganbatta",
    comment_body: null,
    created_at: "2026-08-15T08:20:00+09:00",
  },
  {
    id: "reaction-4",
    family_id: "family-1",
    completion_id: "completion-4", // ちひろ・しゅくだい（8/14）
    reacted_by: "member-parent-1",
    kind: "stamp",
    stamp_key: "ganbatta",
    comment_body: null,
    created_at: "2026-08-14T07:45:00+09:00",
  },
  {
    id: "reaction-5",
    family_id: "family-1",
    completion_id: "completion-4", // ちひろ・しゅくだい（8/14）
    reacted_by: "member-parent-1",
    kind: "comment",
    stamp_key: null,
    comment_body: "がんばったね！",
    created_at: "2026-08-14T07:46:00+09:00",
  },
];

// [2026-08-22追加] Chore型と同じ理由（19〜20章コメント参照）でReward型に
// created_by/scopeが追加されたため、モックシードにもデフォルト値
// （scope='family'・created_by=null）を補完する。
type LegacyRewardSeed = Omit<Reward, "created_by" | "scope">;

export const seedRewards: Reward[] = (
  [
  {
    id: "reward-1",
    family_id: "family-1",
    name: "アイス",
    emoji: "🍦",
    cost: 30,
    description: "すきなあじをえらべるよ",
    is_active: true,
  },
  {
    id: "reward-2",
    family_id: "family-1",
    name: "30ぷんゲーム",
    emoji: "🎮",
    cost: 200,
    description: null,
    is_active: true,
  },
  {
    id: "reward-3",
    family_id: "family-1",
    name: "おかし1こ",
    emoji: "🍪",
    cost: 15,
    description: null,
    is_active: true,
  },
  {
    id: "reward-4",
    family_id: "family-1",
    name: "こうえんであそぶ",
    emoji: "🛝",
    cost: 50,
    description: "ほごしゃといっしょに",
    is_active: true,
  },
  ] satisfies LegacyRewardSeed[]
).map((r) => ({ ...r, created_by: null, scope: "family" as const }));

export const seedRedemptions: RewardRedemption[] = [
  {
    id: "redemption-1",
    family_id: "family-1",
    reward_id: "reward-3",
    reward_name: "おかし1こ",
    member_id: "member-child-1",
    cost: 15,
    status: "approved",
    created_at: "2026-08-12T18:02:00+09:00",
  },
];
