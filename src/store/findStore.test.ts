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

  /** The reply to a statement; an Error is thrown. A later reply to the same statement wins. */
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
    if (found.value instanceof Error) {
      throw found.value;
    }
    return found.value;
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
    return `file:///doc/photos/${name}`;
  }
}

const INSERT =
  "INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, latitude, longitude, accuracy_m, position_source, photo_file, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting')";
const GET =
  "SELECT id, taken_at_ms, utc_offset_min, time_source, latitude, longitude, accuracy_m, position_source, photo_file, state, failure_cause, failure_detail, answer_json, model, analysed_at_ms FROM finds WHERE id = ?";
const LIST =
  "SELECT id, taken_at_ms, utc_offset_min, time_source, photo_file, state, failure_cause, failure_detail, result, name_sv, name_en, name_it, edibility, confidence FROM finds ORDER BY taken_at_ms DESC, id DESC";
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

function summaryRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7,
    taken_at_ms: 1_762_590_000_000,
    utc_offset_min: 60,
    time_source: "saved",
    photo_file: "p7.jpg",
    state: "waiting",
    failure_cause: null,
    failure_detail: null,
    result: null,
    name_sv: null,
    name_en: null,
    name_it: null,
    edibility: null,
    confidence: null,
    ...overrides,
  };
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

  it("refuses to open when the finds' photo names cannot be read", async () => {
    db.reply("all", ALL_PHOTOS, [{ photo_file: 3 }]);
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
      summaryRow({
        id: 9,
        state: "done",
        result: "match",
        name_sv: "Kantarell",
        name_en: "Chanterelle",
        name_it: "Gallinaccio",
        edibility: "edible",
        confidence: "low",
      }),
      summaryRow({ id: 8, state: "done", result: "no_mushroom" }),
      summaryRow({ id: 7, state: "failed", failure_cause: "answer", failure_detail: "shape" }),
      summaryRow({ id: 6 }),
    ]);
    const time = { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" };
    await expect(store.list()).resolves.toEqual([
      {
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
        id: 8,
        photoUri: "file:///doc/photos/p7.jpg",
        time,
        analysis: { state: "done", result: "no_mushroom" },
      },
      {
        id: 7,
        photoUri: "file:///doc/photos/p7.jpg",
        time,
        analysis: { state: "failed", failure: { cause: "answer", detail: "shape" } },
      },
      { id: 6, photoUri: "file:///doc/photos/p7.jpg", time, analysis: { state: "waiting" } },
    ]);
    expect(events).toEqual([{ method: "all", sql: LIST, params: [] }]);
  });

  it("gives an empty list for an empty log", async () => {
    await expect(store.list()).resolves.toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    [
      "a match without a name",
      {
        state: "done",
        result: "match",
        name_sv: null,
        name_en: "e",
        name_it: "i",
        edibility: "edible",
        confidence: "high",
      },
    ],
    [
      "a match with an unknown edibility",
      {
        state: "done",
        result: "match",
        name_sv: "s",
        name_en: "e",
        name_it: "i",
        edibility: "tasty",
        confidence: "high",
      },
    ],
    [
      "a match with an unknown confidence",
      {
        state: "done",
        result: "match",
        name_sv: "s",
        name_en: "e",
        name_it: "i",
        edibility: "edible",
        confidence: "sure",
      },
    ],
    ["a done find with an unknown result", { state: "done", result: "maybe" }],
  ])("refuses a stored row with %s", async (_, overrides) => {
    db.reply("all", LIST, [summaryRow(overrides)]);
    await expect(store.list()).rejects.toMatchObject({ code: "corrupt" });
  });
});

describe("oldestWaiting (PBI-1.7)", () => {
  const OLDEST_WAITING = "SELECT id FROM finds WHERE state = 'waiting' ORDER BY id ASC LIMIT 1";

  it("asks for the waiting find saved first, by its ID, and gives its ID", async () => {
    db.reply("first", OLDEST_WAITING, { id: 4 });
    await expect(store.oldestWaiting()).resolves.toBe(4);
    expect(events).toEqual([{ method: "first", sql: OLDEST_WAITING, params: [] }]);
  });

  it("gives null when no find is waiting", async () => {
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });

  it.each([
    ["not a whole number", { id: 4.5 }],
    ["not a number", { id: "4" }],
    ["missing", {}],
  ])("refuses a stored ID that is %s as corrupt", async (_name, reply) => {
    db.reply("first", OLDEST_WAITING, reply);
    await expect(store.oldestWaiting()).rejects.toMatchObject({ code: "corrupt" });
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
