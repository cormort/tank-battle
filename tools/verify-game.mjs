// 坦克大戰 v2 —— 修正驗證工具（Playwright）
//
// 這個專案是單檔 index.html、沒有建置流程，所以驗證靠這支工具：
// 用 `?bot` 模式（index.html 會把 G／STATE／Pool／Tank 等掛到 window.__T）直接驅動遊戲內部，
// 把「這輪修掉的問題」逐條變成可重複執行的斷言 —— 之後改壞了會直接紅燈。
//
// 跑法：
//   node tools/verify-game.mjs
//   PW_MODULE=/path/to/playwright/index.js node tools/verify-game.mjs
//   PROBE_URL=https://cormort.github.io/tank-battle/ node tools/verify-game.mjs   # 打遠端
//
// 離開碼 1 表示有案例失敗。

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PROBE_PORT || 8941);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

let passed = 0, failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++; else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

function serve() {
  const server = createServer(async (req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = join(ROOT, normalize(rel === '/' ? '/index.html' : rel));
    if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'x-verify-server': 'verify-game',
    });
    res.end(body);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

const server = process.env.PROBE_URL ? null : await serve();
const BASE = process.env.PROBE_URL || `http://127.0.0.1:${PORT}/index.html`;
const A = (u) => u + (u.includes('?') ? '&' : '?');

let pw;
try {
  pw = (await import(process.env.PW_MODULE || 'playwright')).default;
} catch {
  console.error('找不到 playwright。請先：npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const browser = await pw.chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));

async function bootBot(url = A(BASE) + 'bot&mute') {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__T && window.__T.G, undefined, { timeout: 30000 });
  await page.getByRole('button', { name: 'START GAME' }).click();
  await page.waitForTimeout(1800);
}

// ── 原始碼層級的檢查（有些修正用行為難以斷言，直接看原始碼最準）──
const source = await readFile(join(ROOT, 'index.html'), 'utf8');

console.log('=== A. 主玩法修正 ===');
await bootBot();

// A1：WEAPON_TREE 每個條目都要有 id（缺 id 會讓武器進化把 ps.weapon 設成 undefined）
const tree = await page.evaluate(() => {
  const T = window.__T;
  return Object.entries(T.WEAPON_TREE).map(([key, wp]) => ({ key, id: wp.id, next: wp.next, tier: wp.tier, route: wp.route }));
});
const missingId = tree.filter((w) => w.id !== w.key);
ok('A1 WEAPON_TREE 每個條目都有 id 且等於 key（否則進化會把武器打成 undefined）',
  missingId.length === 0, missingId.length ? `缺 id：${missingId.map((w) => w.key).join('、')}` : `${tree.length} 條目全部具備`);

// A1b：四條路線都能從 tier1 一路走到 tier4（用 next 鏈走訪）
const chains = await page.evaluate(() => {
  const T = window.__T.WEAPON_TREE;
  const out = {};
  for (const key of Object.keys(T)) {
    if (T[key].tier !== 1) continue;
    const chain = []; let cur = key;
    while (cur && T[cur]) { chain.push(T[cur].id || '(無id)'); cur = T[cur].next; }
    out[T[key].route] = chain;
  }
  return out;
});
const badChains = Object.entries(chains).filter(([, c]) => c.length !== 4 || c.includes('(無id)'));
ok('A1b 四條武器流派都能從 tier1 走到 tier4，且每一步都有合法 id',
  Object.keys(chains).length === 4 && badChains.length === 0,
  Object.entries(chains).map(([r, c]) => `${r}:${c.join('→')}`).join(' | '));

// A1c：進化真的會更新 ps.weapon（模擬升級卡套用）
const evolved = await page.evaluate(() => {
  const T = window.__T;
  const ps = T.G.playerStats;
  ps.weapon = 'RAPID'; ps.route = 'A'; ps.weaponTier = 1;
  T.applyUpgrade({ type: 'weapon', id: T.WEAPON_TREE.RAPID.next });
  const after1 = { weapon: ps.weapon, tier: ps.weaponTier };
  T.startLevel();                       // 換關（舊版會在下一關把 undefined 退回 NORMAL）
  const afterLevel = ps.weapon;
  return { after1, afterLevel, hasNext: !!(T.WEAPON_TREE[ps.weapon] && T.WEAPON_TREE[ps.weapon].next) };
});
ok('A1c 選了進化卡之後 ps.weapon 是合法 id，且換關後不會退回 NORMAL',
  evolved.after1.weapon === 'GATLING' && evolved.afterLevel === 'GATLING' && evolved.hasNext,
  JSON.stringify(evolved));

// A2：商店買已滿級的武器不該扣分
const shopResult = await page.evaluate(() => {
  const T = window.__T;
  T.G.score = 5000;
  T.G.playerStats.weapon = 'OVERDRIVE';         // A 路線最終階，next = null
  T.G.playerStats.weaponTier = 4;
  const before = T.G.score;
  T.buyItem('weapon');
  return { before, after: T.G.score, popup: (T.G.scorePopups.slice(-1)[0] || {}).text || '' };
});
ok('A2 商店購買已滿級武器時分數不會被扣（舊版先扣 1500 再顯示「已達最大等級!」）',
  shopResult.before === shopResult.after, JSON.stringify(shopResult));

// A3：barrierTimer 會遞減，且 BARRIER 護盾到期後不再無敵
const barrier = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.playerStats.passives = ['BARRIER'];
  T.fx.clear('barrier');
  G.playerStats.hp = 3; G.playerStats.maxHp = 3;
  // 模擬被子彈打到兩次：第一次啟動護盾，第二次應該被吸收
  const fakeBullet = { x: G.player.x, y: G.player.y, size: 4, power: 1, alive: true, hitTanks: [] };
  T.handleBulletHit(fakeBullet, G.player);
  const armed = T.fx.left('barrier');
  await new Promise((r) => setTimeout(r, 600));    // 約 36 tick
  const afterTicks = T.fx.left('barrier');
  return { armed, afterTicks, decrements: armed > afterTicks };
});
ok('A3 BARRIER 護盾會隨時間到期（舊版 barrierTimer 永不遞減 → 拿了 BARRIER 就整局無敵）',
  barrier.decrements && barrier.armed > 0, JSON.stringify(barrier));

