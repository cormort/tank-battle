// 資料層的 schema 與可達性規則（零依賴，Node 與瀏覽器都能跑）。
//
// 為什麼要這個：這一輪修掉的 bug 有一半是「資料宣告了但沒有接線」——
// WEAPON_TREE 16 個條目全都缺 id、'SUMMON' 與 'SUMMONER' 拼字不符、
// POWER_UPS.duration / MAP_EVENTS.effect / STARTER_WEAPONS 這些欄位沒有任何讀取端。
// 這些都不會被 smoke test 抓到（遊戲跑得起來、只是行為不對），所以用 schema 把它們擋在 CI。

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;

/** 驗證資料表；回傳問題清單（空陣列＝通過）。 */
export function validateData(T) {
  const p = [];
  const add = (msg) => p.push(msg);

  // ── CONFIG ──
  const requiredConfig = ['CANVAS', 'BULLET', 'PARTICLE', 'POOL', 'AI', 'GAMEPLAY'];
  requiredConfig.forEach((k) => { if (!isObj(T.CONFIG[k])) add(`CONFIG.${k} 缺少或不是物件`); });
  const canvas = T.CONFIG.CANVAS || {};
  ['W', 'H', 'TILE'].forEach((k) => { if (!isNum(canvas[k])) add(`CONFIG.CANVAS.${k} 必須是數字`); });
  if (canvas.W % canvas.TILE !== 0 || canvas.H % canvas.TILE !== 0) {
    add(`CONFIG.CANVAS 的 W/H 必須能被 TILE 整除（實際 ${canvas.W}/${canvas.H}/${canvas.TILE}）`);
  }
  if (!isNum(T.CONFIG.GAMEPLAY.BOSS_LEVEL_INTERVAL) || T.CONFIG.GAMEPLAY.BOSS_LEVEL_INTERVAL < 1) {
    add('CONFIG.GAMEPLAY.BOSS_LEVEL_INTERVAL 必須是 >= 1 的數字');
  }

  // ── WEAPON_TREE：id 必填且等於 key、四條路線都要能從 tier1 走到 tier4 ──
  const tree = T.WEAPON_TREE || {};
  const treeKeys = Object.keys(tree);
  treeKeys.forEach((key) => {
    const w = tree[key];
    // 這一條就是當初「四條武器流派完全不可玩」的根因：升級卡讀 next.id，缺 id 就變 undefined
    if (w.id !== key) add(`WEAPON_TREE.${key}.id 必須等於 key（實際 ${JSON.stringify(w.id)}）`);
    if (!['A', 'B', 'C', 'D'].includes(w.route)) add(`WEAPON_TREE.${key}.route 必須是 A/B/C/D`);
    if (![1, 2, 3, 4].includes(w.tier)) add(`WEAPON_TREE.${key}.tier 必須是 1~4`);
    ['name', 'desc', 'color', 'icon'].forEach((f) => { if (!isStr(w[f])) add(`WEAPON_TREE.${key}.${f} 必須是非空字串`); });
    if (!isNum(w.basePower) || w.basePower <= 0) add(`WEAPON_TREE.${key}.basePower 必須是 > 0 的數字`);
    if (w.next !== null && !tree[w.next]) add(`WEAPON_TREE.${key}.next 指向不存在的 ${JSON.stringify(w.next)}`);
  });
  const routes = {};
  treeKeys.filter((k) => tree[k].tier === 1).forEach((k) => { routes[tree[k].route] = k; });
  ['A', 'B', 'C', 'D'].forEach((r) => {
    if (!routes[r]) { add(`路線 ${r} 沒有 tier1 的起始武器`); return; }
    let cur = routes[r]; const chain = [cur];
    while (tree[cur] && tree[cur].next) { cur = tree[cur].next; chain.push(cur); }
    if (chain.length !== 4) add(`路線 ${r} 的進化鏈長度是 ${chain.length}，應該是 4（${chain.join('→')}）`);
  });

  // ── WEAPON_REGISTRY：每把武器（含 NORMAL）都要有射擊參數 ──
  const reg = T.WEAPON_REGISTRY || {};
  ['NORMAL', ...treeKeys].forEach((id) => {
    const w = reg[id];
    if (!w) { add(`WEAPON_REGISTRY 缺少 ${id} 的射擊參數`); return; }
    if (!isNum(w.fireRate) || w.fireRate <= 0) add(`WEAPON_REGISTRY.${id}.fireRate 必須 > 0`);
    if (!isNum(w.power) || w.power <= 0) add(`WEAPON_REGISTRY.${id}.power 必須 > 0`);
  });

  // ── 卡池／商店／道具：id 唯一、必填欄位齊全 ──
  const uniqueBy = (rows, field, label) => {
    const seen = new Set();
    (rows || []).forEach((row, i) => {
      const v = row[field];
      if (!isStr(v)) { add(`${label}[${i}].${field} 必須是非空字串`); return; }
      if (seen.has(v)) add(`${label} 的 ${field}=${v} 重複`);
      seen.add(v);
    });
  };
  uniqueBy(T.PASSIVE_SKILLS, 'id', 'PASSIVE_SKILLS');
  uniqueBy(T.ACTIVE_SKILLS, 'id', 'ACTIVE_SKILLS');
  uniqueBy(T.SHOP_ITEMS, 'id', 'SHOP_ITEMS');
  uniqueBy(T.MAP_EVENTS, 'id', 'MAP_EVENTS');
  (T.PASSIVE_SKILLS || []).forEach((s, i) => { ['name', 'desc', 'icon'].forEach((f) => { if (!isStr(s[f])) add(`PASSIVE_SKILLS[${i}].${f} 必須是非空字串`); }); });
  (T.ACTIVE_SKILLS || []).forEach((s, i) => {
    ['name', 'desc', 'icon'].forEach((f) => { if (!isStr(s[f])) add(`ACTIVE_SKILLS[${i}].${f} 必須是非空字串`); });
    // key 若存在必須是合法 KeyboardEvent.code（DASH 的卡面寫 [W] 但實際綁 Q 就是這裡要防的）
    if (s.key !== undefined && !/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space)$/.test(s.key)) {
      add(`ACTIVE_SKILLS[${i}].key=${JSON.stringify(s.key)} 不是合法的 KeyboardEvent.code`);
    }
  });
  (T.SHOP_ITEMS || []).forEach((it, i) => {
    if (!isNum(it.price) || it.price <= 0) add(`SHOP_ITEMS[${i}].price 必須 > 0`);
    if (!isStr(it.type)) add(`SHOP_ITEMS[${i}].type 必須是非空字串`);
    if (!isStr(it.name)) add(`SHOP_ITEMS[${i}].name 必須是非空字串`);
  });
  (T.MAP_EVENTS || []).forEach((ev, i) => {
    if (!isStr(ev.name)) add(`MAP_EVENTS[${i}].name 必須是非空字串`);
    if (!isNum(ev.duration) || ev.duration <= 0) add(`MAP_EVENTS[${i}].duration 必須 > 0`);
  });
  Object.entries(T.POWER_UPS || {}).forEach(([k, v]) => {
    ['name', 'color', 'icon'].forEach((f) => { if (!isStr(v[f])) add(`POWER_UPS.${k}.${f} 必須是非空字串`); });
  });

  // ── ELITE_PREFIXES / DIRECTOR_EVENTS ──
  Object.entries(T.ELITE_PREFIXES || {}).forEach(([k, v]) => {
    ['name', 'color'].forEach((f) => { if (!isStr(v[f])) add(`ELITE_PREFIXES.${k}.${f} 必須是非空字串`); });
  });
  Object.entries(T.DIRECTOR_EVENTS || {}).forEach(([k, ev]) => {
    if (!isStr(ev.name)) add(`DIRECTOR_EVENTS.${k}.name 必須是非空字串`);
    if (typeof ev.activate !== 'function') { add(`DIRECTOR_EVENTS.${k} 缺少 activate()`); return; }
    // 空實作（airdrop 曾經就是 `activate() { }`，玩家看到「空投來了」卻什麼都沒發生）
    const body = ev.activate.toString().replace(/^[^{]*\{/, '').replace(/\}\s*$/, '').trim();
    if (body.length === 0) add(`DIRECTOR_EVENTS.${k}.activate() 是空實作（事件不會有任何效果）`);
  });

  return p;
}

