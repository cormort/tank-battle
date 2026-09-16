// 單檔打包（M4）：把 index.html 的 ESM 依賴內聯成一個 dist/index.html。
//
//   node tools/build-single-file.mjs            # 產出 dist/index.html
//   node tools/build-single-file.mjs --check    # 只檢查是否需要重建（CI 用，離開碼 1 = 需要重建）
//
// 為什麼要這個：拆成模組之後，GitHub Pages 直接服務 ESM 沒問題，但「單檔」有三個好處 ——
// 離線／file:// 開啟、只有一個請求、以及回退到這次重寫之前的部署形態。
//
// 為什麼自己寫而不用 esbuild：這個專案沒有建置流程、也沒有 npm 依賴，而需要處理的語法只有
// `import { a, b } from './x.js'`（全都是相對路徑的具名匯入）。自己寫 100 行的內聯器，
// 讓「打包」這件事仍然零依賴；正確性由 tools/verify-bundle.mjs 用 replay checksum 把關
// （打包後的行為必須與模組版完全相同）。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ENTRY = join(ROOT, 'index.html');
const OUT_DIR = join(ROOT, 'dist');
const OUT = join(OUT_DIR, 'index.html');
const ENTRY_OWNER = Symbol('entry');   // 供碰撞偵測標記「進入點」這一份

/** 收集一個模組檔案的所有相對匯入（遞迴、深度優先、去重）。 */
function collectModules(file, seen = new Set(), order = []) {
  const abs = resolve(file);
  if (seen.has(abs)) return order;
  seen.add(abs);

  const source = readFileSync(abs, 'utf8');
  const deps = [];
  // 一般匯入（可跨行）
  for (const match of source.matchAll(/^import\s+[\s\S]*?from\s*['"](\.[^'"]+)['"];?/gm)) {
    deps.push(resolve(dirname(abs), match[1]));
  }
  // re-export 也是相依（`export { a } from './x.js'`）—— 先前只把它刪掉而沒有追進去，
  // 導致 src/data/index.js 轉出的 events.js 沒有被內聯，打包版直接 ReferenceError。
  for (const match of source.matchAll(/^export\s*{[\s\S]*?}\s*from\s*['"](\.[^'"]+)['"];?/gm)) {
    deps.push(resolve(dirname(abs), match[1]));
  }
  deps.forEach((dep) => collectModules(dep, seen, order));
  order.push(abs);
  return order;
}

/** 拿掉模組語法：import 整行移除、`export ` 前綴移除、re-export 展開。 */
function stripModuleSyntax(source) {
  return source
    // 具名匯入：`import { a, b as c } from './x.js'` —— 內聯之後所有模組共用一個作用域，
    // 未取別名的名字本來就在，但**取別名的要改寫成 `const c = b;`**，
    // 否則進入點用的是別名（例如 detectMobileDevice）會變成 undefined。
    .replace(/^import\s*{([\s\S]*?)}\s*from\s*['"][^'"]+['"];?/gm, (_all, names) => names
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.split(/\s+as\s+/).map((x) => x.trim()))
      .filter((pair) => pair.length === 2)
      .map(([original, alias]) => `const ${alias} = ${original};`)
      .join('\n'))
    // 其餘匯入形式（預設匯入、namespace）直接移除
    .replace(/^import\s+[\s\S]*?from\s*['"][^'"]+['"];?/gm, '')
    // 純 side-effect：import './x.js';
    .replace(/^import\s*['"][^'"]+['"];?/gm, '')
    // export { a, b } from './x.js' → 由來源模組提供，這裡直接刪除
    .replace(/^export\s*{[\s\S]*?}\s*from\s*['"][^'"]+['"];?/gm, '')
    // export { a, b };（沒有 from）
    .replace(/^export\s*{[\s\S]*?};?/gm, '')
    // export const/let/function/class → 去掉 export 前綴
    .replace(/^export\s+(const|let|var|function|class|async function)\b/gm, '$1');
}