// A4：BOOST 讓冷卻變短（舊版乘 2 反而變長）
// 量測方式：shoot() 會把算出来的冷卻寫進 tank.bulletTimer，這就是實際射速。
const boost = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.playerStats.weapon = 'NORMAL'; G.playerStats.weaponTier = 0; G.playerStats.route = null;
  G.playerStats.shopFireRateBonus = 0; G.playerStats.heatStacks = 0;
  const shootOnce = () => { G.player.bulletTimer = 0; G.player.shoot(); return G.player.bulletTimer; };
  T.fx.clear('boost');
  const cdNormal = shootOnce();
  T.fx.set('boost', 180);
  const cdBoost = shootOnce();
  T.fx.clear('boost');
  return { cdNormal, cdBoost };
});
ok('A4 BOOST 期間的實際冷卻比平常短（舊版 cooldownMult *= 2 讓「超頻」變成射速砍半）',
  boost.cdBoost < boost.cdNormal && boost.cdBoost > 0, JSON.stringify(boost));

// A5：有 laserLife 的子彈必須真的會死（舊版 laserLife 只被寫入、從不遞減 →
//     OMEGA 每次射擊遺留 29 顆靜止、無地形碰撞的永生子彈，池會無界成長）
const laserLife = await page.evaluate(async () => {
  const T = window.__T;
  const bp = T.bulletsPool;
  bp.clear();
  const b = bp.acquire();
  b.x = 100; b.y = 100; b.vx = 0; b.vy = 0; b.speed = 0;
  b.ignoreTiles = true; b._isChild = true; b.alive = true; b.laserLife = 5;
  for (let i = 0; i < 6; i++) T.updateBullet(b);
  const died = b.alive === false;
  bp.sweep();
  return { died, poolAfter: bp.active.length };
});
ok('A5 laserLife 到期會回收光束段（舊版永不遞減 → 每次射擊遺留 29 顆永生子彈）',
  laserLife.died && laserLife.poolAfter === 0, JSON.stringify(laserLife));

