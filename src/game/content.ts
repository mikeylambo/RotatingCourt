import petitionersJson from "./data/petitioners.json";
import arcsJson from "./data/arcs.json";
import omensJson from "./data/omens.json";
import hazardsJson from "./data/hazards.json";
import metaJson from "./data/meta.json";
import vowsJson from "./data/vows.json";
import deceiverJson from "./data/deceiver.json";
import { FACTIONS } from "./types";
import type {
  AchievementDef, ArcDef, ArchetypeDef, ChallengeDef, Content, DealDef, DeceiverData, Faction, Fx, HazardDef, Later, Look, OmenDef,
  Outcome, RequestDef, TellDef, VowDef
} from "./types";

type Vec = number[];
type LaterRow = number[];

const fx = (v: Vec | undefined): Fx => {
  const out: Fx = {};
  if (!v) return out;
  if (v[0]) out.p = v[0];
  if (v[1]) out.h = v[1];
  if (v[2]) out.g = v[2];
  return out;
};

const later = (rows: LaterRow[] | undefined, icon: string): Later[] =>
  (rows ?? []).map((r) => ({ in: r[0]!, fx: fx(r.slice(1, 4)), icon, hidden: r[4] === 1 }));

interface RawReq {
  id: string; ask: string[]; line?: string; y: Vec; n: Vec; yl?: LaterRow[]; nl?: LaterRow[]; arc?: string; tr?: number; tl?: string;
}

function compileRequest(raw: RawReq, archetype: string, faction: Faction, extra: Partial<RequestDef> = {}): RequestDef {
  const icon = raw.ask[raw.ask.length - 1]!;
  const yes: Outcome = { now: fx(raw.y), later: later(raw.yl, icon) };
  const no: Outcome = { now: fx(raw.n), later: later(raw.nl, icon) };
  return { id: raw.id, archetype, faction, truth: raw.tr !== 0, tell: raw.tl ?? null, ask: raw.ask, line: raw.line, yes, no, arc: raw.arc, ...extra };
}

/** Build the typed content tables from the JSON files. Pure: safe in node and the browser. */
export function loadContent(): Content {
  const archetypes = new Map<string, ArchetypeDef>();
  const requests = new Map<string, RequestDef>();
  const archetypeOrder: string[] = [];

  const factionOf = new Map<string, Faction>();
  for (const a of petitionersJson as unknown as Array<{ id: string; faction: Faction; hazard: string; mag: number; look: number[]; reqs: RawReq[] }>) {
    const [head, hat, body, prop, skin, cloth] = a.look as [number, number, number, number, number, number];
    const look: Look = { head, hat, body, prop, skin, cloth };
    archetypes.set(a.id, { id: a.id, faction: a.faction, hazard: a.hazard, mag: a.mag, look, requests: a.reqs.map((r) => r.id) });
    factionOf.set(a.id, a.faction);
    archetypeOrder.push(a.id);
    for (const r of a.reqs) requests.set(r.id, compileRequest(r, a.id, a.faction));
  }

  const arcs = new Map<string, ArcDef>();
  for (const a of arcsJson as unknown as Array<{ id: string; archetype: string; start: string; yes: RawReq; no: RawReq }>) {
    requests.set(a.yes.id, compileRequest(a.yes, a.archetype, factionOf.get(a.archetype)!, { tell: null, truth: true }));
    requests.set(a.no.id, compileRequest(a.no, a.archetype, factionOf.get(a.archetype)!, { tell: null, truth: true }));
    arcs.set(a.id, { id: a.id, archetype: a.archetype, start: a.start, yes: a.yes.id, no: a.no.id });
  }

  const omens = new Map<string, OmenDef>();
  const omenOrder: string[] = [];
  for (const o of omensJson as unknown as Array<Omit<OmenDef, "daily"> & { daily: Vec }>) {
    omens.set(o.id, { ...o, daily: fx(o.daily) });
    omenOrder.push(o.id);
  }

  const hazards = new Map<string, HazardDef>();
  for (const [id, h] of Object.entries(hazardsJson as unknown as Record<string, {
    icon: string; pattern: string; edge: string; now: Vec; later: LaterRow[]; pool?: Vec[];
  }>)) {
    hazards.set(id, {
      id, icon: h.icon, pattern: h.pattern, edge: h.edge, now: fx(h.now),
      later: later(h.later, h.icon), pool: h.pool?.map(fx)
    });
  }

  // Deceiver: tells, deals, his forced debt petition, and the vows with their call-in petitions.
  const dj = deceiverJson as unknown as DeceiverData & { tells: TellDef[]; deals: Array<{ id: string; icon: string; usurp: number; days?: number; fx?: Vec }>; debt: RawReq & { archetype: string } };
  const tells = new Map(dj.tells.map((t) => [t.id, t]));
  const deals = new Map<string, DealDef>(dj.deals.map((d) => [d.id, { id: d.id, icon: d.icon, usurp: d.usurp, days: d.days, fx: d.fx ? fx(d.fx) : undefined }]));
  requests.set(dj.debt.id, compileRequest(dj.debt, dj.debt.archetype, factionOf.get(dj.debt.archetype)!, { forced: true, tell: null, truth: true }));
  const vows = new Map<string, VowDef>();
  for (const v of vowsJson as unknown as Array<Omit<VowDef, "request"> & { request: RawReq & { archetype: string } }>) {
    requests.set(v.request.id, compileRequest(v.request, v.request.archetype, v.faction, { vow: v.id, tell: null, truth: true }));
    vows.set(v.id, { id: v.id, faction: v.faction, icons: v.icons, line: v.line, keep: v.keep, due: v.due, request: v.request.id });
  }

  const meta = metaJson as unknown as { achievements: AchievementDef[]; challenges: ChallengeDef[] };
  return {
    tells, vows, vowOrder: [...vows.keys()], deals, dealOrder: [...deals.keys()],
    deceiver: { hurts: dj.hurts, advice: dj.advice, greeting: dj.greeting, caught: dj.caught, tutorial: dj.tutorial },
    archetypes, archetypeOrder, requests, arcs, omens, omenOrder, hazards, achievements: meta.achievements, challenges: meta.challenges };
}

