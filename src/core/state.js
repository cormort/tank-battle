// 遊戲狀態機（M3）。
//
// 為什麼要這個：狀態原本是散在各處的 `G.state = STATE.X`（9 處）。沒有白名單時，
// 「從 gameover 直接跳 playing」「商店中又開升級畫面」這類錯誤轉移不會有任何跡象，
// 只會表現成畫面卡住或計時器亂跑（這一輪就修過一次：暫停期間堡壘仍持續倒數）。
//
// 設計取捨：**觀測優先於強制**。不在白名單內的轉移仍然允許（遊戲不會因為一個漏寫的
// 白名單就卡死），但會登記一筆警告 —— 測試用「實際跑完所有流程後警告數為 0」當閘門，
// 既不會誤殺玩家，又能抓到沒被宣告的轉移。

export const STATES = {
  MENU: 'menu',
  PLAYING: 'playing',
  PAUSED: 'paused',
  UPGRADE: 'upgrade',
  SHOP: 'shop',
  GAMEOVER: 'gameover',
  LEVEL_COMPLETE: 'levelComplete',
};

// 允許的轉移（白名單）。來源為 index.html 內實際的 9 個賦值點與遊戲流程。
const ALLOWED = {
  [STATES.MENU]: [STATES.PLAYING],
  [STATES.PLAYING]: [STATES.PAUSED, STATES.SHOP, STATES.UPGRADE, STATES.LEVEL_COMPLETE, STATES.GAMEOVER, STATES.MENU],
  [STATES.PAUSED]: [STATES.PLAYING, STATES.SHOP, STATES.MENU, STATES.GAMEOVER],
  [STATES.SHOP]: [STATES.PLAYING, STATES.MENU, STATES.GAMEOVER],
  [STATES.UPGRADE]: [STATES.PLAYING, STATES.MENU],
  [STATES.LEVEL_COMPLETE]: [STATES.PLAYING, STATES.UPGRADE, STATES.GAMEOVER, STATES.MENU],
  [STATES.GAMEOVER]: [STATES.MENU, STATES.PLAYING, STATES.UPGRADE],
};

export function isKnownState(state) {
  return Object.values(STATES).includes(state);
}

/**
 * @param {{initial?: string, onChange?: Function, onUnexpected?: Function}} options
 */
export function makeStateMachine({ initial = STATES.MENU, onChange, onUnexpected } = {}) {
  let current = initial;
  const history = [];
  const warnings = [];

  const machine = {
    get() { return current; },
    is(state) { return current === state; },
    can(next) { return (ALLOWED[current] || []).includes(next); },
    history() { return history.slice(); },
    warnings() { return warnings.slice(); },

    /**
     * 設定狀態。回傳 { ok, applied, reason }：
     *   ok      = 這次轉移在白名單內
     *   applied = 狀態是否真的被改變（未知狀態值不會被套用）
     */
    set(next) {
      if (!isKnownState(next)) {
        warnings.push(`未知狀態 ${JSON.stringify(next)}（忽略）`);
        if (onUnexpected) onUnexpected({ from: current, to: next, reason: 'unknown-state' });
        return { ok: false, applied: false, reason: 'unknown-state' };
      }
      if (next === current) return { ok: true, applied: false, reason: 'same-state' };

      const ok = machine.can(next);
      if (!ok) {
        warnings.push(`未宣告的轉移 ${current} → ${next}`);
        if (onUnexpected) onUnexpected({ from: current, to: next, reason: 'undeclared-transition' });
      }
      const previous = current;
      current = next;
      history.push({ from: previous, to: next, ok });
      if (onChange) onChange({ from: previous, to: next, ok });
      return { ok, applied: true, reason: ok ? 'ok' : 'undeclared-transition' };
    },

    /** 重新開始：回到初始狀態並清空觀測紀錄（契約有測試）。 */
    reset() {
      current = initial;
      history.length = 0;
      warnings.length = 0;
    },
  };

  return machine;
}
