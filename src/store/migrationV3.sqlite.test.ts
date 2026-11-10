/**
 * Schema version 3 (PBI-2.15, docs/SPEC.md 3.9 "Answers") on a real SQLite: the migration from
 * version 2, and the constraints version 3 adds. A version 2 database with finds of every kind,
 * the ones the store cannot read included, is opened by the store, which brings it to version 3.
 * Every find is kept, each column as it was, and its answer gets what it was based on (its basis)
 * where the stored data proves it, and none otherwise. A Phase 1 database reaches version 3
 * through version 2.
 */

import type { Answer, ApiAnswer, ApiMatch, Match } from "../analysis/answer";
import {
  type DatabaseSync,
  memoryPhotos,
  memorySqlite,
  sqliteDatabase,
} from "../testing/sqliteDatabase";
import { answerToJson } from "./answerJson";
import { createFindStore } from "./findStore";
import { MIGRATIONS, migrate } from "./schema";

const match: ApiMatch = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};
/** A match analysed in Phase 1, its confidence a level. */
const phaseOneMatch: Match = { ...match, confidence: "low" };

/** The columns of version 2, each copied as it is. */
const V2_COLUMNS = `id, taken_at_ms, utc_offset_min, time_source, latitude, longitude, accuracy_m,
  position_source, text, photos, batches, batch_open, state, failure_cause, failure_detail,
  answer_json, model, analysed_at_ms, result, name_sv, name_en, name_it, edibility, confidence,
  confidence_score, added_photos, picture_file, picture_author, picture_licence, picture_page,
  self_check, check_name_sv, check_name_en, check_name_la, check_name_it`;

let sqlite: DatabaseSync;
let photos: ReturnType<typeof memoryPhotos>;
let photoCount: number;

/** A database at schema version 2, as Phase 2's first builds left it. */
async function versionTwo(): Promise<void> {
  await migrate(sqliteDatabase(sqlite), MIGRATIONS.slice(0, 2));
}

function open() {
  return createFindStore(sqliteDatabase(sqlite), photos, {
    newPhotoName: () => {
      photoCount += 1;
      return `n${photoCount}`;
    },
  });
}

type Store = Awaited<ReturnType<typeof open>>;

beforeEach(() => {
  sqlite = memorySqlite();
  photos = memoryPhotos();
  photoCount = 0;
});

afterEach(() => {
  sqlite.close();
});

const TIME = { takenAtMs: 1_000, utcOffsetMinutes: 60, source: "saved" } as const;

/** A photo find saved by the store. */
function savePhotoFind(store: Store, takenAtMs = 1_000): Promise<number> {
  return store.add({
    photoUri: "file:///cache/a.jpg",
    time: { ...TIME, takenAtMs },
    position: null,
  });
}

/** A text find saved by the store, with no photo. */
function saveTextFind(store: Store): Promise<number> {
  return store.addText({ text: "A yellow funnel.", time: TIME, position: null });
}

/** Adds a photo to the find in a batch of its own, completed. */
async function addBatch(store: Store, id: number): Promise<void> {
  await store.addPhoto(id, "file:///cache/b.jpg");
  await store.completeBatch(id);
}

/** Stores the answer as one from an analysis of all the find's photos, none for a text find. */
async function answer(store: Store, id: number, given: ApiAnswer): Promise<void> {
  const stored = await store.getStored(id);
  await store.setAnswer(
    id,
    { answer: given, model: "m", analysedAtMs: 1 },
    { photoUris: (stored?.photos ?? []).map((photo) => photo.uri) },
  );
}

type Row = Record<string, bigint | number | string | null>;

