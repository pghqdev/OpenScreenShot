import type { Settings } from './types';
import { DEFAULT_SETTINGS } from './types';

const SETTINGS_KEY = 'openscreenshot:settings';

/** Load settings, merged over the defaults so new fields are always present. */
export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const partial = (stored[SETTINGS_KEY] ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...partial };
}

/** Persist a partial settings update, merged with the current values. */
export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}