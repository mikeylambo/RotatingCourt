import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const api = await import("../.sim/test-api.mjs");
const tuning = JSON.parse(readFileSync("tuning/court.json", "utf8")).values;
const content = api.loadContent();

/** Play helper: answers any dawn deal (refuse) and moves through day ends. */
function step(s, kind = "yes", opts = {}) {
  if (s.dealOffer) { api.answerDeal(s, content, tuning, !!opts.accept); return; }
  if (s.dayEnded) { api.nextDay(s, content, tuning); return; }
  const seg = s.wheel.segs.find((x) => x.kind === kind);
  api.rule(s, content, tuning, seg.start + seg.size / 2);
}
const setQueue = (s, ids, tun = tuning) => { s.queue = ids; s.slot = 0; api.preparePetition(s, content, tun); };

test("content: counts, validity and unique silhouettes", () => {
  assert.deepEqual(api.validateContent(content), []);
  assert.equal(content.archetypes.size, 24);
  assert.equal([...content.requests.keys()].filter((k) => !k.startsWith("arc.") && !k.startsWith("vow.") && k !== "deceiver.debt").length, 48);
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
  for (const t of content.tells.values()) used.add(t.id);
  for (const d of content.deals.values()) used.add(d.icon);
  for (const v of content.vows.values()) v.icons.forEach((i) => used.add(i));
  for (const f of ["wheat", "cross", "sword", "coin", "crack", "blade", "halfmask", "oath"]) used.add(f);
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
      step(s, n % 2 ? "yes" : "no");
    }
  };
  const whole = api.createRun(content, tuning, { mode: "reign", seed: "R1" });
  play(whole, 60);
  const half = api.createRun(content, tuning, { mode: "reign", seed: "R1" });
  play(half, 23);
  const resumed = JSON.parse(JSON.stringify(half));
  let n = 23;
  while (!resumed.over && n++ < 60) {
    step(resumed, n % 2 ? "yes" : "no");
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
  setQueue(s, ["merchant.a", ...s.queue.slice(1)]);
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
    step(s, "no");
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
  const theft = structuredClone(dead); setQueue(theft, ["thief.b", ...theft.queue.slice(1)]);
  const hz = api.segOf(theft.wheel, "hazard");
  api.rule(theft, content, tuning, hz.start + hz.size / 2);
  assert.equal(theft.over, "lose"); assert.equal(theft.cause, "g");

  const finish = (stats) => {
    const s = api.createRun(content, tuning, { mode: "reign", seed: "F1" });
    s.day = tuning.days; s.queue = s.queue.slice(0, 5); s.slot = s.queue.length - 1; s.omen = null; s.pending = []; s.dealOffer = null; s.vows.forEach((v) => (v.status = "kept"));
    api.preparePetition(s, content, tuning);
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
  s.day = 40; s.dealOffer = null; s.slot = s.queue.length - 1; s.p = s.h = s.g = 80; s.omen = null; api.preparePetition(s, content, tuning);
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

/* ------------------------------------------------------------- Deceiver edit */

test("vows: 4 factions x 2 vows, 3 sworn per run, windows respected, each called in", () => {
  assert.equal(content.vows.size, 8);
  for (const f of ["commons", "temple", "army", "treasury"]) assert.equal([...content.vows.values()].filter((v) => v.faction === f).length, 2);
  const s = api.createRun(content, tuning, { mode: "reign", seed: "V1" });
  assert.equal(s.vows.length, 3);
  assert.equal(new Set(s.vows.map((v) => v.due)).size, 3, "distinct call-in days");
  for (const v of s.vows) {
    const [lo, hi] = content.vows.get(v.id).due;
    assert.ok(v.due >= lo && v.due <= Math.max(lo, hi) && v.due <= tuning.days - 2);
    assert.equal(v.status, "sworn");
  }
  // play a whole reign with strong stats so nothing collapses: every vow gets called in
  const t = { ...tuning, wrongPenalty: 0 };
  let guard = 0;
  while (!s.over && guard++ < 2000) { s.p = s.h = s.g = 90; s.expose = 0; s.usurp = 0; step(s, "yes"); }
  for (const v of s.vows) assert.notEqual(v.status === "sworn", true, `vow ${v.id} was never called in`);
  void t;
});

test("vows: keeping costs, breaking leaves a mark, a hazard counts as breaking, never-called adds no mark", () => {
  const mk = (vowId, pick) => {
    const s = api.createRun(content, tuning, { mode: "reign", seed: "V2", vows: [vowId, "t1", "y1"] });
    s.vows[0].status = "called";
    setQueue(s, [content.vows.get(vowId).request, ...s.queue.slice(1)]);
    s.dealOffer = null;
    const kind = pick === "keep" ? content.vows.get(vowId).keep : pick === "break" ? (content.vows.get(vowId).keep === "yes" ? "no" : "yes") : "hazard";
    const seg = api.segOf(s.wheel, kind);
    api.rule(s, content, tuning, seg.start + seg.size / 2);
    return s;
  };
  const kept = mk("c1", "keep");
  assert.equal(kept.vows[0].status, "kept"); assert.equal(kept.marks.length, 0);
  const broken = mk("c1", "break");
  assert.equal(broken.vows[0].status, "broken"); assert.deepEqual(broken.marks, [{ faction: "commons", vow: "c1" }]);
  assert.equal(mk("a1", "hazard").vows[0].status, "broken");
  const fresh = api.createRun(content, tuning, { mode: "reign", seed: "V3" });
  assert.equal(fresh.marks.length, 0);
});

test("marks pull that faction's petitioners into the court", () => {
  const share = (marks) => {
    let commons = 0, total = 0;
    for (let i = 0; i < 120; i++) {
      const s = api.createRun(content, tuning, { mode: "reign", seed: `M${i}` });
      s.marks = marks.map((f) => ({ faction: f, vow: "x" }));
      s.dealOffer = null;
      s.day = 6;
      for (let d = 0; d < 3; d++) { s.slot = 5; s.dayEnded = true; api.nextDay(s, content, tuning); s.dealOffer = null; for (const q of s.queue) { total++; if (content.requests.get(q).faction === "commons") commons++; } }
    }
    return commons / total;
  };
  assert.ok(share(["commons", "commons", "commons"]) > share([]) + 0.1);
});

test("advice: he lies only when the true ruling would hurt him; tells never contradict truth", () => {
  for (const r of content.requests.values()) {
    if (r.vow || r.forced || r.id.startsWith("arc.")) continue;
    assert.equal(content.tells.get(r.tell).signal === "truth", r.truth, r.id);
  }
  const t = { ...tuning, lieRate: 1, tellPresence: 1 };
  let lies = 0, honest = 0;
  for (const r of content.requests.values()) {
    if (r.vow || r.forced || r.id.startsWith("arc.")) continue;
    const s = api.createRun(content, t, { mode: "reign", seed: "AD" });
    s.dealOffer = null; s.queue = [r.id]; s.slot = 0; api.preparePetition(s, content, t);
    const trueRuling = r.truth ? "yes" : "no";
    const hurt = content.deceiver.hurts[r.faction] === trueRuling;
    assert.equal(s.cur.advice.lie, hurt, r.id);
    assert.equal(s.cur.advice.ruling, hurt ? (trueRuling === "yes" ? "no" : "yes") : trueRuling, r.id);
    if (hurt) lies++; else honest++;
  }
  assert.ok(lies > 10 && honest > 10);
});

test("exposure: ruling against a lie the tell proves adds 1; obeying it costs you progress and the wrong ruling costs favour", () => {
  const t = { ...tuning, lieRate: 1, tellPresence: 1 };
  const liar = [...content.requests.values()].find((r) => !r.vow && !r.forced && !r.id.startsWith("arc.") && !r.truth && content.deceiver.hurts[r.faction] === "no");
  const mk = () => { const s = api.createRun(content, t, { mode: "reign", seed: "EX" }); s.dealOffer = null; setQueue(s, [liar.id], t); return s; };
  const a = mk();
  assert.equal(a.cur.advice.lie, true);
  api.rule(a, content, t, api.segOf(a.wheel, "no").start + 0.001);
  assert.equal(a.expose, 1);
  const b = mk(); b.expose = 2;
  const before = b.p + b.h + b.g;
  api.rule(b, content, t, api.segOf(b.wheel, "yes").start + 0.001);
  assert.equal(b.expose, 1, "obeying the lie costs progress");
  assert.ok(b.p + b.h + b.g < before + 20 && b.stats.wrong === 1);
});

test("deals: usurpation, debts, wheel changes, clean hands, and rule() waits for an answer", () => {
  const s = api.createRun(content, tuning, { mode: "reign", seed: "DL" });
  s.dealOffer = "mercy";
  assert.throws(() => api.rule(s, content, tuning, 0.1));
  const yes0 = api.segOf(s.wheel, "yes").size;
  api.answerDeal(s, content, tuning, true);
  assert.equal(s.usurp, 1); assert.equal(s.dealsTaken, 1);
  assert.ok(api.segOf(s.wheel, "yes").size > yes0, "mercy widens YES");
  assert.equal(s.debts.length, 1);
  const gap = s.debts[0].due - s.day;
  assert.ok(gap >= tuning.debtMin && gap <= tuning.debtMax);
  const slow = api.createRun(content, tuning, { mode: "reign", seed: "DL" }); const sp = slow.wheel.speed; slow.dealOffer = "slow"; api.answerDeal(slow, content, tuning, true);
  assert.ok(slow.wheel.speed < sp);
  const led = api.createRun(content, tuning, { mode: "reign", seed: "DL" }); led.g = 40; led.dealOffer = "ledger"; api.answerDeal(led, content, tuning, true);
  assert.ok(led.g > 40);
  const ref = api.createRun(content, tuning, { mode: "reign", seed: "DL" }); ref.dealOffer = "mercy"; api.answerDeal(ref, content, tuning, false);
  assert.equal(ref.usurp, 0); assert.equal(ref.debts.length, 0);
  const clean = api.createRun(content, tuning, { mode: "reign", seed: "DL" }); const dueVow = clean.vows.slice().sort((a, b) => a.due - b.due)[0];
  clean.dealOffer = "clean"; api.answerDeal(clean, content, tuning, true);
  assert.equal(clean.usurp, 2); assert.equal(dueVow.status, "erased"); assert.equal(clean.marks.length, 0);
});

test("debt: the forced petition arrives on the due day with a harsher wheel", () => {
  const s = api.createRun(content, tuning, { mode: "reign", seed: "DB" });
  s.debts.push({ due: 2 }); s.day = 1; s.dealOffer = null;
  s.slot = s.queue.length; s.dayEnded = true;
  api.nextDay(s, content, tuning);
  assert.equal(s.queue[0], "deceiver.debt");
  const base = api.createRun(content, tuning, { mode: "reign", seed: "DB" });
  assert.ok(api.segOf(s.wheel, "yes").size < api.segOf(base.wheel, "yes").size);
});

test("endings: usurped, just, marked, hollow, long reign, endless returns stronger", () => {
  const mk = () => { const s = api.createRun(content, tuning, { mode: "reign", seed: "EN" }); s.dealOffer = null; s.p = s.h = s.g = 80; return s; };
  const u = mk(); u.usurp = tuning.usurpLimit; u.dealOffer = "ledger"; api.answerDeal(u, content, tuning, false); u.dealOffer = "ledger"; api.answerDeal(u, content, tuning, true);
  assert.equal(u.ending, "usurped"); assert.equal(u.over, "lose");
  const exposeNow = (s) => {
    const t = { ...tuning, lieRate: 1, tellPresence: 1 };
    const liar = [...content.requests.values()].find((r) => !r.vow && !r.forced && !r.id.startsWith("arc.") && !r.truth && content.deceiver.hurts[r.faction] === "no");
    s.expose = tuning.exposeLimit - 1; setQueue(s, [liar.id], t);
    api.rule(s, content, t, api.segOf(s.wheel, "no").start + 0.001);
    return s;
  };
  const just = exposeNow(mk()); assert.equal(just.ending, "just"); assert.equal(just.over, "win");
  const marked = mk(); marked.marks = [1, 2, 3].map(() => ({ faction: "army", vow: "a1" })); assert.equal(exposeNow(marked).ending, "marked");
  const hollow = mk(); hollow.dealsTaken = 3; assert.equal(exposeNow(hollow).ending, "hollow");
  const long = mk(); long.day = tuning.days; long.vows.forEach((v) => (v.status = "kept")); long.queue = long.queue.slice(0, 1); long.slot = 0; api.preparePetition(long, content, tuning);
  api.rule(long, content, tuning, api.segOf(long.wheel, "yes").start + 0.001);
  assert.equal(long.ending, "long");
  const e = mk(); e.mode = "endless"; const e2 = exposeNow(e);
  assert.equal(e2.over, null); assert.equal(e2.cycle, 1); assert.equal(e2.expose, 0);
  e2.dealOffer = "mercy"; api.answerDeal(e2, content, tuning, true);
  assert.ok(e2.usurp > 1, "escalated deal cost");
});

test("tutorial: Vow Night + three scripted days never count toward the 25; bots skip it", () => {
  const s = api.createRun(content, tuning, { mode: "reign", seed: "TU", tutorial: true });
  assert.equal(s.tut, 1); assert.equal(s.vows.length, 3);
  assert.equal(s.queue.length, 1); assert.equal(s.cur.tell, null); assert.equal(s.cur.advice, null);
  assert.equal(s.dealOffer, null);
  step(s, "yes"); assert.equal(s.dayEnded, true); step(s);
  assert.equal(s.tut, 2); assert.equal(s.cur.tell, "steady"); assert.equal(s.cur.advice.lie, false); assert.equal(s.dealOffer, null);
  step(s, "yes"); step(s);
  assert.equal(s.tut, 3);
  assert.equal(s.vows[0].status, "called"); assert.ok(s.dealOffer, "first deal offered on day 3");
  api.answerDeal(s, content, tuning, false);
  assert.equal(content.requests.get(s.queue[0]).vow, s.vows[0].id);
  step(s, "yes"); // vow
  assert.equal(s.cur.advice.lie, true); assert.equal(s.cur.tell, "seal");
  step(s, "no"); // catches the first lie
  assert.equal(s.expose, 1);
  assert.equal(s.dayEnded, true);
  step(s); // leaves tutorial
  assert.equal(s.tut, 0); assert.equal(s.day, 1); assert.equal(s.expose, 0); assert.equal(s.usurp, 0); assert.equal(s.marks.length, 0);
  assert.equal(s.p, tuning.startP); assert.ok(s.vows.every((v) => v.status === "sworn"));
  assert.equal(api.createRun(content, tuning, { mode: "reign", seed: "TU" }).tut, 0);
});

test("first run after the tutorial starts with a low lie rate", () => {
  assert.equal(api.createRun(content, tuning, { mode: "reign", seed: "F", firstRun: true }).lieRate, tuning.lieRateFirst);
  assert.equal(api.createRun(content, tuning, { mode: "reign", seed: "F" }).lieRate, tuning.lieRate);
});
