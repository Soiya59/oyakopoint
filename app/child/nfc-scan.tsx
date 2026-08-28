import React, { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { PG_ERRCODE } from "@/data/api";

/**
 * C13 NFCタグ読み取り中
 * 参照: 主要画面ワイヤーフレーム.md 7.2章、画面一覧・遷移図.md 3.7節
 *
 * [2026-08-18改訂] 35章でWeb NFC APIによる本実装に切り替えた後は、この画面の
 * `tagValue`はAndroid OS標準のNFCタグディスパッチが物理タグのURL
 * （src/lib/nfc.ts の buildWebAppUrl参照）を開いた際にURLクエリパラメータとして
 * 渡ってくる（実機タップ時のみ到達する経路）。開発検証用のシミュレーション導線
 * （C5からのランダム選択ショートカット）は実機に不要なポイント付与を招くリスクが
 * あったため撤去した（本部長対応）。tagValue確定後の処理（chore特定→完了報告）は
 * API仕様.md 4a章の手順どおり、通常の完了報告と同じロジック
 * （findChoreByTag・isChoreLimitReached・REPORT_COMPLETIONアクション）を再利用する。
 */
export default function NfcScanScreen() {
  const { tagValue } = useLocalSearchParams<{ tagValue?: string }>();
  const { state, dispatch, findChoreByTag, isChoreLimitReached } = useAppData();
  const me = state.members.find((m) => m.id === state.activeChildMemberId)!;
  const pulse = useRef(new Animated.Value(0.4)).current;
  const processedRef = useRef(false);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 500, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    const t = setTimeout(() => {
      process();
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagValue]);

  const process = async () => {
    if (processedRef.current) return;
    processedRef.current = true;

    if (!tagValue) {
      router.replace({ pathname: "/child/nfc-complete", params: { result: "notFound" } });
      return;
    }

    // API仕様.md 4a章手順2「トークンからchoreを特定」相当。
    const chore = await findChoreByTag(tagValue);
    if (!chore) {
      // 手順3b: タグ未登録／他家族のタグ／削除済みchoreのタグ、いずれも同じ0件扱い
      // （主要画面ワイヤーフレーム.md 7.0決定3。原因を区別しない）。
      router.replace({ pathname: "/child/nfc-complete", params: { result: "notFound" } });
      return;
    }

    // daily_limit判定は通常の完了報告（C6）と全く同じ isChoreLimitReached() を再利用する
    // （要件定義書07-2章4「承認フロー・回数制限のロジックは分岐させない」）。
    if (isChoreLimitReached(chore, me.id)) {
      router.replace({
        pathname: "/child/nfc-complete",
        params: { result: "limitReached", choreId: chore.id, choreTitle: chore.title, choreEmoji: chore.emoji },
      });
      return;
    }

    // API仕様.md 4a章手順3a「completionを作成」。noteは付けない
    // （主要画面ワイヤーフレーム.md 7.0決定2、NFC経由では入力ステップ自体を表示しない）。
    // [変更] 2026-08-15改訂: requires_approvalによるpending/approved分岐は、承認フロー廃止
    // （chores.requires_approval列自体がスキーマ設計.sql v2.0で削除済み）に伴い撤廃した。
    // REPORT_COMPLETIONは常に確定済みの完了報告を作るため、C14の結果は常に"approved"（即時加点）
    // の1種類のみになる（主要画面ワイヤーフレーム.md 7.3章参照）。
    const result = await dispatch({
      type: "REPORT_COMPLETION",
      choreId: chore.id,
      reportedBy: me.id,
      note: null,
    });

    if (!result.ok) {
      if (result.error.code === PG_ERRCODE.checkViolation) {
        router.replace({
          pathname: "/child/nfc-complete",
          params: { result: "limitReached", choreId: chore.id, choreTitle: chore.title, choreEmoji: chore.emoji },
        });
      } else {
        router.replace({ pathname: "/child/nfc-complete", params: { result: "networkError", tagValue } });
      }
      return;
    }

    router.replace({
      pathname: "/child/nfc-complete",
      params: {
        result: "approved",
        choreId: chore.id,
        choreTitle: chore.title,
        choreEmoji: chore.emoji,
        points: String(chore.points),
      },
    });
  };

  return (
    <Screen tone="child">
      <View style={styles.center}>
        <Animated.Text style={[styles.icon, { opacity: pulse }]}>📶 · · ·</Animated.Text>
        <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>タグをよみとっています</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  icon: { fontSize: 40 },
});
