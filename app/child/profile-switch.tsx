import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import MemberAvatar from "@/components/MemberAvatar";
import { EmptyState, ErrorState, SkeletonList } from "@/components/StatusViews";
import theme from "@/theme/theme";
import { useSession } from "@/lib/session";
import { inviteLookup, InviteLookupChild } from "@/data/api";

/**
 * C12 プロフィール切替（共有端末用）
 * 参照: 画面一覧・遷移図.md C12。「C2に戻る形の簡易導線」との指定どおり、
 * プロフィール選択画面と同等のUIを再利用する。
 *
 * [設計判断の補完] 実接続では「切替」とは、いま有効な子どもJWTを破棄して
 * 別プロフィールでchild-loginをやり直すことを意味する。招待コードの再入力を
 * 省くため、ログイン中の子どもセッションが保持している inviteCode
 * （src/lib/childSession.ts）を再利用してinvite-lookupを呼び直し、
 * 最新のプロフィール一覧を取得する。
 *
 * [2026-08-18追加・本部長] 子どもセッションから完全にログアウトしてトップ画面
 * （保護者ログイン等）へ戻る導線がこの画面にしか無いにもかかわらず、
 * 従来は「別の子どもへの切替」のみで「保護者に戻る」選択肢が無かった。
 * 共有端末（PC等）で子どもセッションが有効なまま保護者としてメール登録しようとすると、
 * src/lib/session.tsxのonAuthStateChangeが「子どもセッションが有効な間は
 * 保護者側のAuth状態変化を無視する」設計になっているため、保護者ログインが
 * 静かに無視され、子どもアカウントから一切抜け出せなくなる不具合をユーザーが
 * 実機で発見した。ここに明示的な「ログアウトする」導線を追加した。
 */
type LoadState = "loading" | "error" | "ready";

export default function ProfileSwitchScreen() {
  const { childSession, logoutChild } = useSession();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [children, setChildren] = useState<InviteLookupChild[]>([]);

  const load = async () => {
    if (!childSession) return;
    setLoadState("loading");
    const res = await inviteLookup(childSession.inviteCode);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setChildren(res.data.children);
    setLoadState("ready");
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childSession?.inviteCode]);

  const selectProfile = async (c: InviteLookupChild) => {
    // 別プロフィールに切り替える前に、いま有効な子どもJWTセッションを破棄する
    // （child-loginで新しいJWTを取得し直すまでの一時的な未ログイン状態）。
    await logoutChild();
    router.replace({
      pathname: "/child-auth/pin-input",
      params: { inviteCode: childSession?.inviteCode, memberId: c.member_id, displayName: c.display_name },
    });
  };

  const logout = async () => {
    // [2026-08-29] 同じ端末に保護者のログインが残っていれば、そこへ復帰する。
    // 残っていなければ logoutChild 側が signedOut にするので、下の replace("/") で
    // トップへ出る（従来どおり）。子ども同士の切り替え（selectProfile）では
    // 復帰させてはいけないため、こちらだけ returnToParent を渡す。
    await logoutChild({ returnToParent: true });
    router.replace("/");
  };

  return (
    <Screen tone="child">
      <Text style={theme.typography.childHeadline}>だれにきりかえる？</Text>

      {loadState === "loading" && (
        <View style={{ marginTop: theme.spacing.s6 }}>
          <SkeletonList count={2} />
        </View>
      )}
      {loadState === "error" && (
        <ErrorState tone="child" title="つうしんがおやすみ中みたい" onRetry={load} />
      )}
      {loadState === "ready" && children.length === 0 && (
        <EmptyState tone="child" emoji="🙂" title="ほかのプロフィールが見つからなかったよ" />
      )}
      {loadState === "ready" && children.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s4, marginTop: theme.spacing.s6 }}>
          {children.map((c) => (
            <Pressable
              key={c.member_id}
              onPress={() => selectProfile(c)}
              style={{
                width: 140,
                minHeight: theme.tapTarget.childPrimary,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.neutralSurface,
                borderRadius: theme.radius.childXl,
                padding: theme.spacing.s4,
                gap: theme.spacing.s2,
                borderWidth: c.member_id === childSession?.member.member_id ? 2 : 0,
                borderColor: theme.colors.brandPrimary,
              }}
            >
              <MemberAvatar name={c.display_name} color={c.avatar_color} size={64} />
              <Text style={theme.typography.childBody}>{c.display_name}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* [2026-08-29修正・本部長] 従来のラベルは「ログアウトする（保護者ログイン等は
          トップから）」で、実際そのとおり必ずトップ画面へ戻されていた。
          src/lib/session.tsx の logoutChild を修正し、**同じ端末に保護者のログインが
          残っていればそのまま保護者へ戻る**ようにしたため、文言を実態に合わせる。
          保護者でログインしたことがない端末では、従来どおりトップ画面へ出る。 */}
      <AppButton
        label="おうちの人にもどる"
        variant="secondary"
        style={{ marginTop: theme.spacing.s8 }}
        onPress={logout}
      />
      <Text
        style={[
          theme.typography.childBody,
          { marginTop: theme.spacing.s2, color: theme.colors.neutralTextSecondary, textAlign: "center" },
        ]}
      >
        おうちの人が このスマホで ログインしていないときは、さいしょのがめんに もどるよ
      </Text>
    </Screen>
  );
}
