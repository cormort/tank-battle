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
 * 背景音樂：程序化編曲（沿用原本的曲目表與排程器）。
 * @param {object} sound makeSound() 的結果（用它的 pulse 發聲）
 * @param {{onIconChange?:Function, isPlaying?:Function}} hooks
 *        isPlaying：遊戲是否在進行中（決定重新開啟時播 LEVEL 還是 MENU 曲目）
 */
export function makeMusic(sound, { onIconChange, isPlaying = () => false } = {}) {
  const music = {
    _timer: null, _track: null, _beat: 0,
    enabled: true,

    TRACKS: {
      MENU: {
        bpm: 100,
        bass: [73.42, 73.42, 98.00, 110.00],
        melody: [
          293.66, 349.23, 440.00, 587.33,
          523.25, 440.00, 349.23, 293.66,
          392.00, 493.88, 587.33, 659.25,
          587.33, 523.25, 440.00, 392.00,
          293.66, 349.23, 440.00, 587.33,
          523.25, 440.00, 349.23, 293.66,
          392.00, 440.00, 493.88, 523.25,
          587.33, 0, 523.25, 0,
        ]
      },
      LEVEL: {
        bpm: 130,
        bass: [110.00, 110.00, 146.83, 164.81],
        melody: [
          440.00, 523.25, 659.25, 880.00,
          783.99, 659.25, 523.25, 440.00,
          523.25, 587.33, 783.99, 587.33,
          659.25, 523.25, 440.00, 392.00,
          440.00, 523.25, 659.25, 880.00,
          783.99, 659.25, 523.25, 440.00,
          587.33, 659.25, 783.99, 880.00,
          783.99, 659.25, 523.25, 440.00,
        ]
      },
      BOSS: {
        bpm: 150,
        bass: [82.41, 82.41, 110.00, 123.47],
        melody: [
          329.63, 369.99, 493.88, 329.63,
          493.88, 554.37, 659.25, 493.88,
          329.63, 369.99, 493.88, 329.63,
          659.25, 554.37, 493.88, 369.99,
          329.63, 369.99, 493.88, 329.63,
          493.88, 554.37, 659.25, 493.88,
          329.63, 369.99, 493.88, 329.63,
          440.00, 493.88, 554.37, 659.25,
        ]
      },
      VICTORY: {
        bpm: 120,
        bass: [130.81, 130.81, 164.81, 196.00],
        melody: [
          523.25, 0, 659.25, 0,
          783.99, 0, 1046.50, 0,
          783.99, 659.25, 783.99, 1046.50,
          783.99, 659.25, 523.25, 0,
          659.25, 0, 783.99, 0,
          1046.50, 0, 1318.51, 0,
          1174.66, 1046.50, 783.99, 659.25,
          523.25, 659.25, 783.99, 1046.50,
        ]
      },
      GAMEOVER: {
        bpm: 65,
        bass: [73.42, 65.41, 58.27, 65.41],
        melody: [
          293.66, 261.63, 220.00, 196.00,
          220.00, 261.63, 293.66, 0,
          261.63, 220.00, 196.00, 174.61,
          196.00, 220.00, 261.63, 0,
          196.00, 174.61, 164.81, 146.83,
          164.81, 174.61, 196.00, 0,
          220.00, 196.00, 174.61, 164.81,
          146.83, 164.81, 174.61, 196.00,
        ]
      }
    },

    play(trackName) {
      this.stop();
      if (!this.enabled || !sound.ready) return;
      this._track = this.TRACKS[trackName];
      if (!this._track) return;
      this._beat = 0;
      this._tick();
    },

    _tick() {
      if (!this._track || !this.enabled) return;
      const t = this._track;
      const msPerBeat = 60000 / t.bpm;

      if (this._beat % 2 === 0) {
        const bFreq = t.bass[(this._beat >> 1) % t.bass.length];
        if (bFreq > 0) sound.pulse(bFreq, msPerBeat / 1000 * 0.9, 0.1, 'triangle');
      }

      const mFreq = t.melody[this._beat % t.melody.length];
      if (mFreq > 0) {
        const vol = this._beat % 4 === 0 ? 0.14 : 0.09;
        sound.pulse(mFreq, msPerBeat / 1000 * 0.85, vol, 'square');
      }

      this._beat++;
      this._timer = setTimeout(() => this._tick(), msPerBeat);
    },

    stop() {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this._track = null;
    },

    toggle() {
      this.enabled = !this.enabled;
      if (!this.enabled) {
        this.stop();
      } else if (!this._track) {
        // 舊版重新開啟時只把 enabled 設回 true，但不重新播放（切回來是一片安靜），
        // 而且 N 鍵那條路徑也不會更新圖示 → 玩家按了沒有回饋。
        this.play(isPlaying() ? 'LEVEL' : 'MENU');
      }
      if (onIconChange) onIconChange();
    }
  };
  return music;
}
