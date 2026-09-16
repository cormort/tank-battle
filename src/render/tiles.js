// 渲染層：地形與基地圖磚（M4）。
//
// 從 index.html 原封搬過來，依賴改成注入（TILE／renderScale／doc），因此可以在 Node 用假的
// canvas context 驗證「畫了幾個像素、幾次 API 呼叫」—— 老鷹的離屏快取就是這樣被量出來的
// （舊版每幀 127 次 fillStyle + 127 次 fillRect，改快取後每幀 1 次 drawImage）。

export const EAGLE_ALIVE_SPRITE = [
  [0,0,0,0,2,2,2,2,2,0,0,0,0],
  [0,0,0,2,2,1,1,1,2,2,0,0,0],
  [0,0,2,2,1,1,3,1,1,2,2,0,0],
  [2,2,2,1,1,3,3,3,1,1,2,2,2],
  [2,1,2,1,3,3,3,3,3,1,2,1,2],
  [2,1,1,1,1,3,3,3,1,1,1,1,2],
  [2,1,1,3,1,1,3,1,1,3,1,1,2],
  [0,2,1,3,3,1,1,1,3,3,1,2,0],
  [0,0,2,1,3,3,3,3,3,1,2,0,0],
  [0,0,0,2,1,3,3,3,1,2,0,0,0],
  [0,0,0,2,1,1,3,1,1,2,0,0,0],
  [0,0,2,2,1,1,1,1,1,2,2,0,0],
  [0,2,2,2,2,2,2,2,2,2,2,2,0]
];

export const EAGLE_DEAD_SPRITE = [
  [0,0,3,3,3,0,3,0,3,3,3,0,0],
  [0,3,3,0,3,3,3,3,3,0,3,3,0],
  [3,3,0,0,0,3,3,3,0,0,0,3,3],
  [3,0,0,3,0,0,3,0,0,3,0,0,3],
  [3,0,3,3,3,0,0,0,3,3,3,0,3],
  [0,3,3,0,0,3,3,3,0,0,3,3,0],
  [3,0,0,3,3,3,3,3,3,3,0,0,3],
  [3,3,0,0,3,3,3,3,3,0,0,3,3],
  [0,3,3,3,0,0,3,0,0,3,3,3,0],
  [3,0,0,3,3,3,3,3,3,3,0,0,3],
  [3,3,0,0,0,3,3,3,0,0,0,3,3],
  [0,3,3,3,0,0,3,0,0,3,3,3,0],
  [3,0,0,3,3,3,3,3,3,3,0,0,3]
];

/**
 * @param {{TILE:number, renderScale?:number, doc?:object}} deps
 */