// A6：範圍技清場後關卡仍會結算（舊版只在子彈命中時檢查 → 軟鎖）
const complete = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.isVSMode = false; G.level = 2; G.bossSpawned = true;
  G.maxEnemies = 12; G.enemiesSpawned = 12; G.aliveEnemies = 0;
  G.enemies.length = 0;
  G.state = T.STATE.PLAYING;
  await new Promise((r) => setTimeout(r, 300));
  return { state: G.state };
});
ok('A6 敵人被範圍技清光時關卡仍會結算（每 tick 檢查，不再依賴子彈命中事件）',
  complete.state === 'levelComplete', JSON.stringify(complete));

// A7：BOSS 關在王出生前不結算
const bossGate = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.isVSMode = false; G.level = 5; G.bossSpawned = false;
  G.maxEnemies = 20; G.enemiesSpawned = 20; G.aliveEnemies = 0;
  G.enemies.length = 0; G.state = T.STATE.PLAYING;
  await new Promise((r) => setTimeout(r, 300));
  const beforeBoss = G.state;
  G.bossSpawned = true;
  await new Promise((r) => setTimeout(r, 300));
  return { beforeBoss, afterBoss: G.state };
});
ok('A7 BOSS 關卡在王出生前不結算、出生後才結算（舊版清怪快就永遠看不到王）',
  bossGate.beforeBoss === 'playing' && bossGate.afterBoss === 'levelComplete', JSON.stringify(bossGate));

// A8：菁英詞綴真的生效（1.5 倍血 + eliteEffects）
const elite = await page.evaluate(() => {
  const T = window.__T;
  const plain = new T.Tank(T.TILE * 3, T.TILE * 3, T.DOWN, 'NORMAL', false);
  const e = new T.Tank(T.TILE * 5, T.TILE * 5, T.DOWN, 'NORMAL', false);
  e.elitePrefix = 'BERSERKER';
  e.applyTypeStats();
  return { plainHp: plain.maxHp, eliteHp: e.maxHp, effects: !!e.eliteEffects, color: e.eliteEffects && e.eliteEffects.color };
});
ok('A8 菁英詞綴會套用（1.5 倍血 + eliteEffects 光環，舊版指派時機太晚 → 完全失效）',
  elite.eliteHp === Math.ceil(elite.plainHp * 1.5) && elite.effects, JSON.stringify(elite));

ok('A9 驗證期間沒有未捕捉的例外', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | ') || '0 筆');

console.log('\n=== E. 資料接線（M1：宣告的內容真的有作用） ===');
// E1：SURGE 事件結束時要呼叫 deactivate（舊版 deactivate 宣告了卻沒有任何呼叫端 →
//     spawnInterval 被減半後永久不還原）
const surge = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;          // 前面的關卡結算測試會把狀態留在 levelComplete
  G.isVSMode = true;
  G.spawnInterval = 18;
  const before = G.spawnInterval;
  T.DIRECTOR_EVENTS.SURGE.activate();
  const during = G.spawnInterval;
  G.directorEvents.length = 0;
  G.directorEvents.push({ name: 'x', desc: 'x', life: 1, type: 'SURGE' });
  await new Promise((r) => setTimeout(r, 200));
  return { before, during, after: G.spawnInterval };
});
ok('E1 SURGE 事件結束時會呼叫 deactivate、生成間隔還原（舊版永久減半）',
  surge.during < surge.before && surge.after === surge.before, JSON.stringify(surge));

// E2：airdrop 事件要真的掉道具（舊版是空分支，玩家只看到「空投來了」）
const airdrop = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.powerUps.length = 0;
  G.directorEvents.length = 0;
  T.DIRECTOR_EVENTS.AIRDROP.activate();
  const pushed = G.directorEvents.length;
  for (let i = 0; i < 40; i++) T.updateDirectorEvents();
  const dropped = G.powerUps.length;
  G.directorEvents.length = 0; G.powerUps.length = 0;
  return { pushed, dropped };
});
ok('E2 空投事件會實際產生道具（舊版 activate 之後什麼都沒發生）',
  airdrop.pushed > 0 && airdrop.dropped > 0, JSON.stringify(airdrop));

