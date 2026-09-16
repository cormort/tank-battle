// 道具與掉落池。

export const POWER_UPS = {
  BOMB: { name: '炸彈', desc: '秒殺全屏敵人', icon: '💣', color: '#ff4400', duration: 0 },
  WALL: { name: '堡壘', desc: '鋼鐵城墙 15 秒', icon: '🧱', color: '#888888', duration: 15 },
  STAR: { name: '火力', desc: '武器升一級', icon: '⭐', color: '#ffd700', duration: 0 },
  TIME: { name: '時光', desc: '凍敵 10 秒', icon: '⏱️', color: '#00ffff', duration: 10 },
  SHIELD: { name: '護盾', desc: '無敵 10 秒', icon: '🛡️', color: '#8800ff', duration: 10 },
  ONEUP: { name: '+1', desc: '接關次數+1', icon: '❤️', color: '#ff69b4', duration: 0 },
  RAPID_DROP: { name: '快速射擊', desc: '射速+20% (本關有效)', icon: '⚡', color: '#ff6b00', duration: 0, weaponType: 'RAPID' },
  SPREAD_DROP: { name: '散彈', desc: '扇形射擊 (本關有效)', icon: '💫', color: '#ffdd00', duration: 0, weaponType: 'SPREAD' },
  PLASMA_DROP: { name: '電漿炮', desc: '貫穿彈 (本關有效)', icon: '🔷', color: '#00ddff', duration: 0, weaponType: 'PLASMA' },
  SUMMON_DROP: { name: '工程師', desc: '部署砲塔 (本關有效)', icon: '🛠️', color: '#44ff88', duration: 0, weaponType: 'SUMMON' },
  GATLING_DROP: { name: '格林機槍', desc: '格林機槍 (本關有效)', icon: '🔥', color: '#ff4400', duration: 0, weaponType: 'GATLING', tier: 2 },
  CLUSTER_DROP: { name: '集束彈', desc: '集束彈頭 (本關有效)', icon: '💛', color: '#ffaa00', duration: 0, weaponType: 'CLUSTER', tier: 2 },
  D_LASER_DROP: { name: '雙光束炮', desc: '雙光束炮 (本關有效)', icon: '🔷', color: '#00aaff', duration: 0, weaponType: 'D_LASER', tier: 2 }
};

export const COMMON_DROPS = ['BOMB', 'WALL', 'STAR', 'TIME', 'SHIELD', 'ONEUP'];
