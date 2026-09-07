/**
 * クエストのおすすめ集（要件定義書.md 07-16章、2026-09-02追加）の静的データ。
 * アプリ内定数としてのみ保持し、DBには一切保存しない（07-16章6.「一覧の保存先」）。
 *
 * 【2026-09-07全面差し替え】18件は`市場調査部/成果物/クエスト・ごほうびのおすすめ集の調査
 * （2026-09-07）.md`2章の表を一次情報として転記したもの。従来の27件（企画部の案出しの
 * みで、実証的な裏付けを持たなかった）を破棄し、AAP（米国小児科学会）・クリーブランド・
 * クリニックの年齢別お手伝い一覧に根拠を持つ項目のみへ入れ替えた（本部長・統括承認、
 * 2026-09-07）。掲載順も調査レポート2章の表の掲載順（#1〜#18）のまま。
 *
 * `points`は調査レポート表の「参考pt」列をそのまま採用（1pt=ルーチン12件、2pt=たまに6件）。
 * `frequency`・`target`は調査レポートの列をそのまま使える形ではなかったため、開発部の判断で
 * 現行の型定義（3区分ずつ）へ丸めた。判断の詳細は`開発部/成果物/実装メモ.md`148章を参照。
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
 *   呼び出し側（P11）が常に`isRepeatable=true`・`dailyLimit`未指定として扱う。この方針は
 *   2026-09-07の差し替えでも変更していない。
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
  { id: "quest-01", emoji: "🧸", title: "あそんだあとのかたづけ", points: 1, frequency: "毎日", target: "小さい子向け" },
  { id: "quest-02", emoji: "🪴", title: "しょくぶつにみずをやる", points: 1, frequency: "週1くらい", target: "小さい子向け" },
  { id: "quest-03", emoji: "🛏️", title: "ふとん・ベッドをととのえる", points: 1, frequency: "毎日", target: "小さい子向け" },
  { id: "quest-04", emoji: "🍽️", title: "しょっきをさげる", points: 1, frequency: "毎日", target: "だれでも" },
  { id: "quest-05", emoji: "🧦", title: "せんたくものをしわけする", points: 1, frequency: "毎日", target: "だれでも" },
  { id: "quest-06", emoji: "🗑️", title: "ごみをあつめてだす", points: 1, frequency: "毎日", target: "だれでも" },
  { id: "quest-07", emoji: "📬", title: "ポストをみにいく", points: 1, frequency: "毎日", target: "だれでも" },
  { id: "quest-08", emoji: "📚", title: "おもちゃ・本をたなにもどす", points: 1, frequency: "毎日", target: "だれでも" },
  { id: "quest-09", emoji: "🪟", title: "つくえ・たなのほこりをはらう", points: 1, frequency: "週1くらい", target: "だれでも" },
  { id: "quest-10", emoji: "🍂", title: "おちばあつめ・くさとり（そとしごと）", points: 2, frequency: "たまに", target: "だれでも" },
  { id: "quest-11", emoji: "🧹", title: "そうじきがけ・ゆかそうじ", points: 2, frequency: "週1くらい", target: "小学生向け" },
  { id: "quest-12", emoji: "🍳", title: "ゆうしょくづくりをてつだう", points: 2, frequency: "週1くらい", target: "小学生向け" },
  { id: "quest-13", emoji: "🐕", title: "ペットのさんぽ", points: 2, frequency: "週1くらい", target: "小学生向け" },
  { id: "quest-14", emoji: "🧺", title: "せんたくものをたなにしまう", points: 1, frequency: "毎日", target: "小学生向け" },
  { id: "quest-15", emoji: "🛒", title: "かいものぶくろのなかみをせいりする", points: 1, frequency: "たまに", target: "小学生向け" },
  { id: "quest-16", emoji: "🍽️", title: "しょっきあらいきにいれる・だす", points: 1, frequency: "毎日", target: "小学生向け" },
  { id: "quest-17", emoji: "🚿", title: "おふろそうじ", points: 2, frequency: "週1くらい", target: "小学生向け" },
  { id: "quest-18", emoji: "🍳", title: "かんたんなりょうりをつくる（見守りつき）", points: 2, frequency: "週1くらい", target: "小学生向け" },
];

export function findChoreSuggestionById(id: string): ChoreSuggestion | undefined {
  return CHORE_SUGGESTIONS.find((s) => s.id === id);
}
