// 畫面指紋（render hash）：把「畫出來的每一個像素」壓成一個整數。
//
// 為什麼需要：`tools/verify-replay.mjs` 守住的是**玩法**等價（seed + 輸入 → checksum），
// 但渲染最佳化（批次化、換成離屏快取、少畫一次全螢幕）改的是**像素**，replay 看不出來。
// 有這個工具，才能宣稱「渲染路徑改了、畫面一模一樣」：改之前記一組 hash，改完再跑一次比對。
//
//   node tools/render-hash.mjs            # 印出每個場景的 hash
//   node tools/render-hash.mjs --json     # JSON
//   node tools/render-hash.mjs --save baseline.json     # 存檔
//   node tools/render-hash.mjs --compare baseline.json  # 逐場景比對（不同 → 離開碼 1）
//
// ⚠️ 指紋只保證「同一台機器、同一個 Chromium」上的前後比較。
//    字型（Press Start 2P 走 Google Fonts，載不到就 fallback）與 Skia/SwiftShader 版本
//    都會影響像素，所以刻意不把 hash 寫進版控當 CI 基準 —— 它是 A/B 工具，不是回歸基準。

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PROBE_PORT || 8973);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(ROOT, normalize(rel === '/' ? '/index.html' : rel));
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end('no'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let pw;
try { pw = (await import(process.env.PW_MODULE || 'playwright')).default; }
catch { console.error('找不到 playwright。'); process.exit(2); }

const browser = await pw.chromium.launch();
// deviceScaleFactor 固定 2：順便涵蓋「離屏畫布貼回要指定 W×H」那個高 DPR 路徑
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
await page.goto(`http://127.0.0.1:${PORT}/index.html?bot&mute&sim&seed=7`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__T && window.__T.G, undefined, { timeout: 30000 });
await page.evaluate(async () => { try { await document.fonts.ready; } catch { /* 沒有字型就照樣畫 */ } });
await page.getByRole('button', { name: 'START GAME' }).click();
await page.waitForTimeout(300);

const dumpDir = opt('--dump');
if (dumpDir) { const { mkdir } = await import('node:fs/promises'); await mkdir(dumpDir, { recursive: true }); }

const hashes = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  const scenes = {};

  window.__DUMP = window.__DUMP || {};
  // 把畫面切成 16×16 的區塊各自壓 hash —— 只為了在兩個版本之間定位「哪裡不一樣」
  function blockHashes(img) {
    const { width, height, data } = img, B = 16, out = [];
    for (let by = 0; by < height; by += B) {
      for (let bx = 0; bx < width; bx += B) {
        let h = 2166136261 >>> 0;
        for (let y = by; y < Math.min(by + B, height); y++) {
          for (let x = bx; x < Math.min(bx + B, width); x++) {
            const i = (y * width + x) * 4;
            h ^= data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24);
            h = Math.imul(h, 16777619) >>> 0;
          }
        }
        out.push(h);
      }
    }
    return out;
  }

  function fnv(u32) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < u32.length; i++) { h ^= u32[i]; h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }

  // 固定場景：位置、方向、影格數都寫死，不用亂數 —— 同一份程式碼每次都要得到同一個 hash
  function buildScene(kind) {
    G.state = T.STATE.PLAYING;
    G.isVSMode = kind === 'vs';
    G.maxEnemies = 1e9; G.enemiesSpawned = 0;
    G.enemies.length = 0; G.aliveEnemies = 0;
    T.bulletsPool.clear(); T.particlesPool.clear();
    T.deactivateMapEvent();
    G.summonEntities.length = 0; G.directorEvents.length = 0;
    G.powerUps.length = 0; G.scorePopups.length = 0; G.spawnEffects.length = 0;
    G.shakeTimer = 0; G.shakeIntensity = 0;
    G.frameCount = 1234;                     // 履帶相位、發光呼吸、NIGHT 圖層都吃 frameCount
    T.setRngState(T.seed);                   // 每個場景從同一個亂數種子開始 → 地圖與前一個場景無關
    G.playerStats.combo = 0; G.playerStats.hp = 3; G.playerStats.maxHp = 3;

    G.map = T.generateMap(kind === 'normal' ? 1 : 10);
    G.player = new T.Tank(T.TILE * 5, T.TILE * 5, T.RIGHT, 'NORMAL', true);
    G.player.alive = true; G.player.flashTimer = 0; G.player.moving = true;
    G.player.x = T.TILE * 5 + 3; G.player.y = T.TILE * 6;

    // BOSS 原型（第 5／10 關）：讓 BOSS 的外框、圖示、砲彈、蓄力圈都進到指紋裡
    if (kind === 'boss' || kind === 'boss_charge') {
      G.level = kind === 'boss' ? 5 : 10;
      const arch = T.BOSS_TYPES[kind === 'boss' ? 'SIEGE' : 'HUNTER'];
      const b = new T.Tank(T.TILE * 3, T.TILE * 3, T.DOWN, 'BOSS', false);
      b.hp = b.maxHp = 40;
      b.patternTimer = kind === 'boss' ? 10 : Math.floor(arch.chargeWindup * 0.6);   // 讓蓄力圈畫得出來
      G.enemies.push(b);
      if (kind === 'boss') {
        // 一顆正在飛的砲彈（攻城核心的視覺：10×10、橘紅、引信閃爍）
        const sh = T.bulletsPool.acquire();
        sh.shell = true; sh.shellBoss = 'SIEGE'; sh.fuse = 7;
        sh.x = T.TILE * 6; sh.y = T.TILE * 7; sh.vx = 0; sh.vy = 1; sh.speed = 0; sh.isPlayer = false;
      }
    } else {
      G.level = kind === 'normal' ? 1 : 10;
    }

    const types = ['NORMAL', 'FAST', 'HEAVY', 'SUICIDE'];
    for (let i = 0; i < 6; i++) {
      const e = new T.Tank(T.TILE * (2 + i), T.TILE * (2 + (i % 3)), i % 4, types[i % 4], false);
      e.hp = e.maxHp = i % 2 ? 3 : 1;
      e.moving = !!(i % 2);
      if (i === 2) { e.elitePrefix = 'BERSERKER'; e.eliteEffects = T.ELITE_PREFIXES.BERSERKER; e.applyTypeStats(); e.hp = e.maxHp; }
      if (i === 3) { e.glowTimer = 30; }
      G.enemies.push(e);
    }
    if (kind !== 'boss' && kind !== 'boss_charge') {
      const boss = new T.Tank(T.TILE * 12, T.TILE * 4, T.DOWN, 'BOSS', false);
      boss.hp = boss.maxHp = 20;
      G.enemies.push(boss);
    }
    G.aliveEnemies = G.enemies.length;

    for (let i = 0; i < 24; i++) {
      T.spawnBullet(T.TILE * 2 + i * 9, T.TILE * 9 + (i % 5) * 7, i % 4, i % 3 !== 0);
    }
    for (let i = 0; i < 120; i++) {
      const p = T.particlesPool.acquire();
      p.type = i % 3 ? 'spark' : 'smoke';
      p.x = 40 + (i * 13) % 420; p.y = 30 + (i * 31) % 440;
      p.vx = (i % 5) - 2; p.vy = (i % 7) - 3;
      p.life = 20 + (i % 25); p.maxLife = 45; p.size = 2 + (i % 4);
      p.color = i % 5 === 0 ? '#5cd8ff' : i % 2 ? '#ffaa00' : '#ff3300';
    }
    G.scorePopups.push({ x: 100, y: 200, text: '+100', life: 20, vy: -1 });
    G.spawnEffects.push({ x: T.TILE * 7, y: T.TILE * 3, size: T.TILE, life: 12, maxLife: 24 });
    G.powerUps.push({ type: 'SHIELD', x: T.TILE * 9, y: T.TILE * 9, life: 300, maxLife: 600, alive: true });
    T.cacheStaticMap();
  }

  function shoot(name, kind, opts = {}) {
    try {
      buildScene(kind);
      if (opts.night) { T.activateMapEvent('NIGHT'); G.state = T.STATE.PLAYING; }
      if (opts.paused) G.state = T.STATE.PAUSED;
      if (opts.combo) G.playerStats.combo = 7;
      T.render();
      const img = T.ctx.getImageData(0, 0, T.canvas.width, T.canvas.height);
      if (window.__DUMP) window.__DUMP[name] = blockHashes(img);
      scenes[name] = fnv(new Uint32Array(img.data.buffer));
    } catch (err) {
      scenes[name] = 'ERR: ' + String((err && err.message) || err);
    }
  }

  shoot('normal', 'normal');
  shoot('normal+combo', 'normal', { combo: true });
  shoot('vs', 'vs');
  shoot('night', 'normal', { night: true });
  shoot('paused', 'normal', { paused: true });
  shoot('boss_siege', 'boss');            // 攻城核心：外框／圖示／砲彈
  shoot('boss_charge', 'boss_charge');    // 獵殺者：蓄力警示圈

  // menu：不在遊戲中（isGameplay=false）時畫的是一層純黑
  G.state = T.STATE.MENU;
  T.render();
  scenes.menu = fnv(new Uint32Array(T.ctx.getImageData(0, 0, T.canvas.width, T.canvas.height).data.buffer));
  return scenes;
});

