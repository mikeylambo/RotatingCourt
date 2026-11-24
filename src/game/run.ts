/**
 * Run controller: drives the pure engine from player input and owns every presentation timer
 * (wheel clock, easing, hitstop, shake, popups). It reads engine state to draw and never feeds
 * presentation back into it (rule 6).
 */
import { drawIcon } from "./art/icons";
import { drawPanel } from "./art/backdrop";
import { visual } from "./art/visuals";
import { answerDeal, courtStage, currentRequest, nextDay, pointerAt, rule, segAt } from "./engine";
import { drawCalendar, drawGauges, drawPopups, drawQueue, STAT_ICON, type GaugeView, type Popup } from "./render/hud";
import { drawWheel } from "./render/wheel";
import { emit } from "./audio/synth";
import { H, PAL, W, stage, text, type Item } from "./ui/kit";
import { FACTION_ICON } from "./types";
import type { Content, Cur, Ev, GameState, RequestDef, SegKind, StatKey, Tuning, Wheel } from "./types";

type Ctx = CanvasRenderingContext2D;

export interface RunHost {
  content: Content;
  reducedMotion(): boolean;
  shake(): number;
  highContrast(): boolean;
  intentLock(): boolean;
  firstRun(): boolean;
  announce(s: string): void;
  haptic(id: "light" | "heavy"): void;
  persist(s: GameState): void;
  /** Called once when the reign ends (win, lose or fall). */
  onOver(s: GameState, firedEvents: Ev[]): void;
  /** Called for each semantic gameplay event (achievements, stats). */
  onEvents(events: Ev[], s: GameState): void;
}

type Phase = "deal" | "spin" | "lock" | "dayend" | "over";

const ARM = 0.18; // seconds a wheel must have run before a stop counts, so a leftover tap cannot fire it
const ENTER = 0.38;
const LOCK_HOLD = 0.95;
const EXIT = 0.3;

interface DayLine {
  src: string;
  icon: string;
  fx: Partial<Record<StatKey, number>>;
}

export class Run {
  phase: Phase = "spin";
  paused = false;
  private clock = 0;
  private spinStart = 0;
  private hold = 0;
  private enterT = 0;
  private lockT = 0;
  private lockKind: SegKind | null = null;
  private lockFrac = 0;
  private needle = 0;
  private lastSegKind: SegKind | null = null;
  private lastTick = -1;
  private hitstop = 0;
  private shakeAmp = 0;
  private flash = 0;
  private popups: Popup[] = [];
  private view: GaugeView;
  private dayLines: DayLine[] = [];
  private omenBanner = 0;
  private landed = 0;
  private time = 0;
  private overEvents: Ev[] = [];
  private overFired = false;
  private dayEndT = 0;
  hintShown = false;
  /** The petition on screen. The engine advances on rule(); the screen holds this one until the lock animation ends. */
  private shownWheel!: Wheel;
  private shownReq!: RequestDef;
  private shownSlot = 0;
  private shownCur!: Cur;
  private shownLine = 0;
  private exposeFlash = 0;
  private vowFlash = 0;

  constructor(readonly host: RunHost, readonly state: GameState, readonly t: Tuning) {
    this.view = {
      shown: { p: state.p, h: state.h, g: state.g },
      pulse: { p: 0, h: 0, g: 0 }
    };
    if (state.dayEnded && !state.over) {
      // Resumed on the day-end summary: roll straight into the next day.
      this.consume(nextDay(state, host.content, t), false);
    }
    this.beginPetition();
  }

  /* ----------------------------------------------------------------- input */

  /** Stop the wheel. `stamp` is the device event time (performance.now clock). */
  pressStop(stamp: number): boolean {
    if (this.paused) return false;
    if (this.phase === "dayend") {
      if (this.dayEndT < 0.35) return false;
      this.leaveDayEnd();
      return true;
    }
    if (this.phase === "lock") {
      if (this.lockT > 0.3) { this.finishLock(); return true; }
      return false;
    }
    if (this.phase !== "spin" || this.hold > 0 || this.host.intentLock()) return false;
    const age = Math.min(0.12, Math.max(0, (performance.now() - stamp) / 1000));
    const wheel = this.shownWheel;
    const tt = this.clock - age - this.spinStart;
    if (tt < ARM) return false;
    this.lock(pointerAt(wheel, tt), undefined);
    return true;
  }

