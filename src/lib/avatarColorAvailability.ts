/**
 * メンバーカラーの重複防止ロジック（P14「設定」・P15「子どもプロフィール追加」共通）。
 * 参照: 主要画面ワイヤーフレーム.md 25.3節「重複判定の共通ロジック」。
 *
 * 規則は1つだけ:
 *   使用中＝在籍中（is_active=true）の家族メンバーのうち、編集・作成対象の
 *   本人以外が、その色をavatar_colorとして持っている状態。
 *
 * - 対象は「在籍中」のみ。退会済みメンバーが持っていた色は対象に含めない
 *   （25.0決定4、開発部/成果物/実装メモ.md 99.2章）。
 * - P14（既存メンバーの変更）では excludeMemberId にカードを開いている
 *   そのメンバー自身のIDを渡す（自分の今の色は使用中の判定から除外する）。
 * - P15（新規メンバーの作成）では excludeMemberId に null を渡す
 *   （対象の本人がまだ存在しないため、在籍中の全メンバーの色が使用中になる）。
 *
 * 表現の食い違いを防ぐため、P14・P15はこの1つの関数を必ず経由すること
 * （同じ判定を2回書かない。ワイヤーフレーム.md 25.3節）。
 */

export interface AvatarColorMember {
  id: string;
  display_name: string;
  avatar_color: string | null;
  is_active: boolean;
}

export interface AvatarColorOption {
  name: string;
  value: string;
  /** 使用中の在籍中メンバーの表示名。使用中でなければnull。 */
  usedByName: string | null;
}

/**
 * パレットの各色について、在籍中の他メンバーによる使用状況を解決する。
 *
 * @param palette メンバーカラーパレット（theme.memberColorPalette）
 * @param members 家族の全メンバー（is_active問わず。関数側で絞り込む）
 * @param excludeMemberId 編集・作成対象本人のID。新規作成時はnull
 */
export function resolveAvatarColorOptions(
  palette: readonly { name: string; value: string }[],
  members: readonly AvatarColorMember[],
  excludeMemberId: string | null
): AvatarColorOption[] {
  const activeOthers = members.filter((m) => m.is_active && m.id !== excludeMemberId);

  return palette.map((c) => {
    const user = activeOthers.find((m) => m.avatar_color === c.value);
    return { name: c.name, value: c.value, usedByName: user ? user.display_name : null };
  });
}

/** 選べる色（使用中でない色）が1つも無いかどうか。 */
export function hasNoSelectableColor(options: AvatarColorOption[]): boolean {
  return options.every((o) => o.usedByName !== null);
}
