import React, { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { Text } from "react-native";
import type { StyleProp, TextStyle } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import Screen from "@/components/Screen";
import Card from "@/components/Card";
import AppButton from "@/components/AppButton";
import theme from "@/theme/theme";
import { hasAgreedToCurrentTerms, recordTermsConsent } from "@/data/api";
import { openExternalUrl } from "@/lib/externalLink";
import { LEGAL_PAGES_PUBLISHED, PRIVACY_POLICY_URL, TERMS_URL } from "@/lib/legalLinks";
import { useSession } from "@/lib/session";

/**
 * 利用規約への同意取得＋Play Families 安全リマインダー（初回1回のモーダル）。
 * やること.md 2-22（市場調査部レポート サマリー表#1・#7）、開発部/成果物/
 * 実装メモ.md 181章。
 *
 * [対象ロール・開発部の判断] 保護者・みまもり・子どもの3ロールすべてを対象と
 * する。理由:
 * 1. サマリー表#7「Play Families 安全リマインダー」の要求文は "before allowing
 *    child users to exchange freeform media or information"（子どもユーザーが
 *    自由形式のやりとりを始める前）であり、子ども自身を名指ししている。
 *    子どもを除外すると#7の要件そのものを満たせない。
 * 2. 市場調査部レポート1-5節「最小限の実装」も「子どもモードでも1回表示する
 *    （子どももUGCを作成するため）」と明記している。
 * 3. 宣伝部の利用規約（初稿・2026-09-07）5章は「お子さまにも読んでいただける
 *    よう、できるだけやさしい言葉で書いています」と明記しており、子ども向けに
 *    読める前提で書かれている。
 * 一方、join_consents（招待受諾時の可視範囲の同意）は子どもを対象外にしている
 * （子どもは招待受諾フロー自体を通らないため）。この既存の判断とは矛盾しない
 * ——join_consentsは「招待を受諾する行為」への同意、本モーダルは「アプリを
 * 使い始める前の規約同意」であり、対象にする行為の性質が異なる。
 *
 * [子ども向けの差] やること.md 2-28（外部URLを開く仕組み）の制約により、
 * 子ども向け画面には外部URLを開く導線を置かない。そのため子ども版のモーダルは
 * (a) 利用規約・プライバシーポリシーへのリンクを出さない、(b) チェックボックス
 * を置かず「わかった！」の1ボタンのみ、(c) 文言はひらがな中心のやさしい言葉
 * （5章と同じ配慮）にする。それでも記録するterms_consentsの行は保護者・
 * みまもりと同じ形（consent_version付き）で残る。
 */

export const TERMS_CONSENT_VERSION = 1;

// [文言の出典] 禁止事項1〜7は 宣伝部/成果物/利用規約（初稿・2026-09-07）.md
// 5章「みんなで気をつけること（禁止事項）」から一字一句そのまま転記した
// （依頼文「文面を創作しないこと」に対応。開発部では文言を作らない）。
const PROHIBITED_ITEMS = [
  "人がいやな気持ちになることを書かない（悪口、からかい、仲間はずれにするようなことなど）",
  "うそのことを書かない（自分や他の人になりすますことも含みます）",
  "こわい絵や、らんぼうな絵、はずかしい絵をかかない",
  "自分や他の人の住所・電話番号・通っている学校名など、個人がわかる情報を書かない",
  "本サービスに関係のない宣伝や、他の人を勧誘するようなことを書かない",
  "法律に違反することや、他の人の権利（著作権など）を傷つけることをしない",
  "招待コードを、家族として参加してほしい人以外に教えない",
];

const ADULT_INTRO =
  "「おやこポイント」を安全にご利用いただくため、はじめに次の点をご確認ください。";
// [Play Families 安全リマインダー・サマリー表#7] "provide an in-app reminder
// to be safe online and to be aware of the real world risk of online
// interaction before allowing child users to exchange freeform media or
// information" に対応する文言（開発部で起草。1-5節「初回モーダル1枚に3つを
// 同居させる」の設計どおり、このモーダル内に同居させる）。
const ADULT_SAFETY_REMINDER =
  "安全のお願い：お子さまは書き込みボード・お絵かき・感謝メッセージなどでご家族とやりとりします。インターネット上のやりとりには、思いがけないことにつながる場合もあります。困ったことがあれば、お子さまと一緒に話す時間を持ってください。";
const CHECKBOX_LABEL = "上記の内容を確認し、同意します";
const AGREE_BUTTON_LABEL = "同意して始める";
const RETRY_ERROR = "記録できませんでした。もう一度お試しください。";
const LINK_ERROR = "開けませんでした。もう一度お試しください。";

// [文言の出典・2026-09-11差し替え] 子ども向け表示（タイトル・以下のCHILD_*定数・
// CHILD_PROHIBITED_GROUPS）は 宣伝部/成果物/利用規約_子ども版（2026-09-09）.md
// 1章「表示する本文」（▼▼▼ 表示ここから ▼▼▼ 〜 ▲▲▲ 表示ここまで ▲▲▲、
// および直後の「ボタンの文言」）から一字一句そのまま転記した（やること.md 4-15、
// 統括決定2026-09-11「子どもの初回モーダルの文面を、宣伝部の子ども版に差し替える」）。
// 表示順は同文書「実装への差し替え指示（コード参照・2026-09-11追記）」節の
// 11行の対応表のとおり（開発部/成果物/実装メモ.md 196章で1行ずつ照合済み）。
// 差し替え前の仮文言（開発部が起草したもの）はgit履歴に残る。
const CHILD_TITLE = "おやこポイントの やくそく";
const CHILD_INTRO =
  "これは 「おやこポイント」を つかう ときの やくそくだよ。\nおうちの ひとと いっしょに よんでね。";

/** 子ども向け禁止事項の1グループ（見出し＋項目）。 */
type ChildProhibitedGroup = { heading: string; items: string[] };

// 大人版PROHIBITED_ITEMSの7項目のうち5項目のみを子ども向けに翻訳し、2グループに
// 分けたもの（原稿2章「大人版との対応表」、3章「落とした項目とその理由」）。
// 5-5（宣伝・勧誘の禁止）・5-6（法律違反・著作権侵害の禁止）は原稿の判断により
// 子ども版に含めていない。**この2項目を勝手に戻さないこと。**大人版
// PROHIBITED_ITEMS（7項目）は変更しない。
const CHILD_PROHIBITED_GROUPS: ChildProhibitedGroup[] = [
  {
    heading: "みんなが たのしく つかうために",
    items: [
      "**いやな きもちに なることは かかないでね**（わるぐちや、からかいや、なかまはずれに することなど）。たのしい きもちに なることを かこうね。",
      "**うそは かかないでね**。ほかの ひとの ふりを することも しないでね。",
      "**こわい えや、らんぼうな え、はずかしい えは かかないでね**。かぞくが みても うれしい えを かこうね。",
      "**じぶんや ほかの ひとの じゅうしょ・でんわばんごう・ほいくえんや がっこうの なまえは かかないでね**。",
    ],
  },
  {
    heading: "コードは たいせつに",
    items: ["**おうちの ひとから もらった「コード」は、ほかの ひとには おしえないでね**。だいじな コードだよ。"],
  },
];

const CHILD_HELP_HEADING = "わからないときは";
// Play Families 安全リマインダー（サマリー表#7）の子ども向け翻訳2文＋結び文1文
// （原稿5-2章・5-3章）。3文をまとめて1つのテキストブロックとして描画する
// （原稿「実装への差し替え指示」表示順8・9。新しい表示要素は増やさない）。
const CHILD_SAFETY_REMINDER =
  "**インターネットで だれかと やりとりする ときは、きを つけてね**。かきこみや、え は、とおくに いる かぞくにも とどくよ。おもいがけない ことが おきる ことも あるよ。\n\nわからないことが あったら、おうちの ひとに きいてね。";
// ボタン直前の確認文（原稿1章フレーム末尾、表示順10）。見出しを付けず、他の
// 地の文と同じ扱いで表示する（原稿「実装する人へ」の注記）。
const CHILD_CONFIRM_PROMPT = "これを よんで、まもると おもったら、したの ボタンを おしてね。";
const CHILD_BUTTON_LABEL = "わかった！";

/**
 * 子ども向け本文中の`**太字**`をそのまま画面の太字表示に変換する（アスタリスク
 * 記号自体は表示しない）。原稿1章「実装する人へ」の指示に対応。子ども向け
 * ボディ（theme.typography.childBody）は基準のfontWeightが既に"700"のため、
 * 非太字部分を"400"に落とすことで太字部分との強弱をつける（新しいトークン・
 * 新しい色・新しい大きさは作らず、既存のtypographyが使っている"400"/"700"の
 * 2値のみを使う）。
 */
function ChildRichText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const segments = text.split("**");
  return (
    <Text style={style}>
      {segments.map((segment, index) =>
        index % 2 === 1 ? (
          <Text key={index} style={{ fontWeight: "700" }}>
            {segment}
          </Text>
        ) : (
          <Text key={index} style={{ fontWeight: "400" }}>
            {segment}
          </Text>
        )
      )}
    </Text>
  );
}