  /** Accessibility intent: choose Yes or No without timing. Flags the run as assisted. */
  pressIntent(kind: "yes" | "no"): boolean {
    if (this.paused || this.phase !== "spin" || this.hold > 0 || !this.host.intentLock()) return false;
    const wheel = this.shownWheel;
    const seg = wheel.segs.find((s) => s.kind === kind)!;
    this.lock(seg.start + seg.size / 2, kind);
    return true;
  }

  /* ------------------------------------------------------------------ flow */

  private beginPetition(): void {
    const s = this.state;
    this.phase = "spin";
    this.enterT = 0;
    this.lockKind = null;
    this.lockT = 0;
    this.lastSegKind = null;
    this.spinStart = this.clock;
    this.hold = this.omenBanner > 0 ? 1.1 : 0;
    const req = currentRequest(s, this.host.content);
    this.shownReq = req;
    this.shownWheel = s.wheel!;
    this.shownSlot = s.slot;
    this.shownCur = structuredClone(s.cur);
    this.shownLine = (s.day * 7 + s.slot * 3) % 4;
    if (s.slot === 0) emit("deceiver.motif", courtStage(s, this.t));
    if (s.dealOffer) this.phase = "deal";
    const advice = this.shownCur.advice ? `advice ${this.shownCur.advice.ruling}` : "";
    this.host.announce(`${req.line ?? ""} ${req.ask.join(" ")} ${this.shownCur.tell ?? ""} ${advice}`.trim());
  }

  /** Answer the Deceiver's dawn deal (accept or refuse), then the petition proceeds with the wheel his deal shaped. */
  answerDeal(accept: boolean): boolean {
    if (this.paused || this.phase !== "deal") return false;
    const s = this.state;
    const ev = answerDeal(s, this.host.content, this.t, accept);
    if (accept) emit("deal.accept");
    else emit("ui.confirm");
    this.consume(ev, false);
    this.host.persist(s);
    if (s.over) { this.toOver(); return true; }
    this.shownWheel = s.wheel!;
    this.shownCur = structuredClone(s.cur);
    this.shownReq = currentRequest(s, this.host.content);
    this.phase = "spin";
    this.spinStart = this.clock;
    this.hold = 0.35;
    this.enterT = 0;
    return true;
  }

  courtStage(): 0 | 1 | 2 | 3 {
    return courtStage(this.state, this.t);
  }

  private lock(frac: number, intent?: "yes" | "no"): void {
    const s = this.state;
    const ruling = rule(s, this.host.content, this.t, frac, intent);
    this.lockKind = ruling.kind;
    this.lockFrac = frac;
    this.lockT = 0;
    this.phase = "lock";
    this.needle = 0.5;
    emit("wheel.lock");
    emit(ruling.kind === "yes" ? "ruling.yes" : ruling.kind === "no" ? "ruling.no" : "hazard.hit");
    if (ruling.kind === "hazard") {
      this.host.haptic("heavy");
      if (!this.host.reducedMotion()) {
        this.hitstop = 0.09;
        this.shakeAmp = 16 * this.host.shake();
      }
      this.flash = this.host.reducedMotion() ? 0 : 1;
    } else {
      this.host.haptic("light");
      this.shakeAmp = this.host.reducedMotion() ? 0 : 3 * this.host.shake();
    }
    this.consume(ruling.events, true);
    this.host.announce(ruling.kind === "hazard" ? `hazard ${this.shownWheel.hazard}` : ruling.kind);
    if (!s.over) this.host.persist(s);
  }

