// Replay 測試（M2 的閘門）：把「玩一局」變成 CI 能跑的事。
//
//   node tools/verify-replay.mjs              # 驗證（CI 用）
//   node tools/verify-replay.mjs --record     # 重新錄製 tools/replays/*.json
//
// 原理：整局的隨機都走 `src/core/rng.js` 的 seeded 產生器，而 `?sim` 模式讓 update() 只由
// `__T.stepTicks()` 推進（不受真實時間的 rAF 交錯影響）。因此「seed + 輸入序列」就唯一決定結果，
// 把結果壓成 `__T.gameChecksum()` 之後就能比對。
//
// 檢查：
//   R1 同一份 replay 跑兩次 → checksum 相同（確定性）
//   R2 重播結果與檔案中記錄的 checksum 相同（回歸：玩法被改動就會紅）
//   R3 不同 seed → 不同 checksum（seed 真的有作用）
//   R4 同 seed、不同輸入 → 不同 checksum（輸入真的有作用，否則 replay 是假的）
//   R5 遊戲程式碼中沒有 Math.random()（唯一隨機來源是 rnd）
//   R6 沒有區域變數與全域 rnd 同名（會 TDZ；這一輪實際踩到 const rnd = rnd()）
//
// 離開碼 1 表示有案例失敗。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { extname } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPLAY_DIR = join(ROOT, 'tools', 'replays');
const RECORD = process.argv.includes('--record');
const PORT = Number(process.env.PROBE_PORT || 8961);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

let passed = 0, failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++; else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

// ── 輸入腳本：固定節奏的移動 + 射擊（replay 只記事件，不記時間）──
export function scriptedInput(tick) {
  const dirs = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  const dir = dirs[Math.floor(tick / 7) % 4];
  return { [dir]: true, ...(tick % 3 === 0 ? { Space: true } : {}) };
}

