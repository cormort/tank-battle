// 武器資料：四條流派樹、射擊參數、起始武器、掉落池。

export const WEAPON_TREE = {
  // 四條流派、各 3 級：入門（tier1）→ 強化（tier2）→ 終形（tier3）。
  // 精簡前是各 4 級（16 把），中間那階只是「子彈變多、數字變大」，玩家在升級卡上分不出
  // 差別，卻要多記 4 個名字；現在刪掉那一階，其餘數值不動（等於提早一關拿到終形）。

  // A 路線：高射速流 - 超高DPS，單發低，剋重甲
  RAPID: {
    id: 'RAPID',
    route: 'A', tier: 1, name: '快速射擊', desc: '雙連發模式，子彈貫穿',
    next: 'GATLING', color: '#ff6b00', icon: '⚡', basePower: 1.0
  },
  GATLING: {
    id: 'GATLING',
    route: 'A', tier: 2, name: '格林機槍', desc: '雙管射擊，火力+10%',
    next: 'OVERDRIVE', color: '#ff4400', icon: '🔥', basePower: 1.1
  },
  OVERDRIVE: {
    id: 'OVERDRIVE',
    route: 'A', tier: 3, name: '過載出火', desc: '四管齊射，全螢幕橫掃',
    next: null, color: '#880000', icon: '💀', basePower: 1.4
  },

  // B 路線：範圍爆破流 - 清怪神，打王弱，命中分裂
  SPREAD: {
    id: 'SPREAD',
    route: 'B', tier: 1, name: '散彈核心', desc: '扇形發射 3 發子彈',
    next: 'CLUSTER', color: '#ffdd00', icon: '💫', basePower: 1.0
  },
  CLUSTER: {
    id: 'CLUSTER',
    route: 'B', tier: 2, name: '集束彈頭', desc: '命中分裂 5 發小彈',
    next: 'APOCALYPSE', color: '#ffaa00', icon: '💛', basePower: 1.1
  },
  APOCALYPSE: {
    id: 'APOCALYPSE',
    route: 'B', tier: 3, name: '末日轟炸', desc: '5 發散彈 + 每 3 秒全螢幕轟炸',
    next: null, color: '#ff0000', icon: '☠️', basePower: 1.5
  },

  // C 路線：雷射科技流 - 貫穿，超遠距，打王強
  PLASMA: {
    id: 'PLASMA',
    route: 'C', tier: 1, name: '電漿武器', desc: '高傷貫穿子彈',
    next: 'D_LASER', color: '#00ddff', icon: '⚡', basePower: 1.2
  },
  D_LASER: {
    id: 'D_LASER',
    route: 'C', tier: 2, name: '雙光束炮', desc: '雙光束射擊',
    next: 'OMEGA', color: '#00aaff', icon: '🔷', basePower: 1.3
  },
  OMEGA: {
    id: 'OMEGA',
    route: 'C', tier: 3, name: '歐米茄射線', desc: '光束掃射，穿透障礙',
    next: null, color: '#0044cc', icon: '👁️', basePower: 1.6
  },

  // D 路線：召喚塔防流 - 本體弱，召喚物強
  SUMMON: {
    id: 'SUMMON',
    route: 'D', tier: 1, name: '工程師', desc: '部署 1 個自動砲塔',
    next: 'DRONE', color: '#44ff88', icon: '🛠️', basePower: 0.8
  },
  DRONE: {
    id: 'DRONE',
    route: 'D', tier: 2, name: '維修無人機', desc: '砲塔生命與傷害提升',
    next: 'FORTRESS', color: '#22cc66', icon: '🤖', basePower: 0.9
  },
  FORTRESS: {
    id: 'FORTRESS',
    route: 'D', tier: 3, name: '要塞核心', desc: '終極塔防，四座砲台',
    next: null, color: '#008833', icon: '⚔️', basePower: 1.3
  }
};

export const STARTER_WEAPONS = ['NORMAL', 'RAPID', 'SPREAD', 'PLASMA', 'SUMMON'];

export const WEAPON_REGISTRY = {
  // NORMAL: 普通发射
  NORMAL:   { fireRate: 14, count: 1, spread: 0,   power: 1.0,  effect: null },
  // RAPID: 快速射击链（貫穿）
  RAPID:    { fireRate: 6,  count: 1, spread: 0,   power: 0.6,  effect: 'PIERCE' },
  GATLING:  { fireRate: 5,  count: 2, spread: 0,   power: 0.55, effect: 'PIERCE' },
  OVERDRIVE:{ fireRate: 3,  count: 4, spread: 0,   power: 0.45, effect: 'PIERCE' },
  // SPREAD: 散射
  SPREAD:   { fireRate: 16, count: 3, spread: 0.25, power: 0.8,  effect: null },
  CLUSTER:  { fireRate: 14, count: 3, spread: 0.25, power: 0.9,  effect: null },
  APOCALYPSE:{ fireRate: 10, count: 5, spread: 0.4, power: 0.8,  effect: 'BOMBARD' },
  // PLASMA: 激光科技流
  PLASMA:   { fireRate: 12, count: 1, spread: 0,   power: 1.2,  effect: 'PIERCE' },
  D_LASER:  { fireRate: 10, count: 2, spread: 0,   power: 1.1,  effect: 'PIERCE' },
  OMEGA:    { fireRate: 6,  count: 1, spread: 0,   power: 1.4,  effect: 'LASER_BEAM' },
  // SUMMON: 召唤塔防流
  SUMMON:   { fireRate: 20, count: 1, spread: 0,   power: 0.8,  effect: 'SPAWN_TURRET' },
  DRONE:    { fireRate: 18, count: 1, spread: 0,   power: 0.9,  effect: 'SPAWN_TURRET' },
  FORTRESS: { fireRate: 14, count: 1, spread: 0,   power: 1.3,  effect: 'SPAWN_TURRET' }
};

export const WEAPON_DROPS_T1 = ['RAPID_DROP', 'SPREAD_DROP', 'PLASMA_DROP', 'SUMMON_DROP'];

export const WEAPON_DROPS_T2 = ['GATLING_DROP', 'CLUSTER_DROP', 'D_LASER_DROP'];
