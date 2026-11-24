/**
 * Pictogram set. Every icon is authored on a 24x24 grid as stroke ("s") and fill ("f") path pieces.
 * Icons carry the game's language (rule 8): requests, hazards, omens and stats are shapes, not words.
 */
type Piece = ["s" | "f", string];

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const S = (d: string): Piece => ["s", d];
const F = (d: string): Piece => ["f", d];

const ICONS: Record<string, Piece[]> = {
  check: [S("M5 12.5l4.5 4.5L19 7")],
  x: [S("M6 6l12 12M18 6L6 18")],
  plus: [S("M12 5v14M5 12h14")],
  play: [F("M8 5l11 7-11 7z")],
  pause: [F("M7 5h3.5v14H7zM13.5 5H17v14h-3.5z")],
  retry: [S("M19 12a7 7 0 1 1-2.2-5.1"), F("M19 3.5v5.5h-5.5z")],
  home: [S("M4 11l8-7 8 7M6 10v10h12V10M10 20v-5h4v5")],
  gear: [S(circle(12, 12, 3)), S("M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1")],
  sound: [F("M4 9h4l5-4v14l-5-4H4z"), S("M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11")],
  mute: [F("M4 9h4l5-4v14l-5-4H4z"), S("M16 9l5 6M21 9l-5 6")],
  star: [F("M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z")],
  back: [S("M15 5l-7 7 7 7")],
  calendar: [S("M5 6h14v13H5zM5 10h14M9 4v4M15 4v4")],
  infinity: [S("M7 8a4 4 0 1 0 0 8c4 0 6-8 10-8a4 4 0 1 1 0 8c-4 0-6-8-10-8")],
  tap: [S("M9 12V6.5a1.5 1.5 0 0 1 3 0V12l4.2 1c1.3.3 1.8 1.2 1.8 2.4V19H9.5l-3.2-4.2L7.8 13.6 9 15z")],
  person: [F(circle(12, 7, 3.2)), F("M5 21c0-4.4 3-7 7-7s7 2.6 7 7z")],
  smile: [S(circle(12, 12, 9)), S("M8 14c1 2 3 3 4 3s3-1 4-3"), S("M9 9.5h.1M15 9.5h.1")],
  coin: [S(circle(12, 12, 9)), S("M12 6.5v11M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4")],
  up: [F("M12 4l7 9h-4v7H9v-7H5z")],
  down: [F("M12 20l-7-9h4V4h6v7h4z")],
  question: [S("M9 9a3 3 0 1 1 4.5 2.6c-1 .6-1.5 1.2-1.5 2.4M12 17.5h.1")],
  padlock: [F("M6 11h12v9H6z"), S("M8.5 11V8a3.5 3.5 0 0 1 7 0v3")],
  medal: [S(circle(12, 15, 5)), S("M8 3l3 6M16 3l-3 6")],
  trophy: [S("M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 14v4M8 20h8")],
  feather: [S("M20 4C10 4 5 9 5 19M5 19l4-4M20 4c0 8-4 12-11 11M9 15c2-1 6-4 8-8")],
  eyeslash: [S("M3 3l18 18M2 12c3-5 7-7 10-7M22 12c-3 5-7 7-10 7")],
  /* asks */
  give: [S("M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7C10 3 6 4 7 7M12 7c2-4 6-3 5 0")],
  ban: [S(circle(12, 12, 9)), S("M5.6 5.6l12.8 12.8")],
  spare: [S("M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z")],
  grant: [S("M4 20l1-4L16 5l3 3L8 19zM14 7l3 3")],
  build: [S("M3 6h18v5H3zM3 11h9v5H3zM12 11h9v5h-9zM3 16h18v3H3z")],
  wheat: [S("M12 21V9M12 9c-3-1-4-3-4-6 3 0 4 2 4 6zM12 9c3-1 4-3 4-6-3 0-4 2-4 6zM12 14c-3-1-4-3-4-5M12 14c3-1 4-3 4-5M12 19c-3-1-4-3-4-5M12 19c3-1 4-3 4-5")],
  crown: [F("M3 18L2 7l6 5 4-8 4 8 6-5-1 11z")],
  sword: [S("M5 19L17 7M14 4h6v6M7 17l-3 3M6 14l4 4")],
  shield: [S("M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z")],
  bread: [S("M4 15c0-4 3-8 8-8s8 4 8 8v3H4zM8 11l2 3M12 10l2 3M16 11l1 3")],
  skull: [S("M12 3a8 8 0 0 0-8 8c0 3 1 5 3 6v3h10v-3c2-1 3-3 3-6a8 8 0 0 0-8-8z"), F("M8 11a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 0 0-2.8 0M13.2 11a1.4 1.4 0 1 0 2.8 0 1.4 1.4 0 0 0-2.8 0"), S("M12 14.5v2")],
  heart: [F("M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z")],
  house: [S("M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5")],
  tree: [F("M12 3c-4 0-7 3-6 6-2 1-2 4 0 5 1 2 4 2 5 1v5h2v-5c1 1 4 1 5-1 2-1 2-4 0-5 1-3-2-6-6-6z")],
  boat: [S("M3 15h18l-3 5H6zM12 15V4l6 9z")],
  fish: [S("M3 12c3-5 9-6 13-1l5-3v8l-5-3c-4 5-10 4-13-1z"), S("M7.5 11.5h.1")],
  fire: [F("M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z")],
  flame: [F("M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-10z")],
  drops: [F("M12 3c3 4 5 7 5 10a5 5 0 0 1-10 0c0-3 2-6 5-10z")],
  book: [S("M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11")],
  scroll: [S("M6 4h12v14a2 2 0 0 1-4 0H6a2 2 0 0 0 4 0M6 4a2 2 0 0 0 0 4h12M9 11h6M9 14h6")],
  cross: [F("M10 3h4v7h7v4h-7v7h-4v-7H3v-4h7z")],
  bell: [S("M6 17v-6a6 6 0 0 1 12 0v6l2 2H4zM10 21h4")],
  key: [S("M9 8a4 4 0 1 0 .1 0M12.5 11.5L20 19M17 16l2-2")],
  lock: [F("M6 11h12v9H6z"), S("M8.5 11V8a3.5 3.5 0 0 1 7 0v3")],
  hammer: [S("M14 4l6 6-3 3-6-6zM12 9L4 17l3 3 8-8")],
  bottle: [S("M10 3h4v5l3 4v8H7v-8l3-4zM7 14h10")],
  eye: [S("M2 12c3-5 7-7 10-7s7 2 10 7c-3 5-7 7-10 7S5 17 2 12z"), F(circle(12, 12, 3))],
  moon: [F("M20 14A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10z")],
  wolf: [S("M4 4l4 3h8l4-3 1 8-5 4v4H8v-4l-5-4z"), S("M9 11h.1M15 11h.1M10 15h4")],
  castle: [S("M3 20V7h3v3h3V7h6v3h3V7h3v13zM10 20v-4a2 2 0 0 1 4 0v4")],
  mask: [S("M4 6c4-2 12-2 16 0v6c0 4-4 7-8 7s-8-3-8-7z"), S("M8 11h2M14 11h2M9 15c2 1.5 4 1.5 6 0")],
  lute: [S("M10 12a5 5 0 1 0 2 2l7-7M16 5l3 3M8 15h.1")],
  chain: [S("M8 11a3 3 0 0 1 0-4l2-2a3 3 0 0 1 4 0M16 13a3 3 0 0 1 0 4l-2 2a3 3 0 0 1-4 0M10 14l4-4")],
  banner: [S("M5 3v18"), F("M5 4h14l-3 4 3 4H5z")],
  torch: [S("M10 12h4l-1 9h-2z"), F("M12 3c2 2 3 3 3 5a3 3 0 0 1-6 0c0-2 1-3 3-5z")],
  cup: [S("M6 4h12v6a6 6 0 0 1-12 0zM12 16v4M8 20h8")],
  sun: [S(circle(12, 12, 4)), S("M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2")],
  bolt: [F("M13 2L5 14h6l-1 8 8-12h-6z")],
  comet: [F(circle(17, 7, 3)), S("M14 10L3 21M12 6L5 11M18 11l-5 7")],
  eclipse: [S(circle(12, 12, 8)), F("M15 6a7 7 0 1 0 0 12 5.5 5.5 0 0 1 0-12z")],
  die: [S("M5 5h14v14H5z"), S("M8.5 8.5h.1M15.5 8.5h.1M12 12h.1M8.5 15.5h.1M15.5 15.5h.1")],
  purse: [S("M8 6c1 2 7 2 8 0M7 8c-3 4-3 12 5 12s8-8 5-12"), S("M12 11v5M10.5 12.5h3")],
  fang: [F("M4 5h16c0 5-2 8-4 9l-2 6-2-6c-2-1-4-4-4-9z")],
  dagger: [S("M12 2l3 10-3 3-3-3z"), S("M8 15h8M12 15v7")],
  wave: [S("M2 9c3-3 5 3 8 0s5 3 8 0 3 0 4 0M2 15c3-3 5 3 8 0s5 3 8 0 3 0 4 0")],
  fist: [F("M7 11V7a1.5 1.5 0 0 1 3 0 1.5 1.5 0 0 1 3 0 1.5 1.5 0 0 1 3 0v4h2v5a5 5 0 0 1-5 5H9a4 4 0 0 1-4-4v-3z")],
  bowl: [S("M3 11h18a9 7 0 0 1-18 0zM8 21h8")],
  split: [S("M12 3l-2 5 4 4-4 4 2 5M4 6h5M15 18h5")],
  scales: [S("M12 4v16M6 20h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z")],
  tent: [S("M3 20L12 4l9 16zM12 20v-6")],
  sack: [F("M9 4h6l-1 3c4 2 5 6 5 9 0 3-2 5-7 5s-7-2-7-5c0-3 1-7 5-9z")]
};

const cache = new Map<string, Array<{ kind: "s" | "f"; path: Path2D }>>();

export function hasIcon(id: string): boolean {
  return id in ICONS;
}

export function iconIds(): string[] {
  return Object.keys(ICONS);
}

export interface IconStyle {
  color?: string;
  /** Secondary tint for filled areas inside outline icons. */
  fill?: string;
  lw?: number;
  alpha?: number;
}

/** Draw icon `id` centred at (cx, cy) with edge length `size`. */
export function drawIcon(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, size: number, style: IconStyle = {}): void {
  let parts = cache.get(id);
  if (!parts) {
    const src = ICONS[id] ?? ICONS.question!;
    parts = src.map(([kind, d]) => ({ kind, path: new Path2D(d) }));
    cache.set(id, parts);
  }
  const color = style.color ?? "#2a1d14";
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = style.lw ?? 2;
  ctx.globalAlpha *= style.alpha ?? 1;
  for (const p of parts) {
    if (p.kind === "f") {
      ctx.fillStyle = color;
      ctx.fill(p.path);
    } else {
      if (style.fill) { ctx.fillStyle = style.fill; ctx.fill(p.path); }
      ctx.strokeStyle = color;
      ctx.stroke(p.path);
    }
  }
  ctx.restore();
}
