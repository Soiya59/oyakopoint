/**
 * お絵かき（P30／C24・C25／S18）の3ロール共通コンポーネント。
 * 参照: 主要画面ワイヤーフレーム.md 21.5節 決定4「キャンバス・パレット自体は
 * 3ロール共通のコンポーネントとする。保存後の演出強度・文言のみロールごとに書き分ける」。
 *
 * 保存後の遷移・スナックバー等の「演出」は本コンポーネントの外（各ロールの画面）が
 * 担当する。本コンポーネントはあくまで「描く・ぜんぶけす・保存する・上限到達時の
 * 一覧と削除・未公開の絵の編集」という部品そのものに責任を持つ。
 *
 * [2026-09-01追加] 未公開（is_published=false）の絵に限り「編集」できる
 * （統括決定「公開前の編集」、API仕様.md 12.2a章）。編集は内部的に
 * `edit_unpublished_drawing()`（DELETE→INSERTを1トランザクション）を呼ぶ
 * だけで、部分編集ではない。サムネイルの「なおす」「編集」（editLabel、呼び出し
 * 側から渡す）を押すと該当の絵の線データがキャンバスに読み込まれ、保存すると
 * `onEditSave`が呼ばれる。
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
  /** 直近の保存/削除/編集で発生した通信エラー文言。 */
  errorMessage: string | null;
  /** 「せーぶする」（保護者・みまもりメンバー）/「とっておく」（子ども）。新規保存・編集保存の両方で使う。 */
  saveLabel: string;
  /**
   * 「ひとつ もどす」ボタンの文言。
   * [2026-09-01追加・本部長] デザイントークン.md 1.9節は当初「消す操作は『ぜんぶけす』
   * 1つのみ（1ストロークごとのUndoはMVPに含めない）」としていたが、これは実際に描く前の
   * 予防的な線引きだった。統括が実機で使ったうえで「戻るボタンが欲しい」と判断したため
   * 追加する（実装メモ101章）。全消しは取り返しがつかないため、1本だけ戻せる価値が大きい。
   * 編集モード中（既存の絵をなおしている最中）も同じボタンで使えるようにする。
   */
  undoLabel: string;
  /** 「ぜんぶけす」/「ぜんぶ けす」。 */
  clearLabel: string;
  /**
   * 未公開のサムネイルに添える編集導線の文言。「なおす」（子ども向け）／
   * 「編集」（大人向け）。[2026-09-01追加・統括決定「公開前の編集」、
   * API仕様.md 12.2a章・実装メモ.md 102章]
   */
  editLabel: string;
  /** 保存成功時に呼ばれる。成功したらtrueを返すこと（成功時のみキャンバスをクリアするため）。 */
  onSave: (lineData: FamilyDrawingLineData) => Promise<boolean>;
  /**
   * 未公開の絵の編集保存リクエスト（本人・未公開の絵のみ編集可）。
   * `edit_unpublished_drawing()`（スキーマ設計.sql 38章）を呼ぶ想定。成功したら
   * trueを返すこと（成功時のみキャンバスをクリアし編集モードを終えるため）。
   * ガチャ競合で編集が破棄された場合（`check_violation`）も含め、失敗時は
   * `errorMessage`にDBのメッセージをそのまま表示すればよい（呼び出し側で
   * `res.error.message`をそのまま渡す。API仕様.md 12.2a章「危険2」参照）。
   */
  onEditSave: (drawingId: string, lineData: FamilyDrawingLineData) => Promise<boolean>;
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
  undoLabel,
  editLabel,
  onSave,
  onEditSave,
  onDeleteRequest,
  deletingId,
}: DrawingBoardProps) {
  const [lines, setLines] = useState<FamilyDrawingLine[]>([]);
  const [color, setColor] = useState<string>(theme.drawingPalette[0].value);
  // [設計判断] 削除は取り消せない操作のため、app/parent/settings.tsxの家族削除と同じ
  // 「1タップ目で確認表示→2タップ目で確定」の画面内2段階確認パターンを踏襲する
  // （Alert.alert等のネイティブダイアログはWeb版で挙動が不安定なため使わない）。
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  // [2026-09-01追加] 未公開の絵の編集モード。編集中の絵のidを保持する。
  // nullなら「新規に描いている」状態、idがあれば「その絵をなおしている」状態。
  const [editingId, setEditingId] = useState<string | null>(null);
  const isEditing = editingId !== null;

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

  /** 直前の1本だけ取り消す。保存前のキャンバス上の操作なので、DBには一切触れない。
   *  編集モード中（既存の絵をなおしている最中）でも同じ関数でよい。読み込んだ線・
   *  自分で描き足した線を区別せず、キャンバス上の配列を1本分戻すだけだから
   *  （DBには一切触れないため、`edit_unpublished_drawing()`は保存を押すまで呼ばれない）。 */
  const undoLastStroke = () => setLines((prev) => prev.slice(0, -1));

  /**
   * 未公開の絵の編集を始める（API仕様.md 12.2a章）。対象の絵の線データを
   * そのままキャンバスへ読み込む。DBには一切触れない（保存を押すまでは
   * 「キャンバス上の下書き」のまま）。
   */
  const startEdit = (drawing: FamilyDrawing) => {
    setConfirmingDeleteId(null);
    setEditingId(drawing.id);
    setLines(drawing.line_data.lines);
    setColor(drawing.line_data.lines[drawing.line_data.lines.length - 1]?.c ?? theme.drawingPalette[0].value);
  };

  /** 編集を保存せずにやめる。読み込んだ内容はキャンバスから消え、元の絵はDB上そのまま残る。 */
  const cancelEdit = () => {
    setEditingId(null);
    setLines([]);
  };

  const handleSave = async () => {
    if (lines.length === 0) return;
    if (isEditing && editingId) {
      const ok = await onEditSave(editingId, { v: 1, lines });
      if (ok) {
        setLines([]);
        setEditingId(null);
      }
      return;
    }
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
   *
   * [2026-09-01追加] サムネイルごとに「けす」の隣へ編集導線（editLabel）を追加した。
   * 編集は同時に1枚のみ（isEditing中は全サムネイルの編集・削除ボタンを無効化する）。
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
              <View style={styles.thumbActionRow}>
                <Pressable
                  onPress={() => startEdit(d)}
                  disabled={isEditing || saving}
                  hitSlop={8}
                  style={styles.deleteLink}
                >
                  <Text style={[bodyStyle, styles.deleteLinkText, (isEditing || saving) && styles.linkTextDisabled]}>
                    {editLabel}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setConfirmingDeleteId(d.id)}
                  disabled={isEditing || saving}
                  hitSlop={8}
                  style={styles.deleteLink}
                >
                  <Text style={[bodyStyle, styles.deleteLinkText, (isEditing || saving) && styles.linkTextDisabled]}>
                    けす
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        ))}
      </View>
    </>
  );

  // 新規に描けるのは「上限未満」のときだけだが、編集中は上限到達時でもキャンバスを
  // 出す（編集はDELETE→INSERTを1トランザクションで行うため枚数は増えない。
  // API仕様.md 12.2a章「編集中の絵は未公開3枚の枠を占めたままか」参照）。
  const showCanvas = !atLimit || isEditing;

  return (
    <View>
      {atLimit && !isEditing && (
        <Card tone={tone} style={styles.limitCard}>
          <Text style={bodyStyle}>
            いま{unpublished.length}まい ひみつを もってるよ。だれかが みつけてくれたら、また あたらしい えが かけるよ
          </Text>
        </Card>
      )}

      {isEditing && (
        <Card tone={tone} style={styles.editingCard}>
          <Text style={bodyStyle}>このえを なおしています。せーぶすると もとのえと いれかわるよ</Text>
          <Pressable onPress={cancelEdit} disabled={saving} hitSlop={8} style={styles.deleteLink}>
            <Text style={[bodyStyle, styles.deleteLinkText]}>へんしゅうを やめる</Text>
          </Pressable>
        </Card>
      )}

      {showCanvas && (
        <>
          <DrawingCanvas color={color} lines={lines} onStrokeEnd={handleStrokeEnd} disabled={saving} />

          <View style={styles.paletteWrap}>
            <DrawingPalette selected={color} onSelect={setColor} disabled={saving} />
          </View>
        </>
      )}

      {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}

      {showCanvas && (
        <View style={styles.actionRow}>
          {/* 「ひとつ もどす」を「ぜんぶけす」の左に置く。取り返しのつく操作を先に、
              全部消える操作を後に並べ、誤って全消しを押す事故を減らす。 */}
          <AppButton
            label={undoLabel}
            tone={tone}
            variant="secondary"
            onPress={undoLastStroke}
            disabled={saving || lines.length === 0}
          />
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
      )}

      {/* 上限に達していなくても、すでに描いた絵は見られる・消せるようにする（上のコメント参照）。
          あと何枚描けるかも添える（上限に達したときの文言とつながるように）。 */}
      {unpublished.length > 0 &&
        renderMyDrawings(
          atLimit
            ? "かきなおしたいときは、ひとつ けすと あたらしい えが かけるようになるよ"
            : `あと${theme.drawingLimits.maxUnpublished - unpublished.length}まい かけるよ。きにいらない えは けせるよ`
        )}
    </View>
  );
}