const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, rel === '/' ? '/index.html' : rel);
  if (!file.startsWith(ROOT) || !existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let pw;
try {
  pw = (await import(process.env.PW_MODULE || 'playwright')).default;
} catch {
  console.error('找不到 playwright。');
  process.exit(2);
}
const browser = await pw.chromium.launch();

/** 以指定的 seed 與輸入腳本跑 ticks 個 tick，回傳 checksum（全部在同一個同步迴圈內完成）。 */
async function runReplay({ seed, ticks, events }) {
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
  await page.goto(`http://127.0.0.1:${PORT}/index.html?bot&sim&seed=${encodeURIComponent(seed)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__T && window.__T.G, undefined, { timeout: 20000 });
  await page.getByRole('button', { name: 'START GAME' }).click();
  await page.waitForTimeout(300);
  const result = await page.evaluate(({ ticks, events }) => {
    const T = window.__T, G = T.G;
    G.state = T.STATE.PLAYING;
    const byTick = new Map();
    for (const ev of events || []) {
      if (!byTick.has(ev.tick)) byTick.set(ev.tick, []);
      byTick.get(ev.tick).push(ev);
    }
    // 派發真正的鍵盤事件，而不是直接寫 G.keys —— 這樣才會走過平台層的輸入路徑
    // （keydown/keyup 監聽 → applyKey → intent → 移動）。M3 抽出輸入層時，舊寫法
    // 因為遊戲已改讀 intent 而失去作用，R2 就是這樣抓到介面不一致的。
    for (let i = 0; i < ticks; i++) {
      for (const ev of byTick.get(i) || []) {
        // 注意要派在 document：監聽器掛在 document，派在 window 不會往下傳
        document.dispatchEvent(new KeyboardEvent(ev.down ? 'keydown' : 'keyup', { code: ev.code, bubbles: true }));
      }
      T.stepTicks(1);
    }
    return { checksum: T.gameChecksum(), frames: G.frameCount, score: G.score, level: G.level,
      deterministic: T.deterministic, seed: T.seed };
  }, { ticks, events });
  await page.close();
  return { ...result, errors };
}

/** 由腳本產生一份 replay（events 只在按下與放開時記錄，減少檔案大小）。 */
function buildReplay(seed, ticks) {
  const events = [];
  let held = {};
  for (let tick = 0; tick < ticks; tick++) {
    const wanted = scriptedInput(tick);
    for (const code of Object.keys(held)) {
      if (!wanted[code]) { events.push({ tick, code, down: false }); delete held[code]; }
    }
    for (const code of Object.keys(wanted)) {
      if (!held[code]) { events.push({ tick, code, down: true }); held[code] = true; }
    }
  }
  for (const code of Object.keys(held)) events.push({ tick: ticks, code, down: false });
  return { seed, ticks, events, note: 'M2 replay：seed + 輸入序列 → checksum' };
}

mkdirSync(REPLAY_DIR, { recursive: true });
const REPLAY_FILE = join(REPLAY_DIR, 'smoke.json');
const SPEC = { seed: 'smoke', ticks: 1800 };     // 30 秒模擬

console.log('=== 錄製／載入 replay ===');
let replay;
if (RECORD || !existsSync(REPLAY_FILE)) {
  replay = buildReplay(SPEC.seed, SPEC.ticks);
  const first = await runReplay(replay);
  replay.checksum = first.checksum;
  replay.recordedAt = new Date().toISOString();
  writeFileSync(REPLAY_FILE, JSON.stringify(replay, null, 1) + '\n');
  console.log(`${RECORD ? '已重新錄製' : '首次建立'} tools/replays/smoke.json（${replay.ticks} ticks、checksum ${replay.checksum}）`);
} else {
  replay = JSON.parse(readFileSync(REPLAY_FILE, 'utf8'));
  console.log(`載入 tools/replays/smoke.json（${replay.ticks} ticks、checksum ${replay.checksum}）`);
}

console.log('\n=== R. 確定性與回放 ===');
const runA = await runReplay(replay);
ok('R0 replay 以 ?sim 模式執行（update 只由 stepTicks 推進）', runA.deterministic === true,
  `deterministic=${runA.deterministic}`);
ok('R1 同一份 replay 跑兩次 checksum 相同（沒有隱藏的隨機或時間依賴）',
  runA.checksum === (await runReplay(replay)).checksum,
  `checksum ${runA.checksum}`);
ok('R2 重播結果與檔案記錄一致（玩法改動會讓這條紅）',
  runA.checksum === replay.checksum,
  `實跑 ${runA.checksum} vs 檔案 ${replay.checksum}`);
ok('R3 換 seed 會得到不同結果（seed 真的有驅動隨機）',
  (await runReplay({ ...replay, seed: 'other' })).checksum !== runA.checksum);
ok('R4 同 seed、不同輸入會得到不同結果（輸入真的有影響）',
  (await runReplay({ ...replay, events: buildReplay('smoke', replay.ticks).events.map((e, i) => (i % 3 === 0 ? { ...e, down: true } : e)) })).checksum !== runA.checksum);
ok('R5 replay 期間沒有未捕捉例外', runA.errors.length === 0, runA.errors.slice(0, 2).join(' | ') || '0 筆');
ok('R6 這局真的有推進（frameCount、分數有變化，不是空跑）',
  runA.frames >= replay.ticks && runA.level >= 1, JSON.stringify({ frames: runA.frames, score: runA.score, level: runA.level }));

console.log('\n=== S. 原始碼層級的隨機來源 ===');
const gameSource = readFileSync(join(ROOT, 'index.html'), 'utf8');
const dataSources = ['config', 'weapons', 'upgrades', 'pickups', 'enemies', 'shop', 'events', 'schema']
  .map((f) => readFileSync(join(ROOT, 'src', 'data', `${f}.js`), 'utf8')).join('\n');
const rngSource = readFileSync(join(ROOT, 'src', 'core', 'rng.js'), 'utf8');
const mathRandomInGame = (gameSource.match(/Math\.random\(/g) || []).length;
const mathRandomInData = (dataSources.match(/Math\.random\(/g) || []).length;
ok('S1 遊戲程式碼沒有直接呼叫 Math.random()（唯一隨機來源是 seed 產生器）',
  mathRandomInGame === 0, `index.html 內 ${mathRandomInGame} 處`);
ok('S2 資料層沒有呼叫 Math.random()（資料是純值）',
  mathRandomInData === 0, `src/data 內 ${mathRandomInData} 處`);
const shadowed = (gameSource.match(/const\s+rnd\s*=\s*rnd\(\)/g) || []).length;
ok('S3 沒有與全域 rnd 同名的區域變數（會 TDZ：Cannot access rnd before initialization）',
  shadowed === 0, `${shadowed} 處`);
ok('S4 rng.js 提供 state 讀寫（replay 可從中斷點續跑）',
  /next\.state\s*=/.test(rngSource) && /next\.setState\s*=/.test(rngSource));

console.log('\n=== T. 時效欄位：宣告的計時器必須有遞減端 ===');
// 這一類 bug 修過兩次：barrierTimer 永不遞減（拿了 BARRIER 就整局無敵）、
// laserLife 只寫不讀（每次射擊遺留 29 顆永生子彈）。共同特徵是「有寫入、沒有遞減」。
{
  const fields = new Set();
  for (const m of gameSource.matchAll(/\.([A-Za-z_][A-Za-z0-9_]*Timer)\s*=[^=]/g)) fields.add(m[1]);
  for (const m of gameSource.matchAll(/\.(\w*[Ll]ife)\s*=\s*\d/g)) fields.add(m[1]);
  fields.delete('maxLife');       // maxLife 是分母／常數（life / maxLife），不是計時器
  const neverTicked = [];
  for (const field of fields) {
    const tickPatterns = [
      new RegExp(`${field}\\s*--`),                      // fooTimer--
      new RegExp(`${field}\\s*-=\\s*1`),                 // fooTimer -= 1
      new RegExp(`${field}\\s*=\\s*Math\\.max\\(0,\\s*${field}\\s*-`),  // foo = Math.max(0, foo - 1)
      new RegExp(`--\\s*${field}`),                      // --fooTimer
      new RegExp(`${field}\\s*<=\\s*0`),                 // 以「到期」判定（例如 life <= 0 → alive = false）
      new RegExp(`${field}\\s*>\\s*0\\s*&&`),           // 有守衛（遞減寫在守衛內）
      new RegExp(`${field}\\s*\\+=\\s*1`),               // 計數型：fooTimer += 1（累加到門檻才做事）
      new RegExp(`${field}\\s*\\+\\+|\\+\\+\\s*${field}`),   // 計數型：fooTimer++ / ++fooTimer
      new RegExp(`${field}\\s*=\\s*\\(\\s*[\\w.]*${field}\\s*\\|\\|\\s*0\\s*\\)\\s*\\+\\s*1`),   // 惰性初始化計數：x.fooTimer = (x.fooTimer || 0) + 1
    ];
    if (!tickPatterns.some((re) => re.test(gameSource))) neverTicked.push(field);
  }
  ok(`所有 ${fields.size} 個計時／壽命欄位都有遞減或到期判定（沒有「寫了卻不會前進」的計時器）`,
    neverTicked.length === 0,
    neverTicked.length ? `沒有遞減端：${neverTicked.join('、')}` : '0 個孤兒計時器');
}

console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
