import React, { useEffect, useState } from "react";
import { router } from "expo-router";
import { TextInput, View } from "react-native";
import Screen from "@/components/Screen";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { Text } from "react-native";
import { useSession } from "@/lib/session";
import { deleteAccount, fetchAccountDeletionPreview } from "@/data/api";
import type { AccountDeletionPreview } from "@/types/domain";

/**
 * S28 アカウントを削除する（みまもりメンバー、2026-09-21新設）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 59.4節
 *       要件定義書.md 07-33章 決定9・10・17
 *       設計部/成果物/API仕様.md 24.4章
 *
 * P42（`app/account-delete.tsx`）と同一構成のうち、みまもりメンバーは
 * `chk_owner_is_parent`制約によりオーナーになれないため、実際には常に
 * #2（家族から抜けてアカウントを削除する）のケースのみに到達する
 * （59.4節「S28（みまもりメンバー）は常に#2のみ」）。判定ロジック自体は
 * account_deletion_preview()を1本呼ぶ同じ作りにしてあり、コードを分岐
 * させて#2専用に簡略化してはいない（RPCの結果を正として画面を作るという
 * 59章の設計方針どおり）。S13（`app/supporter/settings.tsx`）からのみ
 * 遷移する。
 *
 * ---- 破壊的操作についての事前記録（開発部CLAUDE.md） ----
 * 「本当に削除する」は Edge Function `delete-account` を呼び、ログイン用
 * アカウント（auth.users）をハード削除する不可逆な操作である。
 */
export default function SupporterAccountDeleteScreen() {
  const { client, logoutParent } = useSession();
  const [preview, setPreview] = useState<AccountDeletionPreview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [familyNameDraft, setFamilyNameDraft] = useState("");
  const [processing, setProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const res = await fetchAccountDeletionPreview(client);
      if (!mounted) return;
      if (res.ok) {
        setPreview(res.data);
      } else {
        setLoadError(true);
      }
    })();
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    if (!preview) return;
    setProcessing(true);
    setErrorMessage(null);
    const res = await deleteAccount(preview.will_delete_family ? familyNameDraft : undefined);
    setProcessing(false);
    if (!res.ok) {
      setErrorMessage("削除できませんでした。もう一度お試しください。");
      return;
    }
    await logoutParent();
    router.replace("/");
  };

  const familyNameMatches =
    !!preview?.family_name &&
    familyNameDraft.trim().length > 0 &&
    familyNameDraft.trim() === preview.family_name.trim();

  return (
    <Screen tone="supporter">
      <ScreenBackLink tone="supporter" label="← もどる" onPress={() => router.back()} />
      <Text style={theme.typography.supporterTitle}>アカウントを削除する</Text>

      {!preview && !loadError && (
        <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s4 }]}>読み込み中…</Text>
      )}
      {loadError && (
        <Text style={{ marginTop: theme.spacing.s4, color: theme.colors.statusBlocking }}>
          読み込めませんでした。もう一度お試しください。
        </Text>
      )}

      {preview && !preview.has_family && (
        <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s4 }]}>
          ログインに使っているメールアドレス（アカウント）が削除されます。二度とこのメールアドレスでログインできなくなります。以前所属していた家族に残っている記録（名前・書き込みなど）は消えません。
        </Text>
      )}

      {preview && preview.has_family && !preview.will_delete_family && (
        <Text style={[theme.typography.supporterBody, { marginTop: theme.spacing.s4 }]}>
          「{preview.family_name}」から抜けます。これまでの完了報告やポイントの記録は、家族のほうに残ります。あわせて、ログインに使っているメールアドレス（アカウント）も削除されます。二度とこのメールアドレスでログインできなくなります。
        </Text>
      )}

      {preview && preview.has_family && preview.will_delete_family && (
        <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s2 }}>
          <Text style={theme.typography.supporterBody}>
            あなたが抜けると、この家族を管理できる人がいなくなります。この家族の記録がすべて消えます。クエスト、完了報告、ポイント、ごほうび、掲示板の書き込み、お絵かき、シール帳、家族の木——すべて元に戻せません。{"\n"}
            あわせて、あなたのログイン用アカウントも削除されます。{"\n"}
            ほかのメンバーのログイン用アカウントは削除されません（各自で削除できます）。
          </Text>
          <Text style={theme.typography.supporterBody}>続けるには、家族の名前「{preview.family_name}」を入力してください。</Text>
          <TextInput
            value={familyNameDraft}
            onChangeText={setFamilyNameDraft}
            editable={!processing}
            placeholder="家族の名前"
            style={{
              borderWidth: 1,
              borderColor: theme.colors.neutralBorder,
              borderRadius: theme.radius.parentMd,
              paddingHorizontal: theme.spacing.s3,
              paddingVertical: theme.spacing.s2,
              backgroundColor: theme.colors.neutralSurface,
            }}
          />
          <Text style={[theme.typography.supporterCaption, { color: theme.colors.neutralTextSecondary }]}>
            上の名前とすべて同じ文字で入力してください。
          </Text>
        </View>
      )}

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      {preview && (
        <AppButton
          tone="supporter"
          label={processing ? "削除しています…" : "本当に削除する"}
          variant="danger"
          style={{ marginTop: theme.spacing.s4 }}
          onPress={confirm}
          disabled={processing || (preview.will_delete_family && !familyNameMatches)}
        />
      )}
    </Screen>
  );
}
