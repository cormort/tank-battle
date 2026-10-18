// 武器資料：四條流派樹、射擊參數、起始武器、掉落池。
//
// 傷害只有一個來源：WEAPON_REGISTRY[key].power（每發子彈的傷害）。
// 舊版還有一個 WEAPON_TREE[key].basePower 會再乘一次，於是「資料表看得到的數字」與
// 「實際打出來的傷害」是兩件事——OVERDRIVE 的實際單體 DPS 是 FORTRESS 的 3 倍、
// 是起始武器的 11 倍，但從兩張表上都讀不出來（玩家只會覺得「D 路線是廢的」）。
// basePower 已移除；曲線現在由 tools/weapon-dps.mjs 用同一組資料算出來並當成閘門：
//
//   node tools/weapon-dps.mjs
//
// 曲線（單體 DPS；60 tick = 1 秒）：
//   起始 NORMAL 4.3 → 入門 ≈11 → 強化 ≈19 → 終形 ≈34
// 同階四條路線差距 ≤1.35 倍。路線特色靠「形狀」而不是靠數字：
//   A 高射速＋貫穿（單體疊傷）  B 扇形＋分裂＋轟炸（群聚）
//   C 貫穿光束（沿線一串）      D 召喚砲塔（本體弱、砲塔強）

export const WEAPON_TREE = {
  // 四條流派、各 3 級：入門（tier1）→ 強化（tier2）→ 終形（tier3）。
  // 精簡前是各 4 級（16 把），中間那階只是「子彈變多、數字變大」，玩家在升級卡上分不出
  // 差別，卻要多記 4 個名字；現在刪掉那一階，其餘數值不動（等於提早一關拿到終形）。

  // A 路線：高射速流 - 超高DPS，單發低，剋重甲
  RAPID: {
    id: 'RAPID',
    route: 'A', tier: 1, name: '快速射擊', desc: '高射速單發，子彈貫穿',
    next: 'GATLING', color: '#ff6b00', icon: '⚡'
  },
  GATLING: {
    id: 'GATLING',
    route: 'A', tier: 2, name: '格林機槍', desc: '雙管齊射，貫穿',
    next: 'OVERDRIVE', color: '#ff4400', icon: '🔥'
  },
  OVERDRIVE: {
    id: 'OVERDRIVE',
    route: 'A', tier: 3, name: '過載出火', desc: '四管齊射，全螢幕橫掃',
    next: null, color: '#880000', icon: '💀'
  },

  // B 路線：範圍爆破流 - 清怪神，打王弱，命中分裂
  SPREAD: {
    id: 'SPREAD',
    route: 'B', tier: 1, name: '散彈核心', desc: '扇形發射 3 發子彈',
    next: 'CLUSTER', color: '#ffdd00', icon: '💫'
  },
  CLUSTER: {
    id: 'CLUSTER',
    route: 'B', tier: 2, name: '集束彈頭', desc: '命中分裂 5 發小彈',
    next: 'APOCALYPSE', color: '#ffaa00', icon: '💛'
  },
  APOCALYPSE: {
    id: 'APOCALYPSE',
    route: 'B', tier: 3, name: '末日轟炸', desc: '5 發散彈 + 每 3 秒全螢幕轟炸',
    next: null, color: '#ff0000', icon: '☠️'
  },

  // C 路線：雷射科技流 - 貫穿，超遠距，打王強
  PLASMA: {
    id: 'PLASMA',
    route: 'C', tier: 1, name: '電漿武器', desc: '高傷貫穿子彈',
    next: 'D_LASER', color: '#00ddff', icon: '⚡'
  },
  D_LASER: {
    id: 'D_LASER',
    route: 'C', tier: 2, name: '雙光束炮', desc: '雙光束射擊',
    next: 'OMEGA', color: '#00aaff', icon: '🔷'
  },
  OMEGA: {
    id: 'OMEGA',
    route: 'C', tier: 3, name: '歐米茄射線', desc: '光束掃射，穿透障礙',
    next: null, color: '#0044cc', icon: '👁️'
  },

  // D 路線：召喚塔防流 - 本體弱，召喚物強
  SUMMON: {
    id: 'SUMMON',
    route: 'D', tier: 1, name: '工程師', desc: '部署 2 座自動砲塔',
    next: 'DRONE', color: '#44ff88', icon: '🛠️'
  },
  DRONE: {
    id: 'DRONE',
    route: 'D', tier: 2, name: '維修無人機', desc: '3 座砲塔，傷害與射速提升',
    next: 'FORTRESS', color: '#22cc66', icon: '🤖'
  },
  FORTRESS: {
    id: 'FORTRESS',
    route: 'D', tier: 3, name: '要塞核心', desc: '終極塔防，四座重型砲台',
    next: null, color: '#008833', icon: '⚔️'
  }
};

