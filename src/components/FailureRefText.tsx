import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import theme from "@/theme/theme";

/**
 * [2026-09-29新設・やること.md 4-40の残り、開発部/成果物/実装メモ.md 331章]
 * 失敗の文言の下に小さく添える「目印」（src/lib/apiFailureDisplay.tsの`ref`）。
 * 保護者・みまもりは「目印 0-net」（317章の画面と同じ見た目）、子どもは
 * 「めじるし 0-net」（ひらがな・同じ小ささ・薄いグレー）。`value`が空なら何も出さない。
 * 「エラー」「Error」の文字は出さない。
 */
export default function FailureRefText({
  value,
  tone = "parent",
  style,
}: {
  value: string | null | undefined;
  tone?: "parent" | "child" | "supporter";
  style?: StyleProp<TextStyle>;
}) {
  if (!value) return null;
  return (
    <Text
      style={[
        tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption,
        { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary },
        style,
      ]}
    >
      {tone === "child" ? "めじるし" : "目印"} {value}
    </Text>
  );
}
