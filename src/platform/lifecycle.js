// 平台層：生命週期（M3）。
//
// 為什麼要這個：原本 `visibilitychange`／`blur`／`focus`／`pointerdown` 四個監聽散在
// index.html 裡，各自做不同的事（放開輸入、自動暫停、恢復音訊），而且漏掉任何一個都會
// 變成難查的 bug —— 例如「按著 D 切到別的分頁回來，坦克一直往同方向跑」（keyup 收不到）
// 或「從背景回來後永久無聲」（iOS 需要新的使用者手勢才能 resume AudioContext）。
//
// 抽出來之後：事件與意圖的對應集中在一處，而且可用 stub 的 win/doc 在 Node 測。

/**
 * @param {{
 *   onLeave?: Function,     // 失去焦點或切到背景：放開輸入 + 自動暫停
 *   onReturn?: Function,    // 回到前景或取得焦點：恢復音訊等
 *   win?: object, doc?: object,
 * }} options
 * @returns {Function} 解除綁定（測試與切換頁面時用）
 */
export function bindLifecycle({ onLeave, onReturn, win = globalThis, doc = globalThis.document } = {}) {
  const leave = () => { if (onLeave) onLeave(); };
  const back = () => { if (onReturn) onReturn(); };

  const onVisibility = () => { if (doc && doc.hidden) leave(); else back(); };

  if (doc) doc.addEventListener('visibilitychange', onVisibility);
  if (win) {
    win.addEventListener('blur', leave);
    win.addEventListener('focus', back);
    // iOS 從背景回來後 AudioContext 需要新的使用者手勢才能恢復
    win.addEventListener('pointerdown', back);
  }

  return function unbind() {
    if (doc) doc.removeEventListener('visibilitychange', onVisibility);
    if (win) {
      win.removeEventListener('blur', leave);
      win.removeEventListener('focus', back);
      win.removeEventListener('pointerdown', back);
    }
  };
}
