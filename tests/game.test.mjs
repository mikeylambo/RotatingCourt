import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = await import("../.sim/test-api.mjs");
const tuning = JSON.parse(readFileSync("tuning/court.json", "utf8")).values;
const content = api.loadContent();

test("content: counts, validity and unique silhouettes", () => {
  assert.deepEqual(api.validateContent(content), []);
  assert.equal(content.archetypes.size, 24);
  assert.equal([...content.requests.keys()].filter((k) => !k.startsWith("arc.")).length, 48);
  assert.equal(content.arcs.size, 6);
  assert.equal(content.omens.size, 8);
});

test("content: every icon id used by data exists", () => {
  const used = new Set();
  for (const r of content.requests.values()) r.ask.forEach((i) => used.add(i));
  for (const h of content.hazards.values()) used.add(h.icon);
  for (const o of content.omens.values()) used.add(o.icon);
  for (const a of content.achievements) used.add(a.icon);
  for (const c of content.challenges) used.add(c.icon);
  const missing = [...used].filter((i) => !api.hasIcon(i));
  assert.deepEqual(missing, []);
});

test("copy budget: one short line per request, no placeholder text", () => {
  for (const r of content.requests.values()) {
    if (r.line) assert.ok(r.line.split(/\s+/).length <= 5, r.id);
  }
  const blob = JSON.stringify([...content.requests.values()]).toLowerCase();
  for (const bad of ["lorem", "todo", "placeholder", "tbd"]) assert.ok(!blob.includes(bad), bad);
});

test("tuning: every key the engine reads exists in the tuning JSON", () => {
  const src = readFileSync("src/game/engine.ts", "utf8") + readFileSync("src/sim/bots.ts", "utf8");
  const keys = new Set([...src.matchAll(/\bt\.([a-zA-Z]+)!/g)].map((m) => m[1]));
  const missing = [...keys].filter((k) => typeof tuning[k] !== "number");
  assert.deepEqual(missing, []);
});

test("engine: same seed and inputs give identical runs; seeds differ", () => {
  const a = api.playRun(content, tuning, "skilled", "S42");
  const b = api.playRun(content, tuning, "skilled", "S42");
  assert.deepEqual(a, b);
  const c = api.playRun(content, tuning, "skilled", "S43");
  assert.notDeepEqual(a, c);
});

test("engine: saved state round-trips through JSON and resumes identically", () => {
  const play = (s, until) => {
    let n = 0;
    while (!s.over && n++ < until) {
      if (s.dayEnded) { api.nextDay(s, content, tuning); continue; }
      const seg = s.wheel.segs.find((x) => x.kind === (n % 2 ? "yes" : "no"));
      api.rule(s, content, tuning, seg.start + seg.size / 2);
    }
  };
  const whole = api.createRun(content, tuning, { mode: "reign", seed: "R1" });
  play(whole, 60);
  const half = api.createRun(content, tuning, { mode: "reign", seed: "R1" });
  play(half, 23);
  const resumed = JSON.parse(JSON.stringify(half));
  let n = 23;
  while (!resumed.over && n++ < 60) {
    if (resumed.dayEnded) { api.nextDay(resumed, content, tuning); continue; }
    const seg = resumed.wheel.segs.find((x) => x.kind === (n % 2 ? "yes" : "no"));
    api.rule(resumed, content, tuning, seg.start + seg.size / 2);
  }
  assert.deepEqual(resumed, whole);
});

test("wheel: stats bend segments and pointer speed", () => {
  const base = api.createRun(content, tuning, { mode: "reign", seed: "W1" });
  const size = (s, kind) => api.segOf(s.wheel, kind).size;
  const yes0 = size(base, "yes");
  const low = structuredClone(base); low.h = 10; api.prepareWheel(low, content, tuning);
  assert.ok(size(low, "yes") < yes0, "low happiness narrows YES");
  const fast = structuredClone(base); fast.p = 95; assert.ok(api.speedFor(fast, tuning) > api.speedFor(base, tuning), "high population speeds the pointer");
  const late = structuredClone(base); late.day = 20; assert.ok(api.speedFor(late, tuning) > api.speedFor(base, tuning), "day ramps speed");
  // low gold widens the bribe segment (find a bribe petitioner)
  const merchant = structuredClone(base);
  merchant.queue = ["merchant.b", ...merchant.queue.slice(1)]; merchant.slot = 0;
  const rich = structuredClone(merchant); rich.g = 80; api.prepareWheel(rich, content, tuning);
  const poor = structuredClone(merchant); poor.g = 5; api.prepareWheel(poor, content, tuning);
  assert.ok(size(poor, "hazard") > size(rich, "hazard"), "low gold widens the bribe segment");
});

test("assist: slower and wider, and scoring ignores it", () => {
  const a = api.createRun(content, tuning, { mode: "reign", seed: "A1" });
  const b = api.createRun(content, tuning, { mode: "reign", seed: "A1", assist: true });
  assert.ok(b.wheel.speed < a.wheel.speed);
  assert.ok(api.segOf(b.wheel, "yes").size > api.segOf(a.wheel, "yes").size);
  const x = structuredClone(a), y = structuredClone(a); y.assist = true; y.assisted = false;
  x.day = y.day = 10; x.stats.cleanDays = y.stats.cleanDays = 4;
  assert.equal(api.finalScore(x, tuning), api.finalScore(y, tuning));
});

