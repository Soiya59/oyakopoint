# フィギュア画像アセットの置き場所（未着・プレースホルダ運用中）

要件定義書07-28章・スキーマ設計.sql 55.2章で確定した8点の画像を、統括が制作中。
完成後、以下のファイル名でこのフォルダに置く（`assets/stickers/`のメダル画像と
同じ命名慣行。解像度違い`@sm`は現時点では用意しない。単一解像度でよい）。

- `figure_dragon_bronze.png`
- `figure_dragon_silver.png`
- `figure_dragon_gold.png`
- `figure_dragon_crystal.png`
- `figure_rabbit_bronze.png`
- `figure_rabbit_silver.png`
- `figure_rabbit_gold.png`
- `figure_rabbit_crystal.png`

## 差し替え手順（開発部/成果物/実装メモ.md 237章にも記載）

1. 上記8ファイルをこのフォルダに置く。
2. `src/components/FigureIcon.tsx` のコメントアウトされている
   `import ... from "../../assets/figures/figure_xxx.png"` の8行と
   `FIGURE_IMAGES` オブジェクトの中身のコメントアウトを外す。
3. `npx tsc --noEmit` でエラーが無いことを確認する。
4. 実機・Web（`npx expo start`）で、コレクター棚・台紙作成の種類選択・木の上の
   いずれでも画像が表示されることを確認する。

画像が無い間は `FigureIcon` が `kind_emoji`（🐉／🐰）または既定のプレースホルダー
絵文字で自動的に代替する。呼び出し側のコードは変更不要。