// [2026-09-11・本部長判断] 見出し3つ（小見出し）の見た目は、原稿1章の指定
// 「タイトルより小さい・目立たない見た目でよい」を満たせば足りるとして、
// UIUXデザイン部へは回さず既存パターンを踏襲する。app/child/(tabs)/home.tsx の
// styles.sectionHeading（「★ おきにいりのクエスト」等の区分見出し）と同じ考え方
// ＝ 子ども向けボディ（childBody）に marginTop/marginBottom と
// neutralTextSecondary色を重ねるだけで、新しいトークンは作らない。
const childSectionHeadingStyle: StyleProp<TextStyle> = {
  marginTop: theme.spacing.s4,
  marginBottom: theme.spacing.s2,
  color: theme.colors.neutralTextSecondary,
};

export type TermsConsentRole = "parent" | "supporter" | "child";

/**
 * 同意状況の取得を1本化するフック。`active`がfalseの間は何もしない
 * （ロールが確定していない・リダイレクト待ちの間に無駄な通信をしないため）。
 * 通信エラー時は「同意不要」扱いにする＝フェイルオープン
 * （src/data/store.tsxのbackground再取得と同じ考え方。一時的な通信断で
 * 毎回起動できなくなる方が実害が大きいと判断した。実装メモ.md 181章）。
 */
