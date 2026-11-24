/**
 * Rotating Court stat engine. Pure and deterministic: no DOM, no clock, no Math.random.
 * All randomness comes from named DeterministicRng streams whose states live inside GameState,
 * so a run can be saved, resumed, replayed and simulated headlessly by the balance bots.
 * Presentation reads this state; it never writes back into it.
 */
import { DeterministicRng, stableHashString } from "@slu/web-shell";
import type {
  ArcState, Content, Ev, Fx, GameState, Later, Mode, Outcome, RequestDef, Ruling, SegKind, StatKey, Tuning, Wheel, WheelSeg
} from "./types";

const STREAMS = ["queue", "wheel", "fx", "omen"] as const;
type Stream = (typeof STREAMS)[number];

export interface RunOptions {
  mode: Mode;
  seed: string;
  challenge?: string | null;
  assist?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function stream(s: GameState, name: Stream): DeterministicRng {
  return new DeterministicRng(s.rng[name]);
}
function keep(s: GameState, name: Stream, r: DeterministicRng): void {
  s.rng[name] = r.state;
}

export function createRun(content: Content, t: Tuning, o: RunOptions): GameState {
  const master = stableHashString(`${o.seed}:${o.mode}`);
  const s: GameState = {
    v: 1, mode: o.mode, seed: o.seed, challenge: o.challenge ?? null,
    day: 1, slot: 0, p: t.startP!, h: t.startH!, g: t.startG!,
    pending: [], nextPid: 1, queue: [], bag: [], seen: {}, arcs: {},
    omen: null, omenDays: {},
    rng: {
      queue: stableHashString(`${master}:queue`), wheel: stableHashString(`${master}:wheel`),
      fx: stableHashString(`${master}:fx`), omen: stableHashString(`${master}:omen`)
    },
    wheel: null, dayEnded: false, over: null, cause: null,
    stats: { yes: 0, no: 0, hazards: 0, delayed: 0, cleanDays: 0, hazardToday: 0, streak: 0, bestStreak: 0, stops: 0, arcsDone: 0 },
    assisted: false, assist: !!o.assist
  };
  // Omen calendar: a handful of days across the reign, one omen each.
  const r = stream(s, "omen");
  if (o.mode !== "endless") {
    const days: number[] = [];
    for (let d = 3; d < t.days!; d++) days.push(d);
    r.shuffle(days);
    const omens = r.shuffle([...content.omenOrder]);
    const n = Math.min(t.omenDays!, omens.length);
    for (let i = 0; i < n; i++) s.omenDays[days[i]!] = omens[i]!;
  }
  keep(s, "omen", r);
  startDay(s, content, t, []);
  return s;
}

/* ---------------------------------------------------------------- day flow */

function drawArchetype(s: GameState, content: Content, r: DeterministicRng, taken: Set<string>): string {
  for (let tries = 0; tries < 6; tries++) {
    if (s.bag.length === 0) s.bag = r.shuffle([...content.archetypeOrder]);
    const id = s.bag.shift()!;
    if (!taken.has(id)) return id;
    s.bag.push(id);
  }
  return s.bag.shift()!;
}

function pickRequest(s: GameState, content: Content, archetype: string, r: DeterministicRng): RequestDef {
  const ids = content.archetypes.get(archetype)!.requests;
  const a = s.seen[ids[0]!] ?? 0, b = s.seen[ids[1]!] ?? 0;
  const id = a === b ? r.pick(ids) : a < b ? ids[0]! : ids[1]!;
  s.seen[id] = (s.seen[id] ?? 0) + 1;
  return content.requests.get(id)!;
}

/** Begin `s.day`: resolve landing effects, roll the omen, build the queue and first wheel. */
function startDay(s: GameState, content: Content, t: Tuning, ev: Ev[]): void {
  s.dayEnded = false;
  s.slot = 0;
  s.stats.hazardToday = 0;

  // Omen
  let omen: string | null = s.omenDays[s.day] ?? null;
  if (s.mode === "endless" && s.day > t.days!) {
    const r = stream(s, "omen");
    omen = r.chance(0.3) ? r.pick(content.omenOrder) : null;
    keep(s, "omen", r);
  }
  s.omen = omen;
  if (omen) ev.push({ t: "omen", id: omen });

  // Delayed effects that come due today
  const due = s.pending.filter((p) => p.due <= s.day);
  s.pending = s.pending.filter((p) => p.due > s.day);
  for (const p of due) {
    ev.push({ t: "delayed.resolve", icon: p.icon, fx: p.fx });
    applyFx(s, t, p.fx, "delayed", ev, p.icon);
    s.stats.delayed++;
    if (s.over) return;
  }

  // Queue
  const r = stream(s, "queue");
  const queue: string[] = [];
  const taken = new Set<string>();
  for (const [arcId, arc] of Object.entries(s.arcs)) {
    if (!arc.done && arc.due <= s.day && queue.length < 2) {
      const def = content.arcs.get(arcId)!;
      queue.push(arc.ruling === "yes" ? def.yes : def.no);
      taken.add(def.archetype);
      arc.done = true;
      s.stats.arcsDone++;
    }
  }
  while (queue.length < t.perDay!) {
    const arch = drawArchetype(s, content, r, taken);
    taken.add(arch);
    queue.push(pickRequest(s, content, arch, r).id);
  }
  r.shuffle(queue);
  keep(s, "queue", r);
  s.queue = queue;
  prepareWheel(s, content, t);
}

/** The petition at the front of the queue (the last one once the day's queue is exhausted). */
export function currentRequest(s: GameState, content: Content): RequestDef {
  return content.requests.get(s.queue[Math.min(s.slot, s.queue.length - 1)]!)!;
}

/* ------------------------------------------------------------------- wheel */

/** Base pointer speed (rev/s): ramps with day number and population. Omen speed is applied by prepareWheel. */
export function speedFor(s: GameState, t: Tuning): number {
  const dayRamp = Math.min(s.day - 1, t.speedCapDay! - 1) / (t.days! - 1);
  let v = t.speedBase! * (1 + t.speedDayRamp! * dayRamp) * (1 + t.speedPop! * (s.p - 50) / 50);
  if (s.assist) v *= t.assistSlow!;
  return v;
}

export function prepareWheel(s: GameState, content: Content, t: Tuning): Wheel {
  const req = currentRequest(s, content);
  const arch = content.archetypes.get(req.archetype)!;
  const omen = s.omen ? content.omens.get(s.omen)! : null;

  let yes = t.segYes!, no = t.segNo!, haz = t.segHaz!;
  // Stats bend the wheel: low happiness narrows YES, low gold widens the bribe.
  if (s.h < t.lowHappyBelow!) yes *= 1 - t.lowHappyNarrow! * (t.lowHappyBelow! - s.h) / t.lowHappyBelow!;
  if (arch.hazard === "bribe" && s.g < t.lowGoldBelow!) haz *= 1 + t.bribeWiden! * (t.lowGoldBelow! - s.g) / t.lowGoldBelow!;
  if (omen) { yes *= omen.yes; no *= omen.no; haz *= omen.haz; }
  if (s.assist) { yes *= t.assistWiden!; no *= t.assistWiden!; haz /= t.assistWiden!; }
  yes = Math.max(yes, t.minSeg!); no = Math.max(no, t.minSeg!); haz = Math.max(haz, t.minSeg!);
  const sum = yes + no + haz;
  yes /= sum; no /= sum; haz /= sum;

  const r = stream(s, "wheel");
  const flip = r.chance(0.5);
  const phase = r.next();
  keep(s, "wheel", r);
  const order: Array<[SegKind, number]> = flip
    ? [["yes", yes], ["hazard", haz], ["no", no]]
    : [["yes", yes], ["no", no], ["hazard", haz]];
  const segs: WheelSeg[] = [];
  let at = 0;
  for (const [kind, size] of order) { segs.push({ kind, start: at, size }); at += size; }

  const speed = speedFor(s, t) * (omen ? omen.speed : 1);
  s.wheel = { segs, phase, speed, spinUp: t.spinUp!, hazard: arch.hazard };
  return s.wheel;
}

/** Revolutions travelled `time` seconds after the wheel starts, easing up over `spinUp`. */
export function travelled(w: Wheel, time: number): number {
  const f = time < w.spinUp ? (time * time) / (2 * w.spinUp) : w.spinUp / 2 + (time - w.spinUp);
  return w.speed * Math.max(0, f);
}

/** Wheel-space fraction [0,1) under the pointer after `time` seconds. */
export function pointerAt(w: Wheel, time: number): number {
  const f = (w.phase + travelled(w, time)) % 1;
  return f < 0 ? f + 1 : f;
}

export function segAt(w: Wheel, frac: number): WheelSeg {
  for (const seg of w.segs) if (frac >= seg.start && frac < seg.start + seg.size) return seg;
  return w.segs[w.segs.length - 1]!;
}

export function segOf(w: Wheel, kind: SegKind): WheelSeg {
  return w.segs.find((x) => x.kind === kind)!;
}

/** Seconds until the pointer is next at wheel fraction `frac`, counting from `time`. */
export function timeUntil(w: Wheel, time: number, frac: number): number {
  const cur = travelled(w, time);
  const target = (frac - w.phase) % 1;
  let turns = Math.floor(cur) + (target < 0 ? target + 1 : target);
  if (turns < cur) turns += 1;
  const dist = turns - cur;
  return dist / w.speed;
}

/* ------------------------------------------------------------------ effects */

function applyFx(s: GameState, t: Tuning, fx: Fx, src: Extract<Ev, { t: "delta" }>["src"], ev: Ev[], icon?: string, scale = 1): void {
  const k = scale;
  const d: Fx = {};
  for (const key of ["p", "h", "g"] as StatKey[]) {
    const raw = fx[key];
    if (!raw) continue;
    const before = s[key];
    // Mercy: losses soften as a stat nears zero, so a reign is lost over several bad days, not one bad spin.
    const damp = raw < 0 && before < t.dampBelow! ? Math.max(t.dampMin!, before / t.dampBelow!) : 1;
    const after = clamp(before + raw * k * damp, 0, t.statMax!);
    s[key] = after;
    const delta = after - before;
    if (delta !== 0) d[key] = Math.round(delta * 10) / 10;
  }
  if (d.p || d.h || d.g) ev.push({ t: "delta", src, fx: d, icon });
  checkLose(s, ev);
}

function checkLose(s: GameState, ev: Ev[]): void {
  if (s.over) return;
  for (const key of ["p", "h", "g"] as StatKey[]) {
    if (s[key] <= 0) {
      s.over = "lose"; s.cause = key;
      ev.push({ t: "reign.lose", cause: key });
      return;
    }
  }
}

function queueLater(s: GameState, req: RequestDef, rows: Later[], ev: Ev[], scale: number, hazardIcon?: string): void {
  for (const l of rows) {
    const fx: Fx = {};
    for (const k of ["p", "h", "g"] as StatKey[]) if (l.fx[k]) fx[k] = l.fx[k]! * scale;
    const icon = hazardIcon ?? l.icon ?? req.ask[req.ask.length - 1]!;
    s.pending.push({ id: s.nextPid++, due: s.day + l.in, fx, icon, hidden: !!l.hidden });
    ev.push({ t: "later", due: s.day + l.in, icon, hidden: !!l.hidden });
  }
}

/* ------------------------------------------------------------------ ruling */

/**
 * Stop the wheel at wheel-fraction `frac` and resolve the petition. `intent` is only used by the
 * accessibility intent-lock, which snaps to the middle of the chosen segment and flags the run.
 */
export function rule(s: GameState, content: Content, t: Tuning, frac: number, intent?: "yes" | "no"): Ruling {
  if (s.over || s.dayEnded || !s.wheel) throw new Error("rule() called with no active petition");
  const ev: Ev[] = [];
  const req = currentRequest(s, content);
  const w = s.wheel;
  let seg: WheelSeg;
  if (intent) {
    seg = segOf(w, intent);
    s.assisted = true;
  } else {
    seg = segAt(w, frac);
  }
  s.stats.stops++;
  const kind = seg.kind;
  ev.push({ t: "ruling", kind, hazard: kind === "hazard" ? w.hazard : undefined });

  if (kind === "hazard") {
    const hz = content.hazards.get(w.hazard)!;
    const mag = content.archetypes.get(req.archetype)!.mag * t.hazardScale! * t.effectScale!;
    let now = hz.now;
    if (hz.pool) {
      const r = stream(s, "fx");
      now = r.pick(hz.pool);
      keep(s, "fx", r);
    }
    s.stats.hazards++; s.stats.hazardToday++; s.stats.streak = 0;
    applyFx(s, t, now, "hazard", ev, hz.icon, mag);
    if (!s.over) queueLater(s, req, hz.later, ev, mag, hz.icon);
  } else {
    const o: Outcome = kind === "yes" ? req.yes : req.no;
    if (kind === "yes") s.stats.yes++; else s.stats.no++;
    s.stats.streak++; s.stats.bestStreak = Math.max(s.stats.bestStreak, s.stats.streak);
    const bias: Fx = kind === "yes"
      ? { p: o.now.p ?? 0, h: (o.now.h ?? 0) + t.yesH!, g: (o.now.g ?? 0) + t.yesG! }
      : { p: o.now.p ?? 0, h: (o.now.h ?? 0) + t.noH!, g: (o.now.g ?? 0) + t.noG! };
    applyFx(s, t, bias, "now", ev, req.ask[req.ask.length - 1], t.effectScale!);
    if (!s.over) queueLater(s, req, o.later, ev, t.effectScale!);
  }

  // Recurring character: remember the ruling and schedule the return.
  if (req.arc && !s.arcs[req.arc]) {
    const r = stream(s, "queue");
    const delay = r.int(t.arcDelayMin!, t.arcDelayMax!);
    keep(s, "queue", r);
    const arc: ArcState = { ruling: kind === "yes" ? "yes" : "no", due: Math.min(s.day + delay, t.days!), done: false };
    s.arcs[req.arc] = arc;
  }

  s.slot++;
  if (!s.over && s.slot >= t.perDay!) endDay(s, content, t, ev);
  else if (!s.over) prepareWheel(s, content, t);
  return { kind, requestId: req.id, events: ev };
}

/** Daily tick: omen, taxes, happiness drag, gold fixing unrest, population growth; then win/lose. */
export function endDay(s: GameState, content: Content, t: Tuning, ev: Ev[]): void {
  s.dayEnded = true;
  if (s.stats.hazardToday === 0) s.stats.cleanDays++;
  const omen = s.omen ? content.omens.get(s.omen)! : null;
  if (omen) applyFx(s, t, omen.daily, "omen", ev, omen.icon, t.omenEffect!);
  if (!s.over) applyFx(s, t, { g: t.taxPerPop! * s.p }, "tax", ev);
  if (!s.over) applyFx(s, t, { h: -(t.dragBase! + t.dragPerPop! * s.p / 100) }, "drag", ev);
  if (!s.over && s.g - t.fixGold! >= t.fixReserve! && s.h < t.fixBelow!) applyFx(s, t, { g: -t.fixGold!, h: t.fixHappy! }, "fix", ev);
  if (!s.over && !omen?.noGrowth) {
    if (s.h > t.growthAbove!) applyFx(s, t, { p: t.growthRate! * (s.h - t.growthAbove!) }, "growth", ev);
    else if (s.h < t.declineBelow!) applyFx(s, t, { p: -t.declineRate! * (t.declineBelow! - s.h) }, "growth", ev);
  }
  ev.push({ t: "day.end", day: s.day });
  if (s.over) return;
  if (s.mode !== "endless" && s.day >= t.days!) {
    const ok = s.p > t.winMin! && s.h > t.winMin! && s.g > t.winMin!;
    s.over = ok ? "win" : "fall";
    ev.push(ok ? { t: "reign.win" } : { t: "reign.lose", cause: "weak" });
  }
}

/** Leave the day-end summary and begin the next day. */
export function nextDay(s: GameState, content: Content, t: Tuning): Ev[] {
  const ev: Ev[] = [];
  if (s.over || !s.dayEnded) return ev;
  s.day++;
  startDay(s, content, t, ev);
  return ev;
}

export function finalScore(s: GameState, t: Tuning): number {
  const days = s.over && s.dayEnded ? s.day : s.day - 1;
  let score = days * t.scoreDay! + s.stats.cleanDays * t.scoreCleanDay!;
  score += Math.round((s.p + s.h + s.g) * t.scoreStat!);
  if (s.over === "win") score += t.scoreWin!;
  return Math.round(score);
}

/** Days survived for display / endless leaderboard. */
export function daysSurvived(s: GameState): number {
  return s.over && s.dayEnded ? s.day : s.day - 1;
}

/** Merge challenge overrides over the canon tuning. */
export function tuningFor(base: Tuning, overrides?: Tuning): Tuning {
  return overrides ? { ...base, ...overrides } : { ...base };
}
