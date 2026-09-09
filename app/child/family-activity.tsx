import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import { EmptyState } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { ChoreCompletion, StampKey } from "@/types/domain";
import { formatDateTimeShort } from "@/lib/calendarDates";

/**
 * かぞくのがんばり（子ども向け、双方向リアクション・子→親方向）
 * 参照: 設計部/成果物/スキーマ設計.sql 15章「双方向リアクション（子→親、次フェーズ）」、
 * 要件定義書.md v0.6 07-6章。
 *
 * [2026-08-20新設・本部長] ユーザーが実機テストを経て「こどもからも他の人に
 * リアクションできるようにしたい」と依頼。15章の設計方針メモ（着手前提2点は
 * 満たされている: 07-4章の親の完了報告はリリース済み、少数家族での実機ベータ
 * テストも実施中）に従い実装した。
 *
 * 15章の方針どおり、対象は**保護者の完了報告のみ**（子ども同士の相互リアクションは
 * 07-6章の対象外のため含めない）。app/parent/approvals.tsx（P8/P9）と同じ
 * 「見る」「（任意で）スタンプ／コメントを贈る」の2操作のみのフィード構成を踏襲しつつ、
 * 子ども向けの見た目・言葉づかいに合わせた。
 *
 * [2026-08-22追加→2026-08-23撤回] 一時的にみまもりメンバーの完了報告も対象に含めて
 * いたが（要件定義書07-7章1回目のスコープ変更「家族共有choreへの参加」が前提だった）、
 * 4回目のスコープ変更でその参加機能自体が撤回されたため、当初（07-6章）の設計どおり
 * 保護者の完了報告のみに戻した。みまもりメンバーは完了報告の「もらう」側には一切
 * ならない（送る側専用）。
 *
 * [2026-08-23再改訂・5回目のスコープ変更] 自分専用choreの公開方針の撤回により、
 * みまもりメンバーは再び完了報告の「もらう」側になった（要件定義書07-7章「双方向
 * リアクション（07-6章）との関係」）。対象をみまもりメンバーの自分専用chore完了報告
 * にも再び拡大する。ただし1回目のスコープ変更で追加し4回目で撤回した「家族共有choreへ
 * の参加」機能を復活させるものではなく、みまもりメンバーの完了報告は引き続き
 * 常に自分専用choreのものである。カードは`supporterAccentSoft`の控えめな配色で
 * 区別し、画面下部に「みまもりメンバーのおてつだいをみる」リンク（→C19）を追加した
 * （画面一覧・遷移図.md C18・C19行参照）。
 *
 * [2026-09-09改訂・要件定義書07-23章、開発部/成果物/実装メモ.md 175章] 統括判断
 * 「子どもどうしの反応を許す」を受け、対象を**保護者・みまもりメンバーに限定せず、
 * 家族内の全員の完了報告**に広げた（子ども同士のスタンプ・コメントを解禁。決定1、
 * コメントも対象に含む）。あわせて、自分自身の完了報告は一覧に出さない（決定2・
 * 自己リアクション禁止。DB側〈`chore_reactions_insert_scoped`・
 * `toggle_chore_reaction_stamp()`〉でも同じ制約を強制しているが、送れない相手を
 * そもそもボタン付きで見せないようにするUI側の対応でもある。07-14章の「ボタン
 * 自体を出さない」方式・app/parent/approvals.tsxの`isOwnCard`と同じ考え方）。
 */
