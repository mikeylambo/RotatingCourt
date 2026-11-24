/**
 * Shape-grammar portraits. A petitioner is head + hat + body + prop (+ skin/cloth palette), drawn
 * in a 512x512 box with a heavy ink edge. 24 archetypes stay silhouette-distinct because the
 * content validator requires every pair to differ in at least two parts.
 */
import type { Look } from "../types";

export const SKIN = ["#f0cfa6", "#dcab7c", "#b98258", "#8f5d3c", "#c8d4a4", "#d4d8dc"];
export const CLOTH = ["#8a3333", "#33557f", "#33704f", "#7a5733", "#654085", "#b0862f", "#404049", "#8d8d7c"];
const INK = "#2a1d14";

type Ctx = CanvasRenderingContext2D;

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((n & 255) * f)));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function ink(c: Ctx, fill: string | null, lw = 9): void {
  if (fill) { c.fillStyle = fill; c.fill(); }
  c.lineWidth = lw; c.strokeStyle = INK; c.lineJoin = "round"; c.lineCap = "round"; c.stroke();
}

function poly(c: Ctx, pts: number[], fill: string | null, lw = 9): void {
  c.beginPath(); c.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  c.closePath(); ink(c, fill, lw);
}

function ell(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string | null, lw = 9): void {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ink(c, fill, lw);
}

function rrect(c: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string | null, lw = 9): void {
  c.beginPath(); c.roundRect(x, y, w, h, r); ink(c, fill, lw);
}

/* ------------------------------------------------------------------ bodies */
function body(c: Ctx, kind: number, cloth: string): void {
  const dark = shade(cloth, 0.72), light = shade(cloth, 1.25);
  switch (kind) {
    case 0: // robe
      poly(c, [180, 268, 332, 268, 400, 512, 112, 512], cloth);
      poly(c, [256, 268, 300, 268, 340, 512, 280, 512], dark, 0);
      c.beginPath(); c.moveTo(150, 400); c.lineTo(362, 400); ink(c, null, 8);
      break;
    case 1: // tunic
      poly(c, [190, 270, 322, 270, 345, 512, 167, 512], cloth);
      rrect(c, 176, 380, 160, 22, 6, dark, 7);
      break;
    case 2: // armor
      poly(c, [180, 272, 332, 272, 350, 512, 162, 512], "#9aa1ab");
      ell(c, 160, 290, 38, 30, "#b8bfc8"); ell(c, 352, 290, 38, 30, "#b8bfc8");
      poly(c, [214, 300, 298, 300, 292, 400, 220, 400], "#c3cad2", 6);
      ell(c, 240, 330, 5, 5, INK, 0); ell(c, 272, 330, 5, 5, INK, 0);
      break;
    case 3: // cloak
      poly(c, [256, 262, 400, 512, 112, 512], cloth);
      poly(c, [256, 262, 316, 512, 196, 512], dark, 0);
      poly(c, [196, 270, 256, 330, 316, 270, 290, 262, 222, 262], light, 7);
      break;
    case 4: // apron
      poly(c, [190, 270, 322, 270, 345, 512, 167, 512], cloth);
      poly(c, [214, 312, 298, 312, 306, 512, 206, 512], "#ece3cf", 7);
      c.beginPath(); c.moveTo(214, 312); c.lineTo(198, 276); c.moveTo(298, 312); c.lineTo(314, 276); ink(c, null, 6);
      break;
    case 5: // rags
      poly(c, [190, 270, 322, 270, 345, 480, 322, 512, 300, 482, 276, 512, 252, 484, 228, 512, 204, 482, 180, 512, 167, 480], cloth);
      poly(c, [226, 340, 262, 340, 262, 376, 226, 376], shade(cloth, 1.45), 5);
      break;
    default: // coat
      poly(c, [182, 270, 330, 270, 356, 512, 156, 512], cloth);
      poly(c, [256, 270, 224, 270, 200, 420, 256, 512], dark, 6);
      poly(c, [256, 270, 288, 270, 312, 420, 256, 512], dark, 6);
      for (let i = 0; i < 3; i++) ell(c, 256, 340 + i * 40, 6, 6, "#e0c060", 4);
  }
}

