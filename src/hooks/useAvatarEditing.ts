/**
 * [2026-09-30新設・要件定義書07-44章、スキーマ設計.sql 81章、API仕様.md 37章、
 * 主要画面ワイヤーフレーム.md 69章、開発部/成果物/実装メモ.md 334章]
 * アバターを描く3画面（子どもC31・保護者P38・みまもりS26）の「保存する」「色にもどす」
 * 「まえのアバター（ストック）」の状態・通信を1か所にまとめたフック。3画面が同じ挙動に
 * なるよう、各画面に同じコードを3回書かない（従来は保存・色にもどすの処理を3画面に
 * 写していた）。画面は`useAvatarEditing(...)`の戻り値を`AvatarDrawingPanel`の
 * `editing`にそのまま渡すだけ。
 *
 * [ストックの取得・書き込み]
 * - 「まえのアバター」の一覧は、この画面を開いたとき（マウント時）と、RPCが成功した直後に
 *   1人分（最大3行）だけ読む。`store.tsx`の家族全員分のキャッシュ・
 *   `useBackgroundAutoRefresh`には載せない（スキーマ設計.sql 81.17章5）。画面の
 *   ローカルstateとして持つ。
 * - 保存・「色にもどす」・「これにもどす」はRPC（1トランザクション）、消すだけ
 *   クライアントの直接DELETE（RLSが本人＋保護者に限定。API仕様.md 37.1章）。
 * - 3枚いっぱいの`AV001`は、保存・「色にもどす」で起きる。**DBが最終防衛線**で、
 *   画面の事前の無効化（`avatarStock.ts`）をすり抜けたとき（別の端末で先に埋まった等）は、
 *   一覧を取り直して理由を出す（69.3節 決定13）。
 * - 「これにもどす」の`no_data_found`（P0002）は、エラー表示にせず「すでに変わっていた」
 *   として一覧と今の絵を取り直す（二度押し・別の端末の先行操作。81.17章7）。
 * - 失敗の表示は331章の仕組み（`useFailureNotice`＝原因別の文言＋目印）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/lib/session";
import { useAppData } from "@/data/store";
import { useFailureNotice } from "@/hooks/useFailureNotice";
import { useFlashMessage } from "@/hooks/useFlashMessage";
import {
  deleteMemberAvatarStock,
  fetchMemberAvatarStocks,
  PG_ERRCODE,
  resetMemberAvatar,
  restoreMemberAvatarFromStock,
  saveMemberAvatar,
} from "@/data/api";
import theme from "@/theme/theme";
import { getAvatarStockText, type AvatarStockTone } from "@/lib/avatarStockText";
import { savedResultLeftPreviousInStock, type AvatarStockStatus } from "@/lib/avatarStock";
import type { FamilyDrawingLineData, MemberAvatarStockRow } from "@/types/domain";

/** 「色にもどす」の結果。full＝まえのアバターがいっぱいで断られた（理由を出す）。 */
export type AvatarResetOutcome = "done" | "full" | "failed";
/** 「これにもどす」の結果。stale＝別の端末で先に変わっていた（一覧を取り直した）。 */
export type AvatarRestoreOutcome = "restored" | "stale" | "failed";

