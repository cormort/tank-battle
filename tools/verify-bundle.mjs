// 單檔打包驗證（M4）。
//
//   node tools/verify-bundle.mjs
//
// 打包最容易出的錯是「打出來的檔案能開、但行為不一樣」（少內聯一個模組、多行 import 沒被處理、
// 順序錯導致 TDZ…）。所以這支工具的核心檢查是：**用同一份 replay 跑打包版，checksum 必須與
// 模組版完全相同** —— 也就是 tools/replays/smoke.json 記錄的那個值。
//
// 檢查：
//   B1 dist/index.html 存在、而且是最新的（build --check 通過）
//   B2 打包檔自足：沒有 import/export 語句、沒有對本地 .js 的請求
//   B3 打包版跑同一份 replay → checksum 與模組版一致（行為等價）
//   B4 ?bot 除錯介面齊全（測試與 replay 都靠它）
//   B5 打包檔沒有把工具鏈（tools/、驗證程式）也包進去
//
// 離開碼 1 表示有案例失敗。

import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PROBE_PORT || 8962);

let passed = 0, failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++; else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

console.log('=== B. 打包檔 ===');
const bundlePath = join(DIST, 'index.html');
if (!existsSync(bundlePath)) {
  ok('B1 dist/index.html 存在', false, '請先跑 node tools/build-single-file.mjs');
  console.log('\n0 passed, 1 failed');
  process.exit(1);
}
const bundle = readFileSync(bundlePath, 'utf8');

// B1：與來源同步（避免打包檔與 src/ 脫節）
let upToDate = true, checkDetail = '';
try {
  checkDetail = execFileSync(process.execPath, [join(ROOT, 'tools', 'build-single-file.mjs'), '--check'], { encoding: 'utf8' }).trim();
} catch (error) {
  upToDate = false;
  checkDetail = String(error.stdout || error.message).trim().split('\n').pop();
}
ok('B1 dist/index.html 與 src/ 同步（build --check 通過）', upToDate, checkDetail);

// B2：自足
const moduleSyntax = bundle.split('\n').filter((line) => /^\s*(import|export)\s/.test(line)).length;
const localImports = (bundle.match(/from\s+['"]\.\//g) || []).length;
ok('B2 打包檔自足：沒有模組語法、沒有相對匯入', moduleSyntax === 0 && localImports === 0,
  `模組語法 ${moduleSyntax} 行、相對匯入 ${localImports} 處`);

// B5：不該把工具鏈包進去
// 只看 <script> 內容（橫幅本身會寫出產生器檔名；HTML 的 CSS 註解在前面，
// 用「剝掉第一個註解」會抓錯區塊）
const bundleScript = (() => {
  const marker = '由 tools/build-single-file.mjs';
  const i = bundle.indexOf(marker);
  if (i < 0) return bundle;
  const tagStart = bundle.lastIndexOf('<script>', i) + '<script>'.length;   // 不要含標籤本身
  return bundle.slice(tagStart, bundle.indexOf('</script>', i));
})();
// 只看「真的會執行的工具鏈程式碼」：模組的註解提到 tools/verify-*.mjs 是正常的文件說明，
// 不是把工具包進來。這裡檢查的是檔案讀取、baseline 資料、replay 檔與 CLI 入口。
const toolLeak = /data-baseline|replays\/|process\.argv|readFileSync\(|require\(/.test(bundleScript);
ok('B5 打包檔沒有把驗證工具或工具鏈包進去', !toolLeak,
  toolLeak ? '內容含 tools/ 相關字串' : `${(bundle.length / 1024).toFixed(1)} KB`);

// ── 跑打包版，與模組版比對行為 ──
const MIME = { '.html': 'text/html; charset=utf-8', '.json': 'application/json' };
const server = createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = join(DIST, rel === '/' ? '/index.html' : rel);
  if (!file.startsWith(DIST) || !existsSync(file)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let pw;
try {
  pw = (await import(process.env.PW_MODULE || 'playwright')).default;
} catch {
  console.error('找不到 playwright。');
  server.close();
  process.exit(2);
}

const replay = JSON.parse(readFileSync(join(ROOT, 'tools', 'replays', 'smoke.json'), 'utf8'));
const browser = await pw.chromium.launch();
const page = await (await browser.newContext()).newPage();
const localJsRequests = [];
page.on('request', (req) => {
  const url = req.url();
  if (url.startsWith(`http://127.0.0.1:${PORT}`) && /\.js(\?|$)/.test(url)) localJsRequests.push(url);
});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));

await page.goto(`http://127.0.0.1:${PORT}/index.html?bot&sim&seed=${encodeURIComponent(replay.seed)}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__T && window.__T.G, undefined, { timeout: 20000 });
await page.getByRole('button', { name: 'START GAME' }).click();
await page.waitForTimeout(300);

const debugSurface = await page.evaluate(() => {
  const T = window.__T;
  return { hasG: !!T.G, stepTicks: typeof T.stepTicks, checksum: typeof T.gameChecksum, states: !!T.STATES, fx: !!T.fx };
});
ok('B4 ?bot 除錯介面齊全（replay 與測試都靠它）',
  debugSurface.hasG && debugSurface.stepTicks === 'function' && debugSurface.checksum === 'function' && debugSurface.states && debugSurface.fx,
  JSON.stringify(debugSurface));

const result = await page.evaluate(({ ticks, events }) => {
  const T = window.__T, G = T.G;
  G.state = T.STATE.PLAYING;
  const byTick = new Map();
  for (const ev of events || []) {
    if (!byTick.has(ev.tick)) byTick.set(ev.tick, []);
    byTick.get(ev.tick).push(ev);
  }
  for (let i = 0; i < ticks; i++) {
    for (const ev of byTick.get(i) || []) {
      document.dispatchEvent(new KeyboardEvent(ev.down ? 'keydown' : 'keyup', { code: ev.code, bubbles: true }));
    }
    T.stepTicks(1);
  }
  return { checksum: T.gameChecksum(), score: G.score, frames: G.frameCount };
}, replay);

ok('B3 打包版跑同一份 replay，checksum 與模組版一致（行為等價）',
  result.checksum === replay.checksum,
  `打包版 ${result.checksum} vs 模組版 ${replay.checksum}｜score ${result.score}｜${result.frames} ticks`);

// bot.js / data-collector.js 是 ?bot 模式會嘗試載入的「選用」除錯腳本（repo 內不存在，
// 載不到也不影響遊戲）—— 這兩個不算單檔自足的破口。
const unexpectedRequests = localJsRequests.filter((url) => !/\/(bot|data-collector)\.js$/.test(url));
ok('B2b 載入打包版時沒有請求任何本地 .js（單檔自足）',
  unexpectedRequests.length === 0, unexpectedRequests.slice(0, 3).join('、') || `0 個（略過選用的 bot.js／data-collector.js ${localJsRequests.length} 個）`);

ok('B6 打包版執行期間沒有未捕捉例外', pageErrors.length === 0, pageErrors.slice(0, 2).join(' | ') || '0 筆');

console.log(`\n${passed} passed, ${failed} failed`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
