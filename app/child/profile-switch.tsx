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
import type { FamilyDrawingLineData } from "@/types/domain";

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
  // [2026-09-11追加・実装メモ205.8章] この画面はinvite-lookupを自分で
  // 呼んでいる（URLパラメータ経由ではない）ため、child_avatarsをそのまま
  // 使ってよい。
  const [avatars, setAvatars] = useState<Record<string, FamilyDrawingLineData>>({});

  const load = async () => {
    if (!childSession) return;
    setLoadState("loading");
    const res = await inviteLookup(childSession.inviteCode);
    if (!res.ok) {
      setLoadState("error");
      return;
    }
    setChildren(res.data.children);
    setAvatars(res.data.child_avatars ?? {});
    setLoadState("ready");
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childSession?.inviteCode]);

  const selectProfile = async (c: InviteLookupChild) => {
    // [2026-09-11修正・本部長／軽微変更ルート] **ここで`logoutChild()`を呼ぶのをやめた。**
    //
    // 従来は「新しいJWTを取り直すまでの一時的な未ログイン状態」として、切り替え先を
    // 選んだ時点で今のセッションを破棄していた。しかしその結果、**次のPIN入力画面(C3)で
    // 「← もどる」を押すと、ようこそ画面（P1「家族を新しくつくる…」）に飛ばされていた。**
    // 統括が実機で発見（2026-09-11）。
    //
    // 理屈: `ChildBackLink`は`router.canGoBack()`がtrueなら`router.back()`する。このとき
    // スタックに残っているのは`/child/home`だが、**セッションを先に捨てているのでそこに
    // 留まれず`/`へ送られ、未ログインのP1がそのまま表示され続ける**（`app/index.tsx`は
    // statusがsignedOutのとき転送先が無い）。端末の再起動で直って見えたのは、
    // 保護者セッションが別に残っていたため。
    //
    // 先に破棄する必要が無いことは確認済み: PIN入力画面(`app/child-auth/pin-input.tsx`)は
    // `useLocalSearchParams`から`inviteCode`/`memberId`/`displayName`を受け取るだけで、
    // **現在の子どもセッションを一切読まない**（使うのは書き込み側の`loginChild`のみ）。
    // PINが通った時点で`loginChild`が新しいセッションに入れ替える。
    //
    // 副次的な改善: PIN画面まで来て気が変わってやめた場合も、**元の子のままでいられる**
    // （従来は黙ってログアウトされていた）。
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
              <MemberAvatar
                name={c.display_name}
                color={c.avatar_color}
                size={64}
                lineData={avatars[c.member_id] ?? null}
              />
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
