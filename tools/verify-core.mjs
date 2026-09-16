// src/core 的單元測試（純 Node，不需要瀏覽器）。
//
//   node tools/verify-core.mjs
//
// 這裡測的是「執行期核心」的兩塊純邏輯，以及兩條架構契約：
//   E 時效系統（src/core/effects.js）：到期、延長、清除、到期 callback、快照
//   R 可重現亂數（src/core/rng.js）：同 seed 同序列、不同 seed 不同、state 存取可續跑
//   C 契約：遊戲程式碼只有一處呼叫 fx.tick()（單一遞減進入點）
//   C 契約：已遷移到 fx 的舊欄位不得再出現（避免兩份真相）
//
// 離開碼 1 表示有案例失敗。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeEffects } from '../src/core/effects.js';
import { makeRng, hashSeed, defaultSeed } from '../src/core/rng.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const gameSource = readFileSync(join(ROOT, 'index.html'), 'utf8');
const maskComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');
const gameCode = maskComments(gameSource);

let passed = 0, failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++; else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`);
};

console.log('=== E. 時效系統（src/core/effects.js）===');
{
  const fx = makeEffects();
  fx.set('invul', 3);
  ok('E1 set/has/left 基本語意', fx.has('invul') && fx.left('invul') === 3);

  const expiredAfter3 = [fx.tick(), fx.tick(), fx.tick()];
  ok('E2 到期時回傳在 expired 清單裡、之後 has() 為 false',
    expiredAfter3[2].includes('invul') && !fx.has('invul'),
    JSON.stringify(expiredAfter3));

  const fx2 = makeEffects();
  fx2.set('boost', 100);
  fx2.extend('boost', 50);          // 較短 → 不縮短
  const keepLong = fx2.left('boost');
  fx2.extend('boost', 300);         // 較長 → 延長
  ok('E3 extend 取較長者（連續吃到同一個道具不會縮短）',
    keepLong === 100 && fx2.left('boost') === 300, `${keepLong} → ${fx2.left('boost')}`);

  let firedWith = null;
  const fx3 = makeEffects();
  fx3.set('slow', 2, { onExpire: () => { firedWith = fx3.has('slow'); } });
  fx3.tick(); fx3.tick();
  ok('E4 到期 callback 會在「已移除」之後才呼叫', firedWith === false, `callback 看到 has=${firedWith}`);

  const fx4 = makeEffects();
  fx4.set('a', 5); fx4.set('b', 5);
  fx4.clear('a');
  const snap = fx4.snapshot();
  fx4.clearAll();
  ok('E5 clear／clearAll／snapshot 正確',
    !fx4.has('b') && Object.keys(snap).length === 1 && snap.b === 5, JSON.stringify(snap));

  const ticks = [];
  const fx5 = makeEffects();
  fx5.set('wall', 3, { onTick: (left) => ticks.push(left) });
  fx5.tick(); fx5.tick();
  ok('E6 onTick 取得遞減前的剩餘值', JSON.stringify(ticks) === '[3,2]', JSON.stringify(ticks));

  const fx6 = makeEffects();
  fx6.set('x', 0);
  ok('E7 set 0（或負數）等於立即清除', !fx6.has('x'));
}

console.log('\n=== R. 可重現亂數（src/core/rng.js）===');
{
  const a = makeRng(12345), b = makeRng(12345), c = makeRng(54321);
  const seqA = Array.from({ length: 8 }, () => a());
  const seqB = Array.from({ length: 8 }, () => b());
  const seqC = Array.from({ length: 8 }, () => c());
  ok('R1 同 seed 產生相同序列', JSON.stringify(seqA) === JSON.stringify(seqB), seqA.slice(0, 3).map((v) => v.toFixed(4)).join(','));
  ok('R2 不同 seed 產生不同序列', JSON.stringify(seqA) !== JSON.stringify(seqC));
  ok('R3 值域在 [0,1) 且不退化', seqA.every((v) => v >= 0 && v < 1) && new Set(seqA).size === seqA.length);

  const d = makeRng(999);
  d(); d();
  const saved = d.state();
  const afterTwo = [d(), d()];
  d.setState(saved);
  const replayed = [d(), d()];
  ok('R4 state 存取可以從中斷點續跑（replay 的基礎）',
    JSON.stringify(afterTwo) === JSON.stringify(replayed));

  ok('R5 hashSeed：數字字串與任意字串都能用、且穩定',
    hashSeed('12345') === 12345 && hashSeed('smoke') === hashSeed('smoke') && hashSeed('') === 1,
    `'smoke' → ${hashSeed('smoke')}`);
  ok('R6 defaultSeed 回傳 32 bit 正整數', Number.isInteger(defaultSeed()) && defaultSeed() > 0);

  const r = makeRng(7);
  const ints = Array.from({ length: 200 }, () => r.int(4));
  ok('R7 int(n) 落在 [0,n) 且每個值都出現過', ints.every((v) => v >= 0 && v < 4) && new Set(ints).size === 4);
}

console.log('\n=== C. 架構契約 ===');
{
  const tickCalls = (gameCode.match(/fx\.tick\(\)/g) || []).length;
  ok('C1 只有一個 fx.tick() 進入點（所有時效在同一個地方遞減）',
    tickCalls === 1, `找到 ${tickCalls} 處`);

  const migrated = ['invulTimer', 'barrierTimer', 'boostTimer', 'comboTimer', 'activeCooldown', 'wallTimer', 'timeFreezeTimer'];
  const leftovers = [];
  for (const field of migrated) {
    // 允許敵人自己的 slowTimer（每實體的計時器，未遷移），其餘欄位不得再以 playerStats／G 的形式出現
    const pattern = new RegExp(`(?:playerStats|G)\\.${field}\\b`);
    if (pattern.test(gameCode)) leftovers.push(field);
  }
  ok('C2 已遷移的欄位不再以 G／playerStats 形式出現（避免兩份真相）',
    leftovers.length === 0, leftovers.length ? `仍有：${leftovers.join('、')}` : `${migrated.length} 個欄位都已收斂到 fx`);

  ok('C3 效果 id 一覽表與程式碼一致（invul/barrier/slow/boost/wall/freeze/combo/skill）',
    ['invul', 'barrier', 'slow', 'boost', 'wall', 'freeze', 'combo', 'skill'].every((id) => gameCode.includes(`'${id}'`)));

  ok('C4 restart 會清空所有時效（fx.clearAll 在 restartGame 內）',
    /function restartGame\(\)[\s\S]{0,1500}?fx\.clearAll\(\)/.test(gameCode));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
