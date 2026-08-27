/**
 * お絵かき（P30／C24・C25／S18）の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 21.5節 決定4「キャンバス・パレット自体は
 * 3ロール共通のコンポーネントとする。保存後の演出強度・文言のみロールごとに書き分ける」。
 *
 * 保存後の遷移・スナックバー等の「演出」は本コンポーネントの外（各ロールの画面）が
 * 担当する。本コンポーネントはあくまで「描く・ぜんぶけす・保存する・上限到達時の
 * 一覧と削除」という部品そのものに責任を持つ。
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Card from "./Card";
import AppButton from "./AppButton";
import DrawingCanvas, { DrawingThumbnail } from "./DrawingCanvas";
import DrawingPalette from "./DrawingPalette";
import theme from "@/theme/theme";
import type { FamilyDrawing, FamilyDrawingLine, FamilyDrawingLineData } from "@/types/domain";

type Tone = "parent" | "child" | "supporter";

interface DrawingBoardProps {
  tone: Tone;
  /** 自分の未公開の絵一覧（新しい順）。上限到達時のサムネイル表示に使う。 */
  unpublished: FamilyDrawing[];
  /** unpublished.length >= 上限（呼び出し側でtheme.drawingLimits.maxUnpublishedと比較）。 */
  atLimit: boolean;
  /** 保存API呼び出し中かどうか。 */
  saving: boolean;
  /** 直近の保存/削除で発生した通信エラー文言。 */
  errorMessage: string | null;
  /** 「せーぶする」（保護者・みまもりメンバー）/「とっておく」（子ども）。 */
  saveLabel: string;
  /** 「ぜんぶけす」/「ぜんぶ けす」。 */
  clearLabel: string;
  /** 保存成功時に呼ばれる。成功したらtrueを返すこと（成功時のみキャンバスをクリアするため）。 */
  onSave: (lineData: FamilyDrawingLineData) => Promise<boolean>;
  /** 未公開の絵の削除リクエスト（描き直したい場合の導線、本人のみ・未公開のみ削除可）。 */
  onDeleteRequest: (drawingId: string) => void;
  /** 削除処理中のdrawing id（ボタンの二重押下防止・ローディング表示用）。 */
  deletingId: string | null;
}

