/**
 * Rotating Court stat engine. Pure and deterministic: no DOM, no clock, no Math.random.
 * All randomness comes from named DeterministicRng streams whose states live inside GameState,
 * so a run can be saved, resumed, replayed and simulated headlessly by the balance bots.
 * Presentation reads this state; it never writes back into it.
 */
import { DeterministicRng, stableHashString } from "@slu/web-shell";
import { FACTION_STAT } from "./types";
import type {
  ArcState, Content, Cur, Ending, Ev, Fx, GameState, Later, Mode, Outcome, RequestDef, Ruling, SegKind, StatKey, Tuning, Wheel, WheelSeg
} from "./types";

const STREAMS = ["queue", "wheel", "fx", "omen", "dec", "vow"] as const;
type Stream = (typeof STREAMS)[number];

export interface RunOptions {
  mode: Mode;
  seed: string;
  challenge?: string | null;
  assist?: boolean;
  /** Run the scripted Vow Night + three tutorial days first (they never count toward the 25). */
  tutorial?: boolean;
  /** Vows sworn on night zero; defaults to three picked from the seed. */
  vows?: string[];
  /** First run after the tutorial: the Deceiver lies rarely so his pattern can be learned. */
  firstRun?: boolean;
}

const opposite = (r: "yes" | "no"): "yes" | "no" => (r === "yes" ? "no" : "yes");

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
    v: 2, mode: o.mode, seed: o.seed, challenge: o.challenge ?? null,
    day: 1, slot: 0, p: t.startP!, h: t.startH!, g: t.startG!,
    pending: [], nextPid: 1, queue: [], bag: [], seen: {}, arcs: {},
    omen: null, omenDays: {},
    rng: {
      queue: stableHashString(`${master}:queue`), wheel: stableHashString(`${master}:wheel`),
      fx: stableHashString(`${master}:fx`), omen: stableHashString(`${master}:omen`),
      dec: stableHashString(`${master}:dec`), vow: stableHashString(`${master}:vow`)
    },
    wheel: null, dayEnded: false, over: null, cause: null,
    stats: { yes: 0, no: 0, hazards: 0, delayed: 0, cleanDays: 0, hazardToday: 0, streak: 0, bestStreak: 0, stops: 0, arcsDone: 0, caught: 0, wrong: 0 },
    vows: [], marks: [], usurp: 0, expose: 0, dealOffer: null, dealsTaken: 0, activeDeals: [], debts: [],
    tut: o.tutorial ? 1 : 0, lieRate: o.firstRun ? t.lieRateFirst! : t.lieRate!, cycle: 0,
    cur: { truth: true, tell: null, advice: null }, ending: null,
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
  swearVows(s, content, t, o.vows);
  startDay(s, content, t, []);
  return s;
}

/* -------------------------------------------------------------------- vows */

/** Night zero: swear three vows and schedule when each is called in (dormant until then). */
function swearVows(s: GameState, content: Content, t: Tuning, chosen?: string[]): void {
  const r = stream(s, "vow");
  const ids = (chosen ?? r.shuffle([...content.vowOrder]).slice(0, 3)).slice(0, 3);
  s.vows = ids.map((id) => ({ id, due: 0, status: "sworn" as const }));
  scheduleVows(s, content, t, r);
  keep(s, "vow", r);
}

