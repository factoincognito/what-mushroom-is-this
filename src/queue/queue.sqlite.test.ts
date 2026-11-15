/**
 * The queue over the real find store on a real SQLite (`src/testing/sqliteDatabase.ts`): what the
 * queue does with a waiting find the store cannot read, and how the list shows it (PBI-1.16); and
 * what a failed find's message says after one of its photos is removed, from the failure the queue
 * stores to the sentence the Find screen shows (PBI-2.16).
 */

import type { AnalysisInput } from "../analysis/analyse";
import type { ApiAnswer } from "../analysis/answer";
import { LANGUAGES, type Language } from "../i18n/languages";
import { STRINGS } from "../i18n/strings";
import { createFindStore, type FindStore, type LookupStore } from "../store/findStore";
import {
  type DatabaseSync,
  memoryPhotos,
  memorySqlite,
  sqliteDatabase,
} from "../testing/sqliteDatabase";
import { failureMessage } from "./messages";
import { AnalysisQueue } from "./queue";

const MATCH: ApiAnswer = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};

let sqlite: DatabaseSync;
let store: FindStore & LookupStore;
let calls: AnalysisInput[];
let queue: AnalysisQueue;

beforeEach(async () => {
  sqlite = memorySqlite();
  let photo = 0;
  store = await createFindStore(sqliteDatabase(sqlite), memoryPhotos(), {
    newPhotoName: () => {
      photo += 1;
      return `p${photo}`;
    },
  });
  calls = [];
  queue = new AnalysisQueue(
    {
      findLog: async () => store,
      readKey: async () => ({ ok: true, key: "sk-ant-test" }),
      readModelId: async () => "claude-opus-5-5",
      preparePhoto: async () => ({ ok: true, imageBase64: "AAAA", width: 1, height: 1 }),
      analyse: async (input) => {
        calls.push(input);
        return { ok: true, answer: MATCH };
      },
      now: () => 10_000,
      schedule: () => () => undefined,
      fetchPicture: async () => ({ kind: "none", reason: "no-item" }),
      removePictureCopy: () => undefined,
    },
    { apiAddress: "https://api.anthropic.com", timeLimitMs: 60_000 },
  );
  queue.setInFront(true);
});

afterEach(() => {
  sqlite.close();
});

/**
 * Inserts a waiting find, taken latest, past the CHECKs, as a row the constraints did not guard
 * (a damaged file, say); gives its ID.
 */
function insertPastChecks(columns: string, values: string, ...params: unknown[]): number {
  sqlite.exec("PRAGMA ignore_check_constraints = ON");
  try {
    const { lastInsertRowid } = sqlite
      .prepare(
        `INSERT INTO finds (photos, batches, batch_open, state, ${columns})
          VALUES ('[{"file":"unreadable.jpg","batch":1}]', 1, 0, 'waiting', ${values})`,
      )
      .run(...params);
    return Number(lastInsertRowid);
  } finally {
    sqlite.exec("PRAGMA ignore_check_constraints = OFF");
  }
}

/** The kinds of waiting row the store cannot read. */
const KINDS: [string, () => number][] = [
  [
    "a time source the store does not know",
    () => insertPastChecks("taken_at_ms, utc_offset_min, time_source", "9000000, 0, 'gps'"),
  ],
  [
    "a position source the store does not know (Clead's review of #26, fix 1)",
    () =>
      insertPastChecks(
        "taken_at_ms, utc_offset_min, time_source, latitude, longitude, position_source",
        "9000000, 0, 'saved', 1, 2, 'gps'",
      ),
  ],
  [
    "a time taken past 2^53 (Clead's review of #26, decision 3)",
    () =>
      insertPastChecks("taken_at_ms, utc_offset_min, time_source", "?, 0, 'saved'", 2n ** 53n + 1n),
  ],
  [
    "a UTC offset past 2^53 (Clead's round 2 of #26, item 2)",
    () =>
      insertPastChecks(
        "taken_at_ms, utc_offset_min, time_source",
        "9000000, ?, 'saved'",
        2n ** 53n + 1n,
      ),
  ],
];

/** A queue over the store whose photos load, or not, as `loads` says of each photo's address. */
function queueWhere(loads: (photoUri: string) => boolean): AnalysisQueue {
  return new AnalysisQueue(
    {
      findLog: async () => store,
      readKey: async () => ({ ok: true, key: "sk-ant-test" }),
      readModelId: async () => "claude-opus-5-5",
      preparePhoto: async (photoUri) =>
        loads(photoUri)
          ? { ok: true, imageBase64: "AAAA", width: 1, height: 1 }
          : { ok: false, loaded: false, failure: { cause: "photo", detail: "load-failed" } },
      analyse: async (input) => {
        calls.push(input);
        return { ok: true, answer: MATCH };
      },
      now: () => 10_000,
      schedule: () => () => undefined,
      fetchPicture: async () => ({ kind: "none", reason: "no-item" }),
      removePictureCopy: () => undefined,
    },
    { apiAddress: "https://api.anthropic.com", timeLimitMs: 60_000 },
  );
}

function stateOf(id: number): unknown {
  return sqlite.prepare("SELECT state FROM finds WHERE id = ?").get(id);
}

const takenAt = { utcOffsetMinutes: 60, source: "saved" } as const;

