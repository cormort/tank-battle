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
const T_TILE_FOR_TEST = () => 26;   // CONFIG.CANVAS.TILE，只給 Node 端的斷言用（evaluate 內用 T.TILE）
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
const badChains = Object.entries(chains).filter(([, c]) => c.length !== 3 || c.includes('(無id)'));
ok('A1b 四條武器流派都能從 tier1 走到 tier3（精簡後每條 3 級），且每一步都有合法 id',
  Object.keys(chains).length === 4 && badChains.length === 0,
  Object.entries(chains).map(([r, c]) => `${r}:${c.join('→')}`).join(' | '));

// A1d：第一次升級（還在 NORMAL、沒有路線）→ 一次給 4 張流派卡，讓玩家選路線
const firstCards = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  const ps = G.playerStats;
  const backup = { weapon: ps.weapon, route: ps.route, tier: ps.weaponTier, passives: ps.passives.slice(), active: ps.activeSkill };
  ps.weapon = 'NORMAL'; ps.route = null; ps.weaponTier = 0; ps.passives = []; ps.activeSkill = null;
  const cards = T.generateUpgradeOptions();
  Object.assign(ps, backup);
  return {
    cards: cards.map((c) => `${c.type}:${c.id}`),
    routes: [...new Set(cards.map((c) => T.WEAPON_TREE[c.id] && T.WEAPON_TREE[c.id].route))].sort().join(''),
  };
});
ok('A1d 第一次升級會給 4 張流派卡（四條路線各一張，選完才固定路線）',
  firstCards.cards.length === 4
  && firstCards.cards.every((c) => c.startsWith('starter:'))
  && firstCards.routes === 'ABCD',
  JSON.stringify(firstCards));

// A1e：之後每次升級，第一張固定是「下一階武器」—— 舊版把它和其他卡一起洗牌，常常洗掉
const evoCard = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  const ps = G.playerStats;
  const backup = { weapon: ps.weapon, route: ps.route, tier: ps.weaponTier };
  const out = [];
  for (const w of ['RAPID', 'GATLING', 'SPREAD', 'CLUSTER', 'PLASMA', 'D_LASER', 'SUMMON', 'DRONE']) {
    ps.weapon = w; ps.route = T.WEAPON_TREE[w].route; ps.weaponTier = T.WEAPON_TREE[w].tier;
    const cards = T.generateUpgradeOptions();
    const next = T.WEAPON_TREE[w].next;
    out.push({ weapon: w, first: cards[0] && `${cards[0].type}:${cards[0].id}`, expect: `weapon:${next}`, n: cards.length });
  }
  Object.assign(ps, backup);
  return out;
});
ok('A1e 每次升級的第一張卡固定是下一階武器（不會被洗掉），而且總共 3 張',
  evoCard.every((r) => r.first === r.expect && r.n === 3),
  JSON.stringify(evoCard.map((r) => `${r.weapon}→${r.first}`)));

