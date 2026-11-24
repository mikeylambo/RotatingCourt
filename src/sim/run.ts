import { loadContent, validateContent } from "../game/content";
import { playRun, type BotKind } from "./bots";
import tuningJson from "../../tuning/court.json";

const content = loadContent();
const issues = validateContent(content);
if (issues.length) { console.error("content issues:\n" + issues.join("\n")); process.exit(2); }

const args = process.argv.slice(2);
const flag = (n: string, d: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1]! : d; };
const runs = Number(flag("runs", "5000"));
const json = args.includes("--json");
const overrides = JSON.parse(flag("set", "{}")) as Record<string, number>;
const tuning = { ...(tuningJson.values as Record<string, number>), ...overrides };

const rows: Record<string, unknown>[] = [];
for (const bot of ["yes", "no", "random", "skilled"] as BotKind[]) {
  let wins = 0, days = 0, score = 0;
  const causes: Record<string, number> = {};
  for (let i = 0; i < runs; i++) {
    const r = playRun(content, tuning, bot, `S${i + 1}`);
    if (r.win) wins++;
    days += r.days; score += r.score;
    const k = r.over === "win" ? "win" : r.over === "fall" ? "weak" : r.cause ?? "?";
    causes[k] = (causes[k] ?? 0) + 1;
  }
  rows.push({ bot, runs, winRate: +(100 * wins / runs).toFixed(2), avgDays: +(days / runs).toFixed(1), avgScore: Math.round(score / runs), ends: causes });
}
if (json) console.log(JSON.stringify(rows));
else for (const r of rows) console.log(`${String(r.bot).padEnd(8)} win ${String(r.winRate).padStart(6)}%  days ${String(r.avgDays).padStart(5)}  score ${String(r.avgScore).padStart(5)}  ends ${JSON.stringify(r.ends)}`);
