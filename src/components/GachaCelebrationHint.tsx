/**
 * 完了報告のお祝い演出の中に出す「あと◯回でガチャ」表示。
 *
 * [2026-08-30追加・本部長／軽微変更ルート]
 * ユーザーのNFC構想「かざして、ガチャ5回がわかって、そのまま同じ端末で引ける」に
 * 対応する部品。子どもの完了画面（C7・C14）と大人のお祝いポップアップ
 * （ReportCelebration）の両方で使う。
 *
 * ■ なぜ画面側ではなくこの部品の中で取得するのか
 * `useGachaProgress` はマウント時に必ず1回fetchする。もし一覧画面
 * （app/parent/my-chores.tsx 等）に置くと、**お祝いが出ない通常の閲覧でも毎回
 * 通信が発生する**。この部品はお祝いが表示されるときにしかマウントされないので、
 * ここに閉じ込めれば通信は「報告した直後の1回だけ」で済む。
 * ユーザーが繰り返し最優先と述べている「軽さ」のための構造。
 *
 * 取得前・取得失敗時は何も描画しない。お祝いの主役は「きろくできた」ことであり、
 * ガチャ残数は付随情報なので、出なくても演出は成立する（エラー表示は出さない）。
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import GachaProgressDots from "./GachaProgressDots";
import theme from "@/theme/theme";
import { useGachaProgress } from "@/hooks/useGacha";

export interface GachaCelebrationHintProps {
  tone: "child" | "parent" | "supporter";
  /** 報告した本人。state.activeChildMemberId / state.activeParentMemberId。 */
  memberId: string | null;
}

export function GachaCelebrationHint({ tone, memberId }: GachaCelebrationHintProps) {
  const isChild = tone === "child";
  const { loadState, remaining, canDrawNow } = useGachaProgress(memberId ?? "");

  if (!memberId || loadState !== "ready") return null;

  const label = canDrawNow
    ? isChild
      ? "🎰 ガチャが ひけるよ！"
      : "🎰 ガチャが引けます"
    : isChild
      ? `🎰 あと${remaining}かいで ガチャ！`
      : `🎰 あと${remaining}回で ガチャ`;

  return (
    <View style={styles.wrap}>
      <GachaProgressDots remaining={remaining} size={isChild ? theme.gachaPlateSize.child : theme.gachaPlateSize.parent} />
      <Text style={[isChild ? theme.typography.childBody : theme.typography.parentBody, styles.label]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: theme.spacing.s2 },
  label: { color: theme.colors.neutralTextSecondary, textAlign: "center" },
});

export default GachaCelebrationHint;
