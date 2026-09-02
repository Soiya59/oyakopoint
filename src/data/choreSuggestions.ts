/**
 * クエストのおすすめ集（要件定義書.md 07-16章、2026-09-02追加）の静的データ。
 * アプリ内定数としてのみ保持し、DBには一切保存しない（07-16章6.「一覧の保存先」）。
 *
 * 27件は企画部の初期リスト案（07-16章「おすすめの初期リスト案」の表）を一字一句そのまま
 * 転記したもの（絵文字・ひらがなのクエスト名・ポイント目安・頻度ラベル・対象ラベル）。
 * 掲載順も表の掲載順（#1〜#27）のまま変更していない（27.2節「フィルタ後も行の相対順は
 * 変えない」の前提）。
 *
 * 頻度→繰り返し設定の変換仕様（07-16章4-1節「頻度→繰り返し設定の変換仕様」決定1〜4、
 * 2026-09-02改訂・本部長差し戻し対応）:
 *   - 3区分（毎日／週1くらい／たまに）とも `is_repeatable=true` に変換する（決定1）。
 *   - 頻度ラベルはUI表示専用であり、登録後のクエストの挙動には一切影響しない（決定2）。
 *   - `daily_limit` は明示的な値を設定せず、未指定（null/undefined）のままP11を開く。
 *     既存のDBトリガー（is_repeatable=trueかつdaily_limit IS NULLなら1を補完）に委ねる
 *     （決定3）。
 *   - おすすめ集には単発（is_repeatable=false）クエストを含めない（決定4）。
 *   本ファイルはこの決定どおり、frequency情報を`is_repeatable`へ変換する処理を一切持たず、
 *   呼び出し側（P11）が常に`isRepeatable=true`・`dailyLimit`未指定として扱う。
 */

/** 頻度ラベル（UI表示専用。DBには保存しない）。 */
export type ChoreSuggestionFrequency = "毎日" | "週1くらい" | "たまに";

/** 対象の目安ラベル（年齢を尋ねず選べる分類キー。DBには保存しない）。 */
export type ChoreSuggestionTarget = "小さい子向け" | "小学生向け" | "だれでも";

export interface ChoreSuggestion {
  id: string;
  emoji: string;
  title: string;
  points: number;
  frequency: ChoreSuggestionFrequency;
  target: ChoreSuggestionTarget;
}

/** 主要画面ワイヤーフレーム.md 27.2節のフィルタ選択肢（単一選択）。 */
export const CHORE_SUGGESTION_FILTERS: ("すべて" | ChoreSuggestionTarget)[] = [
  "すべて",
  "小さい子向け",
  "小学生向け",
  "だれでも",
];

export const CHORE_SUGGESTIONS: ChoreSuggestion[] = [
  { id: "quest-01", emoji: "👕", title: "ふくをたたむ", points: 10, frequency: "毎日", target: "だれでも" },
  { id: "quest-02", emoji: "🧦", title: "くつしたのペアをそろえる", points: 5, frequency: "毎日", target: "小さい子向け" },
  { id: "quest-03", emoji: "👟", title: "くつをそろえる", points: 5, frequency: "毎日", target: "小さい子向け" },
  { id: "quest-04", emoji: "🍽️", title: "しょっきをさげる", points: 10, frequency: "毎日", target: "だれでも" },
  { id: "quest-05", emoji: "🧽", title: "しょっきをあらう", points: 15, frequency: "毎日", target: "小学生向け" },
  { id: "quest-06", emoji: "🪑", title: "いすをしまう", points: 5, frequency: "毎日", target: "小さい子向け" },
  { id: "quest-07", emoji: "🗑️", title: "ごみをすてる", points: 10, frequency: "週1くらい", target: "だれでも" },
  { id: "quest-08", emoji: "🧹", title: "そうじきをかける", points: 15, frequency: "週1くらい", target: "小学生向け" },
  { id: "quest-09", emoji: "🧺", title: "せんたくものをはこぶ", points: 10, frequency: "週1くらい", target: "小さい子向け" },
  { id: "quest-10", emoji: "🛏️", title: "ふとんをたたむ・ベッドをととのえる", points: 10, frequency: "毎日", target: "だれでも" },
  { id: "quest-11", emoji: "🪥", title: "はみがきをじぶんでする", points: 5, frequency: "毎日", target: "小さい子向け" },
  { id: "quest-12", emoji: "📚", title: "よみおわった本をほんだなにもどす", points: 5, frequency: "毎日", target: "小さい子向け" },
  { id: "quest-13", emoji: "🧸", title: "おもちゃをかたづける", points: 10, frequency: "毎日", target: "小さい子向け" },
  { id: "quest-14", emoji: "🪴", title: "しょくぶつにみずをやる", points: 10, frequency: "週1くらい", target: "だれでも" },
  { id: "quest-15", emoji: "🐾", title: "ペットのごはんをあげる", points: 10, frequency: "毎日", target: "小学生向け" },
  { id: "quest-16", emoji: "🚿", title: "おふろそうじ", points: 15, frequency: "週1くらい", target: "小学生向け" },
  { id: "quest-17", emoji: "🪟", title: "まどをふく", points: 15, frequency: "たまに", target: "だれでも" },
  { id: "quest-18", emoji: "📬", title: "ポストをみにいく", points: 5, frequency: "毎日", target: "小さい子向け" },
  { id: "quest-19", emoji: "🛒", title: "かいものをてつだう", points: 15, frequency: "たまに", target: "だれでも" },
  { id: "quest-20", emoji: "🧻", title: "トイレットペーパーをつめかえる", points: 5, frequency: "たまに", target: "小学生向け" },
  { id: "quest-21", emoji: "🍳", title: "りょうりをてつだう", points: 20, frequency: "週1くらい", target: "だれでも" },
  { id: "quest-22", emoji: "🚗", title: "くるまのなかをかたづける", points: 10, frequency: "たまに", target: "だれでも" },
  { id: "quest-23", emoji: "📖", title: "しゅくだいをじぶんからやる", points: 15, frequency: "毎日", target: "小学生向け" },
  { id: "quest-24", emoji: "🎒", title: "あしたのじゅんびをする", points: 10, frequency: "毎日", target: "小学生向け" },
  { id: "quest-25", emoji: "🧴", title: "せんめんだいをふく", points: 5, frequency: "週1くらい", target: "小学生向け" },
  { id: "quest-26", emoji: "🪞", title: "じぶんのへやをかたづける", points: 15, frequency: "週1くらい", target: "だれでも" },
  { id: "quest-27", emoji: "🚙", title: "弟・妹のせわをてつだう", points: 15, frequency: "たまに", target: "小学生向け" },
];

export function findChoreSuggestionById(id: string): ChoreSuggestion | undefined {
  return CHORE_SUGGESTIONS.find((s) => s.id === id);
}