// A1f：終形（沒有 next）不再給武器卡，但仍然給滿 3 張
const maxedCards = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  const ps = G.playerStats;
  const backup = { weapon: ps.weapon, route: ps.route };
  ps.weapon = 'FORTRESS'; ps.route = 'D';
  const cards = T.generateUpgradeOptions();
  Object.assign(ps, backup);
  return { n: cards.length, hasWeapon: cards.some((c) => c.type === 'weapon') };
});
ok('A1f 武器已達終形時不再出武器卡，但還是給滿 3 張',
  maxedCards.n === 3 && maxedCards.hasWeapon === false, JSON.stringify(maxedCards));

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
//
// 而且要用 stepTicks 同步推進、不要靠真實時間：headless 的 rAF 可能只有 8 fps，
// 用 `setTimeout(200)` 等於「等 1~2 幀」，事件可能還沒到期 → 假紅。
// 這裡同時守住「VS 難度的每 60 tick 重算不會把事件修飾子吃掉」：
// 舊版 SURGE 直接改基準值，updateVSModeDifficulty() 一重算就整個失效。
const surge = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;          // 前面的關卡結算測試會把狀態留在 levelComplete
  G.isVSMode = true;
  G.spawnInterval = 18;
  G.spawnIntervalMul = 1;
  G.vsModeStartFrame = 0;             // 讓 VS 難度曲線算出 phase 0（基準＝18），才好驗「重算不會吃掉修飾子」
  G.spawnTimer = 1e9;                 // 不要讓生成端插進來改狀態
  G.maxEnemies = 1e9; G.enemiesSpawned = 0;   // 不要讓 checkLevelComplete 把狀態踢出 PLAYING（之後的 step 就不會跑）
  const before = T.effectiveSpawnInterval();
  T.DIRECTOR_EVENTS.SURGE.activate();
  const during = T.effectiveSpawnInterval();

  // 讓 VS 難度曲線跑過一輪重算（frameCount % 60 === 0），修飾子必須還在
  G.directorEvents.length = 0;
  G.directorEvents.push({ name: 'x', desc: 'x', life: 600, type: 'SURGE' });
  G.frameCount = 59; step(1);         // → 60：updateVSModeDifficulty 重算基準
  const afterDifficultyTick = T.effectiveSpawnInterval();
  const baseAfterTick = G.spawnInterval;

  // 讓事件到期（life 600 → 0），deactivate 必須把間隔還原
  G.directorEvents[0].life = 1;
  step(1);
  const afterExpiry = T.effectiveSpawnInterval();
  function step(n) { for (let i = 0; i < n; i++) { if (G.state === T.STATE.PLAYING) T.update(); else break; } }
  return { before, during, baseAfterTick, afterDifficultyTick, afterExpiry, mul: G.spawnIntervalMul };
});
ok('E1 SURGE 會減半、VS 難度重算不會吃掉修飾子、事件到期會還原生成間隔',
  surge.during === Math.round(surge.before * 0.5)
  && surge.afterDifficultyTick === surge.during
  && surge.afterExpiry === surge.before
  && surge.mul === 1,
  JSON.stringify(surge));

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
  // 用 stepTicks 同步推進，不要靠 rAF：headless 的 rAF 可能只有 8 fps，等 120ms 有時連一幀都沒有
  // （這一條就因此紅過）。checkLevelComplete 是每 tick 檢查的，跑 3 個 tick 足夠。
  T.stepTicks(3);                        // → levelComplete（由每 tick 的 checkLevelComplete）
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

// F6：帶道具的敵人（glowTimer）在 render 路徑上必須畫得出來 ——
// 這裡曾經是「呼叫了不存在的 helper（glowCanvas）」，導致每一幀、每一隻帶道具的敵人
// 都丟 ReferenceError：遊戲被 try/catch 撐住繼續跑，但該幀 render 的後半段全被跳過，
// 畫面還會一直顯示錯誤橫幅。這條同時守住「渲染路徑不能拋錯」。
//
// 同步呼叫 update()／render() 而不是等 rAF：一次 render 一定扣一次 glowTimer，
// 所以「等了 600ms 卻一幀都沒畫」在慢主機上會變成假紅（實測 headless 只有 8.8 fps）。
const glowEnemy = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  const banner = document.getElementById('errorBanner');
  if (banner) { banner.style.display = 'none'; banner.textContent = ''; }
  G.state = T.STATE.PLAYING;
  G.maxEnemies = 1e9; G.enemiesSpawned = 0;   // 不要讓關卡結算清掉場景
  G.enemies.length = 0;
  const e = new T.Tank(T.TILE * 3, T.TILE * 3, T.DOWN, 'NORMAL', false);
  e.hp = e.maxHp = 99; e.glowTimer = 30; e.hasPowerUp = true;
  G.enemies.push(e);
  let thrown = null;
  try {
    for (let i = 0; i < 5; i++) { T.update(); T.render(); }
  } catch (err) {
    thrown = String((err && err.message) || err);
  }
  return {
    glowTimer: e.glowTimer,
    thrown,
    bannerShown: banner ? getComputedStyle(banner).display !== 'none' : false,
    bannerText: banner ? banner.textContent.slice(0, 60) : '',
  };
});
ok('F6 帶道具敵人的發光渲染不會拋錯（glowCanvas 事件：呼叫了不存在的 helper）',
  glowEnemy.thrown === null && glowEnemy.bannerShown === false && glowEnemy.glowTimer === 25,
  JSON.stringify(glowEnemy));

