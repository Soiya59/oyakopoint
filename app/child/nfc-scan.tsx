import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Screen from "@/components/Screen";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { reportChoreCompletionByNfcTag, PG_ERRCODE } from "@/data/api";
import { usePendingNfcLink } from "@/lib/pendingNfcLink";

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
 * `/child/nfc-scan`で固定されており変更できない（src/lib/nfc.web.ts、
 * NFC_SCAN_PATH＝src/lib/nfc.shared.ts）ため、子ども・
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
  const { consume: consumePendingNfcLink } = usePendingNfcLink();

  // [2026-09-13追加・実装メモ.md 213.9章／本部長差し戻し対応] 「起動時URL由来の
  // 保留」は、経路（expo-routerが起動時URLの解決に成功して直接この画面に来た場合・
  // app/index.tsxが213.4章のロジックで転送してきた場合のどちらでも）を問わず、
  // この画面に到達した時点で必ず消費する。消費しないと、expo-routerが起動時URL
  // 解決に成功して直接この画面へ来たケース（150msのレースに勝てた場合）で
  // `PendingNfcLinkProvider`の`tagValue`が文字列のまま残り続け、その後
  // `app/child/_layout.tsx`のstale-sessionガードや`logoutChild()`等でようこそ画面
  // （`/`）に戻った瞬間、`app/index.tsx`のeffectが残っていた`tagValue`を拾って
  // 再度この画面へ遷移し、**同じタグで報告RPCをもう一度投げてしまう**
  // （`processedRef`は画面ごとのrefのため、再遷移＝再マウントでは二重発火防止の
  // 役に立たない）。マウント時に必ず`consume()`することで、この画面に来た理由が
  // どちらであっても「保留」は役目を終えたことにする。
  useEffect(() => {
    consumePendingNfcLink();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 呼び出し本人のmember_id。子どもならactiveChildMemberId、保護者・みまもり
  // メンバーならactiveParentMemberId（store.tsxのコメントどおり、いずれか一方のみが
  // 非空になる設計）。
  const myMemberId = status === "child" ? state.activeChildMemberId : state.activeParentMemberId;
  const tone = status === "child" ? "child" : status === "supporter" ? "supporter" : "parent";

  // [2026-09-13変更・実装メモ.md 215章／主要画面ワイヤーフレーム.md 7.6.5節B-2案]
  // 従来は1周期1秒（500ms×2）だったが、この画面の表示時間は215章で700msの
  // 人工的な待ちを撤去した結果1秒未満（実測の通信時間のみ）になり、1周期も
  // 回りきらないまま遷移することが多くなった。B-2案の「1周期300ms程度」を
  // そのまま採用し、150ms×2＝1周期300msにした（提案どおりの素直な値。これ以上
  // 速めると呼吸というより点滅に見え、7.2節の「やわらかいパルス」という
  // トーンを損なうおそれがあるため、提案値から動かしていない）。
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 150, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 150, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    // [2026-09-13追加・実装メモ.md 213章] `status`が確定する前（"loading"）は
    // `client`（55行目`childClient ?? supabase`）が未確定・未認証の可能性があるため、
    // 報告RPCを投げない。現状のapp/child/_layout.tsxのガード・
    // src/data/store.tsxのローディングゲートにより、この画面が
    // `status === "loading"`のままマウントされることは無い設計だが、
    // 依頼（やること.md 2-4）により念のための防御として追加した。
    //
    // [2026-09-13削除・実装メモ.md 215章] ここに以前あった`setTimeout(..., 700)`は
    // 待ち時間に仕様上の根拠が無い（主要画面ワイヤーフレーム.md 7.2節はこの画面を
    // 「処理は一瞬で終わる想定」「橋渡し表示」とのみ定めており、待ち時間の指定は
    // 無い）ため撤去した。二重発火防止（`processedRef`）は`process()`内部にあるため
    // ここで即時に呼び出しても安全。
    if (status === "loading") return;
    void process();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagValue, status]);

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
