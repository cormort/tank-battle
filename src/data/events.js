// 局內事件：Director 事件與地圖事件。

// Director 事件除了資料（name/duration/desc）也帶行為（activate/deactivate）。
// 行為需要的執行期物件由呼叫端注入，資料層不必 import 遊戲內部 —— 依賴關係因此是顯式的，
// 也讓這張表可以在 Node 裡用 stub ctx 驗證（tools/verify-data.mjs）。
export function makeDirectorEvents(ctx) {
  // 注意：不能在這裡解構 ctx —— 傳進來的 G／Tank 等在 index.html 是晚於 import 才宣告的，
  // 解構會立刻求值（TDZ: Cannot access 'G' before initialization）。一律在行為被呼叫時才取。
  return {
  SURGE: {
    name: '⚠️ ENEMY SURGE', duration: 600, desc: '敵軍生成加倍',
    activate() { ctx.G.spawnInterval = Math.max(4, ctx.G.spawnInterval / 2); },
    deactivate() { ctx.G.spawnInterval = Math.min(30, ctx.G.spawnInterval * 2); }
  },
  AIRDROP: {
    name: '📦 空投來了', duration: 900, desc: '高級物資出現',
    activate() {
      ctx.G.directorEvents.push({ type: 'airdrop', x: ctx.W/2, y: ctx.H/2, life: 300, maxLife: 300 });
    }
  },
  MINIBOSS: {
    name: '💀 BOSS 突襲', duration: 1200, desc: 'Mini Boss 出現',
    activate() {
      const e = new ctx.Tank(ctx.W/2, ctx.TILE, ctx.DOWN, 'BOSS', false);
      e.hp = e.maxHp = 8;
      ctx.G.enemies.push(e);
      ctx.G.aliveEnemies++;      // 其他生兵路徑都有計數；少了這行會在牠死亡時讓 aliveEnemies 漂移成負值
    }
  },
  ORBITAL: {
    name: '🚀 軌道轟炸', duration: 800, desc: '地面出現預警',
    activate() {
      ctx.G.directorEvents.push({ type: 'orbital', targets: [], stage: 0, timer: 0 });
    }
  },
  TRAIN: {
    name: '🚂 補給列車', duration: 600, desc: '高速物資列車',
    activate() {
      ctx.G.directorEvents.push({ type: 'train', x: 0, y: ctx.H/2, life: 360 });
    }
  }
  };
}

export const MAP_EVENTS = [
  { id: 'DESERT', name: '🏜️ 沙漠', effect: '移速 -30%', color: '#cc8844', duration: 600 },
  { id: 'ICE', name: '❄️ 冰原', effect: '坦克滑行慣性', color: '#88ccff', duration: 600 },
  { id: 'VOLCANIC', name: '🌋 火山', effect: '定期噴岩漿', color: '#ff4422', duration: 480 },
  { id: 'EMP', name: '⚡ EMP區域', effect: '子彈速度減半', color: '#aa44ff', duration: 600 },
  { id: 'NIGHT', name: '🌙 夜戰', effect: '視野縮小', color: '#222244', duration: 600 },
  { id: 'TOXIC', name: '☣️ 毒霧', effect: '持續扣血', color: '#44ff44', duration: 480 }
];