console.log('\n=== G. 地圖事件（M4：被寫入端掃描揪出的死子系統） ===');
// G1：rollMapEvent() 的結果必須真的被 activate。舊版只把它塞進一個從來沒人讀的 G.mapEvent，
//     activateMapEvent() 因此沒有任何呼叫端 → updateMapEvent() 與 6 種事件效果全是死碼。
const mapEventWiring = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  const VS = T.CONFIG.GAMEPLAY.VS_MODE_INTERVAL;   // VS 關卡是 10 的倍數（L10、L20…）
  G.state = T.STATE.PLAYING;
  // 逐個 seed 走「正式入口」startLevel()，直到擲中事件（20% 機率，60 次內必中）
  let tries = 0, hit = null;
  for (let s = 1; s <= 60 && !hit; s++) {
    G.level = VS;
    G.directorEvents.length = 0;
    T.deactivateMapEvent();
    T.setRngState(s);
    const multBefore = G.playerStats.speedMult;
    T.startLevel();
    tries++;
    if (T.mapEventState.active) {
      hit = {
        seed: s, type: T.mapEventState.type, timer: T.mapEventState.timer,
        banners: G.directorEvents.length, bannerText: G.directorEvents.map((e) => `${e.name}／${e.desc}`).join('|'),
        multBefore, multAfter: G.playerStats.speedMult,
      };
    }
  }
  return { tries, hit };
});
ok('G1 startLevel 會啟動 rollMapEvent() 擲到的地圖事件並公告（舊版整條子系統都是死碼）',
  mapEventWiring.hit !== null && mapEventWiring.hit.timer > 0
  && mapEventWiring.hit.banners > 0 && mapEventWiring.hit.bannerText.length > 0
  && (mapEventWiring.hit.type !== 'DESERT'
      || Math.abs(mapEventWiring.hit.multAfter / mapEventWiring.hit.multBefore - 0.7) < 1e-9),
  JSON.stringify(mapEventWiring));

// G2：DESERT 的減速要真的生效、到期要還原（舊版描述寫了「移速 -30%」卻完全沒實作）
const desert = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  T.deactivateMapEvent();
  T.applyPlayerSpeed();
  const before = { mult: G.playerStats.speedMult, speed: G.player.speed };
  T.activateMapEvent(T.MAP_EVENTS.find((e) => e.id === 'DESERT'));
  T.applyPlayerSpeed();                    // 玩家速度要跟著事件改變
  const during = { mult: G.playerStats.speedMult, speed: G.player.speed, active: T.mapEventState.active };
  T.mapEventState.timer = 1;
  T.updateMapEvent(); T.updateMapEvent();  // 時間到 → deactivate
  T.applyPlayerSpeed();
  const after = { mult: G.playerStats.speedMult, speed: G.player.speed, active: T.mapEventState.active };
  return { before, during, after, ratio: during.mult / before.mult };
});
ok('G2 DESERT 真的套用移速 -30%、玩家速度跟著變，事件到期完全還原',
  Math.abs(desert.ratio - 0.7) < 1e-9 && desert.during.speed < desert.before.speed
  && desert.after.active === false && Math.abs(desert.after.mult - desert.before.mult) < 1e-9
  && Math.abs(desert.after.speed - desert.before.speed) < 1e-9,
  JSON.stringify(desert));

// G3：ICE = 真正的滑行慣性（放開方向後仍會滑行），而不是偷偷乘一個速度係數
const ice = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.enemies.length = 0;
  G.enemiesSpawned = 0; G.maxEnemies = 1e9;      // 不要讓關卡在測試中途結算／換關
  G.spawnTimer = 1e9; G.spawnInterval = 1e9;
  G.playerStats.hp = 99; G.player.hp = 99; G.player.alive = true;
  T.deactivateMapEvent();
  T.applyPlayerSpeed();
  const p = G.player;
  const multBefore = G.playerStats.speedMult;

  T.activateMapEvent(T.MAP_EVENTS.find((e) => e.id === 'ICE'));
  const multDuring = G.playerStats.speedMult;

  // 全部用 stepTicks() 同步推進（不受 rAF 與殘留 setTimeout 換關影響）
  T.input.right = true; T.input.left = false; T.input.up = false; T.input.down = false;
  T.stepTicks(4);
  const xHeld = p.x;
  const slideDirHeld = T.mapEventState.slideDir;
  T.input.right = false;                          // 放開所有方向
  const slideTicksHeld = T.mapEventState.slideTicks;

  let movingSamples = 0;
  for (let i = 0; i < 8; i++) { T.stepTicks(1); if (p.moving) movingSamples++; }
  const xAfterSlide = p.x;

  T.stepTicks(40);                                // 滑行量用完之後必須停下來
  const stoppedMoving = p.moving === false;
  const sameTank = G.player === p;
  T.deactivateMapEvent();

  // 對照組：沒有 ICE 時放開方向會立刻停（滑行是事件造成的，不是移動本身的副作用）
  T.input.right = true; T.stepTicks(3); T.input.right = false; T.stepTicks(2);
  const noSlideMoving = p.moving;
  T.stepTicks(1);

  return { multBefore, multDuring, xHeld, xAfterSlide, slideDirHeld, slideTicksHeld,
    movingSamples, stoppedMoving, sameTank, noSlideMoving };
});
ok('G3 ICE 是滑行慣性：放開方向後仍沿最後方向滑行、滑完會停、且不改速度係數',
  ice.multDuring === ice.multBefore && ice.sameTank === true && ice.slideTicksHeld > 0
  && ice.xAfterSlide >= ice.xHeld && ice.movingSamples === 8 && ice.stoppedMoving === true
  && ice.noSlideMoving === false,
  JSON.stringify(ice));