describe.each(KINDS)("a waiting find with %s (PBI-1.16)", (_kind, insertUnreadableWaiting) => {
  it("is passed over: the run analyses the finds after it and is not stopped, and it stays waiting", async () => {
    const unreadable = insertUnreadableWaiting();
    const first = await store.add({
      photoUri: "file:///cache/a.jpg",
      time: { takenAtMs: 1_000, ...takenAt },
      position: null,
    });
    const second = await store.add({
      photoUri: "file:///cache/b.jpg",
      time: { takenAtMs: 2_000, ...takenAt },
      position: null,
    });
    expect(unreadable).toBeLessThan(first);

    await queue.trigger();

    expect(calls).toHaveLength(2);
    await expect(store.get(first)).resolves.toMatchObject({ analysis: { state: "done" } });
    await expect(store.get(second)).resolves.toMatchObject({ analysis: { state: "done" } });
    expect(stateOf(unreadable)).toEqual({ state: "waiting" });
    expect(queue.getState()).toEqual({ running: false, stop: null, pause: null });
  });

  it("does not stop a later run either, which sends nothing for it", async () => {
    insertUnreadableWaiting();
    await queue.trigger();
    await queue.trigger();
    expect(calls).toEqual([]);
    expect(queue.getState()).toEqual({ running: false, stop: null, pause: null });
  });

  it("is shown in the list as unreadable, beside the finds the queue analysed", async () => {
    const unreadable = insertUnreadableWaiting();
    const id = await store.add({
      photoUri: "file:///cache/a.jpg",
      time: { takenAtMs: 1_000, ...takenAt },
      position: null,
    });
    await queue.trigger();
    await expect(store.list()).resolves.toEqual([
      { readable: false, id: unreadable },
      expect.objectContaining({
        readable: true,
        id,
        analysis: expect.objectContaining({ state: "done" }),
      }),
    ]);
  });
});

describe("a failed find's message after one of its photos is removed (PBI-2.16; Adam's decision, 2026-11-15)", () => {
  /** A waiting find without text that holds three photos, the store's `p1.jpg` to `p3.jpg`. */
  async function findOfThree(): Promise<number> {
    const id = await store.add({
      photoUri: "file:///cache/a.jpg",
      time: { takenAtMs: 1_000, ...takenAt },
      position: null,
    });
    await store.addPhoto(id, "file:///cache/b.jpg");
    await store.addPhoto(id, "file:///cache/c.jpg");
    await store.completeBatch(id);
    return id;
  }

  /** The store's copy that the phone cannot load, whatever its number in the find. */
  const BROKEN = "file:///photos/p2.jpg";

  /**
   * What the Find screen shows for the find's stored failure (`AnalysisView` in
   * `src/find/FindScreen.tsx`): the failure's message, given the number of photos the find holds.
   */
  async function shown(id: number, language: Language): Promise<string | null> {
    const find = await store.getStored(id);
    if (find === null || find.analysis.state !== "failed") {
      return null;
    }
    return failureMessage(find.analysis.failure, STRINGS[language], "photo", find.photos.length);
  }

  const numbered = (language: Language, number: number) => {
    const t = STRINGS[language].queue.failed;
    return t.numbered.replace("{number}", String(number)).replace("{reason}", t.photo.loadFailed);
  };

  it.each(LANGUAGES)(
    "names no photo in %s once a photo is removed, until the find fails again, and then names the photo by the number it has now",
    async (language) => {
      const t = STRINGS[language].queue.failed;
      const id = await findOfThree();
      queue.dispose();
      queue = queueWhere((photoUri) => photoUri !== BROKEN);
      queue.setInFront(true);

      // A run: the second photo does not load, and the find fails naming it.
      await queue.trigger();
      expect(calls).toEqual([]);
      await expect(store.getStored(id)).resolves.toMatchObject({
        analysis: { state: "failed", failure: { cause: "photo", detail: "photo 2: load-failed" } },
      });
      await expect(shown(id, language)).resolves.toBe(numbered(language, 2));

      // The first photo is removed: the photo that failed is now photo 1, and photo 2 one that
      // loaded. The message gives the reason as an unnumbered failure does, and no number.
      await store.removePhoto(id, 1);
      await expect(shown(id, language)).resolves.toBe(t.photo.loadFailed);
      await expect(shown(id, language)).resolves.toBe(
        failureMessage({ cause: "photo", detail: "load-failed" }, STRINGS[language]),
      );
      await expect(shown(id, language)).resolves.not.toMatch(/[0-9]/);

      // Analysed again from its screen: the same photo fails, and the new failure names it by the
      // number it has now.
      await expect(queue.analyseFind(id)).resolves.toMatchObject({ ok: false, answerKept: false });
      await expect(store.getStored(id)).resolves.toMatchObject({
        analysis: { state: "failed", failure: { cause: "photo", detail: "photo 1: load-failed" } },
      });
      await expect(shown(id, language)).resolves.toBe(numbered(language, 1));

      // The photo that failed is removed, as the message advises: no number again, and the find
      // with the one photo left is analysed.
      await store.removePhoto(id, 1);
      await expect(shown(id, language)).resolves.toBe(t.photo.loadFailed);
      await expect(queue.analyseFind(id)).resolves.toEqual({ ok: true });
      expect(calls).toHaveLength(1);
      await expect(shown(id, language)).resolves.toBeNull();
      await expect(store.getStored(id)).resolves.toMatchObject({
        photos: [{ uri: "file:///photos/p3.jpg" }],
        analysis: { state: "done" },
      });
    },
  );

  it("names the photo still, by its number, while no photo has been removed", async () => {
    const id = await findOfThree();
    queue.dispose();
    queue = queueWhere((photoUri) => photoUri !== BROKEN);
    queue.setInFront(true);
    await queue.trigger();
    await expect(shown(id, "en")).resolves.toBe(numbered("en", 2));
    await expect(shown(id, "en")).resolves.toMatch(/remove that photo/);
  });
});