export default function FamilyActivityScreen() {
  const { state, dispatch, reactionsForCompletion, hasReactedWithStamp } = useAppData();
  const [detailTarget, setDetailTarget] = useState<ChoreCompletion | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  // [2026-08-20修正・本部長] app/parent/approvals.tsxと同じ理由・同じ修正。
  // dispatch()の戻り値を確認していなかったため、失敗時に無反応に見えていた。
  const [reactionError, setReactionError] = useState<string | null>(null);

  const myId = state.activeChildMemberId;
  const memberOf = (id: string) => state.members.find((m) => m.id === id);

  // [2026-09-09改訂・要件定義書07-23章決定1] 家族内の全員（保護者・みまもり
  // メンバー・他の子ども）の完了報告を対象にする。従来はrole==='parent'|'supporter'
  // に限定していたが、統括判断「子どもどうしの反応を許す」によりこの絞り込みを
  // 撤廃した。[決定2・自己リアクション禁止] 自分自身の完了報告は
  // `c.reported_by !== myId`で一覧から除外する（送れない相手をボタン付きで
  // 見せない。DB側の禁止と二重の防御）。
  const reactableCompletions = [...state.completions]
    .filter((c) => c.reported_by !== myId)
    .sort((a, b) => new Date(b.reported_at).getTime() - new Date(a.reported_at).getTime());


  // [2026-09-10改訂・実装メモ.md 157章] おくったスタンプをもういちど押すと取消、
  // ちがうスタンプを押すと切替になる（統括指示）。
  const sendStamp = async (completionId: string, stampKey: StampKey) => {
    setReactionError(null);
    const result = await dispatch({ type: "TOGGLE_REACTION_STAMP", completionId, reactedBy: myId, stampKey });
    if (!result.ok) setReactionError("おくれなかったよ。もういちどためしてね");
  };

  const openDetail = (c: ChoreCompletion) => {
    setCommentDraft("");
    setReactionError(null);
    setDetailTarget(c);
  };

  const sendComment = async () => {
    if (!detailTarget) return;
    const body = commentDraft.trim();
    if (!body) return;
    setReactionError(null);
    setSendingComment(true);
    const result = await dispatch({ type: "ADD_REACTION", completionId: detailTarget.id, reactedBy: myId, kind: "comment", commentBody: body });
    setSendingComment(false);
    if (!result.ok) {
      setReactionError("おくれなかったよ。もういちどためしてね");
      return;
    }
    setCommentDraft("");
    setDetailTarget(null);
  };

  return (
    <Screen tone="child">
      {/* [2026-09-09追加・本部長／軽微変更ルート] 統括の実機確認「こどものありがとう
          ポイントを送る画面が、通帳にある。これはわかりにくい。かぞくをひらくと、
          完了報告があるとおもうけど、その一番上に（かぞくのがんばりの右側の空欄）
          配置するのはどうだろうか」。
          子どもの導線だけが弱かった。保護者・みまもりはホームに「💌 感謝ポイント」の
          タイルがあるのに（P7/S1）、子どもは通帳（C8）の右上の小さな文字リンク
          「💌おくる」1本きりだった。しかも通帳は「自分のポイントの記録」を見る場所で、
          ありがとうを送るのは他人に向けた行為であり、噛み合っていない。
          この画面（C18）は家族が何をしたかを見て反応する場所なので、ここが自然。
          通帳側の導線は残す（そこから探す人の道を塞がないため）。
          行はflexWrapにしてある。狭い端末では見出しを切らずに、リンクごと次の行へ
          落ちるようにするため（子ども向け画面で見出しが「かぞくのがんば…」と
          省略されるのは避けたい）。 */}
      <View style={styles.titleRow}>
        <Text style={theme.typography.childHeadline}>👨‍👩‍👧‍👦 かぞくのがんばり</Text>
        <Pressable onPress={() => router.push("/child/gratitude")} hitSlop={8}>
          <Text style={styles.gratitudeLink}>💌 ありがとうをおくる →</Text>
        </Pressable>
      </View>
      <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
        おうちのひとにも「がんばったね」をおくってみよう
      </Text>

      {/* [2026-09-09変更・本部長／軽微変更ルート] 統括の実機確認「やることリストへ戻るが
          一番したなので、報告がたまっていくと、みれない。よって、一番上にもってきてほしい」。
          報告カードは増え続けるため、下端に置いた戻る導線は**使い込むほど遠ざかる**。
          件数に左右されない見出しの直下へ移した。
          [同日・再改訂] 文言は「もどる」にした。統括「やるというのがどこまで浸透するか。
          もどるだけでもよいか？」を受けて子ども画面の表記を数えたところ、**単に
          「もどる」と書いている箇所が14でいちばん多く**、「やることリストへもどる」が9、
          「ホームに もどる」が1と割れていた。「ホーム」は子ども画面のどこにも出てこない
          言葉でもあるため、多数派かつ最短の「もどる」に統一した（統括指示「もどるに
          統一ください」。app/child配下の11か所を一括変更）。 */}
      <AppButton
        label="もどる"
        variant="secondary"
        style={{ marginTop: theme.spacing.s3 }}
        onPress={() => router.replace("/child/home")}
      />

      {reactableCompletions.length === 0 && (
        <EmptyState tone="child" emoji="🌱" title="まだきろくがないよ" />
      )}

      {reactableCompletions.map((c) => {
        const member = memberOf(c.reported_by);
        const isSupporterCard = member?.role === "supporter";
        return (
          <Pressable key={c.id} onPress={() => openDetail(c)}>
            <Card tone="child" style={isSupporterCard ? { ...styles.card, ...styles.cardSupporterTint } : styles.card}>
              <View style={styles.cardTop}>
                <MemberAvatar name={member?.display_name ?? "?"} color={member?.avatar_color} size={32} />
                <Text style={theme.typography.childBody}>{member?.display_name}</Text>
                <Text style={{ flex: 1 }} />
                <Text style={theme.typography.childBody}>
                  {c.chore_emoji} {c.chore_title}
                </Text>
              </View>
              <Text style={styles.dateLabel}>
                {formatDateTimeShort(c.reported_at)}
              </Text>
              <View style={styles.stampRow}>
                {theme.stampDefinitions.map((s) => {
                  const sent = hasReactedWithStamp(c.id, myId, s.key as StampKey);
                  return (
                    <Pressable
                      key={s.key}
                      onPress={() => sendStamp(c.id, s.key as StampKey)}
                      style={[styles.stampBtn, sent && styles.stampBtnSent]}
                    >
                      <Text style={styles.stampEmoji}>
                        {s.emoji}
                        {sent ? "✓" : ""}
                      </Text>
                    </Pressable>
                  );
                })}
                {/* [2026-09-09追加・本部長／軽微変更ルート] 統括の実機確認「保護者画面と
                    同じように+コメントという記載をしてもいいかも。いまは、開かないと
                    コメントができるとわからないので」。P8保護者・S17みまもりのカードには
                    元から同じ位置に「＋コメント」があったのに、C19子どもだけ無く、
                    カードを開くまでひとことを送れることが分からなかった。
                    **本日子ども同士のリアクションを解禁したばかりで（175章）、
                    使えることが見えないと機能が無いのと同じになる。**
                    文言は「＋コメント」ではなく「＋ひとこと」にした。子ども向け画面は
                    この機能を一貫して「ひとこと」と呼んでおり（開いた先の見出しも
                    「ひとことおくる（にんい）」）、カードだけ大人の語にすると
                    押した先で呼び名が変わってしまうため。 */}
                <Text style={{ flex: 1 }} />
                <Pressable onPress={() => openDetail(c)} hitSlop={8}>
                  <Text style={styles.commentLink}>＋ひとこと</Text>
                </Pressable>
              </View>
            </Card>
          </Pressable>
        );
      })}

      {/* [2026-09-09削除・本部長／軽微変更ルート] 「👀 みまもりメンバーのクエストをみる →」
          （C19 app/child/supporter-chores.tsx）への導線を外した。統括「これはいらないと
          思うけどどうかな？」に本部長も同意。C19はおじいちゃん・おばあちゃんが登録した
          自分用のクエスト（ダイエット・運動・勉強）を**タップもできず眺めるだけ**の画面で、
          保育園児に意味のある情報とは言いがたい。みまもりの人が実際にやった報告は
          この画面の一覧に出ており、社会的に意味のある部分は既に見えている。
          **入口はここだけだったため、画面（C19）自体も削除した。**誰も行けない画面を
          残すのは95章で問題になったパターンのため（S10廃止時と同じ方針）。 */}

      <Modal visible={!!detailTarget} transparent animationType="fade" onRequestClose={() => setDetailTarget(null)}>
        <View style={styles.modalBackdrop}>
          <Card tone="child" style={styles.modalCard}>
            {detailTarget &&
              (() => {
                const member = memberOf(detailTarget.reported_by);
                const reactions = reactionsForCompletion(detailTarget.id);
                return (
                  <>
                    <Text style={theme.typography.childHeadline}>
                      {detailTarget.chore_emoji} {detailTarget.chore_title}
                    </Text>
                    <Text style={{ marginTop: theme.spacing.s2 }}>{member?.display_name}が きろくしたよ</Text>
                    <Text style={{ marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }}>
                      {formatDateTimeShort(detailTarget.reported_at)}
                    </Text>

                    <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>とどいたリアクション</Text>
                    {reactions.length === 0 ? (
                      <Text style={{ marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }}>
                        まだだれもリアクションしてないよ
                      </Text>
                    ) : (
                      <View style={{ marginTop: theme.spacing.s1, gap: theme.spacing.s1 }}>
                        {reactions.map((r) => {
                          const reactor = memberOf(r.reacted_by);
                          const stampDef = theme.stampDefinitions.find((s) => s.key === r.stamp_key);
                          return (
                            <Text key={r.id} style={theme.typography.childBody}>
                              {r.kind === "stamp" ? stampDef?.emoji : "💬"} {reactor?.display_name}より
                              {r.kind === "stamp" ? `「${stampDef?.label}」` : `「${r.comment_body}」`}
                            </Text>
                          );
                        })}
                      </View>
                    )}

                    <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>スタンプをおくる</Text>
                    <View style={styles.stampGrid}>
                      {theme.stampDefinitions.map((s) => {
                        const sent = hasReactedWithStamp(detailTarget.id, myId, s.key as StampKey);
                        return (
                          <Pressable
                            key={s.key}
                            onPress={() => sendStamp(detailTarget.id, s.key as StampKey)}
                            style={[styles.stampChip, sent && styles.stampChipSent]}
                          >
                            <Text>
                              {s.emoji} {s.label}
                              {sent ? " ✓" : ""}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Text style={[theme.typography.childBody, { marginTop: theme.spacing.s4 }]}>ひとことおくる（にんい）</Text>
                    <TextInput
                      value={commentDraft}
                      onChangeText={setCommentDraft}
                      placeholder="がんばったね！"
                      multiline
                      maxLength={200}
                      style={styles.textArea}
                    />
                    <AppButton
                      label={sendingComment ? "おくっています…" : "おくる"}
                      tone="child"
                      loading={sendingComment}
                      style={{ marginTop: theme.spacing.s2 }}
                      onPress={sendComment}
                      disabled={!commentDraft.trim() || sendingComment}
                    />

                    {reactionError && (
                      <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>
                        {reactionError}
                      </Text>
                    )}

                    <AppButton
                      label="もどる"
                      variant="ghost"
                      style={{ marginTop: theme.spacing.s3 }}
                      onPress={() => setDetailTarget(null)}
                    />
                  </>
                );
              })()}
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: theme.spacing.s3 },
  // [2026-08-23追加・5回目のスコープ変更] みまもりメンバーの完了報告を
  // `supporterAccentSoft`の控えめな配色で区別する（画面一覧・遷移図.md C18行参照）。
  cardSupporterTint: { backgroundColor: theme.colors.supporterAccentSoft, borderColor: theme.colors.supporterAccent },
  cardTop: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2 },
  titleRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: theme.spacing.s2 },
  gratitudeLink: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  commentLink: { color: theme.colors.brandPrimaryStrong, fontWeight: "700" },
  dateLabel: { marginTop: theme.spacing.s1, fontSize: 12, color: theme.colors.neutralTextSecondary },
  stampRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
  stampBtn: {
    width: theme.tapTarget.child,
    height: theme.tapTarget.child,
    borderRadius: theme.radius.childXl,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampBtnSent: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  stampEmoji: { fontSize: 18 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  modalCard: { width: "100%", maxWidth: 420 },
  stampGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  stampChip: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.childXl,
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stampChipSent: { backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  textArea: {
    marginTop: theme.spacing.s2,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.childXl,
    padding: theme.spacing.s3,
    minHeight: 72,
    textAlignVertical: "top",
    backgroundColor: theme.colors.neutralBg,
  },
});
