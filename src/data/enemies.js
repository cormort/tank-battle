// 敵人資料：菁英詞綴、特殊敵人類型。

export const ELITE_PREFIXES = {
  BERSERKER: { name: '狂戰士', effect: '移速 x1.8', color: '#ff0000', icon: '🔴' },
  SHIELDED: { name: '護盾', effect: '免疫前 3 發', color: '#8800ff', icon: '🟣' },
  EXPLOSIVE: { name: '爆炸', effect: '死亡時爆炸', color: '#000000', icon: '⚫' },
  FREEZING: { name: '冰凍', effect: '命中玩家減速', color: '#00ddff', icon: '🔵' },
  REGEN: { name: '再生', effect: '每秒回血', color: '#00ff00', icon: '🟢' },
  SUMMONER: { name: '召喚', effect: '持續召喚小兵', color: '#ffff00', icon: '🟡' }
};

export const SPECIAL_ENEMY_TYPES = new Set(['SNIPER','ENGINEER','INTERFERER','GUARD','MINELAYER']);