export function useTermsConsentGate(active: boolean, client: SupabaseClient) {
  const [loading, setLoading] = useState(true);
  const [needsConsent, setNeedsConsent] = useState(false);

  useEffect(() => {
    if (!active) {
      setLoading(true);
      return;
    }
    let mounted = true;
    setLoading(true);
    (async () => {
      const res = await hasAgreedToCurrentTerms(client);
      if (!mounted) return;
      setNeedsConsent(res.ok ? !res.data : false);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [active, client]);

  const markAgreed = () => setNeedsConsent(false);

  return { loading, needsConsent, markAgreed };
}

interface TermsConsentModalProps {
  role: TermsConsentRole;
  onAgreed: () => void;
}

/**
 * モーダル本体。呼び出し元（各_layout.tsx）はSessionProvider配下にあるため、
 * ここで直接useSession()からclientを取得する（child専用クライアント／
 * 保護者・みまもり共通クライアントのいずれも正しく選ばれる）。
 */
export function TermsConsentModal({ role, onAgreed }: TermsConsentModalProps) {
  const { client } = useSession();
  const isChild = role === "child";
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [linkErrorMessage, setLinkErrorMessage] = useState<string | null>(null);

  // Screen/Card/AppButtonのtone型は"parent"|"child"|"supporter"でroleとそのまま一致する。
  const titleStyle =
    role === "child" ? theme.typography.childHeadline : role === "supporter" ? theme.typography.supporterTitle : theme.typography.parentTitle;
  const bodyStyle =
    role === "child" ? theme.typography.childBody : role === "supporter" ? theme.typography.supporterBody : theme.typography.parentBody;

  const submit = async () => {
    setSubmitting(true);
    setErrorMessage(null);
    const res = await recordTermsConsent(client, TERMS_CONSENT_VERSION);
    setSubmitting(false);
    if (!res.ok) {
      setErrorMessage(RETRY_ERROR);
      return;
    }
    onAgreed();
  };

  const openLink = async (url: string) => {
    setLinkErrorMessage(null);
    const ok = await openExternalUrl(url);
    if (!ok) setLinkErrorMessage(LINK_ERROR);
  };

  return (
    <Screen tone={role}>
      <Card tone={role} style={{ marginTop: theme.spacing.s6 }}>
        <Text style={titleStyle}>{isChild ? CHILD_TITLE : "利用規約への同意"}</Text>
        <Text style={[bodyStyle, { marginTop: theme.spacing.s3 }]}>{isChild ? CHILD_INTRO : ADULT_INTRO}</Text>

        {isChild ? (
          <View style={{ marginTop: theme.spacing.s2 }}>
            {CHILD_PROHIBITED_GROUPS.map((group, groupIndex) => (
              <View key={groupIndex}>
                <Text style={[bodyStyle, childSectionHeadingStyle]}>{group.heading}</Text>
                <View style={{ gap: theme.spacing.s2 }}>
                  {group.items.map((item, itemIndex) => (
                    <View key={itemIndex} style={{ flexDirection: "row" }}>
                      <Text style={bodyStyle}>{"・"}</Text>
                      <ChildRichText text={item} style={[bodyStyle, { flex: 1, marginLeft: theme.spacing.s1 }]} />
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </View>
        ) : (
          <View style={{ marginTop: theme.spacing.s4, gap: theme.spacing.s2 }}>
            {PROHIBITED_ITEMS.map((item, index) => (
              <View key={index} style={{ flexDirection: "row" }}>
                <Text style={bodyStyle}>{"・"}</Text>
                <Text style={[bodyStyle, { flex: 1, marginLeft: theme.spacing.s1 }]}>{item}</Text>
              </View>
            ))}
          </View>
        )}

        {isChild ? (
          <>
            <Text style={[bodyStyle, childSectionHeadingStyle]}>{CHILD_HELP_HEADING}</Text>
            <ChildRichText text={CHILD_SAFETY_REMINDER} style={bodyStyle} />
            <Text style={[bodyStyle, { marginTop: theme.spacing.s4 }]}>{CHILD_CONFIRM_PROMPT}</Text>
          </>
        ) : (
          <Text style={[bodyStyle, { marginTop: theme.spacing.s4 }]}>{ADULT_SAFETY_REMINDER}</Text>
        )}

        {/* [やること.md 2-28] 子ども向け画面には外部URLを開く導線を置かない。 */}
        {/* [2026-09-09追加・統括判断] 規約類が未公開の間はリンクを出さない
            （LEGAL_PAGES_PUBLISHED）。押しても404になるため。禁止事項の要点は
            このモーダルの中に書いてあるので、リンクが無くても内容は伝わる。 */}
        {!isChild && (
          <>
            {/* 規約類が未公開の間はこの2本のリンクだけを出さない。**チェックボックスと
                同意ボタンは常に出す**（ここを一緒に隠すと大人が同意できなくなる）。 */}
            {LEGAL_PAGES_PUBLISHED && (
              <>
                <Pressable onPress={() => openLink(TERMS_URL)} style={{ marginTop: theme.spacing.s4 }}>
                  <Text style={[bodyStyle, { textDecorationLine: "underline" }]}>利用規約を全文で見る</Text>
                </Pressable>
                <Pressable onPress={() => openLink(PRIVACY_POLICY_URL)} style={{ marginTop: theme.spacing.s2 }}>
                  <Text style={[bodyStyle, { textDecorationLine: "underline" }]}>プライバシーポリシーを見る</Text>
                </Pressable>
                {linkErrorMessage && (
                  <Text style={{ marginTop: theme.spacing.s2, color: theme.colors.statusBlocking }}>{linkErrorMessage}</Text>
                )}
              </>
            )}

            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              onPress={() => setChecked((c) => !c)}
              style={{ flexDirection: "row", alignItems: "center", marginTop: theme.spacing.s6 }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 4,
                  borderWidth: 2,
                  borderColor: checked ? theme.colors.brandPrimary : theme.colors.neutralBorder,
                  backgroundColor: checked ? theme.colors.brandPrimary : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: theme.spacing.s2,
                }}
              >
                {checked ? <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>{"✓"}</Text> : null}
              </View>
              <Text style={[bodyStyle, { flex: 1 }]}>{CHECKBOX_LABEL}</Text>
            </Pressable>
          </>
        )}

        {errorMessage && (
          <Text style={{ marginTop: theme.spacing.s3, color: theme.colors.statusBlocking }}>{errorMessage}</Text>
        )}

        <AppButton
          tone={role}
          label={submitting ? "処理中…" : isChild ? CHILD_BUTTON_LABEL : AGREE_BUTTON_LABEL}
          onPress={submit}
          disabled={submitting || (!isChild && !checked)}
          style={{ marginTop: theme.spacing.s6 }}
        />
      </Card>
    </Screen>
  );
}
