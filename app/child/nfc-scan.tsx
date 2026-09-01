import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { reportChoreCompletionByNfcTag, PG_ERRCODE } from "@/data/api";

/**
 * C13 NFCタグ読み取り中
 * 参照: 主要画面ワイヤーフレーム.md 7.6.3節、画面一覧・遷移図.md 3.7節
 *
 * [2026-09-01改訂・実装メモ.md 108章] NFCタグの人ごと化（要件定義書07-2章「作り直し：
 * タグの人ごと化」）に伴い作り直した。旧実装は`findChoreByTag`（`chores.nfc_tag_id`、
 * 1chore=1タグ）とREPORT_COMPLETIONアクション（`reported_by`=読み取った本人固定）の
 * 2段階だったが、新方式は`report_chore_completion_by_nfc_tag()`RPC（設計部/成果物/
 * スキーマ設計.sql 39.6章）を**1回だけ**呼ぶだけで完結する（事前のSELECTは行わない。
 * 主要画面ワイヤーフレーム.md 7.6.3節「本部長レビューで確定」）。
 *
 * [3ロール共通・固有名詞を出さない] 既存の物理タグに書き込まれたURLは
 * `/child/nfc-scan`で固定されており変更できない（src/lib/nfc.ts:68）ため、子ども・
 * 保護者・みまもりメンバーのいずれがログイン中でもこの画面に到達する
 * （app/child/_layout.tsxのガード解除、108章参照）。C13では「タグをよみとっています」
 * の表示のみで、クエスト名・持ち主名等の固有名詞は一切出さない（7.6.3節）。
 */
export default function NfcScanScreen() {
  const { tagValue } = useLocalSearchParams<{ tagValue?: string }>();
  const { state, refresh } = useAppData();
  const { status, client } = useSession();
  const pulse = useRef(new Animated.Value(0.4)).current;
  const processedRef = useRef(false);

  // 呼び出し本人のmember_id。子どもならactiveChildMemberId、保護者・みまもり
  // メンバーならactiveParentMemberId（store.tsxのコメントどおり、いずれか一方のみが
  // 非空になる設計）。
  const myMemberId = status === "child" ? state.activeChildMemberId : state.activeParentMemberId;
  const tone = status === "child" ? "child" : status === "supporter" ? "supporter" : "parent";

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
      void process();
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

    // API仕様.md 4a-2章手順2「代理報告RPC呼び出し」。
    const res = await reportChoreCompletionByNfcTag(client, { tag_value: tagValue, note: null });

    if (!res.ok) {
      if (res.error.code === PG_ERRCODE.checkViolation) {
        // 上限到達。RAISE EXCEPTIONのため行データを返さず、クエスト名・持ち主名の
        // いずれも取得できない（自分・代理を区別しない汎用文言、7.6.4節）。
        router.replace({ pathname: "/child/nfc-complete", params: { result: "limitReached" } });
      } else {
        router.replace({ pathname: "/child/nfc-complete", params: { result: "networkError", tagValue } });
      }
      return;
    }

    if (!res.data) {
      // タグ未登録／他家族／解除済み／削除済みクエストのタグ、いずれも単一の0件に
      // 収束する（39.6章「0件への収束」）。
      router.replace({ pathname: "/child/nfc-complete", params: { result: "notFound" } });
      return;
    }

    // 家族データ（通帳・実施履歴等）を最新化しておく（通常の完了報告のdispatchが
    // 内部で`await load()`するのと同じく、ホームへ戻ったときに反映されているように
    // 遷移前に待つ）。
    await refresh();

    const isProxy = res.data.member_id !== myMemberId;
    router.replace({
      pathname: "/child/nfc-complete",
      params: {
        result: "approved",
        choreTitle: res.data.chore_title,
        choreEmoji: res.data.chore_emoji,
        points: String(res.data.points),
        ownerMemberId: res.data.member_id,
        ownerDisplayName: res.data.member_display_name,
        isProxy: isProxy ? "1" : "0",
      },
    });
  };

  return (
    <Screen tone={tone}>
      <View style={styles.center}>
        <Animated.Text style={[styles.icon, { opacity: pulse }]}>📶 · · ·</Animated.Text>
        <Text
          style={[
            tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody,
            { marginTop: theme.spacing.s4 },
          ]}
        >
          タグをよみとっています…
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  icon: { fontSize: 40 },
});
