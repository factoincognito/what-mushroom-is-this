/**
 * The find log (docs/SPEC.md 3.6): the finds in one SQLite database, their photos as files.
 *
 * No find is left without its photo, and no photo without its find:
 * - adding copies the photo in first and then saves the row; deleting removes the row first and
 *   then the photo. Either way the only thing a crash or an error between the two steps can leave
 *   is a photo no row refers to;
 * - opening the store removes every such photo, before anything can be added.
 */

import { CONFIDENCES, EDIBILITIES, parseAnswerText } from "../analysis/answer";
import { answerToJson } from "./answerJson";
import type { FindDatabase } from "./database";
import {
  type AnalysedAnswer,
  type Analysis,
  checkFailure,
  checkId,
  checkNewFind,
  checkPosition,
  corrupt,
  FAILURE_CAUSES,
  FIND_STATES,
  type Find,
  type FindFailure,
  type FindState,
  type FindSummary,
  type FindTime,
  invalid,
  isOneOf,
  type ListedFind,
  type NewFind,
  POSITION_SOURCES,
  type Position,
  StoreError,
  type SummaryAnalysis,
  TIME_SOURCES,
} from "./find";
import type { PhotoFiles } from "./photoFiles";
import { migrate } from "./schema";

/**
 * The finds. The analysis state changes only as follows; any other change is refused as
 * `wrong-state` and changes nothing:
 *
 * | Change | From | To |
 * |---|---|---|
 * | `setAnswer` | waiting, failed | done |
 * | `replaceAnswer` | done | done (the earlier answer is replaced) |
 * | `markFailed` | waiting, failed | failed |
 * | `markWaiting` | failed | waiting |
 *
 * `setPosition` changes no analysis state: it applies in any state, to a find without a position.
 */
export interface FindStore {
  /** Saves a new find, waiting for analysis, with a copy of its photo; gives its ID. */
  add(find: NewFind): Promise<number>;
  /** The find with the ID, or null when there is none. */
  get(id: number): Promise<Find | null>;
  /**
   * What the Log list shows of every find, the latest taken first. A find whose row cannot be read
   * as `get` reads it is marked unreadable in its place, and the others are listed all the same.
   */
  list(): Promise<ListedFind[]>;
  /**
   * The ID of the waiting find saved first, or null when none waits: the queue's "oldest first" is
   * the order of saving, the find's ID, not the time taken (docs/SPEC.md 3.4). A waiting find
   * whose row cannot be read is passed over and left as it is, so it does not stop the queue; the
   * list shows it as unreadable.
   */
  oldestWaiting(): Promise<number | null>;
  setAnswer(id: number, analysed: AnalysedAnswer): Promise<void>;
  replaceAnswer(id: number, analysed: AnalysedAnswer): Promise<void>;
  markFailed(id: number, failure: FindFailure): Promise<void>;
  markWaiting(id: number): Promise<void>;
  /**
   * Adds the first fix that came after a find was saved without a position (docs/SPEC.md 3.6).
   * Only a fix is added later, and only to a find that has no position; a find that has one
   * keeps it, and the change is refused as `wrong-state`.
   */
  setPosition(id: number, position: Position): Promise<void>;
  /**
   * Deletes the find, then its photo. `photoRemoved` is false when the photo could not be
   * removed: the find is gone all the same, and the next opening of the store removes the photo.
   */
  delete(id: number): Promise<{ photoRemoved: boolean }>;
  /**
   * Deletes a find whose ID the store cannot read (an ID of 0 or below, or one past 2^53, which
   * only a damaged file can hold), named by the `storedId` the list gives it, then its photo when
   * its name can be read (PBI-1.26). `photoRemoved` is false when it could not be. A find whose ID
   * the store can read is never deleted here: for its ID this gives `not-found`. So does a DELETE
   * that changed no row, which removes no photo (PBI-1.27).
   */
  deleteUnreadable(storedId: string): Promise<{ photoRemoved: boolean }>;
}

export interface StoreOptions {
  /** A name for a new photo that no other photo in the directory has. */
  newPhotoName: () => string;
}

const INSERT = `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, latitude, longitude,
  accuracy_m, position_source, photo_file, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`;
