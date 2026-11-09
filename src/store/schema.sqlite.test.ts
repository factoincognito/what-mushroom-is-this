/**
 * The schema and the store against a real SQLite (`src/testing/sqliteDatabase.ts`): every
 * statement the store sends, and the constraints of schema version 1.
 */

import { EDIBILITIES, type Match } from "../analysis/answer";
import {
  type DatabaseSync,
  memoryPhotos,
  memorySqlite,
  sqliteDatabase,
} from "../testing/sqliteDatabase";
import { type AnalysedAnswer, FAILURE_CAUSES, type NewFind } from "./find";
import { createFindStore, type FindStore } from "./findStore";
import { MIGRATIONS } from "./schema";

const match: Match = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: "high",
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [
    {
      names: {
        sv: "Narrkantarell",
        en: "False chanterelle",
        la: "Hygrophoropsis aurantiaca",
        it: "Falso gallinaccio",
      },
      edibility: "not_edible",
    },
  ],
};
const analysed: AnalysedAnswer = { answer: match, model: "claude-model-x", analysedAtMs: 5_000 };

function newFind(takenAtMs: number, position: NewFind["position"] = null): NewFind {
  return {
    photoUri: "file:///cache/camera.jpg",
    time: { takenAtMs, utcOffsetMinutes: 60, source: "saved" },
    position,
  };
}

let sqlite: DatabaseSync;
let photos: ReturnType<typeof memoryPhotos>;
let store: FindStore;
let photoCount: number;

function open(): Promise<FindStore> {
  return createFindStore(sqliteDatabase(sqlite), photos, {
    newPhotoName: () => {
      photoCount += 1;
      return `p${photoCount}`;
    },
  });
}

beforeEach(async () => {
  sqlite = memorySqlite();
  photos = memoryPhotos();
  photoCount = 0;
  store = await open();
});

afterEach(() => {
  sqlite.close();
});

/** Inserts a failed find straight into the table, past the store's own checks. */
function insertFailed(cause: string): void {
  sqlite
    .prepare(
      `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, photo_file, state,
        failure_cause, failure_detail) VALUES (1, 0, 'saved', ?, 'failed', ?, 'why')`,
    )
    .run(`f-${cause}.jpg`, cause);
}

/** Inserts a done match straight into the table, with the edibility given. */
function insertMatch(edibility: string): void {
  sqlite
    .prepare(
      `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, photo_file, state,
        answer_json, model, analysed_at_ms, result, name_sv, name_en, name_it, edibility,
        confidence) VALUES (1, 0, 'saved', ?, 'done', '{}', 'm', 1, 'match', 's', 'e', 'i', ?,
        'high')`,
    )
    .run(`m-${edibility}.jpg`, edibility);
}

/**
 * Runs an INSERT past the CHECKs, as a row the constraints did not guard (a damaged file, say);
 * gives the row's ID. STRICT typing, NOT NULL and UNIQUE still apply.
 */
function insertPastChecks(sql: string, ...params: unknown[]): number {
  sqlite.exec("PRAGMA ignore_check_constraints = ON");
  try {
    return Number(sqlite.prepare(sql).run(...params).lastInsertRowid);
  } finally {
    sqlite.exec("PRAGMA ignore_check_constraints = OFF");
  }
}

/** Inserts a waiting find, taken latest, whose time source the store does not know. */
function insertUnreadableWaiting(photo: string): number {
  return insertPastChecks(
    `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, photo_file, state)
      VALUES (9000000, 0, 'gps', ?, 'waiting')`,
    photo,
  );
}

/** Inserts a waiting find, taken latest, whose position source the store does not know. */
function insertWaitingWithUnreadablePosition(photo: string): number {
  return insertPastChecks(
    `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, latitude, longitude,
      position_source, photo_file, state) VALUES (9000000, 0, 'saved', 1, 2, 'gps', ?, 'waiting')`,
    photo,
  );
}

/** 2^53 + 1, the first integer past JavaScript's safe range that is not 2^53 itself. */
const PAST_SAFE = 2n ** 53n + 1n;

/** Inserts a waiting find taken at a time past 2^53, which no JavaScript number holds exactly. */
function insertWaitingPastSafeTime(photo: string): number {
  return insertPastChecks(
    `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, photo_file, state)
      VALUES (?, 0, 'saved', ?, 'waiting')`,
    PAST_SAFE,
    photo,
  );
}