// E3：FREEZING 詞綴的子彈會凍緩玩家（舊版 FREEZING 沒有任何處理）
const freezing = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.playerStats.passives = [];
  T.fx.clear('barrier'); T.fx.clear('invul'); T.fx.clear('slow');
  G.playerStats.hp = 3; G.playerStats.maxHp = 3;
  G.state = T.STATE.PLAYING;
  T.handleBulletHit({ x: G.player.x, y: G.player.y, size: 4, power: 0, isPlayer: false,
    alive: true, hitTanks: [], freezing: true }, G.player);
  const timer = T.fx.left('slow');
  await new Promise((r) => setTimeout(r, 150));
  const speed = G.player.speed;
  const half = 2.5 * G.playerStats.speedMult * 0.5;
  T.fx.clear('slow'); T.applyPlayerSpeed();
  await new Promise((r) => setTimeout(r, 150));
  const restored = G.player.speed;
  return { timer, speed: +speed.toFixed(2), half: +half.toFixed(2), restored: +restored.toFixed(2) };
});
ok('E3 FREEZING 詞綴會凍緩玩家、時間到恢復速度（舊版完全沒有處理）',
  freezing.timer > 0 && Math.abs(freezing.speed - freezing.half) < 0.01 && freezing.restored > freezing.half,
  JSON.stringify(freezing));

// E4：特殊敵人真的會被生成（舊版五種型別都有 AI 但生成端從不產生）
const specials = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  const seen = new Set();
  G.isVSMode = false; G.level = 6; G.maxEnemies = 999; G.enemiesSpawned = 0;
  for (let i = 0; i < 400; i++) {
    G.spawnTimer = 0; G.enemiesSpawned = 0;
    G.enemies.length = 0;
    T.spawnEnemy();
    const e = G.enemies[0];
    if (e) seen.add(e.type);
  }
  G.enemies.length = 0;
  return { types: Array.from(seen), wanted: Array.from(T.SPECIAL_ENEMY_TYPES) };
});
ok('E4 特殊敵人（SNIPER/ENGINEER/INTERFERER/GUARD/MINELAYER）會被生成',
  specials.wanted.some((t) => specials.types.includes(t)),
  `生成過的型別：${specials.types.join('、')}`);

// E5：bomb / mine 召喚物真的會傷害玩家（舊版只倒數然後消失）
const hazards = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.playerStats.passives = []; T.fx.clear('barrier'); T.fx.clear('invul');
  G.playerStats.hp = 3; G.playerStats.maxHp = 3;
  G.player.hp = 3;                    // 一條命內的耐久（playerStats.hp 是剩餘命數，兩者語意不同）
  G.player.alive = true;
  G.player.shieldHits = 0;
  G.summonEntities.length = 0;
  G.summonEntities.push({ type: 'mine', x: G.player.x, y: G.player.y, life: 600, maxLife: 600, damage: 2, alive: true });
  T.updateSummonEntities();
  const afterMine = G.player.hp;
  const cleared = G.summonEntities.filter((s) => s.alive).length;
  G.summonEntities.length = 0;
  return { before: 3, afterMine, cleared };
});
ok('E5 mine／bomb 召喚物會對玩家造成傷害（舊版沒有行為分支）',
  hazards.afterMine < hazards.before && hazards.cleared === 0, JSON.stringify(hazards));

console.log('\n=== F. 狀態機與輸入意圖（M3 平台層） ===');
// F1：真實流程走一遍，不能出現「未宣告的狀態轉移」——
// 白名單漏寫時玩家會看到畫面卡住或計時器亂跑，這條是那個契約的整合檢查。
const stateFlow = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  T.gameState.reset();
  T.restartGame();                       // → playing
  T.togglePause();                       // → paused
  T.togglePause();                       // → playing
  T.openShop();                          // → shop
  T.closeShop();                         // → playing
  G.state = T.STATES.PLAYING;
  G.isVSMode = false; G.level = 2; G.bossSpawned = true;
  G.maxEnemies = 12; G.enemiesSpawned = 12; G.aliveEnemies = 0; G.enemies.length = 0;
  await wait(120);                       // → levelComplete（由每 tick 的 checkLevelComplete）
  const afterLevel = G.state;
  T.showGameOver();                      // → gameover
  const afterGameOver = G.state;
  T.restartGame();                       // → playing（重開）
  return {
    afterLevel, afterGameOver, final: G.state,
    warnings: T.gameState.warnings(),
    history: T.gameState.history().map((h) => `${h.from}→${h.to}${h.ok ? '' : '(未宣告)'}`),
  };
});
ok('F1 實際流程（遊玩→暫停→商店→關卡結算→遊戲結束→重開）沒有未宣告的狀態轉移',
  stateFlow.warnings.length === 0,
  stateFlow.warnings.length ? stateFlow.warnings.join('；') : stateFlow.history.join('、'));
