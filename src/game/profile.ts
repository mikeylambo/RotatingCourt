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
}

export const SCHEMA = 1;

export const emptyProfile = (): Profile => ({
  runs: 0,
  wins: 0,
  bestScore: { reign: 0, daily: 0, endless: 0 },
  bestDays: { reign: 0, daily: 0, endless: 0 },
  daily: {},
  challenges: {},
  achievements: { unlocked: [] },
  activeRun: null
});

export class ProfileStore {
  profile: Profile = emptyProfile();
  private readonly saves: SaveManager<Profile>;
  private pending: Promise<void> = Promise.resolve();

  constructor(storage: StorageAdapter) {
    // Add a migration entry here when SCHEMA changes (rule 20): migrations[oldVersion] = (data) => newData.
    this.saves = new SaveManager<Profile>(storage, "profile", SCHEMA, {});
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
