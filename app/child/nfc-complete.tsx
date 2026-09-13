import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import Confetti from "@/components/Confetti";
import GachaProgressDots from "@/components/GachaProgressDots";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { useGachaProgress } from "@/hooks/useGacha";

/**
 * C14 NFCタップ完了（3ロール共通）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 7.6.4節、画面一覧・遷移図.md 3.7節
 *
 * [2026-09-01改訂・実装メモ.md 108章] NFCタグの人ごと化（要件定義書07-2章「作り直し：
 * タグの人ごと化」）に伴う決定8「C14は『呼び出し本人のロールでトーンを出し分ける』
 * 共通画面とし、保護者・みまもりメンバー用の新しい画面番号は起こさない」を実装した。
 * 既存の物理タグのURLが`/child/nfc-scan`固定（変更不可）のため、この画面には
 * 子ども・保護者・みまもりメンバーのいずれもたどり着く（`useSession().status`で
 * ロールを判定してトーンのみ出し分ける。7.6.4節）。
 *
 * 状態: 即時加点・自分の記録／即時加点・代理報告／上限到達（自分・代理を区別しない）／
 * タグ未登録等（0行）／通信エラー、の5状態（7.6.4節）。
 */
type ResultParam = "approved" | "limitReached" | "notFound" | "networkError";