/* ------------------------------------------------------------------- heads */
function head(c: Ctx, kind: number, skin: string, cx = 256, cy = 190): void {
  switch (kind) {
    case 0: ell(c, cx, cy, 62, 62, skin); break;
    case 1: rrect(c, cx - 62, cy - 58, 124, 124, 26, skin); break;
    case 2: ell(c, cx, cy + 4, 50, 78, skin); break;
    case 3:
      c.beginPath(); c.moveTo(cx - 40, cy - 58);
      c.quadraticCurveTo(cx, cy - 78, cx + 40, cy - 58);
      c.quadraticCurveTo(cx + 74, cy + 30, cx + 40, cy + 66);
      c.quadraticCurveTo(cx, cy + 82, cx - 40, cy + 66);
      c.quadraticCurveTo(cx - 74, cy + 30, cx - 40, cy - 58); c.closePath(); ink(c, skin); break;
    case 4: ell(c, cx, cy + 6, 82, 58, skin); break;
    default:
      ell(c, cx, cy - 4, 64, 64, "#e9e4d6");
      poly(c, [cx - 34, cy + 40, cx + 34, cy + 40, cx + 26, cy + 76, cx - 26, cy + 76], "#e9e4d6", 8);
  }
  // face
  c.fillStyle = INK;
  if (kind === 5) {
    ell(c, cx - 24, cy - 6, 14, 17, INK, 0); ell(c, cx + 24, cy - 6, 14, 17, INK, 0);
    poly(c, [cx - 6, cy + 18, cx + 6, cy + 18, cx, cy + 30], INK, 0);
  } else {
    ell(c, cx - 24, cy - 4, 7, 8, INK, 0); ell(c, cx + 24, cy - 4, 7, 8, INK, 0);
    c.beginPath(); c.moveTo(cx - 20, cy + 32); c.quadraticCurveTo(cx, cy + 40, cx + 20, cy + 32);
    c.lineWidth = 6; c.strokeStyle = INK; c.lineCap = "round"; c.stroke();
    c.beginPath(); c.moveTo(cx - 36, cy - 22); c.lineTo(cx - 12, cy - 18); c.moveTo(cx + 36, cy - 22); c.lineTo(cx + 12, cy - 18);
    c.lineWidth = 5; c.stroke();
  }
}