test("delayed effects land 1-4 days later and a calendar event is emitted", () => {
  const s = api.createRun(content, tuning, { mode: "reign", seed: "D9" });
  s.queue = ["merchant.a", ...s.queue.slice(1)]; s.slot = 0; api.prepareWheel(s, content, tuning);
  const yes = api.segOf(s.wheel, "yes");
  const r = api.rule(s, content, tuning, yes.start + yes.size / 2);
  const later = r.events.filter((e) => e.t === "later");
  assert.ok(later.length >= 1);
  for (const e of later) assert.ok(e.due - s.day >= 1 && e.due - s.day <= 4);
  assert.ok(s.pending.length >= 1);
  const due = Math.min(...s.pending.map((p) => p.due));
  let landed = false;
  for (let guard = 0; guard < 400 && !landed && !s.over; guard++) {
    if (s.dayEnded) { const ev = api.nextDay(s, content, tuning); if (ev.some((e) => e.t === "delayed.resolve")) { landed = true; assert.equal(s.day, due); } continue; }
    const seg = s.wheel.segs.find((x) => x.kind === "no");
    api.rule(s, content, tuning, seg.start + seg.size / 2);
  }
  assert.ok(landed || s.over);
});

test("stats: population grows only above the happiness threshold; drag pulls happiness down", () => {
  const mk = (h) => { const s = api.createRun(content, tuning, { mode: "reign", seed: "G1" }); s.p = 50; s.h = h; s.g = 60; s.omen = null; return s; };
  const happy = mk(70), sad = mk(35);
  api.endDay(happy, content, tuning, []); api.endDay(sad, content, tuning, []);
  assert.ok(happy.p > 50, "grows when happy");
  assert.ok(sad.p <= 50, "does not grow when unhappy");
  const calm = mk(60); const before = calm.h; api.endDay(calm, content, tuning, []);
  assert.ok(calm.h < before + tuning.fixHappy, "daily drag applies");
});

test("lose at zero, win only with all three above threshold", () => {
  const dead = api.createRun(content, tuning, { mode: "reign", seed: "L1" });
  dead.g = 1;
  const theft = structuredClone(dead); theft.queue = ["thief.b", ...theft.queue.slice(1)]; theft.slot = 0; api.prepareWheel(theft, content, tuning);
  const hz = api.segOf(theft.wheel, "hazard");
  api.rule(theft, content, tuning, hz.start + hz.size / 2);
  assert.equal(theft.over, "lose"); assert.equal(theft.cause, "g");

  const finish = (stats) => {
    const s = api.createRun(content, tuning, { mode: "reign", seed: "F1" });
    s.day = tuning.days; s.slot = tuning.perDay - 1; s.omen = null; s.pending = [];
    Object.assign(s, stats);
    const seg = api.segOf(s.wheel, "yes");
    api.rule(s, content, tuning, seg.start + seg.size / 2);
    return s;
  };
  assert.equal(finish({ p: 90, h: 90, g: 90 }).over, "win");
  assert.equal(finish({ p: 90, h: 90, g: 20 }).over, "fall");
});

test("modes: endless never ends by day count; daily seed is stable per day", () => {
  const s = api.createRun(content, tuning, { mode: "endless", seed: "E1" });
  s.day = 40; s.slot = 4; s.p = s.h = s.g = 80; s.omen = null;
  api.rule(s, content, tuning, api.segOf(s.wheel, "yes").start + 0.01);
  assert.equal(s.over, null);
  const d = new Date("2026-03-04T10:00:00Z");
  assert.equal(api.scheduledSeed("rotating-court", "daily", d).seed, api.scheduledSeed("rotating-court", "daily", new Date("2026-03-04T23:00:00Z")).seed);
  assert.notEqual(api.scheduledSeed("rotating-court", "daily", d).seed, api.scheduledSeed("rotating-court", "daily", new Date("2026-03-05T01:00:00Z")).seed);
});

test("audio: every required semantic event has a synthesized recipe", () => {
  const need = ["wheel.tick", "wheel.lock", "ruling.yes", "ruling.no", "hazard.hit", "delayed.resolve", "day.end", "reign.win", "reign.lose", "ui.confirm"];
  assert.deepEqual(need.filter((e) => !api.soundEvents().includes(e)), []);
});

test("art: a dropped-in sprite wins over procedural, missing files fall back", async () => {
  globalThis.Image = class { set src(v) { this._s = v; queueMicrotask(() => this.onload?.()); } };
  await api.registerVisuals(content);
  assert.equal(api.visualSource("petitioner.farmer"), "sprite");
  assert.equal(api.visualSource("petitioner.baker"), "procedural");
  assert.equal(api.visualSource("ruler.king"), "procedural");
  assert.equal(api.visualSource("court.backdrop"), "procedural");
  assert.equal(api.visualSource("wheel.face"), "procedural");
});

test("balance table (3000 runs per bot) holds on the canon tuning", () => {
  const rate = (bot) => { let w = 0; for (let i = 0; i < 3000; i++) if (api.playRun(content, tuning, bot, `S${i + 1}`).win) w++; return (100 * w) / 3000; };
  const r = { yes: rate("yes"), no: rate("no"), random: rate("random"), skilled: rate("skilled") };
  console.log("balance", JSON.stringify(r));
  assert.ok(r.yes < 5, `always yes ${r.yes}`);
  assert.equal(r.no, 0);
  assert.ok(r.random > 6 && r.random < 15, `random ${r.random}`);
  assert.ok(r.skilled >= 50 && r.skilled <= 60, `skilled ${r.skilled}`);
});