/**
 * A time column, given back only within JavaScript's safe-integer range and otherwise as NULL,
 * which the store reads as a row it cannot read. The schema's CHECK keeps the times in that range;
 * this covers a value that passed it by (a damaged file), which some drivers cannot hand back at
 * all (`node:sqlite` throws a RangeError for the whole statement).
 */
const safeTime = (column: string) =>
  `CASE WHEN ${column} BETWEEN ${-Number.MAX_SAFE_INTEGER} AND ${Number.MAX_SAFE_INTEGER}
  THEN ${column} END AS ${column}`;
/**
 * The UTC offset, given back only within the schema's 18 hours and otherwise as NULL, which the
 * store reads as a row it cannot read; for a value that passed the CHECK by, as `safeTime` does.
 */
const SAFE_OFFSET = `CASE WHEN utc_offset_min BETWEEN -1080 AND 1080 THEN utc_offset_min END
  AS utc_offset_min`;
/**
 * The ID, given back only as a positive safe integer and otherwise as NULL, which the store reads
 * as a find whose ID it cannot read; as `safeTime` does, so that no driver has to hand back an ID
 * past 2^53 (PBI-1.26). Such a find is still named by its ID as SQLite writes it (`STORED_ID`).
 */
const SAFE_ID = `CASE WHEN id BETWEEN 1 AND ${Number.MAX_SAFE_INTEGER} THEN id END AS id`;
/** Every column of a find, as `get`, the queue's pick and the list all read it. */
const FIND_COLUMNS = `${SAFE_ID}, ${safeTime("taken_at_ms")}, ${SAFE_OFFSET}, time_source,
  latitude, longitude, accuracy_m, position_source, photo_file, state, failure_cause,
  failure_detail, answer_json, model, ${safeTime("analysed_at_ms")}`;
const GET = `SELECT ${FIND_COLUMNS} FROM finds WHERE finds.id = ?`;
/**
 * The finds, the latest taken first, by the stored time and ID (`finds.`, not the columns read),
 * each also with its ID as SQLite writes it, exactly, whatever the ID.
 */
const LIST = `SELECT ${FIND_COLUMNS}, CAST(finds.id AS TEXT) AS stored_id, result, name_sv,
  name_en, name_it, edibility, confidence FROM finds
  ORDER BY finds.taken_at_ms DESC, finds.id DESC`;
/**
 * The waiting find saved first after a given ID, among the IDs the store can read: one past 2^53
 * could not be passed over, since JavaScript cannot hold it to ask for the next (PBI-1.26).
 */
const NEXT_WAITING = `SELECT ${FIND_COLUMNS} FROM finds WHERE state = 'waiting'
  AND finds.id > ? AND finds.id <= ${Number.MAX_SAFE_INTEGER} ORDER BY finds.id ASC LIMIT 1`;
/**
 * The IDs the store cannot read, those `SAFE_ID` gives back as NULL: `deleteUnreadable` matches
 * only these, so it never deletes a find whose ID the store can read, which `delete` is for.
 */
const UNREADABLE_ID = `(id < 1 OR id > ${Number.MAX_SAFE_INTEGER})`;
/** The photo of, and the deletion of, a find named by its ID as SQLite writes it. */
const PHOTO_OF_STORED = `SELECT photo_file FROM finds WHERE CAST(id AS TEXT) = ? AND ${UNREADABLE_ID}`;
const DELETE_STORED = `DELETE FROM finds WHERE CAST(id AS TEXT) = ? AND ${UNREADABLE_ID}`;
/** An SQLite integer's decimal form, as CAST(… AS TEXT) writes it: at most 19 digits. */
const STORED_ID = /^(0|-?[1-9][0-9]{0,18})$/;
const ANSWER_COLUMNS = `state = 'done', failure_cause = NULL, failure_detail = NULL,
  answer_json = ?, model = ?, analysed_at_ms = ?, result = ?, name_sv = ?, name_en = ?,
  name_it = ?, edibility = ?, confidence = ?`;
const SET_ANSWER = `UPDATE finds SET ${ANSWER_COLUMNS} WHERE id = ? AND state IN ('waiting', 'failed')`;
const REPLACE_ANSWER = `UPDATE finds SET ${ANSWER_COLUMNS} WHERE id = ? AND state = 'done'`;
const MARK_FAILED = `UPDATE finds SET state = 'failed', failure_cause = ?, failure_detail = ?
  WHERE id = ? AND state IN ('waiting', 'failed')`;