/** Inserts a waiting find, taken latest, with the UTC offset given, past the CHECKs. */
function insertWaitingWithOffset(offset: bigint | number, photo: string): number {
  return insertPastChecks(
    `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, photo_file, state)
      VALUES (9000000, ?, 'saved', ?, 'waiting')`,
    offset,
    photo,
  );
}

/** Inserts a find with the times given, without passing the CHECKs by. */
function insertTimes(takenAtMs: bigint | number, analysedAtMs: bigint | number | null): void {
  sqlite
    .prepare(
      analysedAtMs === null
        ? `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, photo_file, state)
            VALUES (?, 0, 'saved', 't.jpg', 'waiting')`
        : `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, photo_file, state,
            answer_json, model, analysed_at_ms, result) VALUES (?, 0, 'saved', 't.jpg', 'done',
            '{"result":"no_mushroom"}', 'm', ?, 'no_mushroom')`,
    )
    .run(...(analysedAtMs === null ? [takenAtMs] : [takenAtMs, analysedAtMs]));
}

function stateOf(id: number): unknown {
  return sqlite.prepare("SELECT state FROM finds WHERE id = ?").get(id);
}

describe("schema version 1 on a real SQLite", () => {
  it("is accepted by SQLite, at user_version 1", () => {
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({
      user_version: MIGRATIONS.length,
    });
  });

  it("is a STRICT table (PBI-1.16)", () => {
    expect(
      sqlite.prepare("SELECT strict FROM pragma_table_list WHERE name = 'finds'").get(),
    ).toEqual({ strict: 1 });
  });

  it("refuses a value of the wrong type, which SQLite would otherwise store as it is (PBI-1.16)", () => {
    const insert = sqlite.prepare(
      `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, photo_file, state)
        VALUES ('soon', 0, 'saved', 'p.jpg', 'waiting')`,
    );
    expect(() => insert.run()).toThrow(/cannot store TEXT value in INTEGER column/);
  });

  it.each(FAILURE_CAUSES)("accepts the failure cause %s the store knows", (cause) => {
    expect(() => insertFailed(cause)).not.toThrow();
  });

  it("accepts the failure cause photo, for a photo that cannot be read (PBI-1.7)", () => {
    expect(FAILURE_CAUSES).toContain("photo");
    expect(() => insertFailed("photo")).not.toThrow();
  });

  it("accepts the failure cause refused, for an answer Claude declined (PBI-1.21)", () => {
    expect(FAILURE_CAUSES).toContain("refused");
    expect(() => insertFailed("refused")).not.toThrow();
  });

  it("refuses a failure cause the store does not know", () => {
    expect(() => insertFailed("bad-luck")).toThrow(/CHECK constraint failed/);
  });

  it.each([
    ["the largest", Number.MAX_SAFE_INTEGER],
    ["the smallest", -Number.MAX_SAFE_INTEGER],
  ])(
    "accepts %s safe integer as the time taken and as the analysis time (PBI-1.16)",
    (_name, ms) => {
      expect(() => insertTimes(ms, ms)).not.toThrow();
    },
  );

  it.each([
    ["2^53", 2n ** 53n],
    ["-2^53", -(2n ** 53n)],
  ])("refuses %s as the time taken, past the safe-integer range (PBI-1.16)", (_name, ms) => {
    expect(() => insertTimes(ms, null)).toThrow(/CHECK constraint failed/);
  });

  it.each([
    ["2^53", 2n ** 53n],
    ["-2^53", -(2n ** 53n)],
  ])("refuses %s as the analysis time, past the safe-integer range (PBI-1.16)", (_name, ms) => {
    expect(() => insertTimes(1, ms)).toThrow(/CHECK constraint failed/);
  });

  it.each(EDIBILITIES)("accepts the edibility %s of the answer's shape (PBI-1.16)", (edibility) => {
    expect(() => insertMatch(edibility)).not.toThrow();
  });

  it("refuses an edibility the answer's shape does not have (PBI-1.16)", () => {
    expect(() => insertMatch("tasty")).toThrow(/CHECK constraint failed/);
  });
});

