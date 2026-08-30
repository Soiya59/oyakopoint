import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import ScreenBackLink from "@/components/ScreenBackLink";
import ReportCelebration from "@/components/ReportCelebration";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";

/**
 * P19 じぶんのお手伝い一覧（保護者、要件定義書07-4章「親の完了報告」）
 * 参照: 主要画面ワイヤーフレーム.md 9.1章、画面一覧・遷移図.md P19・3.9章
 *
 * 自分が担当（assigned_to=自分）、または誰でも実行可（assigned_to=NULL）なchoreを
 * 行形式のリストで一覧する。C5の保護者版だが、絵文字グリッド・達成演出は使わず
 * 「淡々とした記録」トーン（9.0決定1）にする。
 *
 * API仕様.md 4b章のとおり、chore/chore_completionsのAPI自体はC5/C6と全く同じもの
 * （スキーマ設計.sql 12章「構造変更なし」）。choreの取得クエリはuseAppData()の
 * 既存state.choresをそのまま流用し、reported_by=自分のmember_idでREPORT_COMPLETIONを
 * dispatchするだけでよい。
 */
type LoadState = "loading" | "error" | "ready";

export default function ParentMyChoresScreen() {
  const { state, isChoreLimitReached, isOneOffFinished, dispatch } = useAppData();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  // [2026-08-16] P20からの復帰時のみ一時的に表示する、控えめな確認表示（スナックバー）。
  // 主要画面ワイヤーフレーム.md 9.2章「送信成功時の表現（新規画面を作らない）」対応。
  // ナビゲーションパラメータを「一度きりの合図」として使うパターンは、既存のC6→C7
  // （choreTitle/points）やP15（stepパラメータ）と同じ設計方針を踏襲した。
  const params = useLocalSearchParams<{ justChoreId?: string; justTitle?: string; justPoints?: string }>();
  const [snackbar, setSnackbar] = useState<{ choreId: string; title: string; points: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setLoadState("ready"), 350);
    return () => clearTimeout(t);
  }, []);

  // [2026-08-30変更・本部長] 従来はここで1.5秒のタイマーを持ち、細い帯を出していた。
  // お祝いポップアップ（ReportCelebration）へ差し替えたので、いつ閉じるかの管理は
  // ポップアップ側へ移した（3秒で自動／×／背面タップ）。ここは合図を受け取るだけ。
  // 該当行のハイライトは従来どおりお祝いと同時に消える（同じstateを見ているため）。
  useEffect(() => {
    if (params.justChoreId && params.justTitle && params.justPoints) {
      setSnackbar({ choreId: params.justChoreId, title: params.justTitle, points: params.justPoints });
    }
  }, [params.justChoreId, params.justTitle, params.justPoints]);

  const me = state.members.find((m) => m.id === state.activeParentMemberId);
  // [2026-08-27修正・本部長] 実施済みの「単発」は除く（app/child/(tabs)/home.tsxと同じ理由）。
  // ここは「これからやる」ための一覧なので、役目を終えた単発が残っていても押せないだけで邪魔になる。
  // 管理用の一覧（P10 app/parent/chores.tsx）では折りたたみセクションとして引き続き確認できる。
  const myChores = state.chores.filter(
    (c) => c.is_active && (c.assigned_to === null || c.assigned_to === me?.id) && !isOneOffFinished(c)
  );

  // [2026-08-22追加] app/child/(tabs)/home.tsxと同じ理由・同じ仕組み（chore_daily_flags）。
  // 「まいにち」は個人設定のため、子ども・保護者それぞれが自分の画面から独立に設定できる。
  const toggleDaily = (choreId: string, flagged: boolean) => {
    if (!me) return;
    void dispatch({ type: "SET_DAILY_FLAG", memberId: me.id, choreId, flagged });
  };

  return (
    // [2026-08-30] お祝いポップアップはScreenの**外側**に置く。Screenの中身はScrollViewの
    // 内側にあるため、そこへ絶対配置してもスクロール内容基準になってしまい、画面中央に
    // 固定できない。ここでflex:1のViewを一枚かぶせ、その基準で全面に重ねる。
    <View style={{ flex: 1 }}>
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/home")} />
      <Text style={theme.typography.parentTitle}>じぶんのクエスト</Text>


      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <SkeletonList count={4} />
        </View>
      )}

      {loadState === "error" && (
        <ErrorState title="読み込みに失敗しました" onRetry={() => setLoadState("ready")} />
      )}

      {loadState === "ready" && myChores.length === 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <EmptyState emoji="🧺" title="じぶんの担当のクエストはまだ登録されていません" />
          <AppButton
            label="クエスト管理で追加する"
            variant="secondary"
            style={{ marginTop: theme.spacing.s2 }}
            onPress={() => router.push("/parent/chore-edit")}
          />
        </View>
      )}

      {/* [2026-08-20修正・本部長] 未実施・きろくずみが入り混じって表示され見分けにくいと
          ユーザーが実機で発見したため、見出しで2群に分けた（並び順自体は変更していない）。
          [2026-08-22追加] app/child/(tabs)/home.tsxと同じ理由で、「まいにち」設定分を
          専用セクションに切り出した（残りは従来どおり未実施/きろくずみで分ける）。 */}
      {loadState === "ready" && myChores.length > 0 && (() => {
        const withDaily = myChores.map((c) => ({
          chore: c,
          done: me ? isChoreLimitReached(c, me.id) : false,
          isDaily: state.dailyFlaggedChoreIds.includes(c.id),
        }));
        const daily = withDaily.filter((x) => x.isDaily);
        const rest = withDaily.filter((x) => !x.isDaily);
        const todo = rest.filter((x) => !x.done);
        const done = rest.filter((x) => x.done);
        const renderRow = ({ chore: c, done }: { chore: (typeof withDaily)[number]["chore"]; done: boolean }) => {
          const highlighted = snackbar?.choreId === c.id;
          const isDaily = state.dailyFlaggedChoreIds.includes(c.id);
          return (
            <Card key={c.id} style={{ ...styles.row, ...(highlighted ? styles.rowHighlighted : null) }}>
              <Pressable
                disabled={done || !me}
                onPress={() => router.push({ pathname: "/parent/my-chore-report", params: { choreId: c.id } })}
                style={styles.rowMain}
              >
                <Text style={{ fontSize: 20 }}>{c.emoji}</Text>
                <Text style={[theme.typography.parentBody, { flex: 1, marginLeft: theme.spacing.s3 }]}>
                  {c.title}
                </Text>
                {done ? (
                  <Text style={styles.doneLabel}>きろくずみ</Text>
                ) : (
                  <>
                    <Text style={theme.typography.parentBodyMedium}>+{c.points}pt</Text>
                    <Text style={styles.chevron}>›</Text>
                  </>
                )}
              </Pressable>
              <Pressable onPress={() => toggleDaily(c.id, !isDaily)} hitSlop={8}>
                <Text style={[styles.dailyToggle, isDaily && styles.dailyToggleOn]}>
                  {isDaily ? "☀️ まいにち" : "☀️ まいにちにする"}
                </Text>
              </Pressable>
            </Card>
          );
        };
        return (
          <>
            {daily.length > 0 && (
              <View style={{ marginTop: theme.spacing.s4 }}>
                <Text style={[styles.sectionHeading, styles.dailySectionHeading]}>☀️ まいにちのクエスト</Text>
                <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
                  {daily.map(renderRow)}
                </View>
              </View>
            )}
            {/* [2026-08-29変更・本部長] 見出しを「まだのクエスト」→「クエスト」に。
                子ども側は「やることリスト」で、同じものを保護者と子どもで別の名前で
                呼んでいた（ユーザーの実機指摘）。**区別したいのは「まいにち」かどうかだけ**
                なので、まいにち以外は素の「クエスト」に統一した。
                「きろくずみ」は分類ではなく状態（その日やり終えたか）なので別セクションのまま
                残している（2026-08-20にユーザー依頼で分けた経緯があるため）。 */}
            {todo.length > 0 && (
              <View style={{ marginTop: theme.spacing.s4 }}>
                <Text style={styles.sectionHeading}>クエスト</Text>
                <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
                  {todo.map(renderRow)}
                </View>
              </View>
            )}
            {done.length > 0 && (
              <View style={{ marginTop: theme.spacing.s4 }}>
                <Text style={styles.sectionHeading}>きろくずみ</Text>
                <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
                  {done.map(renderRow)}
                </View>
              </View>
            )}
          </>
        );
      })()}

      {/* [2026-08-16修正・本部長] ユーザーが実際に操作した際、ホームへ戻る手段が
          この画面に無いことを発見した。既存のP10（app/parent/chores.tsx）と同じ
          「ホームへ戻る」ボタン（ghost variant・router.back()）のパターンをそのまま
          踏襲した。ワイヤーフレームには画面下部の戻る導線までは明記されていないが、
          既存の他の一覧画面との一貫性を優先した。 */}
      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent/home")} />
    </Screen>

    {snackbar && (
      <ReportCelebration
        tone="parent"
        title={snackbar.title}
        points={snackbar.points}
        memberId={state.activeParentMemberId}
        onDismiss={() => setSnackbar(null)}
      />
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeading: { color: theme.colors.neutralTextSecondary, fontWeight: "700" },
  dailySectionHeading: { color: theme.colors.brandPrimaryStrong },
  row: {},
  rowMain: { flexDirection: "row", alignItems: "center" },
  rowHighlighted: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  dailyToggle: { marginTop: theme.spacing.s1, fontSize: 11, color: theme.colors.neutralTextSecondary },
  dailyToggleOn: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  doneLabel: { color: theme.colors.neutralTextSecondary },
  chevron: { color: theme.colors.neutralTextSecondary, marginLeft: theme.spacing.s2, fontSize: 18 },
});
