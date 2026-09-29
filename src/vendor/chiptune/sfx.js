import { mulberry32 } from './rng.js';

export const SAMPLE_RATE = 44100;
export const WAVE = { SQUARE: 0, SAW: 1, TRIANGLE: 2, NOISE: 3 };

const DEFAULTS = {
  wave: WAVE.SQUARE,
  freq: 440,       // Hz
  slide: 0,        // octaves per second
  duty: 0.5,       // square pulse width
  dutySweep: 0,    // duty change per second
  vibDepth: 0,     // fraction of freq
  vibRate: 0,      // Hz
  arpMult: 1,      // frequency multiplier applied at arpTime
  arpTime: 0,      // seconds; 0 = off
  bits: 0,         // bit-crush depth; 0 = off
  attack: 0.005,
  sustain: 0.1,
  decay: 0.1,
  vol: 0.5,
};

// Render one sound (sfxr-style parameters) to mono Float32Array samples.
export function renderSfx(params = {}) {
  const p = { ...DEFAULTS, ...params };
  const n = Math.ceil((p.attack + p.sustain + p.decay) * SAMPLE_RATE);
  const out = new Float32Array(n);
  const noise = mulberry32(1);
  const levels = p.bits > 0 ? 2 ** p.bits : 0;
  let phase = 0;
  let nv = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    let f = p.freq * 2 ** (p.slide * t);
    if (p.arpTime && t >= p.arpTime) f *= p.arpMult;
    if (p.vibDepth) f *= 1 + p.vibDepth * Math.sin(2 * Math.PI * p.vibRate * t);
    phase += f / SAMPLE_RATE;
    let wrapped = false;
    if (phase >= 1) { phase -= Math.floor(phase); wrapped = true; }
    let v;
    switch (p.wave) {
      case WAVE.SAW: v = 2 * phase - 1; break;
      case WAVE.TRIANGLE: v = 4 * Math.abs(phase - 0.5) - 1; break;
      case WAVE.NOISE:
        if (wrapped) nv = noise() * 2 - 1;
        v = nv;
        break;
      default: {
        const duty = Math.min(0.95, Math.max(0.05, p.duty + p.dutySweep * t));
        v = phase < duty ? 1 : -1;
      }
    }
    if (levels) v = Math.round(v * levels) / levels;
    const env = t < p.attack ? t / p.attack
      : t < p.attack + p.sustain ? 1
      : Math.max(0, 1 - (t - p.attack - p.sustain) / p.decay);
    out[i] = v * env * p.vol;
  }
  return out;
}

export const SFX_PRESETS = {
  coin:     { freq: 988, arpMult: 1.5, arpTime: 0.07, sustain: 0.1, decay: 0.15, duty: 0.25 },
  jump:     { freq: 260, slide: 2.2, sustain: 0.08, decay: 0.15, duty: 0.4 },
  laser:    { freq: 1400, slide: -4, sustain: 0.05, decay: 0.15, duty: 0.3, dutySweep: -1 },
  hit:      { wave: WAVE.NOISE, freq: 6000, slide: -1.5, sustain: 0.03, decay: 0.12, bits: 4 },
  explosion:{ wave: WAVE.NOISE, freq: 2500, slide: -2.5, attack: 0.01, sustain: 0.15, decay: 0.55, vol: 0.7 },
  powerup:  { freq: 330, slide: 3, vibDepth: 0.03, vibRate: 30, sustain: 0.2, decay: 0.2, duty: 0.5 },
  select:   { freq: 660, sustain: 0.04, decay: 0.06, duty: 0.5, vol: 0.4 },
  gameover: { wave: WAVE.TRIANGLE, freq: 400, slide: -1, attack: 0.01, sustain: 0.4, decay: 0.6, vol: 0.6 },
  win:      { freq: 523, arpMult: 1.5, arpTime: 0.12, sustain: 0.3, decay: 0.4, duty: 0.25, vibDepth: 0.01, vibRate: 8 },
};