// G4：EMP 不只要砍半場上既有的子彈，事件期間「新生成的」子彈也必須受影響
const emp = await page.evaluate(async () => {
  const T = window.__T;
  const bp = T.bulletsPool;
  bp.clear();
  const b = bp.acquire();
  b.x = 100; b.y = 100; b.isPlayer = true; b.alive = true; b.speed = 4; b.vx = 0; b.vy = 0;
  T.deactivateMapEvent();
  T.activateMapEvent(T.MAP_EVENTS.find((e) => e.id === 'EMP'));
  const during = b.speed;
  const active = T.mapEventState.type;

  // 事件期間生成的新子彈（標準生成點 spawnBullet）
  T.spawnBullet(120, 120, T.RIGHT, true, false, 1);
  const fresh = bp.active[bp.active.length - 1].speed;
  const full = T.CONFIG.BULLET.SPEED_PLAYER;

  T.deactivateMapEvent();
  bp.clear();
  T.spawnBullet(120, 120, T.RIGHT, true, false, 1);
  const afterEvent = bp.active[bp.active.length - 1].speed;
  bp.clear();
  return { during, active, fresh, full, afterEvent };
});
ok('G4 EMP 事件會讓子彈速度減半（場上既有的＋事件期間新生成的都算，事件結束後恢復）',
  emp.during === 2 && emp.active === 'EMP' && emp.fresh === emp.full * 0.5 && emp.afterEvent === emp.full,
  JSON.stringify(emp));

// G5：VOLCANIC 會真的產生火山落點（舊版 updateMapEvent 沒有任何呼叫端）
const volcanic = await page.evaluate(async () => {
  const T = window.__T;
  T.deactivateMapEvent();
  T.activateMapEvent(T.MAP_EVENTS.find((e) => e.id === 'VOLCANIC'));
  const cleared = T.mapEventState.volcanoTargets.length;
  for (let i = 0; i < 91; i++) T.updateMapEvent();
  const spawned = T.mapEventState.volcanoTargets.length;
  T.deactivateMapEvent();
  return { cleared, spawned };
});
ok('G5 VOLCANIC 事件會產生火山落點（updateMapEvent 的時間軸真的有在跑）',
  volcanic.cleared === 0 && volcanic.spawned > 0, JSON.stringify(volcanic));

// G6：六種事件都能被啟動並在到期時關閉（不會有事件卡住不還原）
const allEvents = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.enemies.length = 0;
  G.playerStats.hp = 99; G.player.hp = 99;
  const mult0 = G.playerStats.speedMult;
  const out = [];
  for (const ev of T.MAP_EVENTS) {
    T.deactivateMapEvent();
    T.activateMapEvent(ev);
    const activated = T.mapEventState.active && T.mapEventState.type === ev.id;
    T.mapEventState.timer = 1;
    for (let i = 0; i < 2; i++) T.updateMapEvent();
    out.push({ id: ev.id, activated, closed: T.mapEventState.active === false });
  }
  T.deactivateMapEvent(); T.applyPlayerSpeed();
  return { out, multRestored: Math.abs(G.playerStats.speedMult - mult0) < 1e-9 };
});
ok('G6 六種地圖事件都能啟動、到期都會關閉，且速度係數完全還原',
  allEvents.out.length === 6 && allEvents.out.every((e) => e.activated && e.closed) && allEvents.multRestored,
  JSON.stringify(allEvents));