function buildBundle() {
  const html = readFileSync(ENTRY, 'utf8');
  const scriptTag = /<script type="module">([\s\S]*?)<\/script>/;
  const found = html.match(scriptTag);
  if (!found) throw new Error('index.html 找不到 <script type="module">');

  const entryCode = found[1];
  // 找出進入點自己的相對匯入，收集所有相依模組
  const entryImports = [...entryCode.matchAll(/^import\s+(?:{[^}]*})\s+from\s+['"](\.[^'"]+)['"];?/gm)]
    .map((m) => resolve(ROOT, m[1]));

  // 去重要用同一個 Set：先前每個進入點 import 各給一個新 Set，
  // 導致被多處匯入的模組（例如 platform/input.js 也被 touch-ui.js 匯入）被內聯兩次 → 重複宣告。
  const modules = [];
  const seen = new Set();
  entryImports.forEach((dep) => collectModules(dep, seen, modules));

  const parts = modules.map((file) => {
    const rel = relative(ROOT, file);
    const body = stripModuleSyntax(readFileSync(file, 'utf8')).trim();
    return `// ── ${rel} ──\n${body}`;
  });

  // 注意：模組內容（parts）必須排在進入點之前 —— 進入點在載入時就會用到它們。
  const bundled = [
    '/* 由 tools/build-single-file.mjs 產生 —— 請勿直接編輯；改 src/ 或 index.html 後重新打包。',
    ` * 內含 ${modules.length} 個模組：${modules.map((f) => relative(ROOT, f)).join('、')}`,
    ' */',
    ...parts,
    stripModuleSyntax(entryCode).trim(),
  ].join('\n');

  // 打包器自己的防線：產出的 JS 不能殘留任何模組語法（多行 import 就曾經漏掉）
  const leftovers = bundled.split('\n').filter((line) => /^\s*(import|export)\s/.test(line));
  if (leftovers.length > 0) {
    throw new Error(`打包後仍有模組語法：\n${leftovers.slice(0, 3).join('\n')}`);
  }

  // 第二道防線：內聯後所有模組共用一個作用域，任何**頂層宣告同名**都會互相覆蓋
  // （實測：進入點的 detectMobile 蓋掉 viewport 的同名匯出 → 別名指向自己 → 無限遞迴）。
  const owner = new Map();
  const collisions = [];
  for (const file of [...modules, ENTRY_OWNER]) {
    const code = file === ENTRY_OWNER ? stripModuleSyntax(entryCode) : stripModuleSyntax(readFileSync(file, 'utf8'));
    for (const m of code.matchAll(/^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm)) {
      const name = m[1];
      const where = file === ENTRY_OWNER ? 'index.html' : relative(ROOT, file);
      if (owner.has(name) && owner.get(name) !== where) collisions.push(`${name}（${owner.get(name)} vs ${where}）`);
      else owner.set(name, where);
    }
  }
  if (collisions.length > 0) {
    throw new Error(`內聯後有 ${collisions.length} 個頂層名稱碰撞，請改名（否則打包版行為會與模組版不同）：\n  ${collisions.slice(0, 8).join('\n  ')}`);
  }

  const outputHtml = html.replace(scriptTag, `<script>\n${bundled}\n</script>`);
  return { html: outputHtml, moduleCount: modules.length, size: outputHtml.length };
}

const { html: outputHtml, moduleCount, size } = buildBundle();
const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : null;
const changed = current !== outputHtml;

if (process.argv.includes('--check')) {
  console.log(changed
    ? `dist/index.html 需要重建（${moduleCount} 個模組、${(size / 1024).toFixed(1)} KB）`
    : `dist/index.html 是最新的（${moduleCount} 個模組、${(size / 1024).toFixed(1)} KB）`);
  process.exit(changed ? 1 : 0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, outputHtml);
console.log(`已產出 dist/index.html（內聯 ${moduleCount} 個模組、${(size / 1024).toFixed(1)} KB）`);