export const STARTER_WEAPONS = ['NORMAL', 'RAPID', 'SPREAD', 'PLASMA', 'SUMMON'];

// power  = 每發子彈傷害（唯一的傷害來源；沒有任何地方會再乘一次）
// effect = 特殊行為：
//   PIERCE      子彈貫穿
//   SPLIT       命中後分裂 5 發小彈
//   BOMBARD     每 3 秒全螢幕轟炸（真的會造成傷害）
//   LASER_BEAM  沿線一次判定的光束（不是 30 顆子彈各自判定）
//   SPAWN_TURRET 召喚砲塔；參數在 turret（數量／單發傷害／射擊間隔 tick）
export const WEAPON_REGISTRY = {
  NORMAL:    { fireRate: 14, count: 1, spread: 0,    power: 1.00, effect: null },
  // A：高射速＋貫穿
  RAPID:     { fireRate: 6,  count: 1, spread: 0,    power: 0.79, effect: 'PIERCE' },
  GATLING:   { fireRate: 5,  count: 2, spread: 0,    power: 0.57, effect: 'PIERCE' },
  OVERDRIVE: { fireRate: 3,  count: 4, spread: 0,    power: 0.30, effect: 'PIERCE' },
  // B：扇形＋分裂＋轟炸
  SPREAD:    { fireRate: 16, count: 3, spread: 0.25, power: 1.40, effect: null },
  CLUSTER:   { fireRate: 14, count: 3, spread: 0.25, power: 1.05, effect: 'SPLIT' },
  APOCALYPSE:{ fireRate: 10, count: 5, spread: 0.40, power: 1.47, effect: 'BOMBARD' },
  // C：貫穿光束
  PLASMA:    { fireRate: 12, count: 1, spread: 0,    power: 1.64, effect: 'PIERCE' },
  D_LASER:   { fireRate: 10, count: 2, spread: 0,    power: 1.16, effect: 'PIERCE' },
  OMEGA:     { fireRate: 6,  count: 1, spread: 0,    power: 1.94, effect: 'LASER_BEAM' },
  // D：召喚砲塔（本體弱、砲塔強）
  SUMMON:    { fireRate: 20, count: 1, spread: 0,    power: 2.23, effect: 'SPAWN_TURRET',
               turret: { count: 2, damage: 1.5, cooldown: 25 } },
  DRONE:     { fireRate: 18, count: 1, spread: 0,    power: 2.46, effect: 'SPAWN_TURRET',
               turret: { count: 3, damage: 2.2, cooldown: 22 } },
  FORTRESS:  { fireRate: 14, count: 1, spread: 0,    power: 2.56, effect: 'SPAWN_TURRET',
               turret: { count: 4, damage: 3.2, cooldown: 20 } }
};

export const WEAPON_DROPS_T1 = ['RAPID_DROP', 'SPREAD_DROP', 'PLASMA_DROP', 'SUMMON_DROP'];

export const WEAPON_DROPS_T2 = ['GATLING_DROP', 'CLUSTER_DROP', 'D_LASER_DROP'];