ok('F2 流程真的走過這些狀態（不是空跑）',
  stateFlow.afterLevel === 'levelComplete' && stateFlow.afterGameOver === 'gameover' && stateFlow.final === 'playing',
  JSON.stringify({ level: stateFlow.afterLevel, gameover: stateFlow.afterGameOver, final: stateFlow.final }));

// F3：未知狀態值不會被套用（G.state 是狀態機的存取器）
const unknownState = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  const before = G.state;
  G.state = 'nonsense';
  const after = G.state;
  G.state = before;
  return { before, after };
});
ok('F3 設定未知狀態不會生效（打錯字不會把狀態機弄壞）',
  unknownState.after === unknownState.before, JSON.stringify(unknownState));

// F4：失去焦點時平台層的意圖狀態也要清空（不只 G.keys）
const intentRelease = await page.evaluate(() => {
  const T = window.__T;
  T.input.up = true; T.input.fire = true;
  window.dispatchEvent(new Event('blur'));
  return { up: T.input.up, fire: T.input.fire };
});
ok('F4 blur 會清空平台層的輸入意圖', intentRelease.up === false && intentRelease.fire === false,
  JSON.stringify(intentRelease));

// F5：音訊初始化必須成功 —— 平台層抽出時曾把噪音 buffer 用的 rnd() 留在模組外，
// init() 拋錯被 catch 吞掉，整個遊戲靜默無聲（沒有任何測試會發現）。這條守住它。
const audio = await page.evaluate(() => {
  const T = window.__T;
  return {
    ready: T.Sound.ready, error: T.Sound.error ? String(T.Sound.error.message || T.Sound.error) : null,
    hasMaster: !!T.Sound.master, hasNoise: !!T.Sound.noiseBuf, musicTrack: !!T.Music._track,
  };
});
ok('F5 音訊引擎初始化成功（沒有靜默失敗：ready=true、error=null）',
  audio.ready === true && audio.error === null && audio.hasMaster && audio.hasNoise, JSON.stringify(audio));

console.log('\n=== B. 手機與輸入 ===');
// B1：手機橫向可以開始遊戲
// 真實手機情境：iPhone UA + isMobile + hasTouch + DPR3（否則 pointer:coarse 與 UA 都不成立，
// 測到的會是桌機版面，等於沒測到手機）
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const mobileCtx = await browser.newContext({
  viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
});
const mobile = await mobileCtx.newPage();
await mobile.goto(A(BASE) + 'mute', { waitUntil: 'domcontentloaded' });
await mobile.waitForTimeout(2500);
const landscape = await mobile.evaluate(() => {
  const c0 = document.querySelector('canvas');
  const dprInfo = { dpr: devicePixelRatio, backing: c0.width, expected: 520 * Math.max(1, Math.min(devicePixelRatio || 1, 2)) };
  const c = document.querySelector('canvas');
  const r = c.getBoundingClientRect();
  const btn = [...document.querySelectorAll('button')].find((b) => /START/.test(b.textContent));
  const br = btn && btn.getBoundingClientRect();
  const hit = br ? document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2) : null;
  return {
    canvasH: Math.round(r.height), viewportH: innerHeight,
    startBottom: br ? Math.round(br.bottom) : null,
    clickable: !!(hit && (hit.tagName === 'BUTTON' || hit.closest('button'))),
    isMobile: document.body.classList.contains('mobile'),
    dprInfo,
  };
});
ok('B1 手機橫向（844×390）畫布不會超出畫面、START GAME 點得到（舊版 canvas 844×847、按鈕在畫面外）',
  landscape.isMobile && landscape.canvasH <= landscape.viewportH && landscape.clickable, JSON.stringify(landscape));

