# 把 assets/wh40k/raw/*.png（agy/Nano Banana 原圖，1024² 洋紅底）處理成遊戲用的小圖，
# 輸出成 src/render/wh40k-data.js（data URI，WebP）——打包版是單檔，不能依賴外部圖檔路徑。
#   python3 tools/wh40k-process.py
import base64, io, json, os, pathlib
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / 'assets/wh40k/raw'
OUT = ROOT / 'src/render/wh40k-data.js'
# gaga-survivor（同作者的另一個專案）的角色與地面貼圖：直接從它的 checkout 讀，不複製進來
GAGA = pathlib.Path(os.environ.get('GAGA', ROOT.parent / 'gaga-survivor'))
GAGA_SPRITES = {  # 輸出名 → gaga 路徑（已是透明底，不去背）
    'gaga_sniper': 'assets/xian/sniper.png', 'gaga_engineer': 'assets/xian/techpriest_goose.png',
    'gaga_interferer': 'assets/xian/boomer.png', 'gaga_guard': 'assets/xian/warden.png',
    'gaga_minelayer': 'assets/xian/spore_host.png', 'gaga_bomb': 'assets/xian/squig_bomb.png',
    'gaga_poxwalker': 'assets/xian/poxwalker.png', 'gaga_ork_boy': 'assets/xian/ork_boy.png',
    'gaga_genestealer': 'assets/xian/genestealer.png', 'gaga_hormagaunt': 'assets/xian/hormagaunt.png',
    'gaga_termagant': 'assets/xian/termagant.png',
}
GROUND_SIZE = 384

# 名稱前綴 → 輸出邊長（px）。tile_* 是滿版紋理（不去背、不裁切）。
SIZES = [('tank_', 128), ('chaos_', 128), ('ork_', 128), ('aeldari_', 128), ('tyranid_', 128), ('necron_', 128), ('boss_', 160), ('turret', 96), ('eagle_', 104), ('tile_', 104),
         ('gaga_', 128), ('pu_', 64), ('train', 320), ('warp', 96), ('shield', 96), ('orbital', 96), ('airdrop', 64)]
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


def process(path, n=None):
    name, im = path.stem, Image.open(path)
    n = n or size_for(name)
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


def trim_square(im, n=None):
    im = im.convert('RGBA')
    im = im.crop(im.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox() or (0, 0, *im.size))
    s = max(im.size)
    sq = Image.new('RGBA', (s, s)); sq.paste(im, ((s - im.width) // 2, (s - im.height) // 2))
    return sq.resize((n, n), Image.LANCZOS) if n else sq


# 圖鑑用的高解析版（獨立檔案，不進 data URI → 不加大遊戲包）。gaga 的原圖本來就小，維持原尺寸不放大。
CODEX_DIR = ROOT / 'assets/codex'
CODEX_SIZE = 320
CODEX_PREFIXES = ('tank_', 'boss_', 'chaos_', 'ork_', 'aeldari_', 'tyranid_', 'necron_', 'gaga_')


def export_codex():
    CODEX_DIR.mkdir(exist_ok=True)
    items = [process(p, CODEX_SIZE) for p in sorted(RAW.glob('*.png')) if p.stem.startswith(CODEX_PREFIXES)]
    for name, rel in GAGA_SPRITES.items():
        im = trim_square(Image.open(GAGA / rel))
        items.append((name, im.resize((CODEX_SIZE,) * 2, Image.LANCZOS) if im.width > CODEX_SIZE else im))
    for name, im in items:
        im.save(CODEX_DIR / f'{name}.webp', 'WEBP', quality=90, method=6)
    print(f'{len(items)} codex images → {CODEX_DIR.relative_to(ROOT)}')


def luminance(im):
    return float((np.asarray(im.convert('L')).astype(np.float32) / 255).mean())


def sources():
    """(名稱, 處理後的圖)。地面全部壓到同一個平均亮度：亮的雪地／沙漠不會蓋過地形與坦克。"""
    out = [process(p) for p in sorted(RAW.glob('*.png'))]
    for name, rel in GAGA_SPRITES.items():
        out.append((name, trim_square(Image.open(GAGA / rel), size_for(name))))
    grounds = [(f'ground_{p.stem[7:]}', Image.open(p).convert('RGB').resize((GROUND_SIZE,) * 2, Image.LANCZOS))
               for p in sorted((GAGA / 'assets/ground').glob('ground_*.png'))]
    base = next(im for n, im in out if n == 'tile_ground')
    target = luminance(base) * 0.38          # = 原本執行期疊 62% 黑的亮度
    normed = []
    for name, im in [('tile_ground', base)] + grounds:
        k = min(1.0, target / max(luminance(im), 1e-3))
        normed.append((name, Image.fromarray((np.asarray(im).astype(np.float32) * k).clip(0, 255).astype(np.uint8))))
    return [(n, im) for n, im in out if n != 'tile_ground'] + normed


def main():
    art = {}
    for name, im in sources():
        buf = io.BytesIO(); im.save(buf, 'WEBP', quality=88, method=6)
        art[name] = 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()
        (RAW.parent / f'{name}.webp').write_bytes(buf.getvalue())   # 預覽用
    body = ',\n'.join(f'  {k}: {json.dumps(v)}' for k, v in art.items())
    OUT.write_text('// 自動產生（tools/wh40k-process.py）：WH40K 風格素材，agy + Nano Banana 繪製。勿手改。\n'
                   f'export const WH40K_ART_DATA = {{\n{body}\n}};\n')
    export_codex()
    print(f'{len(art)} sprites → {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)')
    assert all(v.startswith('data:image/webp;base64,') for v in art.values())


if __name__ == '__main__':
    main()
