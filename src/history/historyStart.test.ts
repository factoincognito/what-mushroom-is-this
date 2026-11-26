import type { AcceptanceAtStart } from "../disclaimer/acceptance";
import type { KeyValueStore } from "../storage/keyValueStore";
import type { HistoryEntry } from "./entries";
import { HistoryStart, LIBRARY_ROUTE_NAME, type StackScreen } from "./historyStart";
import { HISTORY_SEEN_VERSION_KEY } from "./seenVersion";

function entry(version: string): HistoryEntry {
  return {
    version,
    date: "2026-11-16",
    lines: { sv: ["rad"], en: ["line"], it: ["riga"] },
  };
}

const LIST = [entry("0.3.0"), entry("0.2.1"), entry("0.2.0")];
const V = "0.3.0";

const LIBRARY: StackScreen = { key: "index-1", name: "index" };
const SETTINGS: StackScreen = { key: "settings-1", name: "settings" };
const SHARE: StackScreen = { key: "share-1", name: "share" };
const HISTORY_SCREEN: StackScreen = { key: "history-1", name: "history" };

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

/** A start of the app's process, by default with the acceptance already stored. */
function newStart(
  store: KeyValueStore,
  options: { acceptance?: AcceptanceAtStart; processStarted?: boolean } = {},
) {
  const openHistory = jest.fn();
  const takeAppStart = jest.fn(() => options.processStarted ?? true);
  const start = new HistoryStart({
    store,
    buildVersion: V,
    entries: LIST,
    acceptance: options.acceptance ?? "read",
    takeAppStart,
    openHistory,
  });
  return { start, openHistory, takeAppStart };
}

