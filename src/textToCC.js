// Maps transcribed words to MIDI CC messages for SuperCollider's
// Carter's Delay engine, round-robin across 11 granular/feedback
// parameters.  Each word's average ASCII value (of its lowercase
// letters) is scaled to 0–127, then narrowed to the parameter's
// allowed sub-range before being sent as a CC.
//
// The word counter is shared across user speech and corpus monologue
// so the two sources weave through the same parameter sequence.

import { GRANULAR_CHANNEL } from './midiOutput.js';

// Feedback patch lives on channel 2 (0-indexed = 1).
const FEEDBACK_CHANNEL = 1;
// Levels & routing lives on channel 1 (0-indexed = 0).
const LEVELS_CHANNEL = 0;

// ---- Parameter table ---------------------------------------------------
// Each entry: { ch, cc, lo, hi, toggle?, bits? }
//   ch/cc:  MIDI channel (0-indexed) and CC number
//   lo/hi:  the CC sub-range this parameter should stay within
//   toggle: if true, value < 64 → send 0, ≥ 64 → send 127
//   bits:   if set, the raw 0–127 value is split into N on/off CCs
//           (one per entry in the bits array: [cc1, cc2, ...])

const PARAMS = [
  // 0  Feedback level — 0–20%  →  CC 0–25
  { ch: FEEDBACK_CHANNEL, cc: 1, lo: 0, hi: 25 },
  // 1  Pink noise level — 0–5%  →  CC 0–6
  { ch: FEEDBACK_CHANNEL, cc: 4, lo: 0, hi: 6 },
  // 2  Sine level — 0–10%  →  CC 0–13
  { ch: FEEDBACK_CHANNEL, cc: 5, lo: 0, hi: 13 },
  // 3  Grain density multiplier — floor at ~0.68× (CC 48–127)
  { ch: GRANULAR_CHANNEL, cc: 2, lo: 48, hi: 127 },
  // 4  Feedback high-pass — lower half (0–110 Hz)
  { ch: FEEDBACK_CHANNEL, cc: 3, lo: 0, hi: 63 },
  // 5  Low-pass cutoff ceiling — floor at ~7 kHz (CC 96–127)
  { ch: GRANULAR_CHANNEL, cc: 3, lo: 96, hi: 127 },
  // 6  Buffer freeze — on/off toggle
  { ch: GRANULAR_CHANNEL, cc: 8, lo: 0, hi: 127, toggle: true },
  // 7  Pitch interval on/offs — 3 bits → octaves / fifths+fourths / sub-octaves
  { ch: GRANULAR_CHANNEL, bits: [9, 10, 11] },
  // 8  Reverse toggle — on/off toggle
  { ch: GRANULAR_CHANNEL, cc: 12, toggle: true },
  // 9  Position jitter — full range
  { ch: GRANULAR_CHANNEL, cc: 4, lo: 0, hi: 127 },
  // 10 Trigger distribution — full range
  { ch: GRANULAR_CHANNEL, cc: 5, lo: 0, hi: 127 },
  // 11 Grain window — full range
  { ch: GRANULAR_CHANNEL, cc: 6, lo: 0, hi: 127 },
  // 12 Delay input level — 25–75%  →  CC 32–95
  { ch: LEVELS_CHANNEL, cc: 2, lo: 32, hi: 95 },
  // 13 Buffer preservation — 25–75%  →  CC 32–95
  { ch: LEVELS_CHANNEL, cc: 3, lo: 32, hi: 95 },
];

const PARAM_COUNT = PARAMS.length;

// ---- Core math ---------------------------------------------------------

// Average code-point of the word's lowercase ASCII letters, mapped to
// 0–127.  Non-letter characters are ignored.  Returns null if the word
// has no letters at all.
function wordToRaw(word) {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  if (letters.length === 0) return null;

  let sum = 0;
  for (let i = 0; i < letters.length; i++) sum += letters.charCodeAt(i);
  const avg = sum / letters.length; // 97 ('a') .. 122 ('z')

  // Map 97–122 linearly onto 0–127, clamped.
  return Math.round(Math.max(0, Math.min(127, ((avg - 97) / 25) * 127)));
}

// ---- Public API --------------------------------------------------------

let wordIndex = 0;

// Call once per word (from either the user or corpus path).
// midiOutput: a MidiOutput instance with .sendCC(ch, cc, value).
export function sendWordCC(midiOutput, word) {
  const raw = wordToRaw(word);
  if (raw === null) return;

  const param = PARAMS[wordIndex % PARAM_COUNT];
  wordIndex++;

  if (param.bits) {
    // Split raw value into N on/off bits.
    for (let b = 0; b < param.bits.length; b++) {
      const on = (raw >> b) & 1;
      midiOutput.sendCC(param.ch, param.bits[b], on ? 127 : 0);
    }
    return;
  }

  let value;
  if (param.toggle) {
    value = raw >= 64 ? 127 : 0;
  } else {
    // Scale 0–127 into lo–hi sub-range.
    value = Math.round(param.lo + (raw / 127) * (param.hi - param.lo));
  }

  midiOutput.sendCC(param.ch, param.cc, value);
}

// For debug / devtools: which parameter index is next?
export function peekIndex() { return wordIndex % PARAM_COUNT; }

// Reset the round-robin counter (e.g. on a full engine restart).
export function resetIndex() { wordIndex = 0; }
