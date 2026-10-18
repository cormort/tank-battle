// 武器 DPS 帳（武器系統的唯一量化來源）。
//
//   node tools/weapon-dps.mjs             # 印表 + 閘門
//   node tools/weapon-dps.mjs --json      # 只印 JSON（給其他工具吃）
//   node tools/weapon-dps.mjs --no-gate   # 只印表，不因超標而失敗
//
// 為什麼要有這支：武器的「傷害」在兩個地方各寫一次（WEAPON_TREE.basePower 與
// WEAPON_REGISTRY.power），實際傷害是兩者相乘，再加上每把槍的 count／fireRate／
// 命中分裂／召喚物／轟炸。只看資料表看不出強弱，於是實際 DPS 可以差到 11 倍
// （OVERDRIVE 90 vs FORTRESS 8）卻沒有人發現——玩家只會覺得「D 路線是廢的」。
//
// 這支工具把「玩家實際感受到的每秒傷害」算成三欄，並用四條規則當閘門：
//   1. 同一條路線逐階成長 ≥125%（升階要馬上有感）
//   2. 同一階的跨路線差距 ≤1.35 倍（四條路線都要玩得下去）
//   3. 起始武器 (NORMAL) 必須弱於每一把入門武器
//   4. 沒有任何一把武器的群聚值超過同階最強的 1.8 倍（避免純濺射主宰）
//
// 模型刻意保守且可解釋：
//   fireRate  = 每幾 tick 打一發（60 tick = 1 秒）
//   single    = 場上只有一個目標時，一秒有多少傷害真的落在它身上
//   clump     = 目標群聚時（散射全中、分裂彈全中、貫穿串線）
//   value     = 0.6×single + 0.4×clump ← 閘門用的「綜合強度」
//   砲塔只有 200px 內有敵人時才開火，所以乘 0.6 效率係數。

import { WEAPON_REGISTRY, WEAPON_TREE } from '../src/data/weapons.js';

const TICK_PER_SEC = 60;
const TIER_LABEL = ['起始', '入門', '強化', '終形'];
const CLUMP_IN_LINE = 2;        // 貫穿子彈在群聚時串到幾隻
const CLUMP_BEAM = 3;           // 光束一次掃一整條線
const TURRET_ACCURACY = 0.6;    // 砲塔只有 200px 內有敵人才開火

const reg = WEAPON_REGISTRY;
const tree = WEAPON_TREE;

/** 每秒砲塔傷害（參數來自 WEAPON_REGISTRY[key].turret） */
function turretDps(key) {
  const r = reg[key];
  if (!r || r.effect !== 'SPAWN_TURRET' || !r.turret) return 0;
  const { count, damage, cooldown } = r.turret;
  return (count * damage / cooldown) * TICK_PER_SEC * TURRET_ACCURACY;
}

export function weaponDps(key) {
  const r = reg[key];
  if (!r) return null;
  const t = tree[key] || null;
  const dmg = r.power;                           // ＝ WeaponManager.fire() 的 finalPower
  const cd = Math.max(2, r.fireRate);            // ＝ actualCD（無任何加成時）
  const shotsPerSec = TICK_PER_SEC / cd;

  let singleShot = 0;   // 一輪射擊對「單一目標」的有效傷害
  let clumpShot = 0;    // 一輪射擊對「群聚目標」的總傷害
  const notes = [];

  if (r.spread > 0) {
    // 扇形：單體只有中間那發（外加一點命中率），群聚時全中
    singleShot = dmg * (1 + (r.spread < 0.3 ? 0.5 : 0));
    clumpShot = dmg * r.count;
  } else {
    singleShot = dmg * r.count;
    clumpShot = dmg * r.count;
  }

  // 貫穿：群聚時串線（光束掃一整條線，一般貫穿子彈串兩隻）
  if (r.effect === 'LASER_BEAM') clumpShot = singleShot * CLUMP_BEAM;
  else if (r.effect === 'PIERCE') clumpShot = singleShot * CLUMP_IN_LINE;

  // CLUSTER：命中分裂 5 發 × 0.5（分裂彈對同一目標再判一次）
  if (key === 'CLUSTER') {
    singleShot += r.count * dmg * 0.5;
    clumpShot += r.count * dmg * 0.5 * 2;
    notes.push('分裂5×0.5');
  }

  // BOMBARD：每 180 tick 20 個落點
  let bombard = 0;
  if (r.effect === 'BOMBARD') {
    bombard = (dmg * 0.8 * 20) / 3;
    notes.push('+轟炸');
  }

  const turret = turretDps(key);
  if (turret) notes.push('+砲塔');

  const single = shotsPerSec * singleShot + bombard + turret;
  const clump = shotsPerSec * clumpShot + bombard * 2 + turret;
  const value = 0.6 * single + 0.4 * clump;

  return {
    key,
    name: t ? t.name : '普通砲',
    route: t ? t.route : '-',
    tier: t ? t.tier : 0,
    tierLabel: TIER_LABEL[t ? t.tier : 0],
    weaponDamage: +dmg.toFixed(3),
    cd,
    count: r.count,
    shotsPerSec: +shotsPerSec.toFixed(2),
    singleDps: +single.toFixed(2),
    clumpDps: +clump.toFixed(2),
    value: +value.toFixed(2),
    notes: notes.join(' '),
  };
}

