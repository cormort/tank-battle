// 平台層：視窗／畫布尺寸與裝置判定（M3）。
//
// 為什麼要這個：DPR 與觸控判定原本直接寫在 index.html 的頂層，於是
//   * DPR 完全沒處理（DPR 3 手機每個繪圖像素被放大 2.25 倍，只用掉 44% 解析度）
//   * iPadOS 被判成桌機（UA 是 Macintosh、寬度 > 820 → 沒有搖桿與 FIRE 鍵，完全不能玩）
// 抽成純函式之後可以在 Node 測，也不必為了驗證而開瀏覽器。

/** 畫布解析度倍率：上限 2（DPR 3 全螢幕填色的成本會翻 4~9 倍，而這遊戲每幀都在全螢幕填色）。 */
export function computeRenderScale(devicePixelRatio) {
  const dpr = Number(devicePixelRatio) || 1;
  return Math.max(1, Math.min(dpr, 2));
}

/**
 * 觸控裝置判定。iPadOS 13+ 的 UA 是 Macintosh 且螢幕寬度 834/1024/1180 都 > 820，
 * 所以主要訊號是 `pointer: coarse`，UA 與窄畫面只是輔助。
 * @param {{maxTouchPoints?:number, coarsePointer?:boolean, narrowViewport?:boolean, userAgent?:string}} env
 */
export function detectMobile({ maxTouchPoints = 0, coarsePointer = false, narrowViewport = false, userAgent = '' } = {}) {
  const hasTouch = maxTouchPoints > 0;
  const mobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(userAgent);
  return hasTouch && (coarsePointer || narrowViewport || mobileUA);
}

/** 由瀏覽器環境取得判定所需的輸入（讓 detectMobile 保持可測試）。 */
export function readEnv(win = globalThis) {
  return {
    maxTouchPoints: win.navigator?.maxTouchPoints || 0,
    coarsePointer: !!win.matchMedia?.('(pointer: coarse)').matches,
    narrowViewport: !!win.matchMedia?.('(max-width: 820px)').matches,
    userAgent: win.navigator?.userAgent || '',
  };
}

/**
 * 設定 canvas 的 backing store 與繪圖座標系（邏輯座標固定為 width×height）。
 * @returns {{scale:number, width:number, height:number}}
 */
export function applyCanvasScale(canvas, ctx, width, height, scale) {
  canvas.width = width * scale;
  canvas.height = height * scale;
  if (ctx) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.imageSmoothingEnabled = false;      // 像素風格：放大用最近鄰
  }
  return { scale, width, height };
}
