// Web Audio player. Notes are scheduled just ahead of the clock rather than all
// at once, so a 4,000-note movement costs the same as a 40-note one. The voice is
// a sampled grand piano; see §6 of the README.

import type { Piece } from "./music";
import { midiOf } from "./music";

// One recording per minor third, A0 to C8, inlined as data URLs by the build.
// Anything between them is pitch-shifted by at most a semitone, which is
// inaudible; sampling every semitone would triple the payload for nothing.
const SAMPLES = import.meta.glob("../assets/piano/*.webm", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const PACK: { midi: number; url: string }[] = Object.entries(SAMPLES)
  .map(([path, url]) => ({ midi: Number(path.match(/(\d+)\.webm$/)?.[1] ?? 0), url }))
  .filter((s) => s.midi > 0)
  .sort((a, b) => a.midi - b.midi);

interface Ev {
  midi: number;
  on: number;
  dur: number;
}

// The main thread is not a real-time clock: a scroll, a paint or a GC can stall
// the timer for a couple of hundred milliseconds, and anything scheduled inside
// that stall arrives late and bunched. Half a second of runway absorbs it.
const LOOKAHEAD = 0.5; // seconds of audio scheduled in advance
const TICK = 50; // ms between scheduler wake-ups
// Per window, and the window is now twice as long. Dense textures are held down
// by the compressor rather than by dropping notes.
const MAX_VOICES = 32;

/** Master level the sample pack is tuned to: peaks around 0.75 on a dense score. */
export const DEFAULT_GAIN = 0.38;

export class Player {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<number, AudioBuffer>(); // sampled midi -> recording
  private loading: Promise<void> | null = null;
  private events: Ev[] = [];
  private cursor = 0;
  private startedAt = 0; // ctx time when playback began
  private startBeat = 0;
  private timer: number | null = null;
  private spb: number; // seconds per beat
  private vol = DEFAULT_GAIN;
  readonly baseTempo: number; // the score's own tempo, in quarter notes per minute
  readonly endBeat: number;

  playing = false;
  starting = false; // decoding the sample pack; a second play() must not stack
  private aborted = false; // pause pressed while still decoding
  onTick: ((beat: number) => void) | null = null;
  onEnd: (() => void) | null = null;

  constructor(piece: Piece) {
    this.baseTempo = piece.tempo || 84;
    this.spb = 60 / this.baseTempo;
    this.events = piece.notes
      .map((n) => ({ midi: midiOf(n[0]), on: n[1], dur: Math.min(n[2], 8) }))
      .sort((a, b) => a.on - b.on);
    this.endBeat = this.events.reduce((m, e) => Math.max(m, e.on + e.dur), 0);
  }

  private ensure() {
    if (this.ctx) return;
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // The pack is 48 kHz. Left to its default the context often runs at 44.1,
    // and then every voice is resampled for its whole life — the cost that made
    // dense pieces stutter, since it scales with how many notes are sounding.
    let ctx: AudioContext;
    try {
      ctx = new AC({ sampleRate: 48000 });
    } catch {
      ctx = new AC();
    }
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    // Dense chords would otherwise clip: the compressor rides them instead.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

  }

  /** Decode the sample pack. Cheap enough to do all at once on the first play. */
  private load(): Promise<void> {
    if (this.loading) return this.loading;
    const ctx = this.ctx!;
    this.loading = Promise.all(
      PACK.map(async (s) => {
        const bytes = await (await fetch(s.url)).arrayBuffer();
        this.buffers.set(s.midi, await ctx.decodeAudioData(bytes));
      }),
    ).then(() => undefined);
    return this.loading;
  }

  /** Quarter notes per minute. Setting it re-anchors the clock so the playhead
   *  does not jump; the half-second already scheduled keeps its old spacing. */
  get tempo(): number {
    return 60 / this.spb;
  }

  setTempo(qpm: number) {
    const b = this.beat;
    this.spb = 60 / Math.max(20, Math.min(320, qpm));
    this.startBeat = b;
    if (this.ctx) this.startedAt = this.ctx.currentTime;
  }

  get volume(): number {
    return this.vol;
  }

  setVolume(v: number) {
    this.vol = Math.max(0, Math.min(1.5, v));
    if (this.master) this.master.gain.value = this.vol;
  }

  get beat(): number {
    if (!this.playing || !this.ctx) return this.startBeat;
    return this.startBeat + (this.ctx.currentTime - this.startedAt) / this.spb;
  }

  seek(beat: number) {
    this.startBeat = Math.max(0, Math.min(beat, this.endBeat));
    if (this.ctx) this.startedAt = this.ctx.currentTime;
    this.cursor = this.events.findIndex((e) => e.on >= this.startBeat);
    if (this.cursor < 0) this.cursor = this.events.length;
    this.onTick?.(this.startBeat);
  }

  async play() {
    if (this.starting || this.playing) return;
    this.starting = true;
    this.aborted = false;
    try {
      this.ensure();
      if (!this.ctx) return;
      void this.ctx.resume();
      await this.load();
    } finally {
      this.starting = false;
    }
    if (!this.ctx || this.aborted) return; // disposed or paused while loading
    if (this.startBeat >= this.endBeat) this.seek(0);
    this.startedAt = this.ctx.currentTime;
    this.cursor = Math.max(
      0,
      this.events.findIndex((e) => e.on >= this.startBeat),
    );
    if (this.cursor < 0) this.cursor = this.events.length;
    this.playing = true;
    this.timer = window.setInterval(() => this.pump(), TICK);
    this.pump();
  }

  /**
   * Play notes now, outside the transport: a chord when `gap` is 0, a run up a
   * scale when it is not. Used by the hover card, which has to sound a note the
   * moment you click it rather than when the playhead reaches it.
   */
  async preview(midis: number[], gap = 0, dur = 1.2) {
    this.ensure();
    if (!this.ctx) return;
    void this.ctx.resume();
    await this.load();
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + 0.02;
    midis.forEach((m, i) => this.voice(m, t0 + i * gap, gap ? Math.max(gap, dur) : dur));
  }

  /**
   * Chords one after another, outside the transport. `preview` spaces every note
   * evenly, which is what a scale wants; a cadence is two chords, and the whole
   * point of it is the motion from one to the other — so the notes inside each
   * have to strike together and only the chords are spaced.
   */
  async previewChords(chords: number[][], gap = 0.95, dur = 1.4) {
    this.ensure();
    if (!this.ctx) return;
    void this.ctx.resume();
    await this.load();
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + 0.02;
    // The arrival rings on. Cut to the same length as its approach, a cadence
    // does not sound like one.
    const last = chords.length - 1;
    chords.forEach((ms, i) =>
      ms.forEach((m) => this.voice(m, t0 + i * gap, i === last ? dur * 1.7 : dur)),
    );
  }

  pause() {
    const b = this.beat;
    this.aborted = true;
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.startBeat = b;
    this.onTick?.(b);
  }

  dispose() {
    this.pause();
    void this.ctx?.close();
    this.ctx = null;
  }

  /** Schedule everything that falls inside the next LOOKAHEAD seconds. */
  private pump() {
    if (!this.ctx || !this.master || !this.playing) return;
    const now = this.ctx.currentTime;
    const horizon = this.beat + LOOKAHEAD / this.spb;
    let voices = 0;
    while (this.cursor < this.events.length && this.events[this.cursor].on <= horizon) {
      const e = this.events[this.cursor++];
      if (voices++ < MAX_VOICES) {
        const at = this.startedAt + (e.on - this.startBeat) * this.spb;
        this.voice(e.midi, Math.max(now, at), e.dur * this.spb);
      }
    }
    const b = this.beat;
    this.onTick?.(b);
    if (b >= this.endBeat) {
      this.pause();
      this.startBeat = this.endBeat;
      this.onEnd?.();
    }
  }

  /**
   * One note. The recording already carries the strike, the inharmonic partials
   * and the natural decay, so all this adds is the damper when the key lifts.
   */
  private voice(midi: number, at: number, dur: number) {
    const ctx = this.ctx!;
    // Nearest recording, then shift by at most a semitone either way.
    let best = PACK[0].midi;
    for (const s of PACK) if (Math.abs(s.midi - midi) < Math.abs(best - midi)) best = s.midi;
    const buf = this.buffers.get(best);
    if (!buf) return;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = Math.pow(2, (midi - best) / 12);

    // Damper felt takes longer to stop a thick bass string than a treble one.
    const release = 0.08 + 0.22 / (1 + Math.pow(2, (midi - 40) / 12));
    const held = Math.max(0.05, dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(1, at);
    gain.gain.setValueAtTime(1, at + held);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + held + release);

    src.connect(gain).connect(this.master!);
    src.start(at);
    // The sample is finite; stopping past its end is harmless.
    src.stop(at + held + release + 0.02);

    // Tear the voice down when it finishes. A stopped source is released on its
    // own, but the gain node it fed stays wired to the master and keeps being
    // summed for the rest of the session. At 24 notes a second that is a graph
    // growing by 1,400 dead nodes a minute — which is what made the fast pieces
    // stutter, and why they got worse the longer they ran.
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
    };
  }
}
