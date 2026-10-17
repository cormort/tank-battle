// 效能量測工具（真實 Chromium，headless）。
//
// 為什麼需要它：`tools/verify-game.mjs` 的效能檢查只看「有沒有做某個最佳化」（API 呼叫次數、
// 快取是否命中），量不到「一幀到底花多少毫秒、花在哪裡」。而 headless 的 requestAnimationFrame
// 完全不可靠 —— 實測一台機器上空頁面跑 rAF + 一次 fillRect 只有 8.8 fps，遊戲看起來像掉到
// 8 fps，其實是環境問題。所以這裡**不用 rAF 量時間**，改成同步呼叫 `__T.update()`／`__T.render()`
// 並用 performance.now() 計時，把「模擬」與「繪製」的成本分開。
//
//   node tools/profile.mjs                # 量三種負載，印出表格
//   node tools/profile.mjs --json         # 只印 JSON（餵給其他工具／前後對比）
//   node tools/profile.mjs --cpu          # 額外抓 CPU profile 的 hot functions（self time）
//   node tools/profile.mjs --save tools/perf-baseline.json   # 存基準，之後用 --compare 比
//   node tools/profile.mjs --compare tools/perf-baseline.json
//   PW_MODULE=/path/to/playwright/index.js node tools/profile.mjs
//
// 注意：headless Chromium 的 2D canvas 走 SwiftShader（軟體光柵），絕對數字比真機悲觀，
// 但同一台機器上的前後差異是可比較的 —— 這個工具是用來做 A／B 的，不是用來宣稱實機 FPS。

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PROBE_PORT || 8971);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };

// 三種負載：正常關卡、VS 割草（最多 18 隻 + 到處是子彈）、超載（壓力測試）
const SCENARIOS = {
  normal: { enemies: 4, bullets: 12, particles: 40, ticks: 240, frames: 15 },
  vs:     { enemies: 18, bullets: 120, particles: 400, ticks: 240, frames: 15 },
  stress: { enemies: 48, bullets: 320, particles: 800, ticks: 120, frames: 10 },
};

