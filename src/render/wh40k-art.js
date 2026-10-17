// 渲染層：WH40K 風格點陣圖素材（agy + Nano Banana 繪製，資料在 wh40k-data.js）。
//
// 圖片解碼是非同步的：載入完成前 art(name) 回 null，各繪製函式退回原本的程序化 NES 畫法，
// 所以 Node 的假 context 驗證與「圖還沒解完的前幾幀」都不受影響。全部解完後呼叫 onReady
// （呼叫端用它清掉以程序化畫法建好的坦克快取、重烘靜態地圖）。

/**
 * @param {{data:Object<string,string>, doc?:object, onReady?:Function}} deps
 * @returns {(name:string)=>HTMLImageElement|null}
 */
export function makeArt({ data, doc = globalThis.document, onReady = () => {} } = {}) {
  const ready = new Map();
  const names = Object.keys(data || {});
  if (!doc || typeof Image === 'undefined' || names.length === 0) return () => null;
  let pending = names.length;
  const done = () => { if (--pending === 0) onReady(); };
  for (const name of names) {
    const img = new Image();
    img.onload = () => { ready.set(name, img); done(); };
    img.onerror = done;   // ponytail: 單張壞圖就退回程序化畫法，不重試
    img.src = data[name];
  }
  return (name) => ready.get(name) || null;
}

/** 以 (cx,cy) 為中心、旋轉 angle（弧度）畫一張圖。 */
export function drawRotated(c, img, cx, cy, w, h, angle) {
  if (!angle) { c.drawImage(img, cx - w / 2, cy - h / 2, w, h); return; }
  c.save();
  c.translate(cx, cy);
  c.rotate(angle);
  c.drawImage(img, -w / 2, -h / 2, w, h);
  c.restore();
}
