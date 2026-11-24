/**
 * Headless balance bots. They drive the same pure engine the game uses, with stop timing modelled
 * as an accuracy roll (hit the middle of the intended segment, else stop at a uniformly random
 * point) because a headless bot has no reflexes to measure.
 *
 * - yes / no: always the same ruling, refuse every deal.
 * - random: coin-flip rulings and deals, ignores tells and advice.
 * - skilled: weighs stats, reads tells (the tell-reading skill), reads the Deceiver's advice pattern,
 *   swears the cheapest vows, takes few deals.
 */
import { DeterministicRng } from "@slu/web-shell";
import { answerDeal, createRun, currentRequest, finalScore, nextDay, rule, segOf } from "../game/engine";
import type { Content, Fx, GameState, Outcome, SegKind, StatKey, Tuning } from "../game/types";

export type BotKind = "yes" | "no" | "random" | "skilled";

const STATS: StatKey[] = ["p", "h", "g"];

function value(s: GameState, o: Outcome): number {
  let v = 0;
  const w: Record<StatKey, number> = { p: 1, h: 1, g: 1 };
  for (const k of STATS) w[k] = 1 + 1.6 * Math.max(0, (50 - s[k]) / 50);
  const add = (fx: Fx, f: number) => {
    for (const k of STATS) {
      const d = fx[k] ?? 0;
      v += w[k] * d * f;
      if (f === 1 && s[k] + d < 14) v -= (14 - (s[k] + d)) * 4;
    }
  };
  add(o.now, 1);
  for (const l of o.later) add(l.fx, 0.8);
  return v;
}

const EXPOSE_BONUS = 9;
const MARK_COST = 8;

function chooseKind(bot: BotKind, s: GameState, c: Content, t: Tuning, rng: DeterministicRng): "yes" | "no" {
  if (bot === "yes") return "yes";
  if (bot === "no") return "no";
  if (bot === "random") return rng.chance(0.5) ? "yes" : "no";
  const req = currentRequest(s, c);
  let vy = value(s, req.yes), vn = value(s, req.no);
  const cur = s.cur;
  if (req.vow) {
    const keep = c.vows.get(req.vow)!.keep;
    if (keep === "yes") vn -= MARK_COST; else vy -= MARK_COST;
  } else if (!req.forced) {
    const wp = 1 + 1.6 * Math.max(0, (50 - s[req.faction === "army" ? "p" : req.faction === "treasury" ? "g" : "h"]) / 50);
    const penalty = t.wrongPenalty! * wp;
    if (cur.tell) {
      // Tell-reading: the tell proves the truth flag.
      const truth = c.tells.get(cur.tell)!.signal === "truth";
      const correct = truth ? "yes" : "no";
      if (correct === "yes") vn -= penalty; else vy -= penalty;
      // Ruling against a proven lie exposes him: that is the correct side.
      if (cur.advice?.lie) { if (correct === "yes") vy += EXPOSE_BONUS; else vn += EXPOSE_BONUS; }
    } else if (cur.advice) {
      // No tell: half the time the prior says "honest". He lies on factions he is hurt by, so discount his advice there.
      const hurtFaction = c.deceiver.hurts[req.faction];
      const suspicious = hurtFaction === (cur.advice.ruling === "yes" ? "no" : "yes");
      const trust = suspicious ? 0.35 : 0.7;
      if (cur.advice.ruling === "yes") { vn -= penalty * trust * 0.5; vy -= penalty * (1 - trust) * 0.5; }
      else { vy -= penalty * trust * 0.5; vn -= penalty * (1 - trust) * 0.5; }
    }
  } else if (req.forced) {
    // Paying the debt is cheaper than defaulting.
    vy += 2;
  }
  return vy >= vn ? "yes" : "no";
}

function chooseDeal(bot: BotKind, s: GameState, c: Content, rng: DeterministicRng): boolean {
  if (bot === "yes" || bot === "no") return false;
  if (bot === "random") return rng.chance(0.5);
  const deal = c.deals.get(s.dealOffer!)!;
  const cost = deal.usurp + s.cycle * 0.5;
  if (s.usurp + cost > 5 || s.dealsTaken >= 2) return false;
  if (deal.id === "clean") {
    const soon = s.vows.find((v) => (v.status === "sworn" || v.status === "called") && v.due <= s.day + 3);
    if (!soon) return false;
    const def = c.vows.get(soon.id)!;
    const req = c.requests.get(def.request)!;
    const keepOutcome = def.keep === "yes" ? req.yes : req.no;
    return -value(s, keepOutcome) > 14;
  }
  if (deal.id === "ledger") return s.g < 40;
  return s.dealsTaken === 0 && s.h < 55;
}

function stopFraction(s: GameState, target: "yes" | "no", acc: number, rng: DeterministicRng): number {
  const w = s.wheel!;
  if (rng.chance(acc)) {
    const seg = segOf(w, target as SegKind);
    return seg.start + seg.size * (0.2 + 0.6 * rng.next());
  }
  return rng.next();
}

/** Vows the bot swears on night zero. Skilled picks the cheapest to keep; others pick at random. */
function chooseVows(bot: BotKind, c: Content, rng: DeterministicRng): string[] {
  const ids = [...c.vowOrder];
  if (bot !== "skilled") return rng.shuffle(ids).slice(0, 3);
  const cost = (id: string) => {
    const def = c.vows.get(id)!;
    const req = c.requests.get(def.request)!;
    const o = def.keep === "yes" ? req.yes : req.no;
    return -((o.now.p ?? 0) + (o.now.h ?? 0) + (o.now.g ?? 0));
  };
  return ids.sort((a, b) => cost(a) - cost(b)).slice(0, 3);
}

export interface RunSummary {
  win: boolean;
  days: number;
  score: number;
  cause: string | null;
  hazards: number;
  over: string | null;
  ending: string | null;
  caught: number;
  marks: number;
  deals: number;
}

export function playRun(content: Content, t: Tuning, bot: BotKind, seed: string, mode: "reign" | "endless" = "reign"): RunSummary {
  const rng = new DeterministicRng(Number.parseInt(seed.replace(/\D/g, "") || "1", 10) ^ 0x9e3779b9);
  const s = createRun(content, t, { mode, seed, vows: chooseVows(bot, content, rng) });
  const acc = t.botAccuracy!;
  let guard = 0;
  while (!s.over && guard++ < 8000) {
    if (s.dealOffer) { answerDeal(s, content, t, chooseDeal(bot, s, content, rng)); continue; }
    if (s.dayEnded) { nextDay(s, content, t); if (s.over) break; continue; }
    const target = chooseKind(bot, s, content, t, rng);
    rule(s, content, t, stopFraction(s, target, acc, rng));
    if (mode === "endless" && s.day > 80) break;
  }
  return {
    win: s.over === "win", days: s.over && s.dayEnded ? s.day : s.day - 1, score: finalScore(s, t), cause: s.cause,
    hazards: s.stats.hazards, over: s.over, ending: s.ending, caught: s.stats.caught, marks: s.marks.length, deals: s.dealsTaken
  };
}
