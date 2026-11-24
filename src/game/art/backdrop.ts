/** Procedural court atmosphere: backdrop, parchment panels, grain and vignette. Canvas only, no assets. */

type Ctx = CanvasRenderingContext2D;

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

let grainTile: HTMLCanvasElement | null = null;

/** A tileable noise tile used to give parchment and stone their grain. */
export function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const img = g.createImageData(128, 128);
  const r = lcg(7);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (r() - 0.5) * 70;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

export function drawGrain(ctx: Ctx, x: number, y: number, w: number, h: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(grain(), "repeat")!;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Roughened rounded panel path (ink-edge). Deterministic per seed so it does not shimmer. */
function roughPath(ctx: Ctx, x: number, y: number, w: number, h: number, jitter: number, seed: number): void {
  const r = lcg(seed);
  const step = 22;
  ctx.beginPath();
  const pts: [number, number][] = [];
  for (let px = 0; px <= w; px += step) pts.push([x + px, y + (r() - 0.5) * jitter]);
  for (let py = 0; py <= h; py += step) pts.push([x + w + (r() - 0.5) * jitter, y + py]);
  for (let px = w; px >= 0; px -= step) pts.push([x + px, y + h + (r() - 0.5) * jitter]);
  for (let py = h; py >= 0; py -= step) pts.push([x + (r() - 0.5) * jitter, y + py]);
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
}

export interface PanelStyle {
  fill?: string;
  edge?: string;
  seed?: number;
  alpha?: number;
  lw?: number;
}

/** Inked parchment panel. */
export function drawPanel(ctx: Ctx, x: number, y: number, w: number, h: number, s: PanelStyle = {}): void {
  ctx.save();
  ctx.globalAlpha *= s.alpha ?? 1;
  roughPath(ctx, x, y, w, h, 4, s.seed ?? 3);
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = s.fill ?? "#e8d7b0";
  ctx.fill();
  ctx.shadowColor = "transparent";
  // stain
  const g = ctx.createRadialGradient(x + w * 0.5, y + h * 0.4, 10, x + w * 0.5, y + h * 0.5, Math.max(w, h) * 0.7);
  g.addColorStop(0, "rgba(255,244,214,0.35)");
  g.addColorStop(1, "rgba(120,80,30,0.28)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  ctx.clip();
  drawGrain(ctx, x - 4, y - 4, w + 8, h + 8, 0.18);
  ctx.restore();
  ctx.lineWidth = s.lw ?? 3;
  ctx.strokeStyle = s.edge ?? "#2a1d14";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

export function drawVignette(ctx: Ctx, w: number, h: number): void {
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(8,4,12,0.62)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

const backdropCache = new Map<string, HTMLCanvasElement>();

interface Look { top: string; mid: string; bot: string; floorA: string; floorB: string; arch: string; col: string; glow: string; glowA: number; }
const LOOKS: Look[] = [
  { top: "#85766a", mid: "#9a8a78", bot: "#6a5c52", floorA: "#6f6155", floorB: "#3c322d", arch: "rgba(30,20,12,0.28)", col: "#b8a88c", glow: "255,196,110", glowA: 0.42 },
  { top: "#6d6866", mid: "#7d7774", bot: "#58534f", floorA: "#58524e", floorB: "#2f2b29", arch: "rgba(20,16,14,0.34)", col: "#8f8982", glow: "235,190,130", glowA: 0.26 },
  { top: "#403e40", mid: "#4a484b", bot: "#302e31", floorA: "#3b393b", floorB: "#1b1a1c", arch: "rgba(8,6,10,0.5)", col: "#605d60", glow: "210,170,120", glowA: 0.12 },
  { top: "#141216", mid: "#1c191f", bot: "#0b090d", floorA: "#1a171c", floorB: "#08060a", arch: "rgba(0,0,0,0.6)", col: "#2c2830", glow: "127,212,224", glowA: 0.16 }
];

/** Throne-room wall, floor, banners and torch glow. `stage` is the court's rot (0 sworn .. 3 usurped); it only ever changes the frame. */
export function drawCourtBackdrop(ctx: Ctx, w: number, h: number, stage = 0): void {
  const key = `${Math.round(w)}x${Math.round(h)}:${stage}`;
  let c = backdropCache.get(key);
  if (!c) {
    if (backdropCache.size > 8) backdropCache.clear();
    c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    paintCourt(c.getContext("2d")!, w, h, stage, LOOKS[stage]!);
    backdropCache.set(key, c);
  }
  ctx.drawImage(c, 0, 0);
}

function paintCourt(g: Ctx, w: number, h: number, stage: number, L: Look): void {
  const wall = g.createLinearGradient(0, 0, 0, h);
  wall.addColorStop(0, L.top); wall.addColorStop(0.55, L.mid); wall.addColorStop(1, L.bot);
  g.fillStyle = wall; g.fillRect(0, 0, w, h);
  const floorY = h * 0.66;
  const aw = Math.max(180, Math.min(260, w / 2));
  g.lineWidth = 6;
  const rnd = lcg(31 + stage);
  for (let x = -aw / 2; x < w + aw; x += aw) {
    g.fillStyle = L.arch;
    g.beginPath(); g.moveTo(x + 20, floorY); g.lineTo(x + 20, h * 0.28); g.arc(x + aw / 2, h * 0.28, aw / 2 - 20, Math.PI, 0); g.lineTo(x + aw - 20, floorY); g.closePath(); g.fill();
    g.strokeStyle = "rgba(0,0,0,0.45)"; g.stroke();
    g.fillStyle = L.col; g.fillRect(x - 8, 0, 16, floorY);
    // banners: full and ivory/gold at 0, shorter and frayed at 1, torn strips at 2, blade-black at 3
    const bw = 44, bx = x + aw / 2 - bw / 2;
    const bh = [h * 0.26, h * 0.2, h * 0.11, h * 0.24][stage]!;
    const by = h * 0.06;
    g.fillStyle = ["#d9d0b8", "#a8a090", "#5a5658", "#0b090d"][stage]!;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + bw, by); g.lineTo(bx + bw, by + bh);
    if (stage === 0) { g.lineTo(bx + bw / 2, by + bh - 18); g.lineTo(bx, by + bh); }
    else { for (let i = 0; i < 4; i++) { g.lineTo(bx + bw - (i + 1) * (bw / 4), by + bh - 6 - rnd() * (stage === 1 ? 14 : 30)); } g.lineTo(bx, by + bh); }
    g.closePath(); g.fill(); g.lineWidth = 3; g.strokeStyle = "rgba(0,0,0,0.5)"; g.stroke();
    // emblem: gold crown bar early, blade motif late
    if (stage === 3) { g.fillStyle = "#7a1620"; g.beginPath(); g.moveTo(bx + bw / 2, by + 10); g.lineTo(bx + bw / 2 + 9, by + bh * 0.55); g.lineTo(bx + bw / 2, by + bh * 0.9); g.lineTo(bx + bw / 2 - 9, by + bh * 0.55); g.closePath(); g.fill(); }
    else if (stage < 2) { g.fillStyle = stage === 0 ? "#c9a032" : "#8a7a55"; g.fillRect(bx + 8, by + 14, bw - 16, 8); }
    // hollowed: empty weapon racks and cracks
    if (stage >= 2) {
      g.strokeStyle = "rgba(0,0,0,0.55)"; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x + aw * 0.12, h * 0.46); g.lineTo(x + aw * 0.12, h * 0.56); g.moveTo(x + aw * 0.06, h * 0.5); g.lineTo(x + aw * 0.18, h * 0.5); g.stroke();
      g.beginPath(); g.moveTo(x + aw * 0.7, h * 0.12); for (let i = 0; i < 5; i++) g.lineTo(x + aw * (0.7 + (rnd() - 0.5) * 0.12), h * (0.12 + i * 0.1)); g.stroke();
    }
  }
  const fl = g.createLinearGradient(0, floorY, 0, h);
  fl.addColorStop(0, L.floorA); fl.addColorStop(1, L.floorB);
  g.fillStyle = fl; g.fillRect(0, floorY, w, h - floorY);
  g.strokeStyle = "rgba(0,0,0,0.35)"; g.lineWidth = 2;
  for (let i = 0; i < 9; i++) { const y = floorY + Math.pow(i / 8, 1.7) * (h - floorY); g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  for (let i = -8; i <= 8; i++) { g.beginPath(); g.moveTo(w / 2 + i * 26, floorY); g.lineTo(w / 2 + i * 120, h); g.stroke(); }
  // usurped: the throne wrapped in blades, far back on the floor line
  if (stage === 3) {
    g.fillStyle = "#050407"; g.beginPath(); g.moveTo(w / 2 - 60, floorY); g.lineTo(w / 2 - 44, floorY - 150); g.lineTo(w / 2 + 44, floorY - 150); g.lineTo(w / 2 + 60, floorY); g.closePath(); g.fill();
    g.fillStyle = "#7a1620";
    for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(w / 2 + i * 16, floorY - 150); g.lineTo(w / 2 + i * 16 + 6, floorY - 60); g.lineTo(w / 2 + i * 16, floorY - 4); g.lineTo(w / 2 + i * 16 - 6, floorY - 60); g.closePath(); g.fill(); }
  }
  for (const tx of [w * 0.1, w * 0.9]) {
    const gl = g.createRadialGradient(tx, h * 0.3, 4, tx, h * 0.3, 190);
    gl.addColorStop(0, `rgba(${L.glow},${L.glowA})`); gl.addColorStop(1, `rgba(${L.glow},0)`);
    g.fillStyle = gl; g.fillRect(tx - 200, h * 0.3 - 200, 400, 400);
  }
  // long shadows once hollowed
  if (stage >= 2) {
    const sh = g.createLinearGradient(0, 0, w, 0);
    sh.addColorStop(0, "rgba(0,0,0,0.55)"); sh.addColorStop(0.5, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
  }
  g.globalCompositeOperation = "overlay"; g.globalAlpha = 0.22;
  g.fillStyle = g.createPattern(grain(), "repeat")!; g.fillRect(0, 0, w, h);
}
