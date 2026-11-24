/**
 * Canvas UI kit: stage scaling (portrait-first 540x960 with safe areas), palette, text, and
 * focusable buttons. Items are mirrored into invisible DOM buttons so Tab, screen readers and the
 * shell FocusManager work even though everything is drawn on one canvas.
 */
import { FocusManager } from "@slu/web-shell";
import { drawIcon } from "../art/icons";
import { drawPanel } from "../art/backdrop";

export const W = 540;
export const H = 960;

export const PAL = {
  ink: "#2a1d14",
  parchment: "#e8d7b0",
  parchmentDark: "#cdb98a",
  gold: "#e0b040",
  goldDark: "#8a6a1e",
  plum: "#2a1e36",
  yes: "#7fb069",
  no: "#c8604f",
  haz: "#7a4cc2",
  pop: "#6fa8dc",
  joy: "#f0a050",
  coin: "#e0b040",
  white: "#fff8e8",
  dim: "rgba(10,6,16,0.62)"
};

export const FONT = `"Georgia","Times New Roman",serif`;

export interface Stage {
  /** CSS px per logical unit. */
  scale: number;
  ox: number;
  oy: number;
  cssW: number;
  cssH: number;
  dpr: number;
  /** Safe-area insets in logical units. */
  safeT: number;
  safeB: number;
}

export const stage: Stage = { scale: 1, ox: 0, oy: 0, cssW: W, cssH: H, dpr: 1, safeT: 0, safeB: 0 };

function readInsets(): { t: number; b: number } {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);visibility:hidden;pointer-events:none";
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  const t = parseFloat(cs.paddingTop) || 0;
  const b = parseFloat(cs.paddingBottom) || 0;
  probe.remove();
  return { t, b };
}

export function layoutStage(cssW: number, cssH: number, dpr: number): void {
  const insets = readInsets();
  stage.cssW = cssW;
  stage.cssH = cssH;
  stage.dpr = dpr;
  stage.scale = Math.min(cssW / W, cssH / H);
  stage.ox = (cssW - W * stage.scale) / 2;
  stage.oy = (cssH - H * stage.scale) / 2;
  stage.safeT = Math.max(0, (insets.t - stage.oy) / stage.scale);
  stage.safeB = Math.max(0, (insets.b - stage.oy) / stage.scale);
}

export function toLogical(clientX: number, clientY: number): { x: number; y: number } {
  return { x: (clientX - stage.ox) / stage.scale, y: (clientY - stage.oy) / stage.scale };
}

export function setFont(ctx: CanvasRenderingContext2D, size: number, weight = "bold"): void {
  ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
}

export function text(
  ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number,
  o: { color?: string; align?: CanvasTextAlign; weight?: string; stroke?: string; baseline?: CanvasTextBaseline } = {}
): void {
  setFont(ctx, size, o.weight ?? "bold");
  ctx.textAlign = o.align ?? "center";
  ctx.textBaseline = o.baseline ?? "middle";
  if (o.stroke) {
    ctx.lineWidth = Math.max(3, size / 7);
    ctx.strokeStyle = o.stroke;
    ctx.lineJoin = "round";
    ctx.strokeText(s, x, y);
  }
  ctx.fillStyle = o.color ?? PAL.ink;
  ctx.fillText(s, x, y);
}

export interface Item {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Spoken/aria name; icons carry the visible meaning. */
  aria: string;
  icon?: string;
  label?: string;
  /** Row value drawn as segment pips (0..max) or a toggle. */
  pips?: { value: number; max: number };
  toggle?: boolean;
  /** Plain value text on the right. */
  value?: string;
  disabled?: boolean;
  locked?: boolean;
  big?: boolean;
  /** Custom draw (receives focus state). Replaces default content. */
  draw?: (ctx: CanvasRenderingContext2D, item: Item, focused: boolean) => void;
  /** Left/right adjust zones (settings rows). */
  adjust?: boolean;
}

export function hit(item: Item, x: number, y: number): boolean {
  return x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h;
}

export interface DrawOpts {
  highContrast: boolean;
  time: number;
}