const MARK_WAITING = `UPDATE finds SET state = 'waiting', failure_cause = NULL,
  failure_detail = NULL WHERE id = ? AND state = 'failed'`;
const SET_POSITION = `UPDATE finds SET latitude = ?, longitude = ?, accuracy_m = ?,
  position_source = ? WHERE id = ? AND position_source IS NULL`;
const POSITION_SOURCE_OF = "SELECT position_source FROM finds WHERE id = ?";
const STATE_OF = "SELECT state FROM finds WHERE id = ?";
const PHOTO_OF = "SELECT photo_file FROM finds WHERE id = ?";
const DELETE = "DELETE FROM finds WHERE id = ?";
const ALL_PHOTOS = "SELECT photo_file FROM finds";

/**
 * Opens the store on a database and a photo directory: brings the database to the current
 * schema, makes the directory, and removes the photos no find refers to.
 */
export async function createFindStore(
  db: FindDatabase,
  photos: PhotoFiles,
  options: StoreOptions,
): Promise<FindStore> {
  await migrate(db);
  photos.prepare();
  await removeOrphans(db, photos);

  /** Runs an update that applies only in some states; says why when it changed nothing. */
  async function update(id: number, sql: string, params: (string | number | null)[]) {
    const { changes } = await db.runAsync(sql, [...params, id]);
    if (changes > 0) {
      return;
    }
    const row = await db.getFirstAsync(STATE_OF, [id]);
    if (row === null) {
      throw new StoreError("not-found", `no find has the ID ${id}`);
    }
    const state = enumOf(record(row), "state", FIND_STATES);
    throw new StoreError("wrong-state", `find ${id} is ${state}; the change does not apply`);
  }

  async function answer(id: number, analysed: AnalysedAnswer, sql: string): Promise<void> {
    checkId(id);
    await update(id, sql, answerColumns(analysed));
  }

  return {
    async add(find) {
      checkNewFind(find);
      const name = await photos.copyIn(find.photoUri, options.newPhotoName());
      const { time, position } = find;
      try {
        const { lastInsertRowId } = await db.runAsync(INSERT, [
          time.takenAtMs,
          time.utcOffsetMinutes,
          time.source,
          position?.latitude ?? null,
          position?.longitude ?? null,
          position?.accuracyM ?? null,
          position?.source ?? null,
          name,
        ]);
        return lastInsertRowId;
      } catch (error) {
        removeQuietly(photos, name);
        throw error;
      }
    },

    async get(id) {
      checkId(id);
      const row = await db.getFirstAsync(GET, [id]);
      return row === null ? null : readFind(record(row), photos);
    },

    async list() {
      const rows = await db.getAllAsync(LIST, []);
      return rows.map((row) => listed(row, photos));
    },

    async oldestWaiting() {
      let after = 0;
      for (;;) {
        const found = await db.getFirstAsync(NEXT_WAITING, [after]);
        if (found === null) {
          return null;
        }
        const row = record(found);
        // Without its ID there is no passing over it: the next ask would give the same row.
        const id = integerOf(row, "id");
        if (readsAsFind(row, photos)) {
          return id;
        }
        after = id;
      }
    },

    setAnswer: (id, analysed) => answer(id, analysed, SET_ANSWER),

    replaceAnswer: (id, analysed) => answer(id, analysed, REPLACE_ANSWER),

    async markFailed(id, failure) {
      checkId(id);
      checkFailure(failure);
      await update(id, MARK_FAILED, [failure.cause, failure.detail]);
    },

    async markWaiting(id) {
      checkId(id);
      await update(id, MARK_WAITING, []);
    },

    async setPosition(id, position) {
      checkId(id);
      checkPosition(position);
      if (position.source !== "fix") {
        throw invalid("only a fix is added to a find after it is saved");
      }
      const { latitude, longitude, accuracyM, source } = position;
      const { changes } = await db.runAsync(SET_POSITION, [
        latitude,
        longitude,
        accuracyM,
        source,
        id,
      ]);
      if (changes > 0) {
        return;
      }
      const row = await db.getFirstAsync(POSITION_SOURCE_OF, [id]);
      if (row === null) {
        throw new StoreError("not-found", `no find has the ID ${id}`);
      }
      const had = enumOf(record(row), "position_source", POSITION_SOURCES);
      throw new StoreError("wrong-state", `find ${id} already has a position (${had})`);
    },

    async delete(id) {
      checkId(id);
      const row = await db.getFirstAsync(PHOTO_OF, [id]);
      if (row === null) {
        throw new StoreError("not-found", `no find has the ID ${id}`);
      }
      const name = textOf(record(row), "photo_file");
      await db.runAsync(DELETE, [id]);
      return { photoRemoved: removeQuietly(photos, name) };
    },

    async deleteUnreadable(storedId) {
      if (typeof storedId !== "string" || !STORED_ID.test(storedId)) {
        throw invalid("the stored ID is not an SQLite integer's decimal form");
      }
      const row = await db.getFirstAsync(PHOTO_OF_STORED, [storedId]);
      if (row === null) {
        throw new StoreError("not-found", `no find has the ID ${storedId}`);
      }
      const name = record(row).photo_file;
      // A DELETE that changed no row deleted no find (another delete of it came first, say), so
      // the photo is not its to remove (PBI-1.27).
      const { changes } = await db.runAsync(DELETE_STORED, [storedId]);
      if (changes === 0) {
        throw new StoreError("not-found", `no find has the ID ${storedId}`);
      }
      return { photoRemoved: typeof name === "string" && removeQuietly(photos, name) };
    },
  };
}