const styles = StyleSheet.create({
  paletteWrap: { marginTop: theme.spacing.s4, alignItems: "center" },
  actionRow: { flexDirection: "row", marginTop: theme.spacing.s4, gap: theme.spacing.s3 },
  saveButton: { flex: 1 },
  limitCard: { alignItems: "center", backgroundColor: theme.colors.brandPrimarySoft, borderColor: theme.colors.brandPrimary },
  // [2026-09-01追加] 編集モード中の案内カード。limitCardと同系色にして
  // 「通常の新規作成とは違う状態」であることを示す。
  editingCard: {
    alignItems: "center",
    gap: theme.spacing.s1,
    marginBottom: theme.spacing.s4,
    backgroundColor: theme.colors.brandPrimarySoft,
    borderColor: theme.colors.brandPrimary,
  },
  sectionLabel: { marginTop: theme.spacing.s6, marginBottom: theme.spacing.s1 },
  sectionHint: { marginBottom: theme.spacing.s3, color: theme.colors.neutralTextSecondary },
  thumbRow: { flexDirection: "row", gap: theme.spacing.s4, justifyContent: "center" },
  thumbWrap: { alignItems: "center", gap: theme.spacing.s1 },
  thumbActionRow: { flexDirection: "row", gap: theme.spacing.s3, marginTop: theme.spacing.s1 },
  deleteLink: { marginTop: theme.spacing.s1 },
  deleteLinkText: { color: theme.colors.neutralTextSecondary, textDecorationLine: "underline" },
  // [2026-09-01追加] 編集中は他のサムネイルの「なおす」「けす」を押せなくする
  // （編集は同時に1枚のみ）。視覚的にも押せないことが分かるよう薄くする。
  linkTextDisabled: { opacity: 0.4 },
  confirmRow: { alignItems: "center", gap: theme.spacing.s1, marginTop: theme.spacing.s1 },
  deleteConfirmText: { color: theme.colors.statusBlocking, textDecorationLine: "underline" },
  error: { marginTop: theme.spacing.s3, color: theme.colors.statusBlocking, textAlign: "center" },
});

export default DrawingBoard;
