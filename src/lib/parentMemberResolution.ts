/**
 * [2026-09-29新設・本部長差し戻し（軽微変更ルート）、開発部/成果物/実装メモ.md 322章]
 * `session.tsx` の `fetchParentMember`（`family_members`への問い合わせ）の結果
 * （見つかった／0件／エラー）と、手元に同じ利用者の家族情報が既にあるか
 * （`hasHeldState`）から、`SessionStatus`・`parentMember`をどう更新するかを決める
 * 純粋関数。session.tsx から呼ぶ側の副作用（setState等）は一切持たない。
 *
 * 背景: 通信エラー（トークン自動更新直後・電波不良等）で`family_members`の
 * 問い合わせが失敗した際、従来は「0件（家族なし）」と区別せず`null`を返し、
 * 呼び出し元が一律`parentNoFamily`（家族の作成・参加・アカウント削除を案内する
 * 画面）として扱っていた。保護者が既に家族に所属しているのに、早朝の一過性の
 * 通信断だけでこの画面に落ち、「家族をつくる」「アカウントを削除する」という
 * 取り返しのつかない操作の入口に立たされてしまっていた（統括が実機で発見）。
 *
 * 判定表（確かめは `parentMemberResolution.verify.ts`）:
 *
 * | outcome    | hasHeldState | action        | 意味 |
 * |------------|-------------|---------------|------|
 * | "found"    | -           | "found"       | 問い合わせ成功・1件 → 保護者/みまもりとして更新する |
 * | "notFound" | -           | "notFound"    | 問い合わせ成功・0件 → 本当に家族なし（parentNoFamily） |
 * | "error"    | true        | "keep"        | エラーだが、同じ利用者の家族情報を既に持っている → 何も変えない（家族なし扱いに落とさない） |
 * | "error"    | false       | "unreachable" | エラーで、手元にも情報が無い（起動直後等） → 「つながりませんでした」の再試行画面へ |
 */

export type ParentMemberFetchOutcome = "found" | "notFound" | "error";

export type ParentMemberResolutionAction = "found" | "notFound" | "keep" | "unreachable";

export function resolveParentMemberFetch(
  outcome: ParentMemberFetchOutcome,
  hasHeldState: boolean
): ParentMemberResolutionAction {
  if (outcome !== "error") return outcome;
  return hasHeldState ? "keep" : "unreachable";
}
