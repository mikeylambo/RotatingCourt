import { defaultCoreSettings, prefersReducedMotion, SettingsStore, type CoreSettings, type StorageAdapter } from "@slu/web-shell";

export interface GameSettings extends CoreSettings {
  /** Slows the wheel and widens segments. Never changes scoring. */
  assist: boolean;
  /** Pick Yes/No instead of timing a stop. Marks the run as assisted. */
  intentLock: boolean;
  highContrast: boolean;
  textScale: number;
}

export const defaultGameSettings = (): GameSettings => ({
  ...defaultCoreSettings,
  reducedMotion: prefersReducedMotion(),
  assist: false,
  intentLock: false,
  highContrast: false,
  textScale: 1
});

export function createSettings(storage: StorageAdapter): SettingsStore<GameSettings> {
  return new SettingsStore<GameSettings>(storage, "settings", defaultGameSettings());
}