  private consume(events: Ev[], collectDay: boolean): void {
    let slot = 0;
    for (const e of events) {
      if (e.t === "delta") {
        for (const k of ["p", "h", "g"] as StatKey[]) {
          const a = e.fx[k];
          if (a) { this.popups.push({ stat: k, amount: a, age: -0.04 * slot++, slot }); this.view.pulse[k] = 1; }
        }
        if (collectDay && ["omen", "tax", "drag", "fix", "growth"].includes(e.src)) {
          this.dayLines.push({ src: e.src, icon: e.icon ?? tickIcon(e.src), fx: e.fx });
        }
      } else if (e.t === "delayed.resolve") {
        emit("delayed.resolve");
        this.landed = 1.2;
      } else if (e.t === "later") {
        this.landed = Math.max(this.landed, 0.01);
      } else if (e.t === "omen") {
        this.omenBanner = 1.4;
      } else if (e.t === "day.end") {
        emit("day.end");
      } else if (e.t === "expose") {
        if (e.delta > 0) { emit("expose.up"); this.exposeFlash = 1.2; }
      } else if (e.t === "vow") {
        if (e.result === "kept") { emit("vow.kept"); this.vowFlash = 1.2; }
        else if (e.result === "broken") { emit("vow.broken"); this.vowFlash = 1.2; }
      } else if (e.t === "reign.win") {
        emit("reign.win");
      } else if (e.t === "reign.lose") {
        emit("reign.lose");
      }
    }
    this.host.onEvents(events, this.state);
    if (this.state.over) this.overEvents.push(...events);
  }

  private finishLock(): void {
    const s = this.state;
    if (s.over && !s.dayEnded) { this.toOver(); return; }
    if (s.dayEnded) {
      this.phase = s.over ? "over" : "dayend";
      this.dayEndT = 0;
      if (s.over) this.toOver();
      return;
    }
    this.beginPetition();
  }

  private leaveDayEnd(): void {
    const s = this.state;
    this.dayLines = [];
    const ev = nextDay(s, this.host.content, this.t);
    this.consume(ev, false);
    this.host.persist(s);
    if (s.over) { this.toOver(); return; }
    this.beginPetition();
  }

  private toOver(): void {
    this.phase = "over";
    if (!this.overFired) {
      this.overFired = true;
      this.host.onOver(this.state, this.overEvents);
    }
  }

  /* ---------------------------------------------------------------- update */

  update(dtReal: number): void {
    if (this.paused) return;
    this.time += dtReal;
    if (this.hitstop > 0) { this.hitstop -= dtReal; return; }
    const dt = dtReal;
    this.clock += dt;
    this.enterT += dt;
    if (this.hold > 0) { this.hold -= dt; this.spinStart = this.clock; }
    this.flash = Math.max(0, this.flash - dt * 2.4);
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 40);
    this.needle *= Math.pow(0.001, dt);
    if (this.omenBanner > 0) this.omenBanner -= dt;
    if (this.landed > 0) this.landed -= dt;
    if (this.exposeFlash > 0) this.exposeFlash -= dt;
    if (this.vowFlash > 0) this.vowFlash -= dt;
    for (const k of ["p", "h", "g"] as StatKey[]) {
      const target = this.state[k];
      const cur = this.view.shown[k];
      this.view.shown[k] = Math.abs(target - cur) < 0.05 ? target : cur + (target - cur) * Math.min(1, dt * 7);
      this.view.pulse[k] = Math.max(0, this.view.pulse[k] - dt * 3);
    }
    for (const p of this.popups) p.age += dt;
    this.popups = this.popups.filter((p) => p.age < 1.1);

