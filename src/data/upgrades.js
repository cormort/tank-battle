// 升級卡池：被動技能與主動技能。

export const PASSIVE_SKILLS = [
  { id: 'HEAT', name: '熱能反應', desc: '連續射擊越久，攻速越快', icon: '🔥', color: '#ff6600' },
  { id: 'OVERCHARGE', name: '超載電容', desc: '雷射擊殺敵人會連鎖電擊', icon: '⚡', color: '#00ddff' },
  { id: 'RAGE', name: '狂暴核心', desc: '生命越低傷害越高', icon: '🩸', color: '#ff0066' },
  { id: 'BARRIER', name: '反應護盾', desc: '受傷後 2 秒無敵', icon: '🛡️', color: '#8888ff' },
  { id: 'NUCLEAR', name: '核融合引擎', desc: '移動時持續灼燒周圍', icon: '☢️', color: '#44ff44' },
  { id: 'WEAKEN', name: '弱點分析', desc: '對 BOSS 額外 +50% 傷害', icon: '🎯', color: '#ffff00' },
  { id: 'VAMPIRE', name: '吸血光束', desc: '擊殺回血', icon: '🦇', color: '#cc0000' },
  { id: 'CHAIN', name: '連鎖反應', desc: '子彈會彈跳到附近敵人', icon: '🔗', color: '#aa44ff' }
];

export const ACTIVE_SKILLS = [
  { id: 'EMP', name: 'EMP脈衝', desc: '清除附近子彈', cooldown: 20, key: 'KeyQ', icon: '📡' },
  { id: 'DASH', name: '緊急衝刺', desc: '高速位移', cooldown: 15, key: 'KeyQ', icon: '💨' },
  { id: 'STRIKE', name: '空襲呼叫', desc: '指定區域轟炸', cooldown: 25, key: 'KeyQ', icon: '💥' },
  { id: 'SLOW', name: '時間扭曲', desc: '局部緩速敵人', cooldown: 18, key: 'KeyQ', icon: '⏱️' },
  { id: 'DECOY', name: '誘敵裝置', desc: '吸引敵軍攻擊', cooldown: 22, key: 'KeyQ', icon: '👻' },
  { id: 'BOOST', name: '超頻爆發', desc: '短時攻速翻倍', cooldown: 30, key: 'KeyQ', icon: '🚀' }
];
