import React from "react";
import { KeyboardAvoidingView, StyleProp, ViewStyle } from "react-native";

/**
 * iOS・Androidの両方で`behavior="padding"`を効かせる`KeyboardAvoidingView`の
 * ラッパー。実装メモ.md 289章参照。
 *
 * [2026-09-23新設→同日1回目の改訂・本部長差し戻し] 最初は`Modal`の中（背景の暗幕）用に
 * `KeyboardAvoidingModalBackdrop`として作ったが、**`Modal`側は本部長の指摘で
 * `ScrollView`の`automaticallyAdjustKeyboardInsets`に切り替えた**（289.4節）ため、
 * ここでの役目は無くなった。今は`Screen.tsx`の`scroll=false`（`ScrollView`が無く、
 * フォーカス中の入力欄を自動で見える位置へ動かす仕組みが無いため、器自体を
 * キーボード分だけ縮める必要がある）専用。
 *
 * [2026-09-23・同日2回目の改訂・本部長差し戻し] 289.4節時点では
 * `behavior={Platform.OS === "ios" ? "padding" : undefined}`（Androidは何もしない）
 * だったが、**Android実機でもキーボードに入力欄が隠れる不具合が直っていなかった**
 * （統括のスクショ）。原因はExpo SDK 56 / RN 0.85でedge-to-edgeが実質必須になり、
 * `SOFT_INPUT_ADJUST_RESIZE`を設定してもOSがウィンドウを縮めなくなっていたこと
 * （289.7節に事実を記載）。**`scroll=false`のこの器にはAndroidにも手当てが要る**
 * ため、`behavior="padding"`を両OS共通にした（Android専用の
 * `AndroidKeyboardAvoidingPadding.tsx`と役目が重なって見えるが、あちらは
 * 「iOSは何もしない・Androidだけpadding」、こちらは「両方ともpadding」で挙動が違う
 * ため別の部品のまま残す。使い分けは`Screen.tsx`のコメント参照）。
 */
export function KeyboardAvoidingPaddingView({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <KeyboardAvoidingView style={style} behavior="padding">
      {children}
    </KeyboardAvoidingView>
  );
}

export default KeyboardAvoidingPaddingView;
