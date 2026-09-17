/**
 * 新設「台紙」画面の中身（P38・保護者／S26・みまもりメンバー／子どもは軽量
 * モーダル内で同じ内容を表示、主要画面ワイヤーフレーム.md 49.6章決定16〜18）。
 *
 * ①横スクロールで複数枚を切り替えられる進行中の台紙一覧（HabitCardStripと同じ
 * 表示、決定10〜11）、②各台紙の完成済みアーカイブ一覧（決定17、21.6節「見る▼」
 * 展開と同型）、③（対象が2人以上いる場合）他のメンバーの台紙を見るための
 * メンバー選択（決定18）、④「おわりにする」操作（決定18・19・29）、をまとめて
 * 1つのコンポーネントで担う。P38/S26/子どもモーダルの3箇所から共通で使う。
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import AppButton from "./AppButton";
import Card from "./Card";
import HabitCardStrip from "./HabitCardStrip";
import MemberAvatar from "./MemberAvatar";
import { ErrorState, SkeletonList } from "./StatusViews";
import { useHabitCardFigureGrants, useEndHabitCardAction, type HabitCardWithProgress } from "@/hooks/useHabitCards";
import { getHabitCardKindInfo } from "@/lib/habitCardDisplay";
import { toJstDateString } from "@/lib/calendarDates";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { Chore, FamilyMember, HabitCard, HabitFigureCatalogItem } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";

const TIER_LABEL_ADULT: Record<string, string> = { bronze: "銅", silver: "銀", gold: "金", crystal: "クリスタル" };
const TIER_LABEL_CHILD: Record<string, string> = { bronze: "どう", silver: "ぎん", gold: "きん", crystal: "クリスタル" };

export interface HabitCardBoardProps {
  tone: Tone;
  members: FamilyMember[];
  myMemberId: string;
  selectedMemberId: string;
  onSelectMember: (id: string) => void;
  chores: Chore[];
  catalog: HabitFigureCatalogItem[];
  loadState: LoadState;
  activeCards: HabitCardWithProgress[];
  archivedCards: HabitCard[];
  onRetry: () => void;
  /** 「おわりにする」が成功したら呼ぶ（呼び出し元が一覧を再取得する）。 */
  onEndedCard: () => void;
  /** 「木に飾る→」導線（フィギュア詳細から、既存メダルの導線に合流する画面へ）。個別メンバー選択時（＝自分）のみ表示。 */
  onGoToFigureShelf?: () => void;
}

function ArchivedCardRow({ tone, card }: { tone: Tone; card: HabitCard }) {
  const isChild = tone === "child";
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;
  const [open, setOpen] = useState(false);
  const { loadState, grants } = useHabitCardFigureGrants(open ? card.id : null);

  return (
    <View style={styles.archivedRow}>
      <Pressable onPress={() => setOpen((v) => !v)}>
        <Text style={bodyStyle}>
          {open ? "▾" : "▸"} {toJstDateString(card.archived_at ?? card.updated_at).replace(/-/g, "/")}ごろ おわり
        </Text>
      </Pressable>
      {open && (
        <View style={{ marginLeft: theme.spacing.s3, marginTop: theme.spacing.s1 }}>
          {loadState === "loading" && <Text style={captionStyle}>読み込み中…</Text>}
          {loadState === "error" && <Text style={captionStyle}>読み込みに失敗しました</Text>}
          {loadState === "ready" && grants.length === 0 && <Text style={captionStyle}>獲得したフィギュアはありません</Text>}
          {loadState === "ready" &&
            grants.map((g) => (
              <Text key={g.id} style={captionStyle}>
                {g.habit_figure_catalog?.kind_emoji ?? "🏳️"} {g.habit_figure_catalog?.kind_display_name ?? "台紙"}・
                {(isChild ? TIER_LABEL_CHILD : TIER_LABEL_ADULT)[g.tier]}を獲得
              </Text>
            ))}
        </View>
      )}
    </View>
  );
}