// G7：TOXIC 每秒真的扣血（事件效果不是只有橫幅）
const toxic = await page.evaluate(async () => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.playerStats.hp = 5; G.playerStats.maxHp = 5;
  T.deactivateMapEvent();
  T.activateMapEvent(T.MAP_EVENTS.find((e) => e.id === 'TOXIC'));
  G.frameCount = 60;                 // 讓 frameCount % 60 === 0 成立
  const before = G.playerStats.hp;
  T.updateMapEvent();
  const drained = G.playerStats.hp;
  G.frameCount = 61;                 // 同一秒內不會重複扣
  T.updateMapEvent();
  const same = G.playerStats.hp;
  T.deactivateMapEvent();
  return { before, drained, same };
});
ok('G7 TOXIC 事件每秒會扣玩家血量（且同一秒內只扣一次）',
  toxic.drained < toxic.before && toxic.same === toxic.drained, JSON.stringify(toxic));

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
//
// 這裡刻意不用「900ms 內要推進幾幀」當門檻：headless 的 rAF 取決於主機負載，實測一台機器上
// 空頁面只有 8.8 fps → 舊門檻（>20 幀）在那台機器上永遠紅，但遊戲其實沒有凍結。
// 凍結的定義是「frameCount 不再前進」，所以改成等待「再前進 2 幀」並給 5 秒上限 ——
// 真的凍結（rAF 沒有被重新排程）會等到逾時，語意不變、也不依賴主機速度。
const freezeBefore = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.enemies.push(null);                     // 故意讓 render/update 丟例外
  const banner = document.getElementById('errorBanner');
  if (banner) { banner.style.display = 'none'; banner.textContent = ''; }
  return G.frameCount;
});
let freezeAdvanced = true;
try {
  await page.waitForFunction((n) => window.__T.G.frameCount > n + 1, freezeBefore, { timeout: 5000 });
} catch { freezeAdvanced = false; }
const freeze = await page.evaluate(() => {
  const G = window.__T.G;
  const banner = document.getElementById('errorBanner');
  const shown = banner && getComputedStyle(banner).display !== 'none';
  const text = banner ? banner.textContent.slice(0, 40) : '';
  G.enemies = G.enemies.filter(Boolean);
  return { frameCount: G.frameCount, bannerShown: shown, bannerText: text };
});
ok('B7 執行期例外不會讓遊戲凍結（rAF 仍被排程、錯誤提示顯示），且移除壞資料後可續玩',
  freezeAdvanced && freeze.bannerShown, JSON.stringify({ freezeAdvanced, ...freeze }));

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
  // WH40K 素材載入後直接貼素材圖（同樣 1 次 drawImage、0 次 fillRect），程序化快取不會被建
  eagle.fillRects === 0 && eagle.drawImages === 2 && (eagle.cached || eagle.fillStyles === 0), JSON.stringify(eagle));

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
// 素材版不設 textAlign（維持預設 start），只要不是 center 就沒洩漏
ok('C7 道具圖示繪製後 textAlign 不會洩漏（避免後續文字位置偏掉）',
  align.textAlign !== 'center' && /ctx\.textAlign = 'left';\s*\/\/ 舊版只還原 globalAlpha/.test(source),
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

// C9：遊戲中的 render 不再有「全螢幕填色」——底色已經烘在 staticCanvas 裡
//     （舊版每幀一次 1040×1040 的 fillRect ≈ 0.32 ms，DPR 2）
const fullScreenFills = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.enemies.length = 0;
  const c = T.ctx;
  const orig = c.fillRect;
  let full = 0;
  c.fillRect = function (x, y, w, h) { if (w >= T.W && h >= T.H) full++; return orig.call(c, x, y, w, h); };
  T.render();
  c.fillRect = orig;
  return { full, canvasW: T.canvas.width, renderScale: T.canvas.width / T.W };
});
ok('C9 遊戲中的 render 沒有全螢幕填色（底色烘進 staticCanvas）',
  fullScreenFills.full === 0, JSON.stringify(fullScreenFills));

