/** Shared data shapes. Pure data only: nothing here touches the DOM, time, or Math.random. */

export type StatKey = "p" | "h" | "g";
export type Fx = { p?: number; h?: number; g?: number };
export type Mode = "reign" | "daily" | "endless";

export interface Later {
  /** Days after the ruling that the effect lands (1-4). */
  in: number;
  fx: Fx;
  /** Calendar icon. Defaults to the request's first ask icon. */
  icon?: string;
  /** Hidden effects show a mystery mark on the calendar until they land. */
  hidden?: boolean;
}

export interface Outcome {
  now: Fx;
  later: Later[];
}

export type Faction = "commons" | "temple" | "army" | "treasury";
export const FACTIONS: Faction[] = ["commons", "temple", "army", "treasury"];
/** The stat each faction's favour is felt in. */
/** Pictogram per faction. */
export const FACTION_ICON: Record<Faction, string> = { commons: "wheat", temple: "cross", army: "sword", treasury: "coin" };
export const FACTION_STAT: Record<Faction, StatKey> = { commons: "h", temple: "h", army: "p", treasury: "g" };

export interface RequestDef {
  id: string;
  archetype: string;
  faction: Faction;
  /** Hidden: is the petitioner honest? Honest petitions should be granted, dishonest refused. */
  truth: boolean;
  /** Tell icon that hints at the truth flag. */
  tell: string | null;
  /** Set for vow call-in petitions. */
  vow?: string;
  forced?: boolean;
  /** Pictogram of the ask: icon ids. */
  ask: string[];
  /** At most one short line. */
  line?: string;
  yes: Outcome;
  no: Outcome;
  /** Recurring-character arc this request starts. */
  arc?: string;
}

export interface Look {
  head: number;
  hat: number;
  body: number;
  prop: number;
  skin: number;
  cloth: number;
}

export interface ArchetypeDef {
  id: string;
  faction: Faction;
  hazard: string;
  /** Hazard magnitude multiplier. */
  mag: number;
  look: Look;
  requests: string[];
}

export interface HazardDef {
  id: string;
  icon: string;
  pattern: string;
  edge: string;
  now: Fx;
  later: Later[];
  /** Chaos: pick one of these effect vectors at random instead of `now`. */
  pool?: Fx[];
}

export interface ArcDef {
  id: string;
  archetype: string;
  start: string;
  /** Request ids that fire when the character returns. */
  yes: string;
  no: string;
}

export interface OmenDef {
  id: string;
  icon: string;
  yes: number;
  no: number;
  haz: number;
  speed: number;
  daily: Fx;
  /** No population growth today. */
  noGrowth?: boolean;
}

export interface AchievementDef {
  id: string;
  icon: string;
  label: string;
}

export interface ChallengeDef {
  id: string;
  icon: string;
  label: string;
  /** Tuning overrides applied for this challenge's Reign. */
  tuning: Record<string, number>;
  medals: { medal: string; threshold: number }[];
}

export interface TellDef { id: string; signal: "lie" | "truth" }
export interface VowDef {
  id: string;
  faction: Faction;
  icons: string[];
  line: string;
  /** The ruling that keeps the vow. */
  keep: "yes" | "no";
  due: [number, number];
  request: string;
}
export interface DealDef { id: string; icon: string; usurp: number; days?: number; fx?: Fx }
export interface TutorialDay { requests: string[]; tell: string | null; advice: "true" | "lie" | null; truth: boolean; vow?: boolean; deal?: string }
export interface DeceiverData {
  hurts: Record<Faction, "yes" | "no">;
  advice: { yes: string[]; no: string[] };
  greeting: string;
  caught: string[];
  offer: string[];
  tutorial: TutorialDay[];
}

export interface Content {
  tells: Map<string, TellDef>;
  vows: Map<string, VowDef>;
  vowOrder: string[];
  deals: Map<string, DealDef>;
  dealOrder: string[];
  deceiver: DeceiverData;
  archetypes: Map<string, ArchetypeDef>;
  archetypeOrder: string[];
  requests: Map<string, RequestDef>;
  arcs: Map<string, ArcDef>;
  omens: Map<string, OmenDef>;
  omenOrder: string[];
  hazards: Map<string, HazardDef>;
  achievements: AchievementDef[];
  challenges: ChallengeDef[];
}

