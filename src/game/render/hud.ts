/** HUD pieces: stat gauges, calendar strip, queue pips, popups. Icons and numerals only. */
import { drawIcon } from "../art/icons";
import { drawPanel } from "../art/backdrop";
import { PAL, W, text } from "../ui/kit";
import type { Fx, GameState, StatKey, Tuning } from "../types";

type Ctx = CanvasRenderingContext2D;

export const STAT_ICON: Record<StatKey, string> = { p: "person", h: "smile", g: "coin" };
export const STAT_COLOR: Record<StatKey, string> = { p: PAL.pop, h: PAL.joy, g: PAL.coin };

export interface Popup {
  stat: StatKey;
  amount: number;
  age: number;
  /** Stagger so simultaneous deltas do not overlap. */
  slot: number;
}

export interface GaugeView {
  /** Displayed (eased) values, 0..statMax. */
  shown: Record<StatKey, number>;
  /** Pulse 0..1 per stat after a change. */
  pulse: Record<StatKey, number>;
}

const GX = [24, 24 + 164, 24 + 328];

export function gaugeCenterX(stat: StatKey): number {
  return GX[stat === "p" ? 0 : stat === "h" ? 1 : 2]! + 76;
}

export function drawGauges(ctx: Ctx, y: number, s: GameState, t: Tuning, v: GaugeView, time: number, hc: boolean): void {
  (["p", "h", "g"] as StatKey[]).forEach((k, i) => {
    const x = GX[i]!;
    const val = Math.max(0, Math.min(t.statMax!, v.shown[k]));
    const frac = val / t.statMax!;
    const low = s[k] < 20;
    const pulse = v.pulse[k];
    drawPanel(ctx, x, y, 152, 64, { fill: low ? "#ecc9b8" : PAL.parchment, seed: 11 + i, lw: hc ? 5 : 3 });
    const iconSize = 34 + pulse * 8;
    drawIcon(ctx, STAT_ICON[k], x + 28, y + 32, iconSize, { color: PAL.ink, lw: 2.2 });
    // bar
    const bx = x + 54, bw = 86, by = y + 38;
    ctx.fillStyle = "rgba(42,29,20,0.22)";
    ctx.beginPath(); ctx.roundRect(bx, by, bw, 14, 5); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.roundRect(bx, by, bw, 14, 5); ctx.clip();
    ctx.fillStyle = STAT_COLOR[k];
    ctx.fillRect(bx, by, bw * frac, 14);
    // pattern stripes so the fill reads without colour
    ctx.strokeStyle = "rgba(42,29,20,0.28)";
    ctx.lineWidth = 2;
    for (let sx = bx - 14; sx < bx + bw * frac; sx += 9) { ctx.beginPath(); ctx.moveTo(sx, by + 14); ctx.lineTo(sx + 14, by); ctx.stroke(); }
    ctx.restore();
    ctx.lineWidth = 2.5; ctx.strokeStyle = PAL.ink;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, 14, 5); ctx.stroke();
    // win threshold flag
    const tx = bx + bw * (t.winMin! / t.statMax!);
    ctx.beginPath(); ctx.moveTo(tx, by - 5); ctx.lineTo(tx, by + 19); ctx.lineWidth = 3; ctx.strokeStyle = PAL.ink; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(tx, by - 5); ctx.lineTo(tx + 7, by - 1); ctx.lineTo(tx, by + 3); ctx.fillStyle = PAL.ink; ctx.fill();
    text(ctx, String(Math.round(val)), bx + bw / 2, y + 20, 22, { color: PAL.ink });
    if (low) drawIcon(ctx, "alert", x + 140, y + 12, 18 + Math.sin(time * 8) * 2, { color: "#8a2f1e", lw: 2.5 });
  });
}

export function drawPopups(ctx: Ctx, y: number, popups: Popup[]): void {
  for (const p of popups) {
    if (p.age < 0) continue;
    const k = p.age / 1.1;
    if (k >= 1) continue;
    const x = gaugeCenterX(p.stat);
    const yy = y - 6 - k * 34;
    ctx.save();
    ctx.globalAlpha = k < 0.15 ? k / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
    const up = p.amount > 0;
    const label = `${Math.abs(Math.round(p.amount * 10) / 10)}`;
    ctx.beginPath(); ctx.roundRect(x - 38, yy - 14, 76, 28, 12);
    ctx.fillStyle = up ? "rgba(224,242,200,0.96)" : "rgba(246,208,196,0.96)";
    ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = PAL.ink; ctx.stroke();
    drawIcon(ctx, up ? "up" : "down", x - 20, yy, 18, { color: up ? "#2f6a28" : "#8a2f1e" });
    text(ctx, label, x + 8, yy + 1, 22, { color: PAL.ink });
    ctx.restore();
  }
}

function net(fx: Fx): number {
  return (fx.p ?? 0) + (fx.h ?? 0) + (fx.g ?? 0);
}

/** Calendar strip: pending effects for the next four days, hidden ones as a question mark. */
export function drawCalendar(ctx: Ctx, y: number, s: GameState, landed: number): void {
  const slotW = 118, gap = 8, x0 = (W - (slotW * 4 + gap * 3)) / 2;
  for (let d = 1; d <= 4; d++) {
    const x = x0 + (d - 1) * (slotW + gap);
    const list = s.pending.filter((p) => p.due === s.day + d);
    drawPanel(ctx, x, y, slotW, 58, { fill: "#d8c79c", seed: 31 + d, lw: 2.5, alpha: 0.95 });
    text(ctx, String(s.day + d), x + 14, y + 14, 15, { color: "#6a5a3a", align: "center" });
    const n = Math.min(3, list.length);
    for (let i = 0; i < n; i++) {
      const p = list[i]!;
      const cx = x + 30 + i * 30 + (3 - n) * 12, cy = y + 33;
      if (p.hidden) {
        drawIcon(ctx, "question", cx, cy, 26, { color: PAL.ink, lw: 2.6 });
      } else {
        drawIcon(ctx, p.icon, cx, cy - 2, 26, { color: PAL.ink, lw: 2 });
        const sign = net(p.fx);
        drawIcon(ctx, sign >= 0 ? "up" : "down", cx + 11, cy + 12, 13, { color: sign >= 0 ? "#2f6a28" : "#8a2f1e" });
      }
    }
    if (list.length === 0) {
      ctx.fillStyle = "rgba(42,29,20,0.18)";
      ctx.beginPath(); ctx.arc(x + slotW / 2, y + 33, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (d === 1 && landed > 0) {
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(x - 2, y - 2, slotW + 4, 62, 8); ctx.stroke();
    }
  }
}

export function drawQueue(ctx: Ctx, y: number, slot: number, perDay: number): void {
  const gap = 34, x0 = W / 2 - ((perDay - 1) * gap) / 2;
  for (let i = 0; i < perDay; i++) {
    const x = x0 + i * gap;
    ctx.beginPath(); ctx.arc(x, y, i === slot ? 11 : 8, 0, Math.PI * 2);
    ctx.fillStyle = i < slot ? PAL.gold : i === slot ? PAL.parchment : "rgba(42,29,20,0.25)";
    ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = PAL.ink; ctx.stroke();
    if (i < slot) drawIcon(ctx, "check", x, y, 11, { color: PAL.ink, lw: 3.4 });
  }
}
