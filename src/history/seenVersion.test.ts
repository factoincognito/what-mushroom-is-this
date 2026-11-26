import type { KeyValueStore } from "../storage/keyValueStore";
import { HISTORY_SEEN_VERSION_KEY, readSeenVersion, writeSeenVersion } from "./seenVersion";

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

/** A store that gives a value the type does not allow, as a damaged or foreign store could. */
function storeGiving(value: unknown): KeyValueStore {
  return {
    getItem: async () => value as string | null,
    setItem: async () => undefined,
  };
}

describe("the version last seen (SPEC 3.10, item 6)", () => {
  it("is kept under a key of its own, history.seen-version", () => {
    expect(HISTORY_SEEN_VERSION_KEY).toBe("history.seen-version");
  });

  it("is missing when the store holds nothing under the key", async () => {
    await expect(readSeenVersion(memoryStore())).resolves.toEqual({ kind: "missing" });
  });

  it("is missing whatever the store's other keys hold", async () => {
    const store = memoryStore({ "disclaimer.accepted": "accepted", "language.chosen": "0.2.0" });
    await expect(readSeenVersion(store)).resolves.toEqual({ kind: "missing" });
  });

  it("is read from its own key only", async () => {
    const getItem = jest.fn(async () => null);
    await readSeenVersion({ getItem, setItem: async () => undefined });
    expect(getItem.mock.calls).toEqual([["history.seen-version"]]);
  });

  it("is the stored text, read as a version", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
    await expect(readSeenVersion(store)).resolves.toEqual({
      kind: "version",
      version: { major: "0", minor: "2", patch: "0" },
    });
  });

  it.each([
    "",
    " ",
    "v0.2.0",
    "0.2",
    "0.2.0 ",
    "0.2.0\n",
    "00.2.0",
    "0.2.0-beta",
    "0.2.0+1",
    "accepted",
    "null",
    '"0.2.0"',
  ])("is not a version when the stored text is %p", async (text) => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: text });
    await expect(readSeenVersion(store)).resolves.toEqual({ kind: "notVersion" });
  });

  it.each([
    ["a number", 21],
    ["an object", { version: "0.2.0" }],
    ["a list", ["0.2.0"]],
    ["true", true],
    ["nothing at all", undefined],
  ])(
    "is not a version when the store gives %s, without reading it as a text",
    async (_what, value) => {
      await expect(readSeenVersion(storeGiving(value))).resolves.toEqual({ kind: "notVersion" });
    },
  );

  it("is unreadable when the read fails, and the failure is not thrown", async () => {
    const store: KeyValueStore = {
      getItem: async () => {
        throw new Error("storage unavailable");
      },
      setItem: async () => undefined,
    };
    await expect(readSeenVersion(store)).resolves.toEqual({ kind: "unreadable" });
  });

  it("is unreadable when the store throws at once", async () => {
    const store: KeyValueStore = {
      getItem: () => {
        throw new Error("no storage");
      },
      setItem: async () => undefined,
    };
    await expect(readSeenVersion(store)).resolves.toEqual({ kind: "unreadable" });
  });

  it("is written as the version's text, under its key and no other", async () => {
    const store = memoryStore({ "disclaimer.accepted": "accepted" });
    await expect(writeSeenVersion(store, "0.2.1")).resolves.toEqual({ ok: true });
    expect([...store.values]).toEqual([
      ["disclaimer.accepted", "accepted"],
      ["history.seen-version", "0.2.1"],
    ]);
  });

  it("is read back as written", async () => {
    const store = memoryStore();
    await writeSeenVersion(store, "1.10.0");
    await expect(readSeenVersion(store)).resolves.toEqual({
      kind: "version",
      version: { major: "1", minor: "10", patch: "0" },
    });
  });

  it("replaces an earlier one", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
    await writeSeenVersion(store, "0.2.1");
    expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe("0.2.1");
  });

  it("reports a failed write, and does not throw it", async () => {
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error("disk full");
      },
    };
    await expect(writeSeenVersion(store, "0.2.1")).resolves.toEqual({ ok: false });
  });

  it("reports a write the store refuses at once, and does not throw it", async () => {
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: () => {
        throw new Error("no storage");
      },
    };
    await expect(writeSeenVersion(store, "0.2.1")).resolves.toEqual({ ok: false });
  });

  it.each(["", "v0.2.1", "0.2", "0.2.1-beta", " 0.2.1"])(
    "writes nothing for what is not a version: %p",
    async (text) => {
      const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
      await expect(writeSeenVersion(store, text)).resolves.toEqual({ ok: false });
      expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe("0.2.0");
    },
  );
});
