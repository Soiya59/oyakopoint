import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { PG_ERRCODE } from "@/data/api";
import { cancelRedemptionErrorText, CANCEL_PROCESSING_TEXT, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";
import { playSound } from "@/lib/sound";

/**
 * C11 交換完了
 * 参照: 主要画面ワイヤーフレーム.md 5章
 *
 * [2026-09-14追加・やること.md 2-3「効果音」] ごほうび交換が完了したときに鳴らす
 * （統括決定）。マウント時に1回だけ（useRefで二重発火を防止）。
 *
 * [2026-09-25追加・要件定義書07-39章「ごほうびの交換の直後の取消」、設計部/成果物/
 * スキーマ設計.sql 77.9章] 画面下端（プライマリボタンより下）に控えめな取消リンク
 * 「とりけす」を1分間表示する。`app/child/report-sent.tsx`（C7、43章の取消UIの
 * 参照実装）と同じ配置・見せ方だが、**07-39章の決定「確認を1回はさむ」により、
 * 自分の交換であっても確認ステップを1回挟む**点がC7（自分の報告は確認なしで
 * 即取消）と異なる（77.9章の申し送りどおり、report-sent.tsxをそのまま複製しない）。
 * ネイティブの`Alert.alert`は使わず、タップ後に画面内でもう一段階の確認テキストを
 * 出す2段階タップ方式にする（実装メモ107章の既存方針・`ChoreReactionsList.tsx`の
 * 既存の2段階確認パターンを踏襲）。
 */
type CancelState = "idle" | "confirming" | "processing" | "success" | "error" | "networkError";

export default function RewardCompleteScreen() {
  const { rewardName, rewardEmoji, remaining, redemptionId } = useLocalSearchParams<{
    rewardName?: string;
    rewardEmoji?: string;
    remaining?: string;
    redemptionId?: string;
  }>();
  const { dispatch } = useAppData();

  const hasPlayedSoundRef = useRef(false);
  useEffect(() => {
    if (hasPlayedSoundRef.current) return;
    hasPlayedSoundRef.current = true;
    playSound("reward");
  }, []);

  const [cancelState, setCancelState] = useState<CancelState>("idle");
  const [cancelErrorText, setCancelErrorText] = useState<string | null>(null);
  // [2026-09-25追加] 1分経過でリンクごと非表示にする（28.0節決定4・サーバー側の
  // 時間窓と同じ判定をクライアント側でも行う）。交換直後は必ず1分以内のため
  // 初期値はtrueでよいが、念のため実際の値で初期化する。
  const [withinWindow, setWithinWindow] = useState(true);
  useEffect(() => {
    if (!redemptionId) return;
    // 交換記録はcreated_atを直接持たないため（このparamsには含まれない）、
    // 画面到達時刻を起点に1分をカウントする（交換確定からこの画面表示までの
    // 遅延は通常ごく短く、実害は無い）。
    const mountedAt = Date.now();
    setWithinWindow(true);
    const id = setInterval(() => {
      if (Date.now() - mountedAt > 60_000) {
        setWithinWindow(false);
        clearInterval(id);
      }
    }, 5_000);
    return () => clearInterval(id);
  }, [redemptionId]);

  const handleCancel = async () => {
    if (!redemptionId) return;
    setCancelState("processing");
    setCancelErrorText(null);
    const result = await dispatch({ type: "CANCEL_REDEMPTION", redemptionId });
    if (!result.ok) {
      // 必ずPG_ERRCODE定数と比較する（可読名の文字列比較はしない。
      // 実装メモ.md 111.5章の教訓）。
      const isKnownDbError =
        result.error.code === PG_ERRCODE.checkViolation ||
        result.error.code === PG_ERRCODE.noDataFound ||
        result.error.code === PG_ERRCODE.insufficientPrivilege;
      if (!isKnownDbError) {
        setCancelState("networkError");
        return;
      }
      setCancelState("error");
      setCancelErrorText(cancelRedemptionErrorText("child", result.error));
      return;
    }
    setCancelState("success");
  };

  const showCancelArea = redemptionId && withinWindow && cancelState !== "success";

  return (
    <Screen tone="child">
      <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
        <Text style={{ fontSize: 48 }}>
          🎉{rewardEmoji}🎉
        </Text>
        <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s4 }]}>やったね！</Text>
        <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s2, textAlign: "center" }]}>
          「{rewardName}」とこうかんしたよ
        </Text>
        <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s4 }]}>のこり {remaining}pt</Text>
      </View>
      <AppButton
        label="つうちょうへ"
        tone="child"
        fullWidth
        style={{ marginTop: theme.spacing.s8 }}
        onPress={() => router.replace("/child/points")}
      />

      {/* [2026-09-25追加] 77.9章「配置の考え方」。プライマリボタンより下、控えめな
          下線付きテキストのみ。自分の交換でも確認を1回はさむ（07-39章決定）。 */}
      {showCancelArea && (
        <View style={{ alignItems: "center", marginTop: theme.spacing.s4 }}>
          {cancelState === "confirming" ? (
            <>
              <Text
                style={[
                  theme.typography.parentCaption,
                  { color: theme.colors.neutralTextSecondary, textAlign: "center" },
                ]}
              >
                とりけしても いい？
              </Text>
              <View style={{ flexDirection: "row", marginTop: theme.spacing.s1, gap: theme.spacing.s4 }}>
                <Pressable onPress={() => setCancelState("idle")} hitSlop={8}>
                  <Text
                    style={[
                      theme.typography.parentCaption,
                      { textDecorationLine: "underline", color: theme.colors.neutralTextSecondary },
                    ]}
                  >
                    やめる
                  </Text>
                </Pressable>
                <Pressable onPress={handleCancel} hitSlop={8}>
                  <Text
                    style={[
                      theme.typography.parentCaption,
                      { textDecorationLine: "underline", color: theme.colors.brandPrimaryStrong },
                    ]}
                  >
                    とりけす
                  </Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text
                style={[
                  theme.typography.parentCaption,
                  { color: theme.colors.neutralTextSecondary, textAlign: "center" },
                ]}
              >
                まちがえちゃったら
              </Text>
              <Pressable
                onPress={() => setCancelState("confirming")}
                disabled={cancelState === "processing"}
                hitSlop={8}
              >
                <Text
                  style={[
                    theme.typography.parentCaption,
                    {
                      marginTop: theme.spacing.s1,
                      textDecorationLine: "underline",
                      color: theme.colors.neutralTextSecondary,
                    },
                  ]}
                >
                  {cancelState === "processing" ? CANCEL_PROCESSING_TEXT.child : "とりけす"}
                </Text>
              </Pressable>
            </>
          )}
          {cancelState === "error" && cancelErrorText && (
            <Text
              style={[
                theme.typography.parentCaption,
                { marginTop: theme.spacing.s2, textAlign: "center", color: theme.colors.brandPrimaryStrong },
              ]}
            >
              {cancelErrorText}
            </Text>
          )}
          {cancelState === "networkError" && (
            <Text
              style={[
                theme.typography.parentCaption,
                { marginTop: theme.spacing.s2, textAlign: "center", color: theme.colors.brandPrimaryStrong },
              ]}
            >
              とどきませんでした…
            </Text>
          )}
        </View>
      )}
      {redemptionId && cancelState === "success" && (
        <View style={{ alignItems: "center", marginTop: theme.spacing.s4 }}>
          <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
            {CANCEL_SUCCESS_TEXT.child}
          </Text>
        </View>
      )}
    </Screen>
  );
}
