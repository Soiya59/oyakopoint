// [2026-09-09新設・本部長] ESLintをこのプロジェクトに初めて導入した。
//
// きっかけ: 2026-09-09、本部長が`useState`を早期リターンより後ろに置いたまま
// デプロイし、**メダル購入画面が本番で表示できなくなった**（実装メモ177章）。
// `npx tsc --noEmit`はこの誤りを検出しない（型の問題ではないため）。
//
// 導入前の状態: ESLintの設定も依存もスクリプトも無かったにもかかわらず、コード中には
// `// eslint-disable-next-line react-hooks/exhaustive-deps`が33か所あった。
// **あるつもりで書かれていて、実際には一度も動いていなかった。**
//
// 方針: 広く網をかけると既存コードの警告に埋もれて肝心のものが見えなくなるため、
// **フックの規則2つに絞る**。今回の障害を確実に止めることを最優先し、
// 整形・命名・未使用変数などのスタイル系は一切入れない。
import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    ignores: ["dist/**", "node_modules/**", ".expo/**", "android/**", "ios/**"],
  },
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      // TypeScript・JSXを読ませるためのパーサ。ESLint標準のパーサはTSの型注釈を
      // 構文エラーにするため必須（導入時、これが無くて152件の解析エラーが出た）。
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        sourceType: "module",
      },
    },
    rules: {
      // 今回の本番障害を止める規則。フックを条件分岐・早期リターンの後ろで
      // 呼んではいけない。**これはerrorのまま緩めないこと。**
      "react-hooks/rules-of-hooks": "error",
      // 依存配列の漏れ。既存コードに33か所のdisableコメントがあるとおり、
      // 意図的に外している箇所があるためwarnにとどめる。
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
