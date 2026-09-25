/**
 * コレクター棚（P31／C26／S19）本体の3ロール共通コンポーネント。
 * 参照: 要件定義書07-13-3章、主要画面ワイヤーフレーム.md 21.0節決定6・21.6節・
 * 32.0a節（決定19〜25）・32.2a節。
 *
 * [2026-09-07改訂・本部長／実装メモ152章] 画面に出す呼び名は「メダル」に統一した
 * （統括判断）。コンポーネント名・DBの`sticker_key`・本コメントの「シール」
 * 「ステッカー」はそのまま変更していない。
 *
 * [2026-09-07全面改訂・統括フィードバック（本部長経由）・32.0a節/32.2a節]
 * 「区画3：自分のステッカー」という独立タブは廃止し、タブは「集めたもの」
 * 「過去の木」の2つに戻した（決定19）。「集めたもの」タブの中にメンバー選択
 * チップ（全員＋各メンバー、決定20・決定22「既定は全員」）を新設し、個別メンバーを
 * 選ぶと「つくった・あつめたもの」（決定21・このメンバーが獲得/描いたものへの
 * 絞り込み）「シール」（決定23・所有数0の行は表示しない）「フィギュア」の区分を
 * まとめて見せる。
 * [2026-09-21削除・主要画面ワイヤーフレーム.md 58.5a節決定3] 旧「バッジ」区分
 * （決定24・達成済みのみ）はこの一覧から外した。絵が無く集めるものでもないため、
 * コレクター棚には表示しない（通帳・S1「MyPointsCard」の表示はそのまま残す）。
 *
 * 決定6「木に飾る」「並べ替える」ボタンを一切配置しない、という原則は区画1
 * 「集めたもの」（全員選択時）・区画2「過去の木」には引き続きそのまま適用する。
 * シール区分（個別メンバー・自分選択時のみ）は例外的に「木に飾る」「うごかす」
 * 「シールを買いに行く」を持つ（決定25「自分を選んでいるときだけ表示」）。
 *
 * 「集めたもの」: 家族共有・永久保管の景品一覧。タップで詳細（獲得した人・日付、
 *   家族の絵の場合は描いた人の名前も表示）。未公開の絵はそもそもこの一覧に
 *   含まれない（`gacha_draws`経由でのみ取得するため。src/data/api.ts参照）。
 * 「過去の木」: シーズンごとの家族の木を、その月に飾られた景品・自由配置ステッカーが
 *   乗った状態のまま再現表示する。読み取り専用（タップ操作を持たない）。
 */
