/**
 * The migration from schema version 1 to version 2 (PBI-2.2, docs/SPEC.md 3.9 "The store") on a
 * real SQLite: a version 1 database with Phase 1 finds in every state, the ones the store cannot
 * read included, is opened by the store, which brings it to version 2. Every find is kept, its
 * photo as its first photo and its answer as it was, and reads as it did before (Adam's
 * test-session finds are on his phone).
 */

import type { Answer, Match } from "../analysis/answer";
import {
  type DatabaseSync,
  memoryPhotos,
  memorySqlite,
  sqliteDatabase,
} from "../testing/sqliteDatabase";
import { answerToJson } from "./answerJson";
import type { Find } from "./find";
import { createFindStore } from "./findStore";
import { MIGRATIONS, migrate } from "./schema";

const match: Match = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: "medium",
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

let sqlite: DatabaseSync;
let photos: ReturnType<typeof memoryPhotos>;

/** A database at schema version 1, as Phase 1 of the app left it. */
async function versionOne(): Promise<void> {
  await migrate(sqliteDatabase(sqlite), [MIGRATIONS[0] ?? ""]);
}

function open() {
  return createFindStore(sqliteDatabase(sqlite), photos, { newPhotoName: () => "new" });
}

beforeEach(() => {
  sqlite = memorySqlite();
  photos = memoryPhotos();
});

afterEach(() => {
  sqlite.close();
});

type V1Row = Record<string, bigint | number | string | null>;

/** Inserts a find into the version 1 table as the Phase 1 store wrote it; gives its ID. */
function insertV1(row: V1Row, pastChecks = false): number {
  const columns = Object.keys(row);
  const sql = `INSERT INTO finds (${columns.join(", ")})
    VALUES (${columns.map(() => "?").join(", ")})`;
  if (pastChecks) {
    sqlite.exec("PRAGMA ignore_check_constraints = ON");
  }
  try {
    return Number(
      sqlite.prepare(sql).run(...columns.map((column) => row[column] ?? null)).lastInsertRowid,
    );
  } finally {
    sqlite.exec("PRAGMA ignore_check_constraints = OFF");
  }
}

const base = (photo: string, takenAtMs: number): V1Row => ({
  taken_at_ms: takenAtMs,
  utc_offset_min: 60,
  time_source: "saved",
  photo_file: photo,
  state: "waiting",
});

function done(answer: Answer): V1Row {
  const columns: V1Row = {
    state: "done",
    answer_json: answerToJson(answer),
    model: "claude-opus-5-5",
    analysed_at_ms: 1_762_700_000_000,
    result: answer.result,
  };
  if (answer.result !== "match") {
    return columns;
  }
  return {
    ...columns,
    name_sv: answer.names.sv,
    name_en: answer.names.en,
    name_it: answer.names.it,
    edibility: answer.edibility,
    confidence: answer.confidence,
  };
}

/** The Phase 1 finds of every state, each with its photo in the directory; gives their IDs. */
function phaseOneFinds() {
  const ids = {
    waitingWithFix: insertV1({
      ...base("a.jpg", 1_000),
      latitude: 59.64,
      longitude: 17.08,
      accuracy_m: 12.5,
      position_source: "fix",
    }),
    waitingFromPhoto: insertV1({
      ...base("b.jpg", 2_000),
      time_source: "photo-phone-offset",
      latitude: 59.1,
      longitude: 17.2,
      position_source: "photo",
    }),
    match: insertV1({ ...base("c.jpg", 3_000), time_source: "photo", ...done(match) }),
    lowMatch: insertV1({ ...base("d.jpg", 4_000), ...done({ ...match, confidence: "low" }) }),
    noMushroom: insertV1({ ...base("e.jpg", 5_000), ...done({ result: "no_mushroom" }) }),
    cannotTell: insertV1({ ...base("f.jpg", 6_000), ...done({ result: "cannot_tell" }) }),
    failedSegment: insertV1({
      ...base("g.jpg", 7_000),
      state: "failed",
      failure_cause: "segment-check",
      failure_detail: "0xFFE1",
    }),
    failedRefused: insertV1({
      ...base("h.jpg", 8_000),
      state: "failed",
      failure_cause: "refused",
      failure_detail: "stop_reason refusal",
    }),
    lastKnown: insertV1({
      ...base("i.jpg", 9_000),
      utc_offset_min: -300,
      latitude: 1,
      longitude: 2,
      position_source: "last-known",
      ...done(match),
    }),
  };
  for (const name of ["a", "b", "c", "d", "e", "f", "g", "h", "i"]) {
    photos.files.add(`${name}.jpg`);
  }
  return ids;
}

