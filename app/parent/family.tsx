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
  revokeFamilyInvite,
  updateMemberAvatarColor,
  updateMemberDisplayName,
} from "@/data/api";
import type { FamilyInvite } from "@/types/domain";
import { resolveAvatarColorOptions } from "@/lib/avatarColorAvailability";
import ExternalLinkRow from "@/components/ExternalLinkRow";
import AppVersionInfo from "@/components/AppVersionInfo";
import {
  HELP_CHILD_URL,
  HELP_PARENT_URL,
  HELP_SUPPORTER_URL,
  LEGAL_PAGES_PUBLISHED,
  PRIVACY_POLICY_URL,
  TERMS_URL,
  TIPS_URL,
} from "@/lib/legalLinks";

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
 *
 * [2026-09-21改訂・本部長依頼／UIUXデザイン部・主要画面ワイヤーフレーム.md 59章]
 * 「つけ足しつけ足しで整理されていない」という統括の指摘に対応し、次の3点を
 * この画面から動かした・畳んだ（決定1〜3・16〜19）。
 * - 家族名の変更・「家族のやりとりの設定」トグル → P40「家族の設定」
 *   （app/parent/family-settings.tsx）へ移設（59.2節）。
 * - ログアウト・家族から抜ける・アカウントを削除する（新設）・家族を削除する
 *   → P41「アカウントについて」（app/parent/account.tsx）へ移設（59.3節）。
 * - 「👦 こどもモードにする」ボタンは削除した。`ParentTabHeader`（左上の
 *   アバター＋名前）と遷移先が完全に重複していたため（59.8節決定19〜21）。
 * - メンバーカードは「常時見える行」（名前・役割・この人の書き込みチップ）と
 *   「▸/▾ くわしく操作する」で開閉する低頻度の操作（名前変更・色変更・絵を
 *   描く・PIN設定・退会させる）に分けた（59.7節決定16〜18）。
 */
