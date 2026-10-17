# 把 assets/wh40k/raw/*.png（agy/Nano Banana 原圖，1024² 洋紅底）處理成遊戲用的小圖，
# 輸出成 src/render/wh40k-data.js（data URI，WebP）——打包版是單檔，不能依賴外部圖檔路徑。
#   python3 tools/wh40k-process.py
import base64, io, json, pathlib
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / 'assets/wh40k/raw'
OUT = ROOT / 'src/render/wh40k-data.js'

# 名稱前綴 → 輸出邊長（px）。tile_* 是滿版紋理（不去背、不裁切）。
SIZES = [('tank_', 128), ('boss_', 160), ('turret', 96), ('eagle_', 104), ('tile_', 104),
         ('pu_', 64), ('train', 320), ('warp', 96), ('shield', 96), ('orbital', 96), ('airdrop', 64)]
DEFAULT = 48  # bullet / shell / spark / smoke / mine


def size_for(name):
    return next((s for p, s in SIZES if name.startswith(p)), DEFAULT)


def key_magenta(im):
    a = np.asarray(im.convert('RGB')).astype(np.float32)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    k = (np.minimum(r, b) - g) / 255.0                       # 洋紅程度
    alpha = 1.0 - np.clip((k - 0.22) / 0.30, 0, 1)
    spill = k > 0.12                                         # 邊緣去洋紅溢色
    a[..., 0] = np.where(spill, np.minimum(r, g + 30), r)
    a[..., 2] = np.where(spill, np.minimum(b, g + 30), b)
    rgba = np.dstack([a, alpha * 255]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def process(path):
    name, im = path.stem, Image.open(path)
    n = size_for(name)
    if name.startswith('tile_'):
        w, h = im.size; s = min(w, h)
        return name, im.convert('RGB').crop(((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)).resize((n, n), Image.LANCZOS)
    im = key_magenta(im)
    bbox = Image.fromarray((np.asarray(im)[..., 3] > 16).astype(np.uint8) * 255).getbbox() or (0, 0, *im.size)
    im = im.crop(bbox)
    if name == 'train':  # 水平長條，保留長寬比
        return name, im.resize((n, max(1, round(n * im.height / im.width))), Image.LANCZOS)
    s = max(im.size)                                          # 置中補成正方形（方向性精靈不能變形）
    sq = Image.new('RGBA', (s, s)); sq.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return name, sq.resize((n, n), Image.LANCZOS)


def main():
    art = {}
    for p in sorted(RAW.glob('*.png')):
        name, im = process(p)
        buf = io.BytesIO(); im.save(buf, 'WEBP', quality=88, method=6)
        art[name] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
        (RAW.parent / f'{name}.webp').write_bytes(buf.getvalue())   # 預覽用
    body = ',\n'.join(f'  {k}: {json.dumps(v)}' for k, v in art.items())
    OUT.write_text('// 自動產生（tools/wh40k-process.py）：WH40K 風格素材，agy + Nano Banana 繪製。勿手改。\n'
                   f'export const WH40K_ART_DATA = {{\n{body}\n}};\n')
    print(f'{len(art)} sprites → {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)')
    assert all(v.startswith('data:image/webp;base64,') for v in art.values())


if __name__ == '__main__':
    main()
