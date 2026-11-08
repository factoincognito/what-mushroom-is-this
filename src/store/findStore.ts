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
 */
export interface FindStore {
  /** Saves a new find, waiting for analysis, with a copy of its photo; gives its ID. */
  add(find: NewFind): Promise<number>;
  /** The find with the ID, or null when there is none. */
  get(id: number): Promise<Find | null>;
  /** What the Log list shows of every find, the latest taken first. */
  list(): Promise<FindSummary[]>;
  setAnswer(id: number, analysed: AnalysedAnswer): Promise<void>;
  replaceAnswer(id: number, analysed: AnalysedAnswer): Promise<void>;
  markFailed(id: number, failure: FindFailure): Promise<void>;
  markWaiting(id: number): Promise<void>;
  /**
   * Deletes the find, then its photo. `photoRemoved` is false when the photo could not be
   * removed: the find is gone all the same, and the next opening of the store removes the photo.
   */
  delete(id: number): Promise<{ photoRemoved: boolean }>;
}

export interface StoreOptions {
  /** A name for a new photo that no other photo in the directory has. */
  newPhotoName: () => string;
}

const INSERT = `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, latitude, longitude,
  accuracy_m, position_source, photo_file, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'waiting')`;
const GET = `SELECT id, taken_at_ms, utc_offset_min, time_source, latitude, longitude, accuracy_m,
  position_source, photo_file, state, failure_cause, failure_detail, answer_json, model,
  analysed_at_ms FROM finds WHERE id = ?`;
const LIST = `SELECT id, taken_at_ms, utc_offset_min, time_source, photo_file, state, failure_cause,
  failure_detail, result, name_sv, name_en, name_it, edibility, confidence FROM finds
  ORDER BY taken_at_ms DESC, id DESC`;
const ANSWER_COLUMNS = `state = 'done', failure_cause = NULL, failure_detail = NULL,
  answer_json = ?, model = ?, analysed_at_ms = ?, result = ?, name_sv = ?, name_en = ?,
  name_it = ?, edibility = ?, confidence = ?`;
const SET_ANSWER = `UPDATE finds SET ${ANSWER_COLUMNS} WHERE id = ? AND state IN ('waiting', 'failed')`;
const REPLACE_ANSWER = `UPDATE finds SET ${ANSWER_COLUMNS} WHERE id = ? AND state = 'done'`;
const MARK_FAILED = `UPDATE finds SET state = 'failed', failure_cause = ?, failure_detail = ?
  WHERE id = ? AND state IN ('waiting', 'failed')`;
const MARK_WAITING = `UPDATE finds SET state = 'waiting', failure_cause = NULL,
  failure_detail = NULL WHERE id = ? AND state = 'failed'`;
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
      return rows.map((row) => readSummary(record(row), photos));
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
  };
}

async function removeOrphans(db: FindDatabase, photos: PhotoFiles): Promise<void> {
  const rows = await db.getAllAsync(ALL_PHOTOS, []);
  const kept = new Set(rows.map((row) => textOf(record(row), "photo_file")));
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
    id: integerOf(row, "id"),
    photoUri: photos.uriOf(textOf(row, "photo_file")),
    time: readTime(row),
    position: readPosition(row),
    analysis: readAnalysis(row),
  };
}

function readSummary(row: Row, photos: PhotoFiles): FindSummary {
  return {
    id: integerOf(row, "id"),
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

function enumOf<T extends string>(row: Row, column: string, values: readonly T[]): T {
  const value = row[column];
  if (!isOneOf(values, value)) {
    throw corrupt(`the stored ${column} is not one the store knows`);
  }
  return value;
}
