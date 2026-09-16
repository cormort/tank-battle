// 資料層驗證（M1 的閘門）。純 Node，不需要瀏覽器。
//
//   node tools/verify-data.mjs
//
// 四組檢查：
//   A 等價：src/data 的每一張表都必須與 tools/data-baseline.json（抽離前從 index.html 擷取）
//           逐值相同 —— 這是「抽資料層沒有改到任何數值」的證明。
//   B schema：src/data/schema.js 的必填欄位、型別、id 對應、進化鏈完整性。
//   C 可達性：資料裡宣告的每個選項（詞綴／事件／商店類型／道具／特殊敵人）都要有處理與生成路徑。
//   D 死欄位：資料表裡宣告的每個葉節點，都必須在遊戲程式碼（index.html + src/，不含資料檔本身）
//           有讀取端；沒有讀取端的就是「宣告了卻沒接線」——本輪修掉的 bug 幾乎都屬於這類。
//
// 離開碼 1 表示有案例失敗。

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as DATA from '../src/data/index.js';
import { makeDirectorEvents } from '../src/data/events.js';
import { validateData, validateReachability } from '../src/data/schema.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let passed = 0, failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++; else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

const baseline = JSON.parse(readFileSync(join(ROOT, 'tools/data-baseline.json'), 'utf8'));
// STATE 是程式碼列舉（狀態機的值），不是內容資料，因此留在 index.html；
// 它的行為由 verify-game.mjs 的狀態轉移斷言（playing/paused/levelComplete）涵蓋。
const CODE_ONLY = new Set(['STATE']);
// DIRECTOR_EVENTS 是工廠產物（行為需要注入 ctx）；用 stub ctx 建一份來驗證資料與 schema。
const stubTank = function StubTank() { return { hp: 0, maxHp: 0 }; };
const stubCtx = {
  W: 520, H: 520, TILE: 26, DOWN: 2, Tank: stubTank,
  G: { spawnInterval: 18, directorEvents: [], enemies: [], aliveEnemies: 0 },
};
const tables = Object.fromEntries(Object.entries(baseline).map(([k]) => [k, DATA[k]]));
tables.DIRECTOR_EVENTS = makeDirectorEvents(stubCtx);
tables.SPECIAL_ENEMY_TYPES = Array.from(DATA.SPECIAL_ENEMY_TYPES);

// ── 遊戲程式碼全文（用來找讀取端與可達性；刻意排除資料檔本身）──
function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'data' && dir.endsWith('src')) continue;   // 資料檔自己不算讀取端
      collectSources(full, out);
    } else if (/\.(js|mjs|html)$/.test(entry)) {
      out.push(readFileSync(full, 'utf8'));
    }
  }
  return out;
}
const dataSource = collectSources(join(ROOT, 'src', 'data')).join('\n');
const gameSources = [
  readFileSync(join(ROOT, 'index.html'), 'utf8'),
  ...collectSources(join(ROOT, 'src')).filter((s) => s !== dataSource),
  ...collectSources(join(ROOT, 'tools')).filter((s) => !s.includes('data-baseline')),
].join('\n');
// 死欄位掃描只遮「註解」：字串不遮 —— 只出現在註解裡的欄位名不算讀取端，
// 但出現在字串裡（例如 'SUMMONER' 的比較）確實是讀取。
// （先前版本連字串一起遮，結果引號跨檔案配對，160KB 被吃成 6.5KB → 全部誤判為死欄位。）
const masked = (text) => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');   // 只把真正的行註解去掉（避免吃掉 https:// 之類）
const gameCode = masked(gameSources);

// 抽離後「刻意」的資料修正。每一項都要附理由，而且會被逐欄驗證 ——
// 這樣基準快照仍然抓得到任何非預期的數值漂移。
const INTENTIONAL = {
  ACTIVE_SKILLS: {
    reason: '主動技能 key 由顯示用字母（Q/W/E/R/A/S）改為真正的 KeyboardEvent.code（全部 KeyQ）：'
      + '程式只綁 KeyQ，卻讓每張卡寫不同字母（DASH 寫 [W]），玩家按 W 只會移動。',
    field: 'key',
    expect: (row) => row.key === 'KeyQ',
  },
};

