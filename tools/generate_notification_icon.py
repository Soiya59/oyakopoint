from PIL import Image
import numpy as np
from scipy import ndimage as ndi
src = Image.open(r"C:\App_cursor\oyakopoint-app\assets\icon.png").convert("RGB")
a = np.asarray(src).astype(int)
R,G,B = a[...,0],a[...,1],a[...,2]
bg = a[5,5]
notbg = np.abs(a-bg).sum(axis=2) > 40
stroke = notbg & (R < 140) & (G > R + 40)
lab, n = ndi.label(~stroke)
border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:,0], lab[:,-1]])))
leafIds = [i for i in range(1, n+1) if i not in border and (lab == i).sum() > 800 and np.abs(a[lab == i].mean(axis=0) - bg).sum() > 40]
OUT = 12     # 縁の線の太さぶん外へ広げる（葉の外形）
GAP = 9      # 葉と葉のすき間の幅（1024px基準）
dists = np.stack([ndi.distance_transform_edt(lab != i) for i in leafIds])  # 各葉の内側からの距離
order = np.sort(dists, axis=0)
d1, d2 = order[0], order[1]
nearest = np.argmin(dists, axis=0)
leaves = d1 <= OUT
gap = leaves & (d2 <= OUT + GAP) & ((d2 - d1) < GAP)     # 2枚の葉の境目（等距離の線）に沿った帯
leafShape = leaves & ~gap
# 幹・枝・地面：葉から離れた緑の線だけ残す
nearLeaf = d1 <= OUT + GAP
branches = stroke & ~nearLeaf
# 枝の先が葉に届くよう、葉の外形の内側までは伸ばしてよい（すき間は保つ）
branches = branches | (stroke & leaves & ~gap & (d1 > 0) & False)
shape = leafShape | branches
# 輪郭をなめらかに
soft = ndi.gaussian_filter(shape.astype(float), 2.0) > 0.5
ys, xs = np.where(soft)
y0,y1,x0,x1 = ys.min(), ys.max(), xs.min(), xs.max()
f = soft[y0:y1+1, x0:x1+1]
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
prev.save(r"C:\Users\seiya\AppData\Local\Temp\claude\C--App-cursor-oyakopoint\8055e926-dbe0-4d64-8ad6-3a4dc456ac37\scratchpad\notification-icon-preview.png")
print("ok", len(leafIds))

