import type { KeyValueStore } from "../storage/keyValueStore";
import { LANGUAGE_CHOICE_KEY, readLanguageChoice, saveLanguageChoice } from "./languageChoice";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  values: Map<string, string>;
} {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
  };
}

const failingStore: KeyValueStore = {
  getItem: async () => {
    throw new Error("storage unavailable");
  },
  setItem: async () => {
    throw new Error("disk full");
  },
};

describe("readLanguageChoice", () => {
  it("gives no choice when none was saved", async () => {
    await expect(readLanguageChoice(memoryStore())).resolves.toBeNull();
  });

  it.each(["sv", "en", "it"] as const)("gives the saved choice %s", async (language) => {
    const store = memoryStore({ [LANGUAGE_CHOICE_KEY]: language });
    await expect(readLanguageChoice(store)).resolves.toBe(language);
  });

  it.each(["de", "", "SV", "sv-SE"])(
    "gives no choice for a stored value %p that is not one of the app's languages",
    async (value) => {
      const store = memoryStore({ [LANGUAGE_CHOICE_KEY]: value });
      await expect(readLanguageChoice(store)).resolves.toBeNull();
    },
  );

  it("gives no choice when reading the store fails", async () => {
    await expect(readLanguageChoice(failingStore)).resolves.toBeNull();
  });
});

describe("saveLanguageChoice", () => {
  it("saves the choice and reports success", async () => {
    const store = memoryStore();
    await expect(saveLanguageChoice(store, "it")).resolves.toEqual({ ok: true });
    expect(store.values.get(LANGUAGE_CHOICE_KEY)).toBe("it");
  });

  it("reports a failed write, and does not throw", async () => {
    await expect(saveLanguageChoice(failingStore, "it")).resolves.toEqual({ ok: false });
  });
});
