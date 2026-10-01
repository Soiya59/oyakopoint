/**
 * [2026-09-30新設・主要画面ワイヤーフレーム.md 69.5節、開発部/成果物/実装メモ.md 334章]
 * 「まえのアバター」まわりの画面の文言（ロール別）。値のimportを持たない純粋な関数
 * （src/lib/avatarStockText.verify.tsで確かめる）。
 *
 * 原則（69.5節）: 機能名「まえのアバター」は全ロール共通の固定名称。子ども向けは名称も
 * ひらがな＋単語の間に空白（`まえの アバター`。既存の「ぜんぶ けす」「いろに もどす」と
 * 同じ書き方）。大人向けは漢字まじり。ボタンの動詞は子ども＝ひらがな、大人＝漢字まじり。
 * ~~「けす」は既存に合わせて全ロール共通。~~【2026-10-01】大人は「消す」（343章）。保護者が**他の人の分**（子ども・他の保護者・
 * みまもり、誰の分でも同じ扱い）を見るとき（P38代理、`isProxy`）は`{displayName}さん`を
 * 入れる（相手の立場で言い換えない）。「注意」「警告」「制限」の語は使わない。
 */

export type AvatarStockTone = "parent" | "child" | "supporter";

export interface AvatarStockText {
  heading: string;
  note: string;
  /** まえのアバターが0枚（保存済みの絵あり）のときの予告1行。 */
  emptyHint: string;
  previewText: string;
  /** 今が色＋頭文字だけで、入れ替える絵が無いとき（2文目を出さない）。 */
  previewTextNoCurrent: string;
  restoreLabel: string;
  deleteLabel: string;
  restoring: string;
  restoreSuccess: string;
  /** 「これにもどす」の成功（今の絵が無く、入れ替える絵が無かったとき。左端に入る絵は無い）。 */
  restoreSuccessNoCurrent: string;
  draftKept: string;
  /** 保存成功（前の絵はストックに入らなかった: created／unchanged）。 */
  saveSuccess: string;
  /** 保存成功（今の絵がストックに入った: stocked）。 */
  saveSuccessStocked: string;
  deleteConfirm: string;
  deleteConfirmActionLabel: string;
  deleteCancelLabel: string;
  deleting: string;
  deleteSuccess: string;
  /** いっぱいで保存できない理由（保存ボタンの上のカード）。 */
  fullReasonSave: string;
  /** いっぱいで色にもどせない理由（リンクを押すと4秒出る1行）。 */
  fullReasonReset: string;
  resetConfirm: string;
  resetSuccess: string;
  /** 「色にもどす」の成功（今の絵が既に無く、まえのアバターには何も足していないとき）。 */
  resetSuccessPlain: string;
  loadFailed: string;
  retryLabel: string;
  /** 別の端末で先に変わっていた（存在しない絵を押した）。 */
  staleGone: string;
  slotLabel: (n: number) => string;
  emptySlotLabel: string;
}