export type Tuning = Record<string, number>;

export type SegKind = "yes" | "no" | "hazard";
export interface WheelSeg {
  kind: SegKind;
  start: number;
  size: number;
}
export interface Wheel {
  segs: WheelSeg[];
  phase: number;
  /** Revolutions per second once spun up. */
  speed: number;
  spinUp: number;
  hazard: string;
}

export interface Pending {
  id: number;
  due: number;
  fx: Fx;
  icon: string;
  hidden: boolean;
}

export interface ArcState {
  ruling: "yes" | "no";
  due: number;
  done: boolean;
}

export interface RunStats {
  yes: number;
  no: number;
  hazards: number;
  delayed: number;
  cleanDays: number;
  hazardToday: number;
  streak: number;
  bestStreak: number;
  stops: number;
  arcsDone: number;
  caught: number;
  wrong: number;
}

export type RunOver = null | "win" | "lose" | "fall";

export type VowStatus = "sworn" | "called" | "kept" | "broken" | "erased";
export interface VowState { id: string; due: number; status: VowStatus }
export interface Mark { faction: Faction; vow: string }
export interface Advice { ruling: "yes" | "no"; lie: boolean }
export interface Cur {
  truth: boolean;
  tell: string | null;
  advice: Advice | null;
}

export type Ending = "usurped" | "collapse" | "weak" | "just" | "marked" | "hollow" | "long";

export interface GameState {
  v: 2;
  mode: Mode;
  seed: string;
  challenge: string | null;
  day: number;
  slot: number;
  p: number;
  h: number;
  g: number;
  pending: Pending[];
  nextPid: number;
  queue: string[];
  bag: string[];
  seen: Record<string, number>;
  arcs: Record<string, ArcState>;
  omen: string | null;
  omenDays: Record<number, string>;
  rng: { queue: number; wheel: number; fx: number; omen: number; dec: number; vow: number };
  wheel: Wheel | null;
  /** True while the day-end summary is being shown. */
  dayEnded: boolean;
  over: RunOver;
  cause: StatKey | null;
  stats: RunStats;
  vows: VowState[];
  marks: Mark[];
  usurp: number;
  expose: number;
  /** Deal the Deceiver is offering at dawn, awaiting an answer. */
  dealOffer: string | null;
  dealsTaken: number;
  activeDeals: Array<{ id: string; until: number }>;
  debts: Array<{ due: number }>;
  /** 0 = real run; 1..3 = scripted tutorial day (never counts toward the 25). */
  tut: number;
  /** Probability the Deceiver lies when the true ruling would hurt him. */
  lieRate: number;
  /** Deceiver returns after being exposed in Endless; escalates his deals. */
  cycle: number;
  cur: Cur;
  ending: Ending | null;
  /** Intent-lock was used: excluded from the daily board. */
  assisted: boolean;
  /** Assist slows the wheel and widens segments; never changes scoring. */
  assist: boolean;
}

export type Ev =
  | { t: "ruling"; kind: SegKind; hazard?: string }
  | { t: "delta"; src: "now" | "hazard" | "delayed" | "omen" | "tax" | "drag" | "fix" | "growth" | "wrong" | "deal"; fx: Fx; icon?: string }
  | { t: "later"; due: number; icon: string; hidden: boolean }
  | { t: "delayed.resolve"; icon: string; fx: Fx }
  | { t: "omen"; id: string }
  | { t: "wrong"; stat: StatKey; amount: number }
  | { t: "expose"; n: number; delta: number }
  | { t: "vow"; id: string; result: "called" | "kept" | "broken" | "erased" }
  | { t: "deal"; id: string; accepted: boolean }
  | { t: "ending"; id: Ending }
  | { t: "day.end"; day: number }
  | { t: "reign.win" }
  | { t: "reign.lose"; cause: StatKey | "weak" };

export interface Ruling {
  kind: SegKind;
  /** The request resolved (for arc bookkeeping/UI). */
  requestId: string;
  events: Ev[];
}
