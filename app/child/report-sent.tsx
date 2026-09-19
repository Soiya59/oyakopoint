import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import Confetti from "@/components/Confetti";
import GachaCelebrationHint from "@/components/GachaCelebrationHint";
import HabitFigureGrantBanner from "@/components/HabitFigureGrantBanner";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { PG_ERRCODE } from "@/data/api";
import { cancelCompletionErrorText, CANCEL_PROCESSING_TEXT, CANCEL_SUCCESS_TEXT } from "@/lib/cancelChoreCompletion";
import { playSound, type SoundHandle } from "@/lib/sound";
import { useCheckNewHabitFigureGrant } from "@/hooks/useHabitCards";
import type { HabitFigureGrantWithCatalog } from "@/types/domain";

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
  const { choreTitle, points, completionId, reportedAt } = useLocalSearchParams<{
    choreTitle?: string;
    points?: string;
    completionId?: string;
    reportedAt?: string;
  }>();
  const { state, dispatch } = useAppData();

  // [2026-09-19改訂・要件定義書07-28章2026-09-19全面改訂決定25、主要画面
  // ワイヤーフレーム.md 49-B.10章決定59] シール帳は全クエスト共通の記録に
  // なったため、どのクエストの完了報告でも段階到達の確認を行う（reward_mode
  // という区別自体が撤去された。サーバー側トリガーが自動で付与するため、
  // クライアントは「付与されたはず」を後から確認するだけでよい）。
  const { check: checkNewGrant } = useCheckNewHabitFigureGrant();
  const [figureGrant, setFigureGrant] = useState<HabitFigureGrantWithCatalog | null>(null);
  const [figureCheckDone, setFigureCheckDone] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (reportedAt) {
      void checkNewGrant(state.activeChildMemberId, reportedAt).then((grant) => {
        if (!cancelled) {
          setFigureGrant(grant);
          setFigureCheckDone(true);
        }
      });
    } else {
      setFigureCheckDone(true);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [cancelState, setCancelState] = useState<CancelState>("idle");
  const [cancelErrorText, setCancelErrorText] = useState<string | null>(null);
  // ガチャ進捗ヒントを取消成功後に再取得させるための強制remountキー（28.9節・
  // 実装メモ.md120章「取消後は関連データの再取得を行う」対応。GachaCelebrationHint
  // 自体はマウント時に1回fetchする設計〈同コンポーネントのコメント参照〉のため、
  // keyを変えて再マウントすることで再取得させる）。
  const [gachaHintKey, setGachaHintKey] = useState(0);

  // [2026-09-14追加・やること.md 2-3「効果音」] 完了報告が通った瞬間（この画面が
  // 表示された瞬間）に1回だけ鳴らす。StrictModeの二重マウント等で2回鳴らないよう
  // useRefで1回だけに制御する（開発部/成果物/実装メモ.md参照）。取消（handleCancel）
  // で再生中の音を止められるよう、ハンドルを保持しておく。
  const soundHandleRef = useRef<SoundHandle | null>(null);
  const hasPlayedSoundRef = useRef(false);
  useEffect(() => {
    if (hasPlayedSoundRef.current) return;
    hasPlayedSoundRef.current = true;
    soundHandleRef.current = playSound("report");
  }, []);

  // [2026-08-30追加・本部長] 3秒後に自動でやることリストへ戻る。
  // 大人のお祝いポップアップが3秒で自分から消えるのと同じ扱いにするため
  // （見せ方は役割ごとに変えるが、「押さなくても進む」というルールは共通にする）。
  // ボタンは残してあるので、待たずに戻ることもできる。
  // [2026-09-03改訂] 取消処理中はこのタイマーを解除する（下記handleCancel参照）。
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // [2026-09-17改訂・要件定義書07-28章] フィギュア付与の確認が終わっていない間、
    // または新しい付与が見つかった間は自動遷移しない（「木に飾る→」を選ぶ時間を
    // 確保するため）。確認の結果「付与なし」と分かった時点で通常どおり3秒後に戻る。
    if (!figureCheckDone || figureGrant) return;
    autoTimerRef.current = setTimeout(() => router.replace("/child/home"), 3000);
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, [figureCheckDone, figureGrant]);

  const handleCancel = async () => {
    if (!completionId) return;
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
    // [2026-09-14追加] 取消を選んだ時点で、鳴っているかもしれない完了音を止める
    // （やること.md 2-3「取消したときに音が鳴り続けないよう注意」対応）。
    soundHandleRef.current?.stop();
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
          {/* [2026-09-19改訂・要件定義書07-28章決定26] pointsは常に0以上の整数
              （NOT NULL）になったため、出し分けは不要。0ptのクエストも
              「+0ptとどいたよ！」とそのまま表示する（決定26「0を勧める作りには
              しない」であり、0の表示自体を隠す・特別扱いする必要はない）。 */}
          {`「${choreTitle}」+${points}ptとどいたよ！`}
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

      {/* [2026-09-17追加・要件定義書07-28章決定9・10、主要画面ワイヤーフレーム.md
          49.8章決定24〜26] 段階到達時の自動付与演出。新しい全画面演出・選択モーダルは
          作らず、既存の完了報告成功演出に続けて表示する。 */}
      {figureGrant && (
        <HabitFigureGrantBanner
          tone="child"
          grant={figureGrant}
          onPlaceOnTree={() =>
            router.replace({
              pathname: "/child/tree-decorate",
              params: {
                habitFigureGrantId: figureGrant.id,
                habitFigureKey: figureGrant.habit_figure_catalog?.figure_key ?? "",
                habitFigureKindEmoji: figureGrant.habit_figure_catalog?.kind_emoji ?? "",
              },
            })
          }
          onLater={() => router.replace("/child/home")}
        />
      )}

      <AppButton
        label="もどる"
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