const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, normalize(rel === '/' ? '/index.html' : rel));
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let pw;
try {
  pw = (await import(process.env.PW_MODULE || 'playwright')).default;
} catch {
  console.error('找不到 playwright。請先：npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const browser = await pw.chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));

// ?sim：update 只由我們呼叫（rAF 不會偷跑），量到的每一個 tick 都是我們自己的
await page.goto(`http://127.0.0.1:${PORT}/index.html?bot&mute&sim&seed=7`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__T && window.__T.G, undefined, { timeout: 30000 });
await page.getByRole('button', { name: 'START GAME' }).click();
await page.waitForTimeout(300);

// 在頁面裡建立負載場景。每一次量測前都重建，讓前後兩次的起點一致。
async function setupScene(kind, opts) {
  return page.evaluate(({ kind, opts }) => {
    const T = window.__T, G = T.G;
    G.state = T.STATE.PLAYING;
    G.baseDestroyed = false;
    G.isVSMode = kind !== 'normal';
    G.maxEnemies = 1e9; G.enemiesSpawned = 0;
    G.enemies.length = 0; G.aliveEnemies = 0;
    T.bulletsPool.clear(); T.particlesPool.clear();
    G.summonEntities.length = 0; G.directorEvents.length = 0;
    G.powerUps.length = 0; G.scorePopups.length = 0; G.spawnEffects.length = 0;

    // 玩家：長效無敵，避免被亂流打死讓場景自己收掉
    G.playerStats.hp = 9999; G.playerStats.maxHp = 9999;
    G.player.hp = 9999; G.player.alive = true;
    T.fx.set('invul', 1e9);

    const types = ['NORMAL', 'FAST', 'HEAVY', 'SUICIDE'];
    const cols = 6;
    for (let i = 0; i < opts.enemies; i++) {
      const x = T.TILE * 2 + (i % cols) * T.TILE * 1.6;
      const y = T.TILE * 2 + Math.floor(i / cols) * T.TILE * 1.6;
      const e = new T.Tank(x, y, T.DOWN, types[i % types.length], false);
      e.hp = e.maxHp = 50;
      e.aiChangeTimer = 1e9;                 // 不要每 30 tick 重新擲骰，讓場景穩定
      G.enemies.push(e);
    }
    G.aliveEnemies = G.enemies.length;

    for (let i = 0; i < opts.bullets; i++) {
      const x = T.TILE + (i * 37) % (T.W - T.TILE * 2);
      const y = T.TILE + (i * 53) % (T.H - T.TILE * 2);
      T.spawnBullet(x, y, i % 2 ? T.DOWN : T.RIGHT, i % 3 !== 0, false, 1);
    }

    for (let i = 0; i < opts.particles; i++) {
      const p = T.particlesPool.acquire();
      p.type = i % 2 ? 'spark' : 'smoke';
      p.x = (i * 17) % T.W; p.y = (i * 29) % T.H;
      p.vx = (i % 5) - 2; p.vy = (i % 7) - 3;
      p.life = p.maxLife = 60 + (i % 30);
      p.size = 2 + (i % 4); p.color = i % 3 ? '#ffaa00' : '#5cd8ff';
    }
    return { enemies: G.enemies.length, bullets: T.bulletsPool.active.length, particles: T.particlesPool.active.length };
  }, { kind, opts });
}

// 一次量測：先重建場景，再同步跑 N 個 update
async function measure(kind) {
  const opts = SCENARIOS[kind];
  await setupScene(kind, opts);
  return page.evaluate(({ opts }) => {
    const T = window.__T;
    const now = () => performance.now();
    const t0 = now();
    for (let i = 0; i < opts.ticks; i++) T.update();
    const updateMs = (now() - t0) / opts.ticks;
    return { updateMs: +updateMs.toFixed(3) };
  }, { opts });
}

// 繪製成本要分兩段量，因為 2D canvas 的填色是「記錄命令 → 光柵化」兩段：
//   issue = 呼叫 canvas API 的 JS 成本（跟真機無關的部分）
//   paint = getImageData 逼出光柵化的成本（軟體光柵下能反映「填了多少像素」）
// 單次 getImageData 有一次性配置成本，所以跑三輪取最小值。
async function measureRender(kind) {
  const opts = SCENARIOS[kind];
  await setupScene(kind, opts);
  return page.evaluate(({ opts }) => {
    const T = window.__T;
    const now = () => performance.now();
    let bestIssue = Infinity, bestPaint = Infinity, bestTotal = Infinity;
    for (let round = 0; round < 3; round++) {
      const t0 = now();
      for (let i = 0; i < opts.frames; i++) T.render();
      const t1 = now();
      T.ctx.getImageData(0, 0, 1, 1);          // 逼光柵化完成
      const t2 = now();
      bestIssue = Math.min(bestIssue, (t1 - t0) / opts.frames);
      bestPaint = Math.min(bestPaint, (t2 - t1) / opts.frames);
      bestTotal = Math.min(bestTotal, (t2 - t0) / opts.frames);
    }
    return {
      renderMs: +bestIssue.toFixed(3),
      paintMs: +bestPaint.toFixed(3),
      frameMs: +bestTotal.toFixed(3),
    };
  }, { opts });
}

// 繪製 API 呼叫次數：找出「畫一次畫面到底發了幾道命令」
async function countDrawCalls(kind) {
  const opts = SCENARIOS[kind];
  await setupScene(kind, opts);
  return page.evaluate(() => {
    const T = window.__T;
    const c = T.ctx;
    const counts = { fillRect: 0, drawImage: 0, fillText: 0, save: 0, restore: 0, fillStyle: 0, beginPath: 0, arc: 0, stroke: 0 };
    const patches = {};
    for (const name of ['fillRect', 'drawImage', 'fillText', 'save', 'restore', 'beginPath', 'arc', 'stroke']) {
      patches[name] = c[name];
      c[name] = function (...a) { counts[name]++; return patches[name].apply(c, a); };
    }
    const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'fillStyle');
    Object.defineProperty(c, 'fillStyle', {
      set(v) { counts.fillStyle++; desc.set.call(c, v); }, get() { return desc.get.call(c); }, configurable: true,
    });
    T.render();
    for (const name of Object.keys(patches)) c[name] = patches[name];
    Object.defineProperty(c, 'fillStyle', desc);
    return counts;
  });
}

const results = {};
for (const kind of Object.keys(SCENARIOS)) {
  const upd = await measure(kind);
  const ren = await measureRender(kind);
  const calls = await countDrawCalls(kind);
  results[kind] = { ...upd, ...ren, calls };
}

// CPU profile：抓 JS 層的 hot function（self time）。CPU_SCENE 可換負載（預設 stress）
const cpuScene = process.env.CPU_SCENE || 'stress';
let hot = null;
if (flag('--cpu')) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 });
  const cpuKind = cpuScene;
  await setupScene(cpuKind, SCENARIOS[cpuKind]);
  await cdp.send('Profiler.start');
  await page.evaluate(({ opts }) => {
    const T = window.__T;
    for (let round = 0; round < 8; round++) {
      for (let i = 0; i < opts.ticks; i++) T.update();
      for (let i = 0; i < opts.frames; i++) T.render();
    }
  }, { opts: SCENARIOS[cpuKind] });
  const { profile } = await cdp.send('Profiler.stop');
  // 自己的時間（self time）= 節點的 hitCount × 取樣間隔
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (const s of profile.samples || []) {
    const n = byId.get(s);
    if (!n) continue;
    const f = n.callFrame;
    const name = `${f.functionName || '(anonymous)'} ${f.url.split('/').pop() || ''}:${f.lineNumber + 1}`;
    self.set(name, (self.get(name) || 0) + 1);
  }
  const total = (profile.samples || []).length || 1;
  hot = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .map(([name, hits]) => ({ name, pct: +((hits / total) * 100).toFixed(1) }));
}