import React, { useCallback, useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import AppButton from "./AppButton";
import Card from "./Card";
import { DrawingThumbnail } from "./DrawingCanvas";
import { TreeStageVisual, FamilyTreeWeeklyList, buildFamilyTreeWeeklyItems } from "./FamilyTree";
import { MemberAvatar } from "./MemberAvatar";
import { HabitFigureCircleIcon } from "./StickerIcon";
import AndroidKeyboardAvoidingPadding from "./AndroidKeyboardAvoidingPadding";
import CircleFrame from "./CircleFrame";
import DrawingEngagementSection from "./DrawingEngagementSection";
import FigureIcon from "./FigureIcon";
import FigureFrame from "./FigureFrame";
import { ErrorState, SkeletonList } from "./StatusViews";
import { useAppData } from "@/data/store";
import { useCompletedHabitCards, useHabitFigureCatalog } from "@/hooks/useHabitCards";
import { computeHabitCardDurationDays, getHabitCardKindInfo, summarizeHabitCardBreakdown } from "@/lib/habitCardDisplay";
import { formatDateShort, formatMonthJp, toJstDateString } from "@/lib/calendarDates";
import theme, { figureKeyOfSticker, stickerShapeFallbackEmoji } from "@/theme/theme";
import type { StickerRarity, StickerShape } from "@/theme/theme";
import type { CollectedGachaDraw, FamilyTreeCompletionDot, FamilyTreeHabitFigurePlacement, FamilyTreeStickerPlacement } from "@/data/api";
import type {
  FamilyMember,
  FamilyTreeSeason,
  FamilyTreeWeeklyCompletionCount,
  HabitFigureCatalogItem,
  HabitFigureGrantWithPlacement,
  StickerPurchaseWithCatalog,
} from "@/types/domain";

type Tone = "parent" | "child" | "supporter";
type LoadState = "loading" | "error" | "ready";
// [2026-09-19追加・要件定義書07-28章2026-09-19全面改訂決定31、主要画面
// ワイヤーフレーム.md 49-B.6章決定47] 「しまったシール帳」タブを追加した。
type ShelfTab = "collected" | "pastTrees" | "habitCardArchive";

/** メンバー選択チップの「全員」を表す番兵値（実在のmember_idと衝突しない）。 */
export const ALL_MEMBERS_ID = "__all__";

const stickerShapeLabel: Record<StickerShape, { child: string; parent: string }> = {
  beetle: { child: "カブトムシ", parent: "カブトムシ" },
  butterfly: { child: "ちょうちょ", parent: "ちょうちょ" },
  // [2026-09-09変更・統括判断] 「小さな花」→「おはな」。大人向け・子ども向けとも同じ。
  // メダルは4種とも同じ大きさで、花だけ「小さな」と名乗る理由が無かった
  // （カブトムシ・ちょうちょ・ドラゴンは大きさを言っていない）。
  // 「はな」ではなく「おはな」にしたのは、**ひらがなの「はな」は鼻とも読める**ため。
  // 絵を見る前に何のことか分かるようにした。DB側の表示名も
  // 20260919010000_flower_display_name_ohana.sql で「どうのおはな」等に揃えてある。
  flower: { child: "おはな", parent: "おはな" },
  // [2026-09-09追加・本部長／実装メモ177章] StickerShopPanel.tsxと同じ表記。
  dragon: { child: "ドラゴン", parent: "ドラゴン" },
};

const stickerRarityLabel: Record<StickerRarity, { child: string; parent: string }> = {
  bronze: { child: "どう", parent: "銅" },
  silver: { child: "ぎん", parent: "銀" },
  gold: { child: "きん", parent: "金" },
  // [2026-09-08改訂・本部長／実装メモ173章] 統括判断で「虹」から「クリスタル」に
  // 改称（StickerShopPanel.tsxと同じ表記統一の理由）。
  crystal: { child: "クリスタル", parent: "クリスタル" },
};

/**
 * [2026-09-25追記・実装メモ303.x章・本部長差し戻し「フィギュアの上にうさぎだけでも
 * よいよ」] 「全員」ビューの図鑑グリッド（`FamilyMedalSection`）は1行が1種類・
 * 4列が銅→銀→金→クリスタルの固定順のため、段階はマスの位置と枠の色
 * （`habitCardCellColors`／`FigureFrame`の枠色）で分かる。キャプションに段階名まで
 * 重ねると折り返して2行になる（例:「カブトムシ 銅」）ため、ここでは種類名だけを
 * 返す。個別ビュー（`StickerShelfSection`）・拡大表示は種類が固定順で並ばないため、
 * 引き続き`stickerEntryLabel`（種類名＋段階名）を使う。
 */
function stickerKindOnlyLabel(tone: Tone, shape: StickerShape): string {
  return tone === "child" ? stickerShapeLabel[shape].child : stickerShapeLabel[shape].parent;
}

export interface CollectorShelfPanelProps {
  tone: Tone;
  collectedLoadState: LoadState;
  collectedItems: CollectedGachaDraw[];
  onRetryCollected: () => void;
  /** 空状態（集めたもの、初回）のガチャ画面への軽い導線。 */
  onGoToGacha: () => void;

  pastSeasonsLoadState: LoadState;
  pastSeasons: FamilyTreeSeason[];
  onRetryPastSeasons: () => void;

  dotsBySeasonId: Record<string, FamilyTreeCompletionDot[]>;
  /**
   * [2026-09-08追加・スキーマ設計.sql 49章] 過去シーズンの自由配置ステッカー
   * （decoration_source='sticker'）。dotsBySeasonIdと同じ「見る」展開のタイミングで
   * 取得され、TreeStageVisualのstickerPlacementsプロパティにそのまま渡す。
   */
  stickerPlacementsBySeasonId: Record<string, FamilyTreeStickerPlacement[]>;
  /**
   * [2026-09-17追加・要件定義書07-28章決定21、開発部/成果物/実装メモ.md 237章]
   * 過去シーズンの自由配置フィギュア（decoration_source='habit_figure'）。
   * stickerPlacementsBySeasonIdと同じ「見る」展開のタイミングで取得され、
   * TreeStageVisualのhabitFigurePlacementsプロパティにそのまま渡す。
   */
  habitFigurePlacementsBySeasonId: Record<string, FamilyTreeHabitFigurePlacement[]>;
  /**
   * [2026-09-02追加] 週ごとの記録（要件定義書07-9章新設節「過去の木への反映」、
   * 主要画面ワイヤーフレーム.md 21.0節決定11）。dotsBySeasonIdと同じ「見る」展開の
   * タイミングで取得され、同一ビュー内に表示する。
   */
  weeklyBySeasonId: Record<string, FamilyTreeWeeklyCompletionCount[]>;
  loadingSeasonIds: Record<string, boolean>;
  errorSeasonIds: Record<string, boolean>;
  onExpandSeason: (season: FamilyTreeSeason) => void;

  /**
   * 色の凡例を作るために家族メンバー全員を受け取る（退会者を含む）。
   * [2026-09-01追加・本部長] 統括から「コレクションに入ると誰がどの色か分からない」との
   * 指摘があった。現在の木（P26/C20/S14）は「内訳を見る」のタップで誰の色かを辿れるが、
   * 21.6節のとおり過去の木は読み取り専用でタップを持たないため、辿る手段が無かった。
   * `state.members`は`is_active`で絞っていないため退会者も引ける（実装メモ99章）。
   */
  members: FamilyMember[];

  /** いま操作中の自分自身のmember_id（メンバー選択チップの「自分」表記・操作導線の出し分けに使う）。 */
  myMemberId: string;

  // [2026-09-08新設・主要画面ワイヤーフレーム.md 32.0a節決定19〜22]
  // 「集めたもの」区画内のメンバー選択チップ。ALL_MEMBERS_IDが「全員」（既定）。
  selectedMemberId: string;
  onSelectMember: (memberId: string) => void;

  /** 個別メンバー選択時の「シール」区分（決定23）。 */
  stickersLoadState: LoadState;
  stickerPurchases: StickerPurchaseWithCatalog[];
  onRetryStickers: () => void;
  /**
   * [2026-09-08追加・実装メモ158章] 「全員」選択時の「メダル」区分。家族全員分の
   * メダル所有状況をまとめて受け取る（`member_id`で誰の物かを判別する）。
   */
  familyStickersLoadState: LoadState;
  familyStickerPurchases: StickerPurchaseWithCatalog[];
  onRetryFamilyStickers: () => void;
  /** 自分選択時のみ: 「シールを かいに いく」導線（→購入画面、決定25）。 */
  onGoToStickerShop: () => void;
  /** 自分選択時のみ: 「木に かざる」導線（→ドラッグ配置画面、決定25）。 */
  onPlaceSticker: (purchaseId: string, shape: StickerShape, rarity: StickerRarity) => void;
  /** 自分選択時のみ: 「うごかす」導線（→ドラッグ移動画面、49.12章統括判断）。 */
  onMoveSticker: (decorationId: string, shape: StickerShape, rarity: StickerRarity, posX: number, posY: number) => void;

  // [2026-09-17新設・要件定義書07-28章決定27、主要画面ワイヤーフレーム.md 49.2章
  // 決定3-③、開発部/成果物/実装メモ.md 237章] 「フィギュア」区分（決定27。メダルとは
  // 独立した別の区分見出しの下に表示し、同じ一覧・グリッドには混在させない）。
  // シール区分（StickerShelfSection/FamilyMedalSection）と全く同じ構造。
  /** 個別メンバー選択時の「フィギュア」区分。 */
  habitFiguresLoadState: LoadState;
  habitFigureGrants: HabitFigureGrantWithPlacement[];
  onRetryHabitFigures: () => void;
  /** 「全員」選択時の「フィギュア」区分。 */
  familyHabitFiguresLoadState: LoadState;
  familyHabitFigureGrants: HabitFigureGrantWithPlacement[];
  onRetryFamilyHabitFigures: () => void;
  /** 自分選択時のみ: 「木に かざる」導線。 */
  onPlaceHabitFigure: (grantId: string, figureKey: string, kindEmoji: string | null) => void;
  /** 自分選択時のみ: 「うごかす」導線。 */
  onMoveHabitFigure: (decorationId: string, figureKey: string, kindEmoji: string | null, posX: number, posY: number) => void;

  /**
   * [2026-09-25追記・実装メモ303.x章] 「集めたもの」タブの区分ジャンプボタン
   * （目次）が、押された区分の見出しまでスクロールするために使う、呼び出し画面
   * （`Screen`）が持つ外側ScrollViewへのref。`Screen`に`scrollRef`を渡した
   * 呼び出し元（P31/C26/S19）だけがこのprop経由で渡す。渡されない場合（将来
   * 別の入れ物から呼ばれた場合の保険）はジャンプボタン自体を出さない。
   */
  scrollViewRef?: React.RefObject<ScrollView | null>;
}

const bodyStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;
const bodyMediumStyleFor = (tone: Tone) =>
  tone === "child"
    ? theme.typography.childBody
    : tone === "supporter"
    ? theme.typography.supporterBodyMedium
    : theme.typography.parentBodyMedium;
const captionStyleFor = (tone: Tone) =>
  tone === "child" ? theme.typography.childBody : tone === "supporter" ? theme.typography.supporterCaption : theme.typography.parentCaption;

/**
 * [2026-09-14追加・実装メモ225章] 拡大表示モーダルの「閉じる」ボタンの一辺の長さ。
 * `theme.tapTarget`はロールごとに最小タップ領域の基準値が異なるため
 * （子ども56dp・保護者44dp・みまもりメンバー48dp、デザイントークン.md 1.7節）、
 * `MemberAvatar.tsx`の閉じるボタン（全ロール一律32dp固定）をそのまま複製せず、
 * `tone`ごとに基準値をそのまま使う（子ども向けの基準を必ず満たすことが依頼の要件）。
 */
const closeTapSizeFor = (tone: Tone) =>
  tone === "child" ? theme.tapTarget.child : tone === "supporter" ? theme.tapTarget.supporterPrimary : theme.tapTarget.parent;

/**
 * [2026-09-14追加・本部長差し戻し（実装メモ225.7章）] 拡大表示カードの上端の
 * 余白（≒閉じるボタンの真下まで絵を出さないための空間）。閉じるボタンは
 * `top: theme.spacing.s2`から`closeTapSizeFor(tone)`の高さで置かれるため、
 * ボタンの下端は`theme.spacing.s2 + closeTapSizeFor(tone)`。この値に、ボタンと
 * 絵の間の余白として`theme.spacing.s2`をもう1つ足すことで、
 * `paddingTop = closeTapSizeFor(tone) + theme.spacing.s2 * 2`となり、
 * **絵の描画開始位置（paddingTopの直後）が常にボタンの下端より`theme.spacing.s2`
 * 分だけ下**になることを式で保証する。ロールごとにボタンの大きさが違う
 * （子ども56／保護者44／みまもり48）ため固定値にはしない（差し戻し文の指摘どおり）。
 *
 * 差し戻し前は固定`theme.spacing.s6`（24）だったため、子ども向け（ボタン56）では
 * ボタン下端（8+56=64）が絵の開始位置（24）より40pt下まで食い込んでいた
 * （225.7章の計算）。この関数はその重なりを、絵が円形か文字（絵文字）かに関わらず
 * 「ボタンの占める行範囲そのものを絵の描画領域から除外する」ことで解消する
 * （円の幾何学的な余白に頼った修正ではないため、既製の飾り〈四角い絵文字〉にも
 * 同じ根拠で効く）。
 *
 * [2026-09-18改訂・統括の実機スクリーンショット指摘「×の位置はだいぶ上にあるので、
 * 絵の位置をもう少し下げてもよいかも」・実装メモ246章] ボタンの下端から絵までの
 * 余白（旧式では`theme.spacing.s2`＝8pt）が窮屈だった。225.7章の式
 * 「`closeTapSizeFor(tone) + 余白×2`」の考え方（1個目の`s2`＝ボタン自身の上端の
 * 余白、2個目＝ボタン下端から絵までの余白）自体は消さず、**2個目の余白だけ**
 * `theme.spacing.s2`（8pt）→`theme.spacing.s4`（16pt）に広げた（極端に空けすぎない
 * よう、目盛り1段階分の変更に留めた）。結果、ボタン下端から絵までの余白は
 * 保護者44pt／みまもり48pt／子ども56ptのボタンいずれでも8pt→16ptへ倍になり、
 * `paddingTop`全体は各ロールとも+8ptになる（保護者60→68、みまもり64→72、
 * 子ども72→80）。小さい端末でのはみ出しは225.7章の`ScrollView`（内側スクロール）
 * がそのまま吸収する。
 */
const expandedCardPaddingTopFor = (tone: Tone) => closeTapSizeFor(tone) + theme.spacing.s2 + theme.spacing.s4;

/**
 * [2026-09-14追加・実装メモ225章] 拡大表示（`ShelfItemsGrid`の詳細モーダル）で
 * 絵・既製の飾りの絵文字を表示する一辺の長さを、画面サイズから計算する。
 *
 * `MemberAvatar.tsx`（43.11節・実装メモ218章）は220ptの固定値だが、あちらは
 * 常に1個しか出さないアバターの拡大表示。今回は「220ptより大きく」という
 * 明示の要望があるうえ、コレクター棚は縦長スマホだけでなく横長タブレット等でも
 * 使われうるため、固定値ではなく画面幅・画面高さの両方から動的に計算する。
 *
 * - 横幅の余白: モーダル外側の余白（`styles.overlay`のpadding、両側）と
 *   カード内側の余白（`styles.expandedCard`のpaddingHorizontal、両側）を引く。
 * - 縦幅の制約: 画像の下に「描いた人／題名／日付／見つけた人」の複数行テキストと
 *   閉じるボタンが乗るため、画面の高さの50%を上限にする（横長・低い画面〈例:
 *   横倒しにしたタブレット〉で画像がテキストを画面外に押し出さないための保険）。
 * - 上限320pt・下限160pt: 大画面タブレットで際限なく巨大化しないための上限、
 *   極端に小さい画面でも視認できる最低限の下限（いずれも実機実測ではなく安全側の
 *   目安値。統括の実機確認で調整の要望があれば225章に追記して見直す）。
 *
 * [2026-09-14追記・本部長差し戻し（実装メモ225.7章）] この50%の上限だけでは、
 * 画面の高さそのものが小さい端末（横長の低い画面など）でカード全体
 * （閉じるボタンの余白＋絵＋複数行の文字＋パディング）が画面をはみ出す
 * 組み合わせが実測で見つかった。この関数自体は変更せず（絵の大きさの計算はそのまま）、
 * カード全体を`ScrollView`で包み画面の高さを超えたら内側でスクロールできるように
 * することで対応した（`ShelfItemsGrid`内`modalMaxHeight`参照）。
 */
function computeExpandedImageSize(windowWidth: number, windowHeight: number): number {
  const overlayPadding = theme.spacing.s4;
  const cardHorizontalPadding = theme.spacing.s4;
  const maxByWidth = windowWidth - overlayPadding * 2 - cardHorizontalPadding * 2;
  const maxByHeight = windowHeight * 0.5;
  const available = Math.min(maxByWidth, maxByHeight);
  return Math.max(160, Math.min(320, available));
}

/**
 * [2026-09-23追加・統括の実機指摘「銅のメダルの拡大表示が小さい」] 拡大表示で、
 * 枠（`FigureFrame`／`CircleFrame`）の中に置く絵の一辺。どちらの枠も中の絵を
 * 枠の約62%で描く設計だが、2026-09-23までは渡す数値そのものがずれていた
 * （フィギュア＝枠220・絵136、メダル＝枠160・絵90）。07-34章でメダルとフィギュアの
 * 枠の形を入れ替えた際に大きさを揃えないまま残ったもの。枠の大きさは
 * `ExpandedItemModal`が渡す`imageSize`（絵と同じ160〜320pt）に統一し、
 * 中の絵はこの関数で決める。
 *
 * [2026-09-23追記・統括の実機確認「いい感じです。ただ、フィギュアとメダルはもう少し
 * 大きくてもよいかも」] 枠の中の余白が広かったため、拡大表示のときだけ比率を
 * 0.62→0.75（約2割大きく）に上げた。枠の部品の既定値（0.62）は変えていないので、
 * 一覧のサムネイル・木の飾りは変わらない。
 */
const DETAIL_INNER_RATIO = 0.75;
/**
 * [2026-09-23追記・統括「メダルは丸いから、ほとんど白い空白はいらないと思う。
 * メダルの中にいるので、ウサギはさらに小さく見える」] メダルは丸い枠の中に丸い
 * コインが入る形なので、フィギュア（五角形の枠。上に向かって細くなるため余白が要る）
 * と同じ比率では余白が大きすぎた。しかも絵柄（うさぎ）はコインの内側にさらに
 * 小さく描かれているため、コインを枠いっぱいまで大きくする。細い縁だけ残す。
 */
const MEDAL_DETAIL_INNER_RATIO = 0.94;
const detailIconSizeFor = (frameSize: number, ratio: number = DETAIL_INNER_RATIO) => Math.round(frameSize * ratio);

/**
 * [2026-09-23切り出し・統括の実機要望「メダルとフィギュアも下に表示じゃなくて、
 * 絵と同じにしてほしい」] 拡大表示モーダルの外枠（暗い背景・閉じるボタン・
 * 内側スクロール）。もとは`ShelfItemsGrid`（家族の絵・既製の飾り）の中に
 * 直書きされていたものを、中身を変えずにそのまま切り出した。
 *
 * 2026-09-14（実装メモ225章）に絵だけがこのモーダル方式へ作り替えられ、メダル・
 * フィギュアは151章時点の「グリッドの下に詳細カードが伸びる」方式のまま
 * 取り残されていた。メダル・フィギュアもこの部品を使うことで、見せ方・閉じ方・
 * 画像の大きさ（`computeExpandedImageSize`）が絵と完全に揃う。
 *
 * **外枠の構造は、閉じるタップの当たり判定を何度も実機で直してきた結果である
 * （実装メモ238章・246章・250章）。安易に書き換えないこと。**経緯は下のJSXの
 * コメントに残してある。
 *
 * `children`には、画面サイズから計算した絵の一辺の長さ（160〜320pt）が渡る。
 */
function ExpandedItemModal({
  tone,
  onClose,
  children,
}: {
  tone: Tone;
  onClose: () => void;
  children: (imageSize: number) => React.ReactNode;
}) {
  const { width, height } = useWindowDimensions();
  const closeLabel = tone === "child" ? "とじる" : "閉じる";
  const closeSize = closeTapSizeFor(tone);
  const expandedCardPaddingTop = expandedCardPaddingTopFor(tone);
  const expandedImageSize = computeExpandedImageSize(width, height);
  // [2026-09-14追加・本部長差し戻し（実装メモ225.7章）] オーバーレイの上下余白
  // （`styles.overlay`のpadding、両側）を引いた残りを、拡大表示カード全体
  // （閉じるボタンの余白＋絵＋文字＋内側の余白すべて込み）の縦幅の上限にする。
  // これを超える組み合わせ（例: 横長で高さの低い端末＋子ども向けの大きい
  // ボタン・文字）は、下の`ScrollView`でカードの中身だけをスクロールさせる
  // （225.7節で数値を確認済み）。
  const modalMaxHeight = height - theme.spacing.s4 * 2;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      {/* [2026-09-18・250章・3回目の修正] 238章（absoluteFillの受け皿を下に敷く）・
          246章（余白調整）とも実機（Android）で効いていなかった。原因は「受け皿が
          効いていない」ことではなく、**受け皿より上に、見た目には無いが実際には
          場所を取っている透明な層があった**こと。詳細は開発部/成果物/実装メモ.md
          250章。対策は二段構え：
          (a) ScrollViewの`flexGrow`を0にして、透明な層自体を小さくする（下記）。
          (b) それでも塞がれる可能性（Web版では未確認・250章参照）に備え、
              `styles.overlay`自身に「誰も受け取らなかったタップは閉じる」という
              土台の仕組みを追加する（下のViewの`onStartShouldSetResponder`/
              `onResponderRelease`）。個々のPressableの当たり判定に依存しないため、
              間にどんな透明な層があっても、最終的にここへ辿り着く。 */}
      {/* [2026-09-23新設・実装メモ.md 289章、UIUXデザイン部/成果物/主要画面
          ワイヤーフレーム.md 65.4.4節] `ExpandedItemModal`にはキーボード対策が
          まだ効いていなかった（289.3節の対象漏れ。当時この中にTextInputが
          無かったため）。本章でコメント入力欄を新設したため、289.8節①と
          同じ考え方をここにも適用する。250章が対処した「透明な層」問題
          （ScrollViewのflexGrow:0）とは別の問題であり、両者は独立に効く
          （どちらか一方を選ぶ必要はない）。AndroidKeyboardAvoidingPaddingは
          `styles.overlay`の当たり判定（onStartShouldSetResponder/
          onResponderRelease）をそのまま引き継ぐ（rest props forwarding）。 */}
      <AndroidKeyboardAvoidingPadding
        style={styles.overlay}
        onStartShouldSetResponder={() => true}
        onResponderRelease={onClose}
      >
        {/* [2026-09-17・やること.md 4-42・実装メモ238章] 統括の実機報告「カードの外の暗い部分を
            押しても閉じない（アバターの拡大は閉じる）」への対処。従来は overlay の Pressable の
            中に ScrollView を抱えた Pressable を入れ子にしていたが、ScrollView を含む入れ子では
            外側の Pressable が押下を受け取れない端末があった。**背景の受け皿を absoluteFill の
            Pressable として下に敷き、カードを兄弟として上に置く**（入れ子に依存しない）。
            [2026-09-18追記・250章] この対処（受け皿を敷く位置の変更）自体は効いていなかった
            （build 9で未解決）。ここは読み上げ機（アクセシビリティ）向けに「閉じる」ボタンとして
            残すために維持している（上記の`onStartShouldSetResponder`の土台が実質的な対処）。 */}
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel={closeLabel} />
        <View style={{ maxHeight: modalMaxHeight }}>
          {/* [2026-09-14追加・本部長差し戻し（実装メモ225.7章）] `maxHeight`を
              超える内容（小さい・横長の端末で絵＋複数行の文字がすべて乗った
              とき）は、カードの外にはみ出させず内側でスクロールさせる。
              カードの見た目（背景・枠線・角丸・内側の余白）は
              `contentContainerStyle`側（`styles.expandedCard`）に置く。 */}
          {/* [2026-09-18・250章] ScrollViewは既定スタイル（baseVertical）に
              `flexGrow: 1` を持つ（`node_modules/react-native/Libraries/
              Components/ScrollView/ScrollView.js`）。`style`に渡した
              `maxHeight`はこれを上書きしないため、中身が短くても`flex:1`の
              外側（`styles.overlay`）いっぱいまで透明に広がり、下に敷いた
              背景`Pressable`（絵の外の暗い部分を閉じる担当）へのタップを
              吸収してしまう**可能性がある**（Web版の検証では、この透明化
              自体は再現しなかった。実装メモ250章参照）。`flexGrow: 0`で
              「中身の高さぶんだけ」に戻す（`maxHeight`による内側スクロール
              は維持、225.7章の対応は壊さない）。 */}
          <ScrollView
            style={{ maxHeight: modalMaxHeight, flexGrow: 0, flexShrink: 1 }}
            contentContainerStyle={[styles.expandedCard, { paddingTop: expandedCardPaddingTop }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === "ios" ? true : undefined}
          >
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={[styles.expandedCloseButton, { width: closeSize, height: closeSize, borderRadius: closeSize / 2 }]}
              accessibilityRole="button"
              accessibilityLabel={closeLabel}
            >
              <Text style={styles.expandedCloseButtonText}>×</Text>
            </Pressable>
            {children(expandedImageSize)}
          </ScrollView>
        </View>
      </AndroidKeyboardAvoidingPadding>
    </Modal>
  );
}

/**
 * [2026-09-25修正・実装メモ.md 302章] 従来は`toLocaleDateString`を端末の
 * タイムゾーンのまま呼んでいた。JST固定の共通関数（`src/lib/calendarDates.ts`）に揃えた。
 */
function formatShortDate(iso: string): string {
  return formatDateShort(toJstDateString(iso));
}

/** season_start（"YYYY-MM-DD"、JST基準の暦月初日）から「M月」を作る。 */
function formatMonthLabel(dateOnly: string): string {
  return formatMonthJp(dateOnly);
}

/**
 * [2026-08-27追加・本部長] 同じ既製の飾りは1マスにまとめて個数で見せる。
 *
 * ユーザーの指摘: 7人程度が参加する家族では「木も棚もパンパンになりそう」。
 * 完了報告5回ごとに1回引けるため、7人がお手伝いをすれば月に数十回引かれ、
 * 既製の飾りが半分出るとして半年で百個以上になる。1個1マスで並べると
 * **せっかくの家族の絵が既製品に埋もれて探せなくなる**。
 *
 * 家族の絵は1枚ずつ固有のものなのでまとめず、常に個別に表示する。
 * これにより、既製品が何個増えても絵が主役の位置を保てる。
 * 個数が増えること自体は「集まってきた」という手応えになるため、
 * まとめても失われる情報は無い（07-13-1章「外れ枠を作らない」とも整合）。
 *
 * [2026-09-08改訂] 「全員」ビューと個別メンバーの「つくった・あつめたもの」の
 * 両方から使う共通ロジックとして、コンポーネント外の純関数に切り出した。
 */
function buildShelfEntries(items: CollectedGachaDraw[]): { key: string; item: CollectedGachaDraw; count: number }[] {
  const entries: { key: string; item: CollectedGachaDraw; count: number }[] = [];
  const presetIndexByName = new Map<string, number>();
  for (const item of items) {
    if (item.prizeKind === "preset_ornament") {
      const name = item.presetOrnament?.display_name ?? "?";
      const at = presetIndexByName.get(name);
      if (at !== undefined) {
        entries[at].count += 1;
        continue;
      }
      presetIndexByName.set(name, entries.length);
      entries.push({ key: `preset:${name}`, item, count: 1 });
    } else {
      entries.push({ key: item.id, item, count: 1 });
    }
  }
  return entries;
}

/**
 * 景品一覧グリッド＋タップで画面いっぱいに開く拡大表示モーダル（「集めたもの」
 * 全員ビュー・個別メンバーの「つくった・あつめたもの」の両方で使う共通表示）。
 * `items`が空配列のときは何も描画しない（空状態の文言は呼び出し側が個別に出す。
 * 全員ビューと個別ビューで空状態の文言・導線が異なるため、02.2a節決定23と
 * 同じくここでは共通化しない）。
 *
 * [2026-09-14改訂・統括の実機報告（実装メモ225章）「絵が下の方に出る。コレクション
 * が溜まるとスクロールがめんどい」への対応で、詳細表示をグリッド直下のインライン
 * カードから、`MemberAvatar.tsx`（43.11節・実装メモ218章）と同じ「タップで画面
 * いっぱいに拡大表示するモーダル」方式に変更した（統括が示された3案から選んだ
 * 案B）。以前ここにあった「新しい画面・新しいモーダルは増やさず、既存の詳細
 * カードの表示サイズだけを変える」というコメント（2026-09-09時点の判断）は撤回する。
 * **当時の判断が誤りだったわけではなく、前提が変わった**: 2026-09-09時点は
 * 「絵が小さくて見えない」という指摘への最小の手当てであり、枚数が増えたときに
 * 詳細カードがグリッドの下へ押し下げられスクロールが必要になる問題はまだ
 * 顕在化していなかった（当時はコレクション枚数がまだ少なかったと見られる）。
 * 今回は「枚数が増えるほど毎回スクロールが必要」という実機報告があり、かつ
 * 2026-09-13にアバターの拡大表示モーダル（`MemberAvatar`の`expandOnTap`）が
 * 同じ「タップで画面いっぱいに拡大表示する」仕組みとして実装・統括の実機確認
 * 「いい感じでした」まで済んでいる。この既存の仕組みと同じ操作感に揃えることが
 * 目的の一部であるため、今回に限り「モーダルを増やさない」方針よりも
 * 「既存の操作感に揃える」ことを優先し、方針を上書きする。
 */
function ShelfItemsGrid({ tone, items, myMemberId }: { tone: Tone; items: CollectedGachaDraw[]; myMemberId: string }) {
  const isChild = tone === "child";
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const { state } = useAppData();
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const shelfEntries = useMemo(() => buildShelfEntries(items), [items]);
  const selectedEntry = shelfEntries.find((e) => e.key === selectedItemId) ?? null;
  const selectedItem = selectedEntry?.item ?? null;
  const closeDetail = () => setSelectedItemId(null);

  if (shelfEntries.length === 0) return null;

  return (
    <>
      <View style={styles.grid}>
        {shelfEntries.map((entry) => {
          const item = entry.item;
          // [2026-09-14・実装メモ225章 判断] 選択中の枠（黄色いハイライト）は
          // モーダルを開いた後も残す。モーダルの背景はrgba(0,0,0,0.4)の半透明の
          // ため、閉じるまでの間グリッド自体がうっすら透けて見え続ける。どのマスを
          // 拡大表示しているかをその状態でも辿れる利点があり、`selectedItemId`は
          // どのみち「拡大表示中のitemを特定する」ために保持し続ける必要がある値
          // なので、ハイライトを残すこと自体に追加コストは無い。モーダルを閉じたら
          // `closeDetail`で`selectedItemId`をnullに戻し、ハイライトも消す（下に
          // 何も表示されない状態でハイライトだけ残る「消し忘れ」を避ける）。
          const selected = entry.key === selectedItemId;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setSelectedItemId(entry.key)}
              style={[styles.gridItem, selected && styles.gridItemSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              {item.prizeKind === "preset_ornament" ? (
                <Text style={styles.gridEmoji}>{item.presetOrnament?.emoji ?? "🎁"}</Text>
              ) : item.drawing ? (
                <DrawingThumbnail lineData={item.drawing.line_data} size={48} />
              ) : null}
              <Text style={[captionStyle, styles.gridCaption]}>
                {entry.count > 1 ? `×${entry.count}` : formatShortDate(item.drawnAt)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {selectedItem && (
        // [2026-09-23] 外枠は`ExpandedItemModal`へ切り出した（メダル・フィギュアと共用）。
        // 統括の要望「絵と×以外はどこを押しても閉じる」（実装メモ238章）は中身の側で
        // 引き続き実現する：本文ブロックを閉じる Pressable にし、絵（絵文字・お絵かき）
        // だけ無反応の Pressable で包む。
        <ExpandedItemModal tone={tone} onClose={closeDetail}>
          {(expandedImageSize) =>
                selectedItem.prizeKind === "preset_ornament" ? (
                <Pressable style={styles.detailDrawingWrap} onPress={closeDetail}>
                  <Pressable onPress={() => {}}>
                    <Text style={[styles.detailEmoji, { fontSize: Math.round(expandedImageSize * 0.5) }]}>
                      {selectedItem.presetOrnament?.emoji ?? "🎁"}
                    </Text>
                  </Pressable>
                  <View style={styles.detailDrawingTextWrap}>
                    <Text style={[bodyMediumStyle, styles.detailDrawingCenterText]}>
                      {selectedItem.presetOrnament?.display_name ?? "かざり"}
                    </Text>
                    <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>
                      {formatShortDate(selectedItem.drawnAt)} {selectedItem.collectorName}
                      {isChild ? "が みつけたよ" : "が獲得"}
                    </Text>
                  </View>
                </Pressable>
              ) : selectedItem.drawing ? (
                // [2026-09-14改訂・実装メモ225章] 従来はグリッド直下のインライン
                // カード内で220pt固定表示していたが、モーダル化に伴い画面サイズから
                // 計算した`expandedImageSize`（`computeExpandedImageSize`参照、
                // 160〜320ptの範囲で可変）で表示するよう変更した。縦積み
                // （絵を中央上、テキストをその下に中央寄せ）のレイアウト自体は
                // 2026-09-09時点のものをそのまま踏襲する。
                <>
                  <Pressable style={styles.detailDrawingWrap} onPress={closeDetail}>
                    <Pressable onPress={() => {}}>
                      <DrawingThumbnail lineData={selectedItem.drawing.line_data} size={expandedImageSize} />
                    </Pressable>
                    <View style={styles.detailDrawingTextWrap}>
                      <Text style={[bodyMediumStyle, styles.detailDrawingCenterText]}>
                        {isChild ? `「${selectedItem.drawing.artistName}」の絵` : `「${selectedItem.drawing.artistName}」が描いた絵`}
                      </Text>
                      {/* [2026-09-02追加] お絵かきの題名（要件定義書07-13-2a章、
                          主要画面ワイヤーフレーム.md 21.0節決定17）。「描いた人の名前」の
                          直後に、独立した1行のラベル付き表示として追加する。無い絵は
                          この行自体が無い（プレースホルダは出さない）。 */}
                      {selectedItem.drawing.title && (
                        <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>
                          {isChild ? "だいめい：" : "題名："}
                          {selectedItem.drawing.title}
                        </Text>
                      )}
                      {/* [2026-08-29修正・本部長] 既製の飾りには「◯◯が獲得」と出るのに、
                          絵には**描いた人しか出ておらず、ガチャで引き当てた人が分からなかった**
                          （ユーザーの実機指摘）。collectorNameは既に取得済みで使っていないだけ
                          だった。絵は「描いた人」と「見つけた人」が別人になりうるので、
                          日付と一緒に見つけた人も出す。 */}
                      <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>
                        {formatShortDate(selectedItem.drawnAt)} {selectedItem.collectorName}
                        {isChild ? "が みつけたよ" : "が獲得"}
                      </Text>
                    </View>
                  </Pressable>
                  {/* [2026-09-23新設・要件定義書07-38章5章・6章、UIUXデザイン部/
                      成果物/主要画面ワイヤーフレーム.md 65.4.3節、やること.md
                      2-70] リアクション・コメント区画。`detailDrawingWrap`
                      （本文を押すと閉じるPressable）の外に、絵と同じ「無反応の
                      Pressable」で包んで配置する（238・246・250章の当たり判定を
                      壊さないため）。 */}
                  <Pressable onPress={() => {}} style={styles.detailEngagementWrap}>
                    <DrawingEngagementSection
                      tone={tone}
                      drawingId={selectedItem.drawing.drawingId}
                      artistMemberId={selectedItem.drawing.artistId}
                      myMemberId={myMemberId}
                      socialInteractionsEnabled={state.family.social_interactions_enabled}
                    />
                  </Pressable>
                </>
              ) : null
          }
        </ExpandedItemModal>
      )}
    </>
  );
}

/**
 * 過去の木の色の凡例。そのシーズンに報告した人だけを、木と同じ色丸で並べる。
 *
 * 回数は出さない。木の色丸は40スロットのreservoir sampling（20.0節決定3）を通るため、
 * 木の上に見えている丸の数と実際の報告件数が一致せず、数字を添えると嘘になるため。
 * 「誰がどの色か」という指摘に答えるには色と名前の対応だけで足りる。
 *
 * 並び順は`members`の順（`created_at`昇順で取得済み）で、決定5の内訳表示と揃えている。
 * ただし決定5と違い、そのシーズンに報告が無い人は出さない（過去の木は当時の記録であり、
 * 当時いなかった人・報告しなかった人を並べても凡例として意味を持たないため）。
 */
function PastTreeColorLegend({
  dots,
  members,
  tone,
}: {
  dots: FamilyTreeCompletionDot[];
  members: FamilyMember[];
  tone: Tone;
}) {
  const isChild = tone === "child";
  const captionStyle = captionStyleFor(tone);
  // [2026-09-11追加・要件定義書07-27章 決定9] アバターを自分で描いた絵にできる
  // ようにする機能。27箇所すべてのMemberAvatarで同じ見た目にするため、この
  // コンポーネントの内部だけで完結させる（呼び出し元への新しいprop追加はしない）。
  const { memberAvatars } = useAppData();

  const contributors = useMemo(() => {
    const reporterIds = new Set(dots.map((d) => d.reported_by));
    return members.filter((m) => reporterIds.has(m.id));
  }, [dots, members]);

  // 同じ色が複数人に割り当たっている場合は、色だけでは見分けられない旨を添える。
  // パレットは8色しかなく、DB側のnext_member_avatar_colorも使い切ったら重複を許容する
  // 設計のため、これは異常ではなく起こり得る状態である。
  const duplicatedColors = useMemo(() => {
    const seen = new Map<string, number>();
    contributors.forEach((m) => {
      if (m.avatar_color) seen.set(m.avatar_color, (seen.get(m.avatar_color) ?? 0) + 1);
    });
    return new Set(Array.from(seen.entries()).filter(([, n]) => n > 1).map(([c]) => c));
  }, [contributors]);

  if (contributors.length === 0) return null;

  return (
    <View style={styles.legendWrap}>
      <Text style={[captionStyle, styles.legendHeading]}>{isChild ? "だれの いろ？" : "この月の色"}</Text>
      <View style={styles.legendRows}>
        {contributors.map((m) => (
          <View key={m.id} style={styles.legendRow}>
            <MemberAvatar name={m.display_name} color={m.avatar_color} size={20} lineData={memberAvatars[m.id]} expandOnTap />
            <Text style={captionStyle}>{m.display_name}</Text>
          </View>
        ))}
      </View>
      {duplicatedColors.size > 0 && (
        <Text style={[captionStyle, styles.legendNote]}>
          {isChild
            ? "おなじ いろの ひとが いるよ"
            : "同じ色のメンバーがいるため、色だけでは見分けられません"}
        </Text>
      )}
    </View>
  );
}

/**
 * メンバー選択チップ（主要画面ワイヤーフレーム.md 32.2a節「メンバー選択チップ」）。
 * 「全員」を先頭に、以降は`members`の順（`created_at`昇順、呼び出し元が既に
 * その順で渡す前提）。ソート・並び替え機能は持たせない（07-10章必須3条件）。
 */
function MemberSelectionChips({
  tone,
  members,
  myMemberId,
  selectedMemberId,
  onSelectMember,
}: {
  tone: Tone;
  members: FamilyMember[];
  myMemberId: string;
  selectedMemberId: string;
  onSelectMember: (id: string) => void;
}) {
  const isChild = tone === "child";
  const captionStyle = captionStyleFor(tone);
  // [2026-09-11追加・要件定義書07-27章 決定9] 上のPastTreeColorLegendと同じ理由。
  const { memberAvatars } = useAppData();

  return (
    <View style={styles.stickerMemberRow}>
      <Pressable
        onPress={() => onSelectMember(ALL_MEMBERS_ID)}
        style={[styles.stickerMemberChip, selectedMemberId === ALL_MEMBERS_ID && styles.stickerMemberChipActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: selectedMemberId === ALL_MEMBERS_ID }}
      >
        <Text style={captionStyle}>{isChild ? "ぜんいん" : "全員"}</Text>
      </Pressable>
      {members
        .filter((m) => m.is_active)
        .map((m) => (
          <Pressable
            key={m.id}
            onPress={() => onSelectMember(m.id)}
            style={[styles.stickerMemberChip, m.id === selectedMemberId && styles.stickerMemberChipActive]}
            accessibilityRole="button"
            accessibilityState={{ selected: m.id === selectedMemberId }}
          >
            <MemberAvatar name={m.display_name} color={m.avatar_color} size={20} lineData={memberAvatars[m.id]} />
            <Text style={captionStyle}>{m.id === myMemberId ? (isChild ? "じぶん" : "自分") : m.display_name}</Text>
          </Pressable>
        ))}
    </View>
  );
}

export function CollectorShelfPanel({
  tone,
  collectedLoadState,
  collectedItems,
  onRetryCollected,
  onGoToGacha,
  pastSeasonsLoadState,
  pastSeasons,
  onRetryPastSeasons,
  dotsBySeasonId,
  stickerPlacementsBySeasonId,
  habitFigurePlacementsBySeasonId,
  weeklyBySeasonId,
  loadingSeasonIds,
  errorSeasonIds,
  onExpandSeason,
  members,
  myMemberId,
  selectedMemberId,
  onSelectMember,
  stickersLoadState,
  stickerPurchases,
  onRetryStickers,
  familyStickersLoadState,
  familyStickerPurchases,
  onRetryFamilyStickers,
  onGoToStickerShop,
  onPlaceSticker,
  onMoveSticker,
  habitFiguresLoadState,
  habitFigureGrants,
  onRetryHabitFigures,
  familyHabitFiguresLoadState,
  familyHabitFigureGrants,
  onRetryFamilyHabitFigures,
  onPlaceHabitFigure,
  onMoveHabitFigure,
  scrollViewRef,
}: CollectorShelfPanelProps) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [tab, setTab] = useState<ShelfTab>("collected");
  const [expandedSeasonId, setExpandedSeasonId] = useState<string | null>(null);

  const collectedLabel = isChild ? "あつめたもの" : "集めたもの";
  const pastTreesLabel = isChild ? "まえの木" : "過去の木";
  const isViewingSelf = selectedMemberId === myMemberId;
  const selectedMember = members.find((m) => m.id === selectedMemberId);

  // [2026-09-25追加・要件定義書07-40章、実装メモ303.x章] 「集めたもの」タブの
  // 区分ジャンプボタン（目次）。各区分の見出しView自身にonLayoutを付け、押された
  // タイミングでscrollViewRef（呼び出し画面のScreenが包むScrollView）へ
  // measureLayoutし、その区分の直前までスクロールする。onLayoutで発火させるのは
  // 「全員」／個別ビューでどの区分がどんな高さで出るかがロード状態次第で変わる
  // ため（統括依頼文3節「各見出しの位置はonLayoutで取る」）。ScrollView自体は
  // Screen側が持っているため、scrollViewRefが渡されない呼び出し元（想定外）では
  // ボタン自体を出さない。
  const scrollAnchors = useRef<Record<string, View | null>>({});
  const scrollOffsets = useRef<Record<string, number>>({});
  const measureSectionOffset = useCallback(
    (key: string) => {
      const node = scrollAnchors.current[key];
      const scrollHandle = scrollViewRef?.current?.getScrollableNode?.();
      if (!node || scrollHandle == null) return;
      node.measureLayout(
        scrollHandle,
        (_left: number, top: number) => {
          scrollOffsets.current[key] = top;
        },
        () => {}
      );
    },
    [scrollViewRef]
  );
  const registerSectionRef = useCallback(
    (key: string) => (ref: View | null) => {
      scrollAnchors.current[key] = ref;
    },
    []
  );
  const scrollToSection = useCallback(
    (key: string) => {
      const y = scrollOffsets.current[key];
      if (y == null || !scrollViewRef?.current) return;
      scrollViewRef.current.scrollTo({ y: Math.max(0, y - theme.spacing.s3), animated: true });
    },
    [scrollViewRef]
  );

  const toggleSeason = (season: FamilyTreeSeason) => {
    const next = expandedSeasonId === season.id ? null : season.id;
    setExpandedSeasonId(next);
    if (next && !dotsBySeasonId[season.id]) onExpandSeason(season);
  };

  // 個別メンバー選択時「つくった・あつめたもの」（決定21）。絞り込みは既存の
  // 表示項目（獲得した人・描いた人のmember_id）による閲覧フィルタにすぎず、
  // 07-13-3章「景品は引いた人ではなく家族の所有物」という家族共有の原則は
  // 変えない（一時的に絞り込んで見せているだけ）。
  //
  // [2026-09-09修正・統括の実機確認からの指摘] 家族の絵（`item.drawing`が存在する
  // 行）は「描いた人（artistId）」だけで絞り込む。従来は`collectorId === selectedMemberId
  // || item.drawing?.artistId === selectedMemberId`という「引いた人 or 描いた人」の
  // OR条件だったため、自分が描いていなくても自分が引き当てた絵まで「じぶんの
  // つくった・あつめたもの」に出てしまっていた。既製の飾り（`item.drawing`が無い行）は
  // 描いた人が存在しないため、従来どおり「引いた人（collectorId）」で絞り込む。
  const memberMadeOrCollected = useMemo(() => {
    if (selectedMemberId === ALL_MEMBERS_ID) return [];
    return collectedItems.filter((item) =>
      item.drawing ? item.drawing.artistId === selectedMemberId : item.collectorId === selectedMemberId
    );
  }, [collectedItems, selectedMemberId]);

  // [2026-09-25追加・実装メモ303.x章] ジャンプボタンの一覧。ボタンの文言は
  // 実際に画面へ出す見出しの文言とそろえる（依頼文3節「実際の区分名は画面の
  // 見出しに合わせる」）。中身が0件（ロード未完了・0件どちらも含む）の区分は
  // 出さない（依頼文3節「中身が0件で出ていない区分のボタンは出さない」）。
  const jumpSections = useMemo(() => {
    if (selectedMemberId === ALL_MEMBERS_ID) {
      return [
        { key: "collected", label: collectedLabel, visible: collectedLoadState === "ready" && collectedItems.length > 0 },
        { key: "figure", label: "フィギュア", visible: familyStickersLoadState === "ready" },
        { key: "medal", label: "メダル", visible: familyHabitFiguresLoadState === "ready" },
      ];
    }
    return [
      {
        key: "collected",
        label: "つくった・あつめたもの",
        visible: collectedLoadState === "ready" && memberMadeOrCollected.length > 0,
      },
      { key: "figure", label: "フィギュア", visible: stickersLoadState === "ready" },
      { key: "medal", label: "メダル", visible: habitFiguresLoadState === "ready" },
    ];
  }, [
    selectedMemberId,
    collectedLabel,
    collectedLoadState,
    collectedItems.length,
    memberMadeOrCollected.length,
    familyStickersLoadState,
    familyHabitFiguresLoadState,
    stickersLoadState,
    habitFiguresLoadState,
  ]);

  return (
    <View style={{ marginTop: theme.spacing.s4 }}>
      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setTab("collected")}
          style={[styles.tabButton, tab === "collected" && styles.tabButtonActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: tab === "collected" }}
        >
          <Text style={[bodyMediumStyleFor(tone), tab === "collected" && styles.tabTextActive]}>{collectedLabel}</Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("pastTrees")}
          style={[styles.tabButton, tab === "pastTrees" && styles.tabButtonActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: tab === "pastTrees" }}
        >
          <Text style={[bodyMediumStyleFor(tone), tab === "pastTrees" && styles.tabTextActive]}>{pastTreesLabel}</Text>
        </Pressable>
        {/* [2026-09-19追加・要件定義書07-28章決定31、主要画面ワイヤーフレーム.md
            49-B.6章決定47] 「シール帳」タブ。現行実装が帯のタップ先に
            置いていた「できあがったシール帳（Nさつ）」の一覧をここへ移す
            （2か所に出さない、依頼文決定11）。
            [2026-09-20改称・決定76] 実機（3タブ横並び）で「しまったシール…」と
            末尾が切れたため、「シール帳」（子ども「シールちょう」）に短縮した。 */}
        <Pressable
          onPress={() => setTab("habitCardArchive")}
          style={[styles.tabButton, tab === "habitCardArchive" && styles.tabButtonActive]}
          accessibilityRole="button"
          accessibilityState={{ selected: tab === "habitCardArchive" }}
        >
          <Text style={[bodyMediumStyleFor(tone), tab === "habitCardArchive" && styles.tabTextActive]} numberOfLines={1}>
            {isChild ? "シールちょう" : "シール帳"}
          </Text>
        </Pressable>
      </View>

      {tab === "collected" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          {/* [2026-09-08新設・主要画面ワイヤーフレーム.md 32.2a節] メンバー選択チップ。
              「集めたもの」タブの中にのみ置く（決定20）。既定は「全員」（決定22）。 */}
          <MemberSelectionChips
            tone={tone}
            members={members}
            myMemberId={myMemberId}
            selectedMemberId={selectedMemberId}
            onSelectMember={onSelectMember}
          />

          {/* [2026-09-25追加・要件定義書07-40章、実装メモ303.x章] 区分ジャンプ
              ボタン（目次）。見た目は既存のメンバー選択チップと同じ部品を流用する
              （新しい見た目は作らない、依頼文3節）。中身が0件の区分（jumpSections側で
              判定済み）は出さない。scrollViewRefが渡っていない・出せる区分が無い
              ときは行自体を出さない。 */}
          {scrollViewRef && jumpSections.some((s) => s.visible) && (
            <View style={[styles.stickerMemberRow, { marginTop: theme.spacing.s3 }]}>
              {jumpSections
                .filter((s) => s.visible)
                .map((s) => (
                  <Pressable
                    key={s.key}
                    onPress={() => scrollToSection(s.key)}
                    style={styles.stickerMemberChip}
                    accessibilityRole="button"
                  >
                    <Text style={captionStyle}>{s.label}</Text>
                  </Pressable>
                ))}
            </View>
          )}

          {selectedMemberId === ALL_MEMBERS_ID ? (
            // 「全員」選択時: 既存の家族共有プールドビューをそのまま表示する（決定21、変更なし）。
            <View
              style={{ marginTop: theme.spacing.s4 }}
              ref={registerSectionRef("collected")}
              onLayout={() => measureSectionOffset("collected")}
              collapsable={false}
            >
              {collectedLoadState === "loading" && <SkeletonList count={3} />}
              {collectedLoadState === "error" && (
                <ErrorState
                  tone={isChild ? "child" : "parent"}
                  title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
                  onRetry={onRetryCollected}
                />
              )}
              {collectedLoadState === "ready" && collectedItems.length === 0 && (
                <View style={styles.emptyWrap}>
                  <Text style={styles.emptyEmoji}>🎁</Text>
                  <Text style={[bodyStyle, styles.emptyText]}>
                    {isChild
                      ? "まだ なにも あつまっていないよ。ガチャで あつめてみよう！"
                      : "まだ何も集まっていません。ガチャで集めてみましょう"}
                  </Text>
                  <AppButton
                    label={isChild ? "ガチャへ →" : "ガチャへ"}
                    tone={tone}
                    onPress={onGoToGacha}
                    style={{ marginTop: theme.spacing.s4 }}
                  />
                </View>
              )}
              {collectedLoadState === "ready" && collectedItems.length > 0 && (
                <>
                  {/* [2026-09-25追加・実装メモ303.x章] ジャンプボタンの飛び先が
                      分かるよう見出しを追加した（従来はここに見出しが無かった）。
                      空状態のときは既存の絵文字中心の空状態表示（上の分岐）を
                      崩さないよう、件数がある時だけ出す。 */}
                  <Text style={[captionStyle, styles.legendHeading]}>{collectedLabel}</Text>
                  <ShelfItemsGrid tone={tone} items={collectedItems} myMemberId={myMemberId} />
                </>
              )}

              {/* --- メダル区分（「全員」選択時。実装メモ158章・統括の実機確認「あつめたものに
                  メダルも入れてほしい」対応）
                  [2026-09-21改訂・要件定義書07-34章「メダルとフィギュアの入れ替え」]
                  見出しの語を入れ替えた（コンポーネント名`FamilyMedalSection`は
                  07-34章5節の原則により変更していない。渡すデータ〈sticker_catalog由来〉も
                  変わらない）。 --- */}
              <View
                style={{ marginTop: theme.spacing.s6 }}
                ref={registerSectionRef("figure")}
                onLayout={() => measureSectionOffset("figure")}
                collapsable={false}
              >
                <Text style={[captionStyle, styles.legendHeading]}>フィギュア</Text>
                <FamilyMedalSection
                  tone={tone}
                  members={members}
                  loadState={familyStickersLoadState}
                  purchases={familyStickerPurchases}
                  onRetry={onRetryFamilyStickers}
                />
              </View>

              {/* --- フィギュア区分（「全員」選択時。要件定義書07-28章決定27、
                  メダルとは別の区分見出し・区画に分ける、開発部/成果物/実装メモ.md 237章）
                  [2026-09-21改訂・要件定義書07-34章] 見出しの語を入れ替えた
                  （コンポーネント名`FamilyHabitFigureSection`は変更していない。渡すデータ
                  〈habit_figure_catalog由来〉も変わらない）。 --- */}
              <View
                style={{ marginTop: theme.spacing.s6 }}
                ref={registerSectionRef("medal")}
                onLayout={() => measureSectionOffset("medal")}
                collapsable={false}
              >
                <Text style={[captionStyle, styles.legendHeading]}>メダル</Text>
                <FamilyHabitFigureSection
                  tone={tone}
                  members={members}
                  loadState={familyHabitFiguresLoadState}
                  grants={familyHabitFigureGrants}
                  onRetry={onRetryFamilyHabitFigures}
                />
              </View>
            </View>
          ) : (
            // 個別メンバー選択時: つくった/あつめたもの・シール・フィギュアの3区分（決定21・22）。
            // [2026-09-21削除・主要画面ワイヤーフレーム.md 58.5a節決定3] 旧「バッジ」区分
            // （決定24）は、絵が無く集めるものでもないため「集めたもの」区画から外した。
            // 通帳（P16/C8）・S1「MyPointsCard」の表示（見出しは「これまでの回数」
            // 「ここまでの かず」に改称、58.2節）は変更しない。
            <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s6 }}>
              {/* --- つくった・あつめたもの区分（決定21） --- */}
              <View
                ref={registerSectionRef("collected")}
                onLayout={() => measureSectionOffset("collected")}
                collapsable={false}
              >
                <Text style={[captionStyle, styles.legendHeading]}>つくった・あつめたもの</Text>
                {collectedLoadState === "loading" && <SkeletonList count={2} />}
                {collectedLoadState === "ready" && memberMadeOrCollected.length === 0 && (
                  <Text style={bodyStyle}>{isChild ? "まだ なにも あつまっていないよ" : "まだ何も集まっていません"}</Text>
                )}
                {collectedLoadState === "ready" && memberMadeOrCollected.length > 0 && (
                  <ShelfItemsGrid tone={tone} items={memberMadeOrCollected} myMemberId={myMemberId} />
                )}
              </View>

              {/* --- シール区分（決定23。所有数0の行は表示しない） --- */}
              <View ref={registerSectionRef("figure")} onLayout={() => measureSectionOffset("figure")} collapsable={false}>
                <StickerShelfSection
                  tone={tone}
                  isViewingSelf={isViewingSelf}
                  selectedMemberName={selectedMember?.display_name ?? "?"}
                  loadState={stickersLoadState}
                  purchases={stickerPurchases}
                  onRetry={onRetryStickers}
                  onGoToShop={onGoToStickerShop}
                  onPlace={onPlaceSticker}
                  onMove={onMoveSticker}
                />
              </View>

              {/* --- フィギュア区分（決定23と同じ扱い。所有数0の種類×段階は表示しない） --- */}
              <View ref={registerSectionRef("medal")} onLayout={() => measureSectionOffset("medal")} collapsable={false}>
                <HabitFigureShelfSection
                  tone={tone}
                  isViewingSelf={isViewingSelf}
                  selectedMemberName={selectedMember?.display_name ?? "?"}
                  loadState={habitFiguresLoadState}
                  grants={habitFigureGrants}
                  onRetry={onRetryHabitFigures}
                  onPlace={onPlaceHabitFigure}
                  onMove={onMoveHabitFigure}
                />
              </View>
            </View>
          )}
        </View>
      )}

      {tab === "pastTrees" && (
        <View style={{ marginTop: theme.spacing.s4 }}>
          {pastSeasonsLoadState === "loading" && <SkeletonList count={2} />}
          {pastSeasonsLoadState === "error" && (
            <ErrorState
              tone={isChild ? "child" : "parent"}
              title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
              onRetry={onRetryPastSeasons}
            />
          )}
          {pastSeasonsLoadState === "ready" && pastSeasons.length === 0 && (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyEmoji}>🌳</Text>
              <Text style={[bodyStyle, styles.emptyText]}>
                {isChild
                  ? "きろくは まだ ないよ。今月の木が おわると、ここに のこるよ"
                  : "記録はまだありません。今月の木が終わると、ここに残ります"}
              </Text>
            </View>
          )}
          {pastSeasonsLoadState === "ready" &&
            pastSeasons.map((season) => {
              const expanded = expandedSeasonId === season.id;
              const stageInfo = theme.treeStages[season.current_stage] ?? theme.treeStages[0];
              return (
                <Card key={season.id} tone={tone} style={{ marginTop: theme.spacing.s3 }}>
                  <Pressable
                    onPress={() => toggleSeason(season)}
                    style={styles.seasonHeaderRow}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                  >
                    <Text style={bodyMediumStyleFor(tone)}>
                      {formatMonthLabel(season.season_start)}の木：{stageInfo.name} {stageInfo.emoji}
                    </Text>
                    <Text style={[bodyStyle, styles.seasonToggle]}>{isChild ? (expanded ? "とじる" : "みる ▼") : expanded ? "とじる ▲" : "見る ▼"}</Text>
                  </Pressable>

                  {expanded && (
                    <View style={{ marginTop: theme.spacing.s3 }}>
                      {loadingSeasonIds[season.id] && <SkeletonList count={1} />}
                      {errorSeasonIds[season.id] && (
                        <ErrorState
                          tone={isChild ? "child" : "parent"}
                          title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
                          onRetry={() => onExpandSeason(season)}
                        />
                      )}
                      {!loadingSeasonIds[season.id] && !errorSeasonIds[season.id] && dotsBySeasonId[season.id] && (
                        <>
                          {/* [2026-09-18追加・統括指摘「コレクションされた家族の木は絵を
                              拡大できるのか？8月の木はされていない」・実装メモ.md 251章]
                              UIUX 46.4節決定8「過去の木には追加しない」を統括の判断で
                              撤回し、現在の木（app/parent/family-tree.tsx等）と同じ
                              `enableTapExpand`・`tone`を渡してタップ拡大を有効化する。
                              46.5節決定9のとおりオプトインのため、この2行を足すだけで
                              有効になる。過去シーズンの`dots`・`stickerPlacements`・
                              `habitFigurePlacements`はいずれも現在の木と同じ取得関数
                              （`fetchFamilyTreeCompletionDots`等、src/hooks/
                              useCollectorShelf.tsのusePastTreeSeasonDots参照）で
                              取得しており、拡大モーダルが読む`decoratedAt`・報告者
                              member_id等のデータ形は現在の木と同一。メンバー名解決も
                              TreeStageVisual内部の`useAppData()`（家族の現メンバー
                              一覧）を使うため、過去シーズン用に別途membersを渡す必要は
                              ない。 */}
                          <TreeStageVisual
                            stage={season.current_stage}
                            dots={dotsBySeasonId[season.id]}
                            stickerPlacements={stickerPlacementsBySeasonId[season.id]}
                            habitFigurePlacements={habitFigurePlacementsBySeasonId[season.id]}
                            enableTapExpand
                            tone={tone}
                          />
                          <PastTreeColorLegend
                            dots={dotsBySeasonId[season.id]}
                            members={members}
                            tone={tone}
                          />
                          {/* [2026-09-02追加] 週ごとの記録（21.0節決定11）。「見る」展開と
                              同一ビュー内に表示し、新しいタップ操作は追加しない。過去シーズンは
                              相対呼称が意味を持たないため全週`M/D週`表記に統一し（決定11）、
                              季節カードごとの縦幅増加を抑えるためparentCaption相当（12pt）の
                              小さめの文字で表示する（21.6節「縦幅への配慮」）。 */}
                          {weeklyBySeasonId[season.id] && (
                            <View style={{ marginTop: theme.spacing.s3 }}>
                              <Text style={[captionStyle, styles.legendHeading]}>
                                {isChild ? "しゅうごとの きろく" : "週ごとのきろく"}
                              </Text>
                              <FamilyTreeWeeklyList
                                items={buildFamilyTreeWeeklyItems({
                                  weeklyCounts: weeklyBySeasonId[season.id],
                                  seasonStart: season.season_start,
                                  seasonEnd: season.season_end,
                                  isChild,
                                  useRelativeLabels: false,
                                })}
                                countLabel={isChild ? "かい" : "回"}
                                labelStyle={captionStyle}
                                countStyle={captionStyle}
                              />
                            </View>
                          )}
                        </>
                      )}
                    </View>
                  )}
                </Card>
              );
            })}
        </View>
      )}

      {tab === "habitCardArchive" && (
        <HabitCardArchiveSection tone={tone} members={members} myMemberId={myMemberId} />
      )}
    </View>
  );
}

