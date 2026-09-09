import React, { useState } from "react";
import { Pressable, Text } from "react-native";
import theme from "@/theme/theme";
import { openExternalUrl } from "@/lib/externalLink";

type Tone = "parent" | "supporter";

interface ExternalLinkRowProps {
  label: string;
  url: string;
  tone?: Tone;
}

/**
 * 外部URL（使い方ガイド・プライバシーポリシー・利用規約）を開く行。
 * やること.md 2-28。**子ども向け画面には置かないこと**（宣伝部の判断。
 * 申し送り件3。子どもが外部ブラウザに出て迷子になるリスクを避けるため）。
 * app/parent/family.tsx・app/supporter/settings.tsx から利用する。
 *
 * 開けなかったときは黙って失敗せず、行の下にエラー文を表示する
 * （開発部CLAUDE.md「黙って失敗しない」要件、実装メモ.md 181章）。
 */
export default function ExternalLinkRow({ label, url, tone = "parent" }: ExternalLinkRowProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const bodyStyle = tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;

  const onPress = async () => {
    setErrorMessage(null);
    const ok = await openExternalUrl(url);
    if (!ok) {
      setErrorMessage("開けませんでした。もう一度お試しください。");
    }
  };

  return (
    <>
      <Pressable onPress={onPress} accessibilityRole="link" style={{ paddingVertical: theme.spacing.s2 }}>
        <Text style={[bodyStyle, { textDecorationLine: "underline" }]}>{label}</Text>
      </Pressable>
      {errorMessage && (
        <Text style={{ color: theme.colors.statusBlocking, marginBottom: theme.spacing.s1 }}>{errorMessage}</Text>
      )}
    </>
  );
}
