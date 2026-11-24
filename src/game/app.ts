/**
 * Application shell: screens, input mapping, profile and results. Every device is mapped into the
 * shell InputManager's semantic actions (rules 10-11); screens only ever read actions.
 */
import {
  BrowserHaptics, BrowserInputSource, BrowserPlatform, createRunDescriptor, DeterministicRngRegistry, scheduledSeed,
  ScreenManager, type InputBinding, type LeaderboardManager, type RankingSystem, type SLUWebShell, type SettingsStore
} from "@slu/web-shell";
import { drawIcon } from "./art/icons";
import { drawPanel, drawVignette } from "./art/backdrop";
import { visual } from "./art/visuals";
import { audio, emit } from "./audio/synth";
import { courtStage, createRun, daysSurvived, finalScore, tuningFor } from "./engine";
import { type Profile, type ProfileStore } from "./profile";
import { Run, drawItemButton, type RunHost } from "./run";
import type { GameSettings } from "./settings";
import { A11yMirror, H, PAL, W, drawItem, hit, layoutStage, stage, text, toLogical, view, type Item } from "./ui/kit";
import { drawWheel } from "./render/wheel";
import { STAT_ICON } from "./render/hud";
import { FACTION_ICON } from "./types";
import type { ChallengeDef, Content, Ending, Ev, GameState, Mode, StatKey, Tuning, Wheel } from "./types";

export type ScreenId = "title" | "menu" | "vows" | "challenges" | "profile" | "settings" | "play" | "results";

export interface Services {
  canvas: HTMLCanvasElement;
  shell: SLUWebShell<GameSettings>;
  settings: SettingsStore<GameSettings>;
  store: ProfileStore;
  content: Content;
  tuning: () => Tuning;
  ranking: RankingSystem;
  leaderboards: LeaderboardManager;
  gameId: string;
}

interface ResultsView {
  state: GameState;
  mode: Mode;
  challenge: ChallengeDef | null;
  score: number;
  days: number;
  grade: string;
  best: number;
  newBest: boolean;
  medal: string | null;
  unlocked: string[];
  assisted: boolean;
  ending: Ending | null;
  caught: number;
  marks: number;
}

const BINDINGS: InputBinding[] = [
  { action: "ui_up", keyboard: ["ArrowUp", "KeyW"], gamepadButtons: [12], gamepadAxes: [{ axis: 1, direction: -1 }] },
  { action: "ui_down", keyboard: ["ArrowDown", "KeyS"], gamepadButtons: [13], gamepadAxes: [{ axis: 1, direction: 1 }] },
  { action: "ui_left", keyboard: ["ArrowLeft", "KeyA"], gamepadButtons: [14], gamepadAxes: [{ axis: 0, direction: -1 }] },
  { action: "ui_right", keyboard: ["ArrowRight", "KeyD"], gamepadButtons: [15], gamepadAxes: [{ axis: 0, direction: 1 }] },
  { action: "ui_accept", keyboard: ["Enter", "Space"], gamepadButtons: [0] },
  { action: "ui_back", keyboard: ["Escape", "Backspace"], gamepadButtons: [1] },
  { action: "pause", keyboard: ["Escape", "KeyP"], gamepadButtons: [9] },
  { action: "stop", keyboard: ["Space", "Enter"], gamepadButtons: [0, 2, 3] },
  { action: "yes", keyboard: ["KeyY", "ArrowRight"], gamepadButtons: [5] },
  { action: "no", keyboard: ["KeyN", "ArrowLeft"], gamepadButtons: [4] }
];
const STOP_CODES = new Set(["Space", "Enter"]);

const DEMO_WHEEL: Wheel = {
  segs: [{ kind: "yes", start: 0, size: 0.38 }, { kind: "hazard", start: 0.38, size: 0.24 }, { kind: "no", start: 0.62, size: 0.38 }],
  phase: 0, speed: 0.12, spinUp: 0, hazard: "chaos"
};

export class CourtApp {
  screen: ScreenId = "title";
  private items: Item[] = [];
  private focusId: string | null = null;
  private run: Run | null = null;
  private pauseOpen = false;
  private settingsFrom: "menu" | "pause" = "menu";
  private results: ResultsView | null = null;
  private time = 0;
  private last = 0;
  private source: BrowserInputSource;
  private raw = new Map<string, number>();
  private pointerStamp = 0;
  private keyStamp = 0;
  private pointerItem: string | null = null;
  private mirror: A11yMirror;
  private screens = new ScreenManager();
  private haptics = new BrowserHaptics({
    light: { mobile: 12, duration: 40, weak: 0.2, strong: 0 },
    heavy: { mobile: [30, 20, 50], duration: 160, weak: 0.5, strong: 0.8 }
  });
  private toasts: Array<{ icon: string; label: string; age: number }> = [];
  private currentMode: Mode = "reign";
  private currentChallenge: ChallengeDef | null = null;
  private currentSeedKey: string | null = null;
  private runAssisted = false;
  private shakeDeny = 0;
  /** Menu row to re-focus when returning from a sub-screen. */
  private menuFocus: string | null = null;
  /** Vow Night: the run being set up and the vows picked so far. */
  private pending: { mode: Mode; challenge: ChallengeDef | null } = { mode: "reign", challenge: null };
  private vowPick: string[] = [];
  private lastVows: string[] | null = null;
  private lastStage: 0 | 1 | 2 | 3 = 0;
  private ctx: CanvasRenderingContext2D;
  private platform = new BrowserPlatform();

  constructor(private readonly sv: Services) {
    this.ctx = sv.canvas.getContext("2d")!;
    this.source = new BrowserInputSource(BINDINGS);
    this.mirror = new A11yMirror(document.body);
    this.mirror.onFocusId = (id) => { if (this.focusId !== id) this.focusId = id; };
    sv.shell.input.setBindings(BINDINGS);
    this.screens.register((["title", "menu", "vows", "challenges", "profile", "settings", "play", "results"] as ScreenId[]).map((id) => ({
      id,
      enter: () => { this.screen = id; this.rebuild(); }
    })));
    this.applySettings();
    sv.settings.events.on("changed", () => this.applySettings());
    sv.shell.production.achievements.events.on("achievement:unlocked", (a) => {
      const def = sv.content.achievements.find((x) => x.id === a.id);
      if (def) this.toasts.push({ icon: def.icon, label: def.label, age: 0 });
    });
  }