/**
 * 「しまったシール帳」タブの中身（主要画面ワイヤーフレーム.md 49-B.6章決定47〜50）。
 * ChildHabitCardModal.tsxと同じ「自己完結」の設計（visible時のみ通信、選択メンバーの
 * 状態もこのコンポーネント内に閉じ込める）を踏襲する。メンバー選択の既定は自分自身
 * （決定49。「集めたもの」タブの既定「全員」とは異なる）。「全員」を選んだときは
 * 一覧を出さず案内のみ表示する（決定48。家族共有プールという概念がここには無いため）。
 */
function HabitCardArchiveSection({ tone, members, myMemberId }: { tone: Tone; members: FamilyMember[]; myMemberId: string }) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const { state } = useAppData();
  const { catalog } = useHabitFigureCatalog();
  const [selectedMemberId, setSelectedMemberId] = useState(myMemberId);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const isAll = selectedMemberId === ALL_MEMBERS_ID;
  const { loadState, cards, breakdown, grants, reload } = useCompletedHabitCards(isAll ? "" : selectedMemberId);

  return (
    <View style={{ marginTop: theme.spacing.s4 }}>
      <MemberSelectionChips tone={tone} members={members} myMemberId={myMemberId} selectedMemberId={selectedMemberId} onSelectMember={setSelectedMemberId} />

      {isAll ? (
        // [決定48] 「全員」を選んだときは一覧を出さず、案内のみ表示する。
        <Text style={[bodyStyle, { marginTop: theme.spacing.s4 }]}>
          {isChild ? "ひとりずつ えらんでね" : "メンバーを選んでください"}
        </Text>
      ) : (
        <View style={{ marginTop: theme.spacing.s4 }}>
          {loadState === "loading" && <SkeletonList count={2} />}
          {loadState === "error" && (
            <ErrorState tone={isChild ? "child" : "parent"} title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"} onRetry={reload} />
          )}
          {loadState === "ready" && cards.length === 0 && (
            <Text style={bodyStyle}>{isChild ? "まだ できあがった シールちょうは ないよ" : "まだ完成したシール帳はありません"}</Text>
          )}
          {loadState === "ready" &&
            cards.map((card) => {
              const expanded = expandedCardId === card.id;
              const kindInfo = getHabitCardKindInfo(card, catalog, isChild);
              const cardBreakdown = breakdown.filter((b) => b.habit_card_id === card.id);
              // [決定46を完成済みの冊にも適用、決定50] 多い順上位5件＋ほか◯件。
              const summary = summarizeHabitCardBreakdown(cardBreakdown, state.chores, 5);
              const cardGrants = grants.filter((g) => g.habit_card_id === card.id);
              const days = computeHabitCardDurationDays(card.started_at, card.completed_at);
              const period = `${toJstDateString(card.started_at).replace(/-/g, "/")}〜${
                card.completed_at ? toJstDateString(card.completed_at).replace(/-/g, "/") : ""
              }（${days}日間）`;
              return (
                <Card key={card.id} tone={tone} style={{ marginTop: theme.spacing.s3 }}>
                  <Pressable
                    onPress={() => setExpandedCardId(expanded ? null : card.id)}
                    style={styles.seasonHeaderRow}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                  >
                    <Text style={bodyMediumStyle} numberOfLines={1}>
                      {expanded ? "▾" : "▸"} {kindInfo.kindEmoji ?? "🏳️"} {kindInfo.kindDisplayName}（クリスタル）
                    </Text>
                  </Pressable>
                  {expanded && (
                    <View style={{ marginTop: theme.spacing.s2, gap: theme.spacing.s2 }}>
                      <Text style={captionStyle}>{period}</Text>
                      <View>
                        {summary.top.map((entry) => (
                          <View key={entry.choreId ?? entry.title} style={styles.breakdownRow}>
                            <Text style={bodyStyle} numberOfLines={1}>
                              {entry.emoji ?? "📝"} {entry.title}
                            </Text>
                            <Text style={captionStyle}>{isChild ? `${entry.count}かい` : `${entry.count}回`}</Text>
                          </View>
                        ))}
                        {summary.otherCount > 0 && (
                          <Text style={captionStyle}>{isChild ? `ほか${summary.otherCount}けん` : `ほか${summary.otherCount}件`}</Text>
                        )}
                      </View>
                      <Text style={bodyStyle}>
                        {cardGrants.length > 0
                          ? cardGrants
                              .map((g) => ({ bronze: "🥉", silver: "🥈", gold: "🥇", crystal: "💎" }[g.tier]))
                              .join("")
                          : "🥉🥈🥇💎"}{" "}
                        {isChild ? "ぜんだんかい獲得" : "全段階獲得"}
                      </Text>
                    </View>
                  )}
                </Card>
              );
            })}
        </View>
      )}
    </View>
  );
}

