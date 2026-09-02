import React from "react";
import { Pressable, Text, View } from "react-native";
import theme from "@/theme/theme";

export type ConsentRole = "parent" | "supporter";

interface InviteVisibilityConsentProps {
  /** P6（保護者の招待受諾）は"parent"、S0（みまもりメンバーの招待受諾）は"supporter"。
   *  aの表示有無のみを切り替える（要件定義書.md 06章(3)のロール差）。 */
  role: ConsentRole;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * 招待受諾フローの可視範囲説明＋同意チェックボックス（共通コンポーネント）。
 *
 * 参照:
 * - 要件定義書.md 06章「招待受諾フローにおける可視範囲の説明と同意取得」
 * - UIUXデザイン部/成果物/主要画面ワイヤーフレーム.md 26章（26.1節の文言を
 *   一字一句そのまま使用。26.7節「共通コンポーネント化」の推奨に対応）
 * - API仕様.md 2f章、開発部/成果物/実装メモ.md 111章
 *
 * P6（app/onboarding/join-preview.tsx, role="parent"）・
 * S0（app/onboarding/join-supporter.tsx, role="supporter"）から利用する。
 * このコンポーネントは導入文＋対象項目＋チェックボックスのみを描画し、
 * 参加確定ボタン・disabled条件・ボタン下のキャプションは各画面側が持つ
 * （26.7節「開発部への申し送り」・ボタンラベルがP6/S0で異なるため）。
 *
 * [同意版数の単一定義箇所] 下記の文言全文（導入文＋対象項目）が
 * consent_versionの版に対応する（26.7節「26.1節の文言全文をそのまま
 * consent_versionの版として扱ってよい」）。JOIN_CONSENT_VERSIONはこの
 * ファイル内の文言と対応する唯一の定義箇所とし、DB側
 * public.current_join_consent_version()（スキーマ設計.sql 40.5章）の
 * 返り値と一致させる。**文言を変更する場合（項目の追加・削除・言い回しの
 * 修正）は、このファイルの文言とJOIN_CONSENT_VERSIONの両方を更新したうえで、
 * DB側のcurrent_join_consent_version()もCREATE OR REPLACEで同じ値へ1つ
 * 進める同一デプロイを行うこと。** 片方だけ更新すると全ての参加リクエストが
 * check_violationで拒否され続ける（40.5章・40.11章、乖離にはすぐ気づける設計）。
 */
export const JOIN_CONSENT_VERSION = 1;

// [2026-09-02改訂・統括] 当初は「家族の中に隠しごとを作らない、という考え方で
// つくられています。」だったが、統括より「言い過ぎかもしれない、本質からずれて
// いる気がする、これしか読まないよね？」との指摘を受けて書き直した。
// (1) このアプリは家族で楽しむものであり、可視範囲の広さは目的ではなく結果である
// (2) 「隠しごとを作らない」は裏返すと「隠すことを許さない」と読める。実際には
//     未公開の絵・みまもりの自分専用ごほうびなど隠れるものは隠れている
// (3) 招待された人が読むのはこの1〜2文だけかもしれず、そこに置くべきは
//     可視範囲の思想ではなく「このアプリが何なのか」である
// 文案は統括の言葉「家族みんなで楽しくクエストをして、お互いに褒めたり楽しむ」を
// 軸にした。褒め合う機能（感謝メッセージ・スタンプ）が可視範囲の広さの理由その
// ものなので、各論への導入としても自然につながる（実装メモ112章）。
const INTRO_TEXT =
  "家族みんなで楽しくクエストをして、お互いに褒め合うアプリです。がんばりや気持ちが家族に見えることで成り立っています。参加する前に、何がどこまで見えるようになるかをご確認ください。";

const ITEM_A =
  "保護者は、家族のだれの通帳でも開いて、届いた感謝メッセージの本文を読めます。あなたが送った・受け取ったメッセージも、他の保護者から同じように読めます。";
const ITEM_B =
  "クエストの完了報告と、積み重なった実施履歴は、保護者・みまもりメンバーを含む家族全員が見られます。あなた自身の完了報告（自分専用のクエストも含む）も、同じように公開されます。";
const ITEM_C =
  "お子さんが描いた絵は、描いている間は本人にしか見えませんが、ガチャで引かれた瞬間に家族全員へ公開され、その後は非公開に戻せません。";
const ITEM_D =
  "家族の書き込みボードは、投稿の本文と、スタンプの数・だれが送ったかが家族全員に公開されます。投稿から5分を過ぎると本人でも削除できなくなり、それ以降は保護者だけがいつでも削除できます。";

const CHECKBOX_LABEL = "上記の内容を確認し、同意します";

export default function InviteVisibilityConsent({ role, checked, onChange }: InviteVisibilityConsentProps) {
  const isSupporter = role === "supporter";
  const bodyStyle = isSupporter ? theme.typography.supporterBody : theme.typography.parentBody;
  const accentColor = isSupporter ? theme.colors.supporterAccent : theme.colors.brandPrimary;
  // 26.2節: P6（parent）は導入文＋a・b・c・d、S0（supporter）は導入文＋b・c・dのみ。
  const items = isSupporter ? [ITEM_B, ITEM_C, ITEM_D] : [ITEM_A, ITEM_B, ITEM_C, ITEM_D];

  return (
    <View>
      <Text style={[bodyStyle, { marginTop: theme.spacing.s4 }]}>{INTRO_TEXT}</Text>

      {items.map((item, index) => (
        <View key={index} style={{ flexDirection: "row", marginTop: theme.spacing.s3 }}>
          <Text style={bodyStyle}>・</Text>
          <Text style={[bodyStyle, { flex: 1, marginLeft: theme.spacing.s1 }]}>{item}</Text>
        </View>
      ))}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => onChange(!checked)}
        style={{ flexDirection: "row", alignItems: "center", marginTop: theme.spacing.s4 }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 4,
            borderWidth: 2,
            borderColor: checked ? accentColor : theme.colors.neutralBorder,
            backgroundColor: checked ? accentColor : "transparent",
            alignItems: "center",
            justifyContent: "center",
            marginRight: theme.spacing.s2,
          }}
        >
          {checked ? <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>{"✓"}</Text> : null}
        </View>
        <Text style={[bodyStyle, { flex: 1 }]}>{CHECKBOX_LABEL}</Text>
      </Pressable>
    </View>
  );
}