/**
 * Removes the photos no find refers to. When a find's photo name cannot be read (a damaged file),
 * that find's photo could be any of them, so none is removed; the store opens all the same
 * (PBI-1.26).
 */
async function removeOrphans(db: FindDatabase, photos: PhotoFiles): Promise<void> {
  const rows = await db.getAllAsync(ALL_PHOTOS, []);
  const names = rows.map((row) => record(row).photo_file);
  const kept = new Set<string>();
  for (const name of names) {
    if (typeof name !== "string") {
      return;
    }
    kept.add(name);
  }
  for (const name of photos.list()) {
    if (!kept.has(name)) {
      removeQuietly(photos, name);
    }
  }
}

/** Removes a photo; says whether that worked. One left behind is removed at the next opening. */
function removeQuietly(photos: PhotoFiles, name: string): boolean {
  try {
    photos.remove(name);
    return true;
  } catch {
    return false;
  }
}

/** The values of `ANSWER_COLUMNS`, from an answer checked against the shape. */
function answerColumns(analysed: AnalysedAnswer): (string | number | null)[] {
  const { answer, model, analysedAtMs } = analysed;
  if (typeof model !== "string" || model.trim().length === 0) {
    throw invalid("the model ID is empty");
  }
  if (!Number.isSafeInteger(analysedAtMs)) {
    throw invalid("the analysis time is not a whole number of milliseconds");
  }
  let json: string;
  try {
    json = answerToJson(answer);
  } catch {
    throw invalid("the answer is not of the shape");
  }
  const checked = parseAnswerText(json);
  if (!checked.ok) {
    throw invalid(`the answer is not of the shape: ${checked.detail}`);
  }
  const valid = checked.answer;
  if (valid.result !== "match") {
    return [json, model, analysedAtMs, valid.result, null, null, null, null, null];
  }
  const { sv, en, it } = valid.names;
  return [json, model, analysedAtMs, "match", sv, en, it, valid.edibility, valid.confidence];
}

type Row = Record<string, unknown>;

function record(row: unknown): Row {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw corrupt("a stored row is not an object");
  }
  return Object.fromEntries(Object.entries(row));
}

function readFind(row: Row, photos: PhotoFiles): Find {
  return {
    id: idOf(row),
    photoUri: photos.uriOf(textOf(row, "photo_file")),
    time: readTime(row),
    position: readPosition(row),
    analysis: readAnalysis(row),
  };
}

