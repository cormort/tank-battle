// BOSS 原型：每 5 關一隻，三型輪替。
//
// 為什麼要有這個：舊版每一隻 BOSS 都是同一個東西 —— 血很多的紅色大坦克、只會發散彈、
// 血量到 75% / 50% / 25% 時加速／召喚／抖一下，打法完全一樣。玩到第 20 關的王跟第 5 關的王
// 是同一個沙包，只是血變多。這裡把「王長什麼樣、怎麼攻擊」抽成資料表，行為在 index.html 依
// `pattern` 分派（ARTILLERY／CHARGE／SPAWN），所以新增一隻王＝加一筆資料 + 一個 pattern 分支。
//
// 數值刻意讓三型的「威脅類型」不同（不是同一組數值換皮）：
//   SIEGE   血厚、慢、遠程炮擊 → 逼玩家移動，不能站樁輸出
//   HUNTER  血薄、快、貼身衝撞 → 逼玩家預判，抓牠衝撞後的硬直反打
//   SWARMER 血最薄、持續召喚    → 逼玩家清場，否則小兵會把場地淹掉

export const BOSS_TYPES = {
  SIEGE: {
    id: 'SIEGE',
    name: '攻城核心',
    pattern: 'ARTILLERY',
    color: '#b06000',
    icon: '💣',
    hpMult: 1.2,          // 血最厚：站樁打不死，要靠走位躲炮
    speedMult: 0.7,
    sizeMult: 1.7,
    volleyCooldown: 100,  // 每 100 tick 一輪炮擊
    volleyCount: 3,       // 一輪 3 發
    shellSpeed: 2.2,
    shellFuse: 150,       // 砲彈最多飛 150 tick（≈330px），沒打到東西也會炸
    blastRadius: 34,      // 爆炸半徑（px）
    blastPower: 1,
  },
  HUNTER: {
    id: 'HUNTER',
    name: '獵殺者',
    pattern: 'CHARGE',
    color: '#a020a0',
    icon: '🗡️',
    hpMult: 0.85,
    speedMult: 1.1,
    sizeMult: 1.4,
    chargeWindup: 45,     // 蓄力 45 tick（畫面有警示圈）
    chargeTicks: 28,      // 衝刺 28 tick
    chargeSpeed: 4.2,
    recoverTicks: 55,     // 撞牆後硬直（這段時間是輸出窗口）
  },
  SWARMER: {
    id: 'SWARMER',
    name: '蜂巢母艦',
    pattern: 'SPAWN',
    color: '#1f7a1f',
    icon: '🐝',
    hpMult: 0.8,
    speedMult: 0.85,
    sizeMult: 1.5,
    spawnCooldown: 300,   // 每 300 tick 生一批
    spawnCount: 2,
  },
};

/** 三型的固定輪替順序（讓相鄰兩隻王不會是同型）。 */
export const BOSS_ORDER = ['SIEGE', 'HUNTER', 'SWARMER'];

/**
 * 第 level 關要用哪一隻王。`level` 必須是 BOSS 關（level % interval === 0），
 * 但這裡對任意 level 都給得出答案（取 floor(level/interval)），確保呼叫端不會拿到 undefined。
 * @param {number} level
 * @param {number} interval 幾關一隻王（呼叫端傳 CONFIG.GAMEPLAY.BOSS_LEVEL_INTERVAL）
 */
export function bossTypeForLevel(level, interval = 5) {
  const stage = Math.max(1, Math.floor((Number(level) || interval) / interval));
  return BOSS_ORDER[(stage - 1) % BOSS_ORDER.length];
}