export default function NfcCompleteScreen() {
  const params = useLocalSearchParams<{
    result?: string;
    choreTitle?: string;
    choreEmoji?: string;
    points?: string;
    ownerMemberId?: string;
    ownerDisplayName?: string;
    isProxy?: string;
    tagValue?: string;
  }>();
  const result = (params.result as ResultParam) ?? "notFound";
  const { status } = useSession();
  const tone = status === "child" ? "child" : status === "supporter" ? "supporter" : "parent";
  const isChild = tone === "child";
  const isSupporter = tone === "supporter";
  const isProxy = params.isProxy === "1";
  const ownerMemberId = params.ownerMemberId ?? null;

  // 要件定義書07-2章判断事項1「完了画面に、タグ持ち主本人の『あと◯回でガチャ』を
  // 表示することを必須要件とする」。持ち主（ownerMemberId）はタグを読み取った本人と
  // 異なる場合がある（代理報告）ため、ホーム画面のガチャ表示（ログイン中の本人分）とは
  // 別に、ここではRPCが返した持ち主のmember_idで改めて取得する。
  const { loadState: gachaLoadState, remaining, canDrawNow } = useGachaProgress(
    result === "approved" ? ownerMemberId ?? "" : ""
  );

  const homePath = isChild ? "/child/home" : isSupporter ? "/supporter/family" : "/parent";
  // [2026-09-13追加・実装メモ.md 217章] 二重発火の歯止め。3秒タイマーと画面全体の
  // `Pressable`の両方から呼ばれ得るため、実際に`router.replace`を発行するのは
  // 最初の1回だけにする（無害な安全策として残す。無限ループの原因ではないと
  // 217.9〜217.10章の実機再検証で確認済みだが、これはこれとして有用なため維持する）。
  const wentHomeRef = useRef(false);
  const goHome = () => {
    if (wentHomeRef.current) return;
    wentHomeRef.current = true;
    router.replace(homePath);
  };

  // 主要画面ワイヤーフレーム.md 7.6.4節「演出タイムラインと自動遷移」: 即時加点状態
  // （自分・代理いずれも）のみ3秒後に自動でホームへ戻る。画面タップでも即座に遷移する
  // （下記Pressableのラッパー参照）。上限到達・エラー系には適用しない。
  useEffect(() => {
    if (result !== "approved") return;
    const t = setTimeout(goHome, 3000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const bodyStyle = isChild ? theme.typography.childBody : isSupporter ? theme.typography.supporterBody : theme.typography.parentBody;
  const headlineStyle = isChild
    ? theme.typography.childHeadline
    : isSupporter
    ? theme.typography.supporterTitle
    : theme.typography.parentTitle;

  if (result === "approved") {
    const gachaLine =
      gachaLoadState === "ready"
        ? canDrawNow
          ? isChild
            ? `🎰 ${params.ownerDisplayName}、ガチャが ひけるよ！`
            : `🎰 ${params.ownerDisplayName}さん、ガチャが引けます`
          : isChild
          ? `🎰 ${params.ownerDisplayName}、あと${remaining}かいでガチャ！`
          : `🎰 ${params.ownerDisplayName}さん、あと${remaining}回でガチャ`
        : null;

    return (
      <Pressable style={{ flex: 1 }} onPress={goHome}>
        <Screen tone={tone}>
          {isChild && <Confetti height={340} />}
          <View style={styles.centerBlock}>
            {isProxy && (
              <Text style={[headlineStyle, styles.centerText, { marginBottom: theme.spacing.s2 }]}>
                {isChild
                  ? `👤 ${params.ownerDisplayName}の「${params.choreTitle}」`
                  : `${params.ownerDisplayName}さんの記録として届きました`}
              </Text>
            )}
            {isChild ? (
              <>
                <Text style={styles.bigEmoji}>🌟🎉🌟</Text>
                <Text style={[headlineStyle, styles.centerText, { marginTop: theme.spacing.s4 }]}>
                  {isProxy ? "とどいたよ！" : `「${params.choreTitle}」とどいたよ！`}
                </Text>
                {/* [2026-09-13追加・実装メモ.md 215章／主要画面ワイヤーフレーム.md 7.6.5節C]
                    統括要望「待っていると感じさせない何かが欲しい」への本体の打ち手は
                    C13（nfc-scan）側のアニメーション速度（215章）だが、UIUXデザイン部の
                    提案どおり結果が確定するC14側にも一言添える。子ども・自分の記録のときは
                    「よくがんばったね」、代理報告のときは持ち主名を主語にする（持ち主が
                    見ている画面ではないため）。保護者・みまもりメンバー向けには追加しない
                    （7.6.5節C「大人向けの画面に子ども向けの労いを足すのは不自然」）。 */}
                <Text style={[bodyStyle, styles.centerText, { marginTop: theme.spacing.s2 }]}>
                  {isProxy ? `${params.ownerDisplayName}、よくがんばったね` : "よくがんばったね"}
                </Text>
              </>
            ) : (
              <Text style={[headlineStyle, styles.centerText]}>「{params.choreTitle}」をきろくしました</Text>
            )}
            <Text style={[headlineStyle, { marginTop: theme.spacing.s2, color: theme.colors.brandPrimaryStrong }]}>
              +{params.points}pt
            </Text>
          </View>

          {gachaLine && (
            <View style={{ marginTop: theme.spacing.s6, alignItems: "center", gap: theme.spacing.s2 }}>
              <GachaProgressDots remaining={remaining} size={isChild ? theme.gachaPlateSize.child : isSupporter ? theme.gachaPlateSize.supporter : theme.gachaPlateSize.parent} />
              <Text style={[bodyStyle, { color: theme.colors.neutralTextSecondary }]}>{gachaLine}</Text>
            </View>
          )}

          {isSupporter && (
            <Text style={[theme.typography.supporterCaption, styles.centerText, { marginTop: theme.spacing.s4, color: theme.colors.neutralTextSecondary }]}>
              今日もお疲れさまでした
            </Text>
          )}

          <AppButton
            label={isChild ? "やることリストへもどる" : "とじる"}
            tone={tone}
            fullWidth
            style={{ marginTop: theme.spacing.s8 }}
            onPress={goHome}
          />
        </Screen>
      </Pressable>
    );
  }

  if (result === "limitReached") {
    // 7.6.4節「上限到達で自分／代理を区別しない理由」: check_violationはRAISE
    // EXCEPTIONのため行データを返せず、クエスト名・持ち主名のいずれも取得できない。
    return (
      <Screen tone={tone}>
        <View style={styles.centerBlock}>
          {isChild ? (
            <>
              <Text style={styles.bigEmoji}>🌟✅🌟</Text>
              <Text style={[headlineStyle, styles.centerText, { marginTop: theme.spacing.s4 }]}>
                きょうは もう{"\n"}たっぷり がんばったね！
              </Text>
              <Text style={[bodyStyle, styles.centerText, { marginTop: theme.spacing.s3 }]}>またあした ためしてね</Text>
            </>
          ) : (
            <Text style={[headlineStyle, styles.centerText]}>今日はもう十分な回数、実施されています</Text>
          )}
        </View>
        <AppButton label={isChild ? "やることリストへもどる" : "とじる"} tone={tone} fullWidth style={{ marginTop: theme.spacing.s8 }} onPress={goHome} />
      </Screen>
    );
  }

  if (result === "notFound") {
    return (
      <Screen tone={tone}>
        <View style={styles.centerBlock}>
          {isChild ? (
            <>
              <Text style={styles.bigEmoji}>🤔📶</Text>
              <Text style={[headlineStyle, styles.centerText, { marginTop: theme.spacing.s4 }]}>このタグは よみとれなかったよ</Text>
              <Text style={[bodyStyle, styles.centerText, { marginTop: theme.spacing.s3 }]}>おうちの人にきいてみてね</Text>
            </>
          ) : (
            <>
              <Text style={[headlineStyle, styles.centerText]}>このタグは読み取れませんでした</Text>
              <Text style={[bodyStyle, styles.centerText, { marginTop: theme.spacing.s3 }]}>
                登録されていないか、解除・削除済みのクエストのタグの可能性があります。
              </Text>
            </>
          )}
        </View>
        <AppButton label={isChild ? "やることリストへもどる" : "とじる"} tone={tone} fullWidth style={{ marginTop: theme.spacing.s8 }} onPress={goHome} />
      </Screen>
    );
  }

  // networkError
  return (
    <Screen tone={tone}>
      <View style={styles.centerBlock}>
        <Text style={bodyStyle}>⚠ とどきませんでした…</Text>
        <Text style={[bodyStyle, { marginTop: theme.spacing.s2 }]}>もういちど タグに近づけてね</Text>
      </View>
      <AppButton
        label="もういちど"
        tone={tone}
        fullWidth
        style={{ marginTop: theme.spacing.s8 }}
        onPress={() => router.replace({ pathname: "/child/nfc-scan", params: { tagValue: params.tagValue ?? "" } })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerBlock: { alignItems: "center", marginTop: theme.spacing.s8 },
  centerText: { textAlign: "center" },
  bigEmoji: { fontSize: 40 },
});