  /* ------------------------------------------------------------ lifecycle */

  start(): void {
    this.source.attach();
    const resize = (w: number, h: number, dpr: number) => {
      const d = Math.min(2, dpr);
      this.sv.canvas.width = Math.round(w * d);
      this.sv.canvas.height = Math.round(h * d);
      this.sv.canvas.style.width = `${w}px`;
      this.sv.canvas.style.height = `${h}px`;
      layoutStage(w, h, d);
      this.rebuild();
    };
    this.platform.onResize(resize);
    this.platform.onVisibilityChange((hidden) => { if (hidden && this.screen === "play" && !this.pauseOpen) this.openPause(); });
    this.attachPointer();
    addEventListener("keydown", (e) => {
      audio.unlock();
      if (STOP_CODES.has(e.code)) this.keyStamp = e.timeStamp;
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    void this.screens.show("title");
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  private applySettings(): void {
    const s = this.sv.settings.snapshot();
    view.textScale = s.textScale;
    this.haptics.setEnabled(s.vibration);
  }

  private get cfg(): GameSettings {
    return this.sv.settings.snapshot();
  }

  /* ---------------------------------------------------------------- input */

  private attachPointer(): void {
    const c = this.sv.canvas;
    c.style.touchAction = "none";
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      audio.unlock();
      if (e.button > 0) return;
      const p = toLogical(e.clientX, e.clientY);
      this.pointerStamp = e.timeStamp;
      const items = this.activeItems();
      const hitItem = items.find((it) => hit(it, p.x, p.y));
      if (this.screen === "play" && !this.pauseOpen) {
        if (hitItem) { this.pointerItem = hitItem.id; this.focusId = hitItem.id; return; }
        this.raw.set("stop", 1);
        return;
      }
      if (this.screen === "title") { this.raw.set("ui_accept", 1); return; }
      this.pointerItem = hitItem?.id ?? null;
      if (hitItem) this.focusId = hitItem.id;
    });
    const up = (e: PointerEvent) => {
      const p = toLogical(e.clientX, e.clientY);
      const id = this.pointerItem;
      this.pointerItem = null;
      if (!id) return;
      const it = this.activeItems().find((x) => x.id === id);
      if (it && hit(it, p.x, p.y)) {
        this.focusId = id;
        if (this.screen === "play" && !this.pauseOpen) {
          if (id === "pause") this.raw.set("pause", 1);
          else this.raw.set(id === "yes" ? "yes" : "no", 1);
        } else this.raw.set("ui_accept", 1);
      }
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", () => { this.pointerItem = null; });
  }

  private pollInput(): void {
    const raw = this.source.poll();
    for (const [k, v] of this.raw) raw.set(k, Math.max(raw.get(k) ?? 0, v));
    this.raw.clear();
    this.sv.shell.input.update(raw);
  }

  private pressed(a: string): boolean {
    return this.sv.shell.input.wasPressed(a);
  }

  private stopStamp(): number {
    const now = performance.now();
    const s = Math.max(this.pointerStamp, this.keyStamp);
    return now - s < 120 ? s : now;
  }

  /* --------------------------------------------------------------- screens */

  private activeItems(): Item[] {
    if (this.screen === "play" && !this.pauseOpen && this.run) return this.run.items();
    return this.items;
  }

  private phase(next: Parameters<SLUWebShell<GameSettings>["session"]["setPhase"]>[0]): void {
    try { this.sv.shell.session.setPhase(next); } catch { /* phase policy refused: presentation continues */ }
  }

  private goto(id: ScreenId): void {
    emit("ui.confirm");
    if (id === "menu") this.phase("menu");
    this.focusId = id === "menu" ? this.menuFocus : null;
    void this.screens.show(id, undefined, false);
  }

  private rebuild(): void {
    const T = Math.max(14, stage.safeT + 10);
    const back: Item = { id: "back", x: 18, y: T, w: 56, h: 56, aria: "back", icon: "back" };
    const rowH = 72, gap = 12;
    let items: Item[] = [];
    const p = this.sv.store.profile;
    const s = this.cfg;
    const unlocks = this.sv.shell.unlocks;
    const mk = (d: Partial<Item> & { id: string; aria: string }, i: number, top: number, h = rowH, w = 440): Item => ({ x: (W - w) / 2, y: top + i * (h + gap), w, h, ...d });

    if (this.pauseOpen && this.screen === "play") {
      items = [
        { id: "resume", icon: "play", label: "", aria: "resume" },
        { id: "restart", icon: "retry", label: "", aria: "restart" },
        { id: "settings", icon: "gear", label: "", aria: "settings" },
        { id: "quit", icon: "home", label: "", aria: "quit to menu" }
      ].concat(this.run?.state.tut ? [{ id: "skip", icon: "skip", label: "", aria: "skip the tutorial" }] : [])
        .map((d, i) => ({ x: W / 2 - 156 + (i % 2) * 168, y: 360 + Math.floor(i / 2) * 168, w: 144, h: 144, ...d, draw: (ctx, it, f) => this.drawBigButton(ctx, it, f) }));
      this.setItems(items, "resume");
      return;
    }

    switch (this.screen) {
      case "title":
        items = [{ id: "start", x: 0, y: 0, w: W, h: H, aria: "start" , draw: () => undefined }];
        break;
      case "menu": {
        const list: Array<Partial<Item> & { id: string; aria: string }> = [];
        if (p.activeRun) list.push({ id: "continue", icon: "play", label: "Continue", aria: "continue reign" });
        list.push({ id: "reign", icon: "crown", label: "Reign", aria: "reign, 25 days", big: true });
        list.push({ id: "endless", icon: "infinity", label: "Endless", aria: "endless", locked: !unlocks.has("endless") });
        list.push({ id: "challenges", icon: "trophy", label: "Trials", aria: "trials" });
        list.push({ id: "profile", icon: "star", label: "Records", aria: "records" });
        list.push({ id: "settings", icon: "gear", label: "Settings", aria: "settings" });
        const top = 304 - Math.max(0, list.length - 6) * 20;
        items = list.map((d, i) => mk(d, i, top, 68, 440));
        break;
      }
      case "vows": {
        const defs = this.sv.content.vowOrder.map((id) => this.sv.content.vows.get(id)!);
        const cw = 232, chh = 118;
        items = [back, ...defs.map((v, i) => ({
          id: v.id, aria: `${v.faction}: ${v.line}`, x: 25 + (i % 2) * (cw + 26), y: 270 + Math.floor(i / 2) * (chh + 14), w: cw, h: chh,
          draw: (ctx: CanvasRenderingContext2D, it: Item, f: boolean) => this.drawVowCard(ctx, it, f, v.id)
        }))];
        items.push({ id: "confirm", aria: "swear the vows", x: W / 2 + 20, y: 270 + 4 * (chh + 14) + 8, w: 200, h: 84, icon: "oath", disabled: this.vowPick.length < 3,
          draw: (ctx: CanvasRenderingContext2D, it: Item, f: boolean) => this.drawBigButton(ctx, it, f) });
        if (!p.tutorialDone) items.push({ id: "skip", aria: "skip the tutorial", x: W / 2 - 220, y: 270 + 4 * (chh + 14) + 8, w: 200, h: 84, icon: "skip",
          draw: (ctx: CanvasRenderingContext2D, it: Item, f: boolean) => this.drawBigButton(ctx, it, f) });
        break;
      }
      case "challenges": {
        const hardOpen = unlocks.has("trials-hard");
        items = [back, ...this.sv.content.challenges.map((c, i) => {
          const rec = p.challenges[c.id];
          const medals = rec?.medal ? ["bronze", "silver", "gold"].indexOf(rec.medal) + 1 : 0;
          return mk({
            id: c.id, aria: `${c.label} trial`, locked: i >= 3 && !hardOpen,
            draw: (ctx, it, f) => this.drawTrialRow(ctx, it, f, c, medals)
          }, i, 190, 84);
        })];
        break;
      }
      case "profile": {
        const defs = this.sv.content.achievements;
        const cols = 4, size = 92, gx = (W - (cols * size + (cols - 1) * 14)) / 2;
        items = [back, ...defs.map((a, i) => ({
          id: a.id, aria: a.label, x: gx + (i % cols) * (size + 14), y: 520 + Math.floor(i / cols) * (size + 14), w: size, h: size,
          draw: (ctx: CanvasRenderingContext2D, it: Item, f: boolean) => this.drawAchievement(ctx, it, f, a.icon, this.sv.shell.production.achievements.has(a.id))
        }))];
        break;
      }
      case "settings": {
        const rows: Array<Partial<Item> & { id: string; aria: string }> = [
          { id: "volume", icon: "sound", label: "Volume", aria: "volume", pips: { value: Math.round(s.masterVolume * 4), max: 4 } },
          { id: "motion", icon: "wave", label: "Calm", aria: "reduced motion", toggle: s.reducedMotion },
          { id: "shake", icon: "bolt", label: "Shake", aria: "screen shake", pips: { value: Math.round(s.screenShake * 3), max: 3 } },
          { id: "vibration", icon: "bell", label: "Buzz", aria: "vibration", toggle: s.vibration },
          { id: "assist", icon: "feather", label: "Assist", aria: "assist: slower, wider wheel", toggle: s.assist },
          { id: "intent", icon: "check", label: "Auto-stop", aria: "auto-stop: choose yes or no without timing", toggle: s.intentLock },
          { id: "contrast", icon: "eye", label: "Contrast", aria: "high contrast", toggle: s.highContrast },
          { id: "text", icon: "book", label: "Text", aria: "text size", pips: { value: Math.round((s.textScale - 1) / 0.15), max: 2 } },
          { id: "fullscreen", icon: "castle", label: "Screen", aria: "fullscreen", toggle: !!document.fullscreenElement }
        ];
        items = [back, ...rows.map((d, i) => mk({ ...d, adjust: true }, i, 160, 66, 460))];
        break;
      }
      case "results":
        items = [
          { id: "retry", x: W / 2 - 176, y: 730, w: 168, h: 120, aria: "retry", icon: "retry", draw: (c, it, f) => this.drawBigButton(c, it, f) },
          { id: "menu", x: W / 2 + 8, y: 730, w: 168, h: 120, aria: "menu", icon: "home", draw: (c, it, f) => this.drawBigButton(c, it, f) }
        ];
        break;
      default:
        items = [];
    }
    const first = items.find((i) => i.id !== "back" && !i.locked) ?? items[0];
    this.setItems(items, this.focusId && items.some((i) => i.id === this.focusId) ? this.focusId : first?.id ?? null);
  }

  private setItems(items: Item[], focus: string | null): void {
    this.items = items;
    this.focusId = focus;
    if (this.screen !== "title") this.mirror.sync(items, focus);
    else this.mirror.sync([{ id: "start", x: 0, y: 0, w: W, h: H, aria: "start" }], "start");
  }

  private moveFocus(dx: number, dy: number): void {
    const list = this.items.filter((i) => i.id !== "start");
    const cur = list.find((i) => i.id === this.focusId) ?? list[0];
    if (!cur) return;
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    let best: Item | null = null, bestScore = Infinity;
    for (const it of list) {
      if (it === cur) continue;
      const ox = it.x + it.w / 2 - cx, oy = it.y + it.h / 2 - cy;
      const along = ox * dx + oy * dy;
      if (along <= 4) continue;
      const across = Math.abs(ox * dy) + Math.abs(oy * dx);
      const score = along + across * 2.2;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    if (best) { this.focusId = best.id; this.mirror.setFocus(best.id); emit("wheel.tick"); }
  }

  /** Handle semantic menu actions for the current screen. */
  private handleMenuInput(): void {
    if (this.pressed("ui_up")) this.moveFocus(0, -1);
    if (this.pressed("ui_down")) this.moveFocus(0, 1);
    const lr = this.screen === "settings" || this.pauseOpen;
    if (this.pressed("ui_left")) { if (lr && this.screen === "settings") this.adjust(-1); else this.moveFocus(-1, 0); }
    if (this.pressed("ui_right")) { if (lr && this.screen === "settings") this.adjust(1); else this.moveFocus(1, 0); }
    if (this.pressed("ui_back") || this.pressed("pause")) this.back();
    if (this.pressed("ui_accept")) this.activate();
  }

  private back(): void {
    if (this.pauseOpen && this.screen === "play") { this.resume(); return; }
    if (this.screen === "settings" && this.settingsFrom === "pause") { this.screen = "play"; this.pauseOpen = true; this.focusId = "settings"; this.rebuild(); return; }
    if (this.screen === "vows") this.goto(this.pending.challenge ? "challenges" : "menu");
    else if (this.screen === "challenges" || this.screen === "profile" || this.screen === "settings") this.goto("menu");
    else if (this.screen === "results") this.goto("menu");
  }

  private activate(): void {
    const id = this.focusId;
    if (!id) return;
    const it = this.items.find((x) => x.id === id);
    if (it?.locked) { this.shakeDeny = 0.3; return; }
    emit("ui.confirm");
    if (this.screen === "title") { this.goto("menu"); return; }
    if (this.pauseOpen && this.screen === "play") {
      if (id === "resume") this.resume();
      else if (id === "restart") { this.discardActive(); this.pauseOpen = false; this.startRun(this.currentMode, this.currentChallenge, this.lastVows ?? undefined, false); }
      else if (id === "settings") { this.settingsFrom = "pause"; this.pauseOpen = false; this.screen = "settings"; this.focusId = null; this.rebuild(); }
      else if (id === "skip") { this.sv.store.profile.tutorialDone = true; this.sv.store.save(); this.discardActive(); this.pauseOpen = false; this.startRun(this.currentMode, this.currentChallenge, this.lastVows ?? undefined); }
      else if (id === "quit") { this.pauseOpen = false; this.sv.shell.quit(); this.run = null; this.goto("menu"); }
      return;
    }
    switch (this.screen) {
      case "menu":
        this.menuFocus = id;
        if (id === "continue") this.continueRun();
        else if (id === "reign") this.openVows("reign", null);
        else if (id === "endless") this.openVows("endless", null);
        else if (id === "challenges") this.goto("challenges");
        else if (id === "profile") this.goto("profile");
        else if (id === "settings") { this.settingsFrom = "menu"; this.goto("settings"); }
        break;
      case "challenges":
        if (id === "back") this.back();
        else { const c = this.sv.content.challenges.find((x) => x.id === id); if (c) this.openVows("reign", c); }
        break;
      case "vows":
        if (id === "back") this.back();
        else if (id === "skip") { this.sv.store.profile.tutorialDone = true; this.sv.store.save(); this.rebuild(); }
        else if (id === "confirm") { if (this.vowPick.length === 3) this.startRun(this.pending.mode, this.pending.challenge, [...this.vowPick]); }
        else {
          const at = this.vowPick.indexOf(id);
          if (at >= 0) this.vowPick.splice(at, 1);
          else if (this.vowPick.length < 3) this.vowPick.push(id);
          emit("vow.kept");
          this.rebuild();
        }
        break;
      case "profile": if (id === "back") this.back(); break;
      case "settings": if (id === "back") this.back(); else this.adjust(1, true); break;
      case "results":
        if (id === "retry") this.startRun(this.currentMode, this.currentChallenge, this.lastVows ?? undefined, false);
        else this.goto("menu");
        break;
    }
  }

  private adjust(dir: number, wrap = false): void {
    const id = this.focusId;
    const s = this.cfg;
    const st = this.sv.settings;
    const step = (v: number, max: number) => (wrap ? (v + 1 > max ? 0 : v + 1) : Math.max(0, Math.min(max, v + dir)));
    if (id === "volume") void st.patch({ masterVolume: step(Math.round(s.masterVolume * 4), 4) / 4 });
    else if (id === "motion") void st.patch({ reducedMotion: !s.reducedMotion });
    else if (id === "shake") void st.patch({ screenShake: step(Math.round(s.screenShake * 3), 3) / 3 });
    else if (id === "vibration") void st.patch({ vibration: !s.vibration });
    else if (id === "assist") void st.patch({ assist: !s.assist });
    else if (id === "intent") void st.patch({ intentLock: !s.intentLock });
    else if (id === "contrast") void st.patch({ highContrast: !s.highContrast });
    else if (id === "text") void st.patch({ textScale: 1 + step(Math.round((s.textScale - 1) / 0.15), 2) * 0.15 });
    else if (id === "fullscreen") {
      void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()).catch(() => undefined);
    }
    queueMicrotask(() => this.rebuild());
    setTimeout(() => this.rebuild(), 30);
  }

  /* ------------------------------------------------------------------ runs */

  private host(): RunHost {
    const sv = this.sv;
    return {
      content: sv.content,
      reducedMotion: () => this.cfg.reducedMotion,
      shake: () => this.cfg.screenShake,
      highContrast: () => this.cfg.highContrast,
      intentLock: () => this.cfg.intentLock,
      firstRun: () => sv.store.profile.runs === 0,
      announce: (s) => this.mirror.announce(s),
      haptic: (id) => { this.haptics.pulse(id); },
      persist: (s) => { sv.store.profile.activeRun = structuredClone(s); sv.store.save(); },
      onEvents: (events, s) => this.onEvents(events, s),
      onOver: (s) => this.onOver(s)
    };
  }

  /** Night zero: choose the three vows to swear before the reign begins. */
  private openVows(mode: Mode, challenge: ChallengeDef | null): void {
    this.pending = { mode, challenge };
    this.vowPick = this.lastVows ? [...this.lastVows] : [];
    this.goto("vows");
  }

  private startRun(mode: Mode, challenge: ChallengeDef | null, vows?: string[], allowTutorial = true): void {
    const sv = this.sv;
    this.currentMode = mode;
    this.currentChallenge = challenge;
    this.currentSeedKey = null;
    this.lastVows = vows ? [...vows] : this.lastVows;
    const seed = DeterministicRngRegistry.freshSeed(8);
    const t = tuningFor(sv.tuning(), challenge?.tuning);
    const p = sv.store.profile;
    const tutorial = allowTutorial && !p.tutorialDone && mode === "reign" && !challenge;
    const state = createRun(sv.content, t, {
      mode, seed, challenge: challenge?.id ?? null, assist: this.cfg.assist, vows, tutorial, firstRun: p.runs === 0 || tutorial
    });
    sv.shell.production.achievements.hydrate(p.achievements);
    this.begin(state, t);
    sv.shell.studio.telemetry.record("run.start", { mode, seed, challenge: challenge?.id ?? "none", tutorial });
    void createRunDescriptor({ gameId: sv.gameId, version: "2.0.0", modeId: mode, seed, challengeKey: challenge?.id });
  }

  private continueRun(): void {
    const saved = this.sv.store.profile.activeRun;
    if (!saved || saved.v !== 2) return;
    this.lastVows = saved.vows.map((v) => v.id);
    this.currentMode = saved.mode;
    this.currentChallenge = this.sv.content.challenges.find((c) => c.id === saved.challenge) ?? null;
    if (saved.mode === "daily") this.currentSeedKey = scheduledSeed(this.sv.gameId, "daily").key;
    const t = tuningFor(this.sv.tuning(), this.currentChallenge?.tuning);
    saved.assist = this.cfg.assist;
    this.begin(structuredClone(saved), t);
  }

  private begin(state: GameState, t: Tuning): void {
    this.runAssisted = state.assisted;
    this.run = new Run(this.host(), state, t);
    this.pauseOpen = false;
    this.phase("loading");
    this.phase("playing");
    this.sv.store.profile.activeRun = structuredClone(state);
    this.sv.store.save();
    this.goto("play");
  }

  private discardActive(): void {
    this.sv.store.profile.activeRun = null;
    this.sv.store.save();
  }

  private openPause(): void {
    if (!this.run || this.run.paused) return;
    this.run.paused = true;
    this.pauseOpen = true;
    this.sv.shell.pause();
    this.focusId = null;
    this.rebuild();
    audio.pauseAll();
  }

  private resume(): void {
    if (!this.run) return;
    this.run.paused = false;
    this.pauseOpen = false;
    this.sv.shell.resume();
    audio.resumeAll();
    this.focusId = null;
    this.rebuild();
  }

  /* -------------------------------------------------------- results & meta */

  private onEvents(events: Ev[], s: GameState): void {
    const ach = this.sv.shell.production.achievements;
    const unlock = (id: string) => { void ach.unlock(id).then((first) => { if (first) { this.sv.store.profile.achievements = ach.snapshot(); this.sv.store.save(); } }); };
    for (const e of events) {
      if (e.t === "day.end") {
        unlock("first-day");
        void this.sv.shell.stats.increment("days");
        if (s.stats.hazardToday === 0) unlock("clean-day");
        if (s.omen) unlock("omen-bearer");
        if (s.mode === "endless" && s.day >= 30) unlock("endless-30");
      }
      if (e.t === "ruling" && e.kind === "hazard") void this.sv.shell.stats.increment("hazards");
    }
    if (s.stats.bestStreak >= 5) unlock("steady-hand");
    if (s.stats.arcsDone >= 3) unlock("arcs");
    if (s.assisted) this.runAssisted = true;
  }

  private onOver(s: GameState): void {
    const sv = this.sv, p: Profile = sv.store.profile;
    const t = tuningFor(sv.tuning(), this.currentChallenge?.tuning);
    const score = finalScore(s, t);
    const days = daysSurvived(s);
    const mode = s.mode;
    const win = s.over === "win";
    const maxScore = t.days! * (t.scoreDay! + t.scoreCleanDay!) + 3 * t.statMax! * t.scoreStat! + t.scoreWin!;
    const grade = sv.ranking.evaluate(Math.min(100, (score / maxScore) * 100), {}).rank.label;
    const key = mode === "endless" ? days : score;
    const best = mode === "endless" ? p.bestDays.endless : p.bestScore[mode];
    const newBest = key > best;
    p.runs++;
    p.tutorialDone = true;
    if (s.ending) p.endings[s.ending] = (p.endings[s.ending] ?? 0) + 1;
    if (win) p.wins++;
    p.bestScore[mode] = Math.max(p.bestScore[mode], score);
    p.bestDays[mode] = Math.max(p.bestDays[mode], days);
    if (mode === "daily" && this.currentSeedKey) {
      const prev = p.daily[this.currentSeedKey];
      if (!prev || (prev.assisted && !s.assisted) || (prev.assisted === s.assisted && score > prev.score)) {
        p.daily[this.currentSeedKey] = { score, win, days, assisted: s.assisted };
      }
    }
    let medal: string | null = null;
    if (this.currentChallenge) {
      const c = this.currentChallenge;
      sv.shell.challenges.register([{ id: c.id, label: c.label, objectives: [], medals: c.medals }]);
      sv.shell.challenges.start(c.id);
      const done = sv.shell.challenges.complete(win ? score : 0);
      medal = win ? done?.medal ?? null : null;
      const prev = p.challenges[c.id];
      const order = ["bronze", "silver", "gold"];
      if (!prev || score > prev.best) p.challenges[c.id] = { best: Math.max(score, prev?.best ?? 0), medal: (order.indexOf(medal ?? "") > order.indexOf(prev?.medal ?? "")) ? medal : prev?.medal ?? medal };
    }
    p.activeRun = null;

    const ach = sv.shell.production.achievements;
    const before = new Set(ach.snapshot().unlocked);
    const grant = (id: string, cond: boolean) => { if (cond) void ach.unlock(id); };
    grant("first-win", win);
    grant("flourish", win && s.p >= 70 && s.h >= 70 && s.g >= 70);
    grant("hazard-free", win && s.stats.hazards === 0);
    grant("assist-free", win && !s.assist && !s.assisted);
    grant("broke-king", win && s.g < 50);
    grant("daily", mode === "daily");
    grant("just-king", s.ending === "just");
    grant("marked-king", s.ending === "marked");
    grant("hollow-king", s.ending === "hollow");
    grant("long-reign", s.ending === "long");
    const stats = sv.shell.stats;
    void stats.increment("runs");
    if (win) void stats.increment("wins");
    if (win) void sv.shell.unlocks.unlock("endless");
    if (win) void sv.shell.unlocks.unlock("trials-hard");
    if (mode === "reign" && days >= 15) void sv.shell.unlocks.unlock("endless");
    void sv.leaderboards.submit(mode === "daily" ? `daily:${this.currentSeedKey}` : mode, { playerId: "local", displayName: "You", score: key, metadata: { assisted: s.assisted } });

    setTimeout(() => {
      p.achievements = ach.snapshot();
      const unlocked = ach.snapshot().unlocked.filter((id) => !before.has(id));
      this.lastStage = courtStage(s, t);
      this.results = { state: s, mode, challenge: this.currentChallenge, score, days, grade, best: Math.max(best, key), newBest, medal, unlocked, assisted: s.assisted, ending: s.ending, caught: s.stats.caught, marks: s.marks.length };
      sv.store.save();
      this.phase("results");
      this.run = null;
      this.goto("results");
    }, 650);
  }

  /* ------------------------------------------------------------------ frame */

  private frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    this.pollInput();
    this.update(dt);
    this.draw();
    requestAnimationFrame(this.frame);
  };

  private update(dt: number): void {
    for (const t of this.toasts) t.age += dt;
    this.toasts = this.toasts.filter((t) => t.age < 2.6);
    this.shakeDeny = Math.max(0, this.shakeDeny - dt);
    if (this.screen === "play" && this.run) {
      if (this.pauseOpen) { this.handleMenuInput(); return; }
      if (this.pressed("pause") || this.pressed("ui_back")) { this.openPause(); return; }
      if (this.run.phase === "deal") {
        // The Deceiver's deal: Y / RB accepts, N / LB refuses; arrows move between the two, accept confirms. Default focus is refuse.
        if (!this.focusId || (this.focusId !== "yes" && this.focusId !== "no")) this.focusId = "no";
        if (this.pressed("ui_left") || this.pressed("ui_right")) this.focusId = this.focusId === "yes" ? "no" : "yes";
        if (this.pressed("yes")) this.run.answerDeal(true);
        else if (this.pressed("no")) this.run.answerDeal(false);
        else if (this.pressed("ui_accept") || this.pressed("stop")) this.run.answerDeal(this.focusId === "yes");
        this.run.update(dt);
        return;
      }
      if (this.pressed("stop")) {
        // Menu accept and gameplay stop share Space/A; only the active screen consumes it.
        this.run.pressStop(this.stopStamp());
      }
      if (this.pressed("yes")) this.run.pressIntent("yes");
      if (this.pressed("no")) this.run.pressIntent("no");
      this.run.update(dt);
      return;
    }
    if (this.screen === "title") { if (this.pressed("ui_accept") || this.pressed("stop")) this.goto("menu"); return; }
    this.handleMenuInput();
  }

  /* ------------------------------------------------------------------ draw */

  private draw(): void {
    const ctx = this.ctx;
    const cw = this.sv.canvas.width, ch = this.sv.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0);
    const rot = this.screen === "play" && this.run ? this.run.courtStage() : this.screen === "results" ? this.lastStage : 0;
    visual("court.backdrop")(ctx, stage.cssW / 2, stage.cssH / 2, stage.cssW, stage.cssH, { stage: rot });
    ctx.save();
    ctx.translate(stage.ox, stage.oy);
    ctx.scale(stage.scale, stage.scale);
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    this.syncOffset();
    ctx.translate(0, stage.offY);
    switch (this.screen) {
      case "title": this.drawTitle(ctx); break;
      case "menu": this.drawHeader(ctx, false); this.drawItems(ctx); break;
      case "vows": this.drawVows(ctx); break;
      case "challenges": this.drawHeader(ctx, true); this.drawItems(ctx); break;
      case "profile": this.drawProfile(ctx); break;
      case "settings": this.drawHeader(ctx, true); this.drawItems(ctx); break;
      case "results": this.drawResults(ctx); break;
      case "play":
        this.run?.draw(ctx, this.time, this.currentMode, this.focusId);
        break;
    }
    ctx.translate(0, -stage.offY);
    this.drawToasts(ctx);
    ctx.restore();
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0);
    if (this.screen === "play" && this.pauseOpen) {
      // Dim the whole window (not just the stage), then draw the pause buttons on top.
      ctx.fillStyle = PAL.dim;
      ctx.fillRect(0, 0, stage.cssW, stage.cssH);
      ctx.save();
      ctx.translate(stage.ox, stage.oy + stage.offY * stage.scale);
      ctx.scale(stage.scale, stage.scale);
      this.drawItems(ctx);
      ctx.restore();
    }
    drawVignette(ctx, stage.cssW, stage.cssH);
  }

  /** Menus centre on tall phones; the run screen anchors to the top and bottom instead. */
  private syncOffset(): void {
    const off = this.screen === "play" && !this.pauseOpen ? 0 : Math.round((H - 960) / 2);
    if (off !== stage.offY) { stage.offY = off; this.mirror.sync(this.items, this.focusId); }
  }

  private drawItems(ctx: CanvasRenderingContext2D): void {
    const o = { highContrast: this.cfg.highContrast, time: this.time };
    for (const it of this.items) {
      if (it.id === "back") { drawItemButton(ctx, it, this.focusId === "back", o.highContrast); continue; }
      const dx = this.shakeDeny > 0 && it.id === this.focusId ? Math.sin(this.time * 60) * 6 : 0;
      ctx.save();
      ctx.translate(dx, 0);
      drawItem(ctx, it, this.focusId === it.id, o);
      ctx.restore();
    }
  }

  private drawBigButton(ctx: CanvasRenderingContext2D, it: Item, f: boolean): void {
    ctx.save();
    if (it.disabled) ctx.globalAlpha = 0.4;
    drawPanel(ctx, it.x, it.y + (f ? -4 : 0), it.w, it.h, { fill: f ? "#f6e6b8" : PAL.parchment, edge: f ? PAL.gold : PAL.ink, lw: f ? 6 : 3.5, seed: it.id.length * 9 });
    if (it.icon) drawIcon(ctx, it.icon, it.x + it.w / 2, it.y + it.h / 2 + (f ? -4 : 0), 64, { color: PAL.ink, lw: 2.4 });
    ctx.restore();
  }

  private drawHeader(ctx: CanvasRenderingContext2D, small: boolean): void {
    if (small) return;
    visual("ruler.king")(ctx, W / 2, 128, 210, 210);
    text(ctx, "Rotating Court", W / 2, 262, 42, { color: PAL.gold, stroke: PAL.ink });
  }

  private drawTitle(ctx: CanvasRenderingContext2D): void {
    text(ctx, "Rotating", W / 2, 120, 76, { color: PAL.gold, stroke: PAL.ink });
    text(ctx, "Court", W / 2, 196, 76, { color: PAL.gold, stroke: PAL.ink });
    visual("ruler.king")(ctx, W / 2, 380, 280, 280);
    drawWheel(ctx, DEMO_WHEEL, {
      cx: W / 2, cy: 700, r: 150, frac: (this.time * 0.08) % 1,
      hazard: this.sv.content.hazards.get("chaos")!, telegraph: 0, locked: null, lockAge: 0, needle: 0, highContrast: false, time: this.time, hub: null
    });
    const k = (Math.sin(this.time * 3.5) + 1) / 2;
    drawIcon(ctx, "play", W / 2, 700, 56 + k * 6, { color: PAL.ink });
  }

  private drawVows(ctx: CanvasRenderingContext2D): void {
    const T = Math.max(14, stage.safeT + 10);
    ctx.save();
    ctx.beginPath(); ctx.rect(W / 2 - 110, T, 220, 150); ctx.clip();
    visual("deceiver.advisor")(ctx, W / 2, T + 96, 230, 230, { stage: 0 });
    ctx.restore();
    text(ctx, this.sv.content.deceiver.greeting, W / 2, T + 176, 30, { color: PAL.gold, stroke: PAL.ink });
    // three oath pips: how many vows are sworn
    for (let i = 0; i < 3; i++) drawIcon(ctx, "oath", W / 2 + (i - 1) * 44, T + 214, 28, { color: i < this.vowPick.length ? PAL.gold : "rgba(255,248,232,0.35)", lw: 2 });
    this.drawItems(ctx);
  }

  private drawVowCard(ctx: CanvasRenderingContext2D, it: Item, f: boolean, vowId: string): void {
    const def = this.sv.content.vows.get(vowId)!;
    const on = this.vowPick.includes(vowId);
    drawPanel(ctx, it.x, it.y + (f ? -3 : 0), it.w, it.h, { fill: on ? "#f3dc9a" : f ? "#f6e6b8" : PAL.parchment, edge: f ? PAL.gold : PAL.ink, lw: f ? 5 : 3, seed: vowId.charCodeAt(0) * 3 });
    const cy = it.y + it.h / 2 + (f ? -3 : 0);
    drawIcon(ctx, FACTION_ICON[def.faction], it.x + 36, cy - 22, 40, { color: PAL.ink, lw: 2.4 });
    def.icons.forEach((id, i) => drawIcon(ctx, id, it.x + 100 + i * 52, cy - 10, 44, { color: PAL.ink, lw: 2.2 }));
    text(ctx, def.line, it.x + it.w / 2, it.y + it.h - 22 + (f ? -3 : 0), 19, { color: PAL.ink });
    if (on) drawIcon(ctx, "check", it.x + it.w - 26, it.y + 26, 30, { color: "#3f7a34", lw: 4 });
  }

  private drawTrialRow(ctx: CanvasRenderingContext2D, it: Item, f: boolean, c: ChallengeDef, medals: number): void {
    drawPanel(ctx, it.x, it.y + (f ? -3 : 0), it.w, it.h, { fill: f ? "#f6e6b8" : PAL.parchment, edge: f ? PAL.gold : PAL.ink, lw: f ? 5 : 3, seed: c.id.length * 13 });
    const cy = it.y + it.h / 2 + (f ? -3 : 0);
    drawIcon(ctx, c.icon, it.x + 44, cy, 48, { color: PAL.ink, lw: 2.4 });
    text(ctx, c.label, it.x + 88, cy, 30, { align: "left" });
    for (let i = 0; i < 3; i++) drawIcon(ctx, "star", it.x + it.w - 190 + i * 40, cy, 34, { color: i < medals ? PAL.goldDark : "rgba(42,29,20,0.25)", lw: 1.5 });
    if (this.sv.content.challenges.indexOf(c) >= 3 && !this.sv.shell.unlocks.has("trials-hard")) {
      ctx.fillStyle = "rgba(42,29,20,0.4)";
      ctx.beginPath(); ctx.roundRect(it.x, it.y, it.w, it.h, 6); ctx.fill();
      drawIcon(ctx, "padlock", it.x + it.w - 44, cy, 36, { color: PAL.ink });
    }
  }

  private drawAchievement(ctx: CanvasRenderingContext2D, it: Item, f: boolean, icon: string, got: boolean): void {
    drawPanel(ctx, it.x, it.y, it.w, it.h, { fill: f ? "#f6e6b8" : PAL.parchment, edge: f ? PAL.gold : PAL.ink, lw: f ? 5 : 3, seed: it.x });
    if (got) drawIcon(ctx, icon, it.x + it.w / 2, it.y + it.h / 2, 52, { color: PAL.ink, lw: 2.4 });
    else drawIcon(ctx, "padlock", it.x + it.w / 2, it.y + it.h / 2, 40, { color: "rgba(42,29,20,0.35)" });
  }

  private drawProfile(ctx: CanvasRenderingContext2D): void {
    const p = this.sv.store.profile;
    const T = Math.max(14, stage.safeT + 10);
    const rows: Array<[string, number]> = [
      ["retry", p.runs], ["crown", p.wins], ["trophy", p.bestScore.reign], ["calendar", p.bestScore.daily],
      ["infinity", p.bestDays.endless], ["fang", this.sv.shell.stats.get("hazards")]
    ];
    drawPanel(ctx, 40, T + 80, W - 80, 380, { seed: 61, lw: 3.5 });
    rows.forEach(([icon, v], i) => {
      const y = T + 124 + i * 58;
      drawIcon(ctx, icon, 100, y, 40, { color: PAL.ink, lw: 2.4 });
      text(ctx, String(v), W - 90, y, 36, { align: "right" });
    });
    this.drawItems(ctx);
    const f = this.sv.content.achievements.find((a) => a.id === this.focusId);
    if (f) text(ctx, f.label, W / 2, 490, 28, { color: PAL.white, stroke: PAL.ink });
  }

  private drawResults(ctx: CanvasRenderingContext2D): void {
    const r = this.results;
    if (!r) return;
    const win = r.state.over === "win";
    const fall = r.state.over === "fall";
    const e = r.ending;
    const ENDING_LABEL: Record<string, string> = { just: "Just King", marked: "Marked King", hollow: "Hollow King", long: "The Long Reign", usurped: "Usurped" };
    drawPanel(ctx, 30, 50, W - 60, 650, { seed: 91, lw: 4 });
    if (win) drawIcon(ctx, e === "marked" ? "crack" : e === "hollow" ? "halfmask" : e === "long" ? "hourglass" : "crown", W / 2, 108, 74, { color: PAL.goldDark, lw: 2.4 });
    else if (fall) { drawIcon(ctx, "crown", W / 2 - 14, 108, 70, { color: PAL.ink, alpha: 0.5 }); drawIcon(ctx, "down", W / 2 + 36, 126, 34, { color: "#8a2f1e" }); }
    else if (e === "usurped") drawIcon(ctx, "blade", W / 2, 108, 74, { color: "#8a2f1e", lw: 2.4 });
    else drawIcon(ctx, "skull", W / 2, 108, 74, { color: PAL.ink, lw: 2.4 });
    // the figure on the page: the Deceiver when he took the throne or was unmasked, otherwise the king
    visual(e === "usurped" || (win && e !== "long") ? "deceiver.advisor" : "ruler.king")(ctx, W / 2, 252, 210, 210, { stage: this.lastStage });
    if (e && ENDING_LABEL[e]) text(ctx, ENDING_LABEL[e]!, W / 2, 346, 26, { color: PAL.goldDark, stroke: PAL.ink });
    const stats: StatKey[] = ["p", "h", "g"];
    const flag = (k: StatKey) => (win ? false : r.state.cause ? r.state.cause === k : r.state[k] <= 41);
    stats.forEach((k, i) => {
      const x = W / 2 + (i - 1) * 118;
      drawIcon(ctx, STAT_ICON[k], x - 22, 392, 36, { color: PAL.ink });
      text(ctx, String(Math.round(r.state[k])), x + 6, 393, 26, { align: "left" });
      if (flag(k)) drawIcon(ctx, "down", x - 4, 416, 18, { color: "#8a2f1e" });
    });
    text(ctx, String(r.score), W / 2, 466, 72, { color: PAL.ink });
    if (r.newBest) drawIcon(ctx, "star", W / 2 + 190, 466, 44, { color: PAL.goldDark });
    drawIcon(ctx, r.mode === "endless" ? "infinity" : "calendar", W / 2 - 64, 530, 36, { color: PAL.ink });
    text(ctx, String(r.days), W / 2 - 34, 532, 36, { align: "left" });
    text(ctx, r.grade, W / 2 + 96, 532, 52, { color: PAL.goldDark, stroke: PAL.ink });
    if (r.medal) drawIcon(ctx, "medal", W / 2 - 136, 532, 42, { color: PAL.goldDark });
    // exposure and marks: how the court ended up
    drawIcon(ctx, "eye", W / 2 - 80, 590, 32, { color: PAL.ink }); text(ctx, String(r.caught), W / 2 - 54, 591, 28, { align: "left" });
    drawIcon(ctx, "crack", W / 2 + 40, 590, 32, { color: "#8a2f1e" }); text(ctx, String(r.marks), W / 2 + 66, 591, 28, { align: "left" });
    if (r.assisted) drawIcon(ctx, "feather", W - 80, 110, 40, { color: PAL.ink, alpha: 0.7 });
    r.unlocked.slice(0, 6).forEach((id, i, a) => {
      const def = this.sv.content.achievements.find((x) => x.id === id);
      if (def) drawIcon(ctx, def.icon, W / 2 + (i - (a.length - 1) / 2) * 62, 646, 44, { color: PAL.goldDark, lw: 2.4 });
    });
    this.drawItems(ctx);
  }

  private drawToasts(ctx: CanvasRenderingContext2D): void {
    const T = Math.max(14, stage.safeT + 10);
    this.toasts.forEach((t, i) => {
      const k = Math.min(1, t.age / 0.25, (2.6 - t.age) / 0.3);
      ctx.save();
      ctx.globalAlpha = Math.max(0, k);
      const y = T + 6 + i * 70 - (1 - Math.max(0, k)) * 20;
      drawPanel(ctx, W / 2 - 170, y, 340, 60, { fill: "#f6e6b8", seed: 17, lw: 3.5, edge: PAL.gold });
      drawIcon(ctx, t.icon, W / 2 - 134, y + 30, 38, { color: PAL.ink, lw: 2.4 });
      text(ctx, t.label, W / 2 - 100, y + 31, 26, { align: "left" });
      ctx.restore();
    });
  }
}