/** Each sworn vow is called in at least once, on distinct days inside its window. */
function scheduleVows(s: GameState, content: Content, t: Tuning, r: DeterministicRng): void {
  const used = new Set<number>();
  for (const v of s.vows) {
    const def = content.vows.get(v.id)!;
    const lo = def.due[0], hi = Math.min(def.due[1], t.days! - 2);
    let day = r.int(lo, Math.max(lo, hi));
    for (let guard = 0; guard < 12 && used.has(day); guard++) day = r.int(lo, Math.max(lo, hi));
    while (used.has(day)) day++;
    used.add(day);
    v.due = day;
    v.status = "sworn";
  }
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

  // Queue: forced petitions first (scripted tutorial, debt, vow call-ins, returning characters), then fresh ones.
  const r = stream(s, "queue");
  const queue: string[] = [];
  const taken = new Set<string>();
  const forcedIds: string[] = [];
  if (s.tut) {
    const td = content.deceiver.tutorial[s.tut - 1]!;
    if (td.vow) {
      const v = s.vows[0]!;
      v.status = "called";
      forcedIds.push(content.vows.get(v.id)!.request);
      ev.push({ t: "vow", id: v.id, result: "called" });
    }
    forcedIds.push(...td.requests);
  } else {
    const debt = s.debts.findIndex((d) => d.due <= s.day);
    if (debt >= 0) { s.debts.splice(debt, 1); forcedIds.push("deceiver.debt"); }
    for (const v of s.vows) {
      if (v.status === "sworn" && v.due <= s.day && forcedIds.length < 3) {
        v.status = "called";
        forcedIds.push(content.vows.get(v.id)!.request);
        ev.push({ t: "vow", id: v.id, result: "called" });
      }
    }
    for (const [arcId, arc] of Object.entries(s.arcs)) {
      if (!arc.done && arc.due <= s.day && forcedIds.length < 3) {
        const def = content.arcs.get(arcId)!;
        forcedIds.push(arc.ruling === "yes" ? def.yes : def.no);
        taken.add(def.archetype);
        arc.done = true;
        s.stats.arcsDone++;
      }
    }
  }
  queue.push(...forcedIds);
  for (const id of forcedIds) taken.add(content.requests.get(id)!.archetype);
  if (!s.tut) {
    while (queue.length < t.perDay!) {
      // Each mark pulls that faction's hostile petitioners into the court more often.
      let arch: string | null = null;
      if (s.marks.length && r.chance(Math.min(0.8, t.markPull! * s.marks.length))) {
        const f = r.pick(s.marks).faction;
        const pool = content.archetypeOrder.filter((a) => content.archetypes.get(a)!.faction === f && !taken.has(a));
        if (pool.length) arch = r.pick(pool);
      }
      arch ??= drawArchetype(s, content, r, taken);
      taken.add(arch);
      queue.push(pickRequest(s, content, arch, r).id);
    }
    r.shuffle(queue);
    // Forced petitions come first: vows and debts are the day's weight.
    queue.sort((a, b) => Number(!forcedIds.includes(a)) - Number(!forcedIds.includes(b)));
  }
  keep(s, "queue", r);
  s.queue = queue;

  // Deal: roughly every third day the Deceiver offers one at dawn.
  s.dealOffer = null;
  if (!s.tut || s.tut === 3) {
    const scripted = s.tut === 3 ? content.deceiver.tutorial[2]!.deal ?? null : null;
    if (scripted) s.dealOffer = scripted;
    else if (s.day >= t.dealEvery! && s.day % t.dealEvery! === 0 && (s.mode === "endless" || s.day < t.days!)) {
      const dr = stream(s, "dec");
      if (dr.chance(t.dealChance!)) {
        const soon = s.vows.some((v) => (v.status === "sworn" || v.status === "called") && v.due <= s.day + 3);
        const options = content.dealOrder.filter((id) => id !== "clean" || soon);
        s.dealOffer = dr.pick(options);
      }
      keep(s, "dec", dr);
    }
    if (s.dealOffer) ev.push({ t: "deal", id: s.dealOffer, accepted: false });
  }
  preparePetition(s, content, t);
}

