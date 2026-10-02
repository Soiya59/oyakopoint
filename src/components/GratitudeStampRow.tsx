/**
 * ベル「とどいたもの／とどいたよ」（`InboxPanel`）の感謝カードの下に出す、スタンプの行（入口）。
 * 受け取った本人だけが、贈られた感謝に4種のスタンプを1つ返せる。
 *
 * [2026-10-03新設・要件定義書07-45章 決定1〜13、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 71章
 * （E1〜E10・71.10節）、設計部/成果物/API仕様.md 39章、開発部/成果物/実装メモ.md 347章]
 *
 * 作りは完了報告カードのスタンプ（`ChildCompletionCard`・`app/parent/approvals.tsx`・
 * `app/supporter/activity.tsx`）と同じ部品の値で、**新しい色・大きさ・文言の定数は作らない**:
 *  - 4種を1行に並べる絵文字のみのボタン（ラベルの文字は付けない。見出し・説明・「＋ひとこと」も置かない）。
 *  - 大きさは子ども56・保護者44・みまもり48。押した1つだけ「絵文字＋✓」で淡い背景と枠
 *    （子ども・保護者＝brandPrimarySoft／brandPrimary、みまもり＝supporterAccentSoft／supporterAccent）。
 *  - **押した分もdisabledにしない**（もう一度押すと取り消し、別のを押すと入れ替え。決定1）。
 *  - 幅は固定せず`minWidth`、行は折り返し可（`flexWrap: "wrap"`）。文字の大きい端末で✓が付いて幅が
 *    広がっても、行が折り返すだけで他のボタンを押しつぶさない（71.7節）。
 *  - 確認ダイアログ・トースト・アニメーション・触覚・「送りました」の文言は出さない（E3）。
 *    押したものが強調されるだけ。
 *  - 送信中は、**この行だけ**不透明度0.6にして押せなくする（二重タップが「取り消し」になる事故を防ぐ。E4）。
 *    他のカードは押せる。スピナー・文言は出さない。
 *  - 失敗は、**この行のすぐ下**に小さく一文＋目印（E5）。赤・アンバーは使わない。入口は残り、押し直せる。
 *    次にこの行を押したら一文は消える。他のカードには影響しない（カードごとに状態を持つ）。
 *  - 読み上げは`accessibilityState={{ selected }}`と文で伝える（「返す」「おへんじ」の語は使わない）。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import FailureRefText from "./FailureRefText";
import theme from "@/theme/theme";
import { useFailureNotice } from "@/hooks/useFailureNotice";
import { STAMP_SEND_ERROR_MESSAGE } from "@/lib/errorMessages";
import { gratitudeStampAccessibility } from "@/lib/gratitudeStamp";
import type { DispatchResult } from "@/data/store";
import type { StampKey } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

/** 子ども向けの失敗の一文（完了報告のスタンプと同じ。src/components/ChildCompletionDetailModal.tsx等）。 */
const CHILD_STAMP_SEND_ERROR_MESSAGE = "おくれなかったよ。もういちどためしてね";

export interface GratitudeStampRowProps {
  tone: Tone;
  gratitudeId: string;
  /** 今付いているスタンプの種類（付いていなければnull）。取得済みのときだけこの部品を出す。 */
  selectedKey: string | null;
  /** スタンプを押す。成功・失敗は戻り値で受ける（楽観更新はしない。見た目は取り直しの結果に従う）。 */
  onToggle: (gratitudeId: string, stampKey: StampKey) => Promise<DispatchResult>;
}

export default function GratitudeStampRow({ tone, gratitudeId, selectedKey, onToggle }: GratitudeStampRowProps) {
  const [busy, setBusy] = React.useState(false);
  // stateだけだと、同じフレーム内の2回目のタップを止められないため、refでも持つ。
  const busyRef = React.useRef(false);
  const mountedRef = React.useRef(true);
  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      // 押したことでカードごと消える（取り消された感謝など）ことがある。消えたあとにstateを触らない。
      mountedRef.current = false;
    };
  }, []);

  const { errorMessage, errorRef, setErrorMessage, showFailure } = useFailureNotice(tone);

  const size =
    tone === "child" ? theme.tapTarget.child : tone === "supporter" ? theme.tapTarget.supporterPrimary : theme.tapTarget.parent;
  const radius = tone === "child" ? theme.radius.childXl : theme.radius.parentMd;
  const selectedBg = tone === "supporter" ? theme.colors.supporterAccentSoft : theme.colors.brandPrimarySoft;
  const selectedBorder = tone === "supporter" ? theme.colors.supporterAccent : theme.colors.brandPrimary;
  const fallback = tone === "child" ? CHILD_STAMP_SEND_ERROR_MESSAGE : STAMP_SEND_ERROR_MESSAGE;

  const press = async (stampKey: StampKey) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrorMessage(null);
    const result = await onToggle(gratitudeId, stampKey);
    busyRef.current = false;
    if (!mountedRef.current) return;
    setBusy(false);
    // 断られた系も通信の失敗も、同じ一文にする（DBの生の文言は出さない。電波・混み合い・ログイン切れ・
    // 権限のときだけ`describeApiFailure`が文を入れ替える）。
    if (!result.ok) showFailure(result.error, { fallback, useDbMessage: false });
  };

  return (
    <View>
      <View style={[styles.row, busy && styles.rowBusy]}>
        {theme.stampDefinitions.map((s) => {
          const selected = selectedKey === s.key;
          const a11y = gratitudeStampAccessibility(tone, s.label, selected);
          return (
            <Pressable
              key={s.key}
              onPress={() => void press(s.key as StampKey)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={a11y.label}
              accessibilityHint={a11y.hint}
              accessibilityState={{ selected, disabled: busy }}
              style={[
                styles.btn,
                { minWidth: size, minHeight: size, borderRadius: radius },
                selected && { backgroundColor: selectedBg, borderColor: selectedBorder },
              ]}
            >
              <Text style={styles.emoji}>
                {s.emoji}
                {selected ? "✓" : ""}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {errorMessage ? (
        <View style={styles.failure}>
          <Text style={styles.failureText}>{errorMessage}</Text>
          <FailureRefText value={errorRef} tone={tone} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing.s2,
    marginTop: theme.spacing.s2,
  },
  rowBusy: { opacity: 0.6 },
  btn: {
    paddingHorizontal: theme.spacing.s2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  emoji: { fontSize: 18 },
  failure: { marginTop: theme.spacing.s1 },
  // 赤・アンバーは使わない（責めない・急がせない。71.4節）。
  failureText: { fontSize: 12, color: theme.colors.neutralTextSecondary },
});
