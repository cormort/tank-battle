// 資料層入口：只做 re-export，讓 index.html 一行取用全部資料表。

export { CONFIG } from './config.js';
export { ELITE_PREFIXES, SPECIAL_ENEMY_TYPES } from './enemies.js';
export { makeDirectorEvents, MAP_EVENTS } from './events.js';
export { COMMON_DROPS, POWER_UPS } from './pickups.js';
export { SHOP_ITEMS } from './shop.js';
export { ACTIVE_SKILLS, PASSIVE_SKILLS } from './upgrades.js';
export { STARTER_WEAPONS, WEAPON_DROPS_T1, WEAPON_DROPS_T2, WEAPON_REGISTRY, WEAPON_TREE } from './weapons.js';
