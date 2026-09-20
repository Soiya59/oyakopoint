import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import HabitFigureGrantBanner from "@/components/HabitFigureGrantBanner";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { PG_ERRCODE, describeChoreReportFailure } from "@/data/api";
import { GENERIC_ERROR_MESSAGE } from "@/lib/errorMessages";
import { playSound } from "@/lib/sound";
import { useCheckNewHabitFigureGrant } from "@/hooks/useHabitCards";
import type { HabitFigureGrantWithCatalog } from "@/types/domain";
import { useNgWordGuard } from "@/hooks/useNgWordGuard";
import NgWordWarningText from "@/components/NgWordWarningText";

/**
 * P20 じぶんの完了報告（保護者、要件定義書07-4章「親の完了報告」）
 * 参照: 主要画面ワイヤーフレーム.md 9.2章、画面一覧・遷移図.md P20・3.9章
 *
 * C6完了報告の保護者版。API呼び出し（chore_completions insert）自体はC6と全く同じ
 * （API仕様.md 4b章）。異なるのは演出のみ:
 * - ボタン文言「とどける」→「きろくする」
 * - 送信成功時は新しい画面（C7相当）へ遷移せず、P19へ戻り控えめな確認表示のみ
 *   （主要画面ワイヤーフレーム.md 9.0決定2）
 * - 上限到達時の文言も達成トーンではなく簡潔な事実提示にする（9.2章状態一覧）
 */
type ScreenState = "form" | "sending" | "networkError" | "limitReached";

