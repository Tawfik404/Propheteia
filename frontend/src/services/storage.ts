import type { SettingsState } from '../types';

/**
 * localStorage persistence for user preferences.
 */

const STORAGE_KEY = 'propheteia-settings';

const DEFAULTS: SettingsState = {
  notifications: false,
  location: false,
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Read the persisted settings, falling back to defaults. */
export function loadSettings(): SettingsState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return { ...DEFAULTS };
    return {
      notifications:
        typeof parsed.notifications === 'boolean' ? parsed.notifications : DEFAULTS.notifications,
      location: typeof parsed.location === 'boolean' ? parsed.location : DEFAULTS.location,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Persist the settings (silently ignores storage failures). */
export function saveSettings(settings: SettingsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable (private mode, quota): fail silently
  }
}