    if (this.phase === "lock") {
      this.lockT += dt;
      if (this.lockT > LOCK_HOLD + EXIT) this.finishLock();
    } else if (this.phase === "dayend") {
      this.dayEndT += dt;
    } else if (this.phase === "spin" && this.hold <= 0) {
      const wheel = this.shownWheel;
      const f = pointerAt(wheel, this.clock - this.spinStart);
      const kind = segAt(wheel, f).kind;
      if (this.lastSegKind !== null && kind !== this.lastSegKind && this.clock - this.lastTick > 0.05) {
        emit("wheel.tick");
        this.lastTick = this.clock;
      }
      this.lastSegKind = kind;
    }
  }

  /* ----------------------------------------------------------------- items */

  layoutTop(): number {
    return Math.max(14, stage.safeT + 10);
  }

  wheelGeom(): { cx: number; cy: number; r: number } {
    const r = 142 + Math.min(28, Math.max(0, H - 960) * 0.14);
    return { cx: W / 2, cy: H - 60 - stage.safeB - r, r };
  }

  /** Pointer-hit regions that are not "stop": pause button and intent buttons. */
  items(): Item[] {
    const T = this.layoutTop();
    const list: Item[] = [{ id: "pause", x: 18, y: T, w: 56, h: 56, aria: "pause", icon: "pause" }];
    if (this.phase === "deal") {
      list.push({ id: "no", x: 280, y: 700, w: 200, h: 130, aria: "refuse the deal", icon: "x" });
      list.push({ id: "yes", x: 60, y: 700, w: 200, h: 130, aria: "accept the deal", icon: "check" });
    }
    if (this.host.intentLock() && this.phase === "spin") {
      const g = this.wheelGeom();
      list.push({ id: "yes", x: 14, y: g.cy + g.r - 96, w: 96, h: 96, aria: "yes", icon: "check" });
      list.push({ id: "no", x: W - 110, y: g.cy + g.r - 96, w: 96, h: 96, aria: "no", icon: "x" });
    }
    return list;
  }

  /* ------------------------------------------------------------------ draw */

  draw(ctx: Ctx, time: number, mode: string, focusId: string | null): void {
    const s = this.state, c = this.host.content, t = this.t;
    const T = this.layoutTop();
    const hc = this.host.highContrast();
    const req = this.shownReq;
    const arch = c.archetypes.get(req.archetype)!;

    ctx.save();
    if (this.shakeAmp > 0.2 && !this.host.reducedMotion()) {
      ctx.translate((Math.random() - 0.5) * this.shakeAmp, (Math.random() - 0.5) * this.shakeAmp);
    }

    // top row: pause, day (or tutorial day), omen
    drawItemButton(ctx, this.items()[0]!, focusId === "pause", hc);
    if (s.tut) {
      drawIcon(ctx, "book", 118, T + 28, 34, { color: PAL.white, lw: 2.4 });
      text(ctx, `${s.tut}/3`, 178, T + 29, 34, { color: PAL.white, stroke: PAL.ink, align: "left" });
    } else {
      drawIcon(ctx, mode === "endless" ? "infinity" : "calendar", 118, T + 28, 34, { color: PAL.white, lw: 2.4 });
      text(ctx, mode === "endless" ? String(s.day) : `${s.day}/${t.days}`, 168 + (mode === "endless" ? 0 : 10), T + 29, 34, { color: PAL.white, stroke: PAL.ink, align: "left" });
    }
    if (s.omen) {
      const om = c.omens.get(s.omen)!;
      drawPanel(ctx, W - 96, T - 2, 78, 60, { fill: "#d8c4f0", seed: 5, lw: 3 });
      drawIcon(ctx, om.icon, W - 57, T + 28, 38, { color: PAL.ink, lw: 2.4 });
    }

    drawGauges(ctx, T + 62, s, t, this.view, time, hc);
    drawCalendar(ctx, T + 134, s, this.landed);

    // the Deceiver's strip: his advice, exposure pips and the court's marks
    const sy = T + 198, stg = courtStage(s, t);
    this.drawAdviceStrip(ctx, sy, stg, time, hc);

    // petitioner panel, spot-lit like a stage
    const extra = Math.max(0, H - 960);
    const py = sy + 74, ph = 290 + extra * 0.5;
    drawPanel(ctx, 20, py, W - 40, ph, { seed: 21, lw: hc ? 5 : 3.5 });
    drawQueue(ctx, py + 22, this.phase === "lock" || this.phase === "dayend" || this.phase === "over" ? this.shownSlot + 1 : this.shownSlot, s.queue.length);

    const enterK = Math.min(1, this.enterT / ENTER);
    const ease = 1 - Math.pow(1 - enterK, 3);
    const exitK = this.phase === "lock" ? Math.max(0, (this.lockT - LOCK_HOLD) / EXIT) : 0;
    const slide = (1 - ease) * 140 - exitK * 140;
    const alpha = Math.min(ease, 1 - exitK);
    ctx.save();
    ctx.globalAlpha = alpha;
    const bob = this.host.reducedMotion() ? 0 : Math.sin(time * 2.2) * 5;
    const portraitKey = req.forced ? "deceiver.advisor" : `petitioner.${arch.id}`;
    visual(portraitKey)(ctx, 140 + slide, py + 150, 206, 206, { bob, stage: stg });
    // ask pictogram bubble
    const bx = 262 + slide * 0.6, by = py + 56, bw = 236, bh = 130 + extra * 0.1;
    drawPanel(ctx, bx, by, bw, bh, { fill: "#f6ecd0", seed: 41, lw: 3 });
    const n = req.ask.length;
    const iconSize = n === 1 ? 84 : n === 2 ? 68 : 52;
    req.ask.forEach((id, i) => {
      const ix = bx + bw / 2 + (i - (n - 1) / 2) * (iconSize + 10);
      drawIcon(ctx, id, ix, by + bh / 2, iconSize, { color: PAL.ink, lw: 2.2 });
    });
    if (req.vow) {
      const def = c.vows.get(req.vow)!;
      drawPanel(ctx, bx, by + bh + 8, bw, 44, { fill: "#e6d2a0", seed: 43, lw: 3 });
      drawIcon(ctx, FACTION_ICON[def.faction], bx + 28, by + bh + 30, 28, { color: PAL.ink });
      drawIcon(ctx, "oath", bx + 66, by + bh + 30, 28, { color: PAL.goldDark });
      def.icons.forEach((id, i) => drawIcon(ctx, id, bx + 118 + i * 38, by + bh + 30, 28, { color: PAL.ink }));
    }
    if (req.line) text(ctx, req.line, 20 + (W - 40) / 2 + slide * 0.3, py + ph - 26, 26, { color: PAL.ink, weight: "bold" });
    // the tell: one visible hint about the petitioner
    const tell = this.shownCur.tell;
    if (tell) {
      const pulse = s.tut === 2 ? (Math.sin(time * 5) + 1) / 2 : 0;
      ctx.beginPath(); ctx.arc(226 + slide, py + 62, 30 + pulse * 5, 0, Math.PI * 2);
      ctx.fillStyle = "#f6ecd0"; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = pulse > 0 ? PAL.gold : PAL.ink; ctx.stroke();
      drawIcon(ctx, tell, 226 + slide, py + 62, 38, { color: PAL.ink, lw: 2.4 });
    }
    ctx.restore();

    // stage lighting: the court darkens behind the speaker, the wheel stays high-contrast
    const spot = ctx.createRadialGradient(W / 2, py + ph / 2, 120, W / 2, py + ph / 2, 420);
    spot.addColorStop(0, "rgba(0,0,0,0)");
    spot.addColorStop(1, `rgba(4,2,8,${0.18 + stg * 0.1})`);
    ctx.save(); ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.fillStyle = spot;
    ctx.fillRect(0, 0, W, py - 4); ctx.restore();

    // wheel
    const g = this.wheelGeom();
    const wheel = this.shownWheel;
    let frac: number;
    if (this.phase === "spin") frac = pointerAt(wheel, Math.max(0, this.clock - this.spinStart));
    else if (this.phase === "deal") frac = wheel.phase;
    else frac = this.lockFrac;
    const day = s.day;
    const telegraph = Math.max(0.15, 1 - Math.min(1, (day - 1) / 22));
    const omenDim = s.omen === "eclipse" ? 0.55 : 0;
    drawWheel(ctx, wheel, {
      cx: g.cx, cy: g.cy, r: g.r, frac,
      hazard: c.hazards.get(wheel.hazard)!,
      telegraph, locked: this.phase === "lock" ? this.lockKind : null,
      lockAge: this.lockT, needle: this.needle, highContrast: hc, time, dim: omenDim
    });

    // first-run affordance: pulsing tap hint on the first wheel, icon only
    const tapHint = (this.host.firstRun() && s.day === 1 && s.slot < 2) || s.tut === 1;
    if (tapHint && this.phase === "spin" && this.hold <= 0 && !this.host.intentLock()) {
      const k = (Math.sin(time * 4) + 1) / 2;
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.arc(g.cx, g.cy, 52 + k * 14, 0, Math.PI * 2);
      ctx.lineWidth = 5; ctx.strokeStyle = PAL.gold; ctx.stroke();
      drawIcon(ctx, "tap", g.cx + 4, g.cy + 62 + k * 6, 56, { color: PAL.white, lw: 2.6 });
      ctx.restore();
    }

    // intent buttons
    for (const it of this.items().slice(1)) if (this.phase !== "deal") drawItemButton(ctx, it, focusId === it.id, hc);

    drawPopups(ctx, T + 62, this.popups);

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(122,76,194,${0.35 * this.flash})`;
      ctx.fillRect(-20, -20, W + 40, H + 40);
    }
    ctx.restore();

    // omen banner
    if (this.omenBanner > 0 && s.omen) {
      const k = Math.min(1, this.omenBanner / 0.3, (1.4 - this.omenBanner) / 0.25);
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, k));
      ctx.fillStyle = "rgba(10,6,16,0.55)";
      ctx.fillRect(0, py - 10, W, ph + 20);
      drawIcon(ctx, c.omens.get(s.omen)!.icon, W / 2, py + ph / 2, 170, { color: PAL.white, lw: 1.6 });
      ctx.restore();
    }

    if (this.phase === "deal") this.drawDeal(ctx, time, focusId, stg, hc);
    if (this.phase === "dayend") this.drawDayEnd(ctx, time);
  }

  private drawAdviceStrip(ctx: Ctx, y: number, stg: number, time: number, hc: boolean): void {
    const s = this.state, t = this.t;
    drawPanel(ctx, 20, y, W - 40, 66, { fill: "#d8c79c", seed: 51, lw: hc ? 5 : 3 });
    ctx.save();
    ctx.beginPath(); ctx.rect(24, y + 4, 90, 58); ctx.clip();
    visual("deceiver.advisor")(ctx, 70, y + 59, 150, 150, { stage: stg });
    ctx.restore();
    const adv = this.shownCur.advice;
    const pulse = s.tut === 3 ? (Math.sin(time * 5) + 1) / 2 : 0;
    if (adv) {
      ctx.beginPath(); ctx.arc(142, y + 28, 20 + pulse * 3, 0, Math.PI * 2);
      ctx.fillStyle = "#f6ecd0"; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = pulse > 0 ? PAL.gold : PAL.ink; ctx.stroke();
      drawIcon(ctx, adv.ruling === "yes" ? "check" : "x", 142, y + 28, 24, { color: adv.ruling === "yes" ? "#3f7a34" : "#8a3a2e", lw: 3.4 });
      const lines = this.host.content.deceiver.advice[adv.ruling];
      text(ctx, lines[this.shownLine % lines.length]!, 176, y + 28, 22, { color: PAL.ink, align: "left" });
    } else {
      text(ctx, "…", 150, y + 28, 30, { color: "#6a5a3a", align: "left" });
    }
    // exposure pips (blades) and marks; usurpation itself is never shown, only the court's rot
    const limit = t.exposeLimit!;
    for (let i = 0; i < limit; i++) {
      const filled = i < s.expose;
      const flash = this.exposeFlash > 0 && i === s.expose - 1 ? 4 : 0;
      drawIcon(ctx, "blade", 150 + i * 24, y + 53, 18 + flash, { color: filled ? "#8a2f1e" : "rgba(42,29,20,0.3)", lw: 1.6 });
    }
    s.marks.slice(0, 3).forEach((m, i) => {
      const x = W - 70 - i * 34;
      drawIcon(ctx, FACTION_ICON[m.faction], x, y + 49, 22, { color: PAL.ink, lw: 2 });
      drawIcon(ctx, "crack", x + 11, y + 56, 14, { color: "#8a2f1e", lw: 2 });
    });
    if (this.vowFlash > 0) {
      ctx.strokeStyle = PAL.gold; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.roundRect(18, y - 2, W - 36, 70, 8); ctx.stroke();
    }
  }

  private drawDeal(ctx: Ctx, time: number, focusId: string | null, stg: number, hc: boolean): void {
    const s = this.state, c = this.host.content;
    const deal = c.deals.get(s.dealOffer!)!;
    ctx.fillStyle = PAL.dim;
    ctx.fillRect(0, 0, W, H);
    drawPanel(ctx, 40, 150, W - 80, 700, { seed: 88, lw: 4 });
    visual("deceiver.advisor")(ctx, W / 2, 360, 300, 300, { stage: stg, bob: this.host.reducedMotion() ? 0 : Math.sin(time * 2) * 4 });
    const offer = c.deceiver.offer;
    text(ctx, offer[(s.day + s.dealsTaken) % offer.length]!, W / 2, 536, 28, { color: PAL.ink });
    drawPanel(ctx, W / 2 - 80, 566, 160, 110, { fill: "#f6ecd0", seed: 89, lw: 3 });
    drawIcon(ctx, deal.icon, W / 2, 621, 80, { color: PAL.ink, lw: 2.4 });
    for (const it of this.items().slice(1)) {
      const f = focusId === it.id;
      drawPanel(ctx, it.x, it.y, it.w, it.h, { fill: f ? "#f6e6b8" : PAL.parchment, seed: it.id.length * 5, lw: f ? (hc ? 8 : 6) : 3, edge: f ? PAL.gold : PAL.ink });
      drawIcon(ctx, it.icon!, it.x + it.w / 2, it.y + it.h / 2, 70, { color: it.id === "yes" ? "#3f7a34" : "#8a3a2e", lw: 3.6 });
    }
  }

  private drawDayEnd(ctx: Ctx, time: number): void {
    const s = this.state, t = this.t;
    ctx.fillStyle = PAL.dim;
    ctx.fillRect(0, 0, W, H);
    const top = 130 + Math.round(Math.max(0, H - 960) * 0.25);
    drawPanel(ctx, 40, top, W - 80, 640, { seed: 77, lw: 4 });
    visual("ruler.king")(ctx, W / 2, top + 110, 190, 190);
    drawIcon(ctx, s.tut ? "book" : "calendar", W / 2 - 54, top + 232, 40, { color: PAL.ink });
    text(ctx, s.tut ? `${s.tut}/3` : `${s.day}`, W / 2 + 6, top + 234, 44, { align: "left" });
    // tick lines: icon, then the stat change chips
    let y = top + 282;
    for (const line of this.dayLines) {
      drawIcon(ctx, line.icon, 100, y + 24, 44, { color: PAL.ink, lw: 2.2 });
      let x = 190;
      for (const k of ["p", "h", "g"] as StatKey[]) {
        const a = line.fx[k];
        if (!a) continue;
        drawIcon(ctx, STAT_ICON[k], x, y + 24, 34, { color: PAL.ink });
        drawIcon(ctx, a > 0 ? "up" : "down", x + 30, y + 24, 22, { color: a > 0 ? "#2f6a28" : "#8a2f1e" });
        text(ctx, `${Math.abs(Math.round(a * 10) / 10)}`, x + 62, y + 25, 28, { align: "left" });
        x += 112;
      }
      y += 52;
    }
    const k = (Math.sin(time * 4) + 1) / 2;
    drawIcon(ctx, "play", W / 2, top + 596 + k * 5, 70, { color: PAL.ink });
    void t;
  }
}

function tickIcon(src: string): string {
  return src === "tax" ? "coin" : src === "drag" ? "smile" : src === "fix" ? "heart" : src === "growth" ? "person" : "eclipse";
}

export function drawItemButton(ctx: Ctx, it: Item, focused: boolean, hc: boolean): void {
  drawPanel(ctx, it.x, it.y, it.w, it.h, { fill: focused ? "#f6e6b8" : PAL.parchment, seed: it.id.length * 5, lw: focused ? (hc ? 7 : 5) : 3, edge: focused ? PAL.gold : PAL.ink });
  if (it.icon) drawIcon(ctx, it.icon, it.x + it.w / 2, it.y + it.h / 2, Math.min(it.w, it.h) * 0.58, { color: PAL.ink, lw: 2.6 });
}
