import type { AcceptanceAtStart } from "../disclaimer/acceptance";
import type { KeyValueStore } from "../storage/keyValueStore";
import type { HistoryEntry } from "./entries";
import { HISTORY_SEEN_VERSION_KEY, type SeenVersion } from "./seenVersion";
import { parseVersion } from "./version";
import { decideWhatOpens, startHistory } from "./whatOpens";

function entry(version: string): HistoryEntry {
  return {
    version,
    date: "2026-11-16",
    lines: { sv: [`nytt i ${version}`], en: [`new in ${version}`], it: [`novità di ${version}`] },
  };
}

/** A list as the app builds it: newest first, with the build's version, 0.3.0, first. */
const LIST = [entry("0.3.0"), entry("0.2.1"), entry("0.2.0"), entry("0.1.0")];
const V = "0.3.0";

const MISSING: SeenVersion = { kind: "missing" };
const UNREADABLE: SeenVersion = { kind: "unreadable" };
const NOT_A_VERSION: SeenVersion = { kind: "notVersion" };

function seen(text: string): SeenVersion {
  const version = parseVersion(text);
  if (version === null) {
    throw new Error(`${text} is not a version`);
  }
  return { kind: "version", version };
}

function versions(entries: readonly HistoryEntry[] | null): string[] | null {
  return entries === null ? null : entries.map((each) => each.version);
}

/** The decision at a start, by default one on the Library with the acceptance already stored. */
function decide(
  stored: SeenVersion,
  options: {
    acceptance?: AcceptanceAtStart;
    onLibrary?: boolean;
    buildVersion?: string;
    entries?: readonly HistoryEntry[];
  } = {},
) {
  const decision = decideWhatOpens({
    seen: stored,
    buildVersion: options.buildVersion ?? V,
    entries: options.entries ?? LIST,
    acceptance: options.acceptance ?? "read",
    onLibrary: options.onLibrary ?? true,
  });
  return { opens: versions(decision.opens), writes: decision.writes };
}

const BOTH_ACCEPTANCES = ["read", "given"] as const;