export default function FamilyScreen() {
  const { state, refresh, memberAvatars } = useAppData();
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
  // [2026-09-21追加・主要画面ワイヤーフレーム.md 59.7節決定16〜17] メンバー
  // カードの「▸/▾ くわしく操作する」開閉状態。カードごとに独立し、既定は
  // 全カード閉じた状態。名前・色の同時編集を防ぐanyEditOpen（既存）とは
  // 別物で、複数枚を同時に開いてよい。
  const [expandedMemberIds, setExpandedMemberIds] = useState<Record<string, boolean>>({});
  const toggleMemberExpanded = (memberId: string) =>
    setExpandedMemberIds((prev) => ({ ...prev, [memberId]: !prev[memberId] }));

  const activeMembers = state.members.filter((m) => m.is_active);
  const me = parentMember;

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
          const isExpanded = !!expandedMemberIds[m.id];
          const colorOptions = isEditingColor
            ? resolveAvatarColorOptions(theme.memberColorPalette, state.members, m.id)
            : [];
          const noSelectableColor = isEditingColor && colorOptions.every((c) => c.usedByName !== null);
          return (
          <Card key={m.id} style={{ gap: theme.spacing.s3 }}>
            {colorSuccessId === m.id && (
              <Text style={{ color: theme.colors.brandPrimaryStrong }}>色を変更しました</Text>
            )}
            {editingId === m.id ? (
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.s3 }}>
                <MemberAvatar name={m.display_name} color={m.avatar_color} lineData={memberAvatars[m.id]} expandOnTap />
                <View style={{ flex: 1 }}>
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
                </View>
              </View>
            ) : isEditingColor ? (
              <View style={{ flexDirection: "row", alignItems: "flex-start", gap: theme.spacing.s3 }}>
                <MemberAvatar name={m.display_name} color={m.avatar_color} lineData={memberAvatars[m.id]} expandOnTap />
                <View style={{ flex: 1 }}>
                  <Text style={theme.typography.parentBodyMedium}>新しい色を選んでください</Text>
                  {/* [2026-09-11追加] デザイントークン.md 1.3節 決定12〜14。
                      12色化で似た色が隣接するようになったための注意書き。パレット直前に
                      常時1行表示（タップ時のみ出る「使用中です」表示とは別枠）。
                      新しい部品・トークンは作らず既存のparentCaption/neutralTextSecondaryを流用。 */}
                  <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
                    似た色は近くに並べています。小さな丸だけでは見分けにくいことがあるため、名前もあわせてご確認ください。
                  </Text>
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
                </View>
              </View>
            ) : (
              <>
                {/* [2026-09-21改訂・主要画面ワイヤーフレーム.md 59.7節決定16〜18]
                    常時表示: 名前・役割（アバター付き）と「この人の書き込み」チップ。
                    低頻度の操作（名前変更・色変更・絵を描く・PIN設定・退会させる）は
                    「▸/▾ くわしく操作する」の下へ畳む。 */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.s3 }}>
                  <MemberAvatar name={m.display_name} color={m.avatar_color} lineData={memberAvatars[m.id]} expandOnTap />
                  <View style={{ flex: 1 }}>
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
                  </View>
                  {/* [2026-09-21新設・主要画面ワイヤーフレーム.md 59.7節決定17／
                      2026-09-21統括指示で位置を変更] 折りたたみ記号（▸＝閉／▾＝開）は
                      38・39章で確立済みのものを流用する。カードの下に単独で置くと
                      名前の右側に無駄な余白が残るため、名前・役割と同じ行の右端に置く。 */}
                  <Pressable onPress={() => toggleMemberExpanded(m.id)} style={styles.expandToggleHit}>
                    <Text style={[theme.typography.parentCaption, styles.expandToggleText]} numberOfLines={1}>
                      {isExpanded ? "▾" : "▸"} くわしく操作する
                    </Text>
                  </Pressable>
                </View>

                {isExpanded && (
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
                    {/* [2026-09-11追加・要件定義書07-27章 決定10] アバターを自分で描いた絵に
                        できるようにする機能。名前変更・色変更と同じく役割を問わず保護者が
                        全員に対して行える（決定12）。「絵を描く」ボタンは名前・色編集の
                        インライン展開とは異なり、別画面（P38）へ遷移する
                        （主要画面ワイヤーフレーム.md 43.2節 決定10）。 */}
                    <AppButton
                      label={memberAvatars[m.id] ? "絵をなおす" : "絵を描く"}
                      variant="secondary"
                      onPress={() =>
                        router.push({
                          pathname: "/parent/member-avatar",
                          params: { memberId: m.id, displayName: m.display_name },
                        })
                      }
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
              </>
            )}
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
      {/* [2026-09-16追加・主要画面ワイヤーフレーム.md 45.7.5節、実装メモ.md 227章]
          招待ボタンの直下（本部長承認済み、45.11節2.）。 */}
      <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary }]}>
        はなれて暮らす祖父母など、見て・讃える立場です。家族共有のクエスト・ごほうび・家族の管理には関わりません。
      </Text>
      <AppButton
        label="子どもプロフィールを追加"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.push("/parent/child-profile")}
      />

      {/* ============================================================
          [2026-09-21改訂・主要画面ワイヤーフレーム.md 59.1〜59.3節] 低頻度・
          不可逆に近い操作は、ここから先の2つの入口（P40「家族の設定」・
          P41「アカウントについて」）の奥へ移した。日常操作（招待コード・
          メンバー・PIN）はここまでの第1階層に残る（決定1）。
          ============================================================ */}
      <View style={styles.settingsDivider} />

      <AppButton
        label="家族の設定 →"
        variant="secondary"
        style={{ marginTop: theme.spacing.s6 }}
        onPress={() => router.push("/parent/family-settings")}
      />

      {/* [2026-09-21・統括指示] 「家族の設定 →」と対になる入口なので、間を詰めて
          2つで1組に見えるようにする（同じvariant・同じ幅・狭い間隔）。 */}
      <AppButton
        label="アカウントについて →"
        variant="secondary"
        style={{ marginTop: theme.spacing.s3 }}
        onPress={() => router.push("/parent/account")}
      />

      {/* [2026-09-09追加・やること.md 2-28・2-23] 使い方ガイド・プライバシーポリシー・
          利用規約への外部リンクと、運営者への連絡先（Apple 1.2 "Published contact
          information"）。実装メモ.md 181章参照。利用規約（TERMS_URL）は本部長の指示により、
          宣伝部が原稿を完成させ次第公開される予定のURLへ先にリンクを張ってある
          （2026-09-09時点ではまだ404）。 */}
      <Text style={[theme.typography.parentBodyMedium, styles.settingsHeading]}>使い方・お問い合わせ</Text>
      <View style={{ marginTop: theme.spacing.s2 }}>
        <ExternalLinkRow label="使い方ガイド（保護者向け）" url={HELP_PARENT_URL} />
        <ExternalLinkRow label="使い方ガイド（みまもり向け）" url={HELP_SUPPORTER_URL} />
        <ExternalLinkRow label="使い方ガイド（子ども向け）" url={HELP_CHILD_URL} />
        {/* [2026-09-18追加・主要画面ワイヤーフレーム.md 50.1節決定1〜2、実装メモ.md 247章]
            使い方ガイド列の末尾・法的文書の手前に置く。呼び名に「（保護者向け）」を
            残す理由は50.1節決定2（原本自体が統括操作を前提に書かれているため）。 */}
        <ExternalLinkRow label="うまく使うコツ（保護者向け）" url={TIPS_URL} />
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
      {/* [2026-09-21改訂・要件定義書07-32章 決定30〜32、主要画面ワイヤーフレーム.md
          56.1節 決定1] 既存の静的なテキスト表示を、タップすると開く行に置き換えた
          （P39）。文言・見た目は変更していない（本部長依頼2026-09-21の範囲外事項）。 */}
      <Pressable onPress={() => router.push("/parent/contact")} style={{ paddingVertical: theme.spacing.s2, marginTop: theme.spacing.s1 }}>
        <Text style={[theme.typography.parentBody, { textDecorationLine: "underline" }]}>お問い合わせ</Text>
      </Pressable>

      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s6 }} onPress={() => router.replace("/parent")} />

      {/* [2026-09-17追加・本部長／軽微変更ルート・実装メモ241章] いま動いているバージョンの
          表示。OTA（expo-updates）を使い始めたことで、配布した中身がストアの表示に
          一切出なくなったため、この端末に届いているかを確かめる手段として置く。
          画面の一番下・既存キャプションと同じ見た目（新しい部品は作らない）。 */}
      <AppVersionInfo tone="parent" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  settingsDivider: {
    marginTop: theme.spacing.s8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.neutralBorder,
  },
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
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
  },
  chipSelected: { borderColor: theme.colors.brandPrimary, backgroundColor: theme.colors.brandPrimarySoft },
  // [2026-09-21新設・主要画面ワイヤーフレーム.md 59.7節決定17] 「▸/▾
  // くわしく操作する」の折りたたみトグル。38・39章の既存トークンのみを使う
  // （新しいトークンは作らない）。
  expandToggleHit: { minHeight: theme.tapTarget.parent, justifyContent: "center", alignItems: "flex-end", flexShrink: 0 },
  expandToggleText: { color: theme.colors.brandPrimaryStrong },
});
