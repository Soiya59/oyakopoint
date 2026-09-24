import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import ScreenBackLink from "@/components/ScreenBackLink";
import theme from "@/theme/theme";
import { useAppData } from "@/data/store";
import type { ScheduledAnnouncement, ScheduledAnnouncementSlot } from "@/types/domain";
import {
  SCHEDULED_ANNOUNCEMENT_DEFAULT_HOUR,
  SCHEDULED_ANNOUNCEMENT_EXAMPLES,
  SCHEDULED_ANNOUNCEMENT_FEATURE_NAME,
  SCHEDULED_ANNOUNCEMENT_MESSAGE_MAX_LENGTH,
  SCHEDULED_ANNOUNCEMENT_MINUTE_STEP,
  SCHEDULED_ANNOUNCEMENT_SLOTS,
} from "@/constants/scheduledAnnouncement";

/**
 * P44 「メッセージ」の設定（保護者、2026-09-23新設）
 *
 * 参照:
 *   - 要件定義書.md 07-37章4章
 *   - UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 64章（P44、新設。
 *     ただし本画面の名称・枠のラベルは、統括の指示「メッセージ　朝と夜と
 *     は限らないから」〈2026-09-23〉を反映し、64章の「あさ・よるの
 *     メッセージ」から「メッセージ」に変更している。置き場所（P40に新
 *     Card→新設P44）はそのまま踏襲した。開発部/成果物/実装メモ.md 292章
 *     に変更点と理由を記録）
 *
 * 朝・夜という固定の意味を持たない2つの枠（slot=1/2）それぞれについて、
 * 時刻・文面・オンオフを設定する。保護者（管理者・副管理者）のみが開ける
 * 画面（P40自体が保護者専用のため、追加の権限分岐は不要。64.1.2節）。
 */
export default function ScheduledAnnouncementsScreen() {
  const { state, setScheduledAnnouncement, deleteScheduledAnnouncement } = useAppData();

  return (
    <Screen tone="parent">
      <ScreenBackLink tone="parent" onPress={() => router.replace("/parent/family-settings")} />
      <Text style={theme.typography.parentTitle}>{SCHEDULED_ANNOUNCEMENT_FEATURE_NAME}</Text>
      <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s3 }]}>
        家族の毎日に、決まった時間の一言を届けます。書かなければ、その時間には何も届きません。届く相手は、書いた本人を含む家族全員です。「ありがとうのメッセージ」とは別の機能です。
      </Text>

      {SCHEDULED_ANNOUNCEMENT_SLOTS.map(({ slot, label }) => (
        <SlotCard
          key={slot}
          slot={slot}
          label={label}
          saved={state.scheduledAnnouncements.find((a) => a.slot === slot) ?? null}
          onSave={(enabled, sendTime, message) => setScheduledAnnouncement(slot, enabled, sendTime, message)}
          onDelete={() => deleteScheduledAnnouncement(slot)}
        />
      ))}
    </Screen>
  );
}

function parseSendTime(sendTime: string): { hour: number; minute: number } {
  const [h, m] = sendTime.split(":");
  return { hour: Number(h) || 0, minute: Number(m) || 0 };
}

function formatSendTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 / SCHEDULED_ANNOUNCEMENT_MINUTE_STEP }, (_, i) => i * SCHEDULED_ANNOUNCEMENT_MINUTE_STEP);

