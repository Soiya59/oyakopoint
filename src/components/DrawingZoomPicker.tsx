/**
 * お絵かき画面の拡大倍率選択（主要画面ワイヤーフレーム.md 47.2節 決定4〜7）。
 * 1倍・2倍・3倍を3つのボタンから直接選ぶ（「大きく」1つを繰り返し押す巡回方式は
 * 決定4により不採用）。`AppButton`のsecondary variant相当の見た目（背景
 * `color-neutral-surface`・枠`color-neutral-border`）を土台にしつつ、選択状態は
 * 10色パレット（DrawingPalette.tsx）・線の太さ選択（DrawingStrokeWidthPicker.tsx）と
 * 同じ`color-brand-primary`の2pt枠で表す（これが「いま何倍か」の表示を兼ねる、決定7）。
 * 見出し・説明文は付けない（決定6）。
 *
 * タップ領域はロールごとの既存基準値（`theme.tapTarget`、子ども56pt・保護者44pt・
 * みまもりメンバー48pt）を満たす。無効化条件は`disabled={saving}`のみとし、上限到達
 * （`atCapacity`）では無効化しない（すでに描いた絵を拡大して見返す・「ひとつ もどす」の
 * 後に続きを描くために拡大したままにする、といった操作を妨げないため）。
 *
 * [2026-09-29改訂・実装メモ.md 328章、本部長依頼・軽微変更ルート（統括の奥さんの
 * Android実機で発見）] 行の`alignSelf: "center"`はコンテンツ幅（3ボタン分の
 * 自然な幅）でしか収まらず、文字の大きさの設定（fontScale）が大きい端末や
 * 画面の狭いAndroidでは3ボタン合計の幅が画面より広くなり、中央寄せのまま
 * 左端の「ふつう」が画面外へはみ出して切れていた（`alignSelf: "center"`だと
 * 親〈`measureWrap`、幅100%〉に収まる保証が無いため）。
 * 直し方: 行に`maxWidth: "100%"`を足して行自体が親の幅を超えないようにし、
 * 各ボタンに`flexShrink: 1`を足して縮められるようにした（RNの`flexShrink`の
 * 既定値はWebのCSSと異なり`0`＝縮まないため、明示しないと縮まらない）。
 * 通常の文字サイズでは3ボタンの自然な幅が画面に収まるため`maxWidth`は効かず、
 * 見た目は変わらない（大人の「標準／2倍／3倍」表示も現状のまま）。文字が
 * 大きい・画面が狭いときだけ行が縮み、ボタンも詰まる。
 * ラベルは`numberOfLines={1}`＋`adjustsFontSizeToFit`＋`minimumFontScale`で
 * 1行を保ったまま、ボタンが縮んで入りきらない場合だけ文字を縮小する
 * （Android・iOS・webのいずれもReact Native標準機能で動く。RN 0.85時点で
 * Androidも対応済み、`node_modules/react-native/ReactAndroid/src/main/java/
 * com/facebook/react/views/text/ReactTextView.java`で確認）。
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import theme from "@/theme/theme";
import { DRAWING_ZOOM_LEVELS, type DrawingZoomLevel } from "@/lib/drawingZoomPan";

type Tone = "parent" | "child" | "supporter";

/** 47.2節 決定5: 3ロールの確定文言。 */
const ZOOM_LABELS: Record<Tone, Record<DrawingZoomLevel, string>> = {
  child: { 1: "ふつう", 2: "おおきく", 3: "もっと おおきく" },
  parent: { 1: "標準", 2: "2倍", 3: "3倍" },
  supporter: { 1: "標準", 2: "2倍", 3: "3倍" },
};

interface DrawingZoomPickerProps {
  tone: Tone;
  selected: DrawingZoomLevel;
  onSelect: (zoom: DrawingZoomLevel) => void;
  disabled?: boolean;
}

export function DrawingZoomPicker({ tone, selected, onSelect, disabled = false }: DrawingZoomPickerProps) {
  const isChild = tone === "child";
  const isSupporter = tone === "supporter";
  const tapMinHeight = isChild
    ? theme.tapTarget.child
    : isSupporter
    ? theme.tapTarget.supporterPrimary
    : theme.tapTarget.parent;
  const textStyle = isChild
    ? theme.typography.childButton
    : isSupporter
    ? theme.typography.supporterBodyMedium
    : theme.typography.parentBodyMedium;
  const labels = ZOOM_LABELS[tone];

  return (
    <View style={styles.row}>
      {DRAWING_ZOOM_LEVELS.map((z) => (
        <Pressable
          key={z}
          disabled={disabled}
          onPress={() => onSelect(z)}
          accessibilityRole="button"
          accessibilityLabel={labels[z]}
          style={[
            styles.button,
            { minHeight: tapMinHeight, borderRadius: isChild ? theme.radius.childXl : theme.radius.parentMd },
            selected === z && styles.buttonSelected,
            disabled && styles.buttonDisabled,
          ]}
        >
          <Text
            style={[textStyle, styles.label]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.6}
          >
            {labels[z]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    // [2026-09-29追加・328章] 親（measureWrap、幅100%）を超えないようにする保険。
    // 通常の文字サイズでは3ボタンの自然な幅が画面に収まるため効かない。
    maxWidth: "100%",
    gap: theme.spacing.s3,
  },
  button: {
    // [2026-09-29追加・328章] 既定では縮まない（RNのflexShrink既定値は0）ため
    // 明示する。paddingHorizontalはそのままなので、通常の文字サイズでは
    // 見た目に影響しない。
    flexShrink: 1,
    paddingHorizontal: theme.spacing.s3,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  // 47.2節決定7: 選択状態はDrawingPalette・DrawingStrokeWidthPickerと同じ
  // color-brand-primaryの2pt枠で表す（新しい視覚言語を増やさない）。
  buttonSelected: {
    borderWidth: 2,
    borderColor: theme.colors.brandPrimary,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  label: {
    color: theme.colors.neutralTextPrimary,
    textAlign: "center",
  },
});

export default DrawingZoomPicker;
