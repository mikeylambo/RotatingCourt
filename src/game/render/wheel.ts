/**
 * Wheel presentation. Rendering reads the engine's Wheel and never writes back. Hazards carry a
 * unique pattern, rim silhouette and icon each, so no category depends on colour alone (rule 9).
 */
import { drawIcon } from "../art/icons";
import { PAL } from "../ui/kit";
import { visual } from "../art/visuals";
import type { HazardDef, SegKind, Wheel, WheelSeg } from "../types";

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

export interface WheelDraw {
  cx: number;
  cy: number;
  r: number;
  /** Wheel fraction under the pointer. */
  frac: number;
  hazard: HazardDef;
  /** 0..1: how strongly the segment under the pointer is highlighted (telegraph clarity). */
  telegraph: number;
  /** Segment kind that was locked in, if any. */
  locked: SegKind | null;
  /** Seconds since lock, for the result pulse. */
  lockAge: number;
  needle: number;
  highContrast: boolean;
  time: number;
  /** Omen darkness: fades segment icons (eclipse). */
  dim?: number;
  /** Hub glyph; null leaves it bare. */
  hub?: string | null;
}

const segAngle = (s: number, frac: number) => (s - frac) * TAU - Math.PI / 2;

function wedge(ctx: Ctx, cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): void {
  ctx.beginPath();
  ctx.arc(cx, cy, r1, a0, a1);
  ctx.arc(cx, cy, r0, a1, a0, true);
  ctx.closePath();
}

function pattern(ctx: Ctx, name: string, r: number, light: string): void {
  ctx.strokeStyle = light;
  ctx.fillStyle = light;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  const span = r;
  switch (name) {
    case "checker":
      for (let x = 0; x < span; x += 22) for (let y = -span; y < span; y += 22) if (((x / 22 + y / 22) & 1) === 0) ctx.fillRect(x, y, 22, 22);
      break;
    case "rings":
      for (let x = 20; x < span; x += 36) for (let y = -span + 10; y < span; y += 36) { ctx.beginPath(); ctx.arc(x + ((y / 36) & 1 ? 18 : 0), y, 9, 0, TAU); ctx.stroke(); }
      break;
    case "teeth":
      for (let x = 14; x < span; x += 26) { ctx.beginPath(); for (let y = -span; y < span; y += 26) { ctx.moveTo(x, y); ctx.lineTo(x + 14, y + 13); ctx.lineTo(x, y + 26); } ctx.stroke(); }
      break;
    case "zigzag":
      for (let y = -span; y < span; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x < span; x += 16) ctx.lineTo(x + 8, y + ((x / 16) & 1 ? 8 : -8)); ctx.stroke(); }
      break;
    case "dots":
      for (let x = 12; x < span; x += 22) for (let y = -span; y < span; y += 22) { ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill(); }
      break;
    case "slashes":
      for (let k = -span * 2; k < span * 2; k += 22) { ctx.beginPath(); ctx.moveTo(k, -span); ctx.lineTo(k + span, span); ctx.stroke(); }
      break;
    case "spiral": {
      ctx.beginPath();
      for (let a = 0; a < 26; a += 0.2) { const rr = a * 3.4; const x = r * 0.62 + Math.cos(a) * rr, y = Math.sin(a) * rr; a === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
      ctx.stroke();
      break;
    }
    case "waves":
      for (let y = -span; y < span; y += 20) { ctx.beginPath(); for (let x = 0; x <= span; x += 6) { const yy = y + Math.sin(x / 9) * 6; x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); } ctx.stroke(); }
      break;
    case "chevrons":
      for (let x = 10; x < span; x += 20) { ctx.beginPath(); ctx.moveTo(x, -span); for (let y = -span; y < span; y += 36) { ctx.lineTo(x + 14, y + 18); ctx.lineTo(x, y + 36); } ctx.stroke(); }
      break;
    case "hatch":
      for (let k = -span * 2; k < span * 2; k += 18) { ctx.beginPath(); ctx.moveTo(k, -span); ctx.lineTo(k + span, span); ctx.moveTo(k + span, -span); ctx.lineTo(k, span); ctx.stroke(); }
      break;
    case "halves":
      ctx.globalAlpha *= 0.7;
      ctx.fillRect(0, -span, span, span);
      ctx.globalAlpha /= 0.7;
      ctx.setLineDash([8, 8]); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(span, 0); ctx.stroke(); ctx.setLineDash([]);
      break;
    default: // grid / bricks
      for (let y = -span; y < span; y += 22) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(span, y); ctx.stroke(); }
      for (let y = -span, row = 0; y < span; y += 22, row++) for (let x = (row & 1) * 22; x < span; x += 44) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 22); ctx.stroke(); }
  }
}

