/**
 * Visual registry. Gameplay and screens ask for semantic keys (`petitioner.<id>`, `ruler.king`,
 * `court.backdrop`, `wheel.face`); this module decides whether a sprite or the procedural factory
 * answers. Swap contract: drop `<key>.png` into public/art/ and the sprite wins, no code changes.
 * Missing files simply keep the procedural art.
 */
import { createVisualRegistry } from "@slu/web-shell";
import spriteFiles from "virtual:art-sprites";
import { drawCourtBackdrop } from "./backdrop";
import { drawKing, drawPortrait } from "./portrait";
import type { Content } from "../types";

/** Draw into the box centred at (x, y), `w` wide and `h` tall. */
export type Draw = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, o?: { bob?: number }) => void;

export const visuals = createVisualRegistry<Draw, { key: string }>();
const resolved = new Map<string, Draw>();

function spriteDraw(img: HTMLImageElement, cover: boolean): Draw {
  return (ctx, x, y, w, h) => {
    if (cover) {
      const s = Math.max(w / img.width, h / img.height);
      ctx.drawImage(img, x - (img.width * s) / 2, y - (img.height * s) / 2, img.width * s, img.height * s);
    } else {
      ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
    }
  };
}

function drawWheelFace(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  const r = w / 2;
  ctx.save();
  ctx.translate(x, y);
  // rim
  ctx.lineWidth = 14;
  ctx.strokeStyle = "#5a3a1e";
  ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#e0b040";
  ctx.beginPath(); ctx.arc(0, 0, r + 4, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = "#2a1d14";
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(0, 0, r - 2, 0, Math.PI * 2); ctx.stroke();
  // pegs
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    ctx.fillStyle = "#e0b040";
    ctx.strokeStyle = "#2a1d14";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(Math.cos(a) * (r + 4), Math.sin(a) * (r + 4), 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

/** Register every procedural factory, then upgrade any key that has a sprite on disk. */
export function registerVisuals(content: Content): Promise<void> {
  for (const a of content.archetypes.values()) {
    visuals.replace(`petitioner.${a.id}`, {
      source: "procedural", tier: "hero",
      factory: () => (ctx, x, y, w, _h, o) => drawPortrait(ctx, a.look, x, y, w, o)
    });
  }
  visuals.replace("ruler.king", { source: "procedural", tier: "hero", factory: () => (ctx, x, y, w) => drawKing(ctx, x, y, w) });
  visuals.replace("court.backdrop", { source: "procedural", tier: "background", factory: () => (ctx, _x, _y, w, h) => drawCourtBackdrop(ctx, w, h) });
  visuals.replace("wheel.face", { source: "procedural", tier: "standard", factory: () => (ctx, x, y, w) => drawWheelFace(ctx, x, y, w) });
  resolved.clear();

  const jobs = spriteFiles.map((file) => new Promise<void>((done) => {
    const key = file.replace(/\.png$/i, "").toLowerCase();
    const img = new Image();
    img.onload = () => {
      visuals.replace(key, { source: "sprite", tier: "hero", factory: () => spriteDraw(img, key === "court.backdrop") });
      resolved.delete(key);
      done();
    };
    img.onerror = () => done();
    img.src = `${import.meta.env.BASE_URL}art/${file}`;
  }));
  return Promise.all(jobs).then(() => undefined);
}

/** The draw function for a semantic key. Unknown keys draw nothing. */
export function visual(key: string): Draw {
  let d = resolved.get(key);
  if (!d) {
    d = visuals.create(key, { key })?.visual ?? (() => undefined);
    resolved.set(key, d);
  }
  return d;
}

/** Which source answers a key: lets tests prove the swap contract. */
export function visualSource(key: string): string | null {
  return visuals.get(key)?.source ?? null;
}
