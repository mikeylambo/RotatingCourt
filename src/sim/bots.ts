/**
 * Headless balance bots. They drive the same pure engine the game uses, with stop timing modelled
 * as an accuracy roll (hit the middle of the intended segment, else stop at a uniformly random
 * point) because a headless bot has no reflexes to measure.
 */
import { DeterministicRng } from "@slu/web-shell";
import { createRun, currentRequest, finalScore, nextDay, rule, segOf } from "../game/engine";
import type { Content, Fx, GameState, Outcome, SegKind, StatKey, Tuning } from "../game/types";

export type BotKind = "yes" | "no" | "random" | "skilled";

function value(s: GameState, o: Outcome): number {
  let v = 0;
  const w: Record<StatKey, number> = { p: 1, h: 1, g: 1 };
  for (const k of ["p", "h", "g"] as StatKey[]) w[k] = 1 + 1.6 * Math.max(0, (50 - s[k]) / 50);
  const add = (fx: Fx, f: number) => {
    for (const k of ["p", "h", "g"] as StatKey[]) {
      const d = fx[k] ?? 0;
      v += w[k] * d * f;
      // Heavy penalty for dipping into the danger zone.
      if (f === 1 && s[k] + d < 14) v -= (14 - (s[k] + d)) * 4;
    }
  };
  add(o.now, 1);
  for (const l of o.later) add(l.fx, 0.8);
  return v;
}

function chooseKind(bot: BotKind, s: GameState, c: Content, rng: DeterministicRng): "yes" | "no" {
  if (bot === "yes") return "yes";
  if (bot === "no") return "no";
  if (bot === "random") return rng.chance(0.5) ? "yes" : "no";
  const req = currentRequest(s, c);
  return value(s, req.yes) >= value(s, req.no) ? "yes" : "no";
}

function stopFraction(s: GameState, target: "yes" | "no", acc: number, rng: DeterministicRng): number {
  const w = s.wheel!;
  if (rng.chance(acc)) {
    const seg = segOf(w, target as SegKind);
    return seg.start + seg.size * (0.2 + 0.6 * rng.next());
  }
  return rng.next();
}

export interface RunSummary {
  win: boolean;
  days: number;
  score: number;
  cause: string | null;
  hazards: number;
  over: string | null;
}

export function playRun(content: Content, t: Tuning, bot: BotKind, seed: string, mode: "reign" | "endless" = "reign"): RunSummary {
  const s = createRun(content, t, { mode, seed });
  const rng = new DeterministicRng(Number.parseInt(seed.replace(/\D/g, "") || "1", 10) ^ 0x9e3779b9);
  const acc = t.botAccuracy!;
  let guard = 0;
  while (!s.over && guard++ < 5000) {
    if (s.dayEnded) { nextDay(s, content, t); if (s.over) break; continue; }
    const target = chooseKind(bot, s, content, rng);
    const frac = stopFraction(s, target, acc, rng);
    rule(s, content, t, frac);
    if (mode === "endless" && s.day > 80) break;
  }
  return { win: s.over === "win", days: s.over && s.dayEnded ? s.day : s.day - 1, score: finalScore(s, t), cause: s.cause, hazards: s.stats.hazards, over: s.over };
}
