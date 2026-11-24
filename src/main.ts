import {
  AssemblyComposer, AudioLifecycleCoordinator, AudioMixer, BrowserStorage, PWAController, SLUWebShell, StatsManager, UnlockManager,
  bindAudioSettings, createArcadeAssembly, createCanvas2DStarterAdapter, createPuzzleAssembly, installMobileViewportPolicy,
  loadTuningCanon, productionPhasePolicy, tunables,
  type CoreSettings, type LeaderboardManager, type RankingSystem, type SettingsStore, type TunableSchema
} from "@slu/web-shell";
import tuningCanon from "../tuning/court.json";
import { CourtApp } from "./game/app";
import { audio } from "./game/audio/synth";
import { loadContent, validateContent } from "./game/content";
import { ProfileStore } from "./game/profile";
import { createSettings } from "./game/settings";
import { registerVisuals } from "./game/art/visuals";
import type { Tuning } from "./game/types";

const GAME_ID = "rotating-court";
const VERSION = "1.0.0";

/** Every number lives in tuning/court.json; the schema (ranges for the tuning panel) is derived from it. */
function defineTuning(): void {
  const schema: TunableSchema = {};
  for (const [key, v] of Object.entries(tuningCanon.values as Record<string, number>)) {
    const span = Math.max(1, Math.abs(v) * 4);
    schema[key] = { min: v < 0 ? -span : 0, max: span, step: Math.abs(v) < 1 ? 0.01 : Math.abs(v) < 20 ? 0.05 : 1, default: v };
  }
  tunables.define("court", schema);
  loadTuningCanon(import.meta.glob("/tuning/*.json", { eager: true }));
}

async function boot(): Promise<void> {
  const canvas = document.getElementById("game-canvas") as HTMLCanvasElement;
  installMobileViewportPolicy({ rootSelector: "#game", background: "#1b1220" });

  const content = loadContent();
  if (import.meta.env.DEV) {
    const issues = validateContent(content);
    if (issues.length) throw new Error(`content invalid:\n${issues.join("\n")}`);
  }
  defineTuning();

  const storage = new BrowserStorage(GAME_ID);
  const settings = createSettings(storage);
  await settings.load();
  const stats = new StatsManager(storage);
  await stats.load();
  const unlocks = new UnlockManager(storage);
  await unlocks.load();
  const store = new ProfileStore(storage);
  await store.load();

  const shell = new SLUWebShell({
    build: { gameId: GAME_ID, gameName: "Rotating Court", version: VERSION },
    renderer: createCanvas2DStarterAdapter(canvas),
    settings,
    stats,
    unlocks
  });
  shell.session.usePhasePolicy(productionPhasePolicy);

  const composer = new AssemblyComposer(shell);
  await composer.add(createPuzzleAssembly({ shell }));
  await composer.add(createArcadeAssembly({ shell }));
  shell.modes.replace([
    { id: "reign", label: "Reign", winCondition: "survive day 25 with all stats above threshold", lossCondition: "any stat reaches zero" },
    { id: "daily", label: "Daily", description: "shared daily seed" },
    { id: "endless", label: "Endless" }
  ]);
  shell.production.achievements.register(content.achievements.map((a) => ({ id: a.id, label: a.label })));
  shell.production.achievements.hydrate(store.profile.achievements);

  const mixer = new AudioMixer(audio);
  bindAudioSettings(settings as unknown as SettingsStore<CoreSettings>, mixer);
  new AudioLifecycleCoordinator(audio).installVisibility();

  await registerVisuals(content);
  await shell.boot();

  addEventListener("error", (e) => shell.studio.diagnostics.capture(e.error ?? e.message, { scope: "window" }));
  addEventListener("unhandledrejection", (e) => shell.studio.diagnostics.capture(e.reason, { scope: "promise" }));

  const app = new CourtApp({
    canvas, shell, settings, store, content, gameId: GAME_ID,
    tuning: () => tunables.snapshot("court") as Tuning,
    ranking: composer.modules.get<RankingSystem>("ranking"),
    leaderboards: composer.modules.get<LeaderboardManager>("leaderboards")
  });
  app.start();

  if (import.meta.env.PROD) {
    const pwa = new PWAController();
    pwa.attach();
    void pwa.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  }
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(location.search);
    if (params.has("tune")) {
      const { mountTuningPanel } = await import("@slu/web-shell/tuning/panel");
      mountTuningPanel({ startOpen: true });
    }
  }
}

void boot();
