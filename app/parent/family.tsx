import React, { useEffect, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import theme from "@/theme/theme";
import { Text } from "react-native";
import { useAppData } from "@/data/store";
import { useSession } from "@/lib/session";
import { fetchFamilyInvites, removeMember, revokeFamilyInvite, updateMemberDisplayName } from "@/data/api";
import type { FamilyInvite } from "@/types/domain";

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
  const { client } = useSession();
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [invites, setInvites] = useState<FamilyInvite[]>([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // 名前を編集中のメンバーID（1人ずつ・カード内で完結させ、画面遷移を増やさない）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [savingName, setSavingName] = useState(false);

  const activeMembers = state.members.filter((m) => m.is_active);
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
      <Text style={theme.typography.parentTitle}>家族管理</Text>

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
        {activeMembers.map((m) => (
          <Card key={m.id} style={{ flexDirection: "row", alignItems: "center", gap: theme.spacing.s3 }}>
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
            {editingId !== m.id && (
              <View style={{ gap: theme.spacing.s2 }}>
                {/* 名前変更は役割を問わず保護者が全員に対して行える（RLS側も同条件）。 */}
                <AppButton
                  label="名前を変更"
                  variant="secondary"
                  onPress={() => startEditName(m.id, m.display_name)}
                  disabled={processingId !== null || editingId !== null}
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
                      disabled={processingId !== null || editingId !== null}
                    />
                    <AppButton
                      label={processingId === m.id ? "処理中…" : "退会させる"}
                      variant="secondary"
                      onPress={() => removeChild(m.id)}
                      disabled={processingId !== null || editingId !== null}
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
                    disabled={processingId !== null || editingId !== null}
                  />
                )}
              </View>
            )}
          </Card>
        ))}
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
      <AppButton label="ホームへ戻る" variant="ghost" style={{ marginTop: theme.spacing.s3 }} onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  nameInput: {
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    paddingHorizontal: theme.spacing.s3,
    paddingVertical: theme.spacing.s2,
    backgroundColor: theme.colors.neutralSurface,
  },
});