/** Default row / button rendering. */
export function drawItem(ctx: CanvasRenderingContext2D, it: Item, focused: boolean, o: DrawOpts): void {
  if (it.draw) { it.draw(ctx, it, focused); return; }
  ctx.save();
  ctx.globalAlpha = it.disabled ? 0.45 : 1;
  const lift = focused ? -3 : 0;
  drawPanel(ctx, it.x, it.y + lift, it.w, it.h, {
    fill: focused ? "#f6e6b8" : PAL.parchment,
    seed: it.id.length * 7 + it.x,
    edge: focused ? PAL.gold : PAL.ink,
    lw: focused ? (o.highContrast ? 8 : 5) : 3
  });
  const cy = it.y + it.h / 2 + lift;
  const isz = Math.min(44, it.h * 0.58);
  let tx = it.x + 22;
  if (it.icon) {
    drawIcon(ctx, it.icon, it.x + 22 + isz / 2, cy, isz, { color: PAL.ink, lw: 2.2 });
    tx = it.x + 22 + isz + 16;
  }
  if (it.label) text(ctx, it.label, tx, cy, it.big ? 34 : 28, { align: "left" });
  const rx = it.x + it.w - 20;
  if (it.pips) {
    const n = it.pips.max + 1;
    const pw = 22;
    for (let i = 0; i < n; i++) {
      const px = rx - (n - i) * (pw + 6) + 6;
      ctx.beginPath();
      ctx.roundRect(px, cy - 11, pw, 22, 5);
      ctx.fillStyle = i <= it.pips.value ? PAL.gold : "rgba(42,29,20,0.18)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = PAL.ink;
      ctx.stroke();
    }
    if (focused) {
      drawIcon(ctx, "back", it.x + it.w - 20 - n * (pw + 6) - 18, cy, 22, { color: PAL.goldDark });
      drawIcon(ctx, "back", rx + 12, cy, 22, { color: PAL.goldDark });
    }
  } else if (it.toggle !== undefined) {
    drawIcon(ctx, it.toggle ? "check" : "x", rx - 16, cy, 34, { color: it.toggle ? "#3f7a34" : "#8a3a2e", lw: 3 });
  } else if (it.value) {
    text(ctx, it.value, rx, cy, 28, { align: "right" });
  }
  if (it.locked) {
    ctx.fillStyle = "rgba(42,29,20,0.35)";
    ctx.beginPath();
    ctx.roundRect(it.x, it.y + lift, it.w, it.h, 6);
    ctx.fill();
    drawIcon(ctx, "padlock", it.x + it.w - 36, cy, 34, { color: PAL.ink });
  }
  ctx.restore();
}

/** Vertical stack of full-width rows. */
export function column(ids: Array<Partial<Item> & { id: string; aria: string }>, top: number, h: number, gap: number, w = 440): Item[] {
  return ids.map((d, i) => ({ x: (W - w) / 2, y: top + i * (h + gap), w, h, ...d }));
}

/* ---- DOM mirror (accessibility + FocusManager) ------------------------------------------ */

export class A11yMirror {
  private readonly host: HTMLElement;
  private readonly focus = new FocusManager();
  private buttons: HTMLButtonElement[] = [];
  private live: HTMLElement;
  onFocusId: (id: string) => void = () => undefined;

  constructor(parent: HTMLElement) {
    this.host = document.createElement("div");
    this.host.setAttribute("role", "group");
    this.host.setAttribute("aria-label", "Rotating Court");
    this.host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2";
    this.live = document.createElement("div");
    this.live.setAttribute("aria-live", "polite");
    this.live.setAttribute("role", "status");
    this.live.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden";
    this.host.appendChild(this.live);
    parent.appendChild(this.host);
  }

  announce(s: string): void {
    this.live.textContent = "";
    this.live.textContent = s;
  }

  /** Rebuild the invisible buttons for the current items. */
  sync(items: Item[], focusId: string | null): void {
    for (const b of this.buttons) b.remove();
    this.buttons = [];
    const live: HTMLButtonElement[] = [];
    for (const it of items) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.id = it.id;
      b.setAttribute("aria-label", it.aria);
      if (it.disabled || it.locked) b.setAttribute("aria-disabled", "true");
      b.style.cssText = `position:absolute;left:${stage.ox + it.x * stage.scale}px;top:${stage.oy + it.y * stage.scale}px;width:${it.w * stage.scale}px;height:${it.h * stage.scale}px;opacity:0;pointer-events:none;`;
      b.addEventListener("focus", () => this.onFocusId(it.id));
      this.host.appendChild(b);
      this.buttons.push(b);
      live.push(b);
    }
    this.focus.setItems(live);
    if (focusId) this.setFocus(focusId);
  }

  setFocus(id: string): void {
    const b = this.buttons.find((x) => x.dataset.id === id);
    if (b && document.activeElement !== b) b.focus({ preventScroll: true });
  }
}