// B4：DPR 3 時 backing store 要是 520×2 = 1040（舊版固定 520）
ok('B4 高解析度螢幕會放大 backing store（舊版固定 520，DPR3 只用掉 44% 解析度）',
  landscape.dprInfo.backing === landscape.dprInfo.expected && landscape.dprInfo.dpr > 1,
  JSON.stringify(landscape.dprInfo));
await mobile.close();
await mobileCtx.close();

// B2：blur / visibilitychange 會放開按鍵並自動暫停
const lifecycle = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.keys['KeyD'] = true;
  G.touch.fire = true;
  window.dispatchEvent(new Event('blur'));
  await new Promise((r) => setTimeout(r, 200));
  return { keysEmpty: Object.keys(G.keys).length === 0, fire: G.touch.fire, state: G.state };
});
ok('B2 失去焦點時會放開所有按鍵並自動暫停（舊版按鍵卡住、坦克自己一直跑）',
  lifecycle.keysEmpty && lifecycle.fire === false && lifecycle.state === 'paused', JSON.stringify(lifecycle));

// B3：Space 對已聚焦的按鈕有效
const space = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  const btn = document.getElementById('resumeBtn');
  if (btn) btn.focus();
  return { state: G.state, focused: document.activeElement && document.activeElement.id };
});
await page.keyboard.press('Space');
await page.waitForTimeout(400);
const afterSpace = await page.evaluate(() => window.__T.G.state);
ok('B3 已聚焦的按鈕按 Space 會被啟動（舊版無條件 preventDefault 導致只能用 Enter）',
  space.focused === 'resumeBtn' && afterSpace === 'playing', `focus=${space.focused} state ${space.state}→${afterSpace}`);

// B5：手機 HUD 觸控目標
const touchTargets = await mobileTargets();
async function mobileTargets() {
  const p = await context.newPage();
  await p.setViewportSize({ width: 390, height: 844 });
  await p.addInitScript(() => {
    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
    window.ontouchstart = null;
  });
  await p.goto(A(BASE) + 'mute', { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  const res = await p.evaluate(() => ({
    isMobile: document.body.classList.contains('mobile'),
    buttons: [...document.querySelectorAll('#hud button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { t: b.textContent.trim().slice(0, 2), w: Math.round(r.width), h: Math.round(r.height) };
    }),
  }));
  await p.close();
  return res;
}
ok('B5 手機模式下 HUD 按鈕 ≥ 44×44（舊版 36×20 / 27×20，常誤觸中斷遊戲）',
  touchTargets.isMobile && touchTargets.buttons.every((b) => b.w >= 44 && b.h >= 44),
  `${touchTargets.isMobile ? 'mobile' : 'desktop'} ${JSON.stringify(touchTargets.buttons)}`);

// B6：商店/結算 overlay 可捲動
const overlayScroll = await page.evaluate(() => {
  const ov = document.getElementById('overlay');
  const cs = getComputedStyle(ov);
  return { overflowY: cs.overflowY, touchAction: cs.touchAction };
});
ok('B6 結算/商店 overlay 可捲動（手機橫向內容超出時才按得到退出商店）',
  overlayScroll.overflowY === 'auto' && /pan-y/.test(overlayScroll.touchAction), JSON.stringify(overlayScroll));

// B7：錯誤不再讓遊戲永久凍結
const freeze = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.enemies.push(null);                     // 故意讓 render/update 丟例外
  const before = G.frameCount;
  await new Promise((r) => setTimeout(r, 900));
  const after = G.frameCount;
  const banner = document.getElementById('errorBanner');
  const shown = banner && getComputedStyle(banner).display !== 'none';
  G.enemies = G.enemies.filter(Boolean);
  return { before, after, stillRunning: after > before, bannerShown: shown, bannerText: banner ? banner.textContent.slice(0, 40) : '' };
});
ok('B7 執行期例外不會讓遊戲凍結（900ms 內仍推進 > 20 幀）、且會顯示錯誤提示',
  (freeze.after - freeze.before) > 20 && freeze.bannerShown, JSON.stringify(freeze));