/** Read the petitioner and the Deceiver's advice for the petition at the front of the queue. */
export function preparePetition(s: GameState, content: Content, t: Tuning): void {
  const req = currentRequest(s, content);
  const dec = stream(s, "dec");
  let truth = req.truth;
  let tell: string | null = req.tell;
  let advice: Cur["advice"] = null;
  if (s.tut && !req.vow) {
    const td = content.deceiver.tutorial[s.tut - 1]!;
    truth = td.truth;
    tell = td.tell;
    const trueRuling = truth ? "yes" : "no";
    advice = td.advice === null ? null : { ruling: td.advice === "lie" ? opposite(trueRuling) : trueRuling, lie: td.advice === "lie" };
  } else if (req.vow) {
    // He always urges you to break a vow.
    advice = { ruling: opposite(content.vows.get(req.vow)!.keep), lie: false };
    tell = null;
  } else if (req.forced) {
    advice = { ruling: "yes", lie: false };
    tell = null;
  } else {
    const shown = dec.chance(t.tellPresence!);
    const roll = dec.next();
    if (!shown) tell = null;
    const trueRuling = truth ? "yes" : "no";
    // He lies only when the true ruling would hurt him.
    const hurt = content.deceiver.hurts[req.faction] === trueRuling;
    const lie = hurt && roll < s.lieRate;
    advice = { ruling: lie ? opposite(trueRuling) : trueRuling, lie };
  }
  keep(s, "dec", dec);
  s.cur = { truth, tell, advice };
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
  if (s.activeDeals.some((d) => d.id === "mercy")) yes *= t.mercyYes!;
  if (req.forced) { yes *= t.debtYes!; haz *= t.debtHaz!; }
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

  const speed = speedFor(s, t) * (omen ? omen.speed : 1) * (s.activeDeals.some((d) => d.id === "slow") ? t.slowSpeed! : 1);
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
      s.over = "lose"; s.cause = key; s.ending = "collapse";
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
  if (s.dealOffer) throw new Error("answer the Deceiver's deal before ruling");
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

  // Reading people: a ruling against the truth costs that faction's favour; ruling against a proven lie exposes him.
  const cur = s.cur;
  if (!req.vow && !req.forced && kind !== "hazard" && !s.over) {
    const correct = cur.truth ? "yes" : "no";
    if (kind !== correct) {
      s.stats.wrong++;
      applyFx(s, t, { [FACTION_STAT[req.faction]]: -t.wrongPenalty! } as Fx, "wrong", ev);
      if (cur.advice?.lie && kind === cur.advice.ruling && cur.tell && s.expose > 0) {
        s.expose--;
        ev.push({ t: "expose", n: s.expose, delta: -1 });
      }
    } else if (cur.advice?.lie && cur.tell && content.tells.get(cur.tell)!.signal === (cur.truth ? "truth" : "lie")) {
      s.expose++;
      s.stats.caught++;
      ev.push({ t: "expose", n: s.expose, delta: 1 });
    }
  }
  // Vow call-in: keep it or break it. A hazard counts as forgetting it.
  if (req.vow) {
    const def = content.vows.get(req.vow)!;
    const vs = s.vows.find((v) => v.id === req.vow);
    if (vs) {
      if (kind === def.keep) { vs.status = "kept"; ev.push({ t: "vow", id: vs.id, result: "kept" }); }
      else { vs.status = "broken"; s.marks.push({ faction: def.faction, vow: def.id }); ev.push({ t: "vow", id: vs.id, result: "broken" }); }
    }
  }

  // Recurring character: remember the ruling and schedule the return.
  if (req.arc && !s.arcs[req.arc]) {
    const r = stream(s, "queue");
    const delay = r.int(t.arcDelayMin!, t.arcDelayMax!);
    keep(s, "queue", r);
    const arc: ArcState = { ruling: kind === "yes" ? "yes" : "no", due: Math.min(s.day + delay, t.days!), done: false };
    s.arcs[req.arc] = arc;
  }

  checkEndings(s, t, ev);
  s.slot++;
  if (!s.over && s.slot >= s.queue.length) endDay(s, content, t, ev);
  else if (!s.over) preparePetition(s, content, t);
  return { kind, requestId: req.id, events: ev };
}

/** The Deceiver wins at Usurpation 10; you win by exposing him first (the ending depends on how you got there). */
function checkEndings(s: GameState, t: Tuning, ev: Ev[]): void {
  if (s.over || s.tut) return;
  if (s.usurp >= t.usurpLimit!) {
    s.over = "lose"; s.ending = "usurped";
    ev.push({ t: "ending", id: "usurped" }, { t: "reign.lose", cause: "weak" });
    return;
  }
  if (s.expose >= t.exposeLimit!) {
    if (s.mode === "endless") {
      // He slinks away and comes back stronger.
      s.expose = 0; s.usurp = 0; s.cycle++;
      return;
    }
    const ending: Ending = s.marks.length >= 3 ? "marked" : s.dealsTaken >= 3 ? "hollow" : "just";
    s.over = "win"; s.ending = ending;
    ev.push({ t: "ending", id: ending }, { t: "reign.win" });
  }
}