/* ------------------------------------------------------------------- hats */
function hat(c: Ctx, kind: number, cloth: string, hx = 256, hy = 190): void {
  const hue = shade(cloth, 0.9);
  switch (kind) {
    case 0: // hair
      c.beginPath(); c.arc(hx, hy - 10, 62, Math.PI, 0); c.lineTo(hx + 62, hy - 20); c.quadraticCurveTo(hx, hy - 54, hx - 62, hy - 20); c.closePath(); ink(c, "#4a3322", 7); break;
    case 1: // crown
      poly(c, [hx - 52, hy - 54, hx - 58, hy - 112, hx - 28, hy - 82, hx, hy - 120, hx + 28, hy - 82, hx + 58, hy - 112, hx + 52, hy - 54], "#e0b040");
      ell(c, hx, hy - 76, 7, 7, "#b53a3a", 4); break;
    case 2: // witch
      poly(c, [hx - 96, hy - 52, hx + 96, hy - 52, hx + 60, hy - 68, hx + 22, hy - 190, hx + 4, hy - 150, hx - 22, hy - 128, hx - 60, hy - 68], "#3a2a52");
      c.beginPath(); c.moveTo(hx - 56, hy - 66); c.lineTo(hx + 56, hy - 66); ink(c, null, 12); break;
    case 3: // top hat
      rrect(c, hx - 98, hy - 66, 196, 20, 8, "#26262c"); rrect(c, hx - 54, hy - 160, 108, 100, 8, "#33333a");
      rrect(c, hx - 54, hy - 96, 108, 18, 4, "#b53a3a", 5); break;
    case 4: // hood
      c.beginPath(); c.moveTo(hx - 84, hy + 70); c.quadraticCurveTo(hx - 98, hy - 80, hx, hy - 98);
      c.quadraticCurveTo(hx + 98, hy - 80, hx + 84, hy + 70); c.lineTo(hx + 60, hy + 60);
      c.quadraticCurveTo(hx + 66, hy - 50, hx, hy - 62); c.quadraticCurveTo(hx - 66, hy - 50, hx - 60, hy + 60); c.closePath(); ink(c, hue); break;
    case 5: // helmet
      c.beginPath(); c.arc(hx, hy - 12, 70, Math.PI, 0); c.lineTo(hx + 70, hy + 8); c.lineTo(hx - 70, hy + 8); c.closePath(); ink(c, "#aab1bb");
      rrect(c, hx - 8, hy - 20, 16, 56, 5, "#8a919b", 6); poly(c, [hx - 8, hy - 82, hx + 8, hy - 82, hx + 8, hy - 118, hx - 8, hy - 118], "#b53a3a", 6); break;
    case 6: // straw
      ell(c, hx, hy - 48, 118, 26, "#d8b868"); c.beginPath(); c.ellipse(hx, hy - 60, 56, 44, 0, Math.PI, 0); ink(c, "#e6c878");
      rrect(c, hx - 56, hy - 66, 112, 12, 4, "#8a3333", 5); break;
    case 7: // jester
      poly(c, [hx - 60, hy - 50, hx - 126, hy - 118, hx - 90, hy - 128, hx - 20, hy - 74], "#b53a3a");
      poly(c, [hx + 60, hy - 50, hx + 126, hy - 118, hx + 90, hy - 128, hx + 20, hy - 74], "#33557f");
      poly(c, [hx - 62, hy - 48, hx + 62, hy - 48, hx + 20, hy - 76, hx - 20, hy - 76], "#e0b040");
      ell(c, hx - 128, hy - 124, 12, 12, "#e0b040", 5); ell(c, hx + 128, hy - 124, 12, 12, "#e0b040", 5); break;
    case 8: // mitre
      poly(c, [hx - 56, hy - 52, hx - 38, hy - 172, hx, hy - 128, hx + 38, hy - 172, hx + 56, hy - 52], "#ece3cf");
      poly(c, [hx - 8, hy - 150, hx + 8, hy - 150, hx + 8, hy - 70, hx - 8, hy - 70], "#e0b040", 5); break;
    case 9: // turban
      ell(c, hx, hy - 54, 74, 50, "#d9d2bd"); c.beginPath(); c.moveTo(hx - 66, hy - 52); c.quadraticCurveTo(hx, hy - 20, hx + 66, hy - 56);
      c.moveTo(hx - 50, hy - 86); c.quadraticCurveTo(hx, hy - 52, hx + 56, hy - 84); ink(c, null, 6);
      ell(c, hx, hy - 54, 9, 9, "#b53a3a", 4); break;
    case 10: // feather cap
      c.beginPath(); c.ellipse(hx, hy - 56, 74, 34, 0, Math.PI, 0); c.lineTo(hx + 90, hy - 44); c.lineTo(hx - 90, hy - 44); c.closePath(); ink(c, hue);
      c.beginPath(); c.moveTo(hx + 40, hy - 74); c.quadraticCurveTo(hx + 110, hy - 150, hx + 130, hy - 96); c.quadraticCurveTo(hx + 90, hy - 106, hx + 40, hy - 74); ink(c, "#e8e0c8", 6); break;
    case 11: // bandana
      rrect(c, hx - 66, hy - 64, 132, 26, 8, "#b53a3a"); poly(c, [hx + 60, hy - 52, hx + 96, hy - 36, hx + 86, hy - 8, hx + 62, hy - 36], "#b53a3a", 7); break;
    case 12: // beak hood
      c.beginPath(); c.arc(hx, hy - 10, 74, Math.PI, 0); c.lineTo(hx + 74, hy + 10); c.lineTo(hx - 74, hy + 10); c.closePath(); ink(c, "#3a3a44");
      poly(c, [hx - 22, hy + 6, hx + 22, hy + 6, hx, hy + 96], "#a08a5a"); ell(c, hx - 26, hy - 6, 11, 11, "#e8e0c8", 5); ell(c, hx + 26, hy - 6, 11, 11, "#e8e0c8", 5); break;
    default: // wolf ears
      poly(c, [hx - 64, hy - 28, hx - 76, hy - 118, hx - 22, hy - 62], "#6b6358"); poly(c, [hx + 64, hy - 28, hx + 76, hy - 118, hx + 22, hy - 62], "#6b6358");
      c.beginPath(); c.arc(hx, hy - 10, 62, Math.PI, 0); c.lineTo(hx + 62, hy - 28); c.lineTo(hx - 62, hy - 28); c.closePath(); ink(c, "#6b6358", 7);
  }
}

