// 可重現亂數（M2 的基礎）。
//
// 為什麼要這個：整局遊戲的隨機都走同一個產生器之後，「同一組 seed + 同一串輸入」就必然
// 產生同一個結果 —— 這是 replay 測試的前提，也讓「玩一局」變成 CI 能跑的事。
// 原本 59 處直接呼叫 Math.random()，任何一次呼叫都會讓兩次執行分岔，無法回放。
//
// 演算法選 xorshift32：狀態只有 32 bit、純整數運算、不需要種子表，對這個規模足夠，
// 而且好處是「可序列化」—— 存下 state 就能從中斷點續跑。

/** 字串 → 32 bit 整數 seed（讓 ?seed=abc 這種可讀的種子也能用）。 */
export function hashSeed(input) {
  if (input === null || input === undefined) return 1;
  const text = String(input).trim();
  if (text === '') return 1;             // ?seed= 空字串視為「沒有指定」

  if (/^\d+$/.test(text)) return (Number(text) >>> 0) || 1;
  let h = 2166136261 >>> 0;              // FNV-1a
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

/**
 * 建立一個 xorshift32 產生器。
 * 回傳的函式像 Math.random() 一樣回傳 [0,1)，另外附上 state 讀寫與整數/範圍輔助。
 */
export function makeRng(seed = 1) {
  let state = (seed >>> 0) || 1;

  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;  state >>>= 0;
    return state / 4294967296;
  };

  next.state = () => state;
  next.setState = (value) => { state = (value >>> 0) || 1; };
  next.int = (maxExclusive) => Math.floor(next() * maxExclusive);
  next.range = (min, max) => min + next() * (max - min);
  return next;
}

/** 預設種子：沒有指定 ?seed 時用時間（正常遊玩每次都不同），方便重現時可覆寫。 */
export function defaultSeed() {
  return ((Date.now() ^ (performance.now() * 1000)) >>> 0) || 1;
}
