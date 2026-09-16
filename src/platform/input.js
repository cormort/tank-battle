// 平台層：輸入（M3）。
//
// 為什麼要這個：鍵盤與觸控原本各自直接讀寫 `G.keys` 與 `G.touch`，
// 於是出現過「按著 D 切到別的分頁，keyup 永遠收不到 → 坦克一直往同方向跑」這種 bug，
// 而修正只能靠在事件監聽裡手寫 `G.keys = {}`。抽出來之後：
//   1. 按鍵 → intent 的對應是一張表（不再散在 update() 的 if 串裡）；
//   2. 「放開所有輸入」只有一個實作（`releaseAll`），鍵盤與觸控共用；
//   3. 全部是純函式，可在 Node 測（`tools/verify-core.mjs`）。

/** 方向 intent 的列舉（與 index.html 的 UP/RIGHT/DOWN/LEFT 對齊）。 */
export const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };

/** 按鍵 → intent 的對應表。同一個 intent 可以有多個按鍵。 */
export const KEY_BINDINGS = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowRight: 'right', KeyD: 'right',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  Space: 'fire', KeyJ: 'fire',
};

/** 遊戲中要攔截預設行為的按鍵（方向鍵與空白鍵會捲動頁面）。 */
const PREVENT_DEFAULT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export function makeInputState() {
  return { up: false, right: false, down: false, left: false, fire: false, skill: false };
}

/**
 * 套用一次按鍵事件。
 * @param {object} state makeInputState() 的結果（會被就地修改）
 * @param {string} code  KeyboardEvent.code
 * @param {boolean} down true = keydown
 * @param {{editable?: boolean, skillKey?: string}} options
 *        editable：焦點在 UI 元件上時不攔截預設行為（否則按鈕無法用 Space 啟動）
 * @returns {{intent: string|null, isSkill: boolean, skillPressed: boolean, preventDefault: boolean, changed: boolean}}
 */
export function applyKey(state, code, down, { editable = false, skillKey = 'KeyQ' } = {}) {
  const intent = KEY_BINDINGS[code] || null;
  const isSkill = code === skillKey;
  // 主動技能是邊緣觸發：只在 0 → 1 的那一次算「按下」，避免按住期間每幀重複施放
  const skillPressed = isSkill && !!down && !state.skill;

  if (intent) state[intent] = !!down;
  if (isSkill) state.skill = !!down;

  return {
    intent,
    isSkill,
    skillPressed,
    preventDefault: !editable && PREVENT_DEFAULT.has(code),
    changed: !!intent || isSkill,
  };
}

/** 依 intent 決定移動方向（沿用原本的優先序：上 → 右 → 下 → 左）。 */
export function dirFromInput(state, fallback = -1) {
  if (state.up) return DIR.UP;
  if (state.right) return DIR.RIGHT;
  if (state.down) return DIR.DOWN;
  if (state.left) return DIR.LEFT;
  return fallback;
}

/** 放開所有輸入（失去焦點、切到背景、結算畫面時呼叫）。 */
export function releaseAll(state) {
  state.up = state.right = state.down = state.left = state.fire = false;
  state.skill = false;
  return state;
}

/** 觸控狀態（搖桿 + FIRE 鍵）的統一形狀。 */
export function makeTouchState() {
  return { dir: -1, fire: false, joyActive: false, joyDx: 0, joyDy: 0 };
}

export function releaseTouch(state) {
  state.dir = -1;
  state.fire = false;
  state.joyActive = false;
  state.joyDx = 0;
  state.joyDy = 0;
  return state;
}
