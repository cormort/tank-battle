import { mulberry32 } from './rng.js';
import { renderSfx, SAMPLE_RATE, WAVE } from './sfx.js';

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
};

// Chord progressions as scale-degree roots (7-note scales).
const PROGRESSIONS = [[0, 4, 5, 3], [0, 5, 3, 4], [0, 3, 4, 0], [5, 3, 0, 4]];

export const MOODS = {
  happy: { scale: 'major', bpm: 140, duty: 0.5, density: 0.7, root: 60 },
  calm:  { scale: 'pentatonic', bpm: 96, duty: 0.25, density: 0.4, root: 57 },
  tense: { scale: 'minor', bpm: 164, duty: 0.125, density: 0.85, root: 57 },
  sad:   { scale: 'minor', bpm: 72, duty: 0.25, density: 0.35, root: 55 },
};

const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const STEPS_PER_BAR = 16;

// Scale note (may be negative / beyond the octave) -> midi number.
function degreeToMidi(scale, root, degree) {
  const len = scale.length;
  const oct = Math.floor(degree / len);
  return root + oct * 12 + scale[((degree % len) + len) % len];
}

// Deterministic song description: same options => same song.
export function generateSong({ seed = 1, mood = 'happy', bars = 8 } = {}) {
  const m = MOODS[mood];
  if (!m) throw new Error(`Unknown mood: ${mood}`);
  const rng = mulberry32(seed);
  const scale = SCALES[m.scale];
  const prog = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];
  const lead = [];
  const bass = [];
  let deg = 7 + Math.floor(rng() * 3); // start around the upper octave
  for (let bar = 0; bar < bars; bar++) {
    const chordRoot = m.scale === 'pentatonic' ? prog[bar % 4] % scale.length : prog[bar % 4];
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      const step = bar * STEPS_PER_BAR + s;
      if (s % 2 === 0) {
        bass.push({ step, len: 2, note: degreeToMidi(scale, m.root - 24, chordRoot) });
      }
      const onBeat = s % 4 === 0;
      if (rng() < (onBeat ? Math.min(1, m.density + 0.2) : m.density * 0.6)) {
        // Stepwise motion, with a pull toward chord tones on strong beats.
        deg += Math.floor(rng() * 5) - 2;
        if (onBeat) deg = chordRoot + 7 + 2 * Math.round((deg - chordRoot - 7) / 2);
        deg = Math.max(0, Math.min(scale.length * 2, deg));
        lead.push({ step, len: onBeat ? 3 : 2, note: degreeToMidi(scale, m.root, deg) });
      }
    }
  }
  return { seed, mood, bars, bpm: m.bpm, duty: m.duty, lead, bass };
}

function mixInto(out, samples, offset) {
  for (let i = 0; i < samples.length && offset + i < out.length; i++) out[offset + i] += samples[i];
}

// Render a song to a seamlessly loopable mono Float32Array.
export function renderSong(song) {
  const stepSec = 60 / song.bpm / 4;
  const stepSamples = Math.round(stepSec * SAMPLE_RATE);
  const total = song.bars * STEPS_PER_BAR * stepSamples;
  const out = new Float32Array(total);

  for (const n of song.lead) {
    const dur = n.len * stepSec;
    mixInto(out, renderSfx({
      wave: WAVE.SQUARE, freq: midi(n.note), duty: song.duty,
      vibDepth: 0.004, vibRate: 6, attack: 0.005, sustain: dur * 0.5, decay: dur * 0.5, vol: 0.22,
    }), n.step * stepSamples);
  }
  for (const n of song.bass) {
    const dur = n.len * stepSec;
    mixInto(out, renderSfx({
      wave: WAVE.TRIANGLE, freq: midi(n.note), attack: 0.005, sustain: dur * 0.7, decay: dur * 0.3, vol: 0.35,
    }), n.step * stepSamples);
  }

  const kick = renderSfx({ wave: WAVE.TRIANGLE, freq: 150, slide: -6, sustain: 0.02, decay: 0.1, vol: 0.5 });
  const snare = renderSfx({ wave: WAVE.NOISE, freq: 9000, sustain: 0.02, decay: 0.09, vol: 0.2, bits: 4 });
  const hat = renderSfx({ wave: WAVE.NOISE, freq: 20000, sustain: 0.005, decay: 0.03, vol: 0.08 });
  for (let step = 0; step < song.bars * STEPS_PER_BAR; step++) {
    const s = step % STEPS_PER_BAR;
    const at = step * stepSamples;
    if (s === 0 || s === 8) mixInto(out, kick, at);
    if (s === 4 || s === 12) mixInto(out, snare, at);
    if (s % 2 === 0) mixInto(out, hat, at);
  }

  // Scale down instead of hard-clipping when voices pile up.
  let peak = 0;
  for (let i = 0; i < out.length; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 0.9) for (let i = 0; i < out.length; i++) out[i] *= 0.9 / peak;
  return out;
}
