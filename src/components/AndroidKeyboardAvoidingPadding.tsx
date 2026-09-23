import React from "react";
import { KeyboardAvoidingView, Platform, StyleProp, View, ViewProps, ViewStyle } from "react-native";

/**
 * Androidでだけ`behavior="padding"`の`KeyboardAvoidingView`で包む。iOSは中身の
 * 見た目・構造を一切変えない素の`View`のまま。実装メモ.md 289.7節参照。
 *
 * [2026-09-23新設・本部長の2回目の差し戻し] 289.4節の直し方（iOSは
 * `ScrollView.automaticallyAdjustKeyboardInsets`、Androidは「OSが自動でウィンドウを
 * リサイズするので何もしない」）は、**Android実機でも直っていなかった**
 * （統括のスクショ、保護者の完了報告詳細）。原因はExpo SDK 56 / RN 0.85で
 * **edge-to-edgeが既定・実質必須**になっており、edge-to-edgeのウィンドウでは
 * `SOFT_INPUT_ADJUST_RESIZE`を設定してもOSはウィンドウを縮めないため
 * （289.7節に事実を記載）。「Androidは何もしなくてよい」という289.4節の前提が
 * この環境では成り立っていなかった。
 *
 * - **Android**: `KeyboardAvoidingView(behavior="padding")`でJS側から器を縮める。
 *   ウィンドウ自体がOSにより縮まなくても、RN自身がキーボードの高さ・位置を
 *   `WindowInsets`から取得してJSへイベントを送るため（289.7節）、
 *   `KeyboardAvoidingView`はedge-to-edgeでも動く。中に`ScrollView`がある場合は、
 *   縮んだ分だけ`ReactScrollView`（AOSPの`android.widget.ScrollView`を継承）自身が
 *   フォーカス中の子を見える位置まで追いかける（289.7節）。
 * - **iOS**: 289.4節のまま`ScrollView`側の`automaticallyAdjustKeyboardInsets`に
 *   任せる。ここで`KeyboardAvoidingView`を足すと二重にずれるため、素の`View`のまま
 *   何もしない。
 */
export function AndroidKeyboardAvoidingPadding({
  style,
  children,
  ...rest
}: {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
} & Omit<ViewProps, "style" | "children">) {
  if (Platform.OS === "android") {
    return (
      <KeyboardAvoidingView style={style} behavior="padding" {...rest}>
        {children}
      </KeyboardAvoidingView>
    );
  }
  return (
    <View style={style} {...rest}>
      {children}
    </View>
  );
}

export default AndroidKeyboardAvoidingPadding;