export function HabitCardBoard({
  tone,
  members,
  myMemberId,
  selectedMemberId,
  onSelectMember,
  chores,
  catalog,
  loadState,
  activeCards,
  archivedCards,
  onRetry,
  onEndedCard,
}: HabitCardBoardProps) {
  const isChild = tone === "child";
  const bodyStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
  const captionStyle = isChild ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;
  const { memberAvatars } = useAppData();
  const [confirmingEndId, setConfirmingEndId] = useState<string | null>(null);
  const [endError, setEndError] = useState<string | null>(null);
  const { ending, end } = useEndHabitCardAction();

  const handleEnd = async (habitCardId: string) => {
    setEndError(null);
    const res = await end(habitCardId);
    if (!res.ok) {
      setEndError(res.error.message);
      return;
    }
    setConfirmingEndId(null);
    onEndedCard();
  };

  if (loadState === "loading") return <SkeletonList count={3} />;
  if (loadState === "error") {
    return <ErrorState tone={isChild ? "child" : "parent"} title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"} onRetry={onRetry} />;
  }

  return (
    <View>
      {/* 決定18: メンバーチップは家族全員（本人1人のみならチップ行自体を出さない）。 */}
      {members.filter((m) => m.is_active).length > 1 && (
        <View style={styles.memberRow}>
          {members
            .filter((m) => m.is_active)
            .map((m) => (
              <Pressable
                key={m.id}
                onPress={() => onSelectMember(m.id)}
                style={[styles.memberChip, m.id === selectedMemberId && styles.memberChipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: m.id === selectedMemberId }}
              >
                <MemberAvatar name={m.display_name} color={m.avatar_color} size={20} lineData={memberAvatars[m.id]} />
                <Text style={captionStyle}>{m.id === myMemberId ? (isChild ? "じぶん" : "自分") : m.display_name}</Text>
              </Pressable>
            ))}
        </View>
      )}

      {activeCards.length === 0 && archivedCards.length === 0 && (
        <Text style={[bodyStyle, { marginTop: theme.spacing.s4 }]}>
          {isChild ? "まだ台紙が ないよ" : "まだ台紙がありません"}
        </Text>
      )}

      {activeCards.length > 0 && (
        <HabitCardStrip tone={tone} cards={activeCards} chores={chores} catalog={catalog} onPressCard={() => {}} />
      )}

      {/* 決定18-④「おわりにする」。自分の台紙のときのみ、対象を選んで操作できる。 */}
      {selectedMemberId === myMemberId && activeCards.length > 0 && (
        <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s2 }}>
          {activeCards.map((entry) => {
            const kindInfo = getHabitCardKindInfo(chores.find((c) => c.id === entry.card.chore_id), catalog);
            return (
              <View key={entry.card.id}>
                {confirmingEndId === entry.card.id ? (
                  <Card tone={tone} style={{ gap: theme.spacing.s2 }}>
                    <Text style={bodyStyle}>
                      「{kindInfo.kindEmoji ?? "🏳️"} {kindInfo.kindDisplayName}」の台紙をおわりにしますか？
                    </Text>
                    <Text style={captionStyle}>
                      今までの記録・獲得したフィギュアはそのまま残ります。もう一度0からになります
                    </Text>
                    {endError && <Text style={[captionStyle, { color: theme.colors.statusBlocking }]}>{endError}</Text>}
                    <View style={{ flexDirection: "row", gap: theme.spacing.s2 }}>
                      <AppButton tone={tone} label="やめる" variant="ghost" disabled={ending} onPress={() => setConfirmingEndId(null)} />
                      <AppButton
                        tone={tone}
                        label={ending ? "おわりにしています…" : "おわりにする"}
                        variant="danger"
                        disabled={ending}
                        onPress={() => handleEnd(entry.card.id)}
                      />
                    </View>
                  </Card>
                ) : (
                  <Pressable onPress={() => setConfirmingEndId(entry.card.id)}>
                    <Text style={[captionStyle, styles.endLink]}>
                      「{kindInfo.kindEmoji ?? "🏳️"} {kindInfo.kindDisplayName}」をおわりにする
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </View>
      )}

      {archivedCards.length > 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <Text style={[bodyStyle, { fontWeight: "700" }]}>できあがった台紙（{archivedCards.length}まい）</Text>
          {archivedCards.map((c) => (
            <ArchivedCardRow key={c.id} tone={tone} card={c} />
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  memberRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginBottom: theme.spacing.s3 },
  memberChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.s1,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  memberChipActive: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  archivedRow: { marginTop: theme.spacing.s2 },
  endLink: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
});

export default HabitCardBoard;