describe("opening the store on a real SQLite", () => {
  it("removes the photos no find refers to and keeps the others", async () => {
    await store.add(newFind(1_000));
    photos.files.add("stray.jpg");
    await open();
    expect([...photos.files]).toEqual(["p1.jpg"]);
  });
});

describe("the store's statements on a real SQLite", () => {
  const position = { latitude: 59.64, longitude: 17.08, accuracyM: 12.5, source: "fix" } as const;

  it("adds a find with its position and reads it back as waiting", async () => {
    const id = await store.add(newFind(1_000, position));
    await expect(store.get(id)).resolves.toEqual({
      id,
      photoUri: "file:///photos/p1.jpg",
      time: { takenAtMs: 1_000, utcOffsetMinutes: 60, source: "saved" },
      position,
      analysis: { state: "waiting" },
    });
  });

  it("adds a find without a position, or with a position the phone gave no accuracy for", async () => {
    const without = await store.add(newFind(1_000));
    const noAccuracy = await store.add(
      newFind(2_000, { latitude: 1, longitude: 2, accuracyM: null, source: "photo" }),
    );
    await expect(store.get(without)).resolves.toMatchObject({ position: null });
    await expect(store.get(noAccuracy)).resolves.toMatchObject({
      position: { latitude: 1, longitude: 2, accuracyM: null, source: "photo" },
    });
  });

  it("gives null for an ID no find has", async () => {
    await expect(store.get(99)).resolves.toBeNull();
  });

  it("lists the finds latest taken first, then by ID, each marked readable", async () => {
    const early = await store.add(newFind(1_000));
    const late = await store.add(newFind(3_000));
    const sameTime = await store.add(newFind(3_000));
    const list = await store.list();
    expect(list.map((entry) => entry.id)).toEqual([sameTime, late, early]);
    expect(list.every((entry) => entry.readable)).toBe(true);
  });

  it("stores an answer, which the find and the list then show", async () => {
    const id = await store.add(newFind(1_000));
    await store.setAnswer(id, analysed);
    await expect(store.get(id)).resolves.toMatchObject({
      analysis: { state: "done", answer: match, model: "claude-model-x", analysedAtMs: 5_000 },
    });
    await expect(store.list()).resolves.toEqual([
      {
        readable: true,
        id,
        photoUri: "file:///photos/p1.jpg",
        time: { takenAtMs: 1_000, utcOffsetMinutes: 60, source: "saved" },
        analysis: {
          state: "done",
          result: "match",
          names: { sv: "Kantarell", en: "Chanterelle", it: "Gallinaccio" },
          edibility: "edible",
          confidence: "high",
        },
      },
    ]);
  });

  it("stores an answer without a match, with none of the match's columns", async () => {
    const id = await store.add(newFind(1_000));
    await store.setAnswer(id, { ...analysed, answer: { result: "no_mushroom" } });
    const [entry] = await store.list();
    expect(entry).toMatchObject({ analysis: { state: "done", result: "no_mushroom" } });
  });

  it("stores the answer of a failed find, clearing why it failed", async () => {
    const id = await store.add(newFind(1_000));
    await store.markFailed(id, { cause: "request", detail: "request-wrong (status 400)" });
    await store.setAnswer(id, analysed);
    expect(
      sqlite.prepare("SELECT failure_cause, failure_detail FROM finds WHERE id = ?").get(id),
    ).toEqual({ failure_cause: null, failure_detail: null });
  });

  it("refuses to store a second answer with setAnswer, as wrong-state", async () => {
    const id = await store.add(newFind(1_000));
    await store.setAnswer(id, analysed);
    await expect(store.setAnswer(id, analysed)).rejects.toMatchObject({ code: "wrong-state" });
  });

  it("says no find has the ID when a change finds none", async () => {
    await expect(store.setAnswer(99, analysed)).rejects.toMatchObject({ code: "not-found" });
  });

  it("replaces the answer of a done find", async () => {
    const id = await store.add(newFind(1_000));
    await store.setAnswer(id, { ...analysed, answer: { result: "cannot_tell" } });
    await store.replaceAnswer(id, { ...analysed, model: "claude-model-y", analysedAtMs: 6_000 });
    await expect(store.get(id)).resolves.toMatchObject({
      analysis: { state: "done", answer: match, model: "claude-model-y", analysedAtMs: 6_000 },
    });
  });

  it("refuses to replace the answer of a find that has none, as wrong-state", async () => {
    const id = await store.add(newFind(1_000));
    await expect(store.replaceAnswer(id, analysed)).rejects.toMatchObject({ code: "wrong-state" });
  });

  it("marks a find failed for its photo and reads it back", async () => {
    const id = await store.add(newFind(1_000));
    await store.markFailed(id, { cause: "photo", detail: "invalid-size: 0 x 0" });
    await expect(store.get(id)).resolves.toMatchObject({
      analysis: { state: "failed", failure: { cause: "photo", detail: "invalid-size: 0 x 0" } },
    });
    const [summary] = await store.list();
    expect(summary).toMatchObject({
      analysis: { state: "failed", failure: { cause: "photo", detail: "invalid-size: 0 x 0" } },
    });
  });

  it("refuses to mark a done find failed, as wrong-state", async () => {
    const id = await store.add(newFind(1_000));
    await store.setAnswer(id, analysed);
    await expect(store.markFailed(id, { cause: "answer", detail: "shape" })).rejects.toMatchObject({
      code: "wrong-state",
    });
  });

  it("puts a find failed for its photo back to waiting", async () => {
    const id = await store.add(newFind(1_000));
    await store.markFailed(id, { cause: "photo", detail: "gone" });
    await store.markWaiting(id);
    await expect(store.oldestWaiting()).resolves.toBe(id);
    await expect(store.get(id)).resolves.toMatchObject({ analysis: { state: "waiting" } });
  });

  it("refuses to put a waiting find back to waiting, as wrong-state", async () => {
    const id = await store.add(newFind(1_000));
    await expect(store.markWaiting(id)).rejects.toMatchObject({ code: "wrong-state" });
  });

  it("adds a fix to a find saved without a position", async () => {
    const id = await store.add(newFind(1_000));
    await store.setPosition(id, position);
    await expect(store.get(id)).resolves.toMatchObject({ position });
  });

  it("does not replace the position a find already has", async () => {
    const id = await store.add(
      newFind(1_000, { latitude: 1, longitude: 2, accuracyM: 3, source: "last-known" }),
    );
    await expect(store.setPosition(id, position)).rejects.toMatchObject({ code: "wrong-state" });
    await expect(store.get(id)).resolves.toMatchObject({ position: { source: "last-known" } });
  });

  it("says no find has the ID when a fix finds none", async () => {
    await expect(store.setPosition(99, position)).rejects.toMatchObject({ code: "not-found" });
  });

  it("adds a fix the phone gave no accuracy for (PBI-1.20)", async () => {
    const id = await store.add(newFind(1_000));
    await store.setPosition(id, { ...position, accuracyM: null });
    await expect(store.get(id)).resolves.toMatchObject({
      position: { ...position, accuracyM: null },
    });
  });

  it.each<[string, (id: number) => Promise<void>]>([
    ["waiting", async () => undefined],
    ["done", (id) => store.setAnswer(id, analysed)],
    ["failed", (id) => store.markFailed(id, { cause: "request", detail: "status 400" })],
  ])("adds a fix to a %s find and changes nothing else of it (PBI-1.20)", async (_state, into) => {
    const id = await store.add(newFind(1_000));
    await into(id);
    const before = await store.get(id);
    await store.setPosition(id, position);
    await expect(store.get(id)).resolves.toEqual({ ...before, position });
  });

  it("adds the fix to the find given and to no other (PBI-1.20)", async () => {
    const other = await store.add(newFind(1_000));
    const id = await store.add(newFind(2_000));
    await store.setPosition(id, position);
    await expect(store.get(other)).resolves.toMatchObject({ position: null });
  });

  it("does not replace the position a gallery photo's metadata gave (PBI-1.20)", async () => {
    const fromPhoto = { latitude: 1, longitude: 2, accuracyM: null, source: "photo" } as const;
    const id = await store.add(newFind(1_000, fromPhoto));
    await expect(store.setPosition(id, position)).rejects.toMatchObject({ code: "wrong-state" });
    await expect(store.get(id)).resolves.toMatchObject({ position: fromPhoto });
  });

  it("refuses, as corrupt, a find whose stored position source it does not know, and changes nothing (PBI-1.20)", async () => {
    const id = insertWaitingWithUnreadablePosition("u1.jpg");
    await expect(store.setPosition(id, position)).rejects.toMatchObject({ code: "corrupt" });
    expect(
      sqlite
        .prepare("SELECT latitude, longitude, accuracy_m, position_source FROM finds WHERE id = ?")
        .get(id),
    ).toEqual({ latitude: 1, longitude: 2, accuracy_m: null, position_source: "gps" });
  });

  it("deletes a find and its photo", async () => {
    const id = await store.add(newFind(1_000));
    await expect(store.delete(id)).resolves.toEqual({ photoRemoved: true });
    await expect(store.get(id)).resolves.toBeNull();
    expect(photos.files.size).toBe(0);
  });

  it("says no find has the ID when there is none to delete", async () => {
    await expect(store.delete(99)).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("finds whose ID the store cannot read, on a real SQLite (PBI-1.26)", () => {
  /** Inserts a waiting find with the ID given, taken latest; gives that ID as SQLite writes it. */
  function insertWithId(id: bigint, photo: string): string {
    sqlite
      .prepare(
        `INSERT INTO finds (id, taken_at_ms, utc_offset_min, time_source, photo_file, state)
          VALUES (?, 9000000, 0, 'saved', ?, 'waiting')`,
      )
      .run(id, photo);
    return id.toString();
  }

  it.each([
    ["past 2^53", PAST_SAFE],
    ["of 0", 0n],
    ["below 0", -3n],
  ])(
    "lists a find with an ID %s, unreadable, beside the others, and removes it with its photo",
    async (_name, id) => {
      const other = await store.add(newFind(1_000));
      // Inserted last: after an ID past 2^53, SQLite would give the next find one past it too.
      const storedId = insertWithId(id, "u1.jpg");
      photos.files.add("u1.jpg");
      await expect(store.list()).resolves.toEqual([
        { readable: false, id: null, storedId },
        expect.objectContaining({ readable: true, id: other }),
      ]);
      await expect(store.deleteUnreadable(storedId)).resolves.toEqual({ photoRemoved: true });
      expect(photos.files.has("u1.jpg")).toBe(false);
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ readable: true, id: other }),
      ]);
    },
  );

  it("passes over a waiting find with an ID past 2^53, which stays waiting", async () => {
    const other = await store.add(newFind(1_000));
    const storedId = insertWithId(PAST_SAFE, "u1.jpg");
    await expect(store.oldestWaiting()).resolves.toBe(other);
    await store.markFailed(other, { cause: "photo", detail: "gone" });
    await expect(store.oldestWaiting()).resolves.toBeNull();
    expect(
      sqlite.prepare("SELECT state FROM finds WHERE CAST(id AS TEXT) = ?").get(storedId),
    ).toEqual({ state: "waiting" });
  });

  it("removes only the find of the ID given", async () => {
    insertWithId(0n, "u0.jpg");
    insertWithId(-3n, "u3.jpg");
    await store.deleteUnreadable("-3");
    await expect(store.list()).resolves.toEqual([{ readable: false, id: null, storedId: "0" }]);
  });

  it("says no find has the ID when none has", async () => {
    await expect(store.deleteUnreadable("0")).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("rows the store cannot read, on a real SQLite (PBI-1.16)", () => {
  it("lists the finds it can read and marks the one it cannot, in its place", async () => {
    const before = await store.add(newFind(1_000));
    const unreadable = insertUnreadableWaiting("u1.jpg");
    const after = await store.add(newFind(2_000));
    await expect(store.list()).resolves.toEqual([
      { readable: false, id: unreadable },
      expect.objectContaining({ readable: true, id: after }),
      expect.objectContaining({ readable: true, id: before }),
    ]);
  });

  it("passes over a waiting find it cannot read, which stays waiting, and gives the next", async () => {
    const unreadable = insertUnreadableWaiting("u1.jpg");
    const next = await store.add(newFind(1_000));
    await expect(store.oldestWaiting()).resolves.toBe(next);
    expect(stateOf(unreadable)).toEqual({ state: "waiting" });
  });

  it("gives null when the only waiting finds are ones it cannot read", async () => {
    insertUnreadableWaiting("u1.jpg");
    insertUnreadableWaiting("u2.jpg");
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });

  it("gives the oldest waiting find by its ID, not by the time taken", async () => {
    const late = await store.add(newFind(3_000));
    const early = await store.add(newFind(1_000));
    expect(late).toBeLessThan(early);
    await expect(store.oldestWaiting()).resolves.toBe(late);
    await store.markFailed(late, { cause: "photo", detail: "the image could not be loaded" });
    await expect(store.oldestWaiting()).resolves.toBe(early);
  });

  it("gives null when no find is waiting", async () => {
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });

  it("still deletes a find it cannot read, with its photo", async () => {
    const unreadable = insertUnreadableWaiting("u1.jpg");
    photos.files.add("u1.jpg");
    await expect(store.delete(unreadable)).resolves.toEqual({ photoRemoved: true });
    expect(stateOf(unreadable)).toBeUndefined();
  });

  /** The kinds of waiting row the store cannot read, each taken latest. */
  const unreadableWaiting: [string, (photo: string) => number][] = [
    ["a time source it does not know", insertUnreadableWaiting],
    [
      "a position source it does not know (Clead's review of #26, fix 1)",
      insertWaitingWithUnreadablePosition,
    ],
    ["a time taken past 2^53 (Clead's review of #26, decision 3)", insertWaitingPastSafeTime],
    [
      "a UTC offset past 2^53 (Clead's round 2 of #26, item 2)",
      (photo) => insertWaitingWithOffset(PAST_SAFE, photo),
    ],
    [
      "a UTC offset past 18 hours (round 2, item 2)",
      (photo) => insertWaitingWithOffset(1081, photo),
    ],
    ["a UTC offset below -18 hours (PBI-1.26)", (photo) => insertWaitingWithOffset(-1081, photo)],
    ["a UTC offset below -2^53 (PBI-1.26)", (photo) => insertWaitingWithOffset(-PAST_SAFE, photo)],
  ];

  it.each(unreadableWaiting)(
    "judges a waiting row with %s the same way in the list, the queue's pick and get",
    async (_name, insert) => {
      const before = await store.add(newFind(1_000));
      const unreadable = insert("u1.jpg");
      const after = await store.add(newFind(2_000));
      await expect(store.list()).resolves.toEqual([
        { readable: false, id: unreadable },
        expect.objectContaining({ readable: true, id: after }),
        expect.objectContaining({ readable: true, id: before }),
      ]);
      await expect(store.oldestWaiting()).resolves.toBe(before);
      await store.markFailed(before, { cause: "photo", detail: "gone" });
      await expect(store.oldestWaiting()).resolves.toBe(after);
      await expect(store.get(unreadable)).rejects.toMatchObject({ code: "corrupt" });
      expect(stateOf(unreadable)).toEqual({ state: "waiting" });
    },
  );

  /** Makes the done find `id` unreadable, past the CHECKs. */
  const unreadableDone: [string, (id: number) => void][] = [
    [
      "a stored answer not of the shape (Clead's review of #26, decision 2)",
      (id) => {
        sqlite.prepare("UPDATE finds SET answer_json = '{' WHERE id = ?").run(id);
      },
    ],
    [
      "an analysis time past 2^53 (Clead's review of #26, decision 3)",
      (id) => {
        insertPastChecks("UPDATE finds SET analysed_at_ms = ? WHERE id = ?", PAST_SAFE, id);
      },
    ],
  ];

  it.each(unreadableDone)(
    "marks a done find with %s unreadable in the list, by its ID, which get refuses and delete still removes",
    async (_name, damage) => {
      const id = await store.add(newFind(1_000));
      await store.setAnswer(id, analysed);
      const other = await store.add(newFind(500));
      damage(id);
      await expect(store.list()).resolves.toEqual([
        { readable: false, id },
        expect.objectContaining({ readable: true, id: other }),
      ]);
      await expect(store.get(id)).rejects.toMatchObject({ code: "corrupt" });
      await expect(store.delete(id)).resolves.toEqual({ photoRemoved: true });
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ readable: true, id: other }),
      ]);
    },
  );
});