await browser.close();
server.close();

if (pageErrors.length) console.error('⚠️ 執行期例外：', pageErrors.slice(0, 3).join(' | '));

const comparePath = opt('--compare');
if (flag('--json')) {
  console.log(JSON.stringify({ results, hot }, null, 2));
} else {
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n負載        update/tick   issue/幀    paint/幀    幀總計   fillRect  drawImage  fillStyle');
  for (const [kind, r] of Object.entries(results)) {
    console.log(`${pad(kind, 12)}${pad(r.updateMs, 14)}${pad(r.renderMs, 12)}${pad(r.paintMs, 12)}${pad(r.frameMs, 9)}${pad(r.calls.fillRect, 10)}${pad(r.calls.drawImage, 11)}${r.calls.fillStyle}`);
  }
  if (hot) {
    console.log(`\nCPU hot（self time，${cpuScene} 場景，update + render 各 8 輪）：`);
    for (const h of hot) console.log(`  ${pad(h.pct + '%', 8)}${h.name}`);
  }
  console.log('\n（headless 走 SwiftShader，絕對值比真機悲觀；同一台機器上的前後差異才是重點）');
}

if (flag('--save')) {
  const target = opt('--save');
  const file = isAbsolute(target) ? target : join(ROOT, target);
  await writeFile(file, JSON.stringify({ at: new Date().toISOString(), results }, null, 2) + '\n');
  console.log(`已存基準：${file}`);
}

if (comparePath) {
  const base = JSON.parse(await readFile(isAbsolute(comparePath) ? comparePath : join(ROOT, comparePath), 'utf8'));
  console.log(`\n與 ${comparePath} 比較（負值＝變快）：`);
  for (const kind of Object.keys(SCENARIOS)) {
    const b = base.results?.[kind], c = results[kind];
    if (!b || !c) continue;
    const d = (x, y) => `${y >= x ? '+' : ''}${(((y - x) / x) * 100).toFixed(1)}%`;
    console.log(`  ${kind.padEnd(10)} update ${d(b.updateMs, c.updateMs)}  frame ${d(b.frameMs ?? b.renderMs, c.frameMs)}  fillRect ${b.calls.fillRect}→${c.calls.fillRect}  drawImage ${b.calls.drawImage}→${c.calls.drawImage}  fillStyle ${b.calls.fillStyle}→${c.calls.fillStyle}`);
  }
}