/** The finds the store could not read in Phase 1, each kept as it is. */
function unreadableFinds() {
  const ids = {
    // Passes the CHECKs, but its answer is not of the shape.
    badAnswer: insertV1({ ...base("u1.jpg", 10_000), ...done(match), answer_json: "{" }),
    // Past the CHECKs, as a damaged file could hold it.
    unknownTimeSource: insertV1({ ...base("u2.jpg", 11_000), time_source: "gps" }, true),
    pastSafeTime: insertV1({ ...base("u3.jpg", 12_000), taken_at_ms: 2n ** 53n + 1n }, true),
  };
  insertV1({ ...base("u4.jpg", 13_000), id: 2n ** 53n + 1n });
  insertV1({ ...base("u5.jpg", 14_000), id: 0 });
  for (const name of ["u1", "u2", "u3", "u4", "u5"]) {
    photos.files.add(`${name}.jpg`);
  }
  return ids;
}

const time = (takenAtMs: number, source = "saved", utcOffsetMinutes = 60) => ({
  takenAtMs,
  utcOffsetMinutes,
  source,
});

const analysedMatch = (answer: Answer) => ({
  state: "done",
  answer,
  model: "claude-opus-5-5",
  analysedAtMs: 1_762_700_000_000,
});

describe("the migration to schema version 2, on a version 1 database (PBI-2.2)", () => {
  it("brings the database to version 2 when the store opens it", async () => {
    await versionOne();
    phaseOneFinds();
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    await open();
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(
      sqlite.prepare("SELECT strict FROM pragma_table_list WHERE name = 'finds'").get(),
    ).toEqual({ strict: 1 });
  });

  it("keeps every Phase 1 find, each read by get as Phase 1's store read it", async () => {
    await versionOne();
    const ids = phaseOneFinds();
    const store = await open();
    // Written out, since the store that read version 1 is gone: what its `get` gave for each row.
    const expected: Record<keyof typeof ids, Find> = {
      waitingWithFix: {
        id: ids.waitingWithFix,
        photoUri: "file:///photos/a.jpg",
        time: time(1_000) as Find["time"],
        position: { latitude: 59.64, longitude: 17.08, accuracyM: 12.5, source: "fix" },
        analysis: { state: "waiting" },
      },
      waitingFromPhoto: {
        id: ids.waitingFromPhoto,
        photoUri: "file:///photos/b.jpg",
        time: time(2_000, "photo-phone-offset") as Find["time"],
        position: { latitude: 59.1, longitude: 17.2, accuracyM: null, source: "photo" },
        analysis: { state: "waiting" },
      },
      match: {
        id: ids.match,
        photoUri: "file:///photos/c.jpg",
        time: time(3_000, "photo") as Find["time"],
        position: null,
        analysis: analysedMatch(match) as Find["analysis"],
      },
      lowMatch: {
        id: ids.lowMatch,
        photoUri: "file:///photos/d.jpg",
        time: time(4_000) as Find["time"],
        position: null,
        analysis: analysedMatch({ ...match, confidence: "low" }) as Find["analysis"],
      },
      noMushroom: {
        id: ids.noMushroom,
        photoUri: "file:///photos/e.jpg",
        time: time(5_000) as Find["time"],
        position: null,
        analysis: analysedMatch({ result: "no_mushroom" }) as Find["analysis"],
      },
      cannotTell: {
        id: ids.cannotTell,
        photoUri: "file:///photos/f.jpg",
        time: time(6_000) as Find["time"],
        position: null,
        analysis: analysedMatch({ result: "cannot_tell" }) as Find["analysis"],
      },
      failedSegment: {
        id: ids.failedSegment,
        photoUri: "file:///photos/g.jpg",
        time: time(7_000) as Find["time"],
        position: null,
        analysis: { state: "failed", failure: { cause: "segment-check", detail: "0xFFE1" } },
      },
      failedRefused: {
        id: ids.failedRefused,
        photoUri: "file:///photos/h.jpg",
        time: time(8_000) as Find["time"],
        position: null,
        analysis: {
          state: "failed",
          failure: { cause: "refused", detail: "stop_reason refusal" },
        },
      },
      lastKnown: {
        id: ids.lastKnown,
        photoUri: "file:///photos/i.jpg",
        time: time(9_000, "saved", -300) as Find["time"],
        position: { latitude: 1, longitude: 2, accuracyM: null, source: "last-known" },
        analysis: analysedMatch(match) as Find["analysis"],
      },
    };
    for (const find of Object.values(expected)) {
      await expect(store.get(find.id)).resolves.toEqual(find);
    }
  });

  it("keeps each Phase 1 find's photo as its first and only photo, in batch 1, with no open batch", async () => {
    await versionOne();
    const ids = phaseOneFinds();
    const store = await open();
    await expect(store.getStored(ids.match)).resolves.toEqual({
      id: ids.match,
      text: null,
      photos: [{ uri: "file:///photos/c.jpg", batch: 1 }],
      batchOpen: false,
      time: time(3_000, "photo"),
      position: null,
      analysis: analysedMatch(match),
      addedPhotos: "analysed",
      picture: null,
      selfCheck: null,
    });
    await expect(store.getStored(ids.waitingWithFix)).resolves.toMatchObject({
      text: null,
      photos: [{ uri: "file:///photos/a.jpg", batch: 1 }],
      batchOpen: false,
      addedPhotos: null,
      picture: null,
      selfCheck: null,
    });
    expect(
      sqlite.prepare("SELECT photos, batches, batch_open FROM finds WHERE id = ?").get(ids.match),
    ).toEqual({ photos: '[{"file":"c.jpg","batch":1}]', batches: 1, batch_open: 0 });
  });

  it("keeps each answer as it was, its stored JSON and its Log columns, with the confidence as a level", async () => {
    await versionOne();
    const ids = phaseOneFinds();
    const columns = `answer_json, model, analysed_at_ms, result, name_sv, name_en, name_it,
      edibility, confidence`;
    const before = sqlite.prepare(`SELECT id, ${columns} FROM finds ORDER BY id`).all();
    await open();
    expect(sqlite.prepare(`SELECT id, ${columns} FROM finds ORDER BY id`).all()).toEqual(before);
    expect(
      sqlite.prepare("SELECT confidence_score FROM finds WHERE confidence_score IS NOT NULL").all(),
    ).toEqual([]);
    expect(sqlite.prepare("SELECT confidence FROM finds WHERE id = ?").get(ids.lowMatch)).toEqual({
      confidence: "low",
    });
  });

  it("lists the Phase 1 finds as the Log listed them, latest taken first", async () => {
    await versionOne();
    const ids = phaseOneFinds();
    const store = await open();
    const list = await store.list();
    expect(list.map((entry) => entry.id)).toEqual([
      ids.lastKnown,
      ids.failedRefused,
      ids.failedSegment,
      ids.cannotTell,
      ids.noMushroom,
      ids.lowMatch,
      ids.match,
      ids.waitingFromPhoto,
      ids.waitingWithFix,
    ]);
    expect(list.every((entry) => entry.readable)).toBe(true);
    expect(list.find((entry) => entry.id === ids.lowMatch)).toEqual({
      readable: true,
      id: ids.lowMatch,
      photoUri: "file:///photos/d.jpg",
      time: time(4_000),
      selfCheck: null,
      // The Latin name, from the stored answer, for the Library's species filter (PBI-2.7).
      species: match.names,
      analysis: {
        state: "done",
        result: "match",
        names: { sv: "Kantarell", en: "Chanterelle", it: "Gallinaccio" },
        edibility: "edible",
        confidence: "low",
      },
    });
  });

  it("keeps a Phase 1 find's level until it is analysed again, then holds the number in its place (SPEC 3.9, PBI-2.3)", async () => {
    await versionOne();
    const ids = phaseOneFinds();
    const store = await open();
    const again = {
      answer: { ...match, confidence: 64 },
      model: "claude-opus-5-5",
      analysedAtMs: 1_762_800_000_000,
    };
    await store.replaceAnswer(ids.lowMatch, again, { photoUris: ["file:///photos/d.jpg"] });
    expect(
      sqlite
        .prepare("SELECT confidence, confidence_score FROM finds WHERE id = ?")
        .get(ids.lowMatch),
    ).toEqual({ confidence: null, confidence_score: 64 });
    await expect(store.get(ids.lowMatch)).resolves.toMatchObject({
      analysis: { state: "done", answer: { confidence: 64 } },
    });
    expect((await store.list()).find((entry) => entry.id === ids.lowMatch)).toMatchObject({
      analysis: { confidence: 64 },
    });
    // The other Phase 1 finds keep their levels.
    await expect(store.get(ids.match)).resolves.toMatchObject({
      analysis: { answer: { confidence: "medium" } },
    });
  });

  it("keeps the waiting finds waiting for the queue, oldest first", async () => {
    await versionOne();
    const ids = phaseOneFinds();
    const store = await open();
    await expect(store.oldestWaiting()).resolves.toBe(ids.waitingWithFix);
  });

  it("keeps every photo of a Phase 1 find, the unreadable ones' too, when the store opens", async () => {
    await versionOne();
    phaseOneFinds();
    unreadableFinds();
    photos.files.add("stray.jpg");
    await open();
    expect([...photos.files].sort()).toEqual(
      ["a", "b", "c", "d", "e", "f", "g", "h", "i", "u1", "u2", "u3", "u4", "u5"].map(
        (name) => `${name}.jpg`,
      ),
    );
  });

  it("keeps the finds the store could not read, each as it was, still listed so they can be deleted", async () => {
    await versionOne();
    const ids = phaseOneFinds();
    const unreadable = unreadableFinds();
    const keptColumns = `CAST(id AS TEXT) AS id, CAST(taken_at_ms AS TEXT) AS taken_at_ms,
      time_source, state, answer_json`;
    const before = sqlite.prepare(`SELECT ${keptColumns} FROM finds ORDER BY id`).all();
    const store = await open();
    expect(sqlite.prepare(`SELECT ${keptColumns} FROM finds ORDER BY id`).all()).toEqual(before);
    const list = await store.list();
    expect(list.slice(0, 5)).toEqual([
      { readable: false, id: unreadable.pastSafeTime },
      { readable: false, id: null, storedId: "0" },
      { readable: false, id: null, storedId: (2n ** 53n + 1n).toString() },
      { readable: false, id: unreadable.unknownTimeSource },
      { readable: false, id: unreadable.badAnswer },
    ]);
    expect(list.slice(5).every((entry) => entry.readable)).toBe(true);
    await expect(store.get(unreadable.badAnswer)).rejects.toMatchObject({ code: "corrupt" });
    await expect(store.delete(unreadable.badAnswer)).resolves.toEqual({ photoRemoved: true });
    await expect(store.deleteUnreadable("0")).resolves.toEqual({ photoRemoved: true });
    expect(photos.files.has("u1.jpg")).toBe(false);
    expect(photos.files.has("u5.jpg")).toBe(false);
    await expect(store.get(ids.match)).resolves.toMatchObject({ id: ids.match });
  });

  it("passes over a waiting find saved first that it cannot read, as at version 1", async () => {
    await versionOne();
    const unreadable = insertV1({ ...base("u2.jpg", 11_000), time_source: "gps" }, true);
    const ids = phaseOneFinds();
    const store = await open();
    expect(unreadable).toBeLessThan(ids.waitingWithFix);
    await expect(store.oldestWaiting()).resolves.toBe(ids.waitingWithFix);
  });

  it("keeps AUTOINCREMENT's high-water mark, so the ID of a find deleted in Phase 1 is not given again", async () => {
    await versionOne();
    const first = insertV1(base("a.jpg", 1_000));
    const deleted = insertV1(base("b.jpg", 2_000));
    sqlite.prepare("DELETE FROM finds WHERE id = ?").run(deleted);
    photos.files.add("a.jpg");
    const store = await open();
    expect(first).toBe(deleted - 1);
    await expect(
      store.add({
        photoUri: "file:///cache/x.jpg",
        time: time(3_000) as Find["time"],
        position: null,
      }),
    ).resolves.toBe(deleted + 1);
  });

  it("keeps the high-water mark when every Phase 1 find was deleted", async () => {
    await versionOne();
    const deleted = insertV1(base("a.jpg", 1_000));
    sqlite.prepare("DELETE FROM finds WHERE id = ?").run(deleted);
    const store = await open();
    await expect(
      store.add({
        photoUri: "file:///cache/x.jpg",
        time: time(3_000) as Find["time"],
        position: null,
      }),
    ).resolves.toBe(deleted + 1);
  });

  it("migrates an empty version 1 database, whose first find then has the ID 1", async () => {
    await versionOne();
    const store = await open();
    await expect(store.list()).resolves.toEqual([]);
    await expect(
      store.add({
        photoUri: "file:///cache/x.jpg",
        time: time(3_000) as Find["time"],
        position: null,
      }),
    ).resolves.toBe(1);
  });

  it("leaves the CHECKs on once it is done, so the database refuses a value it does not know", async () => {
    await versionOne();
    phaseOneFinds();
    await open();
    expect(sqlite.prepare("PRAGMA ignore_check_constraints").get()).toEqual({
      ignore_check_constraints: 0,
    });
    expect(() => sqlite.prepare("UPDATE finds SET time_source = 'gps'").run()).toThrow(
      /CHECK constraint failed/,
    );
  });

  it("keeps the Log's index", async () => {
    await versionOne();
    await open();
    expect(
      sqlite
        .prepare("SELECT tbl_name FROM sqlite_schema WHERE type = 'index' AND name = ?")
        .get("finds_newest_first"),
    ).toEqual({ tbl_name: "finds" });
  });

  it("changes nothing when it fails after the version 1 table is dropped: the database stays at version 1 with every find (review of #49, fix 2)", async () => {
    await versionOne();
    phaseOneFinds();
    const deleted = insertV1(base("z.jpg", 15_000));
    sqlite.prepare("DELETE FROM finds WHERE id = ?").run(deleted);
    const before = sqlite.prepare("SELECT * FROM finds ORDER BY id").all();
    const sequence = sqlite.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all();
    // A view on the version 1 column survives `DROP TABLE finds`, then makes the RENAME fail.
    sqlite.exec("CREATE VIEW blocker AS SELECT photo_file FROM finds");
    await expect(open()).rejects.toThrow(/blocker/);
    sqlite.exec("PRAGMA ignore_check_constraints = OFF");
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({ user_version: 1 });
    expect(sqlite.prepare("SELECT * FROM finds ORDER BY id").all()).toEqual(before);
    expect(sqlite.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all()).toEqual(
      sequence,
    );
    expect(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name = 'finds_v2'").all()).toEqual(
      [],
    );
    expect(photos.files.size).toBe(9);
  });

  it("runs only once: opening the store again leaves version 2 as it is", async () => {
    await versionOne();
    const ids = phaseOneFinds();
    await open();
    const before = sqlite.prepare("SELECT * FROM finds ORDER BY id").all();
    const store = await open();
    expect(sqlite.prepare("SELECT * FROM finds ORDER BY id").all()).toEqual(before);
    await expect(store.get(ids.match)).resolves.toMatchObject({ analysis: { state: "done" } });
  });
});