function SlotCard({
  slot,
  label,
  saved,
  onSave,
  onDelete,
}: {
  slot: ScheduledAnnouncementSlot;
  label: string;
  saved: ScheduledAnnouncement | null;
  onSave: (enabled: boolean, sendTime: string, message: string) => Promise<{ ok: boolean; error?: { message: string } }>;
  onDelete: () => Promise<{ ok: boolean; error?: { message: string } }>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const initial = saved ? parseSendTime(saved.send_time) : { hour: SCHEDULED_ANNOUNCEMENT_DEFAULT_HOUR[slot], minute: 0 };
  const [hour, setHour] = useState(initial.hour);
  const [minute, setMinute] = useState(initial.minute);
  const [message, setMessage] = useState(saved?.message ?? "");

  const beginEdit = () => {
    const cur = saved ? parseSendTime(saved.send_time) : { hour: SCHEDULED_ANNOUNCEMENT_DEFAULT_HOUR[slot], minute: 0 };
    setHour(cur.hour);
    setMinute(cur.minute);
    setMessage(saved?.message ?? "");
    setError(null);
    setEditing(true);
  };

  const trimmedMessage = message.trim();
  const nearLimit = trimmedMessage.length >= SCHEDULED_ANNOUNCEMENT_MESSAGE_MAX_LENGTH - 5;
  const canSave = trimmedMessage.length > 0;

  const doSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const res = await onSave(true, formatSendTime(hour, minute), trimmedMessage);
    setSaving(false);
    if (!res.ok) {
      setError(res.error?.message ?? "変更できませんでした。もう一度お試しください。");
      return;
    }
    setEditing(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 3000);
  };

  // [ワイヤーフレーム64.6.0節「決定2」] 削除せずに一時停止する
  // 「そうしんする／いまは そうしんしない」。文面・時刻はそのまま、
  // enabledだけを切り替える。
  const setSending = async (enabled: boolean) => {
    if (!saved) return;
    setSaving(true);
    setError(null);
    const res = await onSave(enabled, saved.send_time, saved.message ?? "");
    setSaving(false);
    if (!res.ok) setError(res.error?.message ?? "変更できませんでした。もう一度お試しください。");
  };

  const doDelete = async () => {
    setSaving(true);
    setError(null);
    const res = await onDelete();
    setSaving(false);
    setConfirmingDelete(false);
    if (!res.ok) setError(res.error?.message ?? "変更できませんでした。もう一度お試しください。");
  };

  return (
    <Card style={{ marginTop: theme.spacing.s4 }}>
      <Text style={theme.typography.parentBodyMedium}>{label}</Text>

      {!editing && !confirmingDelete && (
        <>
          {saved?.message ? (
            <>
              <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s2 }]}>
                {saved.send_time.slice(0, 5)}
              </Text>
              <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s1 }]}>
                「{saved.message}」{!saved.enabled && "（いまは止めています）"}
              </Text>
              <View style={[styles.chipRow, { marginTop: theme.spacing.s2 }]}>
                <Pressable
                  onPress={() => void setSending(true)}
                  disabled={saving}
                  style={[styles.chip, saved.enabled && styles.chipSelected]}
                >
                  <Text>送信する</Text>
                </Pressable>
                <Pressable
                  onPress={() => void setSending(false)}
                  disabled={saving}
                  style={[styles.chip, !saved.enabled && styles.chipSelected]}
                >
                  <Text>いまは送信しない</Text>
                </Pressable>
              </View>
              <View style={[styles.chipRow, { marginTop: theme.spacing.s3, justifyContent: "space-between" }]}>
                <AppButton label="編集する" variant="secondary" onPress={beginEdit} disabled={saving} />
                <Pressable onPress={() => setConfirmingDelete(true)} disabled={saving} style={{ justifyContent: "center" }}>
                  <Text style={{ color: theme.colors.statusBlocking, textDecorationLine: "underline" }}>消す</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
                まだ設定されていません
              </Text>
              <AppButton label="設定する" variant="secondary" style={{ marginTop: theme.spacing.s2, alignSelf: "flex-start" }} onPress={beginEdit} />
            </>
          )}
        </>
      )}

      {confirmingDelete && (
        <View style={{ marginTop: theme.spacing.s2 }}>
          <Text style={theme.typography.parentBody}>{label}を消しますか？</Text>
          <View style={[styles.chipRow, { marginTop: theme.spacing.s3 }]}>
            <AppButton label="やめる" variant="secondary" onPress={() => setConfirmingDelete(false)} disabled={saving} />
            <AppButton label={saving ? "消しています…" : "消す"} variant="danger" onPress={() => void doDelete()} disabled={saving} />
          </View>
        </View>
      )}

      {editing && (
        <View style={{ marginTop: theme.spacing.s3 }}>
          <Text style={theme.typography.parentBody}>届ける時刻</Text>
          <View style={styles.wheelRow}>
            <TimeWheel values={HOURS} value={hour} onChange={setHour} suffix="時" />
            <TimeWheel values={MINUTES} value={minute} onChange={setMinute} suffix="分" pad />
          </View>

          <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>
            例から選ぶ（タップすると下の欄に入ります。自分で書いても構いません）
          </Text>
          {(["朝向け", "夜向け"] as const).map((heading) => (
            <View key={heading} style={{ marginTop: theme.spacing.s2 }}>
              <Text style={[theme.typography.parentCaption, { color: theme.colors.neutralTextSecondary }]}>{heading}</Text>
              {SCHEDULED_ANNOUNCEMENT_EXAMPLES.filter((e) => e.heading === heading).map((example) => (
                <Pressable
                  key={example.id}
                  onPress={() => setMessage(example.text)}
                  style={styles.exampleCard}
                >
                  <Text style={theme.typography.parentBody}>{example.text}</Text>
                </Pressable>
              ))}
            </View>
          ))}

          <Text style={[theme.typography.parentBody, { marginTop: theme.spacing.s4 }]}>メッセージ</Text>
          {/* [2026-09-25追加・統括決定・やること.md 4-81] 例文を漢字にしたため、
              子どもにも届くことを添える（統括「子供が読めない場合はひらがなにして
              くださいと記載」）。 */}
          <Text style={[theme.typography.parentCaption, { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary }]}>
            お子さんが漢字を読めないときは、ひらがなに書きかえてください。
          </Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            maxLength={SCHEDULED_ANNOUNCEMENT_MESSAGE_MAX_LENGTH}
            multiline
            style={styles.messageInput}
          />
          <Text
            style={[
              theme.typography.parentCaption,
              styles.counter,
              {
                color: nearLimit ? theme.colors.statusPending : theme.colors.neutralTextSecondary,
                fontWeight: message.length >= SCHEDULED_ANNOUNCEMENT_MESSAGE_MAX_LENGTH ? "700" : "400",
              },
            ]}
          >
            {message.length}/{SCHEDULED_ANNOUNCEMENT_MESSAGE_MAX_LENGTH}字
          </Text>

          {error && <Text style={{ color: theme.colors.statusBlocking, marginTop: theme.spacing.s1 }}>{error}</Text>}
          {savedFlash && <Text style={{ color: theme.colors.brandPrimaryStrong, marginTop: theme.spacing.s1 }}>変更しました</Text>}

          <View style={[styles.chipRow, { marginTop: theme.spacing.s4, justifyContent: "space-between" }]}>
            <AppButton label="やめる" variant="secondary" onPress={() => setEditing(false)} disabled={saving} />
            <AppButton label={saving ? "保存中…" : "保存する"} onPress={() => void doSave()} disabled={saving || !canSave} />
          </View>
        </View>
      )}

      {!editing && !confirmingDelete && savedFlash && (
        <Text style={{ color: theme.colors.brandPrimaryStrong, marginTop: theme.spacing.s2 }}>変更しました</Text>
      )}
    </Card>
  );
}