export default function ParentMyChoreReportScreen() {
  const { choreId } = useLocalSearchParams<{ choreId: string }>();
  const { state, dispatch, isChoreLimitReached } = useAppData();
  const { client } = useSession();
  const chore = state.chores.find((c) => c.id === choreId);
  const me = state.members.find((m) => m.id === state.activeParentMemberId);

  const [note, setNote] = useState("");
  const [screenState, setScreenState] = useState<ScreenState>(
    chore && me && isChoreLimitReached(chore, me.id) ? "limitReached" : "form"
  );
  // [2026-09-17追加・やること.md 4-36 症状3] 「通信エラーが発生しました」の固定文言を
  // やめ、失敗の種類ごとに文言を出し分ける（describeChoreReportFailure参照）。
  const [sendErrorMessage, setSendErrorMessage] = useState<string | null>(null);
  // [2026-09-19改訂・要件定義書07-28章2026-09-19全面改訂決定25] シール帳は
  // 全クエスト共通の記録になったため、どのクエストの完了報告でも段階到達演出を
  // 確認する。新規画面へは遷移せず、この画面上に一時的に表示する。
  const { check: checkNewGrant } = useCheckNewHabitFigureGrant();
  const [figureGrant, setFigureGrant] = useState<HabitFigureGrantWithCatalog | null>(null);
  const ngGuard = useNgWordGuard();

  if (!chore || !me) {
    return (
      <Screen tone="parent">
        <Text style={theme.typography.parentBody}>クエストが見つかりませんでした</Text>
        <AppButton label="じぶんのクエストへもどる" onPress={() => router.replace("/parent/my-chores")} />
      </Screen>
    );
  }


  const send = async () => {
    if (isChoreLimitReached(chore, me.id)) {
      setScreenState("limitReached");
      return;
    }

    if (ngGuard.guard(note)) return;

    setScreenState("sending");
    const result = await dispatch({
      type: "REPORT_COMPLETION",
      choreId: chore.id,
      reportedBy: me.id,
      note: note.trim() || null,
    });

    if (!result.ok) {
      if (result.error.code === PG_ERRCODE.checkViolation) {
        setScreenState("limitReached");
      } else {
        setSendErrorMessage(describeChoreReportFailure(result.error));
        setScreenState("networkError");
      }
      return;
    }

    // [2026-09-16追加・やること.md 2-3「効果音」保護者・みまもりへの拡張]
    // ここは`send()`という、ボタン押下でのみ呼ばれ、かつ`result.ok`が真の
    // （＝成功した）ときにしか到達しない経路のため、useEffect＋useRefの
    // 二重発火防止を使わずとも「成功時に1回だけ」を満たせる（失敗時は上の
    // if文でreturn済み）。P19（app/parent/my-chores.tsx）へ戻った直後に
    // お祝いポップアップ（ReportCelebration）が表示されるが、そちらは
    // 遷移パラメータを受け取って表示するだけの別画面のため、「成功したこの
    // 瞬間」を確実に1回だけ捉えられるここで鳴らす。
    playSound("report");

    // [2026-09-19改訂・要件定義書07-28章2026-09-19全面改訂決定25、API仕様.md
    // 17.7節] どのクエストの完了報告でも、P19へ戻る前に段階到達の確認を挟む
    // （新しい付与が見つかった場合のみ、この画面上にバナーを表示して遷移を
    // 保留する）。
    if (result.reportedAt) {
      const grant = await checkNewGrant(me.id, result.reportedAt);
      if (grant) {
        setFigureGrant(grant);
        return;
      }
    }

    goToMyChores();
  };

  // 主要画面ワイヤーフレーム.md 9.0決定2: 新しい画面へは遷移せず、P19へ戻り
  // 控えめな確認表示のみ行う。P19側はjustChoreId/justTitle/justPointsパラメータを
  // 「一度きりの合図」として受け取り、該当行のハイライト＋スナックバーを出す。
  const goToMyChores = () => {
    router.replace({
      pathname: "/parent/my-chores",
      params: { justChoreId: chore.id, justTitle: chore.title, justPoints: chore.points != null ? String(chore.points) : "" },
    });
  };

  if (screenState === "limitReached") {
    return (
      <Screen tone="parent">
        <View style={styles.backRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={theme.typography.parentBody}>← もどる</Text>
          </Pressable>
          <Text style={theme.typography.parentBody}>
            {chore.emoji} {chore.title}
          </Text>
        </View>
        <View style={styles.centerBlock}>
          <Text style={theme.typography.parentBodyMedium}>本日はすでに記録済みです</Text>
        </View>
        <AppButton label="じぶんのクエストへもどる" fullWidth onPress={() => router.replace("/parent/my-chores")} />
      </Screen>
    );
  }

  if (screenState === "networkError") {
    return (
      <Screen tone="parent">
        <View style={styles.backRow}>
          <Pressable onPress={() => router.back()}>
            <Text style={theme.typography.parentBody}>← もどる</Text>
          </Pressable>
          <Text style={theme.typography.parentBody}>
            {chore.emoji} {chore.title}
          </Text>
        </View>
        <View style={styles.centerBlock}>
          <Text style={theme.typography.parentBody}>{sendErrorMessage ?? GENERIC_ERROR_MESSAGE}</Text>
        </View>
        <AppButton
          label="もう一度送信する"
          fullWidth
          onPress={() => {
            setSendErrorMessage(null);
            setScreenState("form");
          }}
        />
      </Screen>
    );
  }

  // [2026-09-17追加・要件定義書07-28章決定9・10、主要画面ワイヤーフレーム.md
  // 49.8章決定24〜26] 段階到達演出。新しい画面へは遷移せず、この画面に留まって
  // 表示する（決定25「新しい全画面演出は作らない」）。
  if (figureGrant) {
    return (
      <Screen tone="parent">
        <View style={styles.backRow}>
          <Text style={theme.typography.parentBody}>
            {chore.title} {chore.emoji}
          </Text>
        </View>
        <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>記録しました</Text>
        <HabitFigureGrantBanner
          tone="parent"
          grant={figureGrant}
          onPlaceOnTree={() =>
            router.replace({
              pathname: "/parent/tree-decorate",
              params: {
                habitFigureGrantId: figureGrant.id,
                habitFigureKey: figureGrant.habit_figure_catalog?.figure_key ?? "",
                habitFigureKindEmoji: figureGrant.habit_figure_catalog?.kind_emoji ?? "",
              },
            })
          }
          onLater={goToMyChores}
        />
      </Screen>
    );
  }

  return (
    <Screen tone="parent">
      <View style={styles.backRow}>
        <Pressable onPress={() => router.back()}>
          <Text style={theme.typography.parentBody}>← もどる</Text>
        </Pressable>
        <Text style={theme.typography.parentBody}>
          {chore.title} {chore.emoji}
        </Text>
      </View>

      {/* [2026-09-19改訂・要件定義書07-28章決定25・26] 全クエストにポイントが
          付き、同時にシール帳が1マス埋まる（0ptのクエストも「+0pt」と
          そのまま表示する）。 */}
      <Text style={[theme.typography.parentBodyMedium, { marginTop: theme.spacing.s6 }]}>
        記録すると +{chore.points}pt
      </Text>

      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s6 }]}>メモ（任意）</Text>
      <TextInput
        value={note}
        onChangeText={(t) => {
          setNote(t);
          ngGuard.clear();
        }}
        multiline
        style={styles.noteInput}
      />
      {ngGuard.blocked && <NgWordWarningText tone="parent" />}

      <AppButton
        label={
              screenState === "sending"
            ? "きろくしています…"
            : "きろくする"
        }
        fullWidth
        loading={screenState === "sending"}
        disabled={screenState === "sending"}
        style={{ marginTop: theme.spacing.s6 }}
        onPress={send}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  backRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  centerBlock: { alignItems: "center", marginTop: theme.spacing.s8, marginBottom: theme.spacing.s6 },
  noteInput: {
    marginTop: theme.spacing.s2,
    minHeight: 72,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    padding: theme.spacing.s3,
    textAlignVertical: "top",
  },
});