console.log('=== A. 與抽離前的基準逐值等價 ===');
{
  const norm = (v) => JSON.parse(JSON.stringify(v));
  const diffs = [];
  const intentionalHits = [];
  for (const [key, expected] of Object.entries(baseline)) {
    if (CODE_ONLY.has(key)) continue;
    const actual = tables[key];      // tables 已包含工廠產物（DIRECTOR_EVENTS）
    if (actual === undefined) { diffs.push(`${key} 不存在`); continue; }
    const a = JSON.stringify(norm(actual instanceof Set ? Array.from(actual) : actual));
    const b = JSON.stringify(norm(expected));
    if (a === b) continue;

    const intentional = INTENTIONAL[key];
    if (intentional && Array.isArray(actual) && Array.isArray(expected) && actual.length === expected.length) {
      // 只允許指定的欄位不同，且新值必須符合預期
      const others = actual.flatMap((row, i) => Object.keys({ ...row, ...expected[i] })
        .filter((f) => f !== intentional.field)
        .filter((f) => JSON.stringify(norm(row[f])) !== JSON.stringify(norm(expected[i][f]))));
      const okField = actual.every(intentional.expect);
      if (others.length === 0 && okField) { intentionalHits.push(`${key}.${intentional.field}`); continue; }
      diffs.push(`${key} 的刻意差異不符預期（其他欄位變動：${others.slice(0, 4).join('、') || '無'}；新值檢查：${okField}）`);
      continue;
    }
    diffs.push(`${key} 內容不同`);
  }
  const compared = Object.keys(baseline).filter((k) => !CODE_ONLY.has(k));
  const note = intentionalHits.length
    ? `完全一致，另有 ${intentionalHits.length} 項刻意修正（${intentionalHits.join('、')}）`
    : '完全一致';
  ok(`抽離後 ${compared.length} 張表與基準快照逐值相同（共 ${JSON.stringify(baseline).length} 字元）`,
    diffs.length === 0, diffs.length ? diffs.join('、') : note);
  Object.entries(INTENTIONAL).forEach(([table, spec]) => {
    ok(`刻意修正 ${table}.${spec.field} 的理由已記錄且逐列驗證`,
      intentionalHits.includes(`${table}.${spec.field}`), spec.reason.slice(0, 60) + '…');
  });
}

console.log('\n=== B. schema：必填欄位、型別、進度鏈完整性 ===');
{
  const problems = validateData(tables);
  ok('資料表通過 schema 驗證', problems.length === 0,
    problems.length ? problems.slice(0, 6).join('；') + (problems.length > 6 ? ` …（共 ${problems.length} 項）` : '') : '0 項問題');
}

console.log('\n=== C. 可達性：宣告的選項都要有處理與生成路徑 ===');
{
  const problems = validateReachability(tables, gameCode);
  ok('每個詞綴／事件／商店類型／道具／特殊敵人都有對應處理', problems.length === 0,
    problems.length ? problems.slice(0, 6).join('；') + (problems.length > 6 ? ` …（共 ${problems.length} 項）` : '') : '0 項問題');
}

console.log('\n=== D. 死欄位掃描：宣告的每個欄位都要有讀取端 ===');
{
  const leaves = [];
  const walk = (value, path) => {
    if (value === null || typeof value !== 'object') { leaves.push(path); return; }
    if (value instanceof Set) { leaves.push(path); return; }
    if (Array.isArray(value)) {
      // 陣列只看聯集：每個元素的鍵都要有讀取端（值本身不比對）
      const keys = new Set();
      value.forEach((v) => { if (v && typeof v === 'object') Object.keys(v).forEach((k) => keys.add(k)); });
      if (keys.size === 0) { leaves.push(path); return; }
      keys.forEach((k) => walk(value.find((v) => v && typeof v === 'object' && k in v)[k], `${path}[].${k}`));
      return;
    }
    Object.entries(value).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k));
  };
  Object.entries(tables).forEach(([name, value]) => walk(value, name));

  const unread = leaves.filter((path) => {
    const field = path.split('.').pop().replace(/\[\]$/, '');
    if (!field) return false;
    // 讀取端寫法：.field / ['field'] / field: / 'field'（已遮罩字串，所以只剩屬性存取與識別字）
    return !new RegExp(`[.['"]${field}['"]?\\s*[\\]:=)]|\\b${field}\\b`).test(gameCode);
  });
  ok(`資料表的 ${leaves.length} 個葉節點都有讀取端（沒有「宣告了卻沒接線」的欄位）`,
    unread.length === 0,
    unread.length ? `沒有讀取端：${unread.slice(0, 10).join('、')}${unread.length > 10 ? ` …（共 ${unread.length} 個）` : ''}` : '0 個孤兒欄位');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