/** Lets the start's read and what follows it finish. */
async function settled(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

const versions = (entries: readonly HistoryEntry[] | null) =>
  entries === null ? null : entries.map((each) => each.version);

describe("the start of the app, as the version history sees it (SPEC 3.10, items 7 and 8)", () => {
  it("names the Library's route as the stack does: the file src/app/index.tsx", () => {
    expect(LIBRARY_ROUTE_NAME).toBe("index");
  });

  describe("at a start whose first screen is the Library", () => {
    it("holds the Library back until the version last seen is read, then opens the history over it", async () => {
      const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
      let finishRead: (value: string | null) => void = () => undefined;
      store.getItem.mockReturnValue(
        new Promise<string | null>((resolve) => {
          finishRead = resolve;
        }),
      );
      const { start, openHistory } = newStart(store);
      expect(start.screenShown(LIBRARY, LIBRARY)).toBe(true);
      expect(start.isReading()).toBe(true);
      start.begin();
      await settled();
      expect(start.isReading()).toBe(true);
      expect(openHistory).not.toHaveBeenCalled();

      finishRead("0.2.0");
      await settled();
      expect(start.isReading()).toBe(false);
      expect(openHistory).toHaveBeenCalledTimes(1);
      expect(versions(start.takeWhatsNew())).toEqual(["0.3.0", "0.2.1"]);
      expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe("0.3.0");
    });

    it("tells who listens when the read is finished, and the Library is no longer held back then", async () => {
      const { start } = newStart(memoryStore({ [HISTORY_SEEN_VERSION_KEY]: V }));
      const heard: boolean[] = [];
      start.subscribe(() => heard.push(start.isReading()));
      start.screenShown(LIBRARY, LIBRARY);
      start.begin();
      expect(heard).toEqual([]);
      await settled();
      expect(heard).toEqual([false]);
    });

    it("no longer tells one who stopped listening", async () => {
      const { start } = newStart(memoryStore({ [HISTORY_SEEN_VERSION_KEY]: V }));
      const listener = jest.fn();
      const stop = start.subscribe(listener);
      stop();
      start.screenShown(LIBRARY, LIBRARY);
      start.begin();
      await settled();
      expect(listener).not.toHaveBeenCalled();
    });

    it("shows the Library and opens nothing when the version last seen is the build's", async () => {
      const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: V });
      const { start, openHistory } = newStart(store);
      start.screenShown(LIBRARY, LIBRARY);
      start.begin();
      await settled();
      expect(start.isReading()).toBe(false);
      expect(openHistory).not.toHaveBeenCalled();
      expect(start.takeWhatsNew()).toBeNull();
      expect(store.setItem).not.toHaveBeenCalled();
    });

    it("gives the decision's entries once, to the screen that asks first, and none after", async () => {
      const { start } = newStart(memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.1" }));
      start.screenShown(LIBRARY, LIBRARY);
      start.begin();
      await settled();
      expect(versions(start.takeWhatsNew())).toEqual(["0.3.0"]);
      expect(start.takeWhatsNew()).toBeNull();
      expect(start.takeWhatsNew()).toBeNull();
    });

    it("gives no entries before the decision is made", () => {
      const { start } = newStart(memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.1" }));
      start.screenShown(LIBRARY, LIBRARY);
      expect(start.takeWhatsNew()).toBeNull();
    });

    it("does not hold back a screen that is not the Library the start opens on", async () => {
      const { start } = newStart(memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.1" }));
      expect(start.screenShown(LIBRARY, LIBRARY)).toBe(true);
      expect(start.screenShown(SETTINGS, SETTINGS)).toBe(false);
      expect(start.screenShown(HISTORY_SCREEN, HISTORY_SCREEN)).toBe(false);
      // A second Library screen, opened later, is not the one the start opened on.
      expect(start.screenShown({ key: "index-2", name: "index" }, LIBRARY)).toBe(false);
    });

    it("decides once, however often it is asked to begin: one read, one write, one opening", async () => {
      const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.1" });
      const { start, openHistory } = newStart(store);
      start.screenShown(LIBRARY, LIBRARY);
      start.begin();
      start.begin();
      await settled();
      start.begin();
      await settled();
      expect(store.getItem).toHaveBeenCalledTimes(1);
      expect(store.setItem.mock.calls).toEqual([[HISTORY_SEEN_VERSION_KEY, V]]);
      expect(openHistory).toHaveBeenCalledTimes(1);
    });

    it("leaves the user on the Library, with nothing kept for a later screen, when the history cannot be opened", async () => {
      const { start, openHistory } = newStart(memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.1" }));
      openHistory.mockImplementation(() => {
        throw new Error("the stack is not ready");
      });
      start.screenShown(LIBRARY, LIBRARY);
      start.begin();
      await settled();
      expect(openHistory).toHaveBeenCalledTimes(1);
      expect(start.isReading()).toBe(false);
      expect(start.takeWhatsNew()).toBeNull();
    });

    it("shows the Library and still tries the write when the read fails", async () => {
      const store = memoryStore();
      store.getItem.mockRejectedValue(new Error("storage unavailable"));
      const { start, openHistory } = newStart(store);
      start.screenShown(LIBRARY, LIBRARY);
      start.begin();
      await settled();
      expect(start.isReading()).toBe(false);
      expect(openHistory).not.toHaveBeenCalled();
      expect(store.setItem.mock.calls).toEqual([[HISTORY_SEEN_VERSION_KEY, V]]);
    });

    it("opens the history all the same when the write fails", async () => {
      const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.1" });
      store.setItem.mockRejectedValue(new Error("disk full"));
      const { start, openHistory } = newStart(store);
      start.screenShown(LIBRARY, LIBRARY);
      start.begin();
      await settled();
      expect(openHistory).toHaveBeenCalledTimes(1);
      expect(versions(start.takeWhatsNew())).toEqual(["0.3.0"]);
    });

    it("opens the history only once the Library is no longer held back, so that it lies over the Library", async () => {
      const { start, openHistory } = newStart(memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.1" }));
      const readingWhenOpened: boolean[] = [];
      openHistory.mockImplementation(() => readingWhenOpened.push(start.isReading()));
      start.screenShown(LIBRARY, LIBRARY);
      start.begin();
      await settled();
      expect(readingWhenOpened).toEqual([false]);
    });
  });

  describe("at a start whose first screen is not the Library", () => {
    it.each([
      ["a share's choice", SHARE],
      ["Settings", SETTINGS],
      ["the history itself", HISTORY_SCREEN],
      ["a screen for an address that matches no route", { key: "x", name: "+not-found" }],
    ])(
      "holds nothing back, reads nothing, opens nothing and writes nothing, on %s",
      async (_what, first) => {
        const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
        const { start, openHistory } = newStart(store);
        expect(start.screenShown(first, first)).toBe(false);
        expect(start.isReading()).toBe(false);
        start.begin();
        await settled();
        expect(store.getItem).not.toHaveBeenCalled();
        expect(store.setItem).not.toHaveBeenCalled();
        expect(openHistory).not.toHaveBeenCalled();
        expect(start.takeWhatsNew()).toBeNull();
      },
    );

    it("takes the first screen from what the stack shows, not from the screen laid out first", async () => {
      // The stack holds the Library under Settings and shows Settings; the Library is laid out first.
      const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
      const { start, openHistory } = newStart(store);
      expect(start.screenShown(LIBRARY, SETTINGS)).toBe(false);
      expect(start.screenShown(SETTINGS, SETTINGS)).toBe(false);
      start.begin();
      await settled();
      expect(store.getItem).not.toHaveBeenCalled();
      expect(openHistory).not.toHaveBeenCalled();
    });

    it("makes no decision either when the Library is shown later in the same run", async () => {
      const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
      const { start, openHistory } = newStart(store);
      start.screenShown(SETTINGS, SETTINGS);
      start.begin();
      await settled();
      expect(start.screenShown(LIBRARY, LIBRARY)).toBe(false);
      start.begin();
      await settled();
      expect(store.getItem).not.toHaveBeenCalled();
      expect(openHistory).not.toHaveBeenCalled();
    });

    it("writes the build's version on a phone new to the app: the disclaimer accepted at this start, no version stored", async () => {
      const store = memoryStore();
      const { start, openHistory } = newStart(store, { acceptance: "given" });
      expect(start.screenShown(SHARE, SHARE)).toBe(false);
      start.begin();
      await settled();
      expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe(V);
      expect(openHistory).not.toHaveBeenCalled();
    });

    it("takes the start of the app's process all the same", () => {
      const { start, takeAppStart } = newStart(memoryStore());
      start.screenShown(SHARE, SHARE);
      expect(takeAppStart).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the app's screens are shown anew while its process lives, which is no start", () => {
    it("holds nothing back and makes no decision on the Library", async () => {
      const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
      const { start, openHistory } = newStart(store, { processStarted: false });
      expect(start.screenShown(LIBRARY, LIBRARY)).toBe(false);
      expect(start.isReading()).toBe(false);
      start.begin();
      await settled();
      expect(store.getItem).not.toHaveBeenCalled();
      expect(store.setItem).not.toHaveBeenCalled();
      expect(openHistory).not.toHaveBeenCalled();
    });
  });

  it("asks for the start of the app's process once, when the first screen is shown", () => {
    const { start, takeAppStart } = newStart(memoryStore());
    expect(takeAppStart).not.toHaveBeenCalled();
    start.screenShown(LIBRARY, LIBRARY);
    start.screenShown(LIBRARY, LIBRARY);
    start.screenShown(SETTINGS, SETTINGS);
    expect(takeAppStart).toHaveBeenCalledTimes(1);
  });

  it("does not begin before a screen is shown: where the start opens is not known yet", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
    const { start, openHistory } = newStart(store);
    start.begin();
    await settled();
    expect(store.getItem).not.toHaveBeenCalled();
    start.screenShown(LIBRARY, LIBRARY);
    start.begin();
    await settled();
    expect(openHistory).toHaveBeenCalledTimes(1);
  });

  it("opens nothing and tells nobody when the screens are gone before the read is finished, and still writes the version", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
    const { start, openHistory } = newStart(store);
    const listener = jest.fn();
    start.subscribe(listener);
    start.screenShown(LIBRARY, LIBRARY);
    start.begin();
    start.setShown(false);
    await settled();
    expect(openHistory).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    expect(start.takeWhatsNew()).toBeNull();
    expect(store.values.get(HISTORY_SEEN_VERSION_KEY)).toBe(V);
  });

  it("goes on when the screens are back before the read is finished", async () => {
    const store = memoryStore({ [HISTORY_SEEN_VERSION_KEY]: "0.2.0" });
    const { start, openHistory } = newStart(store);
    start.screenShown(LIBRARY, LIBRARY);
    start.begin();
    start.setShown(false);
    start.setShown(true);
    await settled();
    expect(start.isReading()).toBe(false);
    expect(openHistory).toHaveBeenCalledTimes(1);
  });
});