console.log('\n=== C. 效能 ===');
// C1：老鷹改為離屏快取（渲染時 0 次 fillRect/fillStyle）
const eagle = await page.evaluate(() => {
  const T = window.__T;
  const cv = document.createElement('canvas');
  cv.width = 520; cv.height = 520;
  const c = cv.getContext('2d');
  let fillRects = 0, fillStyles = 0, drawImages = 0;
  const origFillRect = c.fillRect.bind(c);
  c.fillRect = (...a) => { fillRects++; return origFillRect(...a); };
  c.drawImage = (...a) => { drawImages++; };
  const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'fillStyle');
  Object.defineProperty(c, 'fillStyle', {
    set(v) { fillStyles++; desc.set.call(c, v); }, get() { return desc.get.call(c); },
  });
  T.drawEagleDirect(c, 0, 0, false);
  T.drawEagleDirect(c, 30, 0, true);
  return { fillRects, fillStyles, drawImages, cached: !!(T.eagleCache && T.eagleCache.alive) };
});
ok('C1 基地老鷹改用離屏快取（每次 1 次 drawImage、0 次逐像素 fillRect；舊版每幀 254 次 API 呼叫）',
  eagle.fillRects === 0 && eagle.drawImages === 2 && eagle.cached, JSON.stringify(eagle));

// C2：坦克 sprite 快取在實例上（同一方向/相位連續繪製不再重建 key）
// 注意：敵人轉向時 sprite 本來就該換（換的是快取裡另一個物件），所以斷言放在
// 「同一組參數連續 draw 不會呼叫 buildTankSprite、也不會新增快取項」。
const sprite = await page.evaluate(() => {
  const T = window.__T;
  const origBuild = T.buildTankSprite;
  let built = 0;
  T.buildTankSprite = (...args) => { built++; return origBuild(...args); };
  const e = new T.Tank(T.TILE * 3, T.TILE * 3, T.DOWN, 'NORMAL', false);
  e.aimDir = T.DOWN; e.moving = false;
  e.draw();
  const first = e._spr;
  const sizeAfterFirst = T.tankSpriteCache.size;
  for (let i = 0; i < 30; i++) { e.aimDir = T.DOWN; e.moving = false; e.draw(); }
  T.buildTankSprite = origBuild;
  return { built, sameInstance: first === e._spr, cacheStable: T.tankSpriteCache.size === sizeAfterFirst, cached: !!e._spr };
});
const guardRegex = /if \(!this\._spr \|\| this\._sprDir !== this\.aimDir[\s\S]{0,80}?const key =/;
ok('C2 坦克 sprite 快取綁在實例上（同方向連續 30 次 draw 不重建、不新增快取項）',
  sprite.cached && sprite.sameInstance && sprite.built === 0 && sprite.cacheStable && guardRegex.test(source),
  JSON.stringify({ ...sprite, guard: guardRegex.test(source) }));

// C3：煙霧粒子不再配置 rgba 字串
const smoke = await page.evaluate(() => {
  const T = window.__T;
  const cv = document.createElement('canvas'); cv.width = 520; cv.height = 520;
  const c = cv.getContext('2d');
  const desc = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, 'fillStyle');
  let sets = 0;
  Object.defineProperty(c, 'fillStyle', { set(v) { sets++; desc.set.call(c, v); }, get() { return desc.get.call(c); } });
  const pp = T.particlesPool;
  pp.clear();
  for (let i = 0; i < 200; i++) {
    const p = pp.acquire();
    p.type = 'smoke'; p.x = i % 100; p.y = (i * 3) % 100; p.size = 6; p.life = 60; p.maxLife = 60;
  }
  const arr = pp.active;
  // 直接呼叫繪製路徑（drawParticles 會畫整個池，這裡用同樣的邏輯量 fillStyle 次數）
  let smokeSets = 0;
  const beforeSmoke = 0;
  T.drawParticles();
  return { sets, smokeColorConst: typeof T.smokeColor === 'string', beforeSmoke };
});
ok('C3 煙霧粒子使用固定色 + globalAlpha（不再每顆每幀配 rgba 樣板字串）',
  smoke.smokeColorConst && !source.includes('`rgba(80,80,80,'), JSON.stringify({ smokeColor: smoke.smokeColorConst }));

