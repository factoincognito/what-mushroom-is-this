import type { SQLiteBindParams } from "expo-sqlite";

import type { Answer, Match } from "../analysis/answer";
import { answerToJson } from "./answerJson";
import type { FindDatabase, SqlRunner } from "./database";
import { type AnalysedAnswer, type NewFind, StoreError } from "./find";
import { createFindStore, type FindStore, type LookupStore } from "./findStore";
import type { PhotoFiles } from "./photoFiles";
import { MIGRATIONS } from "./schema";

type Method = "exec" | "run" | "first" | "all";
type Event =
  | { method: Method; sql: string; params: readonly unknown[] }
  | { tx: "begin" | "commit" | "rollback" }
  | { photo: string };

const sqlOf = (source: string) => source.replace(/\s+/g, " ").trim();

/**
 * Stands in for expo-sqlite at the module's boundary: records each statement and its
 * parameters, and gives the reply set for the statement, or a default.
 */
class FakeDatabase implements FindDatabase {
  private readonly replies: { method: Method; sql: string; value: unknown }[] = [];

  constructor(readonly events: Event[]) {
    this.reply("first", "PRAGMA user_version", { user_version: MIGRATIONS.length });
  }

  /**
   * The reply to a statement; an Error is thrown, and a function is called with the statement's
   * parameters to give the reply. A later reply to the same statement wins.
   */
  reply(method: Method, sql: string, value: unknown): void {
    this.replies.unshift({ method, sql: sqlOf(sql), value });
  }

  private answer(method: Method, source: string, params: readonly unknown[]): unknown {
    const sql = sqlOf(source);
    this.events.push({ method, sql, params });
    const found = this.replies.find((reply) => reply.method === method && reply.sql === sql);
    if (found === undefined) {
      return { exec: undefined, run: { changes: 1, lastInsertRowId: 1 }, first: null, all: [] }[
        method
      ];
    }
    const value = typeof found.value === "function" ? found.value(params) : found.value;
    if (value instanceof Error) {
      throw value;
    }
    return value;
  }

  async execAsync(source: string): Promise<void> {
    this.answer("exec", source, []);
  }

  async runAsync(source: string, params: SQLiteBindParams) {
    const value = this.answer("run", source, toList(params));
    if (!isRunResult(value)) {
      throw new Error("the reply to a run is not a run result");
    }
    return value;
  }

  async getFirstAsync(source: string, params: SQLiteBindParams): Promise<unknown> {
    return this.answer("first", source, toList(params));
  }

  async getAllAsync(source: string, params: SQLiteBindParams): Promise<unknown[]> {
    const value = this.answer("all", source, toList(params));
    if (!Array.isArray(value)) {
      throw new Error("the reply to getAll is not an array");
    }
    return value;
  }

  async withExclusiveTransactionAsync(task: (txn: SqlRunner) => Promise<void>): Promise<void> {
    this.events.push({ tx: "begin" });
    try {
      await task(this);
      this.events.push({ tx: "commit" });
    } catch (error) {
      this.events.push({ tx: "rollback" });
      throw error;
    }
  }
}

function toList(params: SQLiteBindParams): readonly unknown[] {
  return Array.isArray(params) ? params : [params];
}

function isRunResult(value: unknown): value is { changes: number; lastInsertRowId: number } {
  return typeof value === "object" && value !== null && "changes" in value;
}

/** Stands in for the photo directory: the names in it, and the names whose removal fails. */
class FakePhotos implements PhotoFiles {
  readonly files = new Set<string>();
  readonly stuck = new Set<string>();
  copyError: Error | null = null;
  uriError: Error | null = null;

  constructor(readonly events: Event[]) {}

  prepare(): void {
    this.events.push({ photo: "prepare" });
  }

  async copyIn(sourceUri: string, baseName: string): Promise<string> {
    this.events.push({ photo: `copy ${sourceUri} as ${baseName}` });
    if (this.copyError !== null) {
      throw this.copyError;
    }
    const name = `${baseName}.jpg`;
    this.files.add(name);
    return name;
  }

  remove(name: string): void {
    this.events.push({ photo: `remove ${name}` });
    if (this.stuck.has(name)) {
      throw new Error("the file is busy");
    }
    this.files.delete(name);
  }

  list(): string[] {
    return [...this.files];
  }

  uriOf(name: string): string {
    if (this.uriError !== null) {
      throw this.uriError;
    }
    return `file:///doc/photos/${name}`;
  }
}

/** One past the highest readable ID, in the table or AUTOINCREMENT's mark (PBI-1.27). */
const NEXT_ID =
  "1 + MAX( COALESCE((SELECT MAX(id) FROM finds WHERE id BETWEEN 1 AND 9007199254740991), 0), COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'finds' AND seq BETWEEN 1 AND 9007199254740991), 0))";
/** A new photo find: its photo the first, in batch 1, the batch complete or open (PBI-2.2). */
const insertPhotoFind = (batchOpen: 0 | 1) =>
  `INSERT INTO finds (id, taken_at_ms, utc_offset_min, time_source, latitude, longitude, accuracy_m, position_source, photos, batches, batch_open, state) VALUES (${NEXT_ID}, ?, ?, ?, ?, ?, ?, ?, json_array(json_object('file', ?, 'batch', 1)), 1, ${batchOpen}, 'waiting')`;
const INSERT = insertPhotoFind(0);
const INSERT_OPEN = insertPhotoFind(1);
const INSERT_TEXT = `INSERT INTO finds (id, taken_at_ms, utc_offset_min, time_source, latitude, longitude, accuracy_m, position_source, text, photos, batches, batch_open, state) VALUES (${NEXT_ID}, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, 0, 'waiting')`;
/** The number of photos, or NULL when the stored list is not JSON (PBI-2.2). */
const PHOTO_COUNT = "(CASE WHEN json_valid(photos) THEN json_array_length(photos) END)";
const SAFE_BATCHES = "CASE WHEN batches BETWEEN 0 AND 9007199254740991 THEN batches END AS batches";
const SAFE_BATCH_OPEN = "CASE WHEN batch_open IN (0, 1) THEN batch_open END AS batch_open";
/** A time column, given back only within JavaScript's safe-integer range, else as NULL. */
const safeTime = (column: string) =>
  `CASE WHEN ${column} BETWEEN -9007199254740991 AND 9007199254740991 THEN ${column} END AS ${column}`;
/** The UTC offset, given back only within the schema's 18 hours, else as NULL. */
const SAFE_OFFSET =
  "CASE WHEN utc_offset_min BETWEEN -1080 AND 1080 THEN utc_offset_min END AS utc_offset_min";
/** The ID, given back only as a positive safe integer, else as NULL (PBI-1.26). */
const SAFE_ID = "CASE WHEN id BETWEEN 1 AND 9007199254740991 THEN id END AS id";
const FIND_COLUMNS = `${SAFE_ID}, ${safeTime("taken_at_ms")}, ${SAFE_OFFSET}, time_source, latitude, longitude, accuracy_m, position_source, text, photos, ${SAFE_BATCHES}, ${SAFE_BATCH_OPEN}, state, failure_cause, failure_detail, answer_json, model, ${safeTime("analysed_at_ms")}, added_photos, picture_file, picture_author, picture_licence, picture_page, self_check, check_name_sv, check_name_en, check_name_la, check_name_it`;
const GET = `SELECT ${FIND_COLUMNS} FROM finds WHERE finds.id = ?`;
const NEXT_WAITING = `SELECT ${FIND_COLUMNS} FROM finds WHERE state = 'waiting' AND batch_open = 0 AND finds.id > ? AND finds.id <= 9007199254740991 ORDER BY finds.id ASC LIMIT 1`;
const LIST = `SELECT ${FIND_COLUMNS}, CAST(finds.id AS TEXT) AS stored_id, result, name_sv, name_en, name_it, edibility, confidence, confidence_score FROM finds ORDER BY finds.taken_at_ms DESC, finds.id DESC`;
/** Only among the IDs the store cannot read: a readable find is deleted by `delete` alone. */
const UNREADABLE_ID = "(id < 1 OR id > 9007199254740991)";
const FILES_OF_STORED = `SELECT photos, picture_file FROM finds WHERE CAST(id AS TEXT) = ? AND ${UNREADABLE_ID}`;
const DELETE_STORED = `DELETE FROM finds WHERE CAST(id AS TEXT) = ? AND ${UNREADABLE_ID}`;
/**
 * An answer's columns (review of #49, fix 1): the photos added since are waiting when the find now
 * holds one the analysis did not send; the self-check waits only for a match from no photo.
 */
const ANSWER_COLUMNS = `state = 'done', failure_cause = NULL, failure_detail = NULL, answer_json = ?, model = ?, analysed_at_ms = ?, result = ?, name_sv = ?, name_en = ?, name_it = ?, edibility = ?, confidence = ?, confidence_score = ?, added_photos = CASE WHEN EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(finds.photos) THEN finds.photos ELSE '[]' END) WHERE json_extract(value, '$.file') NOT IN (SELECT value FROM json_each(?))) THEN 'waiting' ELSE 'analysed' END, picture_file = NULL, picture_author = NULL, picture_licence = NULL, picture_page = NULL, self_check = CASE WHEN ? = 0 AND ? = 'match' AND text IS NOT NULL THEN 'waiting' END, check_name_sv = NULL, check_name_en = NULL, check_name_la = NULL, check_name_it = NULL`;
const SET_ANSWER = `UPDATE finds SET ${ANSWER_COLUMNS} WHERE id = ? AND state IN ('waiting', 'failed')`;
const REPLACE_ANSWER = `UPDATE finds SET ${ANSWER_COLUMNS} WHERE id = ? AND state = 'done'`;
const MARK_FAILED =
  "UPDATE finds SET state = 'failed', failure_cause = ?, failure_detail = ? WHERE id = ? AND state IN ('waiting', 'failed')";
const MARK_WAITING =
  "UPDATE finds SET state = 'waiting', failure_cause = NULL, failure_detail = NULL WHERE id = ? AND state = 'failed'";
const STATE_OF = "SELECT state FROM finds WHERE id = ?";
const FILES_OF = "SELECT photos, picture_file FROM finds WHERE id = ?";
const DELETE = "DELETE FROM finds WHERE id = ?";
const ALL_FILES = "SELECT photos, picture_file FROM finds";
/** Completing a batch (PBI-2.2): a failed find waits again, a done one's new photos wait. */
const COMPLETE_SET =
  "batch_open = 0, state = CASE WHEN state = 'failed' THEN 'waiting' ELSE state END, failure_cause = CASE WHEN state = 'failed' THEN NULL ELSE failure_cause END, failure_detail = CASE WHEN state = 'failed' THEN NULL ELSE failure_detail END, added_photos = CASE WHEN state = 'done' THEN 'waiting' ELSE added_photos END";
