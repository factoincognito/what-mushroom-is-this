/**
 * The queue over the real find store on a real SQLite (`src/testing/sqliteDatabase.ts`): what the
 * queue does with a waiting find the store cannot read, and how the list shows it (PBI-1.16).
 */

import type { AnalysisInput } from "../analysis/analyse";
import type { Answer } from "../analysis/answer";
import { createFindStore, type FindStore } from "../store/findStore";
import {
  type DatabaseSync,
  memoryPhotos,
  memorySqlite,
  sqliteDatabase,
} from "../testing/sqliteDatabase";
import { AnalysisQueue } from "./queue";

const MATCH: Answer = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: "high",
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};

let sqlite: DatabaseSync;
let store: FindStore;
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
        `INSERT INTO finds (utc_offset_min, photo_file, state, ${columns})
          VALUES (0, 'unreadable.jpg', 'waiting', ${values})`,
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
    () => insertPastChecks("taken_at_ms, time_source", "9000000, 'gps'"),
  ],
  [
    "a position source the store does not know (Clead's review of #26, fix 1)",
    () =>
      insertPastChecks(
        "taken_at_ms, time_source, latitude, longitude, position_source",
        "9000000, 'saved', 1, 2, 'gps'",
      ),
  ],
  [
    "a time taken past 2^53 (Clead's review of #26, decision 3)",
    () => insertPastChecks("taken_at_ms, time_source", "?, 'saved'", 2n ** 53n + 1n),
  ],
];

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