export function dpsTable() {
  const order = { '-': 0, A: 1, B: 2, C: 3, D: 4 };
  return Object.keys(reg)
    .map(weaponDps)
    .filter(Boolean)
    .sort((a, b) => (order[a.route] - order[b.route]) || (a.tier - b.tier));
}

// ── 閘門 ────────────────────────────────────────────────
export function checkTable(rows = dpsTable()) {
  const fails = [];
  const byRoute = new Map();
  const byTier = new Map();
  for (const r of rows) {
    if (r.route === '-') continue;
    if (!byRoute.has(r.route)) byRoute.set(r.route, []);
    byRoute.get(r.route).push(r);
    if (!byTier.has(r.tier)) byTier.set(r.tier, []);
    byTier.get(r.tier).push(r);
  }

  // 1. 同路線遞增 ≥125%
  for (const [route, list] of byRoute) {
    list.sort((a, b) => a.tier - b.tier);
    for (let i = 1; i < list.length; i++) {
      const ratio = list[i].value / list[i - 1].value;
      if (ratio < 1.25) {
        fails.push(`路線 ${route}：${list[i - 1].key} → ${list[i].key} 只成長 ${(ratio * 100).toFixed(0)}%（需 ≥125%）`);
      }
    }
  }

  // 2. 同階跨路線 ≤1.35×
  for (const [tier, list] of byTier) {
    const vals = list.map((r) => r.value);
    const ratio = Math.max(...vals) / Math.min(...vals);
    if (ratio > 1.35) {
      const hi = list.find((r) => r.value === Math.max(...vals));
      const lo = list.find((r) => r.value === Math.min(...vals));
      fails.push(`第 ${tier} 階：${hi.key}(${hi.value}) / ${lo.key}(${lo.value}) = ${ratio.toFixed(2)}×（需 ≤1.35×）`);
    }
  }

  // 3. 起始武器最弱
  const normal = rows.find((r) => r.key === 'NORMAL');
  if (normal) {
    for (const r of rows) {
      if (r.tier === 1 && r.value <= normal.value) {
        fails.push(`${r.key}(${r.value}) 沒有比起始武器 NORMAL(${normal.value}) 強`);
      }
    }
  }

  // 4. 群聚值不得離群（純濺射主宰）
  for (const [tier, list] of byTier) {
    const maxValue = Math.max(...list.map((r) => r.value));
    for (const r of list) {
      if (r.clumpDps > maxValue * 1.8) {
        fails.push(`${r.key} 群聚 ${r.clumpDps} 超過第 ${tier} 階基準 ${maxValue} 的 1.8 倍`);
      }
    }
  }

  return fails;
}

// ── CLI ────────────────────────────────────────────────
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const rows = dpsTable();
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    const num = (v, n = 7) => String(v).padStart(n);
    console.log(`${pad('武器', 13)}${pad('路線', 4)}${pad('階', 6)}${num('傷害')}${num('間隔')}${num('發數')}${num('單體/s', 9)}${num('群聚/s', 9)}${num('綜合', 8)}  備註`);
    for (const r of rows) {
      console.log(`${pad(r.key, 13)}${pad(r.route, 4)}${pad(r.tierLabel, 6)}${num(r.weaponDamage)}${num(r.cd)}${num(r.count)}${num(r.singleDps, 9)}${num(r.clumpDps, 9)}${num(r.value, 8)}  ${r.notes}`);
    }
    const fails = checkTable(rows);
    if (process.argv.includes('--no-gate')) {
      console.log(`\n（--no-gate：${fails.length} 條規則未通過）`);
      for (const f of fails) console.log(`  - ${f}`);
    } else if (fails.length) {
      console.log(`\nFAIL  武器曲線（${fails.length} 條）：`);
      for (const f of fails) console.log(`  - ${f}`);
      process.exitCode = 1;
    } else {
      console.log('\nPASS  武器曲線：同路線遞增、同階跨路線 ≤1.35×、起始武器最弱、無濺射主宰');
    }
  }
}
