#!/usr/bin/env node
// Renders the PWA icons (crown over a wheel) with headless Chromium. Output is committed under public/icons.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright"); // global Playwright; set NODE_PATH if needed
import { mkdirSync, writeFileSync } from "node:fs";

const draw = `(size, pad) => {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, "#3a2a40"); bg.addColorStop(1, "#1b1220");
  g.fillStyle = bg; g.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2, r = size * (0.5 - pad) ;
  const segs = [["#d6e4b8", 0, 0.38], ["#4a2f7a", 0.38, 0.24], ["#ecc9b8", 0.62, 0.38]];
  for (const [col, a, w] of segs) { g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, r, a * Math.PI * 2 - 1.2, (a + w) * Math.PI * 2 - 1.2); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = size * 0.012; g.strokeStyle = "#2a1d14"; g.stroke(); }
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.lineWidth = size * 0.035; g.strokeStyle = "#e0b040"; g.stroke();
  g.save(); g.translate(cx - size * 0.24, cy - size * 0.2); g.scale(size * 0.02, size * 0.02);
  const p = new Path2D("M3 18L2 7l6 5 4-8 4 8 6-5-1 11z"); g.fillStyle = "#e0b040"; g.fill(p); g.lineWidth = 1; g.strokeStyle = "#2a1d14"; g.lineJoin = "round"; g.stroke(p); g.restore();
  return c.toDataURL("image/png").split(",")[1];
}`;

const browser = await chromium.launch();
const page = await browser.newPage();
mkdirSync("public/icons", { recursive: true });
for (const [name, size, pad] of [["icon-192", 192, 0.08], ["icon-512", 512, 0.08], ["icon-maskable-512", 512, 0.18]]) {
  const b64 = await page.evaluate(`(${draw})(${size}, ${pad})`);
  writeFileSync(`public/icons/${name}.png`, Buffer.from(b64, "base64"));
}
await browser.close();
console.log("icons written");