/** Accept or refuse the Deceiver's dawn deal. Accepting buys an edge now and a debt later. */
export function answerDeal(s: GameState, content: Content, t: Tuning, accept: boolean): Ev[] {
  const ev: Ev[] = [];
  const id = s.dealOffer;
  if (!id || s.over) return ev;
  const deal = content.deals.get(id)!;
  s.dealOffer = null;
  ev.push({ t: "deal", id, accepted: accept });
  if (!accept) return ev;
  s.dealsTaken++;
  s.usurp += deal.usurp + s.cycle * t.endlessEscalate!;
  const dr = stream(s, "dec");
  s.debts.push({ due: s.day + dr.int(t.debtMin!, t.debtMax!) });
  keep(s, "dec", dr);
  if (deal.days) s.activeDeals.push({ id, until: s.day + deal.days - 1 });
  if (deal.fx) applyFx(s, t, deal.fx, "deal", ev, deal.icon);
  if (id === "clean") {
    // Erase the vow that is due soonest: no mark.
    const target = s.vows.filter((v) => v.status === "sworn" || v.status === "called").sort((a, b) => a.due - b.due)[0];
    if (target) {
      const wasCalled = target.status === "called";
      target.status = "erased";
      ev.push({ t: "vow", id: target.id, result: "erased" });
      if (wasCalled) {
        const reqId = content.vows.get(target.id)!.request;
        const at = s.queue.indexOf(reqId, s.slot);
        if (at >= 0) {
          const r = stream(s, "queue");
          const taken = new Set(s.queue.map((q) => content.requests.get(q)!.archetype));
          s.queue[at] = pickRequest(s, content, drawArchetype(s, content, r, taken), r).id;
          keep(s, "queue", r);
        }
      }
    }
  }
  checkEndings(s, t, ev);
  if (!s.over) preparePetition(s, content, t);
  return ev;
}

/** Daily tick: omen, taxes, happiness drag, gold fixing unrest, population growth; then win/lose. */
export function endDay(s: GameState, content: Content, t: Tuning, ev: Ev[]): void {
  s.dayEnded = true;
  if (s.tut) { ev.push({ t: "day.end", day: s.day }); return; }
  if (s.stats.hazardToday === 0) s.stats.cleanDays++;
  if (s.expose > 0 && s.day % t.exposeDecay! === 0) s.expose--;
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
    s.ending = ok ? "long" : "weak";
    if (ok) ev.push({ t: "ending", id: "long" });
    ev.push(ok ? { t: "reign.win" } : { t: "reign.lose", cause: "weak" });
  }
}

/** Leave the day-end summary and begin the next day. */
export function nextDay(s: GameState, content: Content, t: Tuning): Ev[] {
  const ev: Ev[] = [];
  if (s.over || !s.dayEnded) return ev;
  if (s.tut === 3) {
    // The tutorial never counts toward the 25: the real reign starts clean with the same vows sworn.
    s.tut = 0; s.day = 1;
    s.p = t.startP!; s.h = t.startH!; s.g = t.startG!;
    s.pending = []; s.debts = []; s.activeDeals = []; s.marks = []; s.arcs = {}; s.seen = {};
    s.usurp = 0; s.expose = 0; s.dealsTaken = 0; s.cycle = 0;
    s.stats = { yes: 0, no: 0, hazards: 0, delayed: 0, cleanDays: 0, hazardToday: 0, streak: 0, bestStreak: 0, stops: 0, arcsDone: 0, caught: 0, wrong: 0 };
    const r = stream(s, "vow");
    scheduleVows(s, content, t, r);
    keep(s, "vow", r);
  } else if (s.tut) {
    s.tut++; s.day = s.tut;
  } else s.day++;
  startDay(s, content, t, ev);
  return ev;
}

export function finalScore(s: GameState, t: Tuning): number {
  const days = s.over && s.dayEnded ? s.day : s.day - 1;
  let score = days * t.scoreDay! + s.stats.cleanDays * t.scoreCleanDay!;
  score += Math.round((s.p + s.h + s.g) * t.scoreStat!);
  if (s.over === "win") {
    score += s.ending === "just" ? t.scoreJust! : s.ending === "marked" ? t.scoreMarked! : s.ending === "hollow" ? t.scoreHollow! : t.scoreLong!;
  }
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

/** How far the court has rotted: 0 sworn, 1 strained, 2 hollowed, 3 usurped. Driven by marks and (hidden) Usurpation. */
export function courtStage(s: GameState, t: Tuning): 0 | 1 | 2 | 3 {
  const m = s.marks.length, u = s.usurp;
  if (m >= t.rot3Marks! || u >= t.rot3Usurp!) return 3;
  if (m >= t.rot2Marks! || u >= t.rot2Usurp!) return 2;
  if (m >= t.rot1Marks! || u >= t.rot1Usurp!) return 1;
  return 0;
}
