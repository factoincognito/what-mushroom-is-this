import type { SQLiteBindParams } from "expo-sqlite";

import type { Answer, Match } from "../analysis/answer";
import { answerToJson } from "./answerJson";
import type { FindDatabase, SqlRunner } from "./database";
import { type AnalysedAnswer, type NewFind, StoreError } from "./find";
import { createFindStore, type FindStore } from "./findStore";
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
const INSERT = `INSERT INTO finds (id, taken_at_ms, utc_offset_min, time_source, latitude, longitude, accuracy_m, position_source, photo_file, state) VALUES (${NEXT_ID}, ?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`;
/** A time column, given back only within JavaScript's safe-integer range, else as NULL. */
const safeTime = (column: string) =>
  `CASE WHEN ${column} BETWEEN -9007199254740991 AND 9007199254740991 THEN ${column} END AS ${column}`;
/** The UTC offset, given back only within the schema's 18 hours, else as NULL. */
const SAFE_OFFSET =
  "CASE WHEN utc_offset_min BETWEEN -1080 AND 1080 THEN utc_offset_min END AS utc_offset_min";
/** The ID, given back only as a positive safe integer, else as NULL (PBI-1.26). */
const SAFE_ID = "CASE WHEN id BETWEEN 1 AND 9007199254740991 THEN id END AS id";
const FIND_COLUMNS = `${SAFE_ID}, ${safeTime("taken_at_ms")}, ${SAFE_OFFSET}, time_source, latitude, longitude, accuracy_m, position_source, photo_file, state, failure_cause, failure_detail, answer_json, model, ${safeTime("analysed_at_ms")}`;
const GET = `SELECT ${FIND_COLUMNS} FROM finds WHERE finds.id = ?`;
const NEXT_WAITING = `SELECT ${FIND_COLUMNS} FROM finds WHERE state = 'waiting' AND finds.id > ? AND finds.id <= 9007199254740991 ORDER BY finds.id ASC LIMIT 1`;
const LIST = `SELECT ${FIND_COLUMNS}, CAST(finds.id AS TEXT) AS stored_id, result, name_sv, name_en, name_it, edibility, confidence FROM finds ORDER BY finds.taken_at_ms DESC, finds.id DESC`;
/** Only among the IDs the store cannot read: a readable find is deleted by `delete` alone. */
const UNREADABLE_ID = "(id < 1 OR id > 9007199254740991)";
const PHOTO_OF_STORED = `SELECT photo_file FROM finds WHERE CAST(id AS TEXT) = ? AND ${UNREADABLE_ID}`;
const DELETE_STORED = `DELETE FROM finds WHERE CAST(id AS TEXT) = ? AND ${UNREADABLE_ID}`;
const ANSWER_COLUMNS =
  "state = 'done', failure_cause = NULL, failure_detail = NULL, answer_json = ?, model = ?, analysed_at_ms = ?, result = ?, name_sv = ?, name_en = ?, name_it = ?, edibility = ?, confidence = ?";
const SET_ANSWER = `UPDATE finds SET ${ANSWER_COLUMNS} WHERE id = ? AND state IN ('waiting', 'failed')`;
const REPLACE_ANSWER = `UPDATE finds SET ${ANSWER_COLUMNS} WHERE id = ? AND state = 'done'`;
const MARK_FAILED =
  "UPDATE finds SET state = 'failed', failure_cause = ?, failure_detail = ? WHERE id = ? AND state IN ('waiting', 'failed')";
const MARK_WAITING =
  "UPDATE finds SET state = 'waiting', failure_cause = NULL, failure_detail = NULL WHERE id = ? AND state = 'failed'";
const STATE_OF = "SELECT state FROM finds WHERE id = ?";
const PHOTO_OF = "SELECT photo_file FROM finds WHERE id = ?";
const DELETE = "DELETE FROM finds WHERE id = ?";
const ALL_PHOTOS = "SELECT photo_file FROM finds";
const SET_POSITION =
  "UPDATE finds SET latitude = ?, longitude = ?, accuracy_m = ?, position_source = ? WHERE id = ? AND position_source IS NULL";
const POSITION_SOURCE_OF = "SELECT position_source FROM finds WHERE id = ?";

