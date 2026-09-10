/**
 * 「同じクエスト・同じごほうび」が人数分並ぶのを折りたたむためのグルーピング純粋関数。
 * 参照: 要件定義書07-24章（決定1・3・4・8・9・10）、主要画面ワイヤーフレーム.md 38章
 * （決定1〜7）。開発部/成果物/実装メモ.md 193章。
 *
 * 画面（app/parent/chores.tsx・app/parent/rewards.tsx）に依存しない純粋関数として
 * 切り出してある。理由と検証方法は同ディレクトリの groupDuplicateRows.verify.ts
 * 冒頭コメント、および src/lib/simplifyPolyline.ts / simplifyPolyline.verify.ts の
 * 前例を参照。
 *
 * [対象外・触らないもの]
 * - 名前・ポイントの表記ゆれの吸収（07-24章決定1「今回は対象外」）
 * - グループの一括編集・一括削除（主要画面ワイヤーフレーム.md 38.3節決定3）
 * - 「わたしが登録」「かぞくが登録」「終わった単発のクエスト」など区分をまたいだ
 *   グルーピング（07-24章決定6・主要画面ワイヤーフレーム.md 38.2節）。
 *   呼び出し側が区分ごとに配列を分けたうえで、区分ごとにこの関数を呼ぶこと。
 */

/** グルーピング対象の行が最低限持つべき形。assigned_to はクエスト・ごほうび共通の列名。 */
export interface AssignableRow {
  assigned_to: string | null;
}

/** 内訳の並び順（決定9）を決めるための、担当者側の最小情報。 */
export interface MemberOrderInput {
  id: string;
  created_at: string;
}

export interface RowGroup<T> {
  /** keyOf() が返したキー。同じキーの行が2件以上あれば items.length >= 2 になる。 */
  key: string;
  /**
   * このグループを構成する行。
   * - items.length === 1 のとき: 単独行（折りたたみ見出しにしない、決定4）
   * - items.length >= 2 のとき: 折りたたみ対象。担当者の created_at 昇順、
   *   「誰でも」（assigned_to === null）は先頭（決定9）に既に並べ替え済み。
   */
  items: T[];
}

/**
 * rows を keyOf() の戻り値でグルーピングする。
 *
 * - グループの出現順は「そのキーが rows の中で最初に登場した位置」を保つ（決定8）。
 *   rows 自体の並びを変えたり、グループを先頭・末尾へ寄せたりはしない（決定10）。
 * - 各グループ内の並び順は members（あらかじめソートされている必要はない。本関数が
 *   created_at 昇順に並べ替える）を基準に、担当者の created_at 昇順、
 *   「誰でも」（assigned_to === null）を先頭に置く（決定9）。
 * - keyOf() が同じでも assigned_to が異なる行は同じグループに含める（決定3）。
 */
export function groupDuplicateRows<T extends AssignableRow>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  members: readonly MemberOrderInput[]
): RowGroup<T>[] {
  const sortedMembers = [...members].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0
  );
  const memberOrderIndex = new Map<string, number>();
  sortedMembers.forEach((m, idx) => memberOrderIndex.set(m.id, idx));

  const keyOrder: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
      keyOrder.push(key);
    }
    bucket.push(row);
  }

  return keyOrder.map((key) => {
    const bucket = buckets.get(key);
    if (!bucket) {
      throw new Error(`groupDuplicateRows: internal error, missing bucket for key "${key}"`);
    }
    if (bucket.length < 2) {
      return { key, items: bucket };
    }
    const assigneeRank = (row: T): number => {
      if (row.assigned_to === null) return -1;
      const idx = memberOrderIndex.get(row.assigned_to);
      return idx === undefined ? Number.MAX_SAFE_INTEGER : idx;
    };
    const sorted = [...bucket].sort((a, b) => assigneeRank(a) - assigneeRank(b));
    return { key, items: sorted };
  });
}

/** 一覧行の右側テキストに追記する担当者名の解決に使う、最小限のメンバー情報。 */
export interface DisplayableMember {
  id: string;
  display_name: string;
}

/**
 * 担当者名の表示文言を解決する（主要画面ワイヤーフレーム.md 38.5節決定4・38.6節決定7）。
 *
 * - assignedTo が null（誰でもOK）のときは everyoneLabel をそのまま返す
 *   （P10は「誰でも実行可」、P12は「誰でも交換可」。呼び出し側が渡す）。
 * - assignedTo が非nullで members の中に見つかれば display_name を返す。
 * - assignedTo が非nullで members の中に見つからない場合（想定外。ソフト削除された
 *   メンバーは通常 members 配列に残り続けるため、通常は起こらない）は null を返す。
 *   呼び出し側はこの場合、担当者名の追記自体を省略する（誤った文言を出さないため）。
 */
export function resolveAssigneeLabel(
  assignedTo: string | null,
  members: readonly DisplayableMember[],
  everyoneLabel: string
): string | null {
  if (assignedTo === null) return everyoneLabel;
  const member = members.find((m) => m.id === assignedTo);
  return member ? member.display_name : null;
}