describe("what opens by itself (SPEC 3.10, item 7)", () => {
  describe("with no stored version, and the disclaimer accepted at this start: the phone is new to the app", () => {
    it("opens nothing and writes the build's version, at a start on the Library", () => {
      expect(decide(MISSING, { acceptance: "given" })).toEqual({ opens: null, writes: true });
    });

    it("writes the build's version also at a start not on the Library, where nothing opens", () => {
      expect(decide(MISSING, { acceptance: "given", onLibrary: false })).toEqual({
        opens: null,
        writes: true,
      });
    });
  });

  describe("with no stored version, and the acceptance already stored: the phone has had the app before", () => {
    it("opens the entry of the build's version alone, and writes the version, at a start on the Library", () => {
      expect(decide(MISSING)).toEqual({ opens: ["0.3.0"], writes: true });
    });

    it("opens that entry alone whatever older or newer entries the list holds", () => {
      const list = [entry("0.4.0"), ...LIST];
      expect(decide(MISSING, { entries: list })).toEqual({ opens: ["0.3.0"], writes: true });
    });

    it("opens and writes nothing at a start not on the Library", () => {
      expect(decide(MISSING, { onLibrary: false })).toEqual({ opens: null, writes: false });
    });

    it("opens nothing, and writes the version, when the list has no entry of the build's version (a case of the function only)", () => {
      const list = [entry("0.2.1"), entry("0.2.0")];
      expect(decide(MISSING, { entries: list })).toEqual({ opens: null, writes: true });
    });
  });

  describe.each(BOTH_ACCEPTANCES)("with the acceptance %s at this start", (acceptance) => {
    it("opens nothing and writes the build's version when the stored text is not a version", () => {
      expect(decide(NOT_A_VERSION, { acceptance })).toEqual({ opens: null, writes: true });
    });

    it("opens nothing and still writes the build's version when reading it failed", () => {
      expect(decide(UNREADABLE, { acceptance })).toEqual({ opens: null, writes: true });
    });

    it("opens nothing and writes nothing when the stored version is the build's", () => {
      expect(decide(seen("0.3.0"), { acceptance })).toEqual({ opens: null, writes: false });
    });

    it("opens nothing and writes the build's version when the stored version is higher: an older build than the phone saw last", () => {
      expect(decide(seen("0.3.1"), { acceptance })).toEqual({ opens: null, writes: true });
      expect(decide(seen("0.10.0"), { acceptance })).toEqual({ opens: null, writes: true });
      expect(decide(seen("1.0.0"), { acceptance })).toEqual({ opens: null, writes: true });
    });

    it("opens the one entry between a lower stored version and the build's, and writes the version", () => {
      expect(decide(seen("0.2.1"), { acceptance })).toEqual({ opens: ["0.3.0"], writes: true });
    });

    it("opens the entries of every version an upgrade skipped, newest first, with no limit to their number", () => {
      expect(decide(seen("0.1.0"), { acceptance })).toEqual({
        opens: ["0.3.0", "0.2.1", "0.2.0"],
        writes: true,
      });
      expect(decide(seen("0.0.1"), { acceptance })).toEqual({
        opens: ["0.3.0", "0.2.1", "0.2.0", "0.1.0"],
        writes: true,
      });
    });

    it("leaves out the entry of the stored version itself, and keeps the build's", () => {
      expect(decide(seen("0.2.0"), { acceptance })).toEqual({
        opens: ["0.3.0", "0.2.1"],
        writes: true,
      });
    });

    it("counts a stored version that has no entry of its own", () => {
      expect(decide(seen("0.2.5"), { acceptance })).toEqual({ opens: ["0.3.0"], writes: true });
      expect(decide(seen("0.1.5"), { acceptance })).toEqual({
        opens: ["0.3.0", "0.2.1", "0.2.0"],
        writes: true,
      });
    });

    it("leaves out the entries of versions higher than the build's", () => {
      const list = [entry("1.0.0"), entry("0.4.0"), ...LIST];
      expect(decide(seen("0.2.1"), { acceptance, entries: list })).toEqual({
        opens: ["0.3.0"],
        writes: true,
      });
    });

    it("gives the entries newest first also from a list in another order", () => {
      const list = [entry("0.2.0"), entry("0.10.0"), entry("0.3.0"), entry("0.9.0")];
      expect(decide(seen("0.1.0"), { acceptance, buildVersion: "0.10.0", entries: list })).toEqual({
        opens: ["0.10.0", "0.9.0", "0.3.0", "0.2.0"],
        writes: true,
      });
    });

    it("opens nothing, and writes the version, with no entry between (a case of the function only)", () => {
      const list = [entry("0.2.0"), entry("0.1.0")];
      expect(decide(seen("0.2.0"), { acceptance, entries: list })).toEqual({
        opens: null,
        writes: true,
      });
      expect(decide(seen("0.2.1"), { acceptance, entries: [] })).toEqual({
        opens: null,
        writes: true,
      });
    });

    it("passes over an entry whose version is not a version (a case of the function only)", () => {
      const list = [entry("0.3.0"), entry("v0.2.5"), entry("0.2.1")];
      expect(decide(seen("0.2.0"), { acceptance, entries: list })).toEqual({
        opens: ["0.3.0", "0.2.1"],
        writes: true,
      });
    });

    it("gives the entries themselves, as the list holds them", () => {
      const decision = decideWhatOpens({
        seen: seen("0.2.1"),
        buildVersion: V,
        entries: LIST,
        acceptance,
        onLibrary: true,
      });
      expect(decision.opens).toEqual([LIST[0]]);
      expect(decision.opens?.[0]).toBe(LIST[0]);
    });

    it.each([
      ["no stored version", MISSING],
      ["a stored text that is not a version", NOT_A_VERSION],
      ["a failed read", UNREADABLE],
      ["the build's version stored", seen("0.3.0")],
      ["a higher version stored", seen("0.3.1")],
      ["a lower version stored", seen("0.2.0")],
    ])(
      "opens nothing and writes nothing when the build's version is not a version, with %s",
      (_what, stored) => {
        for (const buildVersion of ["", "v0.3.0", "0.3", "0.3.0-beta", "03.0.0"]) {
          for (const onLibrary of [true, false]) {
            expect(decide(stored, { acceptance, buildVersion, onLibrary })).toEqual({
              opens: null,
              writes: false,
            });
          }
        }
      },
    );
  });

  describe("at a start whose first screen is not the Library (item 8)", () => {
    it.each([
      ["a lower version stored", seen("0.2.0")],
      ["a higher version stored", seen("0.3.1")],
      ["the build's version stored", seen("0.3.0")],
      ["a stored text that is not a version", NOT_A_VERSION],
      ["a failed read", UNREADABLE],
    ])(
      "opens nothing and writes nothing with %s, whether the acceptance was read or given",
      (_what, stored) => {
        for (const acceptance of BOTH_ACCEPTANCES) {
          expect(decide(stored, { acceptance, onLibrary: false })).toEqual({
            opens: null,
            writes: false,
          });
        }
      },
    );
  });
});

function memoryStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const store = {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
  };
  return store satisfies KeyValueStore;
}

/** The start, by default one on the Library with the acceptance already stored. */
async function start(
  store: KeyValueStore,
  options: { acceptance?: AcceptanceAtStart; onLibrary?: boolean; buildVersion?: string } = {},
) {
  const started = await startHistory({
    store,
    buildVersion: options.buildVersion ?? V,
    entries: LIST,
    acceptance: options.acceptance ?? "read",
    onLibrary: options.onLibrary ?? true,
  });
  return { opens: versions(started.opens), written: started.written };
}