export function getAvatarStockText(args: {
  tone: AvatarStockTone;
  isProxy: boolean;
  displayName: string;
}): AvatarStockText {
  const { tone, isProxy, displayName } = args;

  if (tone === "child") {
    return {
      heading: "まえの アバター",
      note: "3まい まで とっておけるよ。じぶんと おうちの ひとだけ みえるよ",
      emptyHint: "あたらしい えを「これにする」と、いまの えが ここに のこるよ",
      previewText: "この えに もどす？ いまの えは まえの アバターに はいるよ",
      previewTextNoCurrent: "この えに もどす？",
      restoreLabel: "これに もどす",
      deleteLabel: "けす",
      restoring: "もどしています…",
      restoreSuccess: "もどったよ！さっきまでの えは ひだりはしに あるよ。まちがえたら また いれかえられるよ",
      restoreSuccessNoCurrent: "もどったよ！",
      draftKept: "かいている とちゅうの えは そのままだよ",
      saveSuccess: "あたらしい すがたに なったよ！",
      saveSuccessStocked: "あたらしい すがたに なったよ！まえの えは「まえの アバター」に のこったよ",
      deleteConfirm: "ほんとうに けす？ けした えは もどせないよ",
      deleteConfirmActionLabel: "ほんとうに けす",
      deleteCancelLabel: "やめる",
      deleting: "けしています…",
      deleteSuccess: "けしたよ",
      fullReasonSave: "まえの アバターが いっぱいです。1まい けしてから ほぞんしてね",
      // [2026-10-01変更・実装メモ343章]「いろに もどす」→「えを はずす」。
      fullReasonReset: "まえの アバターが いっぱいです。1まい けしてから えを はずしてね",
      resetConfirm: "えを はずす？ なまえの さいしょの もじに もどるよ。いまの えは まえの アバターに のこるよ",
      resetSuccess: "えを はずしたよ。まえの えは「まえの アバター」に のこったよ",
      resetSuccessPlain: "えを はずしたよ",
      loadFailed: "まえの アバターが よみこめなかったよ",
      retryLabel: "もういちど",
      staleGone: "この えは もう なくなっていたよ。ならびを なおしたよ",
      slotLabel: (n) => `まえの アバター ${n}まいめ`,
      emptySlotLabel: "からの わく",
    };
  }

  const common = {
    // [2026-10-01変更・343章] 大人は漢字（統括「大人と見守りは漢字」）。子どもは「けす」のまま。
    deleteLabel: "消す",
    deleteConfirmActionLabel: "消す",
    deleteCancelLabel: "やめる",
    deleting: "消しています…",
    deleteSuccess: "消しました",
    restoring: "戻しています…",
    retryLabel: "もういちど",
    emptySlotLabel: "空の枠",
    slotLabel: (n: number) => `まえのアバター ${n}枚目`,
    emptyHint: "「保存する」と、今の絵がここに残ります",
    loadFailed: "「まえのアバター」を読み込めませんでした",
    draftKept: "描いている途中の絵はそのままです",
  };

  if (isProxy) {
    const n = `${displayName}さん`;
    return {
      ...common,
      heading: `${n}のまえのアバター`,
      note: `${n}の絵が3枚まで残ります。表示されるのは${n}と保護者だけです`,
      previewText: `この絵を${n}のアバターに戻しますか？今の絵は「まえのアバター」に入ります`,
      previewTextNoCurrent: `この絵を${n}のアバターに戻しますか？`,
      restoreLabel: "これに戻す",
      restoreSuccess: `${n}のアバターを戻しました。これまでの絵は左端に入っています。間違えたときは、もう一度入れ替えられます`,
      restoreSuccessNoCurrent: `${n}のアバターを戻しました`,
      saveSuccess: `${n}のアバターを保存しました`,
      saveSuccessStocked: `${n}のアバターを保存しました。前の絵は「まえのアバター」に残っています`,
      deleteConfirm: `${n}のこの絵を消しますか？消すと元に戻せません`,
      fullReasonSave: `${n}の「まえのアバター」がいっぱいです。1枚消してから保存してください`,
      fullReasonReset: `${n}の「まえのアバター」がいっぱいです。1枚消してから絵をはずしてください`,
      resetConfirm: `${n}のアバターの絵をはずしますか？名前の最初の1文字の表示に戻ります。今の絵は「まえのアバター」に残ります`,
      resetSuccess: `${n}のアバターの絵をはずしました。前の絵は「まえのアバター」に残っています`,
      resetSuccessPlain: `${n}のアバターの絵をはずしました`,
      staleGone: "この絵はすでにありません。一覧を更新しました",
    };
  }

  // 保護者（本人）・みまもり（本人）。文言は同じ（69.5節「同左」）。
  return {
    ...common,
    heading: "まえのアバター",
    note: "3枚まで残せます。表示されるのは、あなたと家族の保護者だけです",
    previewText: "この絵に戻しますか？今の絵は「まえのアバター」に入ります",
    previewTextNoCurrent: "この絵に戻しますか？",
    restoreLabel: "これに戻す",
    restoreSuccess: "戻しました。これまでの絵は左端に入っています。間違えたときは、もう一度入れ替えられます",
    restoreSuccessNoCurrent: "戻しました",
    saveSuccess: "アバターを保存しました",
    saveSuccessStocked: "アバターを保存しました。前の絵は「まえのアバター」に残っています",
    deleteConfirm: "この絵を消しますか？消すと元に戻せません",
    fullReasonSave: "まえのアバターがいっぱいです。1枚消してから保存してください",
    fullReasonReset: "まえのアバターがいっぱいです。1枚消してから絵をはずしてください",
    resetConfirm: "絵をはずしますか？名前の最初の1文字の表示に戻ります。今の絵は「まえのアバター」に残ります",
    resetSuccess: "絵をはずしました。前の絵は「まえのアバター」に残っています",
    resetSuccessPlain: "絵をはずしました",
    staleGone: "この絵はすでにありません。一覧を更新しました",
  };
}