/**
 * 「シール」区分（主要画面ワイヤーフレーム.md 32.2a節「シール」区分・決定23）。
 * 所有している種類（形×レアリティ）だけを列挙する。所有数0の組み合わせは
 * 表示しない（旧32.2節の12マス固定グリッドは廃止）。
 *
 * [2026-09-08・木への配置が自由配置化（スキーマ設計.sql 49章）したことに伴う
 * 開発部の実装判断] UIUXデザイン部32.2a節は「木に飾る」ボタンのみを想定していたが
 * （旧・色丸との交換方式が前提）、49章により配置後の「うごかす」操作が新設された
 * （統括判断49.12章）。UIUXデザイン部からはこの「うごかす」導線のUI配置について
 * 別タスクとしての発注が申し送られている（49.17章）ため、開発部の判断として、
 * 各エントリ（形×レアリティ）に「うごかす」を併設する。同じ形×レアリティを
 * 複数個所有し、かつ複数月にわたって購入した場合、過去シーズンに配置済み
 * （凍結・移動不可）のインスタンスと今シーズンに配置済み（移動可）のインスタンスが
 * 混在しうるが、「うごかす」は今シーズンの配置がある場合にのみ出す
 * （過去シーズンの配置は移動対象外）。
 *
 * [2026-09-11改訂・本部長経由の統括指摘（実装メモ151章）] 従来は横1行の文字列
 * （小さな`StickerIcon` 28pt＋テキスト＋ボタンを1行に並べる表示）だったが、統括の
 * 指摘「同じ自分の持ち物なのに見た目も操作もバラバラで、せっかくのメダルの絵が
 * 見えない」（『お絵かきと同じ感じで並べて、同様に押したら拡大されるように』）を
 * 受け、上の「つくった・あつめたもの」区分（`ShelfItemsGrid`）と同じ
 * カードグリッド＋タップで開く詳細カードの形に統一した。カードの大きさ・間隔・
 * 角丸は`ShelfItemsGrid`と共通の`styles.grid`/`styles.gridItem`/`styles.gridItemSelected`
 * /`styles.gridCaption`をそのまま流用し、新規スタイルは追加していない。
 * 「木に飾る」「うごかす」は行から詳細カード（`StickerDetailCard`）の中へ移した
 * （決定25「自分を選んでいるときだけ表示」は維持）。詳細・迷った点は実装メモ151章参照。
 */
