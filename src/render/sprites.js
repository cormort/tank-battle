// 渲染層：精靈與光暈（M4）。
//
// `glowCanvas(color)` 是「把一個顏色做成離屏的徑向光暈，之後到處 drawImage 重複使用」的 helper。
// 它原本**不存在**——M2 實作「帶道具的敵人發光」時直接呼叫了這個名字，於是每一幀、每一隻帶道具的
// 敵人（約 30%）都丟 `glowCanvas is not defined`，錯誤被主迴圈的 try/catch 接住、遊戲繼續跑，
// 但該幀 render 的後半段（子彈、粒子、分數彈出）全部被跳過，而且畫面會一直顯示錯誤提示。
//
// 教訓寫在 tools/verify-core.mjs：新增了一條「呼叫了但沒有定義的裸函式」靜態掃描，
// 這種錯誤現在會在 CI 就被擋下來，而不是等到玩家看到錯誤橫幅。

/** '#rrggbb' → 'rgba(r,g,b,a)'（光暈需要透明度漸層）。 */
export function hexToRgba(hex, alpha) {
  const value = String(hex || '').replace('#', '');
  const full = value.length === 3 ? value.split('').map((ch) => ch + ch).join('') : value;
  const num = parseInt(full.slice(0, 6) || 'ffffff', 16);
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 建立一個「顏色 → 光暈畫布」的快取產生器。
 * @param {{size?:number, doc?:object}} deps
 */
export function makeGlowCanvas({ size = 64, doc = globalThis.document } = {}) {
  const cache = new Map();

  return function glowCanvas(color) {
    if (cache.has(color)) return cache.get(color);
    const canvas = doc.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const c = canvas.getContext('2d');
    const half = size / 2;
    const gradient = c.createRadialGradient(half, half, 0, half, half, half);
    gradient.addColorStop(0, hexToRgba(color, 0.95));
    gradient.addColorStop(0.45, hexToRgba(color, 0.35));
    gradient.addColorStop(1, hexToRgba(color, 0));
    c.fillStyle = gradient;
    c.fillRect(0, 0, size, size);
    cache.set(color, canvas);
    return canvas;
  };
}
