import type { KeyValueStore } from "../storage/keyValueStore";
import { config, HIGH_RESOLUTION_TIER, STANDARD_TIER } from "./config";
import {
  checkModelId,
  imageLimitsFor,
  MODEL_SETTING_KEY,
  readModelId,
  saveModelId,
} from "./modelSetting";

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

describe("checkModelId", () => {
  it("accepts a model ID and gives it back", () => {
    expect(checkModelId("claude-sonnet-5-5")).toEqual({ ok: true, id: "claude-sonnet-5-5" });
  });

  it("trims spaces and line breaks around the ID", () => {
    expect(checkModelId("  claude-haiku-5-5\n")).toEqual({ ok: true, id: "claude-haiku-5-5" });
  });

  it.each(["", "   ", "\n\t"])("refuses the empty model ID %p (SPEC 3.3)", (raw) => {
    expect(checkModelId(raw)).toEqual({ ok: false, reason: "empty" });
  });

  it.each(["claude opus", "claude-ö", "claude​-x", "claude\u0000"])(
    "refuses %p, which is not printable ASCII without blanks",
    (raw) => {
      expect(checkModelId(raw)).toEqual({ ok: false, reason: "invalid" });
    },
  );

  it.each([42, null, undefined, {}])("refuses %p, which is not a string", (raw) => {
    expect(checkModelId(raw)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("readModelId", () => {
  it("gives the default model when none is saved", async () => {
    await expect(readModelId(memoryStore())).resolves.toBe(config.defaultModelId);
  });

  it("gives the saved model", async () => {
    const store = memoryStore({ [MODEL_SETTING_KEY]: "claude-haiku-5-5" });
    await expect(readModelId(store)).resolves.toBe("claude-haiku-5-5");
  });

  it("gives a saved model ID that is not in the list, as the setting holds any model ID", async () => {
    const store = memoryStore({ [MODEL_SETTING_KEY]: "claude-future-9" });
    await expect(readModelId(store)).resolves.toBe("claude-future-9");
  });

  it.each(["", "  ", "two words"])(
    "gives the default model for a stored value %p that is not a valid model ID",
    async (value) => {
      const store = memoryStore({ [MODEL_SETTING_KEY]: value });
      await expect(readModelId(store)).resolves.toBe(config.defaultModelId);
    },
  );

  it("gives the default model when the stored value is not a string", async () => {
    const store: KeyValueStore = {
      getItem: async () => 7 as unknown as string,
      setItem: async () => undefined,
    };
    await expect(readModelId(store)).resolves.toBe(config.defaultModelId);
  });

  it("gives the default model when reading the store fails", async () => {
    await expect(readModelId(failingStore)).resolves.toBe(config.defaultModelId);
  });
});

describe("saveModelId", () => {
  it("saves a model ID, trimmed, and gives it back", async () => {
    const store = memoryStore();
    await expect(saveModelId(store, " claude-sonnet-5-5 ")).resolves.toEqual({
      ok: true,
      id: "claude-sonnet-5-5",
    });
    expect(store.values.get(MODEL_SETTING_KEY)).toBe("claude-sonnet-5-5");
  });

  it("does not save an empty model ID, and keeps the one saved before", async () => {
    const store = memoryStore({ [MODEL_SETTING_KEY]: "claude-haiku-5-5" });
    await expect(saveModelId(store, "  ")).resolves.toEqual({ ok: false, reason: "empty" });
    expect(store.values.get(MODEL_SETTING_KEY)).toBe("claude-haiku-5-5");
  });

  it("does not save an invalid model ID", async () => {
    const store = memoryStore();
    await expect(saveModelId(store, "claude opus")).resolves.toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(store.values.has(MODEL_SETTING_KEY)).toBe(false);
  });

  it("reports a failed write, and does not throw", async () => {
    await expect(saveModelId(failingStore, "claude-opus-5-5")).resolves.toEqual({
      ok: false,
      reason: "store-failed",
    });
  });
});

describe("imageLimitsFor", () => {
  it.each(config.models.map((model) => [model.id, model.imageLimits] as const))(
    "gives the listed model %s its own image limits",
    (id, limits) => {
      expect(imageLimitsFor(id)).toBe(limits);
    },
  );

  it("gives the default model the high-resolution tier", () => {
    expect(imageLimitsFor(config.defaultModelId)).toEqual(HIGH_RESOLUTION_TIER);
  });

  it("gives a model ID that is not listed the standard tier", () => {
    expect(imageLimitsFor("claude-future-9")).toEqual(STANDARD_TIER);
  });
});
