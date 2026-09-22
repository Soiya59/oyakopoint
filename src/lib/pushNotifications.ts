/**
 * プッシュ通知の基盤（要件定義書07-37章、設計部/成果物/スキーマ設計.sql
 * 74章、API仕様.md 31章、UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md
 * 63章）。
 *
 * ここに置くのは「端末・OS・push_tokensテーブルとのやり取り」という純粋な
 * 処理のみ。ソフトアスクの表示条件・モーダルの見た目は
 * `src/components/NotificationSoftAsk.tsx` が担当する（役割を分けている）。
 *
 * [DBには何も保存しない・★重要] ソフトアスクの「あとで」印は端末ローカル
 * （AsyncStorage）にのみ持つ（スキーマ設計.sql 74.6章。旧稿の
 * `family_members.push_soft_ask_responded_at` 案は共有端末で二度と聞かれ
 * なくなる不具合を生むため撤回された）。
 *
 * [Web版での制約・★正直に書く]
 * - `Notifications.getPermissionsAsync()`/`requestPermissionsAsync()` は
 *   ブラウザのNotification APIにフォールバックする実装が既に
 *   `expo-notifications`に入っており（`NotificationPermissionsModule.js`、
 *   `.native.js`サフィックスが無いことを確認済み）、Web版でも実際に動く
 *   （Chromeの通知許可ダイアログが出る）。ソフトアスクの表示条件・
 *   モーダルの見た目はWeb版で確認できる。
 * - `Notifications.getExpoPushTokenAsync()`はWeb版では`vapidPublicKey`・
 *   `serviceWorkerPath`の追加設定が無いと例外を投げる
 *   （`getDevicePushTokenAsync.web.js`で確認済み）。本アプリはこの設定を
 *   行っていないため、Web版では**実際のトークン登録は行わない**
 *   （`Platform.OS === "web"`で早期リターンする）。ネイティブ実機・ビルドが
 *   無いと、実際のプッシュ通知の送受信そのものは確認できない。
 */
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import * as Linking from "expo-linking";
import Constants from "expo-constants";
import type { SupabaseClient } from "@supabase/supabase-js";

/** OSの通知許可状態。expo-notificationsのPermissionStatusをそのまま使う。 */
export type OsPermissionStatus = "granted" | "denied" | "undetermined";

const SOFT_ASK_DEFERRED_KEY = "oyakopoint.push_soft_ask_deferred.v1";

/**
 * この端末のOS通知許可状態を取得する。取得自体に失敗した場合（モジュール
 * 未対応の環境等）は"denied"を返す。ソフトアスクの表示条件は
 * `status === "undetermined"`のときだけ成立するため、失敗時に"denied"へ
 * 倒すことで、壊れた状態のままソフトアスクを繰り返し出して利用者を
 * 煩わせることを避ける（安全側＝出さない方向に倒す。63.4節の「行動が
 * 必要なときだけ出す」考え方と同じ）。
 */
export async function getOsPermissionStatus(): Promise<OsPermissionStatus> {
  try {
    const res = await Notifications.getPermissionsAsync();
    return res.status as OsPermissionStatus;
  } catch (err) {
    console.warn("pushNotifications: getPermissionsAsync failed", err);
    return "denied";
  }
}

