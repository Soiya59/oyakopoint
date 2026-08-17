import React from "react";
import { StyleSheet, Text, View } from "react-native";
import theme from "@/theme/theme";
import AppButton from "./AppButton";

/**
 * 空状態・読み込み中・通信エラーの共通表現。
 * 主要画面ワイヤーフレーム.md 6章「実装メモ」:
 * 「空状態は常にポジティブなイラスト/絵文字、エラー状態は『もういちど』ボタンを
 *  必ず伴う、という区別をコンポーネントレベルで固定する」に対応。
 */

export function EmptyState({
  emoji = "🌱",
  title,
  tone = "parent",
}: {
  emoji?: string;
  title: string;
  tone?: "parent" | "child";
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.emoji}>{emoji}</Text>
      <Text
        style={[
          tone === "child" ? theme.typography.childBody : theme.typography.parentBody,
          styles.text,
        ]}
      >
        {title}
      </Text>
    </View>
  );
}

export function ErrorState({
  title,
  tone = "parent",
  onRetry,
}: {
  title: string;
  tone?: "parent" | "child";
  onRetry: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.emoji}>{tone === "child" ? "🌧️" : "⚠️"}</Text>
      <Text
        style={[
          tone === "child" ? theme.typography.childBody : theme.typography.parentBody,
          styles.text,
        ]}
      >
        {title}
      </Text>
      <AppButton label="もういちど" onPress={onRetry} tone={tone} style={{ marginTop: theme.spacing.s4 }} />
    </View>
  );
}

export function SkeletonBlock({ height = 72 }: { height?: number }) {
  return <View style={[styles.skeleton, { height }]} />;
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <View style={{ gap: theme.spacing.s3 }}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonBlock key={i} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing.s8,
    paddingHorizontal: theme.spacing.s4,
  },
  emoji: { fontSize: 40, marginBottom: theme.spacing.s2 },
  text: { textAlign: "center", color: theme.colors.neutralTextSecondary },
  skeleton: {
    backgroundColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentLg,
    opacity: 0.6,
  },
});