export function DrawingBoard({
  tone,
  unpublished,
  atLimit,
  saving,
  errorMessage,
  saveLabel,
  clearLabel,
  onSave,
  onDeleteRequest,
  deletingId,
}: DrawingBoardProps) {
  const [lines, setLines] = useState<FamilyDrawingLine[]>([]);
  const [color, setColor] = useState<string>(theme.drawingPalette[0].value);
  // [設計判断] 削除は取り消せない操作のため、app/parent/settings.tsxの家族削除と同じ
  // 「1タップ目で確認表示→2タップ目で確定」の画面内2段階確認パターンを踏襲する
  // （Alert.alert等のネイティブダイアログはWeb版で挙動が不安定なため使わない）。
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const bodyStyle =
    tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;

  const handleStrokeEnd = (line: FamilyDrawingLine) => {
    setLines((prev) => {
      if (prev.length >= theme.drawingLimits.maxLines) return prev;
      const totalPoints = prev.reduce((sum, l) => sum + l.p.length / 2, 0) + line.p.length / 2;
      // 合計座標点数上限（33b章：3000点）に達する場合は、このストロークを追加しない
      // （DBのCHECK制約に頼らずクライアント側で先に止め、保存時のエラー表示を防ぐ）。
      if (totalPoints > theme.drawingLimits.maxTotalPoints) return prev;
      return [...prev, line];
    });
  };

  const clearAll = () => setLines([]);

  const handleSave = async () => {
    if (lines.length === 0) return;
    const ok = await onSave({ v: 1, lines });
    if (ok) setLines([]);
  };

  /**
   * 自分の未公開の絵のサムネイル一覧（本人だけが見える）。
   *
   * [2026-08-27修正・本部長] **以前はこの一覧を`if (atLimit)`の中にしか置いていなかった。**
   * そのため未公開が3枚たまったときだけ自分の絵が見え、1〜2枚のときは「何を描いたか
   * 確認できない・消せない」状態だった（ユーザーが実機で発見。本番でも絵を持つ3人が
   * 全員ちょうど1枚ずつで、誰も自分の絵を見られない状態になっていた）。
   * 1枚でも持っていれば常に出すように、この関数へ切り出して両方の分岐から呼ぶ。
   */
  const renderMyDrawings = (hint: string) => (
    <>
      <Text style={[bodyStyle, styles.sectionLabel]}>あなたの ひみつ（じぶんだけ みえるよ）</Text>
      <Text style={[bodyStyle, styles.sectionHint]}>{hint}</Text>
      <View style={styles.thumbRow}>
        {unpublished.map((d) => (
          <View key={d.id} style={styles.thumbWrap}>
            <DrawingThumbnail lineData={d.line_data} size={72} />
            {confirmingDeleteId === d.id ? (
              <View style={styles.confirmRow}>
                <Pressable
                  onPress={() => onDeleteRequest(d.id)}
                  disabled={deletingId === d.id}
                  hitSlop={8}
                >
                  <Text style={[bodyStyle, styles.deleteConfirmText]}>
                    {deletingId === d.id ? "けしています…" : "ほんとうに けす"}
                  </Text>
                </Pressable>
                <Pressable onPress={() => setConfirmingDeleteId(null)} disabled={deletingId === d.id} hitSlop={8}>
                  <Text style={[bodyStyle, styles.deleteLinkText]}>やめる</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable onPress={() => setConfirmingDeleteId(d.id)} hitSlop={8} style={styles.deleteLink}>
                <Text style={[bodyStyle, styles.deleteLinkText]}>けす</Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
    </>
  );

  if (atLimit) {
    return (
      <View>
        <Card tone={tone} style={styles.limitCard}>
          <Text style={bodyStyle}>
            いま{unpublished.length}まい ひみつを もってるよ。だれかが みつけてくれたら、また あたらしい えが かけるよ
          </Text>
        </Card>

        {renderMyDrawings("かきなおしたいときは、ひとつ けすと あたらしい えが かけるようになるよ")}

        {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
      </View>
    );
  }

  return (
    <View>
      <DrawingCanvas color={color} lines={lines} onStrokeEnd={handleStrokeEnd} disabled={saving} />

      <View style={styles.paletteWrap}>
        <DrawingPalette selected={color} onSelect={setColor} disabled={saving} />
      </View>

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      <View style={styles.actionRow}>
        <AppButton
          label={clearLabel}
          tone={tone}
          variant="secondary"
          onPress={clearAll}
          disabled={saving || lines.length === 0}
        />
        <AppButton
          label={saveLabel}
          tone={tone}
          loading={saving}
          disabled={saving || lines.length === 0}
          onPress={handleSave}
          style={styles.saveButton}
        />
      </View>

      {/* 上限に達していなくても、すでに描いた絵は見られる・消せるようにする（上のコメント参照）。
          あと何枚描けるかも添える（上限に達したときの文言とつながるように）。 */}
      {unpublished.length > 0 &&
        renderMyDrawings(
          `あと${theme.drawingLimits.maxUnpublished - unpublished.length}まい かけるよ。きにいらない えは けせるよ`
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  paletteWrap: { marginTop: theme.spacing.s4, alignItems: "center" },
  actionRow: { flexDirection: "row", marginTop: theme.spacing.s4, gap: theme.spacing.s3 },
  saveButton: { flex: 1 },
  limitCard: { alignItems: "center", backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  sectionLabel: { marginTop: theme.spacing.s6, marginBottom: theme.spacing.s1 },
  sectionHint: { marginBottom: theme.spacing.s3, color: theme.colors.neutralTextSecondary },
  thumbRow: { flexDirection: "row", gap: theme.spacing.s4, justifyContent: "center" },
  thumbWrap: { alignItems: "center", gap: theme.spacing.s1 },
  deleteLink: { marginTop: theme.spacing.s1 },
  deleteLinkText: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  confirmRow: { alignItems: "center", gap: theme.spacing.s1, marginTop: theme.spacing.s1 },
  deleteConfirmText: { color: theme.colors.statusBlocking, textDecorationLine: "underline" },
  error: { marginTop: theme.spacing.s3, color: theme.colors.statusBlocking, textAlign: "center" },
});

export default DrawingBoard;
