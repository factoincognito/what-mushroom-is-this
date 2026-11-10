import { type AppConfig, config } from "../config/config";
import type { KeyValueStore } from "../storage/keyValueStore";

/**
 * The starting values of the lookups' "Save" switch (docs/SPEC.md 3.9, Lookups): on for a photo
 * lookup and off for a text lookup unless the user changes them in Settings, each kept in the
 * plain key-value store as "on" or "off" under a key of its own.
 */

/** The store key under which the text lookup's starting value is kept. */
export const TEXT_LOOKUP_SAVE_KEY = "lookup.text.save";

/** The store key under which the photo lookup's starting value is kept (PBI-2.13). */
export const PHOTO_LOOKUP_SAVE_KEY = "lookup.photo.save";

const ON = "on";
const OFF = "off";

/**
 * Whether Save is on when a text lookup starts: the saved value, or the configuration's when
 * none is saved, the stored value is neither "on" nor "off", or the store cannot be read.
 */
export function readTextLookupSave(
  store: KeyValueStore,
  appConfig: AppConfig = config,
): Promise<boolean> {
  return readSave(store, TEXT_LOOKUP_SAVE_KEY, appConfig.textLookupSavedAtStart);
}

/** Saves the text lookup's starting value. A value that is not a boolean is not saved; a failed write is reported. */
export function saveTextLookupSave(
  store: KeyValueStore,
  on: boolean,
): Promise<{ readonly ok: boolean }> {
  return saveSave(store, TEXT_LOOKUP_SAVE_KEY, on);
}

/** Whether Save is on when a photo lookup starts, read as `readTextLookupSave` reads the text lookup's. */
export function readPhotoLookupSave(
  store: KeyValueStore,
  appConfig: AppConfig = config,
): Promise<boolean> {
  return readSave(store, PHOTO_LOOKUP_SAVE_KEY, appConfig.photoLookupSavedAtStart);
}

/** Saves the photo lookup's starting value, as `saveTextLookupSave` saves the text lookup's. */
export function savePhotoLookupSave(
  store: KeyValueStore,
  on: boolean,
): Promise<{ readonly ok: boolean }> {
  return saveSave(store, PHOTO_LOOKUP_SAVE_KEY, on);
}

async function readSave(store: KeyValueStore, key: string, otherwise: boolean): Promise<boolean> {
  try {
    const stored = await store.getItem(key);
    if (stored === ON) {
      return true;
    }
    return stored === OFF ? false : otherwise;
  } catch {
    return otherwise;
  }
}

async function saveSave(
  store: KeyValueStore,
  key: string,
  on: boolean,
): Promise<{ readonly ok: boolean }> {
  if (typeof on !== "boolean") {
    return { ok: false };
  }
  try {
    await store.setItem(key, on ? ON : OFF);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
