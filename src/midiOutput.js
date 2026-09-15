// Sends one MIDI note per word out to a virtual MIDI port (e.g. macOS'
// IAC Driver), for GarageBand/SuperCollider to pick up as performance
// input. Pitch is alliterative: the first letter picks a fixed scale
// degree, so every word starting with the same letter always plays the
// same pitch class — the alliteration made audible. Each subsequent
// letter then nudges that pitch by a smaller and smaller amount, so the
// note is dominated by the first letter but still carries some of the
// word's own character.
//
// User speech and the corpus monologue go out on separate MIDI channels
// (rather than sharing 1-3, which are already spoken for by the
// granular-synthesis engine's own CC/mixer control surface) so the two
// sources can be routed to distinct instruments/processing downstream.

const SCALE = [0, 2, 3, 5, 7, 8, 10]; // natural minor intervals
const ROOT_NOTE = 36; // C2
const MAX_OCTAVES = 4; // 26 letters spread over ~3.7 octaves of a 7-note scale
const DETAIL_DECAY = 0.5; // each subsequent letter counts for half the last
const MAX_DETAIL_SEMITONES = 3; // total wobble from letters 2+ is capped to this
const NOTE_GATE_MS = 150; // fixed note-off delay — independent of speaking pace
const SUSTAIN_CC = 64; // damper/sustain pedal

// 0-indexed channels (MIDI channel numbers as shown in a DAW are +1: so
// 'user' is channel 4, 'corpus' is channel 5).
export const CHANNEL = { user: 3, corpus: 4 };

function letterIndex(ch) {
  return ch.charCodeAt(0) - 97; // 'a' -> 0 .. 'z' -> 25
}

// The whole alliterative pitch rule. Deterministic — the same word always
// produces the same note, no randomness.
export function noteForWord(word) {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!letters) return null;

  const first = letterIndex(letters[0]);
  // Flipped so 'a' sits at the top of the range and 'z' at the bottom.
  const flipped = 25 - first;
  const degree = flipped % SCALE.length;
  const octave = Math.min(MAX_OCTAVES - 1, Math.floor(flipped / SCALE.length));
  const base = ROOT_NOTE + octave * 12 + SCALE[degree];

  let detailSum = 0;
  let weight = 1;
  for (let i = 1; i < letters.length; i++) {
    weight *= DETAIL_DECAY;
    const v = (letterIndex(letters[i]) - 12.5) / 12.5; // -1..1
    detailSum += v * weight;
  }
  // Geometric series bound — keeps the normalized offset in -1..1
  // regardless of word length, so longer words don't just drift further.
  const maxMagnitude = DETAIL_DECAY / (1 - DETAIL_DECAY);
  const normalized = maxMagnitude > 0 ? Math.max(-1, Math.min(1, detailSum / maxMagnitude)) : 0;
  const detailOffset = Math.round(normalized * MAX_DETAIL_SEMITONES);

  return Math.max(0, Math.min(127, base + detailOffset));
}

export class MidiOutput {
  constructor() {
    this.access = null;
    this.output = null;
    this.state = 'off'; // off | starting | live | error
    this.error = null;
    this.pendingOffs = new Map(); // "channel:note" -> timeoutId
  }

  async connect(portNameSubstring = 'IAC') {
    this.state = 'starting';
    this.error = null;
    try {
      if (!navigator.requestMIDIAccess) {
        throw new Error('Web MIDI unavailable (page must be on localhost or https)');
      }
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.output = null;
      for (const output of this.access.outputs.values()) {
        if (output.name.includes(portNameSubstring)) {
          this.output = output;
          break;
        }
      }
      if (!this.output) {
        throw new Error(`No MIDI output matching "${portNameSubstring}" found`);
      }
      this.state = 'live';
      this._sendSustainOn();
    } catch (e) {
      this.state = 'error';
      this.error = e.message;
      throw e;
    }
  }

  get portName() {
    return this.output ? this.output.name : null;
  }

  // Held down for the whole run, on every channel — notes ring out through
  // the receiving synth's own release/decay instead of cutting cleanly at
  // NOTE_GATE_MS. A note-off is still sent on schedule; sustain is what
  // makes the synth treat that as "key released" rather than "silence now".
  _sendSustainOn() {
    if (!this.output) return;
    for (const channel of Object.values(CHANNEL)) {
      this.output.send([0xb0 | channel, SUSTAIN_CC, 127]);
    }
  }

  // channelKey: 'user' | 'corpus'. velocity: 1-127.
  sendWordNote(word, channelKey, velocity) {
    if (!this.output) return;
    const note = noteForWord(word);
    if (note === null) return;

    const channel = CHANNEL[channelKey];
    const key = `${channel}:${note}`;

    // Cut short if this exact note/channel is already ringing — rapid
    // repeats of the same word shouldn't stack overlapping note-ons.
    if (this.pendingOffs.has(key)) {
      clearTimeout(this.pendingOffs.get(key));
      this.output.send([0x80 | channel, note, 0]);
    }

    const v = Math.max(1, Math.min(127, Math.round(velocity)));
    this.output.send([0x90 | channel, note, v]);
    const timeoutId = setTimeout(() => {
      this.output.send([0x80 | channel, note, 0]);
      this.pendingOffs.delete(key);
    }, NOTE_GATE_MS);
    this.pendingOffs.set(key, timeoutId);
  }
}