// C10：樹林逐格貼、不再整張貼回（舊版每幀一次全螢幕 drawImage 透明圖層 ≈ 1.1 ms）
//     判準：9 參數、來源寬度 = (TILE+2)×scale 的貼圖次數要等於樹的格數；
//     來源寬度 ≥ 整張畫布的貼圖只能有 1 次（staticCanvas 背景）。舊版會有 2 次。
const forestBlit = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.enemies.length = 0;                  // 只看背景／樹林這兩層，敵人的 sprite 貼圖不列入
  G.map = T.generateMap(10);             // VS 地圖有樹
  G.isVSMode = true;
  T.cacheStaticMap();
  const tiles = G.forestTiles.length;
  const scale = T.canvas.width / T.W;
  const c = T.ctx;
  const orig = c.drawImage;
  const tileSized = [], fullSized = [];
  c.drawImage = function (...a) {
    if (a.length >= 9) {
      const srcW = a[3];
      if (srcW === (T.TILE + 2) * scale) tileSized.push(srcW);
      else if (srcW >= T.W * scale) fullSized.push(srcW);
    } else if (a.length === 5 && a[3] >= T.W) fullSized.push(a[3]);
    return orig.apply(c, a);
  };
  T.render();
  c.drawImage = orig;
  return { tiles, tileBlits: tileSized.length, fullBlits: fullSized.length, scale };
});
ok('C10 樹林逐格貼（28×scale 的貼圖次數 = 樹的格數）、全螢幕貼圖只剩 staticCanvas 1 次',
  forestBlit.tiles > 0 && forestBlit.tileBlits === forestBlit.tiles && forestBlit.fullBlits === 1,
  JSON.stringify(forestBlit));

// C11：暫停時畫面靜止 → 同一個 frameCount 只畫一次（不再每秒 60 次重繪整個戰場）
const pausedRender = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  T.render();                          // 離開 PAUSED：重設暫停快取
  G.state = T.STATE.PAUSED;
  const c = T.ctx;
  let calls = 0;
  const names = ['fillRect', 'drawImage', 'fillText'];
  const saved = {};
  for (const n of names) { saved[n] = c[n]; c[n] = function (...a) { calls++; return saved[n].apply(c, a); }; }
  T.render();                          // 第一幀：要畫（calls > 0）
  const first = calls;
  calls = 0;
  T.render();                          // 同一 frameCount：跳過
  const second = calls;
  for (const n of names) c[n] = saved[n];
  return { first, second, pausedFrames: G.frameCount };
});
ok('C11 暫停時同一個 frameCount 只重畫一次（第二次 render 0 次 canvas 呼叫）',
  pausedRender.first > 0 && pausedRender.second === 0, JSON.stringify(pausedRender));

// C12：暫停時玩家坦克不會消失（舊版 render 只在 PLAYING 畫玩家 → 按 P 之後自己那格變空白）
const pausedPlayer = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  T.render();
  const drawn = { playing: 0, paused: 0, gameover: 0 };
  const orig = G.player.draw;
  G.player.draw = function () { drawn[G.state] = (drawn[G.state] || 0) + 1; return orig.call(G.player); };
  T.render();                                  // playing
  G.state = T.STATE.PAUSED;
  T.frameCount++;                              // 換一幀，否則會被「暫停不重畫」的快取跳過
  T.render();                                  // paused
  G.state = T.STATE.GAMEOVER;
  T.render();                                  // gameover 不該畫
  G.player.draw = orig;
  return drawn;
});
ok('C12 暫停時玩家坦克仍會畫出來（舊版按 P 之後自己的坦克當場消失）',
  pausedPlayer.playing > 0 && pausedPlayer.paused > 0 && !pausedPlayer.gameover,
  JSON.stringify(pausedPlayer));

console.log('\n=== H. BOSS 原型與連擊獎勵（遊戲性）===');
// H1：三種 BOSS 原型輪替，數值真的從資料表來（舊版每隻王都是同一個紅坦克）
const bossArch = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  const out = [];
  for (const level of [5, 10, 15, 20]) {
    G.level = level;
    const e = new T.Tank(T.TILE * 5, T.TILE * 3, T.DOWN, 'BOSS', false);
    const arch = T.BOSS_TYPES[e.bossType];
    out.push({
      level, bossType: e.bossType,
      hpOK: e.maxHp === Math.round((15 + level * 5) * arch.hpMult),
      sizeOK: Math.abs(e.size - T.TILE * arch.sizeMult) < 1e-9,
      speedOK: Math.abs(e.speed - 0.6 * arch.speedMult) < 1e-9,
      pattern: arch.pattern,
    });
  }
  return out;
});
ok('H1 第 5／10／15 關是三種不同原型，血量／體型／速度都依資料表計算',
  bossArch[0].bossType === 'SIEGE' && bossArch[1].bossType === 'HUNTER' && bossArch[2].bossType === 'SWARMER'
  && bossArch[3].bossType === 'SIEGE'
  && bossArch.every((b) => b.hpOK && b.sizeOK && b.speedOK),
  JSON.stringify(bossArch.map((b) => `${b.level}:${b.bossType}/${b.pattern}`)));

