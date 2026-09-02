/**
 * 実施履歴カレンダー（要件定義書07-3章、P18/C15）向けの日付ユーティリティ。
 *
 * スキーマ設計.sql 5a章のchore_completions_before_insertトリガーが
 * `(now() AT TIME ZONE 'Asia/Tokyo')::date` でJST日付を基準にしているのと同じ考え方を
 * クライアント側でも一貫させるため、日付計算は必ずこのファイルの関数を経由する
 * （src/data/store.tsx の toJstDateString と同じロジック。二重定義を避けるためこちらに集約）。
 */

/** ISO日時文字列をJST基準の "YYYY-MM-DD" に変換する。 */
export function toJstDateString(isoString: string | Date): string {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const date = typeof isoString === "string" ? new Date(isoString) : isoString;
  // "sv-SE"ロケールは "YYYY-MM-DD" 形式を返すため、そのまま使う。
  return formatter.format(date);
}

/** 現在時刻のJST基準の "YYYY-MM-DD"。週間バー・月間カレンダーの初期表示に使う。 */
export function getJstToday(): string {
  return toJstDateString(new Date());
}

/** "YYYY-MM-DD" 文字列に日数を加減算した新しい "YYYY-MM-DD" を返す（JSTの暦日単位）。 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  // UTC正午を基準にすることでタイムゾーンによる日またぎのずれを避ける。
  const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  base.setUTCDate(base.getUTCDate() + days);
  const yyyy = base.getUTCFullYear();
  const mm = String(base.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(base.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/** 週間バー: 直近7日分（6日前〜今日）の日付文字列を古い順で返す。 */
export function getPastWeekDates(referenceDateStr: string = getJstToday()): string[] {
  return Array.from({ length: 7 }, (_, i) => addDaysToDateString(referenceDateStr, i - 6));
}

/** "YYYY-MM-DD" から曜日インデックス（0=月〜6=日）を返す（月曜始まりのカレンダー表示用）。 */
export function getWeekdayMonFirst(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const jsDay = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay(); // 0=日〜6=土
  return (jsDay + 6) % 7; // 0=月〜6=日
}

/**
 * 家族の木「週ごとの記録」（要件定義書07-9章新設節、20.1a節）向け。
 * DB側の `jst_week_start_date()`（スキーマ設計.sql 13a章。JST月曜0:00始まりの暦週）と
 * 完全に同じロジックをクライアント側で再現する（今週・先週の相対呼称ラベルを付けるため、
 * 「今日を含む週の開始日」「先週の開始日」をクライアント側でも算出する必要がある）。
 * `getWeekdayMonFirst`（0=月〜6=日）は既にISODOW-1と同じ値のため、そのまま流用する。
 */
export function getJstWeekStartDate(dateStr: string): string {
  return addDaysToDateString(dateStr, -getWeekdayMonFirst(dateStr));
}

/** 現在時刻（JST基準）を含む週の開始日（月曜、"YYYY-MM-DD"）。 */
export function getCurrentJstWeekStart(): string {
  return getJstWeekStartDate(getJstToday());
}

/**
 * 月間カレンダー: 指定した年月（1-12）の週グリッドを返す（月曜始まり）。
 * 月初/月末の空白セルは null で埋める。family-todoのWeeklyStatus.tsxが持つ
 * 「月間カレンダーに展開」表現の元になるデータ構造。
 */
export function getMonthGrid(year: number, month: number): (string | null)[][] {
  const firstDateStr = `${year}-${String(month).padStart(2, "0")}-01`;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const leadingBlanks = getWeekdayMonFirst(firstDateStr);

  const cells: (string | null)[] = Array.from({ length: leadingBlanks }, () => null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 月間カレンダーの前後月ナビゲーション用。 */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

export const WEEKDAY_LABELS_JA = ["月", "火", "水", "木", "金", "土", "日"] as const;
export const WEEKDAY_LABELS_JA_KANA = ["げつ", "か", "すい", "もく", "きん", "ど", "にち"] as const;

/** "YYYY-MM-DD" から「M月D日」形式の文字列を作る（保護者向け）。 */
export function formatDateJp(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}月${d}日`;
}

/** "YYYY-MM-DD" から「Mがつdにち」形式の文字列を作る（子ども向け、ひらがな中心。デザイントークン.md 2章）。 */
export function formatDateChildJp(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}がつ${d}にち`;
}

/**
 * "YYYY-MM-DD" から「M/D」形式の文字列を作る。
 * [2026-08-20追加・本部長] app/child/family-activity.tsx（41章）の日付表示で
 * 当初formatDateChildJpを使っていたが、ユーザーから「ひらがなでなく8/20という
 * 表示にしてほしい」との依頼があり新設した。app/child/gratitude.tsxの
 * 送受信履歴にも同じ理由で日付を追加する際に流用する。
 */
export function formatDateShort(dateStr: string): string {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

/**
 * ISO日時から「HH:MM」を作る（JST固定）。
 * [2026-09-01追加・本部長] 各画面が `toLocaleTimeString("ja-JP", ...)` を直に呼んでおり、
 * 端末のタイムゾーンに依存していた。本ファイル冒頭の方針（日付計算はJSTで一貫させる）から
 * 外れるため、時刻もここに集約する。
 */
export function formatTimeShort(isoString: string | Date): string {
  const date = typeof isoString === "string" ? new Date(isoString) : isoString;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

/** ISO日時から「M/D HH:MM」を作る（JST固定）。一覧カードの既定書式。 */
export function formatDateTimeShort(isoString: string | Date): string {
  return `${formatDateShort(toJstDateString(isoString))} ${formatTimeShort(isoString)}`;
}

/**
 * ISO日時から「YYYY年M月D日 HH:MM」を作る（JST固定）。詳細画面用。
 * 一覧は年を省いて「M/D HH:MM」だが、詳細は1件を確かめる場面なので年まで出す。
 */
export function formatDateTimeFullJp(isoString: string | Date): string {
  const [y, m, d] = toJstDateString(isoString).split("-").map(Number);
  return `${y}年${m}月${d}日 ${formatTimeShort(isoString)}`;
}