describe("the start, with the store (SPEC 3.10, items 6 to 8)", () => {
  it("reads the stored version, opens what is new since it, and writes the build's version", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
    const started = await start(store);
    expect(started.opens).toEqual(["0.3.0", "0.2.1"]);
    await expect(started.written).resolves.toBe(true);
    expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe("0.3.0");
  });

  it("opens a version's news once: the next start reads back what this one wrote, and opens nothing", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
    await (await start(store)).written;
    store.setItem.mockClear();
    const next = await start(store);
    expect(next.opens).toBeNull();
    await expect(next.written).resolves.toBe(false);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it("writes nothing when the stored version is the build's", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.3.0" });
    const started = await start(store);
    expect(started.opens).toBeNull();
    await expect(started.written).resolves.toBe(false);
    expect(store.setItem).not.toHaveBeenCalled();
  });

  it("opens nothing and still tries the write when the read fails", async () => {
    const store = memoryStore();
    store.getItem.mockRejectedValue(new Error("storage unavailable"));
    const started = await start(store);
    expect(started.opens).toBeNull();
    await expect(started.written).resolves.toBe(true);
    expect(store.setItem.mock.calls).toEqual([[HISTORY_SEEN_VERSION_KEY, "0.3.0"]]);
  });

  it("still gives the decision when the write fails, and opens the same again at the next start", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.1" });
    store.setItem.mockRejectedValue(new Error("disk full"));
    const started = await start(store);
    expect(started.opens).toEqual(["0.3.0"]);
    await expect(started.written).resolves.toBe(false);
    expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe("0.2.1");
    expect((await start(store)).opens).toEqual(["0.3.0"]);
  });

  it("gives the decision when the read is done, without waiting for the write", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.1" });
    store.setItem.mockReturnValue(new Promise<void>(() => undefined));
    const started = await start(store);
    expect(started.opens).toEqual(["0.3.0"]);
    expect(store.setItem).toHaveBeenCalledTimes(1);
  });

  it("writes the build's version over a stored text that is not a version, and opens nothing", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "v0.2.0" });
    const started = await start(store);
    expect(started.opens).toBeNull();
    await started.written;
    expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe("0.3.0");
  });

  it("writes the build's version over a higher stored one, and opens nothing", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.4.0" });
    const started = await start(store);
    expect(started.opens).toBeNull();
    await started.written;
    expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe("0.3.0");
  });

  describe("on a phone new to the app: the disclaimer accepted at this start, no stored version", () => {
    it.each([true, false])(
      "writes the build's version and opens nothing, on the Library: %p",
      async (onLibrary) => {
        const store = memoryStore();
        const started = await start(store, { acceptance: "given", onLibrary });
        expect(started.opens).toBeNull();
        await expect(started.written).resolves.toBe(true);
        expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe("0.3.0");
      },
    );
  });

  describe("on a phone that has had the app before: the acceptance already stored, no stored version", () => {
    it("opens the entry of the build's version alone and writes the version, at a start on the Library", async () => {
      const store = memoryStore({ "disclaimer.accepted": "accepted" });
      const started = await start(store);
      expect(started.opens).toEqual(["0.3.0"]);
      await started.written;
      expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe("0.3.0");
    });

    it("reads nothing, opens nothing and writes nothing at a start not on the Library", async () => {
      const store = memoryStore({ "disclaimer.accepted": "accepted" });
      const started = await start(store, { onLibrary: false });
      expect(started.opens).toBeNull();
      await expect(started.written).resolves.toBe(false);
      expect(store.getItem).not.toHaveBeenCalled();
      expect(store.setItem).not.toHaveBeenCalled();
    });
  });

  describe("at a start not on the Library, with a lower version stored (item 8)", () => {
    it.each(BOTH_ACCEPTANCES)(
      "opens nothing and writes nothing, the acceptance %s",
      async (acceptance) => {
        const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
        const started = await start(store, { acceptance, onLibrary: false });
        expect(started.opens).toBeNull();
        await expect(started.written).resolves.toBe(false);
        expect(store.setItem).not.toHaveBeenCalled();
        expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe("0.2.0");
      },
    );

    it("leaves the decision to the next start on the Library, which opens the screen", async () => {
      const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
      await (await start(store, { onLibrary: false })).written;
      expect((await start(store)).opens).toEqual(["0.3.0", "0.2.1"]);
    });

    it("writes nothing when the read fails, also with the disclaimer accepted at this start: only a missing version is the new phone's", async () => {
      const store = memoryStore();
      store.getItem.mockRejectedValue(new Error("storage unavailable"));
      const started = await start(store, { acceptance: "given", onLibrary: false });
      expect(started.opens).toBeNull();
      await expect(started.written).resolves.toBe(false);
      expect(store.setItem).not.toHaveBeenCalled();
    });
  });

  describe("with a build's version that is not a version (a case of the function only)", () => {
    it.each(BOTH_ACCEPTANCES)(
      "reads nothing, opens nothing and writes nothing, the acceptance %s",
      async (acceptance) => {
        for (const onLibrary of [true, false]) {
          const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
          const started = await start(store, { acceptance, onLibrary, buildVersion: "v0.3.0" });
          expect(started.opens).toBeNull();
          await expect(started.written).resolves.toBe(false);
          expect(store.getItem).not.toHaveBeenCalled();
          expect(store.setItem).not.toHaveBeenCalled();
        }
      },
    );
  });
});
