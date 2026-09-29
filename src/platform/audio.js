import { generateSong, renderSong } from '../vendor/chiptune/music.js';
import { SAMPLE_RATE } from '../vendor/chiptune/sfx.js';

// 平台層：音效（M3）。
//
// 從 index.html 原封搬過來，只做兩件事：
//   1. 把 `document.getElementById('soundToggle')` 換成注入的 `onIconChange` hook
//      —— 平台層不直接碰 DOM，UI 圖示由呼叫端決定。
//   2. 包成工廠 `makeSound()`，讓「建立音訊引擎」與「使用它」分開（也方便測試替身）。
//
// 這裡保留了先前修過的兩個要點：同時發聲上限 8 個（避免轟炸流削波）、
// 以及 `onended` 時 disconnect（舊版節點從不回收）。

export function makeSound({ onIconChange, rng = Math.random } = {}) {
  const sound = {
    ctx: null,
    master: null,
    noiseBuf: null,
    enabled: true,
    ready: false,

    init() {
      if (this.ready) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.18;
        this.master.connect(this.ctx.destination);
        // 預生成 1 秒白噪音 buffer
        const sr = this.ctx.sampleRate;
        const buf = this.ctx.createBuffer(1, sr, sr);
        const data = buf.getChannelData(0);
        // 噪音 buffer 的隨機來源由呼叫端注入（原本這裡直接用遊戲的 rnd()，
      // 搬進模組後那個變數不在作用域內 → init() 拋錯被 catch 吞掉 → 整個遊戲沒聲音）
      for (let i = 0; i < sr; i++) data[i] = rng() * 2 - 1;
        this.noiseBuf = buf;
        this.ready = true;
      } catch (e) {
      // 不要靜默：音訊初始化失敗（例如沒有 AudioContext）要留下痕跡，
      // 否則「沒有聲音」會被誤認為「使用者關了音效」而查不出原因。
      this.error = e;
      console.warn('[audio] 初始化失敗:', e && e.message ? e.message : e);
    }
    },

    resume() {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },

    toggle() {
      this.enabled = !this.enabled;
      if (this.master) this.master.gain.value = this.enabled ? 0.18 : 0;
      if (onIconChange) onIconChange(this.enabled);
    },

    // 同時發聲上限：轟炸/空襲會在極短時間內排 20~30 個爆炸音，全部疊上去會讓音訊執行緒
    // 尖峰並削波（聽起來像破音）。超過 8 個同時發聲就丟掉新的（玩家感受不到差異）。
    _activeVoices: 0,
    _voiceSlot() {
      if (this._activeVoices >= 8) return false;
      this._activeVoices++;
      return true;
    },
    // 節點回收：舊版 osc.stop() 之後從不 disconnect()，節點會一直掛在長命的 master 上，
    // 高射速武器（每秒約 30 發 × 2 個節點）長期累積會讓音訊圖越來越肥。
    _releaseOnEnd(node, extra) {
      node.onended = () => {
        try { node.disconnect(); } catch (e) { /* 已斷開 */ }
        if (extra) { try { extra.disconnect(); } catch (e) { /* 已斷開 */ } }
        this._activeVoices = Math.max(0, this._activeVoices - 1);
      };
    },

    // 脈波 (方波) — NES pulse channel
    pulse(freq, dur, vol = 0.4, type = 'square', sweep = 0) {
      if (!this.ready || !this.enabled) return;
      const t = this.ctx.currentTime;
      if (!this._voiceSlot()) return;      // 同時發聲上限（避免轟炸流疊 20~30 個 voice 造成削波）
      const osc = this.ctx.createOscillator();
      const gn = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (sweep) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + sweep), t + dur);
      gn.gain.setValueAtTime(vol, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gn).connect(this.master);
      this._releaseOnEnd(osc, gn);
      osc.start(t);
      osc.stop(t + dur);
    },

    // 噪音 — NES noise channel (爆炸/打擊)
    noise(dur, vol = 0.4, freq = 1200, q = 1) {
      if (!this.ready || !this.enabled) return;
      if (!this._voiceSlot()) return;
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = freq;
      filt.Q.value = q;
      const gn = this.ctx.createGain();
      gn.gain.setValueAtTime(vol, t);
      gn.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filt).connect(gn).connect(this.master);
      this._releaseOnEnd(src, gn);
      src.start(t);
      src.stop(t + dur);
    },

    // 序列播放 (簡易 jingle)
    seq(notes) {
      if (!this.ready || !this.enabled) return;
      let offset = 0;
      for (const [freq, dur, vol] of notes) {
        setTimeout(() => this.pulse(freq, dur, vol ?? 0.35), offset * 1000);
        offset += dur * 0.9;
      }
    },

    // ===== 遊戲音效 =====
    shoot()        { this.pulse(880, 0.05, 0.25, 'square', -700); },
    hitBrick()     { this.noise(0.07, 0.35, 1800, 1.5); },
    hitSteel()     { this.pulse(2200, 0.05, 0.3, 'square'); this.noise(0.05, 0.2, 4000, 2); },
    explode()      { this.noise(0.25, 0.5, 600, 0.7); this.pulse(120, 0.18, 0.3, 'triangle', -80); },
    bigExplode()   { this.noise(0.5, 0.6, 300, 0.5); this.pulse(80, 0.4, 0.4, 'triangle', -50); },
    spawn()        { this.pulse(220, 0.04, 0.2); setTimeout(() => this.pulse(440, 0.04, 0.2), 60); setTimeout(() => this.pulse(660, 0.06, 0.2), 120); },
    hitPlayer()    { this.pulse(180, 0.15, 0.45, 'square', -100); this.noise(0.15, 0.3, 800, 1); },
    baseDestroyed(){ this.noise(0.6, 0.6, 200, 0.5); this.pulse(60, 0.5, 0.5, 'triangle', -30); },

    // ===== Jingles =====
    jingleLevelStart() {
      this.seq([[523, 0.1], [659, 0.1], [784, 0.18]]);
    },
    jingleLevelClear() {
      this.seq([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.25]]);
    },
    jingleGameOver() {
      this.seq([[440, 0.18], [392, 0.18], [349, 0.18], [262, 0.45]]);
    },
  };
  return sound;
}

