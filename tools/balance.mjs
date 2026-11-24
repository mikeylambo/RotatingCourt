#!/usr/bin/env node
// Bundle the headless simulator with esbuild (ships with vite) and run it.
// Usage: npm run balance -- --runs 5000 [--set '{"effectScale":1.1}'] [--json]
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";

mkdirSync(".sim", { recursive: true });
await build({ entryPoints: ["src/sim/run.ts"], bundle: true, platform: "node", format: "esm", outfile: ".sim/run.mjs", logLevel: "error" });
const r = spawnSync(process.execPath, [".sim/run.mjs", ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
