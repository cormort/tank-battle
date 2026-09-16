// 時效系統（M2）：把「有持續時間的效果」集中管理。
//
// 為什麼要這個：這些計時器原本散在 5 個地方各自 `--`（update 主區塊、updateCombo、
// 以及 PLAYING 判斷之外的兩行），於是出現過兩種 bug：
//   1. `barrierTimer` 只被寫入、沒有任何遞減端 → 拿了 BARRIER 就整局無敵。
//   2. `wallTimer`／`timeFreezeTimer` 的遞減寫在 PLAYING 之外 → 暫停與商店期間也會持續倒數，
//      玩家在商店待久一點，堡壘時間就白白流失。
// 集中之後：**只有一個 tick 進入點**，到期行為用 callback 宣告（不再需要 `_slowed` 之類的旗標補救），
// 而且 `clearAll()` 讓「重新開始就該清空」變成一個可測試的契約。
//
// 設計取捨：刻意不做通用 ECS，只是一個 id → 剩餘 tick 的 Map，外加到期 callback。

export function makeEffects() {
  /** @type {Map<string, {left:number, onExpire?:Function, onTick?:Function}>} */
  const timers = new Map();

  const api = {
    /** 設定時效（覆蓋現有的）。ticks <= 0 等於立即清除。 */
    set(id, ticks, hooks = {}) {
      if (!(ticks > 0)) { timers.delete(id); return 0; }
      timers.set(id, { left: ticks, onExpire: hooks.onExpire, onTick: hooks.onTick });
      return ticks;
    },

    /** 取較長者（例如連續吃到同一個道具時不該縮短）。 */
    extend(id, ticks, hooks = {}) {
      const current = timers.get(id);
      if (current && current.left >= ticks) return current.left;
      return api.set(id, ticks, hooks);
    },

    has(id) { return timers.has(id); },
    left(id) { const t = timers.get(id); return t ? t.left : 0; },
    ids() { return Array.from(timers.keys()); },
    /** 供 UI／存檔用：{ id: 剩餘 tick } */
    snapshot() { return Object.fromEntries(Array.from(timers, ([id, t]) => [id, t.left])); },

    clear(id) { timers.delete(id); },
    clearAll() { timers.clear(); },

    /**
     * 推進一個 tick。這是**唯一**該被呼叫的遞減入口。
     * @returns {string[]} 這一個 tick 到期的效果 id
     */
    tick() {
      const expired = [];
      for (const [id, timer] of timers) {
        if (timer.onTick) timer.onTick(timer.left);
        timer.left -= 1;
        if (timer.left <= 0) {
          timers.delete(id);
          expired.push(id);
          if (timer.onExpire) timer.onExpire();
        }
      }
      return expired;
    },
  };

  return api;
}