// H2：攻城核心會炮擊（砲彈是真的在飛的子彈），砲彈爆炸會傷到落點附近的玩家
const siegeFight = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.isVSMode = false; G.maxEnemies = 1e9; G.enemiesSpawned = 0; G.spawnTimer = 1e9;
  G.enemies.length = 0; G.aliveEnemies = 0;
  T.bulletsPool.clear(); T.particlesPool.clear();
  T.fx.clearAll();
  G.playerStats.hp = 9; G.player.hp = 9; G.player.alive = true;
  G.player.x = T.TILE * 9; G.player.y = T.TILE * 14;
  G.level = 5;
  const boss = new T.Tank(T.TILE, T.TILE * 2, T.DOWN, 'BOSS', false);
  G.enemies.push(boss); G.aliveEnemies = 1;

  let seenShells = 0;
  for (let i = 0; i < 130; i++) {
    T.update();
    const n = T.bulletsPool.active.filter((b) => b.shell).length;
    if (n > seenShells) seenShells = n;
  }
  const shellCount = T.bulletsPool.active.filter((b) => b.shell).length;

  // 爆炸傷害：把一顆砲彈放在玩家旁邊引爆（引信到期）
  const hpBefore = G.player.hp;
  T.bulletsPool.clear();
  const mkShell = (fuse) => {
    const sh = T.bulletsPool.acquire();
    sh.shell = true; sh.shellBoss = 'SIEGE'; sh.fuse = fuse;
    sh.vx = 0; sh.vy = 0; sh.speed = 0; sh.isPlayer = false;
    sh.x = G.player.x + 4; sh.y = G.player.y + 4;
    return sh;
  };
  mkShell(1);
  T.update();
  const hpAfter = G.player.hp;

  // 直接撞到玩家也是「爆炸」，不是普通子彈命中（同一條傷害路徑，護盾／無敵判定只有一份）
  G.player.flashTimer = 0;
  G.player.hp = 9;
  T.bulletsPool.clear();
  mkShell(100);
  T.update();
  const hpContact = G.player.hp;
  const shellsLeft = T.bulletsPool.active.filter((b) => b.shell && b.alive).length;
  T.bulletsPool.clear();
  return { seenShells, shellCount, hpBefore, hpAfter, hpContact, shellsLeft };
});
ok('H2 攻城核心會發射砲彈（子彈池裡出現 shell）；引信到期與直接命中都會引爆並傷到玩家',
  siegeFight.seenShells > 0
  && siegeFight.hpAfter === siegeFight.hpBefore - 1
  && siegeFight.hpContact === 8 && siegeFight.shellsLeft === 0,
  JSON.stringify(siegeFight));