function buildStickerShelfEntries(
  purchases: StickerPurchaseWithCatalog[]
): { key: string; shape: StickerShape; rarity: StickerRarity; owned: StickerPurchaseWithCatalog[] }[] {
  const entries: { key: string; shape: StickerShape; rarity: StickerRarity; owned: StickerPurchaseWithCatalog[] }[] = [];
  theme.stickerShapes.forEach((shape) => {
    theme.stickerRarities.forEach((rarity) => {
      const owned = purchases.filter((p) => p.sticker_catalog?.shape === shape && p.sticker_catalog?.rarity === rarity);
      if (owned.length === 0) return; // 決定23: 所有数0の組み合わせは表示しない
      entries.push({ key: `${shape}-${rarity}`, shape, rarity, owned });
    });
  });
  return entries;
}

function stickerEntryLabel(tone: Tone, shape: StickerShape, rarity: StickerRarity): string {
  const isChild = tone === "child";
  return `${isChild ? stickerShapeLabel[shape].child : stickerShapeLabel[shape].parent} ${
    isChild ? stickerRarityLabel[rarity].child : stickerRarityLabel[rarity].parent
  }`;
}

/**
 * [2026-09-25新設・要件定義書07-40章、主要画面ワイヤーフレーム.md 66章（決定1・3、
 * 66.9節申し送り3）] 「全員」ビューのフィギュア区分（`FamilyMedalSection`）用。
 * `buildStickerShelfEntries`（決定23・所有数0は含めない、個別ビュー専用）とは違い、
 * `theme.stickerCatalogOrder`（形×レアリティの固定順、32.1節購入画面と同じ）の
 * 全16件をそのまま返す。家族の誰も持っていない行は`owned: []`のまま返し、
 * 呼び出し側で「？」カード（`UnknownCatalogCard`）として描画する（決定3・66.3節）。
 */
function buildFamilyFigureCatalogEntries(
  purchases: StickerPurchaseWithCatalog[]
): { key: string; shape: StickerShape; rarity: StickerRarity; owned: StickerPurchaseWithCatalog[] }[] {
  return theme.stickerCatalogOrder.map(({ shape, rarity }) => ({
    key: `${shape}-${rarity}`,
    shape,
    rarity,
    owned: purchases.filter((p) => p.sticker_catalog?.shape === shape && p.sticker_catalog?.rarity === rarity),
  }));
}