/** Inserts a row into the finds table as it stands, past the CHECKs when asked; gives its ID. */
function insert(row: Row, pastChecks = false): number {
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

/** Runs an UPDATE of the find past the CHECKs, as a damaged file could hold its result. */
function damage(sql: string, id: number): void {
  sqlite.exec("PRAGMA ignore_check_constraints = ON");
  try {
    sqlite.prepare(sql).run(id);
  } finally {
    sqlite.exec("PRAGMA ignore_check_constraints = OFF");
  }
}

/** A version 2 photo find with the photos given, in batch 1, its batch complete. */
function photoFind(files: string[], takenAtMs: number): Row {
  for (const file of files) {
    photos.files.add(file);
  }
  return {
    taken_at_ms: takenAtMs,
    utc_offset_min: 60,
    time_source: "saved",
    photos: JSON.stringify(files.map((file) => ({ file, batch: 1 }))),
    batches: 1,
    batch_open: 0,
    state: "waiting",
  };
}

/**
 * A version 2 text find with the photos given, all in the last of `batches` batches begun: 0 for a
 * find that never had a photo.
 */
function textFind(files: string[], batches: number, takenAtMs: number): Row {
  for (const file of files) {
    photos.files.add(file);
  }
  return {
    taken_at_ms: takenAtMs,
    utc_offset_min: 60,
    time_source: "saved",
    text: "A yellow funnel with false gills.",
    photos: JSON.stringify(files.map((file) => ({ file, batch: batches }))),
    batches,
    batch_open: 0,
    state: "waiting",
  };
}

/** The columns of a done find with the answer, as the version 2 store wrote them. */
function done(given: Answer, addedPhotos = "analysed"): Row {
  const columns: Row = {
    state: "done",
    answer_json: answerToJson(given),
    model: "claude-opus-5-5",
    analysed_at_ms: 1_762_700_000_000,
    result: given.result,
    added_photos: addedPhotos,
  };
  if (given.result !== "match") {
    return columns;
  }
  const level = typeof given.confidence === "string";
  return {
    ...columns,
    name_sv: given.names.sv,
    name_en: given.names.en,
    name_it: given.names.it,
    edibility: given.edibility,
    confidence: level ? given.confidence : null,
    confidence_score: level ? null : given.confidence,
  };
}

const picture: Row = {
  picture_file: "w1.jpg",
  picture_author: "A. Photographer",
  picture_licence: "CC BY-SA 4.0",
  picture_page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
};

/**
 * The finds of every kind a version 2 store wrote, with the basis each is to get, grouped by the
 * rule that gives it.
 */
function versionTwoFinds() {
  photos.files.add("w1.jpg");
  const finds = {
    // No text: a find's text is set only when it is saved, so this find never had one, and every
    // analysis of it sent its photos.
    photoMatch: insert({ ...photoFind(["a.jpg"], 1_000), ...done(match) }),
    photoNoMushroom: insert({ ...photoFind(["b.jpg"], 2_000), ...done({ result: "no_mushroom" }) }),
    photoCannotTell: insert({ ...photoFind(["c.jpg"], 3_000), ...done({ result: "cannot_tell" }) }),
    phaseOneLevel: insert({ ...photoFind(["d.jpg"], 4_000), ...done(phaseOneMatch) }),
    // A self-check: every version 2 store started one exactly when the analysis sent no photo,
    // the answer named a species and the find had text, and only a new answer ended it.
    textCheckWaiting: insert({
      ...textFind([], 0, 5_000),
      ...done(match),
      self_check: "waiting",
    }),
    textCheckAgreedPhotosSince: insert({
      ...textFind(["e.jpg"], 1, 6_000),
      ...done(match, "waiting"),
      ...picture,
      self_check: "agreed",
    }),
    textCheckNoPicture: insert({
      ...textFind([], 0, 7_000),
      ...done(match),
      self_check: "no-picture",
    }),
    // A text find's answer naming a species without a self-check: by the same rule, its analysis
    // sent photos.
    textPhotosMatch: insert({ ...textFind(["f.jpg"], 1, 8_000), ...done(match) }),
    textPhotosRemovedMatch: insert({ ...textFind([], 1, 9_000), ...done(match) }),
    // A text find that never had a photo (no batch begun; the count never goes down): every
    // analysis of it was of its text alone.
    textOnlyNoMushroom: insert({ ...textFind([], 0, 10_000), ...done({ result: "no_mushroom" }) }),
    textOnlyCannotTell: insert({ ...textFind([], 0, 11_000), ...done({ result: "cannot_tell" }) }),
    // Not proven: a text find that has had a photo, whose answer names no species.
    textWithPhotosNoMushroom: insert({
      ...textFind(["g.jpg"], 1, 12_000),
      ...done({ result: "no_mushroom" }),
    }),
    textPhotosRemovedCannotTell: insert({
      ...textFind([], 2, 13_000),
      ...done({ result: "cannot_tell" }),
    }),
    // No answer: no basis.
    waitingPhoto: insert(photoFind(["h.jpg"], 14_000)),
    waitingText: insert(textFind([], 0, 15_000)),
    failedText: insert({
      ...textFind([], 0, 16_000),
      state: "failed",
      failure_cause: "refused",
      failure_detail: "stop_reason refusal",
    }),
  };
  const basis: Record<keyof typeof finds, "text" | "photos" | null> = {
    photoMatch: "photos",
    photoNoMushroom: "photos",
    photoCannotTell: "photos",
    phaseOneLevel: "photos",
    textCheckWaiting: "text",
    textCheckAgreedPhotosSince: "text",
    textCheckNoPicture: "text",
    textPhotosMatch: "photos",
    textPhotosRemovedMatch: "photos",
    textOnlyNoMushroom: "text",
    textOnlyCannotTell: "text",
    textWithPhotosNoMushroom: null,
    textPhotosRemovedCannotTell: null,
    waitingPhoto: null,
    waitingText: null,
    failedText: null,
  };
  return { finds, basis };
}

function basisOf(id: number): unknown {
  return sqlite.prepare("SELECT answer_basis FROM finds WHERE id = ?").get(id);
}

describe("the migration to schema version 3, on a version 2 database (PBI-2.15)", () => {
  it("brings the database to version 3 when the store opens it, still STRICT", async () => {
    await versionTwo();
    versionTwoFinds();
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    await open();
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({ user_version: 3 });
    expect(
      sqlite.prepare("SELECT strict FROM pragma_table_list WHERE name = 'finds'").get(),
    ).toEqual({ strict: 1 });
  });

  it("gives each answer the basis its stored data proves, and none where it proves nothing", async () => {
    await versionTwo();
    const { finds, basis } = versionTwoFinds();
    await open();
    for (const [name, id] of Object.entries(finds)) {
      expect([name, basisOf(id)]).toEqual([
        name,
        { answer_basis: basis[name as keyof typeof finds] },
      ]);
    }
  });

  it("keeps every column of every find as it was", async () => {
    await versionTwo();
    versionTwoFinds();
    const columns = `SELECT ${V2_COLUMNS} FROM finds ORDER BY id`;
    const before = sqlite.prepare(columns).all();
    await open();
    expect(sqlite.prepare(columns).all()).toEqual(before);
  });

  it("reads every find with its basis, through getStored and the list, none of them unreadable", async () => {
    await versionTwo();
    const { finds, basis } = versionTwoFinds();
    const store = await open();
    for (const [name, id] of Object.entries(finds)) {
      const stored = await store.getStored(id);
      expect([name, stored?.answerBasis]).toEqual([name, basis[name as keyof typeof finds]]);
    }
    const list = await store.list();
    expect(list).toHaveLength(Object.keys(finds).length);
    for (const entry of list) {
      const name = Object.entries(finds).find(([, id]) => id === entry.id)?.[0];
      expect([name, entry.readable && entry.answerBasis]).toEqual([
        name,
        basis[name as keyof typeof finds],
      ]);
    }
  });

  it("keeps a Phase 1 find's level, and a find whose basis was left empty gets one with its next answer", async () => {
    await versionTwo();
    const { finds } = versionTwoFinds();
    const store = await open();
    await expect(store.getStored(finds.phaseOneLevel)).resolves.toMatchObject({
      analysis: { answer: { confidence: "low" } },
      answerBasis: "photos",
    });
    await store.replaceAnswer(
      finds.textWithPhotosNoMushroom,
      { answer: match, model: "claude-opus-5-5", analysedAtMs: 1_762_800_000_000 },
      { photoUris: ["file:///photos/g.jpg"] },
    );
    expect(basisOf(finds.textWithPhotosNoMushroom)).toEqual({ answer_basis: "photos" });
  });

  it("keeps the finds that wait for the queue waiting, oldest first", async () => {
    await versionTwo();
    const { finds } = versionTwoFinds();
    const store = await open();
    // The text answer whose self-check waits without a picture was saved first (PBI-2.9).
    await expect(store.oldestWaiting()).resolves.toBe(finds.textCheckWaiting);
  });

  it("keeps every file of every find when the store opens", async () => {
    await versionTwo();
    versionTwoFinds();
    photos.files.add("stray.jpg");
    await open();
    expect([...photos.files].sort()).toEqual(
      ["a", "b", "c", "d", "e", "f", "g", "h", "w1"].map((name) => `${name}.jpg`),
    );
  });

  it("keeps the finds the store could not read, each as it was, still listed so they can be deleted", async () => {
    await versionTwo();
    const { finds } = versionTwoFinds();
    // Passes the CHECKs, but its answer is not of the shape.
    const badAnswer = insert({ ...textFind([], 0, 20_000), ...done(match), answer_json: "{" });
    // Past the CHECKs, as a damaged file could hold them.
    const unknownTimeSource = insert(
      { ...photoFind(["u2.jpg"], 21_000), time_source: "gps" },
      true,
    );
    const checkWithoutText = insert(
      { ...photoFind(["u3.jpg"], 22_000), ...done(match), self_check: "waiting" },
      true,
    );
    const columns = `SELECT ${V2_COLUMNS} FROM finds ORDER BY id`;
    const before = sqlite.prepare(columns).all();
    const store = await open();
    expect(sqlite.prepare(columns).all()).toEqual(before);
    const list = await store.list();
    expect(list.slice(0, 3)).toEqual([
      { readable: false, id: checkWithoutText },
      { readable: false, id: unknownTimeSource },
      { readable: false, id: badAnswer },
    ]);
    expect(list.slice(3).every((entry) => entry.readable)).toBe(true);
    await expect(store.getStored(badAnswer)).rejects.toMatchObject({ code: "corrupt" });
    await expect(store.delete(checkWithoutText)).resolves.toEqual({ photoRemoved: true });
    expect(photos.files.has("u3.jpg")).toBe(false);
    await expect(store.getStored(finds.photoMatch)).resolves.toMatchObject({
      answerBasis: "photos",
    });
  });

  /**
   * Rows that break a version 2 CHECK, so only a damaged file holds them, and that the version 2
   * store reads (the review's probe on main): an answer's columns on a waiting or a failed find,
   * which the store reads by its state; and an answer whose JSON names a species while its result
   * column says no mushroom, which the store reads by its JSON. Each with what the store reads.
   */
  function damagedReadableRows() {
    const answerColumns = { ...done({ result: "no_mushroom" }), added_photos: null };
    const matchAsNoMushroom = { ...done(match), result: "no_mushroom" };
    const read = {
      done: { analysis: { state: "done", answer: match }, answerBasis: "photos", selfCheck: null },
    };
    return {
      "a waiting find with an answer's columns set": {
        id: insert({ ...photoFind(["r1.jpg"], 1_000), ...answerColumns, state: "waiting" }, true),
        read: { analysis: { state: "waiting" }, answerBasis: null },
      },
      "a failed find with an answer's columns set": {
        id: insert(
          {
            ...photoFind(["r2.jpg"], 2_000),
            ...answerColumns,
            state: "failed",
            failure_cause: "request",
            failure_detail: "status 400",
          },
          true,
        ),
        read: {
          analysis: { state: "failed", failure: { cause: "request", detail: "status 400" } },
          answerBasis: null,
        },
      },
      "a text find that never had a photo, its JSON a match and its result column no mushroom": {
        id: insert({ ...textFind([], 0, 3_000), ...matchAsNoMushroom }, true),
        read: read.done,
      },
      "the same with one photo": {
        id: insert({ ...textFind(["r3.jpg"], 1, 4_000), ...matchAsNoMushroom }, true),
        read: read.done,
      },
    };
  }

  it.each([
    "a waiting find with an answer's columns set",
    "a failed find with an answer's columns set",
    "a text find that never had a photo, its JSON a match and its result column no mushroom",
    "the same with one photo",
  ] as const)(
    "keeps readable, in getStored and the list, a damaged row the version 2 store reads: %s (review of #84, fix 1)",
    async (name) => {
      await versionTwo();
      const { id, read } = damagedReadableRows()[name];
      const store = await open();
      await expect(store.getStored(id)).resolves.toMatchObject(read);
      const list = await store.list();
      expect(list).toHaveLength(4);
      expect(list.find((entry) => entry.id === id)).toMatchObject({ readable: true });
    },
  );

  it("keeps a damaged waiting row with an answer's columns set the queue's pick, as on version 2 (review of #84, fix 1)", async () => {
    await versionTwo();
    const rows = damagedReadableRows();
    const store = await open();
    await expect(store.oldestWaiting()).resolves.toBe(
      rows["a waiting find with an answer's columns set"].id,
    );
    // The list's summary of the match read as no mushroom keeps its result column, as on version 2.
    expect((await store.list())[0]).toMatchObject({
      id: rows["the same with one photo"].id,
      analysis: { state: "done", result: "no_mushroom" },
    });
  });

  it("leaves every migrated row within the version 3 CHECKs (review of #84, note 2)", async () => {
    await versionTwo();
    const { finds } = versionTwoFinds();
    await open();
    expect(sqlite.prepare("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }]);
    // The check sees a row that breaks a CHECK version 3 added, so the "ok" above is not empty.
    damage("UPDATE finds SET answer_basis = NULL WHERE id = ?", finds.photoMatch);
    expect(sqlite.prepare("PRAGMA integrity_check").all()).not.toEqual([{ integrity_check: "ok" }]);
  });

  it("keeps AUTOINCREMENT's high-water mark, so the ID of a find deleted in version 2 is not given again", async () => {
    await versionTwo();
    const kept = insert(photoFind(["a.jpg"], 1_000));
    const deleted = insert(photoFind(["b.jpg"], 2_000));
    sqlite.prepare("DELETE FROM finds WHERE id = ?").run(deleted);
    const store = await open();
    expect(kept).toBe(deleted - 1);
    await expect(savePhotoFind(store, 3_000)).resolves.toBe(deleted + 1);
  });

  it("migrates an empty version 2 database, whose first find then has the ID 1", async () => {
    await versionTwo();
    const store = await open();
    await expect(store.list()).resolves.toEqual([]);
    await expect(saveTextFind(store)).resolves.toBe(1);
  });

  it("leaves the CHECKs on once it is done, and keeps the Library's index", async () => {
    await versionTwo();
    versionTwoFinds();
    await open();
    expect(sqlite.prepare("PRAGMA ignore_check_constraints").get()).toEqual({
      ignore_check_constraints: 0,
    });
    expect(() => sqlite.prepare("UPDATE finds SET answer_basis = 'guess'").run()).toThrow(
      /CHECK constraint failed/,
    );
    expect(
      sqlite
        .prepare("SELECT tbl_name FROM sqlite_schema WHERE type = 'index' AND name = ?")
        .get("finds_newest_first"),
    ).toEqual({ tbl_name: "finds" });
  });

  it("changes nothing when it fails after the version 2 table is dropped: the database stays at version 2 with every find", async () => {
    await versionTwo();
    versionTwoFinds();
    const deleted = insert(photoFind(["z.jpg"], 30_000));
    sqlite.prepare("DELETE FROM finds WHERE id = ?").run(deleted);
    const before = sqlite.prepare("SELECT * FROM finds ORDER BY id").all();
    const sequence = sqlite.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all();
    const files = [...photos.files].sort();
    // A view on the table survives `DROP TABLE finds`, then makes the RENAME fail.
    sqlite.exec("CREATE VIEW blocker AS SELECT photos FROM finds");
    await expect(open()).rejects.toThrow(/blocker/);
    sqlite.exec("PRAGMA ignore_check_constraints = OFF");
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(sqlite.prepare("SELECT * FROM finds ORDER BY id").all()).toEqual(before);
    expect(sqlite.prepare("SELECT name, seq FROM sqlite_sequence ORDER BY name").all()).toEqual(
      sequence,
    );
    expect(sqlite.prepare("SELECT name FROM sqlite_schema WHERE name = 'finds_v3'").all()).toEqual(
      [],
    );
    expect([...photos.files].sort()).toEqual(files);
  });

  it("runs only once: opening the store again leaves version 3 as it is", async () => {
    await versionTwo();
    const { finds } = versionTwoFinds();
    await open();
    const before = sqlite.prepare("SELECT * FROM finds ORDER BY id").all();
    const store = await open();
    expect(sqlite.prepare("SELECT * FROM finds ORDER BY id").all()).toEqual(before);
    await expect(store.getStored(finds.textOnlyNoMushroom)).resolves.toMatchObject({
      answerBasis: "text",
    });
  });
});

describe("a Phase 1 database, through versions 2 and 3 (PBI-2.15)", () => {
  /** Inserts a find into the version 1 table as the Phase 1 store wrote it; gives its ID. */
  function insertV1(file: string, takenAtMs: number, columns: Row = {}): number {
    photos.files.add(file);
    return insert({
      taken_at_ms: takenAtMs,
      utc_offset_min: 60,
      time_source: "saved",
      photo_file: file,
      state: "waiting",
      ...columns,
    });
  }

  /** The columns of a done find with the answer, as the Phase 1 store wrote them. */
  function doneV1(given: Answer): Row {
    const columns: Row = {
      state: "done",
      answer_json: answerToJson(given),
      model: "claude-opus-5-5",
      analysed_at_ms: 1_762_700_000_000,
      result: given.result,
    };
    if (given.result !== "match") {
      return columns;
    }
    return {
      ...columns,
      name_sv: given.names.sv,
      name_en: given.names.en,
      name_it: given.names.it,
      edibility: given.edibility,
      confidence: String(given.confidence),
    };
  }

  it("brings a version 1 database to version 3, each Phase 1 answer from its photo", async () => {
    await migrate(sqliteDatabase(sqlite), [MIGRATIONS[0] ?? ""]);
    const ids = {
      match: insertV1("a.jpg", 1_000, doneV1(phaseOneMatch)),
      noMushroom: insertV1("b.jpg", 2_000, doneV1({ result: "no_mushroom" })),
      cannotTell: insertV1("c.jpg", 3_000, doneV1({ result: "cannot_tell" })),
      waiting: insertV1("d.jpg", 4_000),
      failed: insertV1("e.jpg", 5_000, {
        state: "failed",
        failure_cause: "segment-check",
        failure_detail: "0xFFE1",
      }),
    };
    const store = await open();
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({ user_version: 3 });
    expect(sqlite.prepare("SELECT id, answer_basis FROM finds ORDER BY id").all()).toEqual([
      { id: ids.match, answer_basis: "photos" },
      { id: ids.noMushroom, answer_basis: "photos" },
      { id: ids.cannotTell, answer_basis: "photos" },
      { id: ids.waiting, answer_basis: null },
      { id: ids.failed, answer_basis: null },
    ]);
    await expect(store.getStored(ids.match)).resolves.toEqual({
      id: ids.match,
      text: null,
      photos: [{ uri: "file:///photos/a.jpg", batch: 1 }],
      batchOpen: false,
      time: { takenAtMs: 1_000, utcOffsetMinutes: 60, source: "saved" },
      position: null,
      analysis: {
        state: "done",
        answer: phaseOneMatch,
        model: "claude-opus-5-5",
        analysedAtMs: 1_762_700_000_000,
      },
      answerBasis: "photos",
      addedPhotos: "analysed",
      picture: null,
      selfCheck: null,
    });
    const list = await store.list();
    expect(list.every((entry) => entry.readable)).toBe(true);
    expect(list.find((entry) => entry.id === ids.noMushroom)).toMatchObject({
      answerBasis: "photos",
    });
  });
});

describe("the constraints of schema version 3 on a real SQLite (PBI-2.15)", () => {
  /** A text find the store saved, with a photo or none, answered from all it holds. */
  async function answeredTextFind(given: ApiAnswer, withPhoto: boolean): Promise<number> {
    const store = await open();
    const id = await saveTextFind(store);
    if (withPhoto) {
      await addBatch(store, id);
    }
    await answer(store, id, given);
    return id;
  }

  /** A photo find the store saved, answered from its photo. */
  async function answeredPhotoFind(given: ApiAnswer): Promise<number> {
    const store = await open();
    const id = await savePhotoFind(store);
    await answer(store, id, given);
    return id;
  }

  const refused = (sql: string, id: number) =>
    expect(() => sqlite.prepare(sql).run(id)).toThrow(/CHECK constraint failed/);

  it("refuses a basis it does not know", async () => {
    refused(
      "UPDATE finds SET answer_basis = 'guess' WHERE id = ?",
      await answeredTextFind(match, true),
    );
  });

  it("refuses a basis on a find without an answer", async () => {
    refused(
      "UPDATE finds SET answer_basis = 'text' WHERE id = ?",
      await saveTextFind(await open()),
    );
  });

  it("refuses an answer from the text alone on a find without text", async () => {
    refused(
      "UPDATE finds SET answer_basis = 'text' WHERE id = ?",
      await answeredPhotoFind({ result: "no_mushroom" }),
    );
  });

  it("refuses an answer from photos that has a self-check, and one from the text alone naming a species without one", async () => {
    refused(
      "UPDATE finds SET answer_basis = 'photos' WHERE id = ?",
      await answeredTextFind(match, false),
    );
    refused(
      "UPDATE finds SET answer_basis = 'text' WHERE id = ?",
      await answeredTextFind(match, true),
    );
  });

  it("refuses an answer without a basis where every answer has one: a find without text, an answer naming a species, a text find that never had a photo", async () => {
    const empty = "UPDATE finds SET answer_basis = NULL WHERE id = ?";
    refused(empty, await answeredPhotoFind({ result: "cannot_tell" }));
    refused(empty, await answeredTextFind(match, true));
    refused(empty, await answeredTextFind({ result: "no_mushroom" }, false));
  });

  it("accepts an answer without a basis on a text find that has had a photo, when the answer names no species, and the store reads it", async () => {
    const id = await answeredTextFind({ result: "no_mushroom" }, true);
    expect(() =>
      sqlite.prepare("UPDATE finds SET answer_basis = NULL WHERE id = ?").run(id),
    ).not.toThrow();
    await expect((await open()).getStored(id)).resolves.toMatchObject({ answerBasis: null });
  });
});

describe("a basis that does not fit the find, which only a damaged file can hold (PBI-2.15)", () => {
  /** Ways to damage a find the store saved and answered; each gives the find's ID. */
  const damaged: [string, (store: Store) => Promise<number>][] = [
    [
      "a basis it does not know",
      async (store) => {
        const id = await saveTextFind(store);
        await answer(store, id, { result: "no_mushroom" });
        damage("UPDATE finds SET answer_basis = 'guess' WHERE id = ?", id);
        return id;
      },
    ],
    [
      "a basis on a find without an answer",
      async (store) => {
        const id = await savePhotoFind(store);
        damage("UPDATE finds SET answer_basis = 'photos' WHERE id = ?", id);
        return id;
      },
    ],
    [
      "an answer from the text alone on a find without text",
      async (store) => {
        const id = await savePhotoFind(store);
        await answer(store, id, { result: "no_mushroom" });
        damage("UPDATE finds SET answer_basis = 'text' WHERE id = ?", id);
        return id;
      },
    ],
    [
      "an answer from photos with a self-check",
      async (store) => {
        const id = await saveTextFind(store);
        await answer(store, id, match);
        damage("UPDATE finds SET answer_basis = 'photos' WHERE id = ?", id);
        return id;
      },
    ],
    [
      "an answer from the text alone naming a species, without a self-check",
      async (store) => {
        const id = await saveTextFind(store);
        await answer(store, id, match);
        damage("UPDATE finds SET self_check = NULL WHERE id = ?", id);
        return id;
      },
    ],
    [
      "no basis on the answer of a find without text",
      async (store) => {
        const id = await savePhotoFind(store);
        await answer(store, id, { result: "cannot_tell" });
        damage("UPDATE finds SET answer_basis = NULL WHERE id = ?", id);
        return id;
      },
    ],
    [
      "no basis on an answer naming a species",
      async (store) => {
        const id = await saveTextFind(store);
        await addBatch(store, id);
        await answer(store, id, match);
        damage("UPDATE finds SET answer_basis = NULL WHERE id = ?", id);
        return id;
      },
    ],
    [
      "no basis on the answer of a text find that never had a photo",
      async (store) => {
        const id = await saveTextFind(store);
        await answer(store, id, { result: "no_mushroom" });
        damage("UPDATE finds SET answer_basis = NULL WHERE id = ?", id);
        return id;
      },
    ],
  ];

  it.each(damaged)(
    "marks a find with %s unreadable in the list, by its ID, which getStored refuses and delete still removes",
    async (_name, damageFind) => {
      const store = await open();
      const other = await savePhotoFind(store, 500);
      const id = await damageFind(store);
      await expect(store.list()).resolves.toEqual([
        { readable: false, id },
        expect.objectContaining({ readable: true, id: other }),
      ]);
      await expect(store.getStored(id)).rejects.toMatchObject({ code: "corrupt" });
      await expect(store.delete(id)).resolves.toEqual({ photoRemoved: true });
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ readable: true, id: other }),
      ]);
    },
  );

  it("passes over a damaged find whose added photos wait, in the queue's pick, and takes the next", async () => {
    const store = await open();
    const id = await savePhotoFind(store);
    await answer(store, id, { result: "cannot_tell" });
    await addBatch(store, id);
    const next = await savePhotoFind(store, 2_000);
    damage("UPDATE finds SET answer_basis = 'text' WHERE id = ?", id);
    await expect(store.oldestWaiting()).resolves.toBe(next);
  });
});