/** ソフトアスクで「あとで」を選んだ印。端末ローカルのみ（DBには保存しない）。 */
export async function isSoftAskDeferred(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(SOFT_ASK_DEFERRED_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

export async function setSoftAskDeferred(): Promise<void> {
  try {
    await AsyncStorage.setItem(SOFT_ASK_DEFERRED_KEY, "1");
  } catch (err) {
    console.warn("pushNotifications: failed to persist soft-ask deferred flag", err);
  }
}

/**
 * この端末の「行動が必要な状態」（ワイヤーフレーム63.5.1節・63.5.2節）。
 * - "granted": 許可済み。何もしなくてよい。
 * - "deferred": 「あとで」を選んだ（OS許可はまだ未回答）。再挑戦できる。
 * - "denied": OSで拒否された。設定アプリへ誘導する。
 * - "undetermined": まだソフトアスクに一度も答えていない（次回起動時に
 *   自動で聞かれる）。行動不要。
 */
export type DeviceNotificationRowState = "granted" | "deferred" | "denied" | "undetermined";

export async function computeDeviceNotificationRowState(): Promise<DeviceNotificationRowState> {
  const osStatus = await getOsPermissionStatus();
  if (osStatus === "granted") return "granted";
  if (osStatus === "denied") return "denied";
  // osStatus === "undetermined"
  const deferred = await isSoftAskDeferred();
  return deferred ? "deferred" : "undetermined";
}

/**
 * この端末のExpoプッシュトークンを取得する。Web版・projectId未解決・
 * 実機以外（シミュレータ等）では取得できないことがあるため、失敗しても
 * 例外を投げずnullを返す（呼び出し側は「登録できなかった」as無害に扱う）。
 */
async function getExpoPushTokenSafe(): Promise<string | null> {
  if (Platform.OS === "web") {
    // [Web版での制約・冒頭コメント参照] vapidPublicKey等の追加設定が無いため、
    // Web版では常にスキップする（例外を投げさせない）。
    return null;
  }
  try {
    const projectId =
      (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
    const res = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return res.data;
  } catch (err) {
    console.warn("pushNotifications: getExpoPushTokenAsync failed", err);
    return null;
  }
}

/**
 * [設計部/成果物/スキーマ設計.sql 74.13章「開発部へ」2番・★重要]
 * いまログイン中のメンバー（保護者・みまもりメンバー・子どものいずれも）の
 * push_tokensを、この端末のExpoトークンでupsertする。
 *
 * OS許可が"granted"でない場合は何もしない（許可要求はソフトアスク側の
 * 責務。本関数はバックグラウンドの登録処理のみを担う）。
 *
 * 子どものPINログイン切り替え時にもこれを呼ぶこと。呼ばないと、74.1章の
 * 「投稿者本人が現在ログイン中の端末トークン」を用いた端末単位の除外が
 * 空振りする（子ども自身のmember_id行が無いため）。
 *
 * 失敗しても例外を投げない（バックグラウンドの付随処理であり、これが
 * 失敗してもアプリの主要な操作を止めるべきではない）。
 */
export async function registerPushTokenForMember(
  client: SupabaseClient,
  memberId: string
): Promise<void> {
  try {
    const osStatus = await getOsPermissionStatus();
    if (osStatus !== "granted") return;

    const token = await getExpoPushTokenSafe();
    if (!token) return;

    const { error } = await client
      .from("push_tokens")
      .upsert({ member_id: memberId, expo_push_token: token }, { onConflict: "member_id,expo_push_token" });
    if (error) {
      console.warn("pushNotifications: push_tokens upsert failed", error);
    }
  } catch (err) {
    console.warn("pushNotifications: registerPushTokenForMember threw", err);
  }
}

/**
 * ソフトアスクで「知らせてほしい」を選んだときに呼ぶ。OSの許可ダイアログを
 * 出し、許可されたらその場でトークン登録まで行う（63.4.2節「許可された」の
 * 直後、追加の演出はしないがトークンの登録は済ませておく）。
 */
export async function requestPushPermissionAndRegister(
  client: SupabaseClient,
  memberId: string
): Promise<OsPermissionStatus> {
  try {
    const res = await Notifications.requestPermissionsAsync();
    const status = res.status as OsPermissionStatus;
    if (status === "granted") {
      await registerPushTokenForMember(client, memberId);
    }
    return status;
  } catch (err) {
    console.warn("pushNotifications: requestPermissionsAsync failed", err);
    return "denied";
  }
}

/**
 * 63.4.3節「設定を開く」・63.5.1節/63.5.2節「設定を開く」共通の挙動
 * （OS標準のアプリ設定画面を開く）。
 */
export async function openDeviceNotificationSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch (err) {
    console.warn("pushNotifications: openSettings failed", err);
  }
}

/**
 * [2026-09-22追加・実装メモ283章 欠落①]
 * フォアグラウンド（アプリを開いている最中）に通知を受け取ったときの表示挙動を
 * 設定する。**これを一度も呼ばないと、expo-notificationsは「アプリが前面に
 * あるときは通知を表示しない」を既定動作にする**
 * （公式ソース: `node_modules/expo-notifications/build/NotificationsHandler.js`
 * のJSDoc「The default behavior when the handler is not set or does not
 * respond in time is not to show the notification.」で確認済み。憶測ではない）。
 *
 * SDK54以降、`handleNotification`の戻り値は`shouldShowAlert`ではなく
 * `shouldShowBanner`/`shouldShowList`に分かれている（`shouldShowAlert`は
 * deprecated。指定すると`[expo-notifications]: shouldShowAlert is
 * deprecated`という警告が出る。同ファイルで確認済み）。
 *
 * アプリ起動直後（初回レンダリングより前）に1回だけ呼べばよい。何度呼んでも
 * 副作用は無い（内部で古いリスナーを外してから張り直すだけ。同ファイル
 * `setNotificationHandler`実装参照）ため、呼び出し側の多重呼び出しを気にする
 * 必要はない。
 */
export function configureForegroundNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Android通知チャンネルのID。他の通知種別を増やすときもこのIDは変えないこと。 */
export const FAMILY_BOARD_ANDROID_CHANNEL_ID = "family-board-post";

/**
 * [2026-09-22追加・実装メモ283章 欠落②で「欠落ではなかった」と判明した点の記録]
 * Androidの通知チャンネルを明示的に作る。**ただし、これを一度も呼ばなくても
 * 通知自体は表示される。** expo-notificationsのネイティブ側
 * （`node_modules/expo-notifications/android/src/main/java/expo/modules/
 * notifications/notifications/presentation/builders/BaseNotificationBuilder.kt`
 * の`createFallbackChannel()`）が、送信側でchannelIdの指定が無い通知を受け取る
 * たびに`expo_notifications_fallback_notification_channel`という
 * フォールバックチャンネルを**自動生成**し、重要度は`IMPORTANCE_HIGH`
 * （ヘッドアップ通知として表示される水準）で固定している。実際にソースを
 * 読んで確認した結果であり、憶測ではない。
 *
 * それでも本関数を用意するのは、フォールバックチャンネルの表示名が
 * 「Miscellaneous」等の汎用名になり、端末の「アプリ情報→通知」から見たとき
 * 家族に何の通知か伝わらないため（将来の改善の下ごしらえ）。
 *
 * [★まだ効いていない・実装メモ283章に記載] このチャンネルを実際に使わせる
 * には、送信側（`supabase/functions/notify-family-board-post/index.ts`が
 * Expo Push APIへ送るメッセージ）に`channelId: "family-board-post"`を含める
 * 必要がある（Expo Push APIの`channelId`はFCMの`data.channelId`に渡り、
 * `FirebaseNotificationTrigger.getNotificationChannel()`がそこを読む。
 * `node_modules/expo-notifications/android/.../FirebaseNotificationTrigger.kt`
 * で確認済み）。現在の送信側はchannelIdを送っていないため、**本関数を呼んでも
 * 実際に使われるのは今までどおりフォールバックチャンネルのままであり、
 * 挙動は変わらない。** 送信側の変更はEdge
 * Functionの修正・デプロイを伴うため本チケットのスコープ外とし、本部長への
 * 報告事項として残す。
 */
export async function ensureAndroidNotificationChannelAsync(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(FAMILY_BOARD_ANDROID_CHANNEL_ID, {
      name: "家族の掲示板",
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      showBadge: true,
    });
  } catch (err) {
    console.warn("pushNotifications: setNotificationChannelAsync failed", err);
  }
}
