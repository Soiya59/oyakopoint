import React from "react";
import { StyleSheet, Text, View } from "react-native";
import theme from "@/theme/theme";
import type { ApiError } from "@/data/api";
import { loadFailureDetailMessage } from "@/lib/apiFailure";
import { formatEdgeFailureRef } from "@/lib/edgeFailureRef";
import { formatPgFailureRef } from "@/lib/pgFailureRef";
import AppButton from "./AppButton";
import FailureRefText from "./FailureRefText";

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

/**
 * [2026-09-30変更・やること.md 4-40の残り、実装メモ337章] `failure`（読み込みに失敗したAPIの
 * `ApiError`）を渡すと、タイトルの下に「目印」（FailureRefTextと同じ見た目。保護者は
 * 「目印 0-net」、子どもは「めじるし 0-net」）を添え、保護者向けには電波・混み合い・
 * ログイン切れ・権限の書き分けの文（331章と同じ文言）を足す。子どもは言葉を変えず目印だけ。
 * `failure`を渡さない（未対応の画面・原因が分からない）ときは従来と同じ表示のまま。
 * 「もういちど」ボタンの動きは変えない。
 */
export function ErrorState({
  title,
  tone = "parent",
  onRetry,
  failure,
  failureSource = "pg",
}: {
  title: string;
  tone?: "parent" | "child";
  onRetry: () => void;
  failure?: ApiError | null;
  /** 失敗したAPIの経路。既定は"pg"（PostgREST・RPC）。Edge Function（inviteLookup等）のときだけ"edge"。 */
  failureSource?: "pg" | "edge";
}) {
  const bodyStyle = tone === "child" ? theme.typography.childBody : theme.typography.parentBody;
  const detail = failure ? loadFailureDetailMessage(tone, failure, failureSource) : null;
  const ref = failure ? (failureSource === "edge" ? formatEdgeFailureRef(failure) : formatPgFailureRef(failure)) : null;
  return (
    <View style={styles.center}>
      <Text style={styles.emoji}>{tone === "child" ? "🌧️" : "⚠️"}</Text>
      <Text style={[bodyStyle, styles.text]}>{title}</Text>
      {detail ? <Text style={[bodyStyle, styles.text, { marginTop: theme.spacing.s2 }]}>{detail}</Text> : null}
      <FailureRefText value={ref} tone={tone} style={styles.refText} />
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
  refText: { textAlign: "center" },
  skeleton: {
    backgroundColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentLg,
    opacity: 0.6,
  },
});
