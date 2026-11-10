import { type AppConfig, config } from "../config/config";
import type { KeyValueStore } from "../storage/keyValueStore";
import {
  PHOTO_LOOKUP_SAVE_KEY,
  readPhotoLookupSave,
  readTextLookupSave,
  savePhotoLookupSave,
  saveTextLookupSave,
  TEXT_LOOKUP_SAVE_KEY,
} from "./saveSetting";

/** A key-value store in memory, whose reads and writes can be made to fail. */
function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store = {
    values,
    readError: null as Error | null,
    writeError: null as Error | null,
    async getItem(key: string): Promise<string | null> {
      if (store.readError !== null) {
        throw store.readError;
      }
      return values.get(key) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      if (store.writeError !== null) {
        throw store.writeError;
      }
      values.set(key, value);
    },
  };
  return store satisfies KeyValueStore;
}

describe("the starting value of a text lookup's Save switch (SPEC 3.9, Lookups)", () => {
  it("is off until the user changes it, as the configuration has it", async () => {
    expect(config.textLookupSavedAtStart).toBe(false);
    await expect(readTextLookupSave(memoryStore())).resolves.toBe(false);
  });

  it("follows the configuration's starting value while none is saved", async () => {
    const appConfig: AppConfig = { ...config, textLookupSavedAtStart: true };
    await expect(readTextLookupSave(memoryStore(), appConfig)).resolves.toBe(true);
  });

  it.each([
    [true, "on"],
    [false, "off"],
  ] as const)("saves %s as %s, and reads it back", async (on, stored) => {
    const store = memoryStore();
    await expect(saveTextLookupSave(store, on)).resolves.toEqual({ ok: true });
    expect(store.values.get(TEXT_LOOKUP_SAVE_KEY)).toBe(stored);
    await expect(readTextLookupSave(store)).resolves.toBe(on);
  });

  it("reads a saved value over the configuration's", async () => {
    const appConfig: AppConfig = { ...config, textLookupSavedAtStart: true };
    const store = memoryStore({ [TEXT_LOOKUP_SAVE_KEY]: "off" });
    await expect(readTextLookupSave(store, appConfig)).resolves.toBe(false);
  });

  it.each(["yes", "true", "1", "ON", ""])(
    "reads a stored value it does not know (%j) as the configuration's, coercing nothing",
    async (stored) => {
      const store = memoryStore({ [TEXT_LOOKUP_SAVE_KEY]: stored });
      await expect(readTextLookupSave(store)).resolves.toBe(false);
    },
  );

  it("reads the configuration's value when the store cannot be read", async () => {
    const store = memoryStore({ [TEXT_LOOKUP_SAVE_KEY]: "on" });
    store.readError = new Error("storage is gone");
    await expect(readTextLookupSave(store)).resolves.toBe(false);
  });

  it("says so when the value cannot be saved", async () => {
    const store = memoryStore();
    store.writeError = new Error("storage is full");
    await expect(saveTextLookupSave(store, true)).resolves.toEqual({ ok: false });
    expect(store.values.size).toBe(0);
  });

  it("refuses a value that is not true or false, saving nothing", async () => {
    const store = memoryStore();
    await expect(saveTextLookupSave(store, "on" as unknown as boolean)).resolves.toEqual({
      ok: false,
    });
    expect(store.values.size).toBe(0);
  });
});

describe("the starting value of a photo lookup's Save switch (SPEC 3.9, Lookups; PBI-2.13)", () => {
  it("is on until the user changes it, as the configuration has it", async () => {
    expect(config.photoLookupSavedAtStart).toBe(true);
    await expect(readPhotoLookupSave(memoryStore())).resolves.toBe(true);
  });

  it("is kept under a key of its own, beside the text lookup's, and each is read apart", async () => {
    expect(PHOTO_LOOKUP_SAVE_KEY).not.toBe(TEXT_LOOKUP_SAVE_KEY);
    const store = memoryStore({ [TEXT_LOOKUP_SAVE_KEY]: "on", [PHOTO_LOOKUP_SAVE_KEY]: "off" });
    await expect(readPhotoLookupSave(store)).resolves.toBe(false);
    await expect(readTextLookupSave(store)).resolves.toBe(true);
  });

  it("follows the configuration's starting value while none is saved", async () => {
    const appConfig: AppConfig = { ...config, photoLookupSavedAtStart: false };
    await expect(readPhotoLookupSave(memoryStore(), appConfig)).resolves.toBe(false);
  });

  it.each([
    [true, "on"],
    [false, "off"],
  ] as const)("saves %s as %s, and reads it back, leaving the text lookup's alone", async (on, stored) => {
    const store = memoryStore();
    await expect(savePhotoLookupSave(store, on)).resolves.toEqual({ ok: true });
    expect(store.values.get(PHOTO_LOOKUP_SAVE_KEY)).toBe(stored);
    expect(store.values.has(TEXT_LOOKUP_SAVE_KEY)).toBe(false);
    await expect(readPhotoLookupSave(store)).resolves.toBe(on);
  });

  it.each(["yes", "false", "0", "OFF", ""])(
    "reads a stored value it does not know (%j) as the configuration's, coercing nothing",
    async (stored) => {
      const store = memoryStore({ [PHOTO_LOOKUP_SAVE_KEY]: stored });
      await expect(readPhotoLookupSave(store)).resolves.toBe(true);
    },
  );

  it("reads the configuration's value when the store cannot be read", async () => {
    const store = memoryStore({ [PHOTO_LOOKUP_SAVE_KEY]: "off" });
    store.readError = new Error("storage is gone");
    await expect(readPhotoLookupSave(store)).resolves.toBe(true);
  });

  it("says so when the value cannot be saved", async () => {
    const store = memoryStore();
    store.writeError = new Error("storage is full");
    await expect(savePhotoLookupSave(store, false)).resolves.toEqual({ ok: false });
    expect(store.values.size).toBe(0);
  });

  it("refuses a value that is not true or false, saving nothing", async () => {
    const store = memoryStore();
    await expect(savePhotoLookupSave(store, 0 as unknown as boolean)).resolves.toEqual({
      ok: false,
    });
    expect(store.values.size).toBe(0);
  });
});