const match: Match = {
  result: "match",
  names: { sv: "Kantarell", en: "Chanterelle", la: "Cantharellus cibarius", it: "Gallinaccio" },
  edibility: "edible",
  confidence: "high",
  generalInformation: { sv: "Gul.", en: "Yellow.", it: "Giallo." },
  lookAlikes: [],
};

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
    photo_file: "p7.jpg",
    state: "waiting",
    failure_cause: null,
    failure_detail: null,
    answer_json: null,
    model: null,
    analysed_at_ms: null,
    ...overrides,
  };
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
    result: "match",
    name_sv: "Kantarell",
    name_en: "Chanterelle",
    name_it: "Gallinaccio",
    edibility: "edible",
    confidence: "high",
    ...overrides,
  });
}

let events: Event[];
let db: FakeDatabase;
let photos: FakePhotos;
let store: FindStore;

async function open(): Promise<FindStore> {
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
  it("migrates, prepares the photo directory, then removes the photos no find refers to", async () => {
    photos.files.add("p7.jpg");
    photos.files.add("orphan.jpg");
    db.reply("all", ALL_PHOTOS, [{ photo_file: "p7.jpg" }]);
    await open();
    expect(events).toEqual([
      { method: "first", sql: "PRAGMA user_version", params: [] },
      { photo: "prepare" },
      { method: "all", sql: ALL_PHOTOS, params: [] },
      { photo: "remove orphan.jpg" },
    ]);
    expect([...photos.files]).toEqual(["p7.jpg"]);
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
    db.reply("all", ALL_PHOTOS, [{ photo_file: "p7.jpg" }, { photo_file: 3 }]);
    await expect(open()).resolves.toBeDefined();
    expect([...photos.files].sort()).toEqual(["p7.jpg", "unknown.jpg"]);
    expect(events).not.toContainEqual(
      expect.objectContaining({ photo: expect.stringMatching(/^remove/) }),
    );
  });

  it("refuses to open when a stored row of the photo names is not an object", async () => {
    db.reply("all", ALL_PHOTOS, ["a row"]);
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
    db.reply("all", ALL_PHOTOS, []);
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
      }),
    );
    await expect(store.get(7)).resolves.toMatchObject({
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
    ["a photo name stored as a number", { photo_file: 7 }],
    [
      "a done find whose answer is not JSON",
      { state: "done", answer_json: "{", model: "m", analysed_at_ms: 1 },
    ],
    [
      "a done find whose answer does not fit the shape",
      { state: "done", answer_json: '{"result":"maybe"}', model: "m", analysed_at_ms: 1 },
    ],
    [
      "a done find without a model",
      { state: "done", answer_json: answerToJson(match), model: null, analysed_at_ms: 1 },
    ],
    [
      "a done find without its analysis time",
      { state: "done", answer_json: answerToJson(match), model: "m", analysed_at_ms: null },
    ],
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
        id: 9,
        answer_json: answerToJson({ ...match, confidence: "low" }),
        confidence: "low",
      }),
      summaryRow({
        id: 8,
        state: "done",
        answer_json: answerToJson({ result: "no_mushroom" }),
        model: "m",
        analysed_at_ms: 1,
        result: "no_mushroom",
      }),
      summaryRow({ id: 7, state: "failed", failure_cause: "answer", failure_detail: "shape" }),
      summaryRow({ id: 6 }),
    ]);
    const time = { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" };
    await expect(store.list()).resolves.toEqual([
      {
        readable: true,
        id: 9,
        photoUri: "file:///doc/photos/p7.jpg",
        time,
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
        analysis: { state: "done", result: "no_mushroom" },
      },
      {
        readable: true,
        id: 7,
        photoUri: "file:///doc/photos/p7.jpg",
        time,
        analysis: { state: "failed", failure: { cause: "answer", detail: "shape" } },
      },
      {
        readable: true,
        id: 6,
        photoUri: "file:///doc/photos/p7.jpg",
        time,
        analysis: { state: "waiting" },
      },
    ]);
    expect(events).toEqual([{ method: "all", sql: LIST, params: [] }]);
  });

  it("gives an empty list for an empty log", async () => {
    await expect(store.list()).resolves.toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ["a match without a name", doneMatchRow({ name_sv: null })],
    ["a match with an unknown edibility", doneMatchRow({ edibility: "tasty" })],
    ["a match with an unknown confidence", doneMatchRow({ confidence: "sure" })],
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
    ["a photo name stored as a number", summaryRow({ photo_file: 7 })],
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

describe("setAnswer", () => {
  it("saves the answer as JSON with the Log's fields, for a waiting or failed find", async () => {
    await store.setAnswer(7, analysed);
    expect(events).toEqual([
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
          "high",
          7,
        ],
      },
    ]);
  });

  it("keeps the edibility Claude gave even at low confidence", async () => {
    const low: Match = { ...match, edibility: "deadly_poisonous", confidence: "low" };
    await store.setAnswer(7, { ...analysed, answer: low });
    expect(events[0]).toMatchObject({
      params: expect.arrayContaining(["deadly_poisonous", "low"]),
    });
  });

  it.each<[string, Answer]>([
    ["no mushroom", { result: "no_mushroom" }],
    ["cannot tell", { result: "cannot_tell" }],
  ])("saves a '%s' answer with no names, edibility or confidence", async (_, answer) => {
    await store.setAnswer(7, { ...analysed, answer });
    expect(events[0]).toMatchObject({
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
        7,
      ],
    });
  });

  it("refuses an answer that does not fit the shape, sending nothing", async () => {
    const empty: Match = { ...match, names: { ...match.names, sv: "" } };
    await expect(store.setAnswer(7, { ...analysed, answer: empty })).rejects.toMatchObject({
      code: "invalid-input",
    });
    expect(events).toEqual([]);
  });

  it.each<[string, AnalysedAnswer]>([
    ["an empty model", { ...analysed, model: "  " }],
    ["a model that is not a string", { ...analysed, model: wrong(4) }],
    ["an analysis time that is not whole", { ...analysed, analysedAtMs: 0.5 }],
  ])("refuses %s, sending nothing", async (_, given) => {
    await expect(store.setAnswer(7, given)).rejects.toMatchObject({ code: "invalid-input" });
    expect(events).toEqual([]);
  });

  it("says the find does not exist when no row changed and none has the ID", async () => {
    db.reply("run", SET_ANSWER, { changes: 0, lastInsertRowId: 0 });
    await expect(store.setAnswer(7, analysed)).rejects.toMatchObject({ code: "not-found" });
    expect(events.at(-1)).toEqual({ method: "first", sql: STATE_OF, params: [7] });
  });

  it("says the find is in the wrong state when it is already done", async () => {
    db.reply("run", SET_ANSWER, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", STATE_OF, { state: "done" });
    await expect(store.setAnswer(7, analysed)).rejects.toMatchObject({ code: "wrong-state" });
  });
});

