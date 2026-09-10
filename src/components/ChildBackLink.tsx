import React from "react";
import { Pressable, Text } from "react-native";
import { router } from "expo-router";
import theme from "@/theme/theme";

/**
 * 子ども向け画面の「← もどる」リンク。
 *
 * [2026-09-10新設・やること.md 4-13] 子どものログイン導線（C1 招待コード入力 →
 * C2 プロフィール選択 →	C3 PIN入力）に戻る導線が1つも無く、押し間違えると端末の
 * 戻る操作でしか抜けられなかったため追加した。
 *
 * 見た目は `app/child/gacha.tsx`・`app/child/collector-shelf.tsx` 等が以前から
 * 画面内に直書きしている「← もどる」と同じ（childBody・画面の先頭に置く）。
 * それらの既存画面はこの部品に置き換えていない（動いている画面を触らないため）。
 *
 * 行き先を固定で書かず必ず `router.back()` に任せること。C2・C3はどちらも複数の道から
 * `router.push` で来る（C2はトップからの子どもログイン／保護者ホームのヘッダ／保護者の
 * 設定「👦 こどもモードにする」の3系統、C3はC2と `app/child/profile-switch.tsx` の2系統）。
 * 行き先を決め打ちにすると、どれか1つの流れで誤った場所へ飛ぶ。
 *
 * Web版で画面のURLを直接開いた／再読み込みした場合だけ戻り先が無いので、その時は
 * P1（ようこそ）へ送る。P1はログイン済みなら各ホームへ自動で転送する（app/index.tsx）。
 */
export default function ChildBackLink() {
  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  return (
    <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="もどる">
      <Text style={theme.typography.childBody}>← もどる</Text>
    </Pressable>
  );
}
