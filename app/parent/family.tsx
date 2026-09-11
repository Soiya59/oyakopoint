import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { Text } from "react-native";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import {
  PG_ERRCODE,
  fetchFamilyInvites,
  removeMember,
  resetStickerTier,
  revokeFamilyInvite,
  updateFamilyName,
  updateMemberAvatarColor,
  updateMemberDisplayName,
} from "@/data/api";
import type { FamilyInvite } from "@/types/domain";
import { resolveAvatarColorOptions } from "@/lib/avatarColorAvailability";
import ExternalLinkRow from "@/components/ExternalLinkRow";
import { HELP_CHILD_URL, HELP_PARENT_URL, HELP_SUPPORTER_URL, LEGAL_PAGES_PUBLISHED, PRIVACY_POLICY_URL, TERMS_URL } from "@/lib/legalLinks";
// [2026-09-11新設・要件定義書07-25-1章決定20〜27、UIUXデザイン部/成果物/主要画面
// ワイヤーフレーム.md 40.1節] メダルの段階リセット（P14拡張「メダルの設定」）。
// 形の日本語表記はStickerShopPanel.tsx（買う画面）と同じものを再利用し、
// 名称の食い違いを防ぐ（新しい部品は作らない）。
import { rarityLabel, shapeLabel } from "@/components/StickerShopPanel";
import { computeHighestEverPurchasedRarity, useFamilyStickerPurchasesForLock } from "@/hooks/useStickers";
import type { StickerShape } from "@/theme/theme";

/** やること.md 2-23（サマリー表#5、Apple 1.2 "Published contact information"）。
 *  2026-09-09に統括が決定。宣伝部CLAUDE.md記載のPlay Console公開用アドレスと同一。 */
const CONTACT_EMAIL = "soiyalab.contact@gmail.com";

/** 表示名の最大文字数（MemberAvatarの頭文字表示・木の内訳表示が崩れない長さ）。 */
const NAME_MAX_LENGTH = 12;

/**
 * P14 家族管理（メンバー一覧・招待・子ども追加の起点）
 * 参照: 画面一覧・遷移図.md P14、API仕様.md 2章
 *
 * [2026-08-15追加] 子どもプロフィールの退会（remove-member の soft_remove
 * モード）操作を追加した。認証・データ管理設計書.md 3.4章のとおり、保護者
 * （role='parent'）を退会させられるのは本人のみのため、ここでは子ども
 * （role='child'）にのみ「退会させる」ボタンを表示する。
 *
 * [2026-08-22追加] みまもりメンバー招待導線（要件定義書07-7章、画面一覧・遷移図.md
 * P14拡張・P23・P24）を追加した。「みまもりメンバーを招待する」ボタン（→P23）と、
 * 発行済み招待の一覧（招待中／参加済み／取消済み）を表示する。
 *
 * [2026-08-27追加・本部長] メンバーの表示名変更を追加した。家族名・お手伝い名・ごほうび名は
 * 変更できたのに、メンバー名だけは作成時に決めたきり変えられなかった（実際に本番家族で
 * 「jiji」のような仮の名前が残っていた）。
 * 当初は「本人も自分の名前を変えられる」案だったが、子ども側には設定画面が存在せず
 * 新たな導線の追加が必要になるため、ユーザー判断で**保護者のみが家族全員の名前を変更する**
 * 形に絞った（みまもりメンバーの自己変更はS13に1枚足せば後から拡張できる）。
 * 権限はDB側の既存RLS`family_members_update_scoped`がそのまま担保するため、
 * マイグレーションは追加していない。
 */
