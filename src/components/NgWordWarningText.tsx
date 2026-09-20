import React from "react";
import { Text } from "react-native";
import theme from "@/theme/theme";
import { NG_WORD_BLOCK_MESSAGE } from "@/lib/ngWordFilter";

type Tone = "parent" | "supporter" | "child";

/**
 * NGワードで止めたときのインライン表示（要件定義書07-32章 決定15〜19、
 * 主要画面ワイヤーフレーム.md 57.7〜57.10節）。2026-09-21新設。
 *
 * - 該当欄の直下・常駐表示。ダイアログ・スナックバー・トーストは使わない
 *   （決定11。57.8節）。呼び出し側は該当欄の直下・送信ボタンの直上あたりに
 *   このコンポーネントを置くこと（表の対応位置は57.8節参照）。
 * - 色は`color-brand-primary`。`color-status-blocking`（赤）・⚠アイコンは
 *   使わない（決定12）——通信障害のような「本当に壊れているエラー」ではなく、
 *   書き直しの依頼だから。
 * - 子どもだけ別文言、保護者・みまもりメンバーは同じ文言（決定10）。
 * - 表示・非表示の管理（何度目でも同じ文言・同じ強さで出す、決定15。文字が
 *   変わった瞬間に消す、決定14）は呼び出し側（src/hooks/useNgWordGuard.ts）
 *   の責務で、このコンポーネント自体は渡されたtoneに応じた文言を出すだけ。
 */
export default function NgWordWarningText({ tone }: { tone: Tone }) {
  const message = tone === "child" ? NG_WORD_BLOCK_MESSAGE.child : NG_WORD_BLOCK_MESSAGE.adult;
  const typographyStyle =
    tone === "parent"
      ? theme.typography.parentBody
      : tone === "supporter"
      ? theme.typography.supporterBody
      : theme.typography.childBody;

  return (
    <Text style={[typographyStyle, { color: theme.colors.brandPrimary, marginTop: theme.spacing.s2 }]}>
      {message}
    </Text>
  );
}
