# Androidの通知用アイコン（白い木のシルエット）を assets/icon.png から作る。
# 実装メモ306章。葉を1枚ずつの形として取り出し、奥（形が欠けている葉）から手前へ
# 重ねて描く。手前の葉を置くたびに、下にある葉をその葉のまわり一定幅だけ削り、
# 手前の葉の輪郭に沿ったすき間を作る（参考画像の描き方）。
# 実行: python tools/generate_notification_icon.py（出力 assets/notification-icon.png）
from PIL import Image, ImageDraw
import numpy as np
from scipy import ndimage as ndi
from scipy.spatial import ConvexHull
src = Image.open(r"C:\App_cursor\oyakopoint-app\assets\icon.png").convert("RGB")
a = np.asarray(src).astype(int)
R,G,B = a[...,0],a[...,1],a[...,2]
bg = a[5,5]
notbg = np.abs(a-bg).sum(axis=2) > 40
stroke = notbg & (R < 140) & (G > R + 40)
lab, n = ndi.label(~stroke)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:,0], lab[:,-1]])))
leafIds = [i for i in range(1, n+1) if i not in border and (lab == i).sum() > 800 and np.abs(a[lab == i].mean(axis=0) - bg).sum() > 40]
OUT = 12   # 縁の線の太さ（葉の外形は内側から12px外まで）
GAP = 14   # 手前の葉のまわりに空けるすき間（1024px基準）
def smooth(m, s=2.5):
    return ndi.gaussian_filter(m.astype(float), s) > 0.5
leaves = []
for i in leafIds:
    inner = lab == i
    shape = smooth(ndi.distance_transform_edt(~inner) <= OUT)
    ys, xs = np.where(inner)
    pts = np.stack([xs, ys], axis=1)
    hull = ConvexHull(pts)
    solidity = inner.sum() / hull.volume          # 欠けていない葉ほど1に近い＝手前
    leaves.append((solidity, shape))
leaves.sort(key=lambda t: t[0])                   # 奥（欠けている葉）から手前へ
anyLeaf = np.zeros(lab.shape, bool)
for _, s in leaves: anyLeaf |= s
# 幹・枝・地面（葉の外にある緑の線）を一番下に置く
layer = stroke & ~anyLeaf
layer = smooth(layer, 1.5)
for _, s in leaves:
    halo = ndi.distance_transform_edt(~s) <= GAP
    # 既に描いた「葉」だけを削る（枝は葉の付け根につながったまま）
    layer_leaves = layer & anyLeaf
    layer_other = layer & ~anyLeaf
    layer_leaves = layer_leaves & ~halo
    layer = layer_leaves | layer_other | s
# [2026-09-26追加・統括「葉っぱの中央のラインをいれてほしい」] 元の絵の葉の中の白い筋
# （背景より明るい点）の位置に、同じ太さの透明な線を抜く。葉の外には出さない。
vein = a.sum(axis=2) > 700
vein = ndi.binary_dilation(vein, iterations=2)
vein = ndi.gaussian_filter(vein.astype(float), 1.5) > 0.5
# [2026-09-26修正・統括「右側のはっぱのかさなりだけ、中央ラインが上側の葉っぱにつながっている」]
# 筋は、見えている形の縁（手前の葉のまわりのすき間を含む）から一定距離より内側だけに入れる。
# 奥の葉の筋が、手前の葉のまわりのすき間とつながらないようにするため。
innerOnly = ndi.distance_transform_edt(layer) > 14
shape = layer & ~(vein & anyLeaf & innerOnly)
ys, xs = np.where(shape)
y0,y1,x0,x1 = ys.min(), ys.max(), xs.min(), xs.max()
f = shape[y0:y1+1, x0:x1+1]
h, w = f.shape
side = int(round(max(h, w) * 24 / 21))
canvas = np.zeros((side, side), dtype=np.uint8)
canvas[(side-h)//2:(side-h)//2+h, (side-w)//2:(side-w)//2+w] = (f*255).astype(np.uint8)
big = Image.fromarray(canvas)
alpha = big.resize((96,96), Image.LANCZOS)
white = Image.new("RGBA", (96,96), (255,255,255,255)); white.putalpha(alpha)
white.save(r"C:\App_cursor\oyakopoint-app\assets\notification-icon.png")
prev = Image.new("RGBA", (288,288), (120,120,120,255))
w288 = Image.new("RGBA", (288,288), (255,255,255,255)); w288.putalpha(big.resize((288,288), Image.LANCZOS))
prev.alpha_composite(w288)
small = Image.new("RGBA", (48,48), (40,40,40,255)); small.alpha_composite(white.resize((48,48), Image.LANCZOS))
prev.paste(small, (8,232))
prev.save(r"notification-icon-preview.png")
print("ok", [round(t[0],3) for t in leaves])



