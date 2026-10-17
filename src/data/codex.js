// 圖鑑、可換坦克、成就（純外觀，不影響數值）。
//
// 圖鑑 id = 遊戲裡實際畫出的素材名（index.html 的 tankArtKey()），擊殺時直接用它計數，
// 所以「看到的造型」跟「圖鑑的條目」永遠對得上。kills = 解鎖需要的擊殺數。

const V = (id, name, faction) => ({ id, name, faction, group: '載具', kills: 10 });
const I = (id, name, faction) => ({ id, name, faction, group: '步兵', kills: 10 });
const S = (id, name) => ({ id, name, faction: '特殊', group: '特殊敵人', kills: 3 });
const B = (id, name) => ({ id, name, faction: '首領', group: '首領', kills: 1 });

export const CODEX_ENTRIES = [
  V('tank_normal', '混沌犀牛運兵車', '混沌'), V('chaos_fast', '混沌掠奪者機車', '混沌'),
  V('tank_heavy', '千子陸行艦', '混沌'), V('chaos_suicide', '惡魔附身巨獸', '混沌'),
  V('ork_normal', '獸人卡車', '獸人'), V('ork_fast', '獸人戰爭越野車', '獸人'),
  V('ork_heavy', '獸人戰鬥馬車', '獸人'), V('tank_suicide', '獸人爆破車', '獸人'),
  V('aeldari_normal', '靈族波蛇運輸艇', '靈族'), V('tank_fast', '靈族獵鷹戰車', '靈族'),
  V('aeldari_heavy', '靈族火稜戰車', '靈族'), V('aeldari_suicide', '靈族蝰蛇噴射機車', '靈族'),
  V('tyranid_normal', '泰倫屠殺者', '泰倫'), V('tyranid_fast', '泰倫鉤爪蟲群', '泰倫'),
  V('tyranid_heavy', '泰倫暴君巨獸', '泰倫'), V('tyranid_suicide', '泰倫孢子雷', '泰倫'),
  V('necron_normal', '死靈幽魂方舟', '死靈'), V('necron_fast', '死靈墓刃', '死靈'),
  V('necron_heavy', '死靈末日方舟', '死靈'), V('necron_suicide', '死靈聖甲蟲群', '死靈'),
  I('gaga_poxwalker', '瘟疫行屍', '混沌'), I('gaga_ork_boy', '獸人小子', '獸人'),
  I('gaga_genestealer', '基因竊取者', '泰倫'), I('gaga_hormagaunt', '鉤爪蟲', '泰倫'),
  I('gaga_termagant', '螳螂蟲', '泰倫'),
  S('gaga_sniper', '酸液噴吐者'), S('gaga_engineer', '機械神教技術神甫'), S('gaga_interferer', '爆破蟲'),
  S('gaga_guard', '鐵衛'), S('gaga_minelayer', '孢子巢'),
  B('boss_siege', '攻城核心・獸人巨像'), B('boss_hunter', '獵殺者・惡魔引擎'), B('boss_swarmer', '蜂巢母艦・瘟疫爬行者'),
];

// 可換的坦克：預設坦克 + 所有敵方載具與首領。level = 最高抵達關卡需達到幾關。
// 依角色分梯：一般 3、快速 7、重裝 12、自爆 16；首領要打過該首領關（6／11／16）。
const ROLE_LEVEL = { normal: 3, fast: 7, heavy: 12, suicide: 16 };
const roleOf = (id) => id === 'tank_normal' ? 'normal' : id === 'tank_fast' ? 'fast'
  : id === 'tank_heavy' ? 'heavy' : id === 'tank_suicide' ? 'suicide' : id.split('_')[1];
export const SKINS = [
  { id: 'tank_player', name: '帝國之拳掠食者', level: 1 },
  ...CODEX_ENTRIES.filter((e) => e.group === '載具').map((e) => ({ id: e.id, name: e.name, level: ROLE_LEVEL[roleOf(e.id)] })),
  { id: 'boss_siege', name: '獸人巨像', level: 6 },
  { id: 'boss_hunter', name: '惡魔引擎', level: 11 },
  { id: 'boss_swarmer', name: '瘟疫爬行者', level: 16 },
];

// 成就：test(s) 拿到目前的進度快照，回傳 true 即解鎖。
const BOSSES = ['boss_siege', 'boss_hunter', 'boss_swarmer'];
export const ACHIEVEMENTS = [
  { id: 'first_blood', name: '初次擊殺', desc: '擊毀第一個敵人', test: (s) => s.totalKills >= 1 },
  { id: 'kills_100', name: '百人斬', desc: '累計擊毀 100 個敵人', test: (s) => s.totalKills >= 100 },
  { id: 'kills_500', name: '戰爭機器', desc: '累計擊毀 500 個敵人', test: (s) => s.totalKills >= 500 },
  { id: 'kills_2000', name: '皇帝之怒', desc: '累計擊毀 2000 個敵人', test: (s) => s.totalKills >= 2000 },
  { id: 'level_5', name: '新兵', desc: '抵達第 5 關', test: (s) => s.bestLevel >= 5 },
  { id: 'level_10', name: '老兵', desc: '抵達第 10 關', test: (s) => s.bestLevel >= 10 },
  { id: 'level_20', name: '英雄', desc: '抵達第 20 關', test: (s) => s.bestLevel >= 20 },
  { id: 'level_30', name: '傳奇', desc: '抵達第 30 關', test: (s) => s.bestLevel >= 30 },
  { id: 'boss_first', name: '屠龍者', desc: '擊敗任一首領', test: (s) => BOSSES.some((b) => (s.kills[b] || 0) > 0) },
  { id: 'boss_all', name: '首領終結者', desc: '三種首領都擊敗過', test: (s) => BOSSES.every((b) => (s.kills[b] || 0) > 0) },
  { id: 'combo_20', name: '連鎖反應', desc: '單局達成 20 連擊', test: (s) => s.bestCombo >= 20 },
  { id: 'codex_half', name: '審判官學徒', desc: '解鎖一半圖鑑', test: (s) => s.codexUnlocked * 2 >= s.codexTotal },
  { id: 'codex_all', name: '異端審判官', desc: '解鎖全部圖鑑', test: (s) => s.codexUnlocked >= s.codexTotal },
  { id: 'skins_10', name: '車庫收藏家', desc: '解鎖 10 輛坦克', test: (s) => s.skinsUnlocked >= 10 },
];