/**
 * 可達性規則：資料裡宣告的每個「選項」都必須在遊戲程式碼裡被處理。
 * 這一條抓的是拼字錯誤與死路徑（'SUMMON' vs 'SUMMONER'、特殊敵人 AI 永遠不生成…）。
 * @param {object} T 資料表
 * @param {string} gameSource index.html + src/ 的程式碼全文（不含資料檔本身）
 */
export function validateReachability(T, gameSource) {
  const p = [];
  const has = (needle) => gameSource.includes(needle);

  Object.keys(T.ELITE_PREFIXES).forEach((k) => {
    if (!has(`'${k}'`) && !has(`"${k}"`)) p.push(`ELITE_PREFIXES.${k} 在程式碼裡沒有任何處理（宣告了卻不會生效）`);
  });
  (T.MAP_EVENTS || []).forEach((ev) => {
    if (!has(`'${ev.id}'`)) p.push(`MAP_EVENTS.${ev.id} 沒有對應的處理分支`);
  });
  // Director 事件是「整張表隨機抽」的（Object.keys(DIRECTOR_EVENTS)），所以檢查的是
  // 「這張表有沒有被迭代使用」，而不是每個名字都要在程式碼裡出現。
  if (Object.keys(T.DIRECTOR_EVENTS).length > 0 && !has('DIRECTOR_EVENTS')) {
    p.push('DIRECTOR_EVENTS 沒有任何地方使用（事件永遠不會發生）');
  }
  (T.SHOP_ITEMS || []).forEach((it) => {
    if (!has(`'${it.type}'`)) p.push(`SHOP_ITEMS 的 type='${it.type}' 沒有購買處理分支`);
  });
  (T.ACTIVE_SKILLS || []).forEach((s) => {
    if (!has(s.id)) p.push(`ACTIVE_SKILLS.${s.id} 沒有實作`);
  });
  (T.PASSIVE_SKILLS || []).forEach((s) => {
    if (!has(s.id)) p.push(`PASSIVE_SKILLS.${s.id} 沒有實作`);
  });
  // 道具的「產生路徑」可以是程式碼直接生成，也可以是出現在掉落池（COMMON_DROPS / WEAPON_DROPS_*）
  const dropPools = [T.COMMON_DROPS, T.WEAPON_DROPS_T1, T.WEAPON_DROPS_T2].filter(Array.isArray).flat();
  (T.POWER_UPS ? Object.keys(T.POWER_UPS) : []).forEach((k) => {
    if (!has(`'${k}'`) && !dropPools.includes(k)) {
      p.push(`POWER_UPS.${k} 沒有任何地方會產生它（不在程式碼也不在掉落池）`);
    }
  });
  // 特殊敵人：每個型別都要有 AI 處理分支，而且整組必須真的被生成端用到
  // （舊版五種型別都有 AI，但生成端只會生 NORMAL/FAST/HEAVY/SUICIDE → 全部是死碼）。
  const specials = Array.from(T.SPECIAL_ENEMY_TYPES || []);
  if (specials.length && !has('SPECIAL_ENEMY_TYPES')) {
    p.push('SPECIAL_ENEMY_TYPES 沒有任何生成端使用（五種特殊敵人永遠不會出現）');
  }
  specials.forEach((type) => {
    if (!has(`'${type}'`)) p.push(`SPECIAL_ENEMY_TYPES 的 ${type} 沒有 AI 處理分支`);
  });
  return p;
}
