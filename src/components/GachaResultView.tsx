/**
 * ガチャ結果画面（P28／C22／S16）本体の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 21.0節決定2・決定3・21.3節。
 *
 * 決定2「外れ枠を作らない。演出は最小限」・決定3「景品（既製の飾り／家族の絵）は
 * 同一の結果画面レイアウトで表現し、序列を感じさせる演出差を付けない」に対応する。
 * 家族の絵の場合のみ、子ども向け（tone="child"）に限り「だれの秘密が開いたのか」の
 * 一段階の開示演出（0.5秒後に自動で切り替わる）を追加する。保護者・みまもりメンバー
 * 向けは常に単一表示（21.3節「2段階演出にせず単一表示にする」）。
 *
 * [2026-08-26改訂・第4段階] ワイヤーフレームの「[ きに かざる → ]」ボタンを実装した
 * （`onClose` → `onDecorate`に置き換え）。第3段階時点では
 * `decorate_tree_with_gacha_prize()`が前提のため意図的に省略していたが
 * （開発部/成果物/実装メモ.md参照）、本コンポーネントは今回で完成形になる。
 */
import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import { DrawingThumbnail } from "./DrawingCanvas";
import theme from "@/theme/theme";
import type { GachaPrizeDetail } from "@/hooks/useGacha";

type Tone = "parent" | "child" | "supporter";

export interface GachaResultViewProps {
  tone: Tone;
  result: GachaPrizeDetail;
  /** 「木に飾る」導線（21.4節、木への飾り付け画面）への遷移。 */
  onDecorate: () => void;
}

const TWO_STEP_REVEAL_DELAY_MS = 500;

export function GachaResultView({ tone, result, onDecorate }: GachaResultViewProps) {
  const isChild = tone === "child";
  const headlineStyle = isChild ? theme.typography.childHeadline : tone === "supporter" ? theme.typography.supporterTitle : theme.typography.parentTitle;
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;

  // 決定3: 二段階の開示演出は「子ども向け × 家族の絵」の組み合わせのみ。
  const useTwoStepReveal = isChild && result.kind === "family_drawing";
  const [revealed, setRevealed] = useState(!useTwoStepReveal);

  useEffect(() => {
    if (!useTwoStepReveal) {
      setRevealed(true);
      return;
    }
    setRevealed(false);
    const t = setTimeout(() => setRevealed(true), TWO_STEP_REVEAL_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [useTwoStepReveal, result]);

  const decorateLabel = isChild ? "きに かざる →" : "木に飾る →";

  if (useTwoStepReveal && !revealed) {
    return (
      <View style={styles.container}>
        <Text style={bodyStyle}>だれかの ひみつが...</Text>
        <Text style={styles.bigEmoji}>❓</Text>
      </View>
    );
  }

  if (result.kind === "preset_ornament" && result.ornament) {
    return (
      <View style={styles.container}>
        <Text style={headlineStyle}>{isChild ? "🎉 やったー！" : "景品が届きました"}</Text>
        <Text style={styles.bigEmoji}>{result.ornament.emoji ?? "🎁"}</Text>
        <Text style={[bodyStyle, styles.prizeName]}>
          {isChild ? `「${result.ornament.display_name}」が でてきたよ！` : `「${result.ornament.display_name}」`}
        </Text>
        <AppButton label={decorateLabel} tone={tone} fullWidth style={styles.button} onPress={onDecorate} />
      </View>
    );
  }

  if (result.kind === "family_drawing" && result.drawing) {
    const artistName = result.drawing.family_members?.display_name ?? "だれか";
    return (
      <View style={styles.container}>
        <Text style={headlineStyle}>{isChild ? "🎉 ひみつが あいたよ！" : "景品が届きました"}</Text>
        <DrawingThumbnail lineData={result.drawing.line_data} size={120} />
        <Text style={[bodyStyle, styles.prizeName]}>
          {isChild ? `「${artistName}」の ひみつの絵 でした！` : `「${artistName}」が描いた絵です`}
        </Text>
        <AppButton label={decorateLabel} tone={tone} fullWidth style={styles.button} onPress={onDecorate} />
      </View>
    );
  }

  // 通常到達しない（表示に必要なデータが揃わなかった場合の保険。呼び出し側の
  // loadState==="error"分岐で通常はここに到達しない）。
  return (
    <View style={styles.container}>
      <Text style={bodyStyle}>けっかを ひょうじできませんでした</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: "center", marginTop: theme.spacing.s8 },
  bigEmoji: { fontSize: 64, marginTop: theme.spacing.s6 },
  prizeName: { marginTop: theme.spacing.s4, textAlign: "center" },
  button: { marginTop: theme.spacing.s8 },
});

export default GachaResultView;
