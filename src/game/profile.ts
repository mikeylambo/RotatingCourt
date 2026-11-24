/** Persistent profile on top of the shell SaveManager (schema-versioned, staged, backed up). */
import { SaveManager, type StorageAdapter } from "@slu/web-shell";
import type { GameState, Mode } from "./types";

export interface DailyRecord { score: number; win: boolean; days: number; assisted: boolean }
export interface ChallengeRecord { best: number; medal: string | null }

export interface Profile {
  runs: number;
  wins: number;
  bestScore: Record<Mode, number>;
  bestDays: Record<Mode, number>;
  daily: Record<string, DailyRecord>;
  challenges: Record<string, ChallengeRecord>;
  achievements: { unlocked: string[] };
  /** Mid-run snapshot so a reign survives a reload. */
  activeRun: GameState | null;
  /** The Vow Night + three days tutorial has been finished or skipped. */
  tutorialDone: boolean;
  /** How many times each ending has been reached. */
  endings: Record<string, number>;
}

export const SCHEMA = 2;

export const emptyProfile = (): Profile => ({
  runs: 0,
  wins: 0,
  bestScore: { reign: 0, daily: 0, endless: 0 },
  bestDays: { reign: 0, daily: 0, endless: 0 },
  daily: {},
  challenges: {},
  achievements: { unlocked: [] },
  activeRun: null,
  tutorialDone: false,
  endings: {}
});

/** v1 -> v2 (Deceiver edit): keep every record; an in-progress v1 run cannot resume (its state has no vows), and players who already finished runs skip the tutorial. */
export const migrations = {
  1: (data: unknown) => {
    const d = data as Partial<Profile>;
    return { ...d, activeRun: null, tutorialDone: (d.runs ?? 0) > 0, endings: {} };
  }
};

export class ProfileStore {
  profile: Profile = emptyProfile();
  private readonly saves: SaveManager<Profile>;
  private pending: Promise<void> = Promise.resolve();

  constructor(storage: StorageAdapter) {
    // Schema changes need a migration entry above (rule 20).
    this.saves = new SaveManager<Profile>(storage, "profile", SCHEMA, migrations);
  }

  async load(): Promise<void> {
    try {
      const r = await this.saves.loadWithRecovery();
      if (r.data) this.profile = { ...emptyProfile(), ...r.data };
    } catch {
      this.profile = emptyProfile();
    }
  }

  /** Serialised, fire-and-forget persistence. */
  save(): void {
    const snapshot = structuredClone(this.profile);
    this.pending = this.pending.then(() => this.saves.save(snapshot)).catch(() => undefined);
  }

  flush(): Promise<void> {
    return this.pending;
  }
}