/** Structural content checks used by the test suite and the dev build. Returns problems found. */
export function validateContent(c: Content): string[] {
  const issues: string[] = [];
  if (c.archetypes.size !== 24) issues.push(`expected 24 archetypes, found ${c.archetypes.size}`);
  const base = [...c.requests.values()].filter((r) => !r.id.startsWith("arc.") && !r.id.startsWith("vow.") && r.id !== "deceiver.debt");
  if (base.length !== 48) issues.push(`expected 48 requests, found ${base.length}`);
  if (c.arcs.size !== 6) issues.push(`expected 6 recurring arcs, found ${c.arcs.size}`);
  if (c.omens.size !== 8) issues.push(`expected 8 omens, found ${c.omens.size}`);
  for (const a of c.archetypes.values()) {
    if (!c.hazards.has(a.hazard)) issues.push(`${a.id}: unknown hazard ${a.hazard}`);
    if (a.requests.length !== 2) issues.push(`${a.id}: needs 2 requests`);
  }
  for (const r of c.requests.values()) {
    if (!c.archetypes.has(r.archetype)) issues.push(`${r.id}: unknown archetype`);
    if (r.line && r.line.split(/\s+/).length > 5) issues.push(`${r.id}: line too long for the copy budget`);
    if (r.ask.length < 1 || r.ask.length > 3) issues.push(`${r.id}: ask pictogram needs 1-3 icons`);
    for (const o of [r.yes, r.no]) for (const l of o.later) if (l.in < 1 || l.in > 4) issues.push(`${r.id}: delay out of range`);
  }
  for (const a of c.arcs.values()) {
    if (!c.requests.get(a.start)?.arc) issues.push(`arc ${a.id}: start request not flagged`);
    if (!c.requests.has(a.yes) || !c.requests.has(a.no)) issues.push(`arc ${a.id}: missing return requests`);
  }
  if (c.vows.size !== 8) issues.push(`expected 8 vows, found ${c.vows.size}`);
  for (const f of FACTIONS) if ([...c.vows.values()].filter((v) => v.faction === f).length !== 2) issues.push(`faction ${f} needs exactly 2 vows`);
  for (const v of c.vows.values()) if (!c.requests.get(v.request)?.vow) issues.push(`vow ${v.id}: missing call-in petition`);
  if (c.deals.size !== 4) issues.push(`expected 4 deals, found ${c.deals.size}`);
  if (c.tells.size !== 8) issues.push(`expected 8 tells, found ${c.tells.size}`);
  for (const r of base) {
    if (!r.tell || !c.tells.has(r.tell)) issues.push(`${r.id}: missing tell`);
    else if ((c.tells.get(r.tell)!.signal === "truth") !== r.truth) issues.push(`${r.id}: tell contradicts its truth flag`);
  }
  for (const l of [...c.deceiver.advice.yes, ...c.deceiver.advice.no, c.deceiver.greeting, ...c.deceiver.caught]) if (l.split(/\s+/).length > 5) issues.push(`deceiver line too long: ${l}`);
  const hazardKinds = new Set<string>();
  for (const h of c.hazards.values()) hazardKinds.add(`${h.pattern}|${h.icon}`);
  if (hazardKinds.size !== c.hazards.size) issues.push("hazard patterns/icons are not unique");
  // Shape grammar: every pair of petitioners must differ in at least two parts so silhouettes stay distinct.
  const list = [...c.archetypes.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i]!.look, b = list[j]!.look;
    const d = Number(a.head !== b.head) + Number(a.hat !== b.hat) + Number(a.body !== b.body) + Number(a.prop !== b.prop);
    if (d < 2) issues.push(`${list[i]!.id}/${list[j]!.id}: portraits too similar (${d} parts differ)`);
  }
  return issues;
}
