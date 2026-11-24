/**
 * Semantic audio. Gameplay emits event ids only (rule 17); this layer owns the mapping to sound.
 * The shipped build has no authored audio, so every event resolves to a WebAudio synthesized
 * recipe. Authored files can later be layered in here without touching gameplay.
 */
import type { AudioBusName, AudioSystem } from "@slu/web-shell";

export type SoundEvent =
  | "wheel.tick" | "wheel.lock" | "ruling.yes" | "ruling.no" | "hazard.hit"
  | "delayed.resolve" | "day.end" | "reign.win" | "reign.lose" | "ui.confirm"
  | "vow.kept" | "vow.broken" | "deal.accept" | "expose.up" | "deceiver.motif";

/** `stage` is the court's rot (0..3): the Deceiver's motif comes back lower and thinner each stage. */
type Recipe = (a: AudioContext, out: AudioNode, t: number, stage: number) => void;

function tone(a: AudioContext, out: AudioNode, t: number, f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0): void {
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t + delay);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + delay + dur);
  g.gain.setValueAtTime(0.0001, t + delay);
  g.gain.exponentialRampToValueAtTime(vol, t + delay + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + delay + dur);
  o.connect(g).connect(out);
  o.start(t + delay);
  o.stop(t + delay + dur + 0.02);
}

function noise(a: AudioContext, out: AudioNode, t: number, dur: number, vol: number, hp = 400): void {
  const n = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource();
  s.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "highpass";
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = vol;
  s.connect(f).connect(g).connect(out);
  s.start(t);
}

const RECIPES: Record<SoundEvent, Recipe> = {
  "wheel.tick": (a, o, t) => tone(a, o, t, 1900, 1500, 0.025, "square", 0.05),
  "wheel.lock": (a, o, t) => { tone(a, o, t, 180, 70, 0.18, "triangle", 0.45); noise(a, o, t, 0.06, 0.25, 1500); },
  "ruling.yes": (a, o, t) => { tone(a, o, t, 523, 523, 0.16, "triangle", 0.3); tone(a, o, t, 784, 784, 0.26, "triangle", 0.3, 0.09); },
  "ruling.no": (a, o, t) => { tone(a, o, t, 330, 330, 0.16, "triangle", 0.32); tone(a, o, t, 220, 200, 0.3, "triangle", 0.32, 0.1); },
  "hazard.hit": (a, o, t) => { noise(a, o, t, 0.28, 0.5, 200); tone(a, o, t, 140, 55, 0.3, "sawtooth", 0.35); tone(a, o, t, 150, 150, 0.22, "square", 0.12, 0.02); },
  "delayed.resolve": (a, o, t) => { tone(a, o, t, 1175, 1175, 0.5, "sine", 0.22); tone(a, o, t, 1760, 1760, 0.4, "sine", 0.12, 0.05); },
  "day.end": (a, o, t) => { tone(a, o, t, 392, 392, 0.3, "sawtooth", 0.14); tone(a, o, t, 523, 523, 0.3, "sawtooth", 0.14, 0.18); tone(a, o, t, 659, 659, 0.5, "sawtooth", 0.14, 0.36); },
  "reign.win": (a, o, t) => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(a, o, t, f, f, 0.5, "triangle", 0.28, i * 0.13)); },
  "reign.lose": (a, o, t) => { [392, 330, 262, 196].forEach((f, i) => tone(a, o, t, f, f * 0.97, 0.55, "sawtooth", 0.16, i * 0.2)); },
  "ui.confirm": (a, o, t) => tone(a, o, t, 660, 880, 0.09, "square", 0.1),
  "vow.kept": (a, o, t) => { tone(a, o, t, 392, 392, 0.3, "triangle", 0.26); tone(a, o, t, 587, 587, 0.45, "triangle", 0.26, 0.14); },
  "vow.broken": (a, o, t) => { tone(a, o, t, 311, 233, 0.5, "sawtooth", 0.18); noise(a, o, t, 0.2, 0.3, 800); },
  "deal.accept": (a, o, t) => { tone(a, o, t, 196, 196, 0.5, "sawtooth", 0.14); tone(a, o, t, 247, 247, 0.5, "sawtooth", 0.1, 0.12); tone(a, o, t, 294, 294, 0.6, "sine", 0.12, 0.24); },
  "expose.up": (a, o, t) => { tone(a, o, t, 784, 1047, 0.12, "square", 0.12); tone(a, o, t, 1175, 1568, 0.3, "triangle", 0.2, 0.1); },
  "deceiver.motif": (a, o, t, stage) => {
    // Four notes at the start; each stage drops an octave step, thins the voice and drops a note.
    const base = [392, 466, 587, 784].map((f) => f * Math.pow(2, -stage * 0.5));
    const notes = stage >= 3 ? base.slice(0, 2) : stage === 2 ? base.slice(0, 3) : base;
    const type: OscillatorType = stage >= 2 ? "sine" : stage === 1 ? "triangle" : "sawtooth";
    notes.forEach((f, i) => tone(a, o, t, f, f * (stage >= 1 ? 0.985 : 1), 0.34 - stage * 0.04, type, 0.16 - stage * 0.03, i * (0.17 + stage * 0.05)));
  }
};

/** Every semantic event this layer can voice. */
export const soundEvents = (): string[] => Object.keys(RECIPES);

export class SynthAudio implements AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses = new Map<AudioBusName, number>();
  private busNodes = new Map<AudioBusName, GainNode>();
  private muted = false;

  /** Browsers need a gesture before audio can start: call from the first input. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    this.applyVolumes();
  }

  setBusVolume(bus: AudioBusName, value: number): void {
    this.buses.set(bus, value);
    this.applyVolumes();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolumes();
  }

  pauseAll(): void { void this.ctx?.suspend(); }
  resumeAll(): void { void this.ctx?.resume(); }

  private bus(name: AudioBusName): GainNode | null {
    if (!this.ctx || !this.master) return null;
    let n = this.busNodes.get(name);
    if (!n) {
      n = this.ctx.createGain();
      n.connect(this.master);
      this.busNodes.set(name, n);
      n.gain.value = this.buses.get(name) ?? 1;
    }
    return n;
  }

  private applyVolumes(): void {
    if (!this.master) return;
    this.master.gain.value = this.muted ? 0 : this.buses.get("master") ?? 1;
    for (const [name, node] of this.busNodes) node.gain.value = this.buses.get(name) ?? 1;
  }

  playSfx(id: string): void {
    this.play(id, 0);
  }

  play(id: string, stage: number): void {
    const recipe = RECIPES[id as SoundEvent];
    if (!recipe || !this.ctx || this.ctx.state !== "running") return;
    const out = this.bus(id === "ui.confirm" ? "ui" : "sfx");
    if (out) recipe(this.ctx, out, this.ctx.currentTime, stage);
  }
}

export const audio = new SynthAudio();

/** Gameplay-facing call: say what happened, not which sound. */
export function emit(event: SoundEvent, stage = 0): void {
  audio.play(event, stage);
}
