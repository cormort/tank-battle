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

// ── 假的 Web Audio（audio.js 只在 init() 內讀 window.AudioContext，所以先放好 stub）──
class FakeNode {
  constructor(kind) { this.kind = kind; this.connections = []; this.disconnected = false; this.onended = null; }
  connect(node) { this.connections.push(node); return node; }
  disconnect() { this.disconnected = true; }
}
class FakeGain extends FakeNode {
  constructor() { super('gain'); this.gain = { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
}
class FakeOscillator extends FakeNode {
  constructor() { super('osc'); this.type = 'sine'; this.frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {} }; }
  start() {} stop() { if (this.onended) setTimeout(() => this.onended(), 0); }
}
class FakeBufferSource extends FakeNode {
  constructor() { super('src'); this.buffer = null; }
  start() {} stop() { if (this.onended) setTimeout(() => this.onended(), 0); }
}
class FakeBiquad extends FakeNode {
  constructor() { super('biquad'); this.type = 'bandpass'; this.frequency = { value: 0 }; this.Q = { value: 0 }; }
}
class FakeAudioContext {
  constructor() {
    this.sampleRate = 8000;
    this.currentTime = 0;
    this.state = 'running';
    this.destination = new FakeNode('dest');
    this.created = { gain: 0, osc: 0, src: 0, biquad: 0 };
  }
  createGain() { this.created.gain++; return new FakeGain(); }
  createOscillator() { this.created.osc++; return new FakeOscillator(); }
  createBufferSource() { this.created.src++; return new FakeBufferSource(); }
  createBiquadFilter() { this.created.biquad++; return new FakeBiquad(); }
  createBuffer(ch, len) { const data = new Float32Array(len); return { getChannelData: () => data }; }
  resume() { this.state = 'running'; }
}
globalThis.window = { AudioContext: FakeAudioContext };
globalThis.document = globalThis.document || { getElementById: () => null };

import { makeEffects } from '../src/core/effects.js';
import { makeRng, hashSeed, defaultSeed } from '../src/core/rng.js';
import { makeStateMachine, STATES, isKnownState } from '../src/core/state.js';
import { makeInputState, applyKey, dirFromInput, releaseAll, makeTouchState, releaseTouch, KEY_BINDINGS } from '../src/platform/input.js';
import { computeRenderScale, detectMobile } from '../src/platform/viewport.js';
import { makeSound, makeMusic } from '../src/platform/audio.js';
import { bindLifecycle } from '../src/platform/lifecycle.js';
import { makeTouchInput } from '../src/platform/touch-ui.js';
import { makeTileRenderer, EAGLE_ALIVE_SPRITE, EAGLE_DEAD_SPRITE } from '../src/render/tiles.js';

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

console.log('\n=== S. 狀態機（src/core/state.js）===');
{
  const sm = makeStateMachine({ initial: STATES.MENU });
  ok('S1 初始狀態與 is()', sm.is(STATES.MENU));

  const okFlow = sm.set(STATES.PLAYING);
  ok('S2 白名單內的轉移 ok=true 且真的套用', okFlow.ok && okFlow.applied && sm.is(STATES.PLAYING));

  sm.set(STATES.SHOP);                    // playing → shop：已宣告
  const bad = sm.set(STATES.PAUSED);      // shop → paused：未宣告
  ok('S3 未宣告的轉移仍會套用（遊戲不會卡死）但會登記警告',
    bad.applied && !bad.ok && sm.is(STATES.PAUSED) && sm.warnings().length === 1,
    JSON.stringify(sm.warnings()));

  const unknown = sm.set('nonsense');
  ok('S4 未知狀態值不會被套用（避免打錯字把狀態設成 undefined）',
    !unknown.applied && sm.is(STATES.PAUSED), JSON.stringify(unknown));

  const same = sm.set(STATES.PAUSED);
  ok('S5 同狀態重設不記錄', same.reason === 'same-state' && sm.history().length === 3);

  sm.reset();
  ok('S6 reset 回到初始狀態並清空紀錄與警告',
    sm.is(STATES.MENU) && sm.history().length === 0 && sm.warnings().length === 0);

  ok('S7 狀態列舉完整（7 個）且 isKnownState 正確',
    Object.keys(STATES).length === 7 && isKnownState(STATES.SHOP) && !isKnownState('menu2'));

  // 實際遊戲會走的流程必須全部在白名單內（否則玩家會一直看到警告）
  const flow = [STATES.PLAYING, STATES.PAUSED, STATES.PLAYING, STATES.SHOP, STATES.PLAYING,
    STATES.LEVEL_COMPLETE, STATES.UPGRADE, STATES.PLAYING, STATES.GAMEOVER, STATES.MENU];
  const sm2 = makeStateMachine();
  const undeclared = flow.filter((st) => { const r = sm2.set(st); return !r.ok; });
  ok('S8 實際流程（playing→paused→shop→levelComplete→upgrade→gameover→menu）沒有未宣告轉移',
    undeclared.length === 0, undeclared.length ? `未宣告：${undeclared.join('、')}` : `${flow.length} 步全部合法`);
}

console.log('\n=== I. 輸入意圖（src/platform/input.js）===');
{
  const st = makeInputState();
  applyKey(st, 'KeyW', true);
  ok('I1 方向鍵對應到 intent', st.up === true && dirFromInput(st) === 0);
  applyKey(st, 'KeyW', false);
  applyKey(st, 'ArrowRight', true);
  ok('I2 放開後 intent 清除、方向切換', st.up === false && dirFromInput(st) === 1);

  applyKey(st, 'ArrowRight', false);      // 先放開上一步的方向鍵
  applyKey(st, 'KeyS', true);
  applyKey(st, 'KeyA', true);
  ok('I3 方向優先序：上 → 右 → 下 → 左（同時按住下與左時取下）',
    dirFromInput(st) === 2, String(dirFromInput(st)));
  releaseAll(st);
  ok('I3b 沒有任何方向鍵時回傳 fallback（-1 = 不動）', dirFromInput(st) === -1);

  const sk = makeInputState();
  const first = applyKey(sk, 'KeyQ', true, { skillKey: 'KeyQ' });
  const repeat = applyKey(sk, 'KeyQ', true, { skillKey: 'KeyQ' });
  ok('I4 主動技能是邊緣觸發（按住不會連發）', first.skillPressed === true && repeat.skillPressed === false);

  const ed = makeInputState();
  const inButton = applyKey(ed, 'Space', true, { editable: true });
  const inGame = applyKey(ed, 'Space', true, { editable: false });
  ok('I5 焦點在 UI 元件上時不攔截預設行為（按鈕才能用 Space 啟動）',
    inButton.preventDefault === false && inGame.preventDefault === true && ed.fire === true);

  releaseAll(ed);
  ok('I6 releaseAll 清空所有 intent', !ed.up && !ed.right && !ed.down && !ed.left && !ed.fire && !ed.skill);

  const touch = makeTouchState();
  touch.dir = 3; touch.fire = true; touch.joyActive = true; touch.joyDx = 12;
  releaseTouch(touch);
  ok('I7 releaseTouch 把搖桿與 FIRE 歸零',
    touch.dir === -1 && touch.fire === false && touch.joyActive === false && touch.joyDx === 0);

  ok('I8 對應表同時支援 WASD 與方向鍵（含 Space/KeyJ 射擊）',
    KEY_BINDINGS.KeyW === 'up' && KEY_BINDINGS.ArrowUp === 'up' && KEY_BINDINGS.Space === 'fire' && KEY_BINDINGS.KeyJ === 'fire');
}

console.log('\n=== V. 視窗與裝置（src/platform/viewport.js）===');
{
  ok('V1 DPR 倍率上限 2（DPR 3 全螢幕填色成本會翻 4~9 倍）',
    computeRenderScale(1) === 1 && computeRenderScale(2) === 2 && computeRenderScale(3) === 2 && computeRenderScale(0) === 1,
    [1, 2, 3, 0].map(computeRenderScale).join('/'));

  const ipad = detectMobile({ maxTouchPoints: 5, coarsePointer: true, narrowViewport: false, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' });
  const desktop = detectMobile({ maxTouchPoints: 0, coarsePointer: false, narrowViewport: false, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605' });
  const iphone = detectMobile({ maxTouchPoints: 5, coarsePointer: true, narrowViewport: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
  ok('V2 iPadOS（UA 是 Macintosh 但 pointer coarse）判定為觸控裝置', ipad === true);
  ok('V3 桌機（無觸控點）判定為非觸控', desktop === false);
  ok('V4 iPhone（觸控 + 窄畫面）判定為觸控裝置', iphone === true);
}

console.log('\n=== A. 音效與 BGM（src/platform/audio.js）===');
{
  let iconStates = [];
  const sound = makeSound({ onIconChange: (on) => iconStates.push(on) });
  sound.init();
  ok('A1 init 建立 AudioContext、master gain 與噪音 buffer（失敗時 error 可供排查）',
    sound.ready === true && !!sound.master && !!sound.noiseBuf && sound.ctx.created.gain === 1,
    sound.error ? `init 失敗：${sound.error.message}` : 'ready');

  sound.pulse(440, 0.1, 0.3);
  sound.noise(0.1, 0.3);
  ok('A2 pulse/noise 會建立對應節點', sound.ctx.created.osc === 1 && sound.ctx.created.src === 1);

  // 同時發聲上限 8：超過就丟掉（避免轟炸流疊 20~30 個 voice 削波）
  const oscBefore = sound.ctx.created.osc;
  for (let i = 0; i < 20; i++) sound.pulse(200 + i, 0.05, 0.2);
  const granted = sound.ctx.created.osc - oscBefore;
  ok('A3 同時發聲上限 8 個（舊版會疊 20~30 個 voice）',
    sound._activeVoices === 8 && granted === 6,
    `voices=${sound._activeVoices}｜20 次請求只放行 ${granted} 個（原本已有 2 個名額在用）`);

  await new Promise((r) => setTimeout(r, 20));    // 等 onended 觸發
  ok('A4 節點在 onended 時 disconnect 並歸還發聲名額（舊版從不回收）',
    sound._activeVoices === 0, `voices=${sound._activeVoices}`);

  sound.toggle();
  sound.toggle();
  ok('A5 toggle 會把 master gain 歸零並回報圖示狀態',
    sound.master.gain.value === 0.18 && iconStates.join(',') === 'false,true', iconStates.join(','));
}

{
  // Music：重新開啟時要恢復播放（舊版只設 enabled 卻不重播 → 切回來一片安靜）
  const sound = makeSound();
  sound.init();
  let playing = true;
  const music = makeMusic(sound, { isPlaying: () => playing, onIconChange: () => {} });
  music.enabled = false;
  music.toggle();                       // 重新開啟
  const track = music._track;
  const scheduled = music._timer !== null;
  music.toggle();                       // 再關閉
  ok('A6 BGM 重新開啟時會依 isPlaying() 選曲並恢復播放',
    !!track && track === music.TRACKS.LEVEL && scheduled && music._track === null,
    `曲目=${track ? 'LEVEL' : 'null'}｜排程器=${scheduled}｜關閉後=${music._track}`);
  music.stop();
  ok('A7 stop 會清掉計時器與曲目', music._timer === null && music._track === null);
}

console.log('\n=== L. 生命週期（src/platform/lifecycle.js）===');
{
  const makeEmitter = () => {
    const handlers = new Map();
    return {
      hidden: false,
      addEventListener(type, fn) { (handlers.get(type) || handlers.set(type, []).get(type)).push(fn); },
      removeEventListener(type, fn) {
        const list = handlers.get(type) || [];
        const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1);
      },
      fire(type) { (handlers.get(type) || []).slice().forEach((fn) => fn()); },
      count(type) { return (handlers.get(type) || []).length; },
    };
  };

  const win = makeEmitter(), doc = makeEmitter();
  let leaves = 0, returns = 0;
  const unbind = bindLifecycle({ onLeave: () => leaves++, onReturn: () => returns++, win, doc });

  doc.hidden = false; doc.fire('visibilitychange');
  doc.hidden = true; doc.fire('visibilitychange');
  win.fire('blur'); win.fire('focus'); win.fire('pointerdown');
  // 事件 → callback：visibilitychange(hidden→leave)、visibilitychange(顯示→return)、
  // blur→leave、focus→return、pointerdown→return（iOS 解鎖音訊）= leave 2 / return 3
  ok('L1 五個事件依語意分別觸發 onLeave／onReturn',
    leaves === 2 && returns === 3, `leave=${leaves} return=${returns}`);

  unbind();
  win.fire('blur');
  ok('L2 unbind 之後不再觸發（監聽器有正確移除）',
    leaves === 2 && win.count('blur') === 0 && doc.count('visibilitychange') === 0,
    `blur 監聽器=${win.count('blur')}、visibility=${doc.count('visibilitychange')}`);
}

console.log('\n=== T2. 觸控 UI（src/platform/touch-ui.js）===');
{
  const makeEl = () => {
    const listeners = new Map();
    return {
      style: {}, classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, contains(c) { return this._set.has(c); } },
      addEventListener(t, fn) { (listeners.get(t) || listeners.set(t, []).get(t)).push(fn); },
      removeEventListener() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
      fire(t) { (listeners.get(t) || []).forEach((fn) => fn({ preventDefault() {}, changedTouches: [{ identifier: 1, clientX: 40, clientY: 60 }] })); },
      listenerCount(t) { return (listeners.get(t) || []).length; },
    };
  };
  const els = { joystickArea: makeEl(), joystickBase: makeEl(), joystickStick: makeEl(), fireButton: makeEl() };
  const doc = { getElementById: (id) => els[id] || null, addEventListener() {} };
  const win = { innerHeight: 800, addEventListener() {} };
  const touch = makeTouchState();

  const mobile = makeTouchInput({ touch, getConfig: () => ({ JOYSTICK_MAX_RADIUS: 45, JOYSTICK_DEADZONE: 0.2 }), isMobile: () => true, doc, win });
  mobile.init();
  ok('T2-1 觸控裝置上 init 會綁定搖桿與 FIRE 鍵的監聽',
    els.joystickArea.listenerCount('touchstart') === 1 && els.fireButton.listenerCount('touchstart') === 1);

  els.fireButton.fire('touchstart');
  ok('T2-2 按下 FIRE 會設定 fire=true 與 pressed 樣式', touch.fire === true && els.fireButton.classList.contains('pressed'));

  touch.dir = 1; touch.joyDx = 30; touch.joyActive = true;
  mobile.reset();
  ok('T2-3 reset() 會強制放開搖桿與射擊鍵、並把搖桿移回中央',
    touch.dir === -1 && touch.fire === false && touch.joyActive === false && touch.joyDx === 0
    && els.joystickStick.style.left === '50%' && !els.fireButton.classList.contains('pressed'),
    JSON.stringify({ dir: touch.dir, fire: touch.fire, stick: els.joystickStick.style.left }));

  // 桌機用「另一組全新的元素」，這樣才能確定完全沒有綁定
  const desktopEls = { joystickArea: makeEl(), joystickBase: makeEl(), joystickStick: makeEl(), fireButton: makeEl() };
  const desktopDoc = { getElementById: (id) => desktopEls[id] || null, addEventListener() {} };
  const desktop = makeTouchInput({ touch: makeTouchState(), getConfig: () => ({ JOYSTICK_MAX_RADIUS: 45, JOYSTICK_DEADZONE: 0.2 }), isMobile: () => false, doc: desktopDoc, win });
  desktop.init();
  ok('T2-4 非觸控裝置上 init 完全不綁定觸控監聽（桌機不會被搖桿影響）',
    desktopEls.joystickArea.listenerCount('touchstart') === 0 && desktopEls.fireButton.listenerCount('touchstart') === 0);

  const noDoc = makeTouchInput({ touch: makeTouchState(), getConfig: () => ({ JOYSTICK_MAX_RADIUS: 45, JOYSTICK_DEADZONE: 0.2 }), isMobile: () => true, doc: null, win: null });
  ok('T2-5 沒有 DOM 時建構不會拋錯（元素為 null、reset 仍安全）',
    noDoc.joyArea === null && (noDoc.reset(), true));
}

console.log('\n=== T3. 渲染：地形與基地圖磚（src/render/tiles.js）===');
{
  // 假的 canvas context：只記錄呼叫次數
  const makeCtx = () => {
    const calls = { fillRect: 0, fillStyle: 0, drawImage: 0, clearRect: 0, setTransform: 0 };
    const ctx = {
      _calls: calls,
      setTransform() { calls.setTransform++; },
      clearRect() { calls.clearRect++; },
      drawImage() { calls.drawImage++; },
      beginPath() {}, arc() {}, fill() {},
    };
    Object.defineProperty(ctx, 'fillStyle', { set() { calls.fillStyle++; }, get() { return ''; } });
    ctx.fillRect = (...a) => { calls.fillRect++; ctx._last = a; };
    return ctx;
  };
  const makeDoc = () => ({
    createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx() }),
  });

  const tiles = makeTileRenderer({ TILE: 26, renderScale: 2, doc: makeDoc() });

  const brickCtx = makeCtx();
  tiles.drawBrickNES(brickCtx, 0, 0, 26);
  ok('T3-1 磚塊圖磚用固定次數的填色畫完（沒有逐像素）',
    brickCtx._calls.fillRect === 11 && brickCtx._calls.fillStyle === 3,   // 底色 + 磚紅 + 高光
    `fillRect=${brickCtx._calls.fillRect} fillStyle=${brickCtx._calls.fillStyle}`);

  const steelCtx = makeCtx();
  tiles.drawSteelNES(steelCtx, 0, 0, 26);
  ok('T3-2 鋼牆圖磚是 4 個象限的邊框', steelCtx._calls.fillRect === 20, `fillRect=${steelCtx._calls.fillRect}`);

  const waterCtx = makeCtx();
  tiles.drawWaterDirect(waterCtx, 0, 0, 0);
  const phase0 = waterCtx._calls.fillRect;
  const waterCtx2 = makeCtx();
  tiles.drawWaterDirect(waterCtx2, 0, 0, 1);
  ok('T3-3 水面兩個相位畫的數量不同（有動畫感）',
    phase0 === 6 && waterCtx2._calls.fillRect === 6 && phase0 > 0, `phase0=${phase0} phase1=${waterCtx2._calls.fillRect}`);

  // 老鷹：離屏快取（每幀 1 次 drawImage，而不是 127 次 fillRect）
  const eagleCtx = makeCtx();
  tiles.drawEagleDirect(eagleCtx, 10, 20, false);
  const firstSprite = tiles.eagleCache.alive;
  tiles.drawEagleDirect(eagleCtx, 10, 20, false);
  tiles.drawEagleDirect(eagleCtx, 10, 20, true);
  ok('T3-4 老鷹每幀只做 1 次 drawImage、0 次逐像素填色',
    eagleCtx._calls.drawImage === 3 && eagleCtx._calls.fillRect === 0,
    `drawImage=${eagleCtx._calls.drawImage} fillRect=${eagleCtx._calls.fillRect}`);
  ok('T3-5 老鷹精靈被快取（第二次取得同一個物件、活的與死的不同）',
    firstSprite === tiles.eagleCache.alive && tiles.eagleCache.alive !== tiles.eagleCache.dead
    && tiles.eagleCache.scale === 2, `scale=${tiles.eagleCache.scale}`);
  ok('T3-6 精靈圖資料是 13×13 且都有非零像素',
    EAGLE_ALIVE_SPRITE.length === 13 && EAGLE_DEAD_SPRITE.length === 13
    && EAGLE_ALIVE_SPRITE.flat().filter((v) => v !== 0).length > 100,
    `alive 非零 ${EAGLE_ALIVE_SPRITE.flat().filter((v) => v !== 0).length} 個`);
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

  ok('C5 移動判斷改用平台層意圖（不再手寫 G.keys[方向鍵]）',
    !/G\.keys\['(ArrowUp|ArrowRight|ArrowDown|ArrowLeft|KeyW|KeyA|KeyS|KeyD)'\]/.test(gameCode),
    (gameCode.match(/G\.keys\['(Arrow|Key[WASD])/g) || []).length + ' 處殘留');

  ok('C6 G.state 由狀態機存取器管理（Object.defineProperty + set() 檢查）',
    /Object\.defineProperty\(G, 'state'/.test(gameCode) && /gameState\.set\(value\)/.test(gameCode));

  ok('C4 restart 會清空所有時效（fx.clearAll 在 restartGame 內）',
    /function restartGame\(\)[\s\S]{0,1500}?fx\.clearAll\(\)/.test(gameCode));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