const WHEEL_ITEM_HEIGHT = 44;
const WHEEL_VISIBLE_ROWS = 5; // 真ん中の1行＋上下2行ずつ

/**
 * 時刻の選択部品（ワイヤーフレーム64.4節「数値を直接入力させず、選ぶだけで
 * 確定する方式」）。
 *
 * [2026-09-25変更・統括「くるくる回して決める方法はできるか」・実装メモ299章]
 * 横スクロールのチップ一覧は、選んでいる時刻が画面の外に隠れて見にくかった
 * ため、iPhoneの目覚まし時計のような縦に回る列に置き換えた。真ん中の帯に
 * 止まった数字が選ばれる。ネイティブの依存（picker等）は足さず、ScrollViewの
 * snapToIntervalで作る（OTAで配れるようにするため。OS標準の時刻ピッカーは
 * Androidでは文字盤になり見た目がそろわず、ビルドも要る）。数字を押しても
 * その数字まで回る。
 */
function TimeWheel({
  values,
  value,
  onChange,
  suffix,
  pad,
}: {
  values: number[];
  value: number;
  onChange: (v: number) => void;
  suffix: string;
  pad?: boolean;
}) {
  const ref = useRef<ScrollView>(null);
  const placed = useRef(false);
  const label = (v: number) => (pad ? String(v).padStart(2, "0") : String(v));
  const initialIndex = Math.max(0, values.indexOf(value));
  const [centerIndex, setCenterIndex] = useState(initialIndex);

  const settle = (offsetY: number) => {
    const i = Math.min(values.length - 1, Math.max(0, Math.round(offsetY / WHEEL_ITEM_HEIGHT)));
    setCenterIndex(i);
    if (values[i] !== value) onChange(values[i]);
  };

  const scrollToIndex = (i: number, animated: boolean) => {
    ref.current?.scrollTo({ y: i * WHEEL_ITEM_HEIGHT, animated });
  };

  return (
    <View style={styles.wheel}>
      <View pointerEvents="none" style={styles.wheelBand} />
      <ScrollView
        ref={ref}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        scrollEventThrottle={16}
        contentOffset={{ x: 0, y: initialIndex * WHEEL_ITEM_HEIGHT }}
        // Androidは contentOffset を無視するため、最初の配置時に回しておく
        // （2回目以降の配置し直しでは回さない。選び直した値が戻ってしまうため）
        onLayout={() => {
          if (placed.current) return;
          placed.current = true;
          scrollToIndex(initialIndex, false);
        }}
        onScroll={(e) => {
          const i = Math.round(e.nativeEvent.contentOffset.y / WHEEL_ITEM_HEIGHT);
          if (i !== centerIndex && i >= 0 && i < values.length) setCenterIndex(i);
        }}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.y)}
        // 勢いをつけずに指を離したときは onMomentumScrollEnd が来ない端末があるため
        onScrollEndDrag={(e) => {
          if (Math.abs(e.nativeEvent.velocity?.y ?? 0) < 0.05) settle(e.nativeEvent.contentOffset.y);
        }}
        contentContainerStyle={{ paddingVertical: WHEEL_ITEM_HEIGHT * Math.floor(WHEEL_VISIBLE_ROWS / 2) }}
      >
        {values.map((v, i) => (
          <Pressable
            key={v}
            onPress={() => {
              scrollToIndex(i, true);
              setCenterIndex(i);
              onChange(v);
            }}
            style={styles.wheelItem}
          >
            <Text style={i === centerIndex ? styles.wheelTextSelected : styles.wheelText}>
              {label(v)}
              {suffix}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
  wheelRow: { flexDirection: "row", justifyContent: "center", gap: theme.spacing.s4, marginTop: theme.spacing.s2 },
  wheel: {
    width: 110,
    height: WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ROWS,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    backgroundColor: theme.colors.neutralSurface,
    overflow: "hidden",
  },
  wheelBand: {
    position: "absolute",
    left: 4,
    right: 4,
    top: WHEEL_ITEM_HEIGHT * Math.floor(WHEEL_VISIBLE_ROWS / 2),
    height: WHEEL_ITEM_HEIGHT,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.brandPrimary,
    backgroundColor: theme.colors.brandPrimarySoft,
  },
  wheelItem: { height: WHEEL_ITEM_HEIGHT, alignItems: "center", justifyContent: "center" },
  wheelText: { fontSize: 18, color: theme.colors.neutralTextSecondary },
  wheelTextSelected: { fontSize: 22, fontWeight: "700", color: theme.colors.neutralTextPrimary },
  exampleCard: {
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s2,
    marginTop: theme.spacing.s1,
    backgroundColor: theme.colors.neutralSurface,
  },
  messageInput: {
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentMd,
    padding: theme.spacing.s3,
    marginTop: theme.spacing.s2,
    minHeight: 72,
    textAlignVertical: "top",
    backgroundColor: theme.colors.neutralSurface,
  },
  counter: { marginTop: theme.spacing.s1, textAlign: "right" },
});