/**
 * 背景音樂：chiptune-audio 的種子程序化編曲（src/vendor/chiptune/）。
 * 每首曲子先整首渲染成可無縫循環的 AudioBuffer 再 loop 播放，所以不佔 SFX 的 8 個發聲名額。
 * 同一個 (曲目, seed) 永遠產生同一首；關卡用關卡編號當 seed，每關的曲子都不一樣。
 * 不碰遊戲的 rnd() —— 生成用自己的種子亂數，replay 不受影響。
 * @param {object} sound makeSound() 的結果（用它的 ctx，並接到它的 master，SFX 靜音時一起靜音）
 * @param {{onIconChange?:Function, isPlaying?:Function}} hooks
 *        isPlaying：遊戲是否在進行中（決定重新開啟時播 LEVEL 還是 MENU 曲目）
 */
export function makeMusic(sound, { onIconChange, isPlaying = () => false } = {}) {
  const music = {
    _source: null, _gain: null, _track: null, _seed: 1,
    enabled: true,

    // 曲目名稱維持原本的介面；bars 決定循環長度
    TRACKS: {
      MENU:     { mood: 'calm',  bars: 8 },
      LEVEL:    { mood: 'happy', bars: 8 },
      BOSS:     { mood: 'tense', bars: 8 },
      VICTORY:  { mood: 'happy', bars: 4 },
      GAMEOVER: { mood: 'sad',   bars: 4 },
    },

    play(trackName, seed = 1) {
      this.stop();
      if (!this.enabled || !sound.ready) return;
      const track = this.TRACKS[trackName];
      if (!track) return;
      this._track = track;
      this._seed = seed;
      const pcm = renderSong(generateSong({ seed, mood: track.mood, bars: track.bars }));
      const buf = sound.ctx.createBuffer(1, pcm.length, SAMPLE_RATE);
      buf.getChannelData(0).set(pcm);
      const src = sound.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gn = sound.ctx.createGain();
      gn.gain.value = 0.3;        // 渲染峰值 ≤ 0.9，壓到與 SFX 相當的音量
      src.connect(gn).connect(sound.master);
      src.start();
      this._source = src;
      this._gain = gn;
    },

    stop() {
      if (this._source) {
        try { this._source.stop(); } catch (e) { /* 已停止 */ }
        this._source.disconnect();
        this._gain.disconnect();
        this._source = null;
        this._gain = null;
      }
      this._track = null;
    },

    toggle() {
      this.enabled = !this.enabled;
      if (!this.enabled) {
        this.stop();
      } else if (!this._track) {
        // 舊版重新開啟時只把 enabled 設回 true，但不重新播放（切回來是一片安靜），
        // 而且 N 鍵那條路徑也不會更新圖示 → 玩家按了沒有回饋。
        this.play(isPlaying() ? 'LEVEL' : 'MENU', this._seed);
      }
      if (onIconChange) onIconChange();
    }
  };
  return music;
}
