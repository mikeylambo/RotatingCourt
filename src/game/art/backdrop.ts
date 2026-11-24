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

let backdropCache: { w: number; h: number; c: HTMLCanvasElement } | null = null;

/** Throne-room wall, floor and torch glow, rendered once per canvas size. */
export function drawCourtBackdrop(ctx: Ctx, w: number, h: number): void {
  if (!backdropCache || backdropCache.w !== w || backdropCache.h !== h) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    const g = c.getContext("2d")!;
    const wall = g.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, "#2a1e36");
    wall.addColorStop(0.55, "#3a2a40");
    wall.addColorStop(1, "#22172b");
    g.fillStyle = wall;
    g.fillRect(0, 0, w, h);
    // arches
    const aw = Math.max(180, Math.min(260, w / 2));
    g.lineWidth = 6;
    for (let x = -aw / 2; x < w + aw; x += aw) {
      g.fillStyle = "rgba(10,6,16,0.35)";
      g.beginPath();
      g.moveTo(x + 20, h * 0.62);
      g.lineTo(x + 20, h * 0.28);
      g.arc(x + aw / 2, h * 0.28, aw / 2 - 20, Math.PI, 0);
      g.lineTo(x + aw - 20, h * 0.62);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.stroke();
      // column
      g.fillStyle = "#4a3a52";
      g.fillRect(x - 8, 0, 16, h * 0.66);
    }
    // floor tiles
    const floorY = h * 0.66;
    const fl = g.createLinearGradient(0, floorY, 0, h);
    fl.addColorStop(0, "#3d2d3f");
    fl.addColorStop(1, "#1a1020");
    g.fillStyle = fl;
    g.fillRect(0, floorY, w, h - floorY);
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const y = floorY + Math.pow(i / 8, 1.7) * (h - floorY);
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
    for (let i = -8; i <= 8; i++) {
      g.beginPath(); g.moveTo(w / 2 + i * 26, floorY); g.lineTo(w / 2 + i * 120, h); g.stroke();
    }
    // torch glow
    for (const tx of [w * 0.1, w * 0.9]) {
      const gl = g.createRadialGradient(tx, h * 0.3, 4, tx, h * 0.3, 190);
      gl.addColorStop(0, "rgba(255,170,70,0.38)");
      gl.addColorStop(1, "rgba(255,170,70,0)");
      g.fillStyle = gl;
      g.fillRect(tx - 200, h * 0.3 - 200, 400, 400);
    }
    // stone grain
    g.globalCompositeOperation = "overlay";
    g.globalAlpha = 0.22;
    g.fillStyle = g.createPattern(grain(), "repeat")!;
    g.fillRect(0, 0, w, h);
    backdropCache = { w, h, c };
  }
  ctx.drawImage(backdropCache.c, 0, 0);
}