function StickerShelfSection({
  tone,
  isViewingSelf,
  selectedMemberName,
  loadState,
  purchases,
  onRetry,
  onGoToShop,
  onPlace,
  onMove,
}: {
  tone: Tone;
  isViewingSelf: boolean;
  selectedMemberName: string;
  loadState: LoadState;
  purchases: StickerPurchaseWithCatalog[];
  onRetry: () => void;
  onGoToShop: () => void;
  onPlace: (purchaseId: string, shape: StickerShape, rarity: StickerRarity) => void;
  onMove: (decorationId: string, shape: StickerShape, rarity: StickerRarity, posX: number, posY: number) => void;
}) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const totalOwned = purchases.length;
  const entries = useMemo(() => buildStickerShelfEntries(purchases), [purchases]);
  const selectedEntry = entries.find((e) => e.key === selectedKey) ?? null;

  return (
    <View>
      {/* [2026-09-07改訂・本部長／実装メモ152章] 呼び名を「メダル」に統一（統括判断）。
          DBの`sticker_key`・コンポーネント名・コメント中の「シール」「ステッカー」は変更しない。
          [2026-09-21改訂・要件定義書07-34章「メダルとフィギュアの入れ替え」] 見出しの語を
          「フィギュア」へ入れ替えた（関数名`StickerShelfSection`は変更していない）。 */}
      <Text style={[captionStyle, styles.legendHeading]}>フィギュア</Text>

      {loadState === "loading" && <SkeletonList count={2} />}
      {loadState === "error" && (
        <ErrorState tone={isChild ? "child" : "parent"} title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"} onRetry={onRetry} />
      )}

      {loadState === "ready" && totalOwned === 0 && (
        <>
          {isViewingSelf ? (
            <>
              <Text style={bodyStyle}>{isChild ? "まだ フィギュアを もっていないよ。かってみよう→" : "まだフィギュアを購入していません。購入する→"}</Text>
              <AppButton
                label={isChild ? "フィギュアを かいに いく →" : "購入する →"}
                tone={tone}
                onPress={onGoToShop}
                style={{ marginTop: theme.spacing.s3 }}
              />
            </>
          ) : (
            <Text style={bodyStyle}>{isChild ? `${selectedMemberName}さんは まだ もっていないよ` : `${selectedMemberName}さんはまだ持っていません`}</Text>
          )}
        </>
      )}

      {loadState === "ready" && totalOwned > 0 && (
        <>
          <View style={styles.grid}>
            {entries.map((entry) => {
              const selected = entry.key === selectedKey;
              return (
                <Pressable
                  key={entry.key}
                  onPress={() => setSelectedKey(selected ? null : entry.key)}
                  style={[styles.gridItem, selected && styles.gridItemSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  {/* [2026-09-21改訂・要件定義書07-34章、62.5節] sticker_catalog
                      （入れ替え後「フィギュア」）はFigureFrame＋FigureIconで表示する。 */}
                  <FigureFrame size={48}>
                    <FigureIcon figureKey={figureKeyOfSticker(entry.shape, entry.rarity)} kindEmoji={stickerShapeFallbackEmoji[entry.shape]} size={24} />
                  </FigureFrame>
                  <Text style={[captionStyle, styles.gridCaption]}>
                    {stickerEntryLabel(tone, entry.shape, entry.rarity)}
                    {entry.owned.length > 1 ? ` ×${entry.owned.length}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {selectedEntry && (
            <ExpandedItemModal tone={tone} onClose={() => setSelectedKey(null)}>
              {(imageSize) => (
                <StickerDetailCard
                  tone={tone}
                  isViewingSelf={isViewingSelf}
                  // 「木に飾る」「うごかす」は木の画面へ移るため、先にモーダルを閉じる
                  // （開いたまま移ると、裏に残った前の画面のモーダルが上に被さり続ける）。
                  onPlace={(...args) => {
                    setSelectedKey(null);
                    onPlace(...args);
                  }}
                  onMove={(...args) => {
                    setSelectedKey(null);
                    onMove(...args);
                  }}
                  entry={selectedEntry}
                  imageSize={imageSize}
                  onClose={() => setSelectedKey(null)}
                />
              )}
            </ExpandedItemModal>
          )}

          {isViewingSelf && (
            <Pressable onPress={onGoToShop} style={{ marginTop: theme.spacing.s3 }}>
              <Text style={[bodyStyle, { color: theme.colors.brandPrimaryStrong }]}>
                {isChild ? "→ フィギュアを かいに いく" : "→ フィギュアを買いに行く"}
              </Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

/**
 * シール詳細カード（グリッドをタップすると開く）。`ShelfItemsGrid`の家族の絵の
 * 詳細（`DrawingThumbnail size={220}`で拡大表示する分岐）と同じ縦積みレイアウト
 * （`styles.detailDrawingWrap`/`detailDrawingTextWrap`/`detailDrawingCenterText`を
 * 流用）を使い、`StickerIcon`は`size={220}`・`highRes`指定で512px画像を使う。
 * 名前・必要ポイント・今シーズンに飾ってあるかどうか・「うごかす」「木に飾る」の
 * 導線をここにまとめる（従来は一覧の行に出ていた。統括指摘・実装メモ151章）。
 *
 * [必要ポイントの出典について・迷った点] `sticker_catalog`の`points_cost`
 * （カタログの現在価格）ではなく、`owned`配列の先頭（＝最も新しい購入。
 * `fetchMyStickerPurchases`が`purchased_at`降順で返すため）の`points_spent`
 * （その購入インスタンスが実際に支払った額）を表示する。カタログの現在価格を
 * 出すにはAPI側のselect文とドメイン型（`StickerPurchaseWithCatalog.sticker_catalog`の
 * Pick）を拡張する必要があり、今回は「DBの変更は無い」指示の範囲を画面側の
 * 表示ロジックだけに留めるため、既に取得済みの`points_spent`で代替した。
 * カタログ価格が改定されない前提なら両者は一致する（価格改定機能は現状無い）。
 */
function StickerDetailCard({
  tone,
  imageSize,
  onClose,
  isViewingSelf,
  entry,
  onPlace,
  onMove,
}: {
  tone: Tone;
  imageSize: number;
  onClose: () => void;
  isViewingSelf: boolean;
  entry: { shape: StickerShape; rarity: StickerRarity; owned: StickerPurchaseWithCatalog[] };
  onPlace: (purchaseId: string, shape: StickerShape, rarity: StickerRarity) => void;
  onMove: (decorationId: string, shape: StickerShape, rarity: StickerRarity, posX: number, posY: number) => void;
}) {
  const isChild = tone === "child";
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);

  const { shape, rarity, owned } = entry;
  const unplaced = owned.filter((p) => !p.placement);
  const currentSeasonPlaced = owned.find((p) => p.placement?.isCurrentSeason);
  const pointsCost = owned[0]?.points_spent;

  return (
    <Pressable style={styles.detailDrawingWrap} onPress={onClose}>
      {/* [2026-09-21改訂・要件定義書07-34章、62.5節] sticker_catalog
          （入れ替え後「フィギュア」）はFigureFrame＋FigureIconで表示する。 */}
      <Pressable onPress={() => {}}>
        <FigureFrame size={imageSize} innerRatio={DETAIL_INNER_RATIO}>
          <FigureIcon figureKey={figureKeyOfSticker(shape, rarity)} kindEmoji={stickerShapeFallbackEmoji[shape]} size={detailIconSizeFor(imageSize)} />
        </FigureFrame>
      </Pressable>
      <View style={styles.detailDrawingTextWrap}>
        <Text style={[bodyMediumStyle, styles.detailDrawingCenterText]}>{stickerEntryLabel(tone, shape, rarity)}</Text>
        {/* [2026-09-25新設・要件定義書07-40章4節・10節決定5、主要画面ワイヤーフレーム.md
            66.2節決定5] 「いつ・どうやって」。既存の`points_spent`表示（金額のみ）に
            購入日（`purchased_at`、複数所有時は最新）を並べて添える。新しいデータ
            取得は不要（`owned`は`fetchMyStickerPurchases`が`purchased_at`降順で
            返すため、`owned[0]`が常に最新）。 */}
        {pointsCost != null && owned[0] && (
          <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>
            {isChild
              ? `${formatShortDate(owned[0].purchased_at)} ${pointsCost}pt で かったよ`
              : `${formatShortDate(owned[0].purchased_at)} ${pointsCost}ptで購入しました`}
          </Text>
        )}
        <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>
          {currentSeasonPlaced
            ? isChild
              ? "いまの きに かざってあるよ"
              : "いまの木にかざってあります"
            : isChild
            ? "いまの きには かざっていないよ"
            : "いまの木にはかざっていません"}
        </Text>
        {isViewingSelf && (
          <View style={{ marginTop: theme.spacing.s3, alignItems: "center", gap: theme.spacing.s2 }}>
            {currentSeasonPlaced && currentSeasonPlaced.placement && (
              <Pressable
                onPress={() =>
                  onMove(
                    currentSeasonPlaced.placement!.decorationId,
                    shape,
                    rarity,
                    currentSeasonPlaced.placement!.posX,
                    currentSeasonPlaced.placement!.posY
                  )
                }
                hitSlop={8}
              >
                <Text style={[captionStyle, styles.stickerRowMoveLink]}>うごかす</Text>
              </Pressable>
            )}
            {unplaced.length > 0 && (
              <AppButton
                label={isChild ? "木に かざる" : "木に飾る"}
                tone={tone}
                variant="secondary"
                onPress={() => onPlace(unplaced[0].id, shape, rarity)}
              />
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

/**
 * 「？」カード（要件定義書07-40章決定3・10節決定5〜7、主要画面ワイヤーフレーム.md
 * 66.3節決定7〜9）。「全員」ビューで、カタログの行のうち家族の誰もまだ持っていない
 * ものを表す。メダル（円形の`CircleFrame`）・フィギュア（五角形の`FigureFrame`）の
 * どちらの枠にも属さない第三の形（角丸四角形）にすることで、（a）「メダルとフィギュアを
 * 同じ形の図鑑にそろえる」（決定1）を視覚的にも体現し、（b）フィギュアの五角形の枠に
 * 輪郭だけ薄く見せる案で懸念された「輪郭でカブトムシ・ちょうちょ等と判別できてしまう」
 * 問題（07-40章5節補足）を構造的に避ける（決定7）。塗り色は`theme.habitCardCellColors`
 * （シール帳「いまの10マス」グリッドが既に使っている段階の色、`HabitCardBoard.tsx`
 * `TenCellsGrid`参照）をそのまま流用し、新しい色トークンは追加しない。名前・入手方法・
 * 形の輪郭は一切表示しない（決定7・8）。
 *
 * [文字色について・66.9節申し送り5] 「？」の文字色は白系（`theme.colors.neutralSurface`）を
 * 想定しているが、4色（銅・銀・金・クリスタル）いずれに対しても十分なコントラストが
 * 取れるかは実機で確認する必要がある（ワイヤーフレームの申し送りどおり、本実装では
 * 固定値を決め打ちする。問題があれば色の選定自体をデザイントークン.md側で見直す）。
 */
function UnknownCatalogCard({ size, tier }: { size: number; tier: StickerRarity }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.parentMd,
        backgroundColor: theme.habitCardCellColors[tier],
        borderWidth: 1,
        borderColor: theme.habitCardCellBorderColor,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: theme.colors.neutralSurface, fontWeight: "700", fontSize: Math.round(size * 0.5) }}>?</Text>
    </View>
  );
}

/**
 * 「？」カードの拡大表示（主要画面ワイヤーフレーム.md 66.3節決定9、66.11節統括回答2）。
 * 名前・入手方法・達成率・ボタン・リンクは一切置かない（決定9理由4）。文言は
 * 子ども「まだ ひみつだよ」（0.1節の既存語彙をそのまま流用）、大人（保護者・
 * みまもりメンバー）「家族の誰もまだ持っていません」（66.11節・統括が決定9の
 * 「まだ秘密です」から差し替え）。
 */
function UnknownDetailCard({
  tone,
  tier,
  imageSize,
  onClose,
  name,
}: {
  tone: Tone;
  tier: StickerRarity;
  imageSize: number;
  onClose: () => void;
  /**
   * [2026-09-25追加・実装メモ303.x章、依頼文1節「拡大表示にも名前を出してよい」]
   * 呼び出し側が組み立てた「種類名 段階名」を渡す。省略時（呼び出し元が渡さない
   * 場合の保険）は出さない。文言（「まだひみつだよ」等）は変えない。
   */
  name?: string;
}) {
  const isChild = tone === "child";
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);

  return (
    <Pressable style={styles.detailDrawingWrap} onPress={onClose}>
      <Pressable onPress={() => {}}>
        <UnknownCatalogCard size={imageSize} tier={tier} />
      </Pressable>
      <View style={styles.detailDrawingTextWrap}>
        <Text style={[bodyMediumStyle, styles.detailDrawingCenterText]}>
          {isChild ? "まだ ひみつだよ" : "家族の誰もまだ持っていません"}
        </Text>
        {name && (
          <Text
            style={[
              captionStyle,
              styles.detailDrawingCenterText,
              { marginTop: theme.spacing.s1, color: theme.colors.neutralTextSecondary },
            ]}
          >
            {name}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

/**
 * 「フィギュア」区分（「全員」選択時。実装メモ158章）。統括の実機確認「あつめたものに、
 * メダルも入れてほしい」への対応で、個別メンバー選択時の`StickerShelfSection`とは
 * 別に、家族全員分のフィギュア所有状況を1つのグリッドにまとめて表示する。
 *
 * [2026-09-25改訂・要件定義書07-40章、主要画面ワイヤーフレーム.md 66章] 従来は
 * 「家族の誰かが持っている行だけ」を列挙していたが、`buildFamilyFigureCatalogEntries`
 * （カタログ`theme.stickerCatalogOrder`の全16件を固定順で返す）に差し替え、
 * 家族の誰も持っていない行は`UnknownCatalogCard`（「？」カード、決定3・66.3節）で
 * 埋める「図鑑」形式にした。
 *
 * 表示グリッドは`StickerShelfSection`（個別メンバー版）と完全に同じスタイル
 * （`styles.grid`/`gridItem`/`gridCaption`）を使い、「つくった・あつめたもの」の
 * グリッドとも見た目を揃える（統括指摘・実装メモ151章で揃えたばかりのため）。
 * ただし「木に飾る」「うごかす」「メダルを買いに行く」などの操作導線は一切持たない
 * （決定6「全員選択時に並べ替え等のボタンを一切配置しない」・決定25「自分を
 * 選んでいるときだけ操作を表示」。全員ビューは特定の「自分」を持たないため）。
 */
function FamilyMedalSection({
  tone,
  members,
  loadState,
  purchases,
  onRetry,
}: {
  tone: Tone;
  members: FamilyMember[];
  loadState: LoadState;
  purchases: StickerPurchaseWithCatalog[];
  onRetry: () => void;
}) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const entries = useMemo(() => buildFamilyFigureCatalogEntries(purchases), [purchases]);
  const selectedEntry = entries.find((e) => e.key === selectedKey) ?? null;

  if (loadState === "loading") return <SkeletonList count={2} />;
  if (loadState === "error") {
    return (
      <ErrorState
        tone={isChild ? "child" : "parent"}
        title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
        onRetry={onRetry}
      />
    );
  }
  // [66.6節] `theme.stickerCatalogOrder`は16件固定のため、この分岐は通常到達しない
  // 防御的コードとして残す（実装方法自体は開発部の判断に委ねる、66.9節申し送り7）。
  if (entries.length === 0) {
    return <Text style={bodyStyle}>{isChild ? "まだ ないよ" : "まだありません"}</Text>;
  }

  return (
    <>
      <View style={styles.grid}>
        {entries.map((entry) => {
          const selected = entry.key === selectedKey;
          const isUnknown = entry.owned.length === 0;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setSelectedKey(selected ? null : entry.key)}
              style={[styles.gridItem, selected && styles.gridItemSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              {isUnknown ? (
                // [2026-09-25新設・決定3・7、2026-09-25追記・本部長差し戻し
                // （実装メモ303.x章）] 家族の誰も持っていない行は「？」カード。
                // 「？」カードの下にも持っているカードと同じ位置・同じ形で
                // 種類名だけを薄い文字色で出す（依頼文1節）。
                <>
                  <UnknownCatalogCard size={48} tier={entry.rarity} />
                  <Text style={[captionStyle, styles.gridCaption, { color: theme.colors.neutralTextSecondary }]}>
                    {stickerKindOnlyLabel(tone, entry.shape)}
                  </Text>
                </>
              ) : (
                <>
                  {/* [2026-09-21改訂・要件定義書07-34章、62.5節] sticker_catalog
                      （入れ替え後「フィギュア」）はFigureFrame＋FigureIconで表示する。 */}
                  <FigureFrame size={48}>
                    <FigureIcon figureKey={figureKeyOfSticker(entry.shape, entry.rarity)} kindEmoji={stickerShapeFallbackEmoji[entry.shape]} size={24} />
                  </FigureFrame>
                  <Text style={[captionStyle, styles.gridCaption]}>
                    {/* [2026-09-25改訂・本部長差し戻し「フィギュアの上にうさぎだけでも
                        よいよ」] 1行が1種類・4列が銅→銀→金→クリスタルの固定順
                        グリッドのため、段階は列位置とマスの色で分かる。種類名だけを
                        出す（段階名まで入れた書き方は拡大表示・個別ビューで使う）。 */}
                    {stickerKindOnlyLabel(tone, entry.shape)}
                    {entry.owned.length > 1 ? ` ×${entry.owned.length}` : ""}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>

      {selectedEntry && (
        <ExpandedItemModal tone={tone} onClose={() => setSelectedKey(null)}>
          {(imageSize) =>
            selectedEntry.owned.length === 0 ? (
              <UnknownDetailCard
                tone={tone}
                tier={selectedEntry.rarity}
                imageSize={imageSize}
                onClose={() => setSelectedKey(null)}
                name={stickerEntryLabel(tone, selectedEntry.shape, selectedEntry.rarity)}
              />
            ) : (
              <FamilyStickerDetailCard
                tone={tone}
                members={members}
                entry={selectedEntry}
                imageSize={imageSize}
                onClose={() => setSelectedKey(null)}
              />
            )
          }
        </ExpandedItemModal>
      )}
    </>
  );
}

/**
 * 「メダル」区分（全員選択時）の詳細カード。個別メンバー版の`StickerDetailCard`とは
 * 異なり、木への配置状況・操作導線は持たず、「誰が何個持っているか」の内訳のみを示す。
 * 家族の絵の詳細（誰が描いたか）に倣い、「全員」ビューでも誰の物かを詳細タップで
 * 追えるようにする（本節冒頭コメント参照）。
 *
 * 並び順は`members`順（`PastTreeColorLegend`と同じ、決定5の内訳表示と揃える）で、
 * 件数の多い順には並べ替えない（07-10章必須3条件「ランキングを作らない」）。
 */
function FamilyStickerDetailCard({
  tone,
  imageSize,
  onClose,
  members,
  entry,
}: {
  tone: Tone;
  imageSize: number;
  onClose: () => void;
  members: FamilyMember[];
  entry: { shape: StickerShape; rarity: StickerRarity; owned: StickerPurchaseWithCatalog[] };
}) {
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const { shape, rarity, owned } = entry;
  // [2026-09-11追加・要件定義書07-27章 決定9] 上のPastTreeColorLegendと同じ理由。
  const { memberAvatars } = useAppData();

  const ownerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    owned.forEach((p) => counts.set(p.member_id, (counts.get(p.member_id) ?? 0) + 1));
    return members.filter((m) => counts.has(m.id)).map((m) => ({ member: m, count: counts.get(m.id)! }));
  }, [owned, members]);

  return (
    <Pressable style={styles.detailDrawingWrap} onPress={onClose}>
      {/* [2026-09-21改訂・要件定義書07-34章、62.5節] sticker_catalog
          （入れ替え後「フィギュア」）はFigureFrame＋FigureIconで表示する。 */}
      <Pressable onPress={() => {}}>
        <FigureFrame size={imageSize} innerRatio={DETAIL_INNER_RATIO}>
          <FigureIcon figureKey={figureKeyOfSticker(shape, rarity)} kindEmoji={stickerShapeFallbackEmoji[shape]} size={detailIconSizeFor(imageSize)} />
        </FigureFrame>
      </Pressable>
      <View style={styles.detailDrawingTextWrap}>
        <Text style={[bodyMediumStyle, styles.detailDrawingCenterText]}>{stickerEntryLabel(tone, shape, rarity)}</Text>
        <View style={[styles.legendRows, { marginTop: theme.spacing.s3, justifyContent: "center" }]}>
          {ownerCounts.map(({ member, count }) => (
            <View key={member.id} style={styles.legendRow}>
              <MemberAvatar name={member.display_name} color={member.avatar_color} size={20} lineData={memberAvatars[member.id]} expandOnTap />
              <Text style={captionStyle}>
                {member.display_name}
                {count > 1 ? ` ×${count}` : ""}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * [2026-09-25追加・実装メモ303.x章・要件定義書07-40章10節決定6] メダルの名前を
 * フィギュアの書き方「種類名 段階名」（`stickerEntryLabel`参照）にそろえる。
 * `habit_figure_catalog.display_name`は「どうのうさぎ」のように段階名＋「の」＋
 * 種類名が連結済みの1つの文字列で、種類名だけを取り出す列は存在しない
 * （`kind_display_name`は「うさぎのシール帳」のような別の用途の文言で、ここには使えない）。
 * 段階名の接頭辞（"どうの"/"ぎんの"/"きんの"/"クリスタルの"、`stickerRarityLabel`の
 * child表記＝ひらがな）を`display_name`の先頭から取り除くことで種類名だけを得る。
 * `kind_key`ごとの対応表をハードコードしないのは、habit_figure_catalogの設計方針
 * （55章決定55-7「新しい種類の追加はINSERTのみで完結させる」）をこの画面のためだけに
 * 壊さないため。
 *
 * [本部長指示・依頼文2節] このロジックは`HabitCardArchiveSection`（シール帳タブ）や
 * `HabitFigureGrantBanner`（獲得演出）とは共有しない。あちらは`kind_display_name`／
 * `kind_display_name_child`という別の列・別の文言（「うさぎのシール帳」等）を使っており、
 * 本関数を経由しても影響しない（この画面の中だけで組み立てる）。
 */
function habitFigureKindOnlyLabel(displayName: string, tier: StickerRarity): string {
  const prefix = `${stickerRarityLabel[tier].child}の`;
  return displayName.startsWith(prefix) ? displayName.slice(prefix.length) : displayName;
}

/**
 * 個別ビュー・拡大表示用のフルラベル（「種類名 段階名」、フィギュアの
 * `stickerEntryLabel`と同じ書式）。「全員」ビューの図鑑グリッドは段階が列位置と
 * 枠色で分かるため種類名だけ（`habitFigureKindOnlyLabel`）を使い、こちらは使わない。
 */
function habitFigureEntryLabel(tone: Tone, displayName: string, tier: StickerRarity): string {
  const kindOnly = habitFigureKindOnlyLabel(displayName, tier);
  return `${kindOnly} ${tone === "child" ? stickerRarityLabel[tier].child : stickerRarityLabel[tier].parent}`;
}

/**
 * 「フィギュア」区分（要件定義書07-28章決定27、主要画面ワイヤーフレーム.md
 * 49.2章決定3-③、開発部/成果物/実装メモ.md 237章）。`StickerShelfSection`と
 * 全く同じ構造（所有している種類×段階だけを列挙し、所有数0の組み合わせは
 * 表示しない）だが、メダルとは独立した別のコンポーネントとして実装する
 * （ワイヤーフレーム49.14章開発部への申し送り(3)「既存のメダル関連
 * コンポーネントを複製せず新しいコンポーネントとして実装すること」）。
 * `figure_catalog_id`でグルーピングする（種類×段階の組み合わせを一意に表す、
 * shape×rarityと同じ役割）。
 */
function buildHabitFigureShelfEntries(
  grants: HabitFigureGrantWithPlacement[]
): { key: string; figureKey: string; kindEmoji: string | null; displayName: string; tier: StickerRarity; owned: HabitFigureGrantWithPlacement[] }[] {
  const map = new Map<string, HabitFigureGrantWithPlacement[]>();
  for (const g of grants) {
    const key = g.figure_catalog_id;
    const list = map.get(key);
    if (list) list.push(g);
    else map.set(key, [g]);
  }
  return Array.from(map.entries()).map(([key, owned]) => {
    const catalog = owned[0].habit_figure_catalog;
    return {
      key,
      figureKey: catalog?.figure_key ?? "",
      kindEmoji: catalog?.kind_emoji ?? null,
      // [2026-09-25改訂・実装メモ303.x章] 表示用の組み立て（種類名＋段階名）は
      // 呼び出し側（habitFigureEntryLabel）に一本化した。ここでは生の
      // display_nameとtierだけ持つ（フォールバック文言はフィギュアと同じく「メダル」）。
      displayName: catalog?.display_name ?? "メダル",
      tier: owned[0].tier,
      owned,
    };
  });
}

/**
 * [2026-09-25新設・要件定義書07-40章、主要画面ワイヤーフレーム.md 66章（決定1・3、
 * 66.9節申し送り1・3）] 「全員」ビューのメダル区分（`FamilyHabitFigureSection`）用。
 * `buildHabitFigureShelfEntries`（所有分のみ、個別ビュー専用）とは違い、
 * `catalog`（`useHabitFigureCatalog()`が返す`habit_figure_catalog`の全件、
 * `is_active=true`・`sort_order`→`tier`の固定順）をそのまま返す。家族の誰も
 * 持っていない行は`owned: []`のまま返し、呼び出し側で「？」カード
 * （`UnknownCatalogCard`）として描画する（決定3・66.3節）。
 */
function buildFamilyMedalCatalogEntries(
  catalog: HabitFigureCatalogItem[],
  grants: HabitFigureGrantWithPlacement[]
): { key: string; figureKey: string; kindEmoji: string | null; displayName: string; tier: StickerRarity; owned: HabitFigureGrantWithPlacement[] }[] {
  // [2026-09-25発見・ローカルDB確認] `habit_figure_catalog.tier`はTEXT列（enumでは
  // ない、`20260925010000_habit_cards_and_figures.sql`225行目のCHECK制約）のため、
  // `fetchHabitFigureCatalog`の`.order("tier")`はPostgRESTの文字列順（bronze→
  // crystal→gold→silver）になり、決定1が求める「銅→銀→金→クリスタル」の進行順と
  // 一致しない。既存の`groupHabitFigureCatalogByKind`（絵柄選び直し画面用）は
  // `TIER_ORDER`で並べ替えてこの挙動を吸収していたが、本関数はその並べ替えを
  // 経由しない新しい経路のため、ここで同じ理由の並べ替えを行う
  // （`theme.stickerRarities`は既に`["bronze","silver","gold","crystal"]`の
  // 正しい進行順で定義済みのため、新しい並び順定義を増やさずそのまま使う）。
  const sorted = [...catalog].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return theme.stickerRarities.indexOf(a.tier) - theme.stickerRarities.indexOf(b.tier);
  });
  return sorted.map((item) => ({
    key: item.id,
    figureKey: item.figure_key,
    kindEmoji: item.kind_emoji,
    displayName: item.display_name,
    tier: item.tier,
    owned: grants.filter((g) => g.figure_catalog_id === item.id),
  }));
}

function HabitFigureShelfSection({
  tone,
  isViewingSelf,
  selectedMemberName,
  loadState,
  grants,
  onRetry,
  onPlace,
  onMove,
}: {
  tone: Tone;
  isViewingSelf: boolean;
  selectedMemberName: string;
  loadState: LoadState;
  grants: HabitFigureGrantWithPlacement[];
  onRetry: () => void;
  onPlace: (grantId: string, figureKey: string, kindEmoji: string | null) => void;
  onMove: (decorationId: string, figureKey: string, kindEmoji: string | null, posX: number, posY: number) => void;
}) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const totalOwned = grants.length;
  const entries = useMemo(() => buildHabitFigureShelfEntries(grants), [grants]);
  const selectedEntry = entries.find((e) => e.key === selectedKey) ?? null;

  return (
    <View>
      {/* [2026-09-21改訂・要件定義書07-34章] 見出しの語を「メダル」へ入れ替えた
          （関数名`HabitFigureShelfSection`は変更していない）。 */}
      <Text style={[captionStyle, styles.legendHeading]}>メダル</Text>

      {loadState === "loading" && <SkeletonList count={2} />}
      {loadState === "error" && (
        <ErrorState tone={isChild ? "child" : "parent"} title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"} onRetry={onRetry} />
      )}

      {loadState === "ready" && totalOwned === 0 && (
        <Text style={bodyStyle}>
          {isViewingSelf
            ? isChild
              ? "まだ メダルを もっていないよ。シールちょうを ためて もらおう"
              : "まだメダルを獲得していません。シール帳をためると獲得できます"
            : isChild
            ? `${selectedMemberName}さんは まだ もっていないよ`
            : `${selectedMemberName}さんはまだ持っていません`}
        </Text>
      )}

      {loadState === "ready" && totalOwned > 0 && (
        <>
          {/* [決定3-②] フィギュアの五角形枠と混同しないよう、円形の枠（CircleFrame）で
              表示する。[2026-09-21改訂・要件定義書07-34章、62.5節「結線の入れ替え」]
              入れ替え前はFigureFrame（五角形）だったが、円形へ差し替えた。 */}
          <View style={styles.grid}>
            {entries.map((entry) => {
              const selected = entry.key === selectedKey;
              return (
                <Pressable
                  key={entry.key}
                  onPress={() => setSelectedKey(selected ? null : entry.key)}
                  style={[styles.gridItem, selected && styles.gridItemSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  {/* [2026-09-21改訂・要件定義書07-34章、62.5節] habit_figure_catalog
                      （入れ替え後「メダル」）はCircleFrame＋HabitFigureCircleIconで表示する。 */}
                  <CircleFrame size={48} ringColor={null}>
                    <HabitFigureCircleIcon figureKey={entry.figureKey} kindEmoji={entry.kindEmoji} size={24} />
                  </CircleFrame>
                  <Text style={[captionStyle, styles.gridCaption]}>
                    {/* [2026-09-25改訂・実装メモ303.x章] 種類名＋段階名（フィギュアの
                        stickerEntryLabelと同じ書式）。個別ビューは種類が固定順で
                        並ばないため、ここは「全員」ビューの図鑑（種類名のみ）とは
                        異なり段階名まで出す（依頼文2節）。 */}
                    {habitFigureEntryLabel(tone, entry.displayName, entry.tier)}
                    {entry.owned.length > 1 ? ` ×${entry.owned.length}` : ""}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {selectedEntry && (
            <ExpandedItemModal tone={tone} onClose={() => setSelectedKey(null)}>
              {(imageSize) => (
                <HabitFigureDetailCard
                  tone={tone}
                  isViewingSelf={isViewingSelf}
                  // 「木に飾る」「うごかす」は木の画面へ移るため、先にモーダルを閉じる
                  // （開いたまま移ると、裏に残った前の画面のモーダルが上に被さり続ける）。
                  onPlace={(...args) => {
                    setSelectedKey(null);
                    onPlace(...args);
                  }}
                  onMove={(...args) => {
                    setSelectedKey(null);
                    onMove(...args);
                  }}
                  entry={selectedEntry}
                  imageSize={imageSize}
                  onClose={() => setSelectedKey(null)}
                />
              )}
            </ExpandedItemModal>
          )}
        </>
      )}
    </View>
  );
}

function HabitFigureDetailCard({
  tone,
  imageSize,
  onClose,
  isViewingSelf,
  entry,
  onPlace,
  onMove,
}: {
  tone: Tone;
  imageSize: number;
  onClose: () => void;
  isViewingSelf: boolean;
  entry: { figureKey: string; kindEmoji: string | null; displayName: string; tier: StickerRarity; owned: HabitFigureGrantWithPlacement[] };
  onPlace: (grantId: string, figureKey: string, kindEmoji: string | null) => void;
  onMove: (decorationId: string, figureKey: string, kindEmoji: string | null, posX: number, posY: number) => void;
}) {
  const isChild = tone === "child";
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);

  const { figureKey, kindEmoji, displayName, tier, owned } = entry;
  const unplaced = owned.filter((g) => !g.placement);
  const currentSeasonPlaced = owned.find((g) => g.placement?.isCurrentSeason);

  return (
    <Pressable style={styles.detailDrawingWrap} onPress={onClose}>
      {/* [2026-09-21改訂・要件定義書07-34章、62.5節] habit_figure_catalog
          （入れ替え後「メダル」）はCircleFrame＋HabitFigureCircleIconで表示する。 */}
      <Pressable onPress={() => {}}>
        <CircleFrame size={imageSize} ringColor={null} innerRatio={MEDAL_DETAIL_INNER_RATIO}>
          <HabitFigureCircleIcon figureKey={figureKey} kindEmoji={kindEmoji} size={detailIconSizeFor(imageSize, MEDAL_DETAIL_INNER_RATIO)} />
        </CircleFrame>
      </Pressable>
      <View style={styles.detailDrawingTextWrap}>
        {/* [2026-09-25改訂・実装メモ303.x章] 拡大表示は「全員」ビューの図鑑グリッドと
            違い種類が固定順で並ばないため、種類名＋段階名（フィギュアと同じ書式）を出す。 */}
        <Text style={[bodyMediumStyle, styles.detailDrawingCenterText]}>{habitFigureEntryLabel(tone, displayName, tier)}</Text>
        {/* [2026-09-25新設・要件定義書07-40章4節・10節決定5、主要画面ワイヤーフレーム.md
            66.2節決定5] 「いつ・どうやって」。常に自動付与の1通りのみ（どのクエストで
            到達したかは出さない、07-40章4節）。新しいデータ取得は不要（`owned`は
            `fetchMyHabitFigureGrants`が`granted_at`降順で返すため、`owned[0]`が
            常に最新）。 */}
        {owned[0] && (
          <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>
            {isChild
              ? `${formatShortDate(owned[0].granted_at)} シールちょうが ${stickerRarityLabel[owned[0].tier].child}に とどいたよ`
              : `${formatShortDate(owned[0].granted_at)} シール帳が${stickerRarityLabel[owned[0].tier].parent}に到達しました`}
          </Text>
        )}
        <Text style={[captionStyle, styles.detailDrawingCenterText, { marginTop: theme.spacing.s1 }]}>
          {currentSeasonPlaced
            ? isChild
              ? "いまの きに かざってあるよ"
              : "いまの木にかざってあります"
            : isChild
            ? "いまの きには かざっていないよ"
            : "いまの木にはかざっていません"}
        </Text>
        {isViewingSelf && (
          <View style={{ marginTop: theme.spacing.s3, alignItems: "center", gap: theme.spacing.s2 }}>
            {currentSeasonPlaced && currentSeasonPlaced.placement && (
              <Pressable
                onPress={() =>
                  onMove(
                    currentSeasonPlaced.placement!.decorationId,
                    figureKey,
                    kindEmoji,
                    currentSeasonPlaced.placement!.posX,
                    currentSeasonPlaced.placement!.posY
                  )
                }
                hitSlop={8}
              >
                <Text style={[captionStyle, styles.stickerRowMoveLink]}>うごかす</Text>
              </Pressable>
            )}
            {unplaced.length > 0 && (
              <AppButton
                label={isChild ? "木に かざる" : "木に飾る"}
                tone={tone}
                variant="secondary"
                onPress={() => onPlace(unplaced[0].id, figureKey, kindEmoji)}
              />
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

/**
 * 「メダル」区分（「全員」選択時）。`FamilyMedalSection`と同型で、木への
 * 配置状況・操作導線は持たず「誰が何個獲得しているか」の内訳のみを示す。
 *
 * [2026-09-25改訂・要件定義書07-40章、主要画面ワイヤーフレーム.md 66章、66.9節
 * 申し送り1] 従来は「家族の誰かが持っている行だけ」を列挙していたが、カタログ
 * （`habit_figure_catalog`、`useHabitFigureCatalog()`）の全件を`buildFamilyMedalCatalogEntries`
 * で固定順に並べ、家族の誰も持っていない行は`UnknownCatalogCard`（「？」カード、
 * 決定3・66.3節）で埋める「図鑑」形式にした。既存の`familyHabitFigureGrants`
 * （家族全員分の所有記録、`fetchFamilyHabitFigureGrants`）はそのまま使い、
 * カタログ取得だけを本コンポーネント内で追加する（`HabitCardArchiveSection`が
 * 既に使っているのと同じフック）。
 */
function FamilyHabitFigureSection({
  tone,
  members,
  loadState,
  grants,
  onRetry,
}: {
  tone: Tone;
  members: FamilyMember[];
  loadState: LoadState;
  grants: HabitFigureGrantWithPlacement[];
  onRetry: () => void;
}) {
  const isChild = tone === "child";
  const bodyStyle = bodyStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const { loadState: catalogLoadState, catalog, reload: reloadCatalog } = useHabitFigureCatalog();

  const entries = useMemo(() => buildFamilyMedalCatalogEntries(catalog, grants), [catalog, grants]);
  const selectedEntry = entries.find((e) => e.key === selectedKey) ?? null;

  const combinedLoading = loadState === "loading" || catalogLoadState === "loading";
  const combinedError = loadState === "error" || catalogLoadState === "error";
  const retryAll = () => {
    onRetry();
    void reloadCatalog();
  };

  if (combinedLoading) return <SkeletonList count={2} />;
  if (combinedError) {
    return (
      <ErrorState
        tone={isChild ? "child" : "parent"}
        title={isChild ? "つうしんがおやすみ中みたい" : "読み込みに失敗しました"}
        onRetry={retryAll}
      />
    );
  }
  // [66.6節] カタログ（habit_figure_catalog、is_active=true）が1件も無い場合のみ
  // 到達する防御的な分岐（実装方法自体は開発部の判断に委ねる、66.9節申し送り7）。
  if (entries.length === 0) {
    return <Text style={bodyStyle}>{isChild ? "まだ ないよ" : "まだありません"}</Text>;
  }

  return (
    <>
      <View style={styles.grid}>
        {entries.map((entry) => {
          const selected = entry.key === selectedKey;
          const isUnknown = entry.owned.length === 0;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setSelectedKey(selected ? null : entry.key)}
              style={[styles.gridItem, selected && styles.gridItemSelected]}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              {isUnknown ? (
                // [2026-09-25新設・決定3・7、2026-09-25追記・本部長差し戻し
                // （実装メモ303.x章）] 家族の誰も持っていない行は「？」カード。
                // 「？」カードの下にも持っているカードと同じ位置・同じ形で
                // 種類名だけを薄い文字色で出す（依頼文1節）。
                <>
                  <UnknownCatalogCard size={48} tier={entry.tier} />
                  <Text style={[captionStyle, styles.gridCaption, { color: theme.colors.neutralTextSecondary }]}>
                    {habitFigureKindOnlyLabel(entry.displayName, entry.tier)}
                  </Text>
                </>
              ) : (
                <>
                  {/* [2026-09-21改訂・要件定義書07-34章、62.5節] habit_figure_catalog
                      （入れ替え後「メダル」）はCircleFrame＋HabitFigureCircleIconで表示する。 */}
                  <CircleFrame size={48} ringColor={null}>
                    <HabitFigureCircleIcon figureKey={entry.figureKey} kindEmoji={entry.kindEmoji} size={24} />
                  </CircleFrame>
                  <Text style={[captionStyle, styles.gridCaption]}>
                    {/* [2026-09-25改訂・本部長差し戻し「フィギュアの上にうさぎだけでも
                        よいよ」] 1行が1種類・4列が銅→銀→金→クリスタルの固定順
                        グリッドのため、段階は列位置とマスの色で分かる。種類名だけを
                        出す（段階名まで入れた書き方は拡大表示・個別ビューで使う）。 */}
                    {habitFigureKindOnlyLabel(entry.displayName, entry.tier)}
                    {entry.owned.length > 1 ? ` ×${entry.owned.length}` : ""}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })}
      </View>

      {selectedEntry && (
        <ExpandedItemModal tone={tone} onClose={() => setSelectedKey(null)}>
          {(imageSize) =>
            selectedEntry.owned.length === 0 ? (
              <UnknownDetailCard
                tone={tone}
                tier={selectedEntry.tier}
                imageSize={imageSize}
                onClose={() => setSelectedKey(null)}
                name={habitFigureEntryLabel(tone, selectedEntry.displayName, selectedEntry.tier)}
              />
            ) : (
              <FamilyHabitFigureDetailCard
                tone={tone}
                members={members}
                entry={selectedEntry}
                imageSize={imageSize}
                onClose={() => setSelectedKey(null)}
              />
            )
          }
        </ExpandedItemModal>
      )}
    </>
  );
}

function FamilyHabitFigureDetailCard({
  tone,
  imageSize,
  onClose,
  members,
  entry,
}: {
  tone: Tone;
  imageSize: number;
  onClose: () => void;
  members: FamilyMember[];
  entry: { figureKey: string; kindEmoji: string | null; displayName: string; tier: StickerRarity; owned: HabitFigureGrantWithPlacement[] };
}) {
  const bodyMediumStyle = bodyMediumStyleFor(tone);
  const captionStyle = captionStyleFor(tone);
  const { figureKey, kindEmoji, displayName, tier, owned } = entry;
  const { memberAvatars } = useAppData();

  const ownerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    owned.forEach((g) => counts.set(g.member_id, (counts.get(g.member_id) ?? 0) + 1));
    return members.filter((m) => counts.has(m.id)).map((m) => ({ member: m, count: counts.get(m.id)! }));
  }, [owned, members]);

  return (
    <Pressable style={styles.detailDrawingWrap} onPress={onClose}>
      {/* [2026-09-21改訂・要件定義書07-34章、62.5節] habit_figure_catalog
          （入れ替え後「メダル」）はCircleFrame＋HabitFigureCircleIconで表示する。 */}
      <Pressable onPress={() => {}}>
        <CircleFrame size={imageSize} ringColor={null} innerRatio={MEDAL_DETAIL_INNER_RATIO}>
          <HabitFigureCircleIcon figureKey={figureKey} kindEmoji={kindEmoji} size={detailIconSizeFor(imageSize, MEDAL_DETAIL_INNER_RATIO)} />
        </CircleFrame>
      </Pressable>
      <View style={styles.detailDrawingTextWrap}>
        {/* [2026-09-25改訂・実装メモ303.x章] 拡大表示は種類名＋段階名（フィギュアと
            同じ書式）を出す（依頼文2節「拡大表示でだけ」段階名まで出す）。 */}
        <Text style={[bodyMediumStyle, styles.detailDrawingCenterText]}>{habitFigureEntryLabel(tone, displayName, tier)}</Text>
        <View style={[styles.legendRows, { marginTop: theme.spacing.s3, justifyContent: "center" }]}>
          {ownerCounts.map(({ member, count }) => (
            <View key={member.id} style={styles.legendRow}>
              <MemberAvatar name={member.display_name} color={member.avatar_color} size={20} lineData={memberAvatars[member.id]} expandOnTap />
              <Text style={captionStyle}>
                {member.display_name}
                {count > 1 ? ` ×${count}` : ""}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabRow: { flexDirection: "row", gap: theme.spacing.s2 },
  tabButton: {
    flex: 1,
    paddingVertical: theme.spacing.s3,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    alignItems: "center",
  },
  tabButtonActive: {
    backgroundColor: theme.gachaColors.accentSoft,
    borderColor: theme.gachaColors.accent,
  },
  tabTextActive: { color: theme.colors.neutralTextPrimary, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s3 },
  gridItem: {
    width: 84,
    minHeight: 84,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.s1,
    backgroundColor: theme.colors.neutralSurface,
    borderRadius: theme.radius.parentLg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    padding: theme.spacing.s2,
  },
  gridItemSelected: { borderColor: theme.gachaColors.accent, borderWidth: 2, backgroundColor: theme.gachaColors.accentSoft },
  gridEmoji: { fontSize: 32 },
  gridCaption: { textAlign: "center" },
  detailEmoji: { fontSize: 40 },
  // [2026-09-09新設] 家族の絵の詳細表示専用（拡大サムネイル＋縦積みレイアウト）。
  detailDrawingWrap: { alignItems: "center" },
  // [2026-09-23新設] お絵かきのリアクション・コメント区画の幅。detailDrawingWrapの
  // 兄弟要素（無反応のPressableで包んだもの）。
  detailEngagementWrap: { width: "100%", alignItems: "center" },
  detailDrawingTextWrap: { marginTop: theme.spacing.s3, alignItems: "center" },
  detailDrawingCenterText: { textAlign: "center" },
  // [2026-09-14新設・実装メモ225章] 「集めたもの」詳細の拡大表示モーダル。
  // `MemberAvatar.tsx`のoverlay/expandedCard/closeButton相当を、見た目を揃える
  // 目的でこちらにも複製した（トークン〈色・角丸・余白〉は共通のtheme参照のため
  // 値そのものは一致する。共通コンポーネント化は今回のスコープ外）。
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.s4,
  },
  // [2026-09-14改訂・本部長差し戻し（実装メモ225.7章）] `paddingTop`はロールごとに
  // 閉じるボタンの大きさが異なるため固定値を廃止し、呼び出し側で
  // `expandedCardPaddingTopFor(tone)`を都度計算してインラインで上書きする
  // （`ShelfItemsGrid`参照）。ここでは`paddingTop`以外の見た目のみを定義する。
  expandedCard: {
    alignItems: "center",
    backgroundColor: theme.colors.neutralSurface,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
    borderRadius: theme.radius.parentLg,
    paddingHorizontal: theme.spacing.s4,
    paddingBottom: theme.spacing.s4,
  },
  expandedCloseButton: {
    position: "absolute",
    top: theme.spacing.s2,
    right: theme.spacing.s2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.neutralBg,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  expandedCloseButtonText: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.neutralTextPrimary,
    lineHeight: 20,
  },
  emptyWrap: { alignItems: "center", paddingVertical: theme.spacing.s6 },
  legendWrap: { marginTop: theme.spacing.s3 },
  legendHeading: { color: theme.colors.neutralTextSecondary, marginBottom: theme.spacing.s2 },
  legendRows: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s3 },
  legendRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.s1 },
  legendNote: { color: theme.colors.neutralTextSecondary, marginTop: theme.spacing.s2 },
  emptyEmoji: { fontSize: 40, marginBottom: theme.spacing.s2 },
  emptyText: { textAlign: "center" },
  seasonHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  seasonToggle: { color: theme.colors.brandPrimaryStrong },
  // [2026-09-08改訂] メンバー選択チップ（旧「区画3」時代のスタイルを流用）。
  stickerMemberRow: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing.s2 },
  stickerMemberChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.s1,
    paddingHorizontal: theme.spacing.s2,
    paddingVertical: theme.spacing.s1,
    borderRadius: theme.radius.parentMd,
    borderWidth: 1,
    borderColor: theme.colors.neutralBorder,
  },
  stickerMemberChipActive: { borderColor: theme.gachaColors.accent, backgroundColor: theme.gachaColors.accentSoft },
  // [2026-09-19追加・しまったシール帳タブ] 内訳の1行（クエスト名＋回数）。
  breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  // [2026-09-11改訂] 旧・横1行表示（stickerRow等）はグリッド化に伴い廃止し、
  // 「うごかす」リンクのスタイルのみ残す（実装メモ151章）。
  stickerRowMoveLink: { color: theme.colors.brandPrimaryStrong, textDecorationLine: "underline" },
});

export default CollectorShelfPanel;
