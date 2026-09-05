import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { EmptyState } from "@/components/StatusViews";
import ScreenBackLink from "@/components/ScreenBackLink";
import ReportCelebration from "@/components/ReportCelebration";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { isWithinCancelWindow } from "@/lib/calendarDates";
import {
  CANCEL_LABEL,
  CANCEL_PROCESSING_TEXT,
  CANCEL_SUCCESS_TEXT,
  cancelCompletionErrorText,
} from "@/lib/cancelChoreCompletion";

/**
 * S5 自分専用のお手伝い一覧（みまもりメンバー）
 * 参照: 画面一覧・遷移図.md 2.5節S5、API仕様.md 3b章
 *
 * 自分が登録した自分専用chore（scope='personal', created_by=自分）を一覧し、
 * 新規登録（→S6）・完了報告（→S7）・編集（→S6）への入口にする。
 *
 * [2026-08-23改訂・5回目のスコープ変更] 自分専用choreは家族全員に公開される方針へ
 * 反転したため（`chores_select_scoped`は`family_id`一致のみで判定する）、
 * `state.chores`には他のみまもりメンバーが登録した自分専用choreも含まれるように
 * なった。ユーザーの発言「個人の登録したものが上位に登場し、他のお手伝いも参考に
 * できる」を踏まえ、上段＝自分の登録分（フル操作）、下段＝他のみまもりメンバーの
 * 登録分（登録者名付き・閲覧専用、編集・完了報告の導線なし）という2段構成にした
 * （画面一覧・遷移図.md S5行）。編集・完了報告できるのはクライアント側の表示制御では
 * なく、`chores_write_personal_by_creator`・`chore_completions_insert_self`RLSに
 * よって作成者本人に限定される。
 */