/** Whether the row reads as a find; an error that is not about what is stored passes through. */
function readsAsFind(row: Row, photos: PhotoFiles): boolean {
  try {
    readFind(row, photos);
    return true;
  } catch (error) {
    if (isCorrupt(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * A row of the list, or its mark when it cannot be read. A row is judged as `get` and the queue's
 * pick judge it, by reading the whole find, its position and its answer included, so the Log
 * never shows as readable a find whose screen cannot open or which the queue passes over.
 */
function listed(stored: unknown, photos: PhotoFiles): ListedFind {
  try {
    const row = record(stored);
    readFind(row, photos);
    return { readable: true, ...readSummary(row, photos) };
  } catch (error) {
    if (!isCorrupt(error)) {
      throw error;
    }
    const id = readableId(stored);
    return id === null
      ? { readable: false, id: null, storedId: storedIdOf(stored) }
      : { readable: false, id };
  }
}

/** The ID of a row that cannot be read, when the ID itself can be; otherwise null. */
function readableId(stored: unknown): number | null {
  const id = typeof stored === "object" && stored !== null && "id" in stored ? stored.id : null;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A row's ID as SQLite writes it, when it is an SQLite integer's decimal form; otherwise null. */
function storedIdOf(stored: unknown): string | null {
  const value =
    typeof stored === "object" && stored !== null && "stored_id" in stored
      ? stored.stored_id
      : null;
  return typeof value === "string" && STORED_ID.test(value) ? value : null;
}

function isCorrupt(error: unknown): boolean {
  return error instanceof StoreError && error.code === "corrupt";
}

function readSummary(row: Row, photos: PhotoFiles): FindSummary {
  return {
    id: idOf(row),
    photoUri: photos.uriOf(textOf(row, "photo_file")),
    time: readTime(row),
    analysis: readSummaryAnalysis(row),
  };
}

function readTime(row: Row): FindTime {
  return {
    takenAtMs: integerOf(row, "taken_at_ms"),
    utcOffsetMinutes: integerOf(row, "utc_offset_min"),
    source: enumOf(row, "time_source", TIME_SOURCES),
  };
}

function readPosition(row: Row): Position | null {
  const { latitude, longitude, accuracy_m, position_source } = row;
  if (latitude === null && longitude === null && accuracy_m === null && position_source === null) {
    return null;
  }
  return {
    latitude: numberOf(row, "latitude"),
    longitude: numberOf(row, "longitude"),
    accuracyM: accuracy_m === null ? null : numberOf(row, "accuracy_m"),
    source: enumOf(row, "position_source", POSITION_SOURCES),
  };
}

function readAnalysis(row: Row): Analysis {
  const state = enumOf(row, "state", FIND_STATES);
  switch (state) {
    case "waiting":
      return { state };
    case "failed":
      return { state, failure: readFailure(row) };
    case "done": {
      const parsed = parseAnswerText(textOf(row, "answer_json"));
      if (!parsed.ok) {
        throw corrupt(`the stored answer is not of the shape: ${parsed.detail}`);
      }
      return {
        state,
        answer: parsed.answer,
        model: textOf(row, "model"),
        analysedAtMs: integerOf(row, "analysed_at_ms"),
      };
    }
  }
}

function readSummaryAnalysis(row: Row): SummaryAnalysis {
  const state: FindState = enumOf(row, "state", FIND_STATES);
  if (state === "waiting") {
    return { state };
  }
  if (state === "failed") {
    return { state, failure: readFailure(row) };
  }
  const result = enumOf(row, "result", ["match", "no_mushroom", "cannot_tell"] as const);
  if (result !== "match") {
    return { state, result };
  }
  return {
    state,
    result,
    names: { sv: textOf(row, "name_sv"), en: textOf(row, "name_en"), it: textOf(row, "name_it") },
    edibility: enumOf(row, "edibility", EDIBILITIES),
    confidence: enumOf(row, "confidence", CONFIDENCES),
  };
}

function readFailure(row: Row): FindFailure {
  return {
    cause: enumOf(row, "failure_cause", FAILURE_CAUSES),
    detail: textOf(row, "failure_detail"),
  };
}

function textOf(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw corrupt(`the stored ${column} is not text`);
  }
  return value;
}

function numberOf(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw corrupt(`the stored ${column} is not a number`);
  }
  return value;
}

function integerOf(row: Row, column: string): number {
  const value = numberOf(row, column);
  if (!Number.isSafeInteger(value)) {
    throw corrupt(`the stored ${column} is not a whole number`);
  }
  return value;
}

/** The find's ID, read by the rule `checkId` applies to an ID given to the store. */
function idOf(row: Row): number {
  const id = integerOf(row, "id");
  if (id < 1) {
    throw corrupt("the stored id is not a positive whole number");
  }
  return id;
}

function enumOf<T extends string>(row: Row, column: string, values: readonly T[]): T {
  const value = row[column];
  if (!isOneOf(values, value)) {
    throw corrupt(`the stored ${column} is not one the store knows`);
  }
  return value;
}