const COMPLETE_BATCH = `UPDATE finds SET ${COMPLETE_SET} WHERE id = ? AND batch_open = 1`;
const COMPLETE_OPEN_BATCHES = `UPDATE finds SET ${COMPLETE_SET} WHERE batch_open = 1`;
const BATCH_OPEN_OF = `SELECT ${SAFE_BATCH_OPEN} FROM finds WHERE id = ?`;
const NEXT_BATCH = "CASE WHEN batch_open = 1 THEN batches ELSE batches + 1 END";
const ADD_PHOTO = `UPDATE finds SET photos = json_insert(photos, '$[#]', json_object('file', ?, 'batch', ${NEXT_BATCH})), batches = ${NEXT_BATCH}, batch_open = 1 WHERE id = ? AND ${PHOTO_COUNT} < ?`;
const PHOTOS_OF = `SELECT text, photos, ${SAFE_BATCHES} FROM finds WHERE id = ?`;
const REMOVE_PHOTO = `UPDATE finds SET photos = json_remove(photos, ?) WHERE id = ? AND json_extract(photos, ?) = ? AND (text IS NOT NULL OR ${PHOTO_COUNT} > 1)`;
const SET_ADDED_PHOTOS = "UPDATE finds SET added_photos = ? WHERE id = ? AND added_photos = ?";
const ADDED_PHOTOS_OF = "SELECT added_photos FROM finds WHERE id = ?";
const SET_PICTURE =
  "UPDATE finds SET picture_file = ?, picture_author = ?, picture_licence = ?, picture_page = ? WHERE id = ? AND self_check = 'waiting' AND picture_file IS NULL";
const SELF_CHECK_OF = "SELECT self_check FROM finds WHERE id = ?";
const SET_SELF_CHECK =
  "UPDATE finds SET self_check = ?, check_name_sv = ?, check_name_en = ?, check_name_la = ?, check_name_it = ? WHERE id = ? AND self_check = 'waiting' AND picture_file IS NOT NULL";
const SET_NO_PICTURE =
  "UPDATE finds SET self_check = 'no-picture' WHERE id = ? AND self_check = 'waiting' AND picture_file IS NULL";
const SET_POSITION =
  "UPDATE finds SET latitude = ?, longitude = ?, accuracy_m = ?, position_source = ? WHERE id = ? AND position_source IS NULL";
const POSITION_SOURCE_OF = "SELECT position_source FROM finds WHERE id = ?";

const match: Match = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: 90,
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};

/** A match analysed in Phase 1, its confidence a level (SPEC 3.9). */
const phaseOneMatch: Match = { ...match, confidence: "low" };

const analysed: AnalysedAnswer = {
  answer: match,
  model: "claude-model-x",
  analysedAtMs: 1_762_600_000_000,
};

const newFind: NewFind = {
  photoUri: "file:///cache/camera/IMG_1.jpg",
  time: { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" },
  position: { latitude: 59.64, longitude: 17.08, accuracyM: 12.5, source: "fix" },
};

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    taken_at_ms: 1_762_590_000_000,
    utc_offset_min: 60,
    time_source: "saved",
    latitude: 59.64,
    longitude: 17.08,
    accuracy_m: 12.5,
    position_source: "fix",
    text: null,
    photos: '[{"file":"p7.jpg","batch":1}]',
    batches: 1,
    batch_open: 0,
    state: "waiting",
    failure_cause: null,
    failure_detail: null,
    answer_json: null,
    model: null,
    analysed_at_ms: null,
    added_photos: null,
    picture_file: null,
    picture_author: null,
    picture_licence: null,
    picture_page: null,
    self_check: null,
    check_name_sv: null,
    check_name_en: null,
    check_name_la: null,
    check_name_it: null,
    ...overrides,
  };
}

/** A done row whose answer is the match, as the store writes it. */
function doneRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return row({
    state: "done",
    answer_json: answerToJson(match),
    model: "claude-model-x",
    analysed_at_ms: 1_762_600_000_000,
    added_photos: "analysed",
    ...overrides,
  });
}

/** A representative picture's columns, as `setPicture` writes them (PBI-2.2). */
const picture = {
  picture_file: "w1.jpg",
  picture_author: "A. Photographer",
  picture_licence: "CC BY-SA 4.0",
  picture_page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
};

/** The species a disagreeing self-check named (PBI-2.2). */
const checkNames = {
  check_name_sv: "Narrkantarell",
  check_name_en: "False chanterelle",
  check_name_la: "Hygrophoropsis aurantiaca",
  check_name_it: "Falso gallinaccio",
};

/** A text find whose answer from its text alone waits for its self-check (PBI-2.2). */
function textRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return doneRow({
    text: "A yellow funnel with false gills.",
    photos: "[]",
    batches: 0,
    self_check: "waiting",
    ...overrides,
  });
}

/** A row as the list reads it: the whole find, and beside it what the Log shows. */
function summaryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return row({
    result: null,
    name_sv: null,
    name_en: null,
    name_it: null,
    edibility: null,
    confidence: null,
    confidence_score: null,
    ...overrides,
  });
}

/** A done match as the list reads it, its answer stored as the store writes it. */
function doneMatchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return summaryRow({
    state: "done",
    answer_json: answerToJson(match),
    model: "claude-model-x",
    analysed_at_ms: 1_762_600_000_000,
    added_photos: "analysed",
    result: "match",
    name_sv: "Kantarell",
    name_en: "Chanterelle",
    name_it: "Gallinaccio",
    edibility: "edible",
    confidence: null,
    confidence_score: 90,
    ...overrides,
  });
}

/** A done match of Phase 1 as the list reads it: its confidence a level (SPEC 3.9). */
function phaseOneMatchRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return doneMatchRow({
    answer_json: answerToJson(phaseOneMatch),
    confidence: "low",
    confidence_score: null,
    ...overrides,
  });
}

let events: Event[];
let db: FakeDatabase;
let photos: FakePhotos;
let store: FindStore & LookupStore;

async function open(): Promise<FindStore & LookupStore> {
  return createFindStore(db, photos, { newPhotoName: () => "p1" });
}

beforeEach(async () => {
  events = [];
  db = new FakeDatabase(events);
  photos = new FakePhotos(events);
  store = await open();
  events.length = 0;
});