// C4：NIGHT 漸層會重用（玩家沒動時不重建）
// 直接驅動真正的 drawMapEvent()，用 patch 過的 createRadialGradient 計數 ——
// 這樣量到的是實際渲染路徑，而不是重寫一份等價邏輯。
const night = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  T.mapEventState.active = true;
  T.mapEventState.type = 'NIGHT';
  T.mapEventState.timer = 600;
  G.player.alive = true;
  G.player.x = 100; G.player.y = 100;
  const proto = CanvasRenderingContext2D.prototype;
  const orig = proto.createRadialGradient;
  let created = 0;
  proto.createRadialGradient = function (...args) { created++; return orig.apply(this, args); };
  T.drawMapEvent();
  const first = created;
  T.drawMapEvent();
  const second = created;
  proto.createRadialGradient = orig;
  T.mapEventState.active = false;
  return { first, second, reused: second === first };
});
ok('C4 NIGHT 漸層會被重用（舊版每幀重建 + 全螢幕漸層填色）',
  night.first === 1 && night.reused, JSON.stringify(night));

// C5：熱路徑不再使用 Math.hypot
const hypotLeft = (source.match(/Math\.hypot\(/g) || []).length;
const hypotInRepulsion = /function applyRepulsion[\s\S]{0,600}?Math\.hypot\(/.test(source);
ok('C5 敵人互斥（每敵人每幀）不再使用 Math.hypot，改用平方距離',
  !hypotInRepulsion, `全檔剩餘 Math.hypot ${hypotLeft} 處（非熱路徑保留）`);

// C6：音效有同時發聲上限
const voices = await page.evaluate(() => {
  const T = window.__T;
  const s = T.Sound;
  s._activeVoices = 0;
  let granted = 0;
  for (let i = 0; i < 20; i++) if (s._voiceSlot()) granted++;
  s._activeVoices = 0;
  return { granted, hasRelease: typeof s._releaseOnEnd === 'function' };
});
ok('C6 音效同時發聲上限 8 個（舊版轟炸流會疊 20~30 個 voice 造成削波）',
  voices.granted === 8 && voices.hasRelease, JSON.stringify(voices));

// C7：textAlign 不再洩漏
const align = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.powerUps = [{ type: 'STAR', x: 100, y: 100, alive: true, life: 60, maxLife: 60 }];
  const cv = document.createElement('canvas'); cv.width = 520; cv.height = 520;
  const c = cv.getContext('2d');
  T.drawPowerUps();
  const result = T.ctx.textAlign;    // 模組內的 ctx 才是 drawPowerUps 實際使用的畫布
  G.powerUps = [];
  return { textAlign: result };
});
ok('C7 道具圖示繪製後 textAlign 不會洩漏（避免後續文字位置偏掉）',
  align.textAlign === 'left' && /ctx\.textAlign = 'left';\s*\/\/ 舊版只還原 globalAlpha/.test(source),
  JSON.stringify(align));

// C8：F3 面板量的是整幀（含 render）且顯示池峰值
const perfPanel = await page.evaluate(() => {
  const T = window.__T;
  T.Perf.enabled = true;
  const hasBeginFrame = typeof T.Perf.beginFrame === 'function';
  return { hasBeginFrame, peakRow: !!document.getElementById('perfPeak'), pointerEvents: getComputedStyle(document.getElementById('perfMonitor')).pointerEvents };
});
ok('C8 F3 面板量整幀、顯示池峰值，且不會蓋住 HUD 按鈕',
  perfPanel.hasBeginFrame && perfPanel.peakRow && perfPanel.pointerEvents === 'none', JSON.stringify(perfPanel));

console.log(`\n${passed} passed, ${failed} failed  (pageerror: ${pageErrors.length})`);
await browser.close();
if (server) server.close();
process.exit(failed ? 1 : 0);
