import React from "react";
import { KeyboardAvoidingView, Platform, StyleProp, ViewStyle } from "react-native";

/**
 * iOSでだけ`behavior="padding"`を効かせる`KeyboardAvoidingView`のラッパー。
 * 実装メモ.md 289章参照。
 *
 * [2026-09-23新設→同日改訂・本部長差し戻し] 最初は`Modal`の中（背景の暗幕）用に
 * `KeyboardAvoidingModalBackdrop`として作ったが、**`Modal`側は本部長の指摘で
 * `ScrollView`の`automaticallyAdjustKeyboardInsets`に切り替えた**（289.4節）ため、
 * ここでの役目は無くなった。今は`Screen.tsx`の`scroll=false`のとき
 * （`ScrollView`が無く、フォーカス中の入力欄を自動で見える位置へ動かす仕組みが
 * 無いため、器自体をキーボード分だけ縮める必要がある）専用。
 *
 * - iOS: `behavior="padding"`。`Modal`と違い`Screen`は通常のView階層なので、
 *   `KeyboardAvoidingView`が素直に効く。
 * - Android: `behavior={undefined}`（＝何もしない）。Expoの既定
 *   `android.softwareKeyboardLayoutMode: "resize"`によりOS自身がウィンドウを
 *   リサイズするため、ここでさらに手を加えると二重にずれる（Screen.tsx参照）。
 */
export function KeyboardAvoidingPaddingView({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <KeyboardAvoidingView style={style} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {children}
    </KeyboardAvoidingView>
  );
}

export default KeyboardAvoidingPaddingView;