describe("opening the store", () => {
  it("migrates, completes the batches still open, prepares the photo directory, then removes the photos no find refers to", async () => {
    photos.files.add("p7.jpg");
    photos.files.add("orphan.jpg");
    db.reply("all", ALL_FILES, [{ photos: '[{"file":"p7.jpg","batch":1}]', picture_file: null }]);
    await open();
    expect(events).toEqual([
      { method: "first", sql: "PRAGMA user_version", params: [] },
      { method: "run", sql: COMPLETE_OPEN_BATCHES, params: [] },
      { photo: "prepare" },
      { method: "all", sql: ALL_FILES, params: [] },
      { photo: "remove orphan.jpg" },
    ]);
    expect([...photos.files]).toEqual(["p7.jpg"]);
  });

  it("keeps every photo of a find and its representative picture (PBI-2.2)", async () => {
    for (const name of ["p7.jpg", "p8.jpg", "w1.jpg", "orphan.jpg"]) {
      photos.files.add(name);
    }
    db.reply("all", ALL_FILES, [
      { photos: '[{"file":"p7.jpg","batch":1},{"file":"p8.jpg","batch":2}]', picture_file: null },
      { photos: "[]", picture_file: "w1.jpg" },
    ]);
    await open();
    expect([...photos.files].sort()).toEqual(["p7.jpg", "p8.jpg", "w1.jpg"]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a photo list that is not JSON", { photos: "[", picture_file: null }],
    ["a photo list that is not an array", { photos: '{"file":"x.jpg"}', picture_file: null }],
    ["a photo whose name is not text", { photos: '[{"file":3,"batch":1}]', picture_file: null }],
    ["a photo that is not an object", { photos: '["x.jpg"]', picture_file: null }],
    ["a photo list that is not text", { photos: 3, picture_file: null }],
    ["a picture name that is not text", { photos: "[]", picture_file: 3 }],
  ])(
    "still opens when a find holds %s, and then removes no photo, since that find's could be any (PBI-2.2)",
    async (_, stored) => {
      photos.files.add("p7.jpg");
      photos.files.add("unknown.jpg");
      db.reply("all", ALL_FILES, [
        { photos: '[{"file":"p7.jpg","batch":1}]', picture_file: null },
        stored,
      ]);
      await expect(open()).resolves.toBeDefined();
      expect([...photos.files].sort()).toEqual(["p7.jpg", "unknown.jpg"]);
    },
  );

  it("does not open when the open batches cannot be completed", async () => {
    db.reply("run", COMPLETE_OPEN_BATCHES, new Error("database is locked"));
    await expect(open()).rejects.toThrow("database is locked");
    expect(events).not.toContainEqual({ photo: "prepare" });
  });

  it("goes on removing the other orphans when one cannot be removed, and still opens", async () => {
    photos.files.add("a.jpg");
    photos.files.add("b.jpg");
    photos.stuck.add("a.jpg");
    await expect(open()).resolves.toBeDefined();
    expect([...photos.files]).toEqual(["a.jpg"]);
  });

  it("still opens when a find's photo name cannot be read, and then removes no photo, since that find's could be any (PBI-1.26)", async () => {
    photos.files.add("p7.jpg");
    photos.files.add("unknown.jpg");
    db.reply("all", ALL_FILES, [
      { photos: '[{"file":"p7.jpg","batch":1}]', picture_file: null },
      { photos: '[{"file":3,"batch":1}]', picture_file: null },
    ]);
    await expect(open()).resolves.toBeDefined();
    expect([...photos.files].sort()).toEqual(["p7.jpg", "unknown.jpg"]);
    expect(events).not.toContainEqual(
      expect.objectContaining({ photo: expect.stringMatching(/^remove/) }),
    );
  });

  it("refuses to open when a stored row of the photo names is not an object", async () => {
    db.reply("all", ALL_FILES, ["a row"]);
    await expect(open()).rejects.toMatchObject({ code: "corrupt" });
  });

  it("does not open a database newer than the app knows", async () => {
    db.reply("first", "PRAGMA user_version", { user_version: MIGRATIONS.length + 1 });
    await expect(open()).rejects.toMatchObject({ code: "newer-schema" });
    expect(events).not.toContainEqual({ photo: "prepare" });
  });
});

describe("add", () => {
  it("copies the photo in first, then saves the find as waiting", async () => {
    db.reply("run", INSERT, { changes: 1, lastInsertRowId: 42 });
    await expect(store.add(newFind)).resolves.toBe(42);
    expect(events).toEqual([
      { photo: "copy file:///cache/camera/IMG_1.jpg as p1" },
      {
        method: "run",
        sql: INSERT,
        params: [1_762_590_000_000, 60, "saved", 59.64, 17.08, 12.5, "fix", "p1.jpg"],
      },
    ]);
  });

  it("saves a find without a position with all its position columns empty", async () => {
    await store.add({ ...newFind, position: null });
    expect(events[1]).toEqual({
      method: "run",
      sql: INSERT,
      params: [1_762_590_000_000, 60, "saved", null, null, null, null, "p1.jpg"],
    });
  });

  it("saves a position whose accuracy the phone did not give", async () => {
    await store.add({
      ...newFind,
      position: { latitude: 1, longitude: 2, accuracyM: null, source: "photo" },
    });
    expect(events[1]).toMatchObject({
      params: [1_762_590_000_000, 60, "saved", 1, 2, null, "photo", "p1.jpg"],
    });
  });

  it("saves nothing when the photo cannot be copied in", async () => {
    photos.copyError = new Error("no space left");
    await expect(store.add(newFind)).rejects.toThrow("no space left");
    expect(events.filter((event) => "method" in event)).toEqual([]);
  });

  it("removes the copied photo and passes the error on when the find cannot be saved", async () => {
    db.reply("run", INSERT, new Error("database is locked"));
    await expect(store.add(newFind)).rejects.toThrow("database is locked");
    expect(events.at(-1)).toEqual({ photo: "remove p1.jpg" });
    expect(photos.files.size).toBe(0);
  });

  it("passes the save error on when the copied photo cannot be removed either; the next opening removes it", async () => {
    db.reply("run", INSERT, new Error("database is locked"));
    photos.stuck.add("p1.jpg");
    await expect(store.add(newFind)).rejects.toThrow("database is locked");
    expect([...photos.files]).toEqual(["p1.jpg"]);

    photos.stuck.clear();
    await open();
    expect(photos.files.size).toBe(0);
  });

  it("leaves a photo copied just before a crash for the next opening to remove", async () => {
    // A crash between the copy and the insert: the copy happened, the row never did.
    await photos.copyIn(newFind.photoUri, "p1");
    db.reply("all", ALL_FILES, []);
    await open();
    expect(photos.files.size).toBe(0);
  });

  const bad: [string, NewFind][] = [
    ["an empty photo URI", { ...newFind, photoUri: " " }],
    [
      "a time that is not a whole number",
      { ...newFind, time: { ...newFind.time, takenAtMs: 1.5 } },
    ],
    [
      "a time that is not a number",
      { ...newFind, time: { ...newFind.time, takenAtMs: Number.NaN } },
    ],
    [
      "an offset that is not whole minutes",
      { ...newFind, time: { ...newFind.time, utcOffsetMinutes: 0.5 } },
    ],
    ["an offset past 18 hours", { ...newFind, time: { ...newFind.time, utcOffsetMinutes: 1081 } }],
    [
      "an offset before -18 hours",
      { ...newFind, time: { ...newFind.time, utcOffsetMinutes: -1081 } },
    ],
    ["an unknown time source", { ...newFind, time: { ...newFind.time, source: wrong("gps") } }],
    ["a latitude past 90", withPosition({ latitude: 90.1 })],
    ["a latitude before -90", withPosition({ latitude: -90.1 })],
    ["a longitude past 180", withPosition({ longitude: 180.1 })],
    ["a longitude that is not a number", withPosition({ longitude: Number.NaN })],
    ["a negative accuracy", withPosition({ accuracyM: -1 })],
    ["an infinite accuracy", withPosition({ accuracyM: Number.POSITIVE_INFINITY })],
    ["an unknown position source", withPosition({ source: wrong("guess") })],
  ];

  it.each(bad)("refuses %s before copying or saving anything", async (_, find) => {
    const adding = store.add(find);
    await expect(adding).rejects.toBeInstanceOf(StoreError);
    await expect(adding).rejects.toMatchObject({ code: "invalid-input" });
    expect(events).toEqual([]);
  });

  it.each(bad)(
    "with its batch open, refuses %s before copying or saving anything (PBI-2.2)",
    async (_, find) => {
      await expect(store.addWithOpenBatch(find)).rejects.toMatchObject({ code: "invalid-input" });
      expect(events).toEqual([]);
    },
  );
});

describe("addWithOpenBatch (PBI-2.2)", () => {
  it("copies the photo in first, then saves the find as waiting, its first batch open", async () => {
    db.reply("run", INSERT_OPEN, { changes: 1, lastInsertRowId: 43 });
    await expect(store.addWithOpenBatch(newFind)).resolves.toBe(43);
    expect(events).toEqual([
      { photo: "copy file:///cache/camera/IMG_1.jpg as p1" },
      {
        method: "run",
        sql: INSERT_OPEN,
        params: [1_762_590_000_000, 60, "saved", 59.64, 17.08, 12.5, "fix", "p1.jpg"],
      },
    ]);
  });

  it("removes the copied photo and passes the error on when the find cannot be saved", async () => {
    db.reply("run", INSERT_OPEN, new Error("database is locked"));
    await expect(store.addWithOpenBatch(newFind)).rejects.toThrow("database is locked");
    expect(events.at(-1)).toEqual({ photo: "remove p1.jpg" });
    expect(photos.files.size).toBe(0);
  });
});

describe("addText (PBI-2.2)", () => {
  const newText = {
    text: "A yellow funnel with false gills.",
    time: newFind.time,
    position: null,
  };

  it("saves a text find as waiting, with no photo, copying nothing", async () => {
    db.reply("run", INSERT_TEXT, { changes: 1, lastInsertRowId: 44 });
    await expect(store.addText(newText)).resolves.toBe(44);
    expect(events).toEqual([
      {
        method: "run",
        sql: INSERT_TEXT,
        params: [
          1_762_590_000_000,
          60,
          "saved",
          null,
          null,
          null,
          null,
          "A yellow funnel with false gills.",
        ],
      },
    ]);
  });

  it("saves the text as it was written, spaces and line breaks included", async () => {
    await store.addText({ ...newText, text: "  Yellow,\nfunnel-shaped.  " });
    expect(events[0]).toMatchObject({
      params: expect.arrayContaining(["  Yellow,\nfunnel-shaped.  "]),
    });
  });

  it("accepts a text of exactly 2,000 characters, counting a character outside the BMP as one", async () => {
    await expect(store.addText({ ...newText, text: "🍄".repeat(2000) })).resolves.toBe(1);
  });

  it.each<[string, unknown]>([
    ["an empty text", ""],
    ["a text of spaces and line breaks only", " \n\t "],
    ["a text of 2,001 characters", "a".repeat(2001)],
    ["a text that is not a string", 42],
    ["no text at all", null],
  ])("refuses %s, sending nothing", async (_, text) => {
    await expect(store.addText({ ...newText, text: wrong(text) })).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });

  it("refuses a time or a position the store does not accept, as for a photo find", async () => {
    await expect(
      store.addText({ ...newText, time: { ...newText.time, utcOffsetMinutes: 1081 } }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    await expect(
      store.addText({
        ...newText,
        position: wrong({ latitude: 91, longitude: 0, accuracyM: null, source: "fix" }),
      }),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(events).toEqual([]);
  });
});

describe("addPhoto (PBI-2.2)", () => {
  it("copies the photo in, then adds it to the find's open batch or opens a new one, below the limit of 5", async () => {
    await store.addPhoto(7, "file:///cache/IMG_2.jpg");
    expect(events).toEqual([
      { photo: "copy file:///cache/IMG_2.jpg as p1" },
      { method: "run", sql: ADD_PHOTO, params: ["p1.jpg", 7, 5] },
    ]);
  });

  it("removes the copied photo and says no find has the ID when none has", async () => {
    db.reply("run", ADD_PHOTO, { changes: 0, lastInsertRowId: 0 });
    await expect(store.addPhoto(7, "file:///cache/IMG_2.jpg")).rejects.toMatchObject({
      code: "not-found",
    });
    expect(events.slice(-2)).toEqual([
      { method: "first", sql: PHOTOS_OF, params: [7] },
      { photo: "remove p1.jpg" },
    ]);
    expect(photos.files.size).toBe(0);
  });

  it("removes the copied photo and refuses, as wrong-state, a find that holds 5 photos", async () => {
    db.reply("run", ADD_PHOTO, { changes: 0, lastInsertRowId: 0 });
    const five = [1, 2, 3, 4, 5].map((n) => ({ file: `p${n + 10}.jpg`, batch: 1 }));
    db.reply("first", PHOTOS_OF, { text: null, photos: JSON.stringify(five), batches: 1 });
    await expect(store.addPhoto(7, "file:///cache/IMG_2.jpg")).rejects.toMatchObject({
      code: "wrong-state",
    });
    expect(photos.files.size).toBe(0);
  });

  it("removes the copied photo and refuses, as corrupt, a find whose photos cannot be read", async () => {
    db.reply("run", ADD_PHOTO, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", PHOTOS_OF, { text: null, photos: "[", batches: 1 });
    await expect(store.addPhoto(7, "file:///cache/IMG_2.jpg")).rejects.toMatchObject({
      code: "corrupt",
    });
    expect(photos.files.size).toBe(0);
  });

  it("removes the copied photo and passes the error on when it cannot be added", async () => {
    db.reply("run", ADD_PHOTO, new Error("database is locked"));
    await expect(store.addPhoto(7, "file:///cache/IMG_2.jpg")).rejects.toThrow(
      "database is locked",
    );
    expect(events.at(-1)).toEqual({ photo: "remove p1.jpg" });
  });

  it("saves nothing when the photo cannot be copied in", async () => {
    photos.copyError = new Error("no space left");
    await expect(store.addPhoto(7, "file:///cache/IMG_2.jpg")).rejects.toThrow("no space left");
    expect(events.filter((event) => "method" in event)).toEqual([]);
  });

  it.each<[string, unknown, unknown]>([
    ["an ID of 0", 0, "file:///cache/IMG_2.jpg"],
    ["an empty photo URI", 7, " "],
    ["a photo URI that is not a string", 7, 3],
  ])("refuses %s before copying or saving anything", async (_, id, uri) => {
    await expect(store.addPhoto(wrong(id), wrong(uri))).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });
});

describe("completeBatch (PBI-2.2)", () => {
  it("completes the find's open batch", async () => {
    await store.completeBatch(7);
    expect(events).toEqual([{ method: "run", sql: COMPLETE_BATCH, params: [7] }]);
  });

  it("says no find has the ID", async () => {
    db.reply("run", COMPLETE_BATCH, { changes: 0, lastInsertRowId: 0 });
    await expect(store.completeBatch(7)).rejects.toMatchObject({ code: "not-found" });
    expect(events.at(-1)).toEqual({ method: "first", sql: BATCH_OPEN_OF, params: [7] });
  });

  it("refuses, as wrong-state, a find with no open batch", async () => {
    db.reply("run", COMPLETE_BATCH, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", BATCH_OPEN_OF, { batch_open: 0 });
    await expect(store.completeBatch(7)).rejects.toMatchObject({ code: "wrong-state" });
  });

  it("refuses, as corrupt, an open-batch flag it cannot read", async () => {
    db.reply("run", COMPLETE_BATCH, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", BATCH_OPEN_OF, { batch_open: null });
    await expect(store.completeBatch(7)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("refuses an ID that is not a positive whole number, sending nothing", async () => {
    await expect(store.completeBatch(1.5)).rejects.toMatchObject({ code: "invalid-input" });
    expect(events).toEqual([]);
  });
});

describe("removePhoto (PBI-2.2)", () => {
  const two = '[{"file":"p7.jpg","batch":1},{"file":"p8.jpg","batch":2}]';

  it("reads the find's photos, removes the one with the number given from the list, then its file", async () => {
    photos.files.add("p7.jpg");
    photos.files.add("p8.jpg");
    db.reply("first", PHOTOS_OF, { text: null, photos: two, batches: 2 });
    await expect(store.removePhoto(7, 2)).resolves.toEqual({ photoRemoved: true });
    expect(events).toEqual([
      { method: "first", sql: PHOTOS_OF, params: [7] },
      { method: "run", sql: REMOVE_PHOTO, params: ["$[1]", 7, "$[1].file", "p8.jpg"] },
      { photo: "remove p8.jpg" },
    ]);
    expect([...photos.files]).toEqual(["p7.jpg"]);
  });

  it("says when the photo's file could not be removed; the next opening removes it", async () => {
    photos.files.add("p7.jpg");
    photos.stuck.add("p7.jpg");
    db.reply("first", PHOTOS_OF, { text: null, photos: two, batches: 2 });
    await expect(store.removePhoto(7, 1)).resolves.toEqual({ photoRemoved: false });
  });

  it("keeps the file and refuses, as wrong-state, when the photos changed since they were read", async () => {
    photos.files.add("p8.jpg");
    db.reply("first", PHOTOS_OF, { text: null, photos: two, batches: 2 });
    db.reply("run", REMOVE_PHOTO, { changes: 0, lastInsertRowId: 0 });
    await expect(store.removePhoto(7, 2)).rejects.toMatchObject({ code: "wrong-state" });
    expect([...photos.files]).toEqual(["p8.jpg"]);
  });

  it("keeps the file when the photo cannot be taken off the list", async () => {
    photos.files.add("p8.jpg");
    db.reply("first", PHOTOS_OF, { text: null, photos: two, batches: 2 });
    db.reply("run", REMOVE_PHOTO, new Error("database is locked"));
    await expect(store.removePhoto(7, 2)).rejects.toThrow("database is locked");
    expect([...photos.files]).toEqual(["p8.jpg"]);
  });

  it("refuses, as wrong-state, to remove the last photo of a find without text", async () => {
    db.reply("first", PHOTOS_OF, {
      text: null,
      photos: '[{"file":"p7.jpg","batch":1}]',
      batches: 1,
    });
    await expect(store.removePhoto(7, 1)).rejects.toMatchObject({ code: "wrong-state" });
    expect(events).toEqual([{ method: "first", sql: PHOTOS_OF, params: [7] }]);
  });

  it("removes the last photo of a find with text", async () => {
    db.reply("first", PHOTOS_OF, {
      text: "A yellow funnel.",
      photos: '[{"file":"p7.jpg","batch":1}]',
      batches: 1,
    });
    await expect(store.removePhoto(7, 1)).resolves.toEqual({ photoRemoved: true });
    expect(events).toContainEqual({
      method: "run",
      sql: REMOVE_PHOTO,
      params: ["$[0]", 7, "$[0].file", "p7.jpg"],
    });
  });

  it("refuses, as invalid input, a number past the find's photos, changing nothing", async () => {
    db.reply("first", PHOTOS_OF, { text: null, photos: two, batches: 2 });
    await expect(store.removePhoto(7, 3)).rejects.toMatchObject({ code: "invalid-input" });
    expect(events).toEqual([{ method: "first", sql: PHOTOS_OF, params: [7] }]);
  });

  it("says no find has the ID", async () => {
    await expect(store.removePhoto(7, 1)).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuses, as corrupt, photos it cannot read, changing nothing", async () => {
    db.reply("first", PHOTOS_OF, { text: null, photos: '[{"file":"p7.jpg"}]', batches: 1 });
    await expect(store.removePhoto(7, 1)).rejects.toMatchObject({ code: "corrupt" });
    expect(events).toEqual([{ method: "first", sql: PHOTOS_OF, params: [7] }]);
  });

  it.each<[string, unknown, unknown]>([
    ["an ID of 0", 0, 1],
    ["a photo number of 0", 7, 0],
    ["a photo number that is a fraction", 7, 1.5],
    ["a photo number that is not a number", 7, "1"],
  ])("refuses %s, sending nothing", async (_, id, number) => {
    await expect(store.removePhoto(wrong(id), wrong(number))).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });
});

describe("setAddedPhotos (PBI-2.2)", () => {
  it("marks the photos added since the answer as not yet analysed, from waiting", async () => {
    await store.setAddedPhotos(7, "not-analysed");
    expect(events).toEqual([
      { method: "run", sql: SET_ADDED_PHOTOS, params: ["not-analysed", 7, "waiting"] },
    ]);
  });

  it("puts photos not yet analysed back to waiting for the queue", async () => {
    await store.setAddedPhotos(7, "waiting");
    expect(events).toEqual([
      { method: "run", sql: SET_ADDED_PHOTOS, params: ["waiting", 7, "not-analysed"] },
    ]);
  });

  it("refuses, as wrong-state, a find in another state", async () => {
    db.reply("run", SET_ADDED_PHOTOS, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", ADDED_PHOTOS_OF, { added_photos: "analysed" });
    await expect(store.setAddedPhotos(7, "waiting")).rejects.toMatchObject({
      code: "wrong-state",
    });
  });

  it("says no find has the ID", async () => {
    db.reply("run", SET_ADDED_PHOTOS, { changes: 0, lastInsertRowId: 0 });
    await expect(store.setAddedPhotos(7, "waiting")).rejects.toMatchObject({ code: "not-found" });
  });

  it.each<[string, unknown]>([
    ["analysed, which only an answer sets", "analysed"],
    ["a state it does not know", "lost"],
  ])("refuses %s, sending nothing", async (_, state) => {
    await expect(store.setAddedPhotos(7, wrong(state))).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });
});

describe("setPicture (PBI-2.2)", () => {
  const newPicture = {
    sourceUri: "file:///cache/commons-thumb.png",
    author: "A. Photographer",
    licence: "CC BY-SA 4.0",
    page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
  };

  it("copies the picture in, then stores it with its author, licence and page on a find whose check waits", async () => {
    await store.setPicture(7, newPicture);
    expect(events).toEqual([
      { photo: "copy file:///cache/commons-thumb.png as p1" },
      {
        method: "run",
        sql: SET_PICTURE,
        params: [
          "p1.jpg",
          "A. Photographer",
          "CC BY-SA 4.0",
          "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
          7,
        ],
      },
    ]);
  });

  it("removes the copied picture and refuses, as wrong-state, a find whose check does not wait for one", async () => {
    db.reply("run", SET_PICTURE, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", SELF_CHECK_OF, { self_check: "agreed" });
    await expect(store.setPicture(7, newPicture)).rejects.toMatchObject({ code: "wrong-state" });
    expect(events.slice(-2)).toEqual([
      { method: "first", sql: SELF_CHECK_OF, params: [7] },
      { photo: "remove p1.jpg" },
    ]);
  });

  it("removes the copied picture and says no find has the ID", async () => {
    db.reply("run", SET_PICTURE, { changes: 0, lastInsertRowId: 0 });
    await expect(store.setPicture(7, newPicture)).rejects.toMatchObject({ code: "not-found" });
    expect(photos.files.size).toBe(0);
  });

  it("removes the copied picture and passes the error on when it cannot be stored", async () => {
    db.reply("run", SET_PICTURE, new Error("database is locked"));
    await expect(store.setPicture(7, newPicture)).rejects.toThrow("database is locked");
    expect(photos.files.size).toBe(0);
  });

  it.each<[string, Record<string, unknown>]>([
    ["an empty source URI", { sourceUri: "" }],
    ["an empty author", { author: " " }],
    ["a licence that is not a string", { licence: 4 }],
    [
      "a page that is not an https address",
      { page: "http://commons.wikimedia.org/wiki/File:X.jpg" },
    ],
    ["a page with a space in it", { page: "https://commons.wikimedia.org/wiki/File:X Y.jpg" }],
    ["an empty page", { page: "" }],
  ])("refuses %s before copying or saving anything", async (_, overrides) => {
    await expect(store.setPicture(7, wrong({ ...newPicture, ...overrides }))).rejects.toMatchObject(
      { code: "invalid-input" },
    );
    expect(events).toEqual([]);
  });

  it("refuses no picture at all, sending nothing", async () => {
    await expect(store.setPicture(7, wrong(null))).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });
});

describe("setSelfCheck (PBI-2.2)", () => {
  it("stores an agreeing check on a find whose check waits and has its picture", async () => {
    await store.setSelfCheck(7, { state: "agreed" });
    expect(events).toEqual([
      { method: "run", sql: SET_SELF_CHECK, params: ["agreed", null, null, null, null, 7] },
    ]);
  });

  it("stores a disagreeing check with the species it named", async () => {
    const names = {
      sv: "Narrkantarell",
      en: "False chanterelle",
      la: "Hygrophoropsis aurantiaca",
      it: "Falso gallinaccio",
    };
    await store.setSelfCheck(7, { state: "disagreed", names });
    expect(events).toEqual([
      {
        method: "run",
        sql: SET_SELF_CHECK,
        params: [
          "disagreed",
          "Narrkantarell",
          "False chanterelle",
          "Hygrophoropsis aurantiaca",
          "Falso gallinaccio",
          7,
        ],
      },
    ]);
  });

  it.each(["no-species", "failed"] as const)("stores a check that %s", async (state) => {
    await store.setSelfCheck(7, { state });
    expect(events).toEqual([
      { method: "run", sql: SET_SELF_CHECK, params: [state, null, null, null, null, 7] },
    ]);
  });

  it("stores that there is no picture on a find whose check waits without one", async () => {
    await store.setSelfCheck(7, { state: "no-picture" });
    expect(events).toEqual([{ method: "run", sql: SET_NO_PICTURE, params: [7] }]);
  });

  it("refuses, as wrong-state, a find whose check does not wait", async () => {
    db.reply("run", SET_SELF_CHECK, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", SELF_CHECK_OF, { self_check: "agreed" });
    await expect(store.setSelfCheck(7, { state: "failed" })).rejects.toMatchObject({
      code: "wrong-state",
    });
  });

  it("says no find has the ID", async () => {
    db.reply("run", SET_NO_PICTURE, { changes: 0, lastInsertRowId: 0 });
    await expect(store.setSelfCheck(7, { state: "no-picture" })).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("refuses, as corrupt, a stored self-check state it does not know", async () => {
    db.reply("run", SET_SELF_CHECK, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", SELF_CHECK_OF, { self_check: "maybe" });
    await expect(store.setSelfCheck(7, { state: "agreed" })).rejects.toMatchObject({
      code: "corrupt",
    });
  });

  it.each<[string, unknown]>([
    ["waiting, which only an answer sets", { state: "waiting" }],
    ["a state it does not know", { state: "maybe" }],
    ["a disagreement without the species named", { state: "disagreed" }],
    [
      "a disagreement with an empty name",
      { state: "disagreed", names: { sv: "a", en: "b", la: "", it: "d" } },
    ],
    [
      "a disagreement without a Latin name",
      { state: "disagreed", names: { sv: "a", en: "b", it: "d" } },
    ],
    ["no outcome at all", null],
  ])("refuses %s, sending nothing", async (_, outcome) => {
    await expect(store.setSelfCheck(7, wrong(outcome))).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });
});

describe("getStored (PBI-2.2)", () => {
  it("asks for the find as get does, and reads its photos, text, batch and the states beside its answer", async () => {
    db.reply(
      "first",
      GET,
      doneRow({
        photos: '[{"file":"p7.jpg","batch":1},{"file":"p8.jpg","batch":2}]',
        batches: 3,
        batch_open: 1,
        added_photos: "not-analysed",
      }),
    );
    await expect(store.getStored(7)).resolves.toEqual({
      id: 7,
      text: null,
      photos: [
        { uri: "file:///doc/photos/p7.jpg", batch: 1 },
        { uri: "file:///doc/photos/p8.jpg", batch: 2 },
      ],
      batchOpen: true,
      time: { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" },
      position: { latitude: 59.64, longitude: 17.08, accuracyM: 12.5, source: "fix" },
      analysis: { state: "done", ...analysed },
      addedPhotos: "not-analysed",
      picture: null,
      selfCheck: null,
    });
    expect(events).toEqual([{ method: "first", sql: GET, params: [7] }]);
  });

  it("reads a text find without photos, its picture and a disagreeing self-check", async () => {
    db.reply("first", GET, textRow({ ...picture, ...checkNames, self_check: "disagreed" }));
    await expect(store.getStored(7)).resolves.toMatchObject({
      text: "A yellow funnel with false gills.",
      photos: [],
      batchOpen: false,
      picture: {
        uri: "file:///doc/photos/w1.jpg",
        author: "A. Photographer",
        licence: "CC BY-SA 4.0",
        page: "https://commons.wikimedia.org/wiki/File:Chanterelle.jpg",
      },
      selfCheck: {
        state: "disagreed",
        names: {
          sv: "Narrkantarell",
          en: "False chanterelle",
          la: "Hygrophoropsis aurantiaca",
          it: "Falso gallinaccio",
        },
      },
    });
  });

  it.each(["waiting", "no-picture"])(
    "reads a self-check that is %s, without a picture",
    async (state) => {
      db.reply("first", GET, textRow({ self_check: state }));
      await expect(store.getStored(7)).resolves.toMatchObject({
        picture: null,
        selfCheck: { state },
      });
    },
  );

  it.each(["agreed", "no-species", "failed"])(
    "reads a self-check that is %s, with its picture",
    async (state) => {
      db.reply("first", GET, textRow({ ...picture, self_check: state }));
      await expect(store.getStored(7)).resolves.toMatchObject({
        picture: { uri: "file:///doc/photos/w1.jpg" },
        selfCheck: { state },
      });
    },
  );

  it("reads a waiting self-check that has its picture already", async () => {
    db.reply("first", GET, textRow({ ...picture }));
    await expect(store.getStored(7)).resolves.toMatchObject({ selfCheck: { state: "waiting" } });
  });

  it("gives null for an ID no find has", async () => {
    await expect(store.getStored(8)).resolves.toBeNull();
  });

  it("refuses an ID that is not a positive whole number, sending nothing", async () => {
    await expect(store.getStored(0)).rejects.toMatchObject({ code: "invalid-input" });
    expect(events).toEqual([]);
  });

  it("refuses a stored row it cannot read, as get does", async () => {
    db.reply("first", GET, row({ photos: "[" }));
    await expect(store.getStored(7)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("reads a text find without photos, which get, Phase 1's view with one photo, refuses as one it cannot show", async () => {
    db.reply("first", GET, textRow());
    await expect(store.getStored(7)).resolves.toMatchObject({ photos: [] });
    await expect(store.get(7)).rejects.toMatchObject({ code: "corrupt" });
  });
});

/** A value a caller without types could pass. */
function wrong<T>(value: unknown): T {
  return value as T;
}

function withPosition(position: Record<string, unknown>): NewFind {
  const base = { latitude: 59.64, longitude: 17.08, accuracyM: 12.5, source: "fix" };
  return { ...newFind, position: wrong({ ...base, ...position }) };
}

describe("get", () => {
  it("asks for the find by its ID and reads a waiting find", async () => {
    db.reply("first", GET, row());
    await expect(store.get(7)).resolves.toEqual({
      id: 7,
      photoUri: "file:///doc/photos/p7.jpg",
      time: { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" },
      position: { latitude: 59.64, longitude: 17.08, accuracyM: 12.5, source: "fix" },
      analysis: { state: "waiting" },
    });
    expect(events).toEqual([{ method: "first", sql: GET, params: [7] }]);
  });

  it("reads a find without a position, its time taken from the photo with the phone's offset", async () => {
    db.reply(
      "first",
      GET,
      row({
        time_source: "photo-phone-offset",
        latitude: null,
        longitude: null,
        accuracy_m: null,
        position_source: null,
      }),
    );
    await expect(store.get(7)).resolves.toMatchObject({
      time: { source: "photo-phone-offset" },
      position: null,
    });
  });

  it("reads a done find with its answer, the model that gave it and when", async () => {
    db.reply(
      "first",
      GET,
      row({
        state: "done",
        answer_json: answerToJson(match),
        model: "claude-model-x",
        analysed_at_ms: 1_762_600_000_000,
        added_photos: "analysed",
      }),
    );
    await expect(store.get(7)).resolves.toMatchObject({
      analysis: { state: "done", ...analysed },
    });
  });

  it("reads a Phase 1 answer with its confidence as the level it was given (SPEC 3.9)", async () => {
    db.reply("first", GET, doneRow({ answer_json: answerToJson(phaseOneMatch) }));
    await expect(store.get(7)).resolves.toMatchObject({
      analysis: { state: "done", answer: { confidence: "low" } },
    });
    await expect(store.getStored(7)).resolves.toMatchObject({
      analysis: { state: "done", answer: { confidence: "low" } },
    });
  });

  it("reads an answer with its confidence as a whole number from 1 to 100 (SPEC 3.9)", async () => {
    db.reply("first", GET, doneRow({ answer_json: answerToJson({ ...match, confidence: 1 }) }));
    await expect(store.get(7)).resolves.toMatchObject({
      analysis: { state: "done", answer: { confidence: 1 } },
    });
  });

  it.each<[string, string]>([
    ["0", '"confidence":0'],
    ["101", '"confidence":101'],
    ["a fraction", '"confidence":69.5'],
    ["a number written as text", '"confidence":"90"'],
    ["a level it does not know", '"confidence":"sure"'],
  ])("refuses as corrupt a stored answer whose confidence is %s", async (_, confidence) => {
    const answerJson = answerToJson(match).replace('"confidence":90', confidence);
    db.reply("first", GET, doneRow({ answer_json: answerJson }));
    await expect(store.get(7)).rejects.toMatchObject({ code: "corrupt" });
  });

  it("gives the first photo of a find with several as its photo (PBI-2.2)", async () => {
    db.reply(
      "first",
      GET,
      row({ photos: '[{"file":"p7.jpg","batch":1},{"file":"p8.jpg","batch":2}]', batches: 2 }),
    );
    await expect(store.get(7)).resolves.toMatchObject({ photoUri: "file:///doc/photos/p7.jpg" });
  });

  it("reads a text find with photos, and a self-check waiting for its picture, as Phase 1 read a find (PBI-2.2)", async () => {
    db.reply("first", GET, textRow({ photos: '[{"file":"p7.jpg","batch":1}]', batches: 1 }));
    await expect(store.get(7)).resolves.toEqual({
      id: 7,
      photoUri: "file:///doc/photos/p7.jpg",
      time: { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" },
      position: { latitude: 59.64, longitude: 17.08, accuracyM: 12.5, source: "fix" },
      analysis: { state: "done", ...analysed },
    });
  });

  it("reads a failed find with why it failed", async () => {
    db.reply(
      "first",
      GET,
      row({ state: "failed", failure_cause: "segment-check", failure_detail: "0xFFE1" }),
    );
    await expect(store.get(7)).resolves.toMatchObject({
      analysis: { state: "failed", failure: { cause: "segment-check", detail: "0xFFE1" } },
    });
  });

  it("gives null for an ID no find has", async () => {
    await expect(store.get(8)).resolves.toBeNull();
  });

  it.each<[string, unknown]>([
    ["zero", 0],
    ["negative", -1],
    ["a fraction", 1.5],
    ["not a number", Number.NaN],
    ["a string", "7"],
  ])("refuses an ID that is %s, sending nothing", async (_, id) => {
    await expect(store.get(wrong(id))).rejects.toMatchObject({ code: "invalid-input" });
    expect(events).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["an unknown state", { state: "lost" }],
    ["a time stored as text", { taken_at_ms: "1762590000000" }],
    ["an unknown time source", { time_source: "gps" }],
    ["a latitude without a longitude", { longitude: null }],
    ["a position without a source", { position_source: null }],
    ["an unknown position source", { position_source: "guess" }],
    ["an accuracy stored as text", { accuracy_m: "12" }],
    ["a photo name stored as a number", { photos: '[{"file":7,"batch":1}]' }],
    ["no photo and no text (PBI-2.2)", { photos: "[]" }],
    ["a photo list that is not JSON (PBI-2.2)", { photos: "[" }],
    ["a photo list that is not an array (PBI-2.2)", { photos: '{"file":"p7.jpg","batch":1}' }],
    ["a photo list stored as a number (PBI-2.2)", { photos: 7 }],
    ["a photo that is not an object (PBI-2.2)", { photos: '["p7.jpg"]' }],
    ["a photo with an empty name (PBI-2.2)", { photos: '[{"file":"","batch":1}]' }],
    [
      "a photo with a key the store does not write (PBI-2.2)",
      { photos: '[{"file":"p7.jpg","batch":1,"x":1}]' },
    ],
    ["a photo without its batch (PBI-2.2)", { photos: '[{"file":"p7.jpg"}]' }],
    ["a photo in batch 0 (PBI-2.2)", { photos: '[{"file":"p7.jpg","batch":0}]' }],
    [
      "a photo in a batch past the last begun (PBI-2.2)",
      { photos: '[{"file":"p7.jpg","batch":2}]' },
    ],
    [
      "a photo in a batch that is a fraction (PBI-2.2)",
      { photos: '[{"file":"p7.jpg","batch":1.5}]' },
    ],
    [
      "photos out of the order of their batches (PBI-2.2)",
      { photos: '[{"file":"a.jpg","batch":2},{"file":"b.jpg","batch":1}]', batches: 2 },
    ],
    ["a batch count the database gave back as NULL (PBI-2.2)", { batches: null }],
    ["an open-batch flag the database gave back as NULL (PBI-2.2)", { batch_open: null }],
    ["an empty text (PBI-2.2)", { text: "" }],
    ["a text stored as a number (PBI-2.2)", { text: 7 }],
    ["a waiting find with a state of its added photos (PBI-2.2)", { added_photos: "waiting" }],
    ["a done find without a state of its added photos (PBI-2.2)", doneRow({ added_photos: null })],
    [
      "a done find with an unknown state of its added photos (PBI-2.2)",
      doneRow({ added_photos: "lost" }),
    ],
    ["an unknown self-check state (PBI-2.2)", textRow({ self_check: "maybe" })],
    ["a self-check on a find without an answer (PBI-2.2)", { self_check: "waiting" }],
    [
      "a disagreeing self-check without the species it named (PBI-2.2)",
      textRow({ ...picture, self_check: "disagreed" }),
    ],
    [
      "a disagreeing self-check with an empty name (PBI-2.2)",
      textRow({ ...picture, ...checkNames, self_check: "disagreed", check_name_la: " " }),
    ],
    [
      "an agreeing self-check with names (PBI-2.2)",
      textRow({ ...picture, ...checkNames, self_check: "agreed" }),
    ],
    ["a picture without its author (PBI-2.2)", textRow({ ...picture, picture_author: null })],
    ["a picture with an empty licence (PBI-2.2)", textRow({ ...picture, picture_licence: "" })],
    ["a picture without a self-check (PBI-2.2)", doneRow({ ...picture })],
    [
      "a picture with a self-check of no picture (PBI-2.2)",
      textRow({ ...picture, self_check: "no-picture" }),
    ],
    ["a finished self-check without a picture (PBI-2.2)", textRow({ self_check: "agreed" })],
    ["a done find whose answer is not JSON", doneRow({ answer_json: "{" })],
    [
      "a done find whose answer does not fit the shape",
      doneRow({ answer_json: '{"result":"maybe"}' }),
    ],
    ["a done find without a model", doneRow({ model: null })],
    ["a done find without its analysis time", doneRow({ analysed_at_ms: null })],
    ["a failed find without a cause", { state: "failed", failure_detail: "x" }],
    [
      "a failed find with an unknown cause",
      { state: "failed", failure_cause: "bad-luck", failure_detail: "x" },
    ],
  ])("refuses a stored row with %s", async (_, overrides) => {
    db.reply("first", GET, row(overrides));
    const getting = store.get(7);
    await expect(getting).rejects.toBeInstanceOf(StoreError);
    await expect(getting).rejects.toMatchObject({ code: "corrupt" });
  });

  it("refuses a stored row that is not an object", async () => {
    db.reply("first", GET, "a row");
    await expect(store.get(7)).rejects.toMatchObject({ code: "corrupt" });
  });
});

describe("list", () => {
  it("asks for the finds newest first and reads what the Log shows of each", async () => {
    db.reply("all", LIST, [
      doneMatchRow({
        id: 10,
        answer_json: answerToJson({ ...match, confidence: 42 }),
        confidence_score: 42,
      }),
      phaseOneMatchRow({ id: 9 }),
      summaryRow({
        id: 8,
        state: "done",
        answer_json: answerToJson({ result: "no_mushroom" }),
        model: "m",
        analysed_at_ms: 1,
        added_photos: "analysed",
        result: "no_mushroom",
      }),
      summaryRow({ id: 7, state: "failed", failure_cause: "answer", failure_detail: "shape" }),
      summaryRow({ id: 6 }),
    ]);
    const time = { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" };
    await expect(store.list()).resolves.toEqual([
      {
        readable: true,
        id: 10,
        photoUri: "file:///doc/photos/p7.jpg",
        time,
        selfCheck: null,
        analysis: {
          state: "done",
          result: "match",
          names: { sv: "Kantarell", en: "Chanterelle", it: "Gallinaccio" },
          edibility: "edible",
          confidence: 42,
        },
      },
      {
        readable: true,
        id: 9,
        photoUri: "file:///doc/photos/p7.jpg",
        time,
        selfCheck: null,
        analysis: {
          state: "done",
          result: "match",
          names: { sv: "Kantarell", en: "Chanterelle", it: "Gallinaccio" },
          edibility: "edible",
          confidence: "low",
        },
      },
      {
        readable: true,
        id: 8,
        photoUri: "file:///doc/photos/p7.jpg",
        time,
        selfCheck: null,
        analysis: { state: "done", result: "no_mushroom" },
      },
      {
        readable: true,
        id: 7,
        photoUri: "file:///doc/photos/p7.jpg",
        time,
        selfCheck: null,
        analysis: { state: "failed", failure: { cause: "answer", detail: "shape" } },
      },
      {
        readable: true,
        id: 6,
        photoUri: "file:///doc/photos/p7.jpg",
        time,
        selfCheck: null,
        analysis: { state: "waiting" },
      },
    ]);
    expect(events).toEqual([{ method: "all", sql: LIST, params: [] }]);
  });

  it("lists a text find without photos as readable, with no photo (PBI-2.4)", async () => {
    db.reply("all", LIST, [
      summaryRow({ id: 8, text: "A yellow funnel.", photos: "[]", batches: 0 }),
      summaryRow({
        ...textRow({ id: 7 }),
        result: "match",
        name_sv: "Kantarell",
        name_en: "Chanterelle",
        name_it: "Gallinaccio",
        edibility: "edible",
        confidence_score: 90,
      }),
    ]);
    await expect(store.list()).resolves.toEqual([
      {
        readable: true,
        id: 8,
        photoUri: null,
        time: { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" },
        analysis: { state: "waiting" },
        selfCheck: null,
      },
      expect.objectContaining({
        readable: true,
        id: 7,
        photoUri: null,
        analysis: expect.objectContaining({ state: "done", result: "match", confidence: 90 }),
        // The answer is from the text alone, so the Log shows "unknown" until it agrees (3.9).
        selfCheck: { state: "waiting" },
      }),
    ]);
  });

  it("lists a text find that has photos by its first photo (PBI-2.4)", async () => {
    db.reply("all", LIST, [
      summaryRow({
        text: "A yellow funnel.",
        photos: '[{"file":"p1.jpg","batch":1},{"file":"p2.jpg","batch":1}]',
      }),
    ]);
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ readable: true, id: 7, photoUri: "file:///doc/photos/p1.jpg" }),
    ]);
  });

  it("gives an empty list for an empty log", async () => {
    await expect(store.list()).resolves.toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a match without a name", doneMatchRow({ name_sv: null })],
    ["a match with an unknown edibility", doneMatchRow({ edibility: "tasty" })],
    ["a Phase 1 match with an unknown level", phaseOneMatchRow({ confidence: "sure" })],
    [
      "a match with its confidence both as a level and as a number (SPEC 3.9)",
      doneMatchRow({ confidence: "high", confidence_score: 90 }),
    ],
    ["a match with no confidence at all (SPEC 3.9)", doneMatchRow({ confidence_score: null })],
    ["a match with a confidence of 0 (SPEC 3.9)", doneMatchRow({ confidence_score: 0 })],
    ["a match with a confidence of 101 (SPEC 3.9)", doneMatchRow({ confidence_score: 101 })],
    ["a match with a confidence that is a fraction", doneMatchRow({ confidence_score: 50.5 })],
    ["a match with a confidence stored as text", doneMatchRow({ confidence_score: "90" })],
    ["a done find with an unknown result", doneMatchRow({ result: "maybe" })],
    [
      "a done find whose stored answer is not of the shape (Clead's review of #26, decision 2)",
      doneMatchRow({ answer_json: '{"result":"maybe"}' }),
    ],
    [
      "a done find whose stored answer is not JSON (decision 2)",
      doneMatchRow({ answer_json: "{" }),
    ],
    ["a done find without its model (decision 2)", doneMatchRow({ model: null })],
    [
      "a done find whose analysis time the database gave back as NULL, past the safe range (decision 3)",
      doneMatchRow({ analysed_at_ms: null }),
    ],
    ["an unknown state", summaryRow({ state: "lost" })],
    ["a time stored as text", summaryRow({ taken_at_ms: "1762590000000" })],
    [
      "a UTC offset the database gave back as NULL, past 18 hours (round 2, item 2)",
      summaryRow({ utc_offset_min: null }),
    ],
    [
      "a time the database gave back as NULL, past the safe range (decision 3)",
      summaryRow({ taken_at_ms: null }),
    ],
    [
      "a time a driver gave back past 2^53, as a number (decision 3)",
      summaryRow({ taken_at_ms: 2 ** 53 + 2 }),
    ],
    [
      "an unknown position source (Clead's review of #26, fix 1)",
      summaryRow({ position_source: "gps" }),
    ],
    ["a latitude without a longitude (fix 1)", summaryRow({ longitude: null })],
    ["an accuracy stored as text (fix 1)", summaryRow({ accuracy_m: "12" })],
    ["a photo name stored as a number", summaryRow({ photos: '[{"file":7,"batch":1}]' })],
    ["neither text nor a photo (PBI-2.4)", summaryRow({ text: null, photos: "[]", batches: 0 })],
    ["a text that is blank (PBI-2.4)", summaryRow({ text: "  ", photos: "[]", batches: 0 })],
    ["a photo list that is not JSON (PBI-2.2)", summaryRow({ photos: "[" })],
    ["an unknown self-check state (PBI-2.2)", summaryRow({ self_check: "maybe" })],
    ["a failed find without a cause", summaryRow({ state: "failed", failure_detail: "x" })],
  ])(
    "marks a stored row with %s as unreadable, by its ID, and lists the others (PBI-1.16)",
    async (_, stored) => {
      db.reply("all", LIST, [summaryRow({ id: 9 }), { ...stored, id: 8 }, summaryRow({ id: 7 })]);
      await expect(store.list()).resolves.toEqual([
        expect.objectContaining({ readable: true, id: 9 }),
        { readable: false, id: 8 },
        expect.objectContaining({ readable: true, id: 7 }),
      ]);
    },
  );

  it.each<[string, unknown]>([
    ["a row that is not an object", "a row"],
    ["a row without an ID", summaryRow({ id: null })],
    ["a row whose ID is a fraction", summaryRow({ id: 0.5 })],
    ["a row whose ID is 0 (Clead's review of #26, decision 4)", summaryRow({ id: 0 })],
    ["a row whose ID is negative", summaryRow({ id: -3 })],
  ])("marks %s as unreadable without an ID (PBI-1.16)", async (_, stored) => {
    db.reply("all", LIST, [stored, summaryRow({ id: 7 })]);
    await expect(store.list()).resolves.toEqual([
      { readable: false, id: null, storedId: null },
      expect.objectContaining({ readable: true, id: 7 }),
    ]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    [
      "an ID past 2^53, which the database gives back as NULL",
      summaryRow({ id: null, stored_id: "9007199254740993" }),
      "9007199254740993",
    ],
    ["an ID of 0", summaryRow({ id: 0, stored_id: "0" }), "0"],
    ["a negative ID", summaryRow({ id: -3, stored_id: "-3" }), "-3"],
  ])(
    "marks a row with %s unreadable without an ID, with the ID as SQLite writes it, so it can still be removed (PBI-1.26)",
    async (_, stored, storedId) => {
      db.reply("all", LIST, [stored, summaryRow({ id: 7, stored_id: "7" })]);
      await expect(store.list()).resolves.toEqual([
        { readable: false, id: null, storedId },
        expect.objectContaining({ readable: true, id: 7 }),
      ]);
    },
  );

  it.each<[string, unknown]>([
    ["a number", 5],
    ["not an integer's digits", "5.5"],
    ["a number with a leading zero", "05"],
    ["empty", ""],
  ])(
    "gives no stored ID for a row without an ID whose stored ID is %s (PBI-1.26)",
    async (_, storedId) => {
      db.reply("all", LIST, [summaryRow({ id: null, stored_id: storedId })]);
      await expect(store.list()).resolves.toEqual([{ readable: false, id: null, storedId: null }]);
    },
  );

  it("lists a readable find by its ID alone, not by the ID as SQLite writes it (PBI-1.26)", async () => {
    db.reply("all", LIST, [summaryRow({ id: 7, stored_id: "7" })]);
    const [entry] = await store.list();
    expect(entry).not.toHaveProperty("storedId");
    expect(entry).toMatchObject({ readable: true, id: 7 });
  });

  it("passes on an error that does not come from what is stored", async () => {
    photos.uriError = new Error("the document directory is gone");
    db.reply("all", LIST, [summaryRow()]);
    await expect(store.list()).rejects.toThrow("the document directory is gone");
  });

  it("judges a row readable as get does: a row get refuses is never listed readable (fix 1)", async () => {
    const damaged = [
      summaryRow({ position_source: "gps" }),
      doneMatchRow({ answer_json: "{" }),
      summaryRow({ taken_at_ms: null }),
    ];
    for (const stored of damaged) {
      db.reply("first", GET, stored);
      db.reply("all", LIST, [stored]);
      await expect(store.get(7)).rejects.toMatchObject({ code: "corrupt" });
      await expect(store.list()).resolves.toEqual([{ readable: false, id: 7 }]);
    }
  });
});

describe("oldestWaiting (PBI-1.7, PBI-1.16)", () => {
  it("asks for the waiting find saved first, by its ID, reads it and gives its ID", async () => {
    db.reply("first", NEXT_WAITING, row({ id: 4 }));
    await expect(store.oldestWaiting()).resolves.toBe(4);
    expect(events).toEqual([{ method: "first", sql: NEXT_WAITING, params: [0] }]);
  });

  it("gives null when no find is waiting", async () => {
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });

  it("gives a waiting text find without photos, which the queue analyses by its text (PBI-2.4)", async () => {
    db.reply("first", NEXT_WAITING, (params: readonly unknown[]) =>
      params[0] === 0 ? row({ id: 4, text: "A yellow funnel.", photos: "[]", batches: 0 }) : null,
    );
    await expect(store.oldestWaiting()).resolves.toBe(4);
    expect(events).toEqual([{ method: "first", sql: NEXT_WAITING, params: [0] }]);
  });

  it("passes over a waiting find with neither text nor a photo, as one it cannot read (PBI-2.4)", async () => {
    db.reply("first", NEXT_WAITING, (params: readonly unknown[]) => {
      if (params[0] === 0) {
        return row({ id: 2, text: null, photos: "[]", batches: 0 });
      }
      return params[0] === 2 ? row({ id: 5 }) : null;
    });
    await expect(store.oldestWaiting()).resolves.toBe(5);
  });

  it("passes over a waiting find whose row it cannot read, and gives the next one after it", async () => {
    db.reply("first", NEXT_WAITING, (params: readonly unknown[]) => {
      const after = params[0];
      if (after === 0) {
        return row({ id: 2, time_source: "gps" });
      }
      return after === 2 ? row({ id: 5 }) : null;
    });
    await expect(store.oldestWaiting()).resolves.toBe(5);
    expect(events).toEqual([
      { method: "first", sql: NEXT_WAITING, params: [0] },
      { method: "first", sql: NEXT_WAITING, params: [2] },
    ]);
    expect(events.filter((event) => "method" in event && event.method === "run")).toEqual([]);
  });

  it("gives null when every waiting find is one it cannot read", async () => {
    db.reply("first", NEXT_WAITING, (params: readonly unknown[]) =>
      params[0] === 0 ? row({ id: 3, state: "lost" }) : null,
    );
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });

  it.each([
    ["not a whole number", row({ id: 4.5 })],
    ["not a number", row({ id: "4" })],
    ["missing", row({ id: undefined })],
  ])(
    "refuses a stored ID that is %s as corrupt, since it cannot pass over it",
    async (_name, reply) => {
      db.reply("first", NEXT_WAITING, reply);
      await expect(store.oldestWaiting()).rejects.toMatchObject({ code: "corrupt" });
    },
  );

  it("refuses a stored row that is not an object as corrupt", async () => {
    db.reply("first", NEXT_WAITING, "a row");
    await expect(store.oldestWaiting()).rejects.toMatchObject({ code: "corrupt" });
  });

  it("passes on an error of the database", async () => {
    db.reply("first", NEXT_WAITING, new Error("database is locked"));
    await expect(store.oldestWaiting()).rejects.toThrow("database is locked");
  });

  it("passes on an error while it reads the row that does not come from what is stored, passing over nothing", async () => {
    photos.uriError = new Error("the document directory is gone");
    db.reply("first", NEXT_WAITING, row({ id: 4 }));
    await expect(store.oldestWaiting()).rejects.toThrow("the document directory is gone");
    expect(events).toEqual([{ method: "first", sql: NEXT_WAITING, params: [0] }]);
  });
});

/** The find's photos as the answer write reads them, to name the photos the analysis sent. */
const ONE_PHOTO_ROW = { text: null, photos: '[{"file":"p7.jpg","batch":1}]', batches: 1 };
/** The analysis sent the find's one photo, by the URI the store gives it. */
const SENT_P7 = { photoUris: ["file:///doc/photos/p7.jpg"] };

describe("setAnswer", () => {
  beforeEach(() => {
    db.reply("first", PHOTOS_OF, ONE_PHOTO_ROW);
  });

  it("reads the find's photos, then saves the answer as JSON with the Log's fields, the names of the photos sent, their number and the result once more, for a waiting or failed find", async () => {
    await store.setAnswer(7, analysed, SENT_P7);
    expect(events).toEqual([
      { method: "first", sql: PHOTOS_OF, params: [7] },
      {
        method: "run",
        sql: SET_ANSWER,
        params: [
          answerToJson(match),
          "claude-model-x",
          1_762_600_000_000,
          "match",
          "Kantarell",
          "Chanterelle",
          "Gallinaccio",
          "edible",
          null,
          90,
          '["p7.jpg"]',
          1,
          "match",
          7,
        ],
      },
    ]);
  });

  it("names no photo, and counts none, for an analysis of the text alone (review of #49, fix 1)", async () => {
    db.reply("first", PHOTOS_OF, { text: "A yellow funnel.", photos: "[]", batches: 0 });
    await store.setAnswer(7, analysed, { photoUris: [] });
    expect(events.at(-1)).toMatchObject({ params: expect.arrayContaining(["[]", 0, "match", 7]) });
  });

  it("names, in the order sent, the photos the find holds, and counts every photo sent, also one removed since (review of #49, fix 1)", async () => {
    db.reply("first", PHOTOS_OF, {
      text: null,
      photos: '[{"file":"p7.jpg","batch":1},{"file":"p8.jpg","batch":2}]',
      batches: 2,
    });
    await store.setAnswer(7, analysed, {
      photoUris: [
        "file:///doc/photos/p8.jpg",
        "file:///doc/photos/gone.jpg",
        "file:///doc/photos/p7.jpg",
      ],
    });
    expect(events.at(-1)).toMatchObject({
      params: expect.arrayContaining(['["p8.jpg","p7.jpg"]', 3, "match", 7]),
    });
  });

  it("keeps the edibility Claude gave even at low confidence, with the number in place of a level", async () => {
    const low: Match = { ...match, edibility: "deadly_poisonous", confidence: 12 };
    await store.setAnswer(7, { ...analysed, answer: low }, SENT_P7);
    const run = events.at(-1);
    expect(run).toMatchObject({ sql: SET_ANSWER });
    expect(run !== undefined && "params" in run && run.params.slice(7, 10)).toEqual([
      "deadly_poisonous",
      null,
      12,
    ]);
  });

  it("refuses a new answer whose confidence is a Phase 1 level, sending nothing (SPEC 3.9)", async () => {
    await expect(
      store.setAnswer(7, { ...analysed, answer: phaseOneMatch }, SENT_P7),
    ).rejects.toMatchObject({
      code: "invalid-input",
      message: "the answer is not of the shape: confidence is not a whole number from 1 to 100",
    });
    expect(events).toEqual([]);
  });

  it.each<[string, Answer]>([
    ["no mushroom", { result: "no_mushroom" }],
    ["cannot tell", { result: "cannot_tell" }],
  ])("saves a '%s' answer with no names, edibility or confidence", async (_, answer) => {
    await store.setAnswer(7, { ...analysed, answer }, SENT_P7);
    expect(events.at(-1)).toMatchObject({
      params: [
        answerToJson(answer),
        "claude-model-x",
        1_762_600_000_000,
        answer.result,
        null,
        null,
        null,
        null,
        null,
        null,
        '["p7.jpg"]',
        1,
        answer.result,
        7,
      ],
    });
  });

  it("refuses an answer that does not fit the shape, sending nothing", async () => {
    const empty: Match = { ...match, names: { ...match.names, sv: "" } };
    await expect(store.setAnswer(7, { ...analysed, answer: empty }, SENT_P7)).rejects.toMatchObject(
      { code: "invalid-input" },
    );
    expect(events).toEqual([]);
  });

  it.each<[string, AnalysedAnswer]>([
    ["an empty model", { ...analysed, model: "  " }],
    ["a model that is not a string", { ...analysed, model: wrong(4) }],
    ["an analysis time that is not whole", { ...analysed, analysedAtMs: 0.5 }],
  ])("refuses %s, sending nothing", async (_, given) => {
    await expect(store.setAnswer(7, given, SENT_P7)).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["no account of what was sent", undefined],
    ["photos sent that are not a list", { photoUris: "file:///doc/photos/p7.jpg" }],
    ["a photo sent that is an empty URI", { photoUris: [" "] }],
    ["a photo sent that is not a string", { photoUris: [7] }],
  ])("refuses %s, sending nothing (review of #49, fix 1)", async (_, sent) => {
    await expect(store.setAnswer(7, analysed, wrong(sent))).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });

  it("says the find does not exist when none has the ID, and stores nothing", async () => {
    db.reply("first", PHOTOS_OF, null);
    await expect(store.setAnswer(7, analysed, SENT_P7)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(events).toEqual([{ method: "first", sql: PHOTOS_OF, params: [7] }]);
  });

  it("refuses, as corrupt, a find whose photos it cannot read, and stores nothing", async () => {
    db.reply("first", PHOTOS_OF, { ...ONE_PHOTO_ROW, photos: "[" });
    await expect(store.setAnswer(7, analysed, SENT_P7)).rejects.toMatchObject({
      code: "corrupt",
    });
    expect(events).not.toContainEqual(expect.objectContaining({ sql: SET_ANSWER }));
  });

  it("says the find does not exist when it went between the read and the change", async () => {
    db.reply("run", SET_ANSWER, { changes: 0, lastInsertRowId: 0 });
    await expect(store.setAnswer(7, analysed, SENT_P7)).rejects.toMatchObject({
      code: "not-found",
    });
    expect(events.at(-1)).toEqual({ method: "first", sql: STATE_OF, params: [7] });
  });

  it("says the find is in the wrong state when it is already done", async () => {
    db.reply("run", SET_ANSWER, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", STATE_OF, { state: "done" });
    await expect(store.setAnswer(7, analysed, SENT_P7)).rejects.toMatchObject({
      code: "wrong-state",
    });
  });
});

describe("replaceAnswer", () => {
  beforeEach(() => {
    db.reply("first", PHOTOS_OF, ONE_PHOTO_ROW);
  });

  it("replaces the answer of a done find only, with what the analysis sent", async () => {
    await store.replaceAnswer(7, analysed, SENT_P7);
    expect(events).toEqual([
      { method: "first", sql: PHOTOS_OF, params: [7] },
      expect.objectContaining({
        method: "run",
        sql: REPLACE_ANSWER,
        params: expect.arrayContaining(['["p7.jpg"]', 1, "match", 7]),
      }),
    ]);
  });

  it("says the find is in the wrong state when it has no answer yet", async () => {
    db.reply("run", REPLACE_ANSWER, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", STATE_OF, { state: "waiting" });
    await expect(store.replaceAnswer(7, analysed, SENT_P7)).rejects.toMatchObject({
      code: "wrong-state",
    });
  });

  it("refuses an answer that does not fit the shape, sending nothing", async () => {
    await expect(
      store.replaceAnswer(
        7,
        { ...analysed, answer: { ...match, lookAlikes: wrong("none") } },
        SENT_P7,
      ),
    ).rejects.toMatchObject({ code: "invalid-input" });
    expect(events).toEqual([]);
  });

  it("refuses photos sent that are not a list, sending nothing", async () => {
    await expect(store.replaceAnswer(7, analysed, wrong({}))).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });
});

describe("markFailed", () => {
  it("marks a waiting or failed find failed, with why", async () => {
    await store.markFailed(7, { cause: "request", detail: "413" });
    expect(events).toEqual([{ method: "run", sql: MARK_FAILED, params: ["request", "413", 7] }]);
  });

  it("marks a find failed for a photo that cannot be read (PBI-1.7)", async () => {
    await store.markFailed(7, { cause: "photo", detail: "the image could not be loaded" });
    expect(events).toEqual([
      { method: "run", sql: MARK_FAILED, params: ["photo", "the image could not be loaded", 7] },
    ]);
  });

  it("marks a find failed for a refused answer (PBI-1.21)", async () => {
    await store.markFailed(7, { cause: "refused", detail: "stop_reason refusal" });
    expect(events).toEqual([
      { method: "run", sql: MARK_FAILED, params: ["refused", "stop_reason refusal", 7] },
    ]);
  });

  it("reads a find that failed for its photo", async () => {
    db.reply(
      "first",
      GET,
      row({ state: "failed", failure_cause: "photo", failure_detail: "gone" }),
    );
    await expect(store.get(7)).resolves.toMatchObject({
      analysis: { state: "failed", failure: { cause: "photo", detail: "gone" } },
    });
  });

  it.each<[string, unknown]>([
    ["an unknown cause", { cause: "bad-luck", detail: "x" }],
    ["an empty detail", { cause: "answer", detail: "" }],
    ["no failure at all", null],
  ])("refuses %s, sending nothing", async (_, failure) => {
    await expect(store.markFailed(7, wrong(failure))).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });

  it("says the find is in the wrong state when it is done", async () => {
    db.reply("run", MARK_FAILED, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", STATE_OF, { state: "done" });
    await expect(store.markFailed(7, { cause: "answer", detail: "shape" })).rejects.toMatchObject({
      code: "wrong-state",
    });
  });
});

describe("markWaiting", () => {
  it("puts a failed find back to waiting and clears why it failed", async () => {
    await store.markWaiting(7);
    expect(events).toEqual([{ method: "run", sql: MARK_WAITING, params: [7] }]);
  });

  it("says the find does not exist", async () => {
    db.reply("run", MARK_WAITING, { changes: 0, lastInsertRowId: 0 });
    await expect(store.markWaiting(7)).rejects.toMatchObject({ code: "not-found" });
  });

  it("refuses a stored state it does not know", async () => {
    db.reply("run", MARK_WAITING, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", STATE_OF, { state: 3 });
    await expect(store.markWaiting(7)).rejects.toMatchObject({ code: "corrupt" });
  });
});

/** The files of a find with one photo, as the store reads them before it deletes the find. */
const ONE_PHOTO = { photos: '[{"file":"p7.jpg","batch":1}]', picture_file: null };

describe("delete", () => {
  it("says no find has the ID when the delete changes no row, and removes no photo (PBI-1.27)", async () => {
    photos.files.add("p7.jpg");
    db.reply("first", FILES_OF, ONE_PHOTO);
    db.reply("run", DELETE, { changes: 0, lastInsertRowId: 0 });
    await expect(store.delete(7)).rejects.toMatchObject({ code: "not-found" });
    expect(events).not.toContainEqual({ photo: "remove p7.jpg" });
    expect([...photos.files]).toEqual(["p7.jpg"]);
  });

  it("deletes the find first, then its photo", async () => {
    photos.files.add("p7.jpg");
    db.reply("first", FILES_OF, ONE_PHOTO);
    await expect(store.delete(7)).resolves.toEqual({ photoRemoved: true });
    expect(events).toEqual([
      { method: "first", sql: FILES_OF, params: [7] },
      { method: "run", sql: DELETE, params: [7] },
      { photo: "remove p7.jpg" },
    ]);
    expect(photos.files.size).toBe(0);
  });

  it("deletes the find first, then every photo of it and its representative picture (PBI-2.2)", async () => {
    for (const name of ["p7.jpg", "p8.jpg", "w1.jpg"]) {
      photos.files.add(name);
    }
    db.reply("first", FILES_OF, {
      photos: '[{"file":"p7.jpg","batch":1},{"file":"p8.jpg","batch":2}]',
      picture_file: "w1.jpg",
    });
    await expect(store.delete(7)).resolves.toEqual({ photoRemoved: true });
    expect(events.slice(1)).toEqual([
      { method: "run", sql: DELETE, params: [7] },
      { photo: "remove p7.jpg" },
      { photo: "remove p8.jpg" },
      { photo: "remove w1.jpg" },
    ]);
    expect(photos.files.size).toBe(0);
  });

  it("says the find does not exist, and deletes nothing", async () => {
    await expect(store.delete(7)).rejects.toMatchObject({ code: "not-found" });
    expect(events).toEqual([{ method: "first", sql: FILES_OF, params: [7] }]);
  });

  it("keeps the photo when the find cannot be deleted, so no find is left without its photo", async () => {
    photos.files.add("p7.jpg");
    db.reply("first", FILES_OF, ONE_PHOTO);
    db.reply("run", DELETE, new Error("database is locked"));
    await expect(store.delete(7)).rejects.toThrow("database is locked");
    expect([...photos.files]).toEqual(["p7.jpg"]);
  });

  it("says when the photo could not be removed, and the next opening removes it", async () => {
    photos.files.add("p7.jpg");
    photos.stuck.add("p7.jpg");
    db.reply("first", FILES_OF, ONE_PHOTO);
    await expect(store.delete(7)).resolves.toEqual({ photoRemoved: false });

    photos.stuck.clear();
    db.reply("all", ALL_FILES, []);
    await open();
    expect(photos.files.size).toBe(0);
  });

  it("goes on removing the other files when one cannot be removed, and says so (PBI-2.2)", async () => {
    for (const name of ["p7.jpg", "w1.jpg"]) {
      photos.files.add(name);
    }
    photos.stuck.add("p7.jpg");
    db.reply("first", FILES_OF, { ...ONE_PHOTO, picture_file: "w1.jpg" });
    await expect(store.delete(7)).resolves.toEqual({ photoRemoved: false });
    expect([...photos.files]).toEqual(["p7.jpg"]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a photo list that is not JSON", { photos: "[", picture_file: null }],
    ["a photo whose name is not text", { photos: '[{"file":null,"batch":1}]', picture_file: null }],
    ["a picture name that is not text", { photos: "[]", picture_file: 3 }],
  ])(
    "deletes a find whose files it cannot all name, %s, and says a file was left (PBI-2.2)",
    async (_, stored) => {
      db.reply("first", FILES_OF, stored);
      await expect(store.delete(7)).resolves.toEqual({ photoRemoved: false });
      expect(events).toContainEqual({ method: "run", sql: DELETE, params: [7] });
    },
  );

  it("removes no file of a find whose files it cannot all name, since a damaged list may name another find's; the next opening removes its own (review of #49, note 1)", async () => {
    for (const name of ["p7.jpg", "w1.jpg"]) {
      photos.files.add(name);
    }
    db.reply("first", FILES_OF, {
      photos: '[{"file":"p7.jpg","batch":1},{"file":null,"batch":1}]',
      picture_file: "w1.jpg",
    });
    await expect(store.delete(7)).resolves.toEqual({ photoRemoved: false });
    expect(events).not.toContainEqual(
      expect.objectContaining({ photo: expect.stringMatching(/^remove/) }),
    );
    db.reply("all", ALL_FILES, []);
    await open();
    expect(photos.files.size).toBe(0);
  });

  it("refuses a stored row that is not an object, deleting nothing", async () => {
    db.reply("first", FILES_OF, "a row");
    await expect(store.delete(7)).rejects.toMatchObject({ code: "corrupt" });
    expect(events).not.toContainEqual(expect.objectContaining({ sql: DELETE }));
  });
});

describe("deleteUnreadable (PBI-1.26)", () => {
  it("deletes the find by its ID as SQLite writes it, then its photo", async () => {
    db.reply("first", FILES_OF_STORED, ONE_PHOTO);
    photos.files.add("p7.jpg");
    await expect(store.deleteUnreadable("9007199254740993")).resolves.toEqual({
      photoRemoved: true,
    });
    expect(events).toEqual([
      { method: "first", sql: FILES_OF_STORED, params: ["9007199254740993"] },
      { method: "run", sql: DELETE_STORED, params: ["9007199254740993"] },
      { photo: "remove p7.jpg" },
    ]);
  });

  it("deletes the find even when its photo name cannot be read, which leaves its photo", async () => {
    db.reply("first", FILES_OF_STORED, { photos: '[{"file":3,"batch":1}]', picture_file: null });
    await expect(store.deleteUnreadable("0")).resolves.toEqual({ photoRemoved: false });
    expect(events).toEqual([
      { method: "first", sql: FILES_OF_STORED, params: ["0"] },
      { method: "run", sql: DELETE_STORED, params: ["0"] },
    ]);
  });

  it("says no find has the ID, and deletes nothing", async () => {
    await expect(store.deleteUnreadable("-3")).rejects.toMatchObject({ code: "not-found" });
    expect(events).not.toContainEqual(expect.objectContaining({ sql: DELETE_STORED }));
  });

  it("says no find has the ID when the delete changes no row, and removes no photo (PBI-1.27)", async () => {
    db.reply("first", FILES_OF_STORED, ONE_PHOTO);
    db.reply("run", DELETE_STORED, { changes: 0, lastInsertRowId: 0 });
    photos.files.add("p7.jpg");
    await expect(store.deleteUnreadable("0")).rejects.toMatchObject({ code: "not-found" });
    expect(events).not.toContainEqual({ photo: "remove p7.jpg" });
    expect([...photos.files]).toEqual(["p7.jpg"]);
  });

  it("says when the photo could not be removed", async () => {
    db.reply("first", FILES_OF_STORED, ONE_PHOTO);
    photos.files.add("p7.jpg");
    photos.stuck.add("p7.jpg");
    await expect(store.deleteUnreadable("0")).resolves.toEqual({ photoRemoved: false });
  });

  it.each<[string, unknown]>([
    ["a number", 7],
    ["a fraction", "7.5"],
    ["digits with a leading zero", "07"],
    ["more digits than an SQLite integer has", "12345678901234567890"],
    ["empty", ""],
    ["a SQL fragment", "1 OR 1=1"],
  ])("refuses a stored ID that is %s, sending nothing", async (_, storedId) => {
    await expect(store.deleteUnreadable(wrong(storedId))).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });
});

describe("setPosition", () => {
  const fix = { latitude: 59.65, longitude: 17.09, accuracyM: 8, source: "fix" } as const;

  it("adds the first fix to a find saved without a position", async () => {
    await store.setPosition(7, fix);
    expect(events).toEqual([
      { method: "run", sql: SET_POSITION, params: [59.65, 17.09, 8, "fix", 7] },
    ]);
  });

  it("adds a fix whose accuracy the phone did not give", async () => {
    await store.setPosition(7, { ...fix, accuracyM: null });
    expect(events).toEqual([
      { method: "run", sql: SET_POSITION, params: [59.65, 17.09, null, "fix", 7] },
    ]);
  });

  it("says the find does not exist when no row changed and none has the ID", async () => {
    db.reply("run", SET_POSITION, { changes: 0, lastInsertRowId: 0 });
    await expect(store.setPosition(7, fix)).rejects.toMatchObject({ code: "not-found" });
    expect(events.at(-1)).toEqual({ method: "first", sql: POSITION_SOURCE_OF, params: [7] });
  });

  it("does not replace the position a find already has", async () => {
    db.reply("run", SET_POSITION, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", POSITION_SOURCE_OF, { position_source: "last-known" });
    await expect(store.setPosition(7, fix)).rejects.toMatchObject({ code: "wrong-state" });
  });

  it("refuses a stored position source it does not know", async () => {
    db.reply("run", SET_POSITION, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", POSITION_SOURCE_OF, { position_source: "guess" });
    await expect(store.setPosition(7, fix)).rejects.toMatchObject({ code: "corrupt" });
  });

  it.each<[string, unknown]>([
    ["no position at all", null],
    ["a latitude past 90", { ...fix, latitude: 91 }],
    ["a longitude that is not a number", { ...fix, longitude: "17" }],
    ["a negative accuracy", { ...fix, accuracyM: -2 }],
    [
      "the last known position, which is only ever taken at saving",
      { ...fix, source: "last-known" },
    ],
    ["the photo's position, which is only ever taken at saving", { ...fix, source: "photo" }],
  ])("refuses %s, sending nothing", async (_, position) => {
    await expect(store.setPosition(7, wrong(position))).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });

  it("refuses an ID that is not a positive whole number, sending nothing", async () => {
    await expect(store.setPosition(0, fix)).rejects.toMatchObject({ code: "invalid-input" });
    expect(events).toEqual([]);
  });
});