export function makeTileRenderer({ TILE, renderScale = 1, doc = globalThis.document } = {}) {
  const _eagleCache = { alive: null, dead: null, scale: 0 };

  function drawBrickNES(cx2d, x, y, size) {
    const half = size / 2;
    cx2d.fillStyle = '#7a7a7a';
    cx2d.fillRect(x, y, size, size);
    cx2d.fillStyle = '#b8401c';
    cx2d.fillRect(x + 1, y + 1, half - 2, half - 2);
    cx2d.fillRect(x + half + 1, y + 1, half - 2, half - 2);
    cx2d.fillRect(x + 1, y + half + 1, (half / 2) - 1, half - 2);
    cx2d.fillRect(x + (half / 2) + 1, y + half + 1, half - 2, half - 2);
    cx2d.fillRect(x + size - (half / 2), y + half + 1, (half / 2) - 1, half - 2);
    cx2d.fillStyle = '#d96846';
    cx2d.fillRect(x + 1, y + 1, half - 2, 1);
    cx2d.fillRect(x + half + 1, y + 1, half - 2, 1);
    cx2d.fillRect(x + 1, y + half + 1, (half / 2) - 1, 1);
    cx2d.fillRect(x + (half / 2) + 1, y + half + 1, half - 2, 1);
    cx2d.fillRect(x + size - (half / 2), y + half + 1, (half / 2) - 1, 1);
  }

  function drawSteelNES(cx2d, x, y, size) {
    const half = size / 2;
    for (let qy = 0; qy < 2; qy++) {
      for (let qx = 0; qx < 2; qx++) {
        const px = x + qx * half;
        const py = y + qy * half;
        cx2d.fillStyle = '#9a9aa8';
        cx2d.fillRect(px, py, half, half);
        cx2d.fillStyle = '#dcdce8';
        cx2d.fillRect(px, py, half - 1, 1);
        cx2d.fillRect(px, py, 1, half - 1);
        cx2d.fillStyle = '#5a5a66';
        cx2d.fillRect(px + 1, py + half - 1, half - 1, 1);
        cx2d.fillRect(px + half - 1, py + 1, 1, half - 1);
      }
    }
  }

  function drawForestNES(cx2d, x, y, size) {
    cx2d.fillStyle = '#0a4a0a';
    cx2d.fillRect(x, y, size, size);
    cx2d.fillStyle = '#1f7a1f';
    const blobs = [
      [size*0.25, size*0.30, 5],
      [size*0.70, size*0.30, 5],
      [size*0.40, size*0.65, 5],
      [size*0.80, size*0.75, 4],
      [size*0.15, size*0.75, 4],
    ];
    for (const [bx, by, br] of blobs) {
      cx2d.beginPath(); cx2d.arc(x+bx, y+by, br, 0, Math.PI*2); cx2d.fill();
    }
    cx2d.fillStyle = '#2eaf2e';
    for (const [bx, by, br] of blobs) {
      cx2d.fillRect(x+bx-1, y+by-br+1, 2, 2);
    }
  }

  function drawWaterDirect(cx2d, x, y, phase) {
    cx2d.fillStyle = '#1c4ca8';
    cx2d.fillRect(x, y, TILE, TILE);
    cx2d.fillStyle = '#74c0fc';
    const half = TILE / 2;
    if (phase === 0) {
      cx2d.fillRect(x+2, y+4, 6, 2); cx2d.fillRect(x+half+2, y+4, 6, 2);
      cx2d.fillRect(x+4, y+half+4, 6, 2); cx2d.fillRect(x+half+4, y+half+4, 4, 2);
      cx2d.fillRect(x, y+half+4, 2, 2);
    } else {
      cx2d.fillRect(x+4, y+4, 6, 2); cx2d.fillRect(x+half+4, y+4, 4, 2);
      cx2d.fillRect(x, y+4, 2, 2); cx2d.fillRect(x+2, y+half+4, 6, 2);
      cx2d.fillRect(x+half+2, y+half+4, 6, 2);
    }
  }

  function buildEagleSprite(dead) {
    const scale = typeof renderScale === 'number' ? renderScale : 1;
    const cv = doc.createElement('canvas');
    cv.width = TILE * scale; cv.height = TILE * scale;
    const c = cv.getContext('2d');
    c.setTransform(scale, 0, 0, scale, 0, 0);
    c.imageSmoothingEnabled = false;
    const sprite = dead ? EAGLE_DEAD_SPRITE : EAGLE_ALIVE_SPRITE;
    c.fillStyle = '#000';
    c.fillRect(0, 0, TILE, TILE);
    const px = TILE / 13;
    const palette = dead ? { 1: '#404040', 2: '#202020', 3: '#a02020' } : { 1: '#d0d0d0', 2: '#ffffff', 3: '#404040' };
    for (let py = 0; py < 13; py++) {
      for (let pxi = 0; pxi < 13; pxi++) {
        const v = sprite[py][pxi];
        if (v !== 0) {
          c.fillStyle = palette[v];
          c.fillRect(pxi * px, py * px, px + 1, px + 1);
        }
      }
    }
    return cv;
  }

  function eagleSprite(dead) {
    const scale = typeof renderScale === 'number' ? renderScale : 1;
    if (_eagleCache.scale !== scale || !_eagleCache.alive) {
      _eagleCache.alive = buildEagleSprite(false);
      _eagleCache.dead = buildEagleSprite(true);
      _eagleCache.scale = scale;
    }
    return dead ? _eagleCache.dead : _eagleCache.alive;
  }

  function drawEagleDirect(cx2d, x, y, dead) {
    cx2d.drawImage(eagleSprite(dead), x, y, TILE, TILE);
  }

  // eagleCache 也曝露出來：驗證工具用它確認「快取真的建起來了」（不是每幀重畫）
  return { drawBrickNES, drawSteelNES, drawForestNES, drawWaterDirect, buildEagleSprite, eagleSprite, drawEagleDirect, eagleCache: _eagleCache };
}
