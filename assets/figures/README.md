# フィギュア画像アセット（2026-09-18 配置済み）

要件定義書07-28章・スキーマ設計.sql 55.2章で確定した8点。**統括が制作し、本部長がアプリ用に変換して配置した（2026-09-18）。**`src/components/FigureIcon.tsx` の `FIGURE_IMAGES` に8枚とも結線済み。

| ファイル | 種類 | 段階 |
|---|---|---|
| `figure_dragon_bronze.png` | ドラゴン | 銅 |
| `figure_dragon_silver.png` | ドラゴン | 銀 |
| `figure_dragon_gold.png` | ドラゴン | 金 |
| `figure_dragon_crystal.png` | ドラゴン | クリスタル |
| `figure_rabbit_bronze.png` | うさぎ | 銅 |
| `figure_rabbit_silver.png` | うさぎ | 銀 |
| `figure_rabbit_gold.png` | うさぎ | 金 |
| `figure_rabbit_crystal.png` | うさぎ | クリスタル |

## 統括の原本と、本部長が行った変換（2026-09-18）

- **原本**: 統括の一時フォルダ `figure_collection/{dragon,rabbit}/0N_*.jpg`（1024×1024・JPG・白背景）。**一時フォルダなので消えうる。**原本の保全（`UIUXデザイン部/参考資料/` へのコピー）は別途行うこと
- **変換の中身**（PIL）:
  1. **白背景を透過に。**四隅から塗りつぶし（flood fill、しきい値18）で背景だけを落とす。**全体のしきい値で「白い画素」を消す方式は採らない**——クリスタルは本体が非常に明るく、その方式だと本体まで消えるため
  2. マスクを 0.8px ぼかして輪郭を滑らかに
  3. 余白を切り詰め、正方形の中央に配置（周囲8%の余白）
  4. **512×512** にリサイズ（メダル `assets/stickers/` と同じ寸法）
- **JPGのままでは使えない理由**: JPGに透明が無く、木やコレクションに置くと**白い四角**になる

## 種類を追加するとき

1. 同じ変換で `figure_<種類>_<段階>.png` を4枚作ってこのフォルダに置く
2. `src/components/FigureIcon.tsx` に import と `FIGURE_IMAGES` の行を4つ足す
3. DB側は `habit_figure_catalog` に4行 INSERT するだけ（`kind_key` に CHECK 制約を置いていないため。設計部 55.2章の決定）

## 2026-09-21追加分（要件定義書07-34章「メダルとフィギュアの入れ替え」）

上記8枚とは別の用途で、`figure_beetle_{bronze,silver,gold,crystal}.png`（512px・RGBA）を追加した。統括が制作し、本部長が同じ変換で配置した。

**この4枚は`habit_figure_catalog`のカタログ行ではない。**07-34章の呼び名の入れ替え（シール帳の到達報酬が「メダル」に、ポイントで買う`sticker_catalog`が「フィギュア」になる）に伴い、`sticker_catalog`のbeetle形をフィギュア調の絵で表示するために追加した（`src/theme/theme.ts`の`figureKeyOfSticker()`が生成する`figure_beetle_*`キーで、`FigureIcon.tsx`の`FIGURE_IMAGES`に結線済み）。同じ理由で、ちょうちょ（`figure_butterfly_*`）・おはな（`figure_flower_*`）の4枚ずつ計8枚がまだ無い（2026-09-21時点。本部長判断により、絵が無い間はショップの購入一覧に出さない。開発部/成果物/実装メモ.md参照）。統括が制作でき次第、同じファイル名規則でこのフォルダに置き、`FigureIcon.tsx`の`FIGURE_IMAGES`に4行ずつ追加すれば、ショップに自動的に出るようになる（コード側の追加変更は不要）。

なお、`assets/stickers/`側にも`rabbit_{bronze,silver,gold,crystal}.png`（+`@sm.png`）を同日追加した。こちらは逆に`habit_figure_catalog`のrabbit形をメダル調の絵で表示するためのもの（`src/components/StickerIcon.tsx`の`HabitFigureCircleIcon`が使う）。