/** Outer-rim silhouette of a hazard: saw, scallop or notch. Distinct from the smooth YES/NO rims. */
function rimEdge(ctx: Ctx, cx: number, cy: number, r: number, a0: number, a1: number, style: string): void {
  const arc = (a1 - a0) * r;
  const n = Math.max(3, Math.round(arc / 26));
  ctx.fillStyle = "#3a2468";
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = 3;
  for (let i = 0; i < n; i++) {
    const t0 = a0 + ((a1 - a0) * i) / n, t1 = a0 + ((a1 - a0) * (i + 1)) / n, tm = (t0 + t1) / 2;
    ctx.beginPath();
    if (style === "saw") {
      ctx.moveTo(cx + Math.cos(t0) * r, cy + Math.sin(t0) * r);
      ctx.lineTo(cx + Math.cos(tm) * (r + 15), cy + Math.sin(tm) * (r + 15));
      ctx.lineTo(cx + Math.cos(t1) * r, cy + Math.sin(t1) * r);
    } else if (style === "scallop") {
      ctx.arc(cx + Math.cos(tm) * r, cy + Math.sin(tm) * r, (arc / n) * 0.5, tm - Math.PI / 2 - 0.1, tm + Math.PI / 2 + 0.1);
    } else {
      const w = 0.28 * (t1 - t0);
      ctx.moveTo(cx + Math.cos(t0 + w) * r, cy + Math.sin(t0 + w) * r);
      ctx.lineTo(cx + Math.cos(t0 + w) * (r + 13), cy + Math.sin(t0 + w) * (r + 13));
      ctx.lineTo(cx + Math.cos(t1 - w) * (r + 13), cy + Math.sin(t1 - w) * (r + 13));
      ctx.lineTo(cx + Math.cos(t1 - w) * r, cy + Math.sin(t1 - w) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function segColors(kind: SegKind): { base: string; edge: string } {
  if (kind === "yes") return { base: "#d6e4b8", edge: "#4c7a3c" };
  if (kind === "no") return { base: "#ecc9b8", edge: "#8a3a2e" };
  return { base: "#4a2f7a", edge: "#1e1232" };
}

export function drawWheel(ctx: Ctx, w: Wheel, d: WheelDraw): void {
  const { cx, cy, r } = d;
  const under = w.segs.find((s) => ((d.frac - s.start) % 1 + 1) % 1 < s.size) ?? w.segs[0]!;

  // shadow plate
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath(); ctx.ellipse(cx, cy + r + 18, r * 0.9, 16, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r + 10, 0, TAU); ctx.fillStyle = "#3a2410"; ctx.fill();
  ctx.restore();

  // hazard rim silhouette goes behind the face so the face edge stays clean
  for (const s of w.segs) if (s.kind === "hazard") rimEdge(ctx, cx, cy, r + 2, segAngle(s.start, d.frac), segAngle(s.start + s.size, d.frac), d.hazard.edge);

  for (const s of w.segs) {
    const a0 = segAngle(s.start, d.frac), a1 = segAngle(s.start + s.size, d.frac);
    const mid = (a0 + a1) / 2;
    const col = segColors(s.kind);
    ctx.save();
    wedge(ctx, cx, cy, 0, r, a0, a1);
    ctx.fillStyle = col.base;
    ctx.fill();
    ctx.clip();
    if (s.kind === "hazard") {
      ctx.translate(cx, cy);
      ctx.rotate(mid);
      pattern(ctx, d.hazard.pattern, r, "rgba(214,190,255,0.55)");
    } else {
      const g = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      g.addColorStop(0, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(60,40,10,0.22)");
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();

    ctx.save();
    wedge(ctx, cx, cy, 0, r, a0, a1);
    ctx.lineWidth = 4;
    ctx.strokeStyle = PAL.ink;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();

    // icon at the centroid, sized by the wedge so narrow segments stay legible
    const arcLen = (a1 - a0) * r * 0.66;
    const isz = Math.max(26, Math.min(64, arcLen * 0.8));
    const ix = cx + Math.cos(mid) * r * 0.64, iy = cy + Math.sin(mid) * r * 0.64;
    ctx.save();
    ctx.globalAlpha = 1 - (d.dim ?? 0);
    if (s.kind === "hazard") {
      drawIcon(ctx, d.hazard.icon, ix, iy, isz, { color: "#f0e6ff", lw: 2.4 });
    } else {
      drawIcon(ctx, s.kind === "yes" ? "check" : "x", ix, iy, isz, { color: col.edge, lw: 4 });
    }
    ctx.restore();
  }

  // telegraph: bright outline on the segment the pointer is over
  if (d.telegraph > 0.02 && !d.locked) {
    const a0 = segAngle(under.start, d.frac), a1 = segAngle(under.start + under.size, d.frac);
    ctx.save();
    wedge(ctx, cx, cy, 0, r, a0, a1);
    ctx.lineWidth = d.highContrast ? 9 : 6;
    ctx.strokeStyle = `rgba(255,248,200,${0.35 + 0.6 * d.telegraph})`;
    ctx.stroke();
    ctx.restore();
  }

  // locked result pulse
  if (d.locked) {
    const seg = w.segs.find((s) => s.kind === d.locked) as WheelSeg;
    const a0 = segAngle(seg.start, d.frac), a1 = segAngle(seg.start + seg.size, d.frac);
    const k = Math.min(1, d.lockAge / 0.5);
    ctx.save();
    wedge(ctx, cx, cy, 0, r + 4 + 8 * (1 - k), a0, a1);
    ctx.lineWidth = 8;
    ctx.strokeStyle = d.locked === "hazard" ? "#d9c2ff" : PAL.gold;
    ctx.stroke();
    ctx.restore();
  }

  visual("wheel.face")(ctx, cx, cy, r * 2, r * 2);

  // hub
  const hg = ctx.createRadialGradient(cx - 8, cy - 8, 4, cx, cy, 44);
  hg.addColorStop(0, "#fff0b8");
  hg.addColorStop(1, "#b88a2a");
  ctx.beginPath(); ctx.arc(cx, cy, 42, 0, TAU); ctx.fillStyle = hg; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = PAL.ink; ctx.stroke();
  if (d.hub !== null) drawIcon(ctx, d.hub ?? "crown", cx, cy + 1, 40, { color: PAL.ink });

  // fixed pointer
  ctx.save();
  ctx.translate(cx, cy - r - 12);
  ctx.rotate(d.needle);
  ctx.beginPath();
  ctx.moveTo(-20, -18); ctx.lineTo(20, -18); ctx.lineTo(0, 34); ctx.closePath();
  ctx.fillStyle = PAL.gold; ctx.fill();
  ctx.lineWidth = 5; ctx.strokeStyle = PAL.ink; ctx.lineJoin = "round"; ctx.stroke();
  ctx.restore();
}