export default function FamilyScreen() {
  const { state, refresh } = useAppData();
  const { client, parentMember, logoutParent } = useSession();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [invites, setInvites] = useState<FamilyInvite[]>([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // 名前を編集中のメンバーID（1人ずつ・カード内で完結させ、画面遷移を増やさない）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);

  // [2026-09-01追加] 色を編集中のメンバーID。名前編集（editingId）とは独立した状態だが、
  // 「同時に2つの編集を開かせない」（主要画面ワイヤーフレーム.md 25.1節）ため、
  // 色の編集を開始する際は必ず名前編集も閉じる（逆も同様、下記startEditName参照）。
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState<string | null>(null);
  const [usedColorMessage, setUsedColorMessage] = useState<string | null>(null);
  const [confirmingColorChange, setConfirmingColorChange] = useState(false);
  const [savingColor, setSavingColor] = useState(false);
  const [colorError, setColorError] = useState<string | null>(null);
  // 保存成功後、カードを閉じたあとも数秒だけ「色を変更しました」を表示する
  // （25.1節「保存成功」状態。全画面演出はしない控えめなインライン表示）。
  const [colorSuccessId, setColorSuccessId] = useState<string | null>(null);

  const activeMembers = state.members.filter((m) => m.is_active);
  // 「こどもモードにする」で profile-select へ渡す子ども一覧。
  // invite-lookup Edge Function が返す InviteLookupChild と同じ形に揃える
  // （member_id / display_name / avatar_color）。
  const childProfiles = activeMembers
    .filter((m) => m.role === "child")
    .map((m) => ({ member_id: m.id, display_name: m.display_name, avatar_color: m.avatar_color }));

  // supporterはfamily_members一覧（activeMembers）にすでに含まれる（accept_family_invite後）ため
  // 別枠での表示は不要。ここでは「まだ参加していない招待」（pending/revoked）のみ一覧する。

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!state.family.id) return;
      const res = await fetchFamilyInvites(client, state.family.id);
      if (!mounted) return;
      if (res.ok) {
        setInvites(res.data);
        setInvitesLoaded(true);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.family.id]);

  const removeChild = async (memberId: string) => {
    setProcessingId(memberId);
    setErrorMessage(null);
    const res = await removeMember(memberId, "soft_remove");
    setProcessingId(null);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    void refresh();
  };

  // みまもりメンバー自身の退会も同じremove-member(soft_remove)を使う
  // （supabase/functions/_shared/parentAuth.ts resolveFamilyMemberCaller対応、
  // 実装メモ.md 59.3.2章参照。保護者側からも他のみまもりメンバーを退会させられる）。
  const removeSupporter = async (memberId: string) => {
    setProcessingId(memberId);
    setErrorMessage(null);
    const res = await removeMember(memberId, "soft_remove");
    setProcessingId(null);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    void refresh();
  };

  const startEditName = (memberId: string, currentName: string) => {
    setErrorMessage(null);
    setEditingId(memberId);
    setDraftName(currentName);
    // 名前編集と色編集を同時に開かせない（25.1節）。
    cancelEditColor();
  };

  const cancelEditName = () => {
    setEditingId(null);
    setDraftName("");
  };

  const saveName = async (memberId: string) => {
    const name = draftName.trim();
    if (name.length === 0) {
      setErrorMessage("名前を入力してください。");
      return;
    }
    setSavingName(true);
    setErrorMessage(null);
    const res = await updateMemberDisplayName(client, memberId, name);
    setSavingName(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    cancelEditName();
    void refresh();
  };

  // ============================================================
  // [2026-09-01追加] メンバーカラーの変更（P14拡張、主要画面ワイヤーフレーム.md 25.1節）。
  // ============================================================
  const startEditColor = (memberId: string, currentColor: string | null) => {
    setErrorMessage(null);
    setColorError(null);
    setUsedColorMessage(null);
    setConfirmingColorChange(false);
    setColorSuccessId(null);
    setEditingColorId(memberId);
    setDraftColor(currentColor ?? theme.memberColorPalette[0].value);
    // 名前編集と色編集を同時に開かせない（25.1節）。
    cancelEditName();
  };

  const cancelEditColor = () => {
    setEditingColorId(null);
    setDraftColor(null);
    setUsedColorMessage(null);
    setConfirmingColorChange(false);
    setColorError(null);
  };

  const selectDraftColor = (colorValue: string, usedByName: string | null) => {
    if (usedByName) {
      setUsedColorMessage(`この色は、今${usedByName}さんが使っています`);
      return;
    }
    setUsedColorMessage(null);
    setDraftColor(colorValue);
  };

  /** 「保存」タップ。今の色と異なる場合のみ、保存前の軽い確認を挟む（25.0決定3）。 */
  const requestSaveColor = (currentColor: string | null) => {
    if (!draftColor || draftColor === currentColor) return; // 変更なしは何もしない
    setColorError(null);
    setConfirmingColorChange(true);
  };

  /** 確認モーダルの「変更する」タップ。実際の保存を行う。 */
  const confirmSaveColor = async (memberId: string) => {
    if (!draftColor) return;
    setSavingColor(true);
    setColorError(null);
    const res = await updateMemberAvatarColor(client, memberId, draftColor);
    setSavingColor(false);
    if (!res.ok) {
      // 25.1節「保存失敗」: パレットは開いたまま再試行できるよう、確認だけ閉じて戻す。
      setConfirmingColorChange(false);
      setColorError(
        res.error.code === PG_ERRCODE.uniqueViolation
          ? "この色は、ちょうど他の方が選んだため使えなくなりました。もう一度お試しください"
          : "変更できませんでした。もう一度お試しください"
      );
      return;
    }
    cancelEditColor();
    setColorSuccessId(memberId);
    void refresh();
    // 数秒だけ表示して自動的に消す（25.1節「保存成功」）。
    setTimeout(() => setColorSuccessId((prev) => (prev === memberId ? null : prev)), 4000);
  };

  // ============================================================
  // [2026-08-29統合・本部長／軽微変更ルート] 旧P17「設定」の中身をこの画面へ移した。
  //
  // ユーザーの「設定に家族をいれてもよいかも」という提案に対し、本部長から
  // **向きが逆**であると指摘した。設定には「家族を削除する」という不可逆な操作が
  // あり、家族管理には招待コード・PIN設定という日常的に開く操作がある。
  // よく使うものを、めったに使わない危険な画面の下に埋めることになるため、
  // 設定を家族へ入れる形にした（ユーザー同意済み）。
  // ホームのメニュータイルは「⚙️ 設定」1つに統合し、「家族」タイルは廃止した。
  // ============================================================
  const me = parentMember;
  const [processing, setProcessing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [familyName, setFamilyName] = useState(state.family.name);
  // 既存のsavingName（メンバー表示名の保存中フラグ）と衝突するため別名にしている。
  const [savingFamilyName, setSavingFamilyName] = useState(false);
  const [nameSaved, setNameSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  // ============================================================
  // [2026-09-11新設・要件定義書07-25-1章決定20〜27、UIUXデザイン部/成果物/
  // 主要画面ワイヤーフレーム.md 40.1節] メダルの段階リセット「メダルの設定」。
  // 決定4・決定5の状態表示・非活性化判定には、家族の形ごとの生の購入実績
  // （reset_atを問わない）が必要（設計部/成果物/スキーマ設計.sql 52.6章）。
  // 既存の`useFamilyStickerPurchasesForLock`（買う画面の段階購入制と同じ
  // データ取得）をそのまま再利用し、新しいAPIは追加しない。
  // ============================================================
  type TierShapeSelection = StickerShape | "all";
  const {
    loadState: tierPurchasesLoadState,
    purchases: tierFamilyPurchases,
    reload: reloadTierFamilyPurchases,
  } = useFamilyStickerPurchasesForLock(state.family.id);
  const [selectedTierShape, setSelectedTierShape] = useState<TierShapeSelection | null>(null);
  const [confirmingTierReset, setConfirmingTierReset] = useState(false);
  const [tierResetting, setTierResetting] = useState(false);
  const [tierResetError, setTierResetError] = useState<string | null>(null);
  const [tierResetSuccessMessage, setTierResetSuccessMessage] = useState<string | null>(null);

  const selectTierShape = (shape: TierShapeSelection) => {
    setConfirmingTierReset(false);
    setTierResetError(null);
    setTierResetSuccessMessage(null);
    setSelectedTierShape((prev) => (prev === shape ? null : shape));
  };

  /** 決定4「いま『◯◯』は{現在の最高解放レアリティ}まで購入できる状態です。」 */
  const tierStatusLineFor = (shape: StickerShape): string => {
    const highest = computeHighestEverPurchasedRarity(tierFamilyPurchases, shape);
    return highest
      ? `いま「${shapeLabel[shape].parent}」は${rarityLabel[highest].parent}まで購入できる状態です。`
      : `「${shapeLabel[shape].parent}」はまだ何も購入されていません。リセットの必要はありません。`;
  };

  /** 決定4「ぜんぶ」選択時: 4形それぞれの状態を1行にまとめる。 */
  const tierAllStatusLine = (): string =>
    theme.stickerShapes
      .map((shape) => {
        const highest = computeHighestEverPurchasedRarity(tierFamilyPurchases, shape);
        return `${shapeLabel[shape].parent}:${highest ? `${rarityLabel[highest].parent}まで` : "まだ何も購入なし"}`;
      })
      .join("／");

  const tierHasAnyPurchase = (shape: StickerShape): boolean => computeHighestEverPurchasedRarity(tierFamilyPurchases, shape) !== null;

  /** 決定7の確認文言・1行目（単一の形／「ぜんぶ」で分岐）。 */
  const tierConfirmTitle = (): string => {
    if (!selectedTierShape) return "";
    if (selectedTierShape === "all") {
      return "「ぜんぶ」を選ぶと、カブトムシ・ちょうちょ・おはな・ドラゴンの4つすべてを同時にリセットします。";
    }
    return `「${shapeLabel[selectedTierShape].parent}」を、銅からもう一度集め直せるようにします。`;
  };

  /**
   * 決定6〜8: 二段階確認の「リセットする」タップ。決定21「ぜんぶ」は内部的には
   * 形の数だけ独立にreset_sticker_tier()を呼び出す（設計部決定52-5、配列引数の
   * 一括RPCは不採用）。途中で失敗した場合はそこで止め、それまでに成功した分は
   * 追記専用ログの性質上そのまま残る（取り消し不可、決定24と同じ整理）。
   */
  const confirmTierReset = async () => {
    if (!selectedTierShape) return;
    setTierResetting(true);
    setTierResetError(null);
    const shapesToReset: StickerShape[] = selectedTierShape === "all" ? [...theme.stickerShapes] : [selectedTierShape];
    for (const shape of shapesToReset) {
      const res = await resetStickerTier(client, shape);
      if (!res.ok) {
        setTierResetting(false);
        setTierResetError(
          shapesToReset.length > 1
            ? `「${shapeLabel[shape].parent}」のリセットに失敗しました：${res.error.message}`
            : res.error.message
        );
        return;
      }
    }
    setTierResetting(false);
    setConfirmingTierReset(false);
    const label = selectedTierShape === "all" ? "ぜんぶ" : shapeLabel[selectedTierShape].parent;
    setSelectedTierShape(null);
    setTierResetSuccessMessage(`「${label}」をリセットしました。銅からまた集められます。`);
    // 数秒だけ表示して自動的に消す（25.1節「保存成功」と同型、決定8）。
    setTimeout(() => setTierResetSuccessMessage(null), 4000);
  };

  const saveFamilyName = async () => {
    const trimmed = familyName.trim();
    if (!trimmed || trimmed === state.family.name) return;
    setSavingFamilyName(true);
    setNameError(null);
    setNameSaved(false);
    const res = await updateFamilyName(client, state.family.id, trimmed);
    setSavingFamilyName(false);
    if (!res.ok) {
      setNameError(res.error.message);
      return;
    }
    await refresh();
    setNameSaved(true);
  };

  const doLogout = async () => {
    await logoutParent();
    router.replace("/");
  };

  const doLeaveFamily = async () => {
    if (!me) return;
    setProcessing(true);
    setErrorMessage(null);
    const res = await removeMember(me.id, "soft_remove");
    setProcessing(false);
    if (!res.ok) {
      setErrorMessage(
        res.error.code === "owner_cannot_soft_remove"
          ? "オーナーは先にオーナー権限を委譲するか、家族を削除してください"
          : res.error.message
      );
      return;
    }
    await logoutParent();
    router.replace("/");
  };

  /**
   * [破壊的操作についての事前記録] remove-member の mode:"delete_family" を呼ぶ。
   * families行のDELETE（ON DELETE CASCADEで家族の全データが連動削除される）という
   * 不可逆な操作であり、実際に呼び出すと元に戻せない。
   * 画面側は2段階の確認（ボタン押下→確認表示→確定）を必須にする。
   * （旧app/parent/settings.tsxから移設。開発部CLAUDE.md「破壊的なDB操作は実行前に記録する」）
   */
  const doDeleteFamily = async () => {
    if (!me) return;
    setProcessing(true);
    setErrorMessage(null);
    const res = await removeMember(me.id, "delete_family");
    setProcessing(false);
    if (!res.ok) {
      setErrorMessage(res.error.message);
      return;
    }
    await logoutParent();
    router.replace("/");
  };

  const revokeInvite = async (inviteId: string) => {
    setRevokingId(inviteId);
    const res = await revokeFamilyInvite(client, inviteId);
    setRevokingId(null);
    if (res.ok) {
      setInvites((prev) => prev.map((i) => (i.id === inviteId ? res.data : i)));
    }
  };

  const pendingInvites = invites.filter((i) => i.status === "pending");

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent")} />
      <Text style={theme.typography.parentTitle}>設定</Text>

      <Card style={{ marginTop: theme.spacing.s4 }}>
        <Text style={theme.typography.parentCaption}>招待コード</Text>
        <Text style={[theme.typography.parentTitle, { letterSpacing: 2, marginTop: theme.spacing.s1 }]}>
          {state.family.invite_code}
        </Text>
      </Card>

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s2 }}>
        {activeMembers.map((m) => {
          const isEditingColor = editingColorId === m.id;
          const anyEditOpen = editingId !== null || editingColorId !== null;
          const colorOptions = isEditingColor
            ? resolveAvatarColorOptions(theme.memberColorPalette, state.members, m.id)
            : [];
          const noSelectableColor = isEditingColor && colorOptions.every((c) => c.usedByName !== null);
          return (
          <Card key={m.id} style={{ gap: theme.spacing.s3 }}>
            {colorSuccessId === m.id && (
              <Text style={{ color: theme.colors.brandPrimaryStrong }}>色を変更しました</Text>
            )}
            <View style={{ flexDirection: "row", alignItems: isEditingColor ? "flex-start" : "center", gap: theme.spacing.s3 }}>
            <MemberAvatar name={m.display_name} color={m.avatar_color} />
            <View style={{ flex: 1 }}>
              {editingId === m.id ? (
                <>
                  <TextInput
                    value={draftName}
                    onChangeText={setDraftName}
                    maxLength={NAME_MAX_LENGTH}
                    placeholder="名前"
                    autoFocus
                    editable={!savingName}
                    style={[theme.typography.parentBody, styles.nameInput]}
                  />
                  <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
                    <AppButton
                      label={savingName ? "保存中…" : "保存"}
                      onPress={() => saveName(m.id)}
                      disabled={savingName || draftName.trim().length === 0}
                    />
                    <AppButton label="やめる" variant="ghost" onPress={cancelEditName} disabled={savingName} />
                  </View>
                </>
              ) : isEditingColor ? (
                <>
                  <Text style={theme.typography.parentBodyMedium}>新しい色を選んでください</Text>
                  <View style={styles.colorGrid}>
                    {colorOptions.map((c) => (
                      <Pressable
                        key={c.value}
                        onPress={() => selectDraftColor(c.value, c.usedByName)}
                        style={[
                          styles.colorSwatch,
                          {
                            backgroundColor: c.value,
                            borderWidth: draftColor === c.value ? 3 : 0,
                            opacity: c.usedByName ? 0.4 : 1,
                          },
                        ]}
                      />
                    ))}
                  </View>
                  {usedColorMessage && (
                    <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
                      {usedColorMessage}
                    </Text>
                  )}
                  {noSelectableColor && (
                    <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }}>
                      今選べる色がありません。どなたかが家族を離れると、また選べるようになります。
                    </Text>
                  )}
                  {colorError && (
                    <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>{colorError}</Text>
                  )}
                  {confirmingColorChange ? (
                    <>
                      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s3 }]}>
                        色を変えると、これまで木に記録した色も、新しい色に変わります。よろしいですか？
                      </Text>
                      <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s2 }}>
                        <AppButton
                          label={savingColor ? "変更しています…" : "変更する"}
                          onPress={() => confirmSaveColor(m.id)}
                          disabled={savingColor}
                        />
                        <AppButton
                          label="やめる"
                          variant="ghost"
                          onPress={() => setConfirmingColorChange(false)}
                          disabled={savingColor}
                        />
                      </View>
                    </>
                  ) : (
                    <View style={{ flexDirection: "row", gap: theme.spacing.s2, marginTop: theme.spacing.s3 }}>
                      <AppButton
                        label="保存"
                        onPress={() => requestSaveColor(m.avatar_color)}
                        disabled={!draftColor || draftColor === m.avatar_color || noSelectableColor}
                      />
                      <AppButton label="やめる" variant="ghost" onPress={cancelEditColor} />
                    </View>
                  )}
                </>
              ) : (
                <>
                  <Text style={theme.typography.parentBodyMedium}>{m.display_name}</Text>
                  <Text style={theme.typography.parentCaption}>
                    {m.role === "parent"
                      ? m.is_owner
                        ? "保護者（オーナー）"
                        : "保護者"
                      : m.role === "supporter"
                      ? "🤝 みまもりメンバー"
                      : "子ども"}
                  </Text>
                </>
              )}
            </View>
            {editingId !== m.id && !isEditingColor && (
              <View style={{ gap: theme.spacing.s2 }}>
                {/* 名前変更は役割を問わず保護者が全員に対して行える（RLS側も同条件）。 */}
                <AppButton
                  label="名前を変更"
                  variant="secondary"
                  onPress={() => startEditName(m.id, m.display_name)}
                  disabled={processingId !== null || anyEditOpen}
                />
                {/* [2026-09-01追加] 色の変更（主要画面ワイヤーフレーム.md 25.1節）。
                    名前変更と同じく役割を問わず保護者が全員に対して行える。 */}
                <AppButton
                  label="色を変更"
                  variant="secondary"
                  onPress={() => startEditColor(m.id, m.avatar_color)}
                  disabled={processingId !== null || anyEditOpen}
                />
                {m.role === "child" && (
                  <>
                    {/* [2026-08-16追加・本部長] 既存の子どもにPINを設定・再発行する導線が
                        無かった（P15は新規作成専用のため）。要件定義書10章未決事項「子ども用
                        PINの再発行フロー」への対応。 */}
                    <AppButton
                      label="PINを設定"
                      variant="secondary"
                      onPress={() =>
                        router.push({
                          pathname: "/parent/child-pin-reset",
                          params: { memberId: m.id, displayName: m.display_name },
                        })
                      }
                      disabled={processingId !== null || anyEditOpen}
                    />
                    <AppButton
                      label={processingId === m.id ? "処理中…" : "退会させる"}
                      variant="secondary"
                      onPress={() => removeChild(m.id)}
                      disabled={processingId !== null || anyEditOpen}
                    />
                  </>
                )}
                {/* [2026-08-22追加] みまもりメンバーの退会（07-7章「家族メンバーの招待発行・
                    削除・役割変更などの家族管理操作」は保護者専権。みまもりメンバー自身は
                    S13から自分自身のみ退会できるが、保護者はここから誰でも退会させられる）。 */}
                {m.role === "supporter" && (
                  <AppButton
                    label={processingId === m.id ? "処理中…" : "退会させる"}
                    variant="secondary"
                    onPress={() => removeSupporter(m.id)}
                    disabled={processingId !== null || anyEditOpen}
                  />
                )}
              </View>
            )}
            </View>
          </Card>
          );
        })}
      </View>

      {/* [2026-08-22追加] みまもりメンバー招待導線（P14拡張・P23・P24、要件定義書07-7章）。
          発行済み招待（pending）の一覧と取消ボタンを表示する（API仕様.md 2d章手順2）。 */}
      {invitesLoaded && pendingInvites.length > 0 && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          <Text style={theme.typography.parentBodyMedium}>招待中のみまもりメンバー</Text>
          <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
            {pendingInvites.map((inv) => (
              <Card key={inv.id} style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.s3 }}>
                <View style={{ flex: 1 }}>
                  <Text style={theme.typography.parentBody}>{inv.invited_email}</Text>
                  <Text style={theme.typography.parentCaption}>招待を送りました（返信待ち）</Text>
                </View>
                <AppButton
                  label={revokingId === inv.id ? "処理中…" : "取消"}
                  variant="secondary"
                  onPress={() => revokeInvite(inv.id)}
                  disabled={revokingId !== null}
                />
              </Card>
            ))}
          </View>
        </View>
      )}

      <AppButton
        label="みまもりメンバーを招待する"
        variant="secondary"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.push("/parent/invite-supporter")}
      />
      <AppButton
        label="子どもプロフィールを追加"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.push("/parent/child-profile")}
      />

      {/* ============================================================
          [2026-08-29統合] 旧P17「設定」の内容。上のコメント参照。
          家族の日常運用（招待コード・メンバー・PIN）を上に、家族名の変更と
          不可逆な操作（家族から抜ける・家族を削除する）を下に置く。
          ============================================================ */}
      <View style={styles.settingsDivider} />

      {/* [2026-08-29追加・本部長／軽微変更ルート] 子どもモードへの切り替え。
          ユーザーの指摘「保護者を一回ログアウトするってことかな」への対応。

          直前に「子ども→保護者はログアウトせず戻れる」ようにしたが（実装メモ92章）、
          **その逆向きの導線が存在しなかった**。ログイン済みの保護者がトップ画面へ行くと
          `app/index.tsx` が即座に保護者ホームへ`replace`するため「こどもモードで使う」
          ボタンには到達できず、保護者が子どもモードに入るには設定からログアウトする
          しか手が無かった。そしてログアウトは`supabase.auth.signOut()`を呼ぶため
          **保護者セッションが消え、92章の「戻る」機能が効かなくなる**。片道しか
          直っていなかった。

          ここから入れば`signOut()`を通らないので保護者セッションが端末に残り、
          子ども画面の「おうちの人にもどる」で往復できる。

          配置は「家族の設定」見出しより上＝不可逆な操作（家族から抜ける・削除する）
          から離した位置にしている。日常的に使う切り替えを、危険な操作の隣に置かない。 */}
      {/* [2026-08-29修正・本部長] 招待コードの入力画面を飛ばす。
          ユーザーの指摘「子供モードにするのあとにコードを入力する画面ある、いらないと思う」。
          そのとおりで、**保護者は既に家族に所属しており、アプリが招待コードも子ども一覧も
          手元に持っている**（state.family.invite_code / state.members）。トップ画面から
          入る場合（未ログイン）はコード入力が要るが、この導線では不要だった。
          invite-lookup の呼び出しごと省けるので、通信も1本減る。 */}
      <View style={styles.switchBox}>
        <AppButton
          label="👦 こどもモードにする"
          variant="secondary"
          disabled={childProfiles.length === 0}
          onPress={() =>
            router.push({
              pathname: "/child-auth/profile-select",
              params: {
                inviteCode: state.family.invite_code,
                childrenJson: JSON.stringify(childProfiles),
              },
            })
          }
        />
        <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
          {childProfiles.length === 0
            ? "先に「子どもプロフィールを追加」から登録してください。"
            : "ログアウトはされません。子どもの画面から「おうちの人にもどる」で戻れます。"}
        </Text>
      </View>

      <Text style={[theme.typography.parentBodyMedium, styles.settingsHeading]}>家族の設定</Text>

      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s3 }]}>家族名</Text>
      <TextInput
        value={familyName}
        onChangeText={(t) => {
          setFamilyName(t);
          setNameSaved(false);
        }}
        maxLength={100}
        style={[theme.typography.parentBody, styles.nameInput, { marginTop: theme.spacing.s2 }]}
      />
      {nameError && <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>{nameError}</Text>}
      {nameSaved && !nameError && (
        <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.brandPrimaryStrong }}>変更しました</Text>
      )}
      <AppButton
        label={savingFamilyName ? "保存中…" : "家族名を保存する"}
        variant="secondary"
        style={{ marginTop: theme.spacing.s3 }}
        onPress={saveFamilyName}
        disabled={savingFamilyName || !familyName.trim() || familyName.trim() === state.family.name}
      />

      {/* [2026-09-11新設・要件定義書07-25-1章決定20〜27、UIUXデザイン部/成果物/
          主要画面ワイヤーフレーム.md 40.1節決定1〜8] メダルの段階リセット
          「メダルの設定」。危険度の異なる操作（家族から抜ける・家族を削除する）
          とは列を分け、独立したCardとして家族名の直後に置く（決定1）。
          決定22・27のとおり購入履歴・木の配置・バッジは一切消えないため、
          ボタンは`secondary`のまま（`danger`にしない、決定6）。 */}
      <Card style={{ marginTop: theme.spacing.s6 }}>
        <Text style={theme.typography.parentBodyMedium}>メダルの設定</Text>
        <Text style={[theme.typography.parentBody, { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s2 }]}>
          形ごとに、もう一度 銅から集め直せるようにできます。
        </Text>
        <View style={styles.tierChipRow}>
          {theme.stickerShapes.map((shape) => (
            <Pressable
              key={shape}
              onPress={() => selectTierShape(shape)}
              style={[styles.tierChip, selectedTierShape === shape && styles.tierChipSelected]}
            >
              <Text style={theme.typography.parentBody}>{shapeLabel[shape].parent}</Text>
            </Pressable>
          ))}
          <Pressable onPress={() => selectTierShape("all")} style={[styles.tierChip, selectedTierShape === "all" && styles.tierChipSelected]}>
            <Text style={theme.typography.parentBody}>ぜんぶ</Text>
          </Pressable>
        </View>

        {selectedTierShape && !confirmingTierReset && (
          <View style={{ marginTop: theme.spacing.s3 }}>
            {tierPurchasesLoadState === "loading" ? (
              <Text style={[theme.typography.parentBody, { color: theme.colors.neutralTextSecondary }]}>確認中…</Text>
            ) : tierPurchasesLoadState === "error" ? (
              <>
                <Text style={{ color: theme.colors.statusBlocking }}>読み込みに失敗しました</Text>
                <Pressable onPress={() => reloadTierFamilyPurchases()}>
                  <Text style={[theme.typography.parentBody, { textDecorationLine: "underline", marginTop: theme.spacing.s1 }]}>再試行</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={theme.typography.parentBody}>
                  {selectedTierShape === "all" ? tierAllStatusLine() : tierStatusLineFor(selectedTierShape)}
                </Text>
                <AppButton
                  label={selectedTierShape === "all" ? "「ぜんぶ」をリセットする" : `「${shapeLabel[selectedTierShape].parent}」をリセットする`}
                  variant="secondary"
                  style={{ marginTop: theme.spacing.s3 }}
                  onPress={() => setConfirmingTierReset(true)}
                  disabled={selectedTierShape !== "all" && !tierHasAnyPurchase(selectedTierShape)}
                />
              </>
            )}
          </View>
        )}

        {selectedTierShape && confirmingTierReset && (
          <View style={{ marginTop: theme.spacing.s3, gap: theme.spacing.s2 }}>
            <Text style={theme.typography.parentBody}>{tierConfirmTitle()}</Text>
            <Text style={theme.typography.parentBody}>・今持っているメダルは減りません</Text>
            <Text style={theme.typography.parentBody}>・もう一度、銅から集め直すことになります</Text>
            <Text style={theme.typography.parentBody}>・あとから元に戻すことはできません</Text>
            {tierResetError && <Text style={{ color: theme.colors.statusBlocking }}>{tierResetError}</Text>}
            <AppButton
              label={tierResetting ? "リセットしています…" : "リセットする"}
              variant="secondary"
              onPress={confirmTierReset}
              disabled={tierResetting}
            />
            <AppButton
              label="やめておく"
              variant="ghost"
              onPress={() => {
                setConfirmingTierReset(false);
                setTierResetError(null);
              }}
              disabled={tierResetting}
            />
          </View>
        )}

        {tierResetSuccessMessage && (
          <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.brandPrimaryStrong }}>{tierResetSuccessMessage}</Text>
        )}
      </Card>

      {/* [2026-09-09追加・やること.md 2-28・2-23] 使い方ガイド・プライバシーポリシー・
          利用規約への外部リンクと、運営者への連絡先（Apple 1.2 "Published contact
          information"）。ログアウト・家族の削除の直前に置く（宣伝部の要望どおり）。
          実装メモ.md 181章参照。利用規約（TERMS_URL）は本部長の指示により、
          宣伝部が原稿を完成させ次第公開される予定のURLへ先にリンクを張ってある
          （2026-09-09時点ではまだ404）。 */}
      <Text style={[theme.typography.parentBodyMedium, styles.settingsHeading]}>使い方・お問い合わせ</Text>
      <View style={{ marginTop: theme.spacing.s2 }}>
        <ExternalLinkRow label="使い方ガイド（保護者向け）" url={HELP_PARENT_URL} />
        <ExternalLinkRow label="使い方ガイド（みまもり向け）" url={HELP_SUPPORTER_URL} />
        <ExternalLinkRow label="使い方ガイド（子ども向け）" url={HELP_CHILD_URL} />
        {/* [2026-09-09追加・統括判断] 規約類が未公開の間はこの2本を出さない
            （LEGAL_PAGES_PUBLISHED）。押しても404になるため。制定日が決まり
            ページを書き出したら、定数をtrueにするだけで出る。 */}
        {LEGAL_PAGES_PUBLISHED && (
          <>
            <ExternalLinkRow label="プライバシーポリシー" url={PRIVACY_POLICY_URL} />
            <ExternalLinkRow label="利用規約" url={TERMS_URL} />
          </>
        )}
      </View>
      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s3 }]}>
        お問い合わせ: {CONTACT_EMAIL}
      </Text>

      <View style={{ marginTop: theme.spacing.s6, gap: theme.spacing.s3 }}>
        <AppButton label="ログアウト" variant="secondary" onPress={doLogout} disabled={processing} />
        <AppButton
          label={processing ? "処理中…" : "家族から抜ける"}
          variant="secondary"
          onPress={doLeaveFamily}
          disabled={processing}
        />
        {me?.is_owner ? (
          confirmingDelete ? (
            <View style={{ gap: theme.spacing.s2 }}>
              <Text style={{ color: theme.colors.statusBlocking }}>
                本当に「{state.family.name}」を削除しますか？この操作は取り消せません（すべてのクエスト・完了報告・ごほうび履歴が削除されます）。
              </Text>
              <AppButton
                label={processing ? "削除中…" : "本当に削除する"}
                variant="danger"
                onPress={doDeleteFamily}
                disabled={processing}
              />
              <AppButton label="キャンセル" variant="ghost" onPress={() => setConfirmingDelete(false)} disabled={processing} />
            </View>
          ) : (
            <AppButton label="家族を削除する" variant="danger" onPress={() => setConfirmingDelete(true)} disabled={processing} />
          )
        ) : null}
      </View>

      <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s4, color: theme.colors.neutralTextSecondary }]}>
        「家族を削除する」はオーナーにのみ表示されます。
      </Text>

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.replace("/parent")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  settingsDivider: {
    marginTop: theme.spacing.s8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutralBorder,
  },
  switchBox: { marginTop: theme.spacing.s6, gap: theme.spacing.s2 },
  settingsHeading: {
    marginTop: theme.spacing.s6,
    color: theme.colors.brandPrimaryStrong,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    backgroundColor: theme.colors.neutralSurface,
  },
  // [2026-09-01追加] 色変更UI（P14拡張）。child-profile.tsx（P15）と同じ寸法・
  // 見た目に揃える（25.0決定2「両画面とも同じ見せ方で統一する」）。
  colorGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s2 },
  colorSwatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderColor: theme.colors.neutralTextPrimary,
  },
  // [2026-09-11新設・UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 40.1節
  // 決定3・40.9節2.] `app/parent/chore-edit.tsx`の絵文字選択チップと同じ
  // `chip`/`chipSelected`のスタイル値（枠線色・背景色）を流用する。共通部品化は
  // されていないため値だけ揃える（新しい部品は作らない）。
  tierChipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2, marginTop: theme.spacing.s3 },
  tierChip: {
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  tierChipSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
});
