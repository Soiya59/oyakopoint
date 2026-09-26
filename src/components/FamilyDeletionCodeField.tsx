import React, { useEffect, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import type { ApiResult } from "@/data/api";

/**
 * 「家族を削除する」確認コード入力欄（新設・2026-09-27）
 *
 * 参照: 要件定義書.md 07-42章
 *       設計部/成果物/スキーマ設計.sql 80章
 *       設計部/成果物/API仕様.md 36章
 *       開発部/成果物/実装メモ.md 311章
 *
 * `app/parent/account.tsx`（経路A・B）・`app/account-delete.tsx`（経路C）の
 * 両方から使う共通部品。数字の入力欄の見た目・文言は、ログインの
 * `src/components/EmailCodeVerifyForm.tsx`に合わせる（本タスク指示）。
 *
 * [ログイン用コードとの違い] コードの正しさはこの部品では検証しない
 * （`verifyEmailOtp`のようなクライアント側の即時検証手段が無い。スキーマ
 * 設計.sql 80.1章「サーバー側で直接確認する」設計のため）。検証は
 * `remove-member`/`delete-account`が`confirm_family_name`と合わせて
 * 1回だけ行う（80.5・80.6章）。この部品は「メールを送る」操作と
 * 「送られた数字を書き写す」入力欄だけを担当し、失敗時のメッセージは
 * 呼び出し元（家族名の照合と合わせて1つの送信ボタンで完結する画面）が表示する。
 */
const RESEND_COOLDOWN_MS = 30000;

export interface FamilyDeletionCodeFieldProps {
  /** 送り先のメールアドレス（表示のみ。存在しない場合は表示を省く） */
  email: string | null;
  code: string;
  onChangeCode: (v: string) => void;
  /** 削除の確定処理が進行中かどうか（processing中は送信ボタン・入力欄を無効化する） */
  processing: boolean;
  /** requestFamilyDeletionCode() を呼ぶこと */
  onSend: () => Promise<ApiResult<{ ok: true }>>;
}

export default function FamilyDeletionCodeField({
  email,
  code,
  onChangeCode,
  processing,
  onSend,
}: FamilyDeletionCodeFieldProps) {
  const [sendState, setSendState] = useState<"unsent" | "sending" | "cooldown" | "ready">("unsent");
  const [sendError, setSendError] = useState<string | null>(null);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimer.current) clearTimeout(cooldownTimer.current);
    };
  }, []);

  const hasSentOnce = sendState === "cooldown" || sendState === "ready";

  const send = async () => {
    setSendState("sending");
    setSendError(null);
    const res = await onSend();
    if (!res.ok) {
      setSendState(hasSentOnce ? "ready" : "unsent");
      setSendError(
        res.error.code === "resend_too_soon"
          ? "少し待ってから、もう一度お試しください。"
          : "メールを送れませんでした。もう一度お試しください。"
      );
      return;
    }
    onChangeCode("");
    setSendError(null);
    setSendState("cooldown");
    cooldownTimer.current = setTimeout(() => setSendState("ready"), RESEND_COOLDOWN_MS);
  };

  return (
    <View style={{ gap: theme.spacing.s2 }}>
      {email && (
        <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
          <Text style={{ fontWeight: "700", color: theme.colors.neutralTextPrimary }}>{email}</Text>
          {" "}宛に確認コードを送ります
        </Text>
      )}
      <AppButton
        variant="secondary"
        label={
          sendState === "sending"
            ? "送信中…"
            : sendState === "cooldown"
            ? "送信しました"
            : hasSentOnce
            ? "もう一度送る"
            : "メールに確認コードを送る"
        }
        loading={sendState === "sending"}
        disabled={processing || sendState === "sending" || sendState === "cooldown"}
        onPress={send}
      />
      {sendError && (
        <Text style={[theme.typography.parentCaption, { color: theme.colors.statusBlocking }]}>{sendError}</Text>
      )}
      {hasSentOnce && (
        <>
          <Text style={theme.typography.parentBody}>メールに届いた6桁の数字を入力してください。</Text>
          <TextInput
            value={code}
            onChangeText={(raw) => onChangeCode(raw.replace(/[^0-9]/g, "").slice(0, 6))}
            keyboardType="number-pad"
            maxLength={6}
            editable={!processing}
            placeholder="000000"
            placeholderTextColor={theme.colors.neutralBorder}
            accessibilityLabel="6桁の確認コード"
            style={{
              borderWidth: 1,
              borderColor: theme.colors.neutralBorder,
              borderRadius: theme.radius.parentMd,
              paddingVertical: theme.spacing.s3,
              backgroundColor: theme.colors.neutralSurface,
              fontSize: 32,
              fontWeight: "700",
              letterSpacing: 10,
              textAlign: "center",
            }}
          />
          <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
            コードは1時間だけ使えます
          </Text>
          {sendState === "cooldown" && (
            <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>
              30秒ほど経つと、もう一度送れるようになります
            </Text>
          )}
        </>
      )}
    </View>
  );
}
