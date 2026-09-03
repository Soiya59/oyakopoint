import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import Confetti from "@/components/Confetti";
import GachaCelebrationHint from "@/components/GachaCelebrationHint";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { PG_ERRCODE } from "@/data/api";
import { cancelCompletionErrorText, CANCEL_PROCESSING_TEXT, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";

/**
 * C7 報告完了（送信済み）
 * 参照: 主要画面ワイヤーフレーム.md 2章 トーン設計メモ、画面一覧・遷移図.md C7
 *
 * [2026-08-15改訂] 承認フロー廃止に伴い「承認待ち」の説明を廃止した（審査待ち状態が
 * 存在しないため）。唯一の成功状態として「とどいたよ！」＋ポイントが確定したことを
 * 伝える表現に統一する。「みてもらうよ」「審査中」という、確認・審査を待たせる
 * ニュアンスの表現は子ども向けには一切使わない（ポイントは送信と同時にすでに確定している）。
 * あくまで任意・控えめな一言として「おうちの人にもとどいたよ」（＝通知が飛んだことの説明で
 * あり、承認を待つ説明ではない）程度の表現に留める。
 *
 * [2026-09-03追加] 要件定義書07-17章「完了報告の直後の取消」・UIUXデザイン部/成果物/
 * 主要画面ワイヤーフレーム.md 28.2節。画面下端（プライマリボタンより下）に控えめな
 * 取消リンク「とりけす」を追加する。演出エリア（紙吹雪・「とどいたよ！」・ガチャ進捗）
 * には一切手を加えない（28.2節「配置の考え方」）。既存の3秒自動遷移（実装メモ.md 94章）
 * は取消タップ時に解除する（処理中に画面が切り替わって結果表示と競合するのを防ぐため）。
 * 自分の報告の取消のため確認ダイアログは挟まない（28.0節決定5）。
 */
type CancelState = "idle" | "processing" | "success" | "error" | "networkError";

export default function ReportSentScreen() {
  const { choreTitle, points, completionId } = useLocalSearchParams<{
    choreTitle?: string;
    points?: string;
    completionId?: string;
  }>();
  const { state, dispatch } = useAppData();

  const [cancelState, setCancelState] = useState<CancelState>("idle");
  const [cancelErrorText, setCancelErrorText] = useState<string | null>(null);
  // ガチャ進捗ヒントを取消成功後に再取得させるための強制remountキー（28.9節・
  // 実装メモ.md120章「取消後は関連データの再取得を行う」対応。GachaCelebrationHint
  // 自体はマウント時に1回fetchする設計〈同コンポーネントのコメント参照〉のため、
  // keyを変えて再マウントすることで再取得させる）。
  const [gachaHintKey, setGachaHintKey] = useState(0);

  // [2026-08-30追加・本部長] 3秒後に自動でやることリストへ戻る。
  // 大人のお祝いポップアップが3秒で自分から消えるのと同じ扱いにするため
  // （見せ方は役割ごとに変えるが、「押さなくても進む」というルールは共通にする）。
  // ボタンは残してあるので、待たずに戻ることもできる。
  // [2026-09-03改訂] 取消処理中はこのタイマーを解除する（下記handleCancel参照）。
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    autoTimerRef.current = setTimeout(() => router.replace("/child/home"), 3000);
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, []);

  const handleCancel = async () => {
    if (!completionId) return;
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    setCancelState("processing");
    setCancelErrorText(null);
    const result = await dispatch({ type: "CANCEL_COMPLETION", completionId });
    if (!result.ok) {
      // 通信エラー（PostgRESTのcode以外、例:ネットワーク断）とDB側のcheck_violation等を
      // 区別する。必ずPG_ERRCODE定数と比較する（可読名の文字列比較はしない。
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
      setCancelErrorText(cancelCompletionErrorText("child", result.error));
      return;
    }
    setCancelState("success");
    setGachaHintKey((k) => k + 1);
    const t = setTimeout(() => router.replace("/child/home"), 1500);
    autoTimerRef.current = t;
  };

  return (
    <Screen tone="child">
      <Confetti height={320} />
      <View style={{ alignItems: "center", marginTop: theme.spacing.s8 }}>
        <Text style={{ fontSize: 56 }}>🎉</Text>
        <Text style={[theme.typography.childHeadline, { marginTop: theme.spacing.s4, textAlign: "center" }]}>
          とどいたよ！
        </Text>
        <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s3, textAlign: "center" }]}>
          {points ? `「${choreTitle}」+${points}ptとどいたよ！` : `「${choreTitle}」のポイントがとどいたよ`}
        </Text>
        <Text
          style={[
            theme.typography.parentCaption,
            { marginTop: theme.spacing.s2, textAlign: "center", color: theme.colors.neutralTextSecondary },
          ]}
        >
          おうちの人にもとどいたよ
        </Text>
      </View>

      {/* [2026-08-30追加] ユーザーの構想「かざして、ガチャ5回がわかって、そのまま
          同じ端末で引ける」に対応。取得できないときは何も出ない（お祝いの主役は
          きろくできたことなので、ここでエラーは出さない）。 */}
      <View style={{ marginTop: theme.spacing.s6, alignItems: "center" }}>
        <GachaCelebrationHint key={gachaHintKey} tone="child" memberId={state.activeChildMemberId} />
      </View>

      <AppButton
        label="やることリストへもどる"
        tone="child"
        fullWidth
        style={{ marginTop: theme.spacing.s8 }}
        onPress={() => router.replace("/child/home")}
      />

      {/* [2026-09-03追加] 28.2節「配置の考え方」: 演出エリアには触れず、プライマリ
          ボタンより下、フォントサイズも本文より小さい下線付きテキストのみ。 */}
      {completionId && cancelState !== "success" && (
        <View style={{ alignItems: "center", marginTop: theme.spacing.s4 }}>
          <Text
            style={[
              theme.typography.parentCaption,
              { color: theme.colors.neutralTextSecondary, textAlign: "center" },
            ]}
          >
            まちがえちゃったら
          </Text>
          <Pressable onPress={handleCancel} disabled={cancelState === "processing"} hitSlop={8}>
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
      {cancelState === "success" && (
        <View style={{ alignItems: "center", marginTop: theme.spacing.s4 }}>
          <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
            {CANCEL_SUCCESS_TEXT.child}
          </Text>
        </View>
      )}
    </Screen>
  );
}
