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
 * P42 アカウントを削除する（保護者、`parentNoFamily`兼用、2026-09-21新設）
 * 参照: UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 59.4節
 *       要件定義書.md 07-33章 決定9・10・17
 *       設計部/成果物/API仕様.md 24.4章
 *
 * トップレベル（`app/parent/`配下ではない）に置く理由: `app/parent/_layout.tsx`
 * は `status === "parentNoFamily"` を問答無用で "/" へリダイレクトするため、
 * `app/parent/`配下に置くと決定10（家族に属していない人もアカウントを削除
 * できること）の経路がP1から到達できなくなる。P1（`app/index.tsx`）・
 * P41（`app/parent/account.tsx`）・S13（`app/supporter/settings.tsx`）の
 * いずれからもガード無しで到達できるよう、ロール別グループの外に置く
 * （`app/onboarding/*`と同じ配置方針）。
 *
 * 戻るリンクは「← もどる」（行き先を名乗らない）なので`router.back()`を使う
 * （`src/components/ScreenBackLink.tsx`の教訓どおり、「ホームへ戻る」等
 * 行き先を名乗るラベルにだけ`router.replace(...)`を使う。実装メモ.md 86章）。
 * 決定13: 何も変更せずに元の画面（P41／S13／P1）へ戻れる。
 *
 * ---- 破壊的操作についての事前記録（開発部CLAUDE.md） ----
 * 「本当に削除する」は Edge Function `delete-account` を呼び、
 * ログイン用アカウント（auth.users）をハード削除する不可逆な操作である。
 * 自分がオーナーで他に在籍保護者がいない場合（`will_delete_family`）は、
 * 家族ごと削除（families行のDELETE、CASCADEで家族の全データが連動削除）を
 * 伴う（決定4・9）。
 */
export default function AccountDeleteScreen() {
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
    <Screen tone="parent">
      <ScreenBackLink tone="parent" label="← もどる" onPress={() => router.back()} />
      <Text style={theme.typography.parentTitle}>アカウントを削除する</Text>

      {!preview && !loadError && (
        <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>読み込み中…</Text>
      )}
      {loadError && (
        <Text style={{ marginTop: theme.spacing.s4, color: theme.colors.statusBlocking }}>
          読み込めませんでした。もう一度お試しください。
        </Text>
      )}

      {preview && !preview.has_family && (
        // #1: parentNoFamilyの人（決定10・決定12）。
        <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>
          ログインに使っているメールアドレス（アカウント）が削除されます。二度とこのメールアドレスでログインできなくなります。以前所属していた家族に残っている記録（名前・書き込みなど）は消えません。
        </Text>
      )}

      {preview && preview.has_family && !preview.will_delete_family && (
        // #2: 家族に所属・自分が唯一の在籍保護者ではない。
        <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>
          「{preview.family_name}」から抜けます。これまでの完了報告やポイントの記録は、家族のほうに残ります。あわせて、ログインに使っているメールアドレス（アカウント）も削除されます。二度とこのメールアドレスでログインできなくなります。
          {preview.is_owner && preview.next_owner_display_name
            ? `\n抜けたあと、${preview.next_owner_display_name}さんがこの家族の管理者になります。`
            : ""}
        </Text>
      )}

      {preview && preview.has_family && preview.will_delete_family && (
        // #3: 家族に所属・自分が唯一の在籍保護者（オーナー）。59.3.2節と同一の文言・
        // 同一の家族名入力（決定9）。
        <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s2 }}>
          <Text style={theme.typography.parentBody}>
            あなたが抜けると、この家族を管理できる人がいなくなります。この家族の記録がすべて消えます。クエスト、完了報告、ポイント、ごほうび、掲示板の書き込み、お絵かき、シール帳、家族の木——すべて元に戻せません。{"\n"}
            あわせて、あなたのログイン用アカウントも削除されます。{"\n"}
            ほかのメンバーのログイン用アカウントは削除されません（各自で削除できます）。
          </Text>
          <Text style={theme.typography.parentBody}>続けるには、家族の名前「{preview.family_name}」を入力してください。</Text>
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
          {/* 決定7と同じ考え方: 不一致を赤字・エラー扱いにしない。 */}
          <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
            上の名前とすべて同じ文字で入力してください。
          </Text>
        </View>
      )}

      {errorMessage && (
        <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
      )}

      {preview && (
        <AppButton
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
