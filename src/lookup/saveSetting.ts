import { type AppConfig, config } from "../config/config";
import type { KeyValueStore } from "../storage/keyValueStore";

/**
 * The starting value of a text lookup's "Save" switch (docs/SPEC.md 3.9, Lookups): off unless
 * the user changes it in Settings, kept in the plain key-value store as "on" or "off". The photo
 * lookup's starting value is not here: this item has no photo lookup screen with the switch.
 */

/** The store key under which the starting value is kept. */
export const TEXT_LOOKUP_SAVE_KEY = "lookup.text.save";

const ON = "on";
const OFF = "off";

/**
 * Whether Save is on when a text lookup starts: the saved value, or the configuration's when
 * none is saved, the stored value is neither "on" nor "off", or the store cannot be read.
 */
export async function readTextLookupSave(
  store: KeyValueStore,
  appConfig: AppConfig = config,
): Promise<boolean> {
  try {
    const stored = await store.getItem(TEXT_LOOKUP_SAVE_KEY);
    if (stored === ON) {
      return true;
    }
    return stored === OFF ? false : appConfig.textLookupSavedAtStart;
  } catch {
    return appConfig.textLookupSavedAtStart;
  }
}

/** Saves the starting value. A value that is not a boolean is not saved; a failed write is reported. */
export async function saveTextLookupSave(
  store: KeyValueStore,
  on: boolean,
): Promise<{ readonly ok: boolean }> {
  if (typeof on !== "boolean") {
    return { ok: false };
  }
  try {
    await store.setItem(TEXT_LOOKUP_SAVE_KEY, on ? ON : OFF);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