export function useAvatarEditing(args: {
  tone: AvatarStockTone;
  /** 描く対象のmemberId（自分、または保護者が代理で描く相手）。 */
  memberId: string | undefined;
  displayName: string;
  isProxy: boolean;
}) {
  const { tone, memberId, displayName, isProxy } = args;
  const { client } = useSession();
  const { setMemberAvatarLocal, clearMemberAvatarLocal, refreshMemberAvatars } = useAppData();
  const text = useMemo(() => getAvatarStockText({ tone, isProxy, displayName }), [tone, isProxy, displayName]);

  // ---- まえのアバター（一覧） ----
  const [stocks, setStocks] = useState<MemberAvatarStockRow[]>([]);
  const [stocksStatus, setStocksStatus] = useState<AvatarStockStatus>("loading");
  const stocksRequestRef = useRef(0);
  // 「DBが保存を拒否した（別の端末で先に3枚になっていた）」あと、一覧が3枚未満に戻るまで
  // 理由カードを出し続けるための目印（69.3節 決定13「別の端末ですでにいっぱいになっていたとき」）。
  const [saveRefusedFull, setSaveRefusedFull] = useState(false);
  const [highlightMessage, flashHighlight] = useFlashMessage();

  /** 一覧を取り直す。失敗したらnull（このときstatusはerror）。新しい取得が始まっていたら古い応答は捨てる。 */
  const reloadStocks = useCallback(async (): Promise<MemberAvatarStockRow[] | null> => {
    if (!memberId) return null;
    stocksRequestRef.current += 1;
    const requestId = stocksRequestRef.current;
    const res = await fetchMemberAvatarStocks(client, memberId);
    if (requestId !== stocksRequestRef.current) return res.ok ? res.data : null;
    if (!res.ok) {
      setStocksStatus("error");
      return null;
    }
    setStocks(res.data);
    setStocksStatus("ready");
    if (res.data.length < theme.avatarStock.maxSlots) setSaveRefusedFull(false);
    return res.data;
  }, [client, memberId]);

  useEffect(() => {
    setStocks([]);
    setStocksStatus("loading");
    setSaveRefusedFull(false);
    void reloadStocks();
  }, [reloadStocks]);

  const retryStocks = useCallback(() => {
    setStocksStatus("loading");
    void reloadStocks();
  }, [reloadStocks]);

  // ---- 保存 ----
  const [saving, setSaving] = useState(false);
  const { errorMessage, errorRef, setErrorMessage, showFailure } = useFailureNotice(tone);
  const [savedMessage, flashSaved, clearSaved] = useFlashMessage();

  const onSave = async (lineData: FamilyDrawingLineData): Promise<boolean> => {
    if (!memberId) return false;
    setSaving(true);
    setErrorMessage(null);
    clearSaved();
    setSaveRefusedFull(false);
    const res = await saveMemberAvatar(client, memberId, lineData);
    setSaving(false);
    if (!res.ok) {
      if (res.error.code === PG_ERRCODE.avatarStockFull) {
        // 画面の事前判定をすり抜けた（別の端末で先に3枚になっていた等）。理由カードを出し、
        // 一覧と今の絵を取り直して実際の状態に直す。キャンバスは触らない。
        setSaveRefusedFull(true);
        await Promise.all([reloadStocks(), refreshMemberAvatars()]);
        return false;
      }
      showFailure(res.error);
      return false;
    }
    // [スキーマ設計.sql 54.7章(b)] 保存成功後はローカルキャッシュだけ更新する（今の絵）。
    setMemberAvatarLocal(memberId, lineData);
    const leftInStock = savedResultLeftPreviousInStock(res.data.result);
    flashSaved(leftInStock ? text.saveSuccessStocked : text.saveSuccess);
    if (leftInStock) {
      flashHighlight("on");
      void reloadStocks();
    }
    return true;
  };

  // ---- 色にもどす ----
  const [resetting, setResetting] = useState(false);
  const {
    errorMessage: resetErrorMessage,
    errorRef: resetErrorRef,
    setErrorMessage: setResetErrorMessage,
    showFailure: showResetFailure,
  } = useFailureNotice(tone);
  const [resetSuccessMessage, flashResetSuccess, clearResetSuccess] = useFlashMessage();

  const onReset = async (): Promise<AvatarResetOutcome> => {
    if (!memberId) return "failed";
    setResetting(true);
    setResetErrorMessage(null);
    clearResetSuccess();
    const res = await resetMemberAvatar(client, memberId);
    setResetting(false);
    if (!res.ok) {
      if (res.error.code === PG_ERRCODE.avatarStockFull) {
        await reloadStocks();
        return "full";
      }
      showResetFailure(res.error);
      return "failed";
    }
    clearMemberAvatarLocal(memberId);
    if (res.data.result === "stocked") {
      flashResetSuccess(text.resetSuccess);
      flashHighlight("on");
      void reloadStocks();
    } else {
      // 今の絵が既に無かった（別の端末で先に色にもどしていた等）。何も足していない。
      flashResetSuccess(text.resetSuccessPlain);
      void reloadStocks();
    }
    return "done";
  };

  // ---- これにもどす・まえのアバターを消す ----
  const [restoring, setRestoring] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const {
    errorMessage: stockActionErrorMessage,
    errorRef: stockActionErrorRef,
    setErrorMessage: setStockActionErrorMessage,
    showFailure: showStockActionFailure,
  } = useFailureNotice(tone);
  const [stockActionMessage, flashStockAction, clearStockAction] = useFlashMessage();

  const clearStockActionError = useCallback(() => setStockActionErrorMessage(null), [setStockActionErrorMessage]);

  const onRestoreStock = async (stock: MemberAvatarStockRow): Promise<AvatarRestoreOutcome> => {
    if (!memberId) return "failed";
    setRestoring(true);
    setStockActionErrorMessage(null);
    clearStockAction();
    const res = await restoreMemberAvatarFromStock(client, stock.id);
    setRestoring(false);
    if (!res.ok) {
      if (res.error.code === PG_ERRCODE.noDataFound) {
        // 二度押し・別の端末で先に戻された／消された。エラー表示にせず現状を取り直す。
        flashStockAction(text.staleGone);
        await Promise.all([reloadStocks(), refreshMemberAvatars()]);
        return "stale";
      }
      showStockActionFailure(res.error);
      return "failed";
    }
    // 戻したのは絵だけ（背景色は変わらない）。今の絵は、画面が持っているストックの中身に
    // 差し替える（今の絵の再取得は要らない。81.17章6）。入れ替えでidが変わるため一覧は取り直す。
    setMemberAvatarLocal(memberId, stock.line_data);
    if (res.data.result === "swapped") {
      flashStockAction(text.restoreSuccess);
      flashHighlight("on");
    } else {
      // 今の絵が無かった（色の状態から戻した）。入れ替える絵が無く、左端に入った絵は無い。
      flashStockAction(text.restoreSuccessNoCurrent);
    }
    void reloadStocks();
    return "restored";
  };

  const onDeleteStock = async (stock: MemberAvatarStockRow): Promise<boolean> => {
    setDeleting(true);
    setStockActionErrorMessage(null);
    clearStockAction();
    const res = await deleteMemberAvatarStock(client, stock.id);
    setDeleting(false);
    if (!res.ok) {
      showStockActionFailure(res.error);
      return false;
    }
    flashStockAction(text.deleteSuccess);
    setStocks((prev) => prev.filter((s) => s.id !== stock.id));
    // 空きができたので、DBに断られた理由カードは下げる（もう一度保存できる）。
    setSaveRefusedFull(false);
    void reloadStocks();
    return true;
  };

  return {
    text,
    // まえのアバター（一覧）
    stocks,
    stocksStatus,
    retryStocks,
    highlightNewest: highlightMessage !== null,
    // 保存
    saving,
    errorMessage,
    errorRef,
    savedMessage,
    saveRefusedFull,
    onSave,
    // 色にもどす
    resetting,
    resetErrorMessage,
    resetErrorRef,
    resetSuccessMessage,
    onReset,
    // これにもどす・消す
    restoring,
    deleting,
    stockActionErrorMessage,
    stockActionErrorRef,
    stockActionMessage,
    clearStockActionError,
    onRestoreStock,
    onDeleteStock,
  };
}

export type AvatarEditing = ReturnType<typeof useAvatarEditing>;