describe("replaceAnswer", () => {
  it("replaces the answer of a done find only", async () => {
    await store.replaceAnswer(7, analysed);
    expect(events).toEqual([expect.objectContaining({ method: "run", sql: REPLACE_ANSWER })]);
  });

  it("says the find is in the wrong state when it has no answer yet", async () => {
    db.reply("run", REPLACE_ANSWER, { changes: 0, lastInsertRowId: 0 });
    db.reply("first", STATE_OF, { state: "waiting" });
    await expect(store.replaceAnswer(7, analysed)).rejects.toMatchObject({ code: "wrong-state" });
  });

  it("refuses an answer that does not fit the shape, sending nothing", async () => {
    await expect(
      store.replaceAnswer(7, { ...analysed, answer: { ...match, lookAlikes: wrong("none") } }),
    ).rejects.toMatchObject({ code: "invalid-input" });
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

describe("delete", () => {
  it("says no find has the ID when the delete changes no row, and removes no photo (PBI-1.27)", async () => {
    photos.files.add("p7.jpg");
    db.reply("first", PHOTO_OF, { photo_file: "p7.jpg" });
    db.reply("run", DELETE, { changes: 0, lastInsertRowId: 0 });
    await expect(store.delete(7)).rejects.toMatchObject({ code: "not-found" });
    expect(events).not.toContainEqual({ photo: "remove p7.jpg" });
    expect([...photos.files]).toEqual(["p7.jpg"]);
  });

  it("deletes the find first, then its photo", async () => {
    photos.files.add("p7.jpg");
    db.reply("first", PHOTO_OF, { photo_file: "p7.jpg" });
    await expect(store.delete(7)).resolves.toEqual({ photoRemoved: true });
    expect(events).toEqual([
      { method: "first", sql: PHOTO_OF, params: [7] },
      { method: "run", sql: DELETE, params: [7] },
      { photo: "remove p7.jpg" },
    ]);
    expect(photos.files.size).toBe(0);
  });

  it("says the find does not exist, and deletes nothing", async () => {
    await expect(store.delete(7)).rejects.toMatchObject({ code: "not-found" });
    expect(events).toEqual([{ method: "first", sql: PHOTO_OF, params: [7] }]);
  });

  it("keeps the photo when the find cannot be deleted, so no find is left without its photo", async () => {
    photos.files.add("p7.jpg");
    db.reply("first", PHOTO_OF, { photo_file: "p7.jpg" });
    db.reply("run", DELETE, new Error("database is locked"));
    await expect(store.delete(7)).rejects.toThrow("database is locked");
    expect([...photos.files]).toEqual(["p7.jpg"]);
  });

  it("says when the photo could not be removed, and the next opening removes it", async () => {
    photos.files.add("p7.jpg");
    photos.stuck.add("p7.jpg");
    db.reply("first", PHOTO_OF, { photo_file: "p7.jpg" });
    await expect(store.delete(7)).resolves.toEqual({ photoRemoved: false });

    photos.stuck.clear();
    db.reply("all", ALL_PHOTOS, []);
    await open();
    expect(photos.files.size).toBe(0);
  });

  it("refuses a stored photo name that is not text", async () => {
    db.reply("first", PHOTO_OF, { photo_file: null });
    await expect(store.delete(7)).rejects.toMatchObject({ code: "corrupt" });
    expect(events).not.toContainEqual(expect.objectContaining({ sql: DELETE }));
  });
});

describe("deleteUnreadable (PBI-1.26)", () => {
  it("deletes the find by its ID as SQLite writes it, then its photo", async () => {
    db.reply("first", PHOTO_OF_STORED, { photo_file: "p7.jpg" });
    photos.files.add("p7.jpg");
    await expect(store.deleteUnreadable("9007199254740993")).resolves.toEqual({
      photoRemoved: true,
    });
    expect(events).toEqual([
      { method: "first", sql: PHOTO_OF_STORED, params: ["9007199254740993"] },
      { method: "run", sql: DELETE_STORED, params: ["9007199254740993"] },
      { photo: "remove p7.jpg" },
    ]);
  });

  it("deletes the find even when its photo name cannot be read, which leaves its photo", async () => {
    db.reply("first", PHOTO_OF_STORED, { photo_file: 3 });
    await expect(store.deleteUnreadable("0")).resolves.toEqual({ photoRemoved: false });
    expect(events).toEqual([
      { method: "first", sql: PHOTO_OF_STORED, params: ["0"] },
      { method: "run", sql: DELETE_STORED, params: ["0"] },
    ]);
  });

  it("says no find has the ID, and deletes nothing", async () => {
    await expect(store.deleteUnreadable("-3")).rejects.toMatchObject({ code: "not-found" });
    expect(events).not.toContainEqual(expect.objectContaining({ sql: DELETE_STORED }));
  });

  it("says no find has the ID when the delete changes no row, and removes no photo (PBI-1.27)", async () => {
    db.reply("first", PHOTO_OF_STORED, { photo_file: "p7.jpg" });
    db.reply("run", DELETE_STORED, { changes: 0, lastInsertRowId: 0 });
    photos.files.add("p7.jpg");
    await expect(store.deleteUnreadable("0")).rejects.toMatchObject({ code: "not-found" });
    expect(events).not.toContainEqual({ photo: "remove p7.jpg" });
    expect([...photos.files]).toEqual(["p7.jpg"]);
  });

  it("says when the photo could not be removed", async () => {
    db.reply("first", PHOTO_OF_STORED, { photo_file: "p7.jpg" });
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