export default function SupporterMyChoresScreen() {
  const { state, isChoreLimitReached, isOneOffFinished, dispatch } = useAppData();
  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  // [2026-08-27修正・本部長] 実施済みの「単発」は除く（app/child/(tabs)/home.tsxと同じ理由）。
  // 自分の分も他の人の分も、役目を終えた単発は一覧から外す。
  const personalChores = state.chores.filter(
    (c) => c.is_active && c.scope === "personal" && !isOneOffFinished(c)
  );
  const myChores = personalChores.filter((c) => c.created_by === me?.id);
  const othersChores = personalChores.filter((c) => c.created_by && c.created_by !== me?.id);

  const othersByCreator = othersChores.reduce<Record<string, typeof othersChores>>((acc, c) => {
    const key = c.created_by as string;
    (acc[key] ??= []).push(c);
    return acc;
  }, {});
  const creatorOf = (id: string) => state.members.find((m) => m.id === id);

  // [2026-09-06追加] 要件定義書07-17章「完了報告の直後の取消」・UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 28.11節・28.11.2節「さっきの記録」。決定9のとおり
  // P19（app/parent/my-chores.tsx）と完全に同一のロジック。データソースは
  // state.completions（既に取得済み）のみで、新しい通信は発生させない。
  // 1分の経過でリンクごと消すため、表示中は10秒間隔で再評価する（28.0節決定4）。
  const [, setCancelTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCancelTick((n) => n + 1), 10_000);
    return () => clearInterval(t);
  }, []);

  const recentSelfCompletions = state.completions
    .filter((c) => !!me && c.reported_by === me.id && isWithinCancelWindow(c.reported_at))
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime());

  const [cancelingCompletionId, setCancelingCompletionId] = useState<string | null>(null);
  const [cancelRowError, setCancelRowError] = useState<{ id: string; message: string } | null>(null);
  const [cancelFlashMessage, setCancelFlashMessage] = useState<string | null>(null);

  // 新設ブロックに現れるのは常に自分自身の報告のみのため、確認ダイアログは挟まず
  // 即時実行する（28.0節決定5・28.11節決定14）。
  const handleCancelRecentCompletion = async (completionId: string) => {
    setCancelingCompletionId(completionId);
    setCancelRowError(null);
    const result = await dispatch({ type: "CANCEL_COMPLETION", completionId });
    setCancelingCompletionId(null);
    if (!result.ok) {
      setCancelRowError({ id: completionId, message: cancelCompletionErrorText("supporter", result.error) });
      return;
    }
    setCancelFlashMessage(CANCEL_SUCCESS_TEXT.supporter);
    setTimeout(() => setCancelFlashMessage(null), 1500);
  };

  // [2026-08-30追加・本部長] S7（app/supporter/chore-report.tsx）は報告成功後、
  // 保護者側と同じく justChoreId/justTitle/justPoints を付けてこの画面へ戻していたが、
  // **この画面がそのパラメータを一度も読んでいなかった**ため、みまもりメンバーは
  // 報告しても何の確認表示も出ないままだった（保護者版P19にはバナーがあった）。
  // お祝いポップアップの導入にあわせて、受け取り側を実装して差を解消する。
  const params = useLocalSearchParams<{ justChoreId?: string; justTitle?: string; justPoints?: string }>();
  const [celebration, setCelebration] = useState<{ title: string; points: string } | null>(null);

  useEffect(() => {
    if (params.justChoreId && params.justTitle && params.justPoints) {
      setCelebration({ title: params.justTitle, points: params.justPoints });
    }
  }, [params.justChoreId, params.justTitle, params.justPoints]);

  return (
    // お祝いポップアップをScreen（内部はScrollView）の外側に重ねる理由は
    // app/parent/my-chores.tsx と同じ。
    <View style={{ flex: 1 }}>
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" onPress={() => router.replace("/supporter/home")} />
      <View style={styles.header}>
        <Text style={theme.typography.supporterTitle}>🎯 じぶんのクエスト</Text>
        <AppButton tone="supporter" label="＋ 新規" variant="secondary" onPress={() => router.push("/supporter/chore-edit")} />
      </View>
      <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        ダイエット・運動・勉強など、じぶんの目標を登録できます。完了報告には通常どおりポイントが付きます。ここに登録したクエストは家族みんなに見えます。
      </Text>

      {/* [2026-09-06追加] 28.11.2節「さっきの記録」。決定9のとおりP19と完全に同一の
          設計。該当が無ければブロックごと出さない。既存の2段構成より上に置く（決定12）。 */}
      {recentSelfCompletions.length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          <Text style={[theme.typography.supporterBodyMedium, styles.sectionHeading]}>さっきの記録</Text>
          {recentSelfCompletions.map((c) => (
            <Card key={c.id} tone="supporter" style={styles.recentRow}>
              <View style={styles.recentRowMain}>
                <Text style={{ fontSize: 20 }}>{c.chore_emoji}</Text>
                <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>
                  {c.chore_title}
                </Text>
                <Text style={theme.typography.supporterBodyMedium}>+{c.points}pt</Text>
                <Pressable
                  onPress={() => handleCancelRecentCompletion(c.id)}
                  disabled={cancelingCompletionId === c.id}
                  hitSlop={8}
                  style={{ marginLeft: theme.spacing.s3 }}
                >
                  <Text style={styles.cancelLink}>
                    {cancelingCompletionId === c.id ? CANCEL_PROCESSING_TEXT.supporter : CANCEL_LABEL.supporter}
                  </Text>
                </Pressable>
              </View>
              {cancelRowError?.id === c.id && (
                <Text style={[theme.typography.supporterCaption, styles.cancelRowError]}>
                  {cancelRowError.message}
                </Text>
              )}
            </Card>
          ))}
          {cancelFlashMessage && <Text style={styles.cancelFlash}>{cancelFlashMessage}</Text>}
        </View>
      )}

      {myChores.length === 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <EmptyState emoji="🎯" title="まだクエストが登録されていません" />
        </View>
      )}

      {myChores.length > 0 && (
        <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
          {myChores.map((c) => {
            const done = me ? isChoreLimitReached(c, me.id) : false;
            return (
              <Card key={c.id} tone="supporter" style={{ ...styles.row, backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent }}>
                <Pressable
                  disabled={done || !me}
                  onPress={() => router.push({ pathname: "/supporter/chore-report", params: { choreId: c.id } })}
                  style={styles.rowMain}
                >
                  <Text style={{ fontSize: 20 }}>{c.emoji}</Text>
                  <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>{c.title}</Text>
                  {done ? (
                    <Text style={styles.doneLabel}>きろくずみ</Text>
                  ) : (
                    <Text style={theme.typography.supporterBodyMedium}>+{c.points}pt</Text>
                  )}
                </Pressable>
                <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
                  <Text style={styles.publicLabel}>👀 家族に公開中</Text>
                  <Text style={{ flex: 1 }} />
                  <Pressable onPress={() => router.push({ pathname: "/supporter/chore-edit", params: { id: c.id } })}>
                    <Text style={styles.editLink}>編集する</Text>
                  </Pressable>
                </View>
              </Card>
            );
          })}
        </View>
      )}

      {Object.keys(othersByCreator).length > 0 && (
        <>
          <Text style={[theme.typography.supporterBodyMedium, { marginTop: theme.spacing.s6 }]}>
            かぞくのほかのみまもりメンバーのクエスト
          </Text>
          <Text style={[theme.typography.supporterCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
            みんなの参考にどうぞ。ここから直接完了報告や編集はできません。
          </Text>
          <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
            {Object.entries(othersByCreator).map(([creatorId, chores]) => {
              const creator = creatorOf(creatorId);
              return (
                <Card key={creatorId} tone="supporter" style={styles.refRow}>
                  <Text style={theme.typography.supporterBodyMedium}>{creator?.display_name ?? "みまもりメンバー"}</Text>
                  <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
                    {chores.map((c) => (
                      <View key={c.id} style={styles.refItem}>
                        <Text style={{ fontSize: 16 }}>{c.emoji}</Text>
                        <Text style={[theme.typography.supporterBody, { flex: 1, marginLeft: theme.spacing.s2 }]}>{c.title}</Text>
                        <Text style={theme.typography.supporterCaption}>+{c.points}pt</Text>
                      </View>
                    ))}
                  </View>
                </Card>
              );
            })}
          </View>
        </>
      )}

      <AppButton tone="supporter" label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/supporter/home")} />
    </Screen>

    {celebration && (
      <ReportCelebration
        tone="supporter"
        title={celebration.title}
        points={celebration.points}
        memberId={state.activeParentMemberId}
        onDismiss={() => setCelebration(null)}
      />
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  row: {},
  rowMain: { flexDirection: "row", alignItems: "center" },
  doneLabel: { color: theme.colors.neutralTextSecondary },
  editLink: { color: theme.colors.supporterAccent, fontWeight: "700" },
  publicLabel: { color: theme.colors.neutralTextSecondary, fontSize: 12 },
  refRow: { backgroundColor: theme.colors.neutralSurface },
  refItem: { flexDirection: "row", alignItems: "center" },
  // [2026-09-06追加] 28.11.2節「さっきの記録」。背景色は通常のカードと同系色にとどめ、
  // 新着・警告を示す強い色は使わない（28.11.3節トーン設計メモ）。
  sectionHeading: { color: theme.colors.neutralTextSecondary },
  recentRow: {},
  recentRowMain: { flexDirection: "row", alignItems: "center" },
  cancelLink: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  cancelRowError: { marginTop: theme.spacing.s1, color: theme.colors.statusBlocking },
  cancelFlash: { textAlign: "center", color: theme.colors.neutralTextSecondary },
});