const dumps = dumpDir ? await page.evaluate(() => window.__DUMP || {}) : null;
if (dumps) {
  for (const [name, blocks] of Object.entries(dumps)) {
    await writeFile(join(dumpDir, `${name}.blocks.json`), JSON.stringify(blocks) + '\n');
  }
  console.log(`已傾印區塊 hash：${dumpDir}`);
}

await browser.close();
server.close();

if (flag('--json')) {
  console.log(JSON.stringify(hashes, null, 2));
} else {
  for (const [k, v] of Object.entries(hashes)) console.log(`${k.padEnd(14)}${v}`);
}

if (flag('--save')) {
  const target = opt('--save');
  const file = isAbsolute(target) ? target : join(ROOT, target);
  await writeFile(file, JSON.stringify(hashes, null, 2) + '\n');
  console.log(`已存：${file}`);
}

const cmp = opt('--compare');
if (cmp) {
  const base = JSON.parse(await readFile(isAbsolute(cmp) ? cmp : join(ROOT, cmp), 'utf8'));
  let bad = 0;
  for (const [k, v] of Object.entries(hashes)) {
    const same = base[k] === v;
    if (!same) bad++;
    console.log(`${same ? 'SAME' : 'DIFF'}  ${k.padEnd(14)}${base[k]} → ${v}`);
  }
  process.exitCode = bad ? 1 : 0;
}