// H3：獵殺者會蓄力→高速衝刺→撞碎磚牆 →撞到鋼板才硬直（硬直期間完全不能動）
//     場地自己鋪：把一條縱向走廊清空、底部放鋼板，這樣測試不受「上一條測試留下的地圖」影響。
const hunterFight = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.isVSMode = false; G.maxEnemies = 1e9; G.enemiesSpawned = 0; G.spawnTimer = 1e9;
  G.enemies.length = 0; G.aliveEnemies = 0;
  T.bulletsPool.clear(); T.fx.clearAll();
  G.playerStats.hp = 9; G.player.hp = 9; G.player.alive = true;
  G.level = 10;

  const COLS = G.map[0].length;
  const fill = (r0, r1, c0, c1, v) => {
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) G.map[r][c] = v;
  };
  // 走廊：col 2~4、row 1~12 清空；底部 row 12 鋪鋼板（衝到那裡才會被擋住）
  fill(1, 12, 2, 4, T.EMPTY);
  fill(12, 12, 2, 4, T.STEEL);
  // 走廊中間放一堵磚牆：驗「衝刺會把磚牆撞碎」
  const brickR = 6;
  fill(brickR, brickR, 2, 3, T.BRICK);

  const boss = new T.Tank(T.TILE * 2, T.TILE * 3, T.DOWN, 'BOSS', false);
  boss.aiChangeTimer = 1e9;      // 蓄力期間不要重新擲骰：讓「往南衝」這件事不依賴全域亂數流
  G.enemies.push(boss); G.aliveEnemies = 1;
  G.player.x = T.TILE * 2; G.player.y = T.TILE * 15;

  let chargeTicks = 0, dashDist = 0, stunTicks = 0, stunMoved = 0, stunEpisodes = 0, wasStunned = false;
  let brickBefore = 0;
  for (let r = brickR; r <= brickR; r++) for (let c = 2; c <= 3; c++) if (G.map[r][c] === T.BRICK) brickBefore++;

  for (let i = 0; i < 600; i++) {
    const x0 = boss.x, y0 = boss.y;
    T.update();
    const step = Math.abs(boss.x - x0) + Math.abs(boss.y - y0);
    if (boss.chargeTicks > 0) { chargeTicks++; dashDist += step; }
    if (boss.stunTicks > 0) {
      stunTicks++;
      if (!wasStunned) stunEpisodes++;      // 新的一段硬直：只累計「硬直期間」的位移
      else stunMoved += step;
    }
    wasStunned = boss.stunTicks > 0;
  }

  let brickAfter = 0;
  for (let r = brickR; r <= brickR; r++) for (let c = 2; c <= 3; c++) if (G.map[r][c] === T.BRICK) brickAfter++;
  return {
    chargeTicks, dashDist: +dashDist.toFixed(1), stunTicks, stunMoved: +stunMoved.toFixed(1), stunEpisodes,
    bricksBroken: brickBefore - brickAfter, brickBefore, bossY: +boss.y.toFixed(0),
  };
});
ok('H3 獵殺者會衝刺（位移 > 2 格）→ 撞碎磚牆 → 撞到鋼板才硬直（硬直期間不動）',
  hunterFight.chargeTicks > 0 && hunterFight.dashDist > T_TILE_FOR_TEST() * 2
  && hunterFight.bricksBroken > 0
  && hunterFight.stunEpisodes > 0 && hunterFight.stunMoved < 8,
  JSON.stringify(hunterFight));

// H4：蜂巢母艦會依 spawnCooldown 生出小兵
const swarmerFight = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  G.isVSMode = false; G.maxEnemies = 1e9; G.enemiesSpawned = 0; G.spawnTimer = 1e9;
  G.enemies.length = 0; G.aliveEnemies = 0;
  T.bulletsPool.clear(); T.fx.clearAll();
  G.playerStats.hp = 9; G.player.hp = 9; G.player.alive = true;
  G.level = 15;
  const arch = T.BOSS_TYPES.SWARMER;
  const boss = new T.Tank(T.TILE, T.TILE * 2, T.DOWN, 'BOSS', false);
  G.enemies.push(boss); G.aliveEnemies = 1;
  const before = G.enemiesSpawned;
  for (let i = 0; i < arch.spawnCooldown + 5; i++) T.update();
  return { delta: G.enemiesSpawned - before, expect: arch.spawnCount, enemies: G.enemies.length };
});
ok('H4 蜂巢母艦會在冷卻後召喚 spawnCount 隻小兵',
  swarmerFight.delta === swarmerFight.expect && swarmerFight.enemies >= 2,
  JSON.stringify(swarmerFight));

// H5：連擊里程碑（每 every 連擊）會加分並掉一個道具
const comboReward = await page.evaluate(() => {
  const T = window.__T, G = T.G;
  G.isVSMode = false;
  G.powerUps.length = 0;
  G.playerStats.combo = 0;
  G.player.alive = true;
  const score0 = G.score;
  const steps = [];
  for (let i = 0; i < 10; i++) {
    T.addCombo(true);
    steps.push({ combo: G.playerStats.combo, score: G.score, drops: G.powerUps.length });
  }
  const at9 = steps[8], at10 = steps[9];
  return {
    expectEvery: T.COMBO_REWARDS.every,
    scoreJump: at10.score - at9.score,
    dropsAt10: at10.drops,
    dropType: G.powerUps[0] && G.powerUps[0].type,
    poolHas: T.COMBO_REWARDS.pool.includes(G.powerUps[0] && G.powerUps[0].type),
    totalGain: G.score - score0,
  };
});
ok('H5 每 10 連擊會額外加分並掉一個 COMBO_REWARDS.pool 內的道具',
  comboReward.expectEvery === 10 && comboReward.dropsAt10 === 1
  && comboReward.totalGain >= 100 && comboReward.dropType && comboReward.poolHas,
  JSON.stringify(comboReward));

console.log(`\n${passed} passed, ${failed} failed  (pageerror: ${pageErrors.length})`);
await browser.close();
if (server) server.close();
process.exit(failed ? 1 : 0);