/* ------------------------------------------------------------------ props */
function prop(c: Ctx, kind: number): void {
  const px = 392, py = 400;
  switch (kind) {
    case 0: ell(c, px, py + 30, 46, 50, "#b69a6a"); poly(c, [px - 16, py - 12, px + 16, py - 12, px + 8, py - 30, px - 8, py - 30], "#8a7248", 6); break;
    case 1: rrect(c, px - 7, py - 140, 14, 250, 6, "#7a5733"); ell(c, px, py - 148, 20, 20, "#b39ddb", 6); break;
    case 2: poly(c, [px - 9, py + 60, px - 9, py - 120, px, py - 140, px + 9, py - 120, px + 9, py + 60], "#d4dae0"); rrect(c, px - 34, py + 56, 68, 14, 5, "#7a5733"); rrect(c, px - 7, py + 66, 14, 40, 5, "#7a5733"); break;
    case 3: rrect(c, px - 30, py - 44, 60, 116, 10, "#efe4c6"); c.beginPath(); c.moveTo(px - 16, py - 14); c.lineTo(px + 16, py - 14); c.moveTo(px - 16, py + 10); c.lineTo(px + 16, py + 10); c.moveTo(px - 16, py + 34); c.lineTo(px + 10, py + 34); ink(c, null, 5); break;
    case 4: ell(c, px, py + 24, 40, 44, "#8a5a2a"); poly(c, [px - 22, py - 14, px + 22, py - 14, px + 12, py - 28, px - 12, py - 28], "#6a4420", 6); ell(c, px, py + 26, 10, 10, "#e0b040", 4); break;
    case 5: c.beginPath(); c.ellipse(px, py + 30, 58, 28, -0.5, 0, Math.PI * 2); ink(c, "#8fb4c9"); poly(c, [px + 40, py + 8, px + 76, py - 14, px + 74, py + 38], "#7aa0b5", 6); ell(c, px - 30, py + 20, 5, 5, INK, 0); break;
    case 6: rrect(c, px - 22, py - 20, 44, 70, 8, "#e0b040"); c.beginPath(); c.arc(px, py - 22, 18, Math.PI, 0); ink(c, null, 7); ell(c, px, py + 14, 10, 14, "#fff2b0", 4); break;
    case 7: rrect(c, px - 6, py - 60, 12, 160, 5, "#7a5733"); rrect(c, px - 42, py - 90, 84, 40, 8, "#8a919b"); break;
    case 8: rrect(c, px - 42, py - 30, 84, 110, 8, "#6a3a2a"); rrect(c, px - 34, py - 22, 68, 94, 5, "#efe4c6", 5); ell(c, px, py + 24, 12, 12, "#e0b040", 4); break;
    case 9: poly(c, [px - 14, py - 40, px + 14, py - 40, px + 14, py - 8, px + 40, py + 20, px + 40, py + 70, px - 40, py + 70, px - 40, py + 20, px - 14, py - 8], "#7ec59a"); rrect(c, px - 14, py - 60, 28, 22, 5, "#7a5733", 6); break;
    case 10: rrect(c, px - 9, py - 20, 18, 130, 6, "#7a5733"); c.beginPath(); c.moveTo(px, py - 100); c.quadraticCurveTo(px + 46, py - 40, px, py - 18); c.quadraticCurveTo(px - 46, py - 40, px, py - 100); ink(c, "#f08030", 7); break;
    case 11: for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(px + i * 8, py + 80); c.lineTo(px + i * 26, py - 70); ink(c, null, 8); ell(c, px + i * 26, py - 80, 10, 22, "#e0b040", 5); } break;
    case 12: poly(c, [px - 7, py + 20, px, py - 80, px + 7, py + 20], "#d4dae0"); rrect(c, px - 22, py + 18, 44, 10, 4, "#7a5733", 6); rrect(c, px - 6, py + 26, 12, 30, 4, "#7a5733", 6); break;
    default: // lute
      ell(c, px, py + 36, 42, 50, "#b9783a"); ell(c, px, py + 36, 11, 11, INK, 0); rrect(c, px - 7, py - 110, 14, 110, 4, "#6a4420", 6); rrect(c, px - 14, py - 128, 28, 24, 5, "#6a4420", 6);
  }
}

export interface PortraitOpts {
  /** Gentle idle bob in px of the 512 box. */
  bob?: number;
  /** Extra tint amount [0,1] used by the ink-edge flash on hazards. */
  flash?: number;
}

/** Draw a petitioner centred at (x, y) in a box `size` px wide. */
export function drawPortrait(ctx: Ctx, look: Look, x: number, y: number, size: number, o: PortraitOpts = {}): void {
  const cloth = CLOTH[look.cloth % CLOTH.length]!;
  const skin = SKIN[look.skin % SKIN.length]!;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2 + (o.bob ?? 0) * size / 512);
  ctx.scale(size / 512, size / 512);
  // ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(256, 508, 170, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.rect(0, 0, 512, 512); ctx.clip();
  // hat-behind pieces (hood/ears) draw before the head, the rest after
  body(ctx, look.body, cloth);
  if (look.hat === 4 || look.hat === 13) hat(ctx, look.hat, cloth);
  head(ctx, look.head, skin);
  if (look.hat !== 4 && look.hat !== 13) hat(ctx, look.hat, cloth);
  prop(ctx, look.prop);
  ctx.restore();
}

/** The ruler: crown, beard and a fur-trimmed robe, in the same grammar. */
export function drawKing(ctx: Ctx, x: number, y: number, size: number, tint = "#8a2f3a"): void {
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 512, size / 512);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath(); ctx.ellipse(256, 508, 170, 14, 0, 0, Math.PI * 2); ctx.fill();
  body(ctx, 3, tint);
  poly(ctx, [196, 270, 256, 330, 316, 270, 296, 262, 216, 262], "#f2eee4", 7);
  head(ctx, 1, SKIN[0]!);
  poly(ctx, [196, 214, 316, 214, 296, 300, 256, 330, 216, 300], "#cfc8bb", 7);
  ell(ctx, 232, 186, 7, 8, INK, 0); ell(ctx, 280, 186, 7, 8, INK, 0);
  hat(ctx, 1, tint);
  ctx.restore();
}
