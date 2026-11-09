/**
 * The find log (docs/SPEC.md 3.6, and 3.9 "The store"): the finds in one SQLite database, their
 * photos and representative pictures as files.
 *
 * No find is left without its photos, and no file without its find:
 * - adding copies the file in first and then saves it to the row; deleting removes the row first
 *   and then the files. Either way the only thing a crash or an error between the two steps can
 *   leave is a file no row refers to;
 * - opening the store removes every such file, before anything can be added.
 *
 * Each change is one statement on one row, so it is whole or not made at all, with no
 * transaction (whose separate connection, in expo-sqlite, would make a write on the store's own
 * connection fail as locked).
 */

import {
  CONFIDENCE_LEVELS,
  type Confidence,
  EDIBILITIES,
  isConfidenceScore,
  isRecord,
  parseAnswerText,
  parseStoredAnswerText,
} from "../analysis/answer";
import { config } from "../config/config";
import { answerToJson } from "./answerJson";
import type { FindDatabase } from "./database";
import {
  ADDED_PHOTOS_STATES,
  type AddedPhotosState,
  type AnalysedAnswer,
  type Analysis,
  type AnalysisSent,
  checkFailure,
  checkId,
  checkNewFind,
  checkNewPicture,
  checkNewTextFind,
  checkPosition,
  checkSelfCheckOutcome,
  checkSent,
  checkUri,
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
  type NewPicture,
  type NewTextFind,
  type Picture,
  POSITION_SOURCES,
  type Position,
  SELF_CHECK_STATES,
  type SelfCheck,
  type SelfCheckOutcome,
  type StoredFind,
  StoreError,
  type SummaryAnalysis,
  TIME_SOURCES,
} from "./find";
import type { PhotoFiles } from "./photoFiles";
import { migrate } from "./schema";

/**
 * The finds, as Phase 1 reads and changes them: each find by its first photo. The analysis state
 * changes only as follows; any other change is refused as `wrong-state` and changes nothing:
 *
 * | Change | From | To |
 * |---|---|---|
 * | `setAnswer` | waiting, failed | done |
 * | `replaceAnswer` | done | done (the earlier answer is replaced) |
 * | `markFailed` | waiting, failed | failed |
 * | `markWaiting` | failed | waiting |
 *
 * `setPosition` changes no analysis state: it applies in any state, to a find without a position.
 *
 * A find without a photo (a text find, `LookupStore.addText`) has no Phase 1 view, so `get`
 * refuses it as `corrupt`; the list and `oldestWaiting` judge a row as `getStored` reads it, so
 * they list it and take it (PBI-2.4), and the screens and the queue read it through `getStored`.
 */
export interface FindStore {
  /** Saves a new find, waiting for analysis, with a copy of its photo; gives its ID. */
  add(find: NewFind): Promise<number>;
  /** The find with the ID, or null when there is none. */
  get(id: number): Promise<Find | null>;
  /**
   * What the Log list shows of every find, the latest taken first, a text find without photos
   * with no photo. A find whose row cannot be read as `getStored` reads it is marked unreadable in
   * its place, and the others are listed all the same.
   */
  list(): Promise<ListedFind[]>;
  /**
   * The ID of the waiting find saved first whose batch is complete, or null when none waits: the
   * queue's "oldest first" is the order of saving, the find's ID, not the time taken (docs/SPEC.md
   * 3.4), and the queue does not take a find while its batch is open (3.9). A waiting find whose
   * row cannot be read as `getStored` reads it is passed over and left as it is, so it does not
   * stop the queue; the list shows it as unreadable.
   */
  oldestWaiting(): Promise<number | null>;
  /**
   * Stores the first answer, with what its analysis sent (`AnalysisSent`). Every answer write
   * also sets the photos added since: waiting when the find holds a photo the analysis did not
   * send (one added while it ran), and analysed otherwise. It drops the find's representative
   * picture and self-check (the picture's file goes at the next opening), and starts a new
   * self-check, waiting, when the analysis sent no photo and the answer names a species of a find
   * with text, so the answer is from the text alone (docs/SPEC.md 3.9). A find whose photos
   * cannot be read is refused as `corrupt`, and nothing is stored.
   */
  setAnswer(id: number, analysed: AnalysedAnswer, sent: AnalysisSent): Promise<void>;
  replaceAnswer(id: number, analysed: AnalysedAnswer, sent: AnalysisSent): Promise<void>;
  markFailed(id: number, failure: FindFailure): Promise<void>;
  markWaiting(id: number): Promise<void>;
  /**
   * Adds the first fix that came after a find was saved without a position (docs/SPEC.md 3.6).
   * Only a fix is added later, and only to a find that has no position; a find that has one
   * keeps it, and the change is refused as `wrong-state`.
   */
  setPosition(id: number, position: Position): Promise<void>;
  /**
   * Deletes the find, then its photos and its picture. `photoRemoved` is false when a file could
   * not be removed, or when what is stored does not name them all, and then none is removed,
   * since a damaged list may name another find's file: the find is gone all the same, and the
   * next opening of the store removes its files. A DELETE that changed no row gives `not-found`
   * and removes no file (PBI-1.27).
   */
  delete(id: number): Promise<{ photoRemoved: boolean }>;
  /**
   * Deletes a find whose ID the store cannot read (an ID of 0 or below, or one past 2^53, which
   * only a damaged file can hold), named by the `storedId` the list gives it, then its files, as
   * `delete` does (PBI-1.26). `photoRemoved` is false as there. A find whose ID the store
   * can read is never deleted here: for its ID this gives `not-found`. So does a DELETE that
   * changed no row, which removes no file (PBI-1.27).
   */
  deleteUnreadable(storedId: string): Promise<{ photoRemoved: boolean }>;
}

/**
 * What the store holds for Phase 2 (docs/SPEC.md 3.9, "The store"), besides `FindStore`. A change
 * the find's state does not allow is refused as `wrong-state` and changes nothing; a file copied
 * in for it is removed again.
 */
export interface LookupStore {
  /** Saves a new text find, waiting, without photos and with no batch open; gives its ID. */
  addText(find: NewTextFind): Promise<number>;
  /**
   * Saves a new photo lookup's find, waiting, with a copy of its first photo in batch 1 and the
   * batch open, so the queue does not take it until `completeBatch`; gives its ID.
   */
  addWithOpenBatch(find: NewFind): Promise<number>;
  /**
   * Adds a copy of a photo to the find: to its open batch, or as the first of a new batch it
   * opens, numbered one past the last begun. A find holds up to `config.maxPhotosPerFind` photos.
   */
  addPhoto(id: number, photoUri: string): Promise<void>;
  /**
   * Completes the find's open batch. A find without an answer then waits for the queue, a failed
   * one too; a find with an answer keeps it, and the photos added since wait (docs/SPEC.md 3.9).
   * Opening the store completes every batch still open, as the app starts.
   */
  completeBatch(id: number): Promise<void>;
  /**
   * Removes the find's photo with the number given, 1 for the first, then its file; the others
   * keep their order and batches, and the find its time, position and analysis. The last photo
   * of a find without text is not removed.
   */
  removePhoto(id: number, photoNumber: number): Promise<{ photoRemoved: boolean }>;
  /**
   * The state of the photos added since the answer: from waiting to not yet analysed after a
   * failure, or back to waiting when the user asks. Only an answer makes them analysed.
   */
  setAddedPhotos(id: number, state: "waiting" | "not-analysed"): Promise<void>;
  /** Stores a copy of the representative picture, with its credit, on a find whose check waits. */
  setPicture(id: number, picture: NewPicture): Promise<void>;
  /**
   * Stores what the self-check came to, on a find whose check waits: an outcome of the check on
   * its picture, or "no-picture" on a find that has none.
   */
  setSelfCheck(id: number, outcome: SelfCheckOutcome): Promise<void>;
  /** Everything the store holds of the find with the ID, or null when there is none. */
  getStored(id: number): Promise<StoredFind | null>;
}

/**
 * The find log as the screens and the queue use it: Phase 1's `FindStore`, and of `LookupStore`
 * the text find and the reading of everything a find holds (PBI-2.4). Later items add the rest.
 */
export type FindLog = FindStore & Pick<LookupStore, "addText" | "getStored">;

export interface StoreOptions {
  /** A name for a new photo that no other photo in the directory has. */
  newPhotoName: () => string;
}

/**
 * A new find's ID, one past the highest ID the store can read, among those in the table and
 * `AUTOINCREMENT`'s high-water mark (PBI-1.27). Left to SQLite, the ID would be one past the
 * highest in the table or the mark, so a damaged ID past 2^53 would make every later find's ID
 * unreadable, even once that find was deleted, since the mark keeps it. The mark is still read
 * while the store can read it, so a deleted find's ID is not given again; and SQLite still moves
 * the mark up to an ID given here. On a damaged file, once the mark is past 2^53, the store cannot
 * read it and it never comes down again, so an ID above every readable ID left may be given again:
 * that of a find since deleted. Computed within the INSERT, so no other write comes between.
 */
const NEXT_ID = `1 + MAX(
  COALESCE((SELECT MAX(id) FROM finds WHERE id BETWEEN 1 AND ${Number.MAX_SAFE_INTEGER}), 0),
  COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'finds'
    AND seq BETWEEN 1 AND ${Number.MAX_SAFE_INTEGER}), 0))`;
/** A new photo find, its photo the first, in batch 1, the batch complete or open. */
const insertPhotoFind = (batchOpen: 0 | 1) => `INSERT INTO finds (id, taken_at_ms,
  utc_offset_min, time_source, latitude, longitude, accuracy_m, position_source, photos, batches,
  batch_open, state) VALUES (${NEXT_ID}, ?, ?, ?, ?, ?, ?, ?,
  json_array(json_object('file', ?, 'batch', 1)), 1, ${batchOpen}, 'waiting')`;
const INSERT = insertPhotoFind(0);
const INSERT_OPEN = insertPhotoFind(1);
const INSERT_TEXT = `INSERT INTO finds (id, taken_at_ms, utc_offset_min, time_source, latitude,
  longitude, accuracy_m, position_source, text, photos, batches, batch_open, state)
  VALUES (${NEXT_ID}, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, 0, 'waiting')`;
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
/** The number of batches begun and the open-batch flag, given back only in range, as above. */
const SAFE_BATCHES = `CASE WHEN batches BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER} THEN batches END
  AS batches`;
const SAFE_BATCH_OPEN = "CASE WHEN batch_open IN (0, 1) THEN batch_open END AS batch_open";
/** The number of the find's photos, or NULL when the stored list is not JSON. */
const PHOTO_COUNT = "(CASE WHEN json_valid(photos) THEN json_array_length(photos) END)";
/** Every column of a find, as `get`, `getStored`, the queue's pick and the list all read it. */
const FIND_COLUMNS = `${SAFE_ID}, ${safeTime("taken_at_ms")}, ${SAFE_OFFSET}, time_source,
  latitude, longitude, accuracy_m, position_source, text, photos, ${SAFE_BATCHES},
  ${SAFE_BATCH_OPEN}, state, failure_cause, failure_detail, answer_json, model,
  ${safeTime("analysed_at_ms")}, added_photos, picture_file, picture_author, picture_licence,
  picture_page, self_check, check_name_sv, check_name_en, check_name_la, check_name_it`;
const GET = `SELECT ${FIND_COLUMNS} FROM finds WHERE finds.id = ?`;
/**
 * The finds, the latest taken first, by the stored time and ID (`finds.`, not the columns read),
 * each also with its ID as SQLite writes it, exactly, whatever the ID.
 */
const LIST = `SELECT ${FIND_COLUMNS}, CAST(finds.id AS TEXT) AS stored_id, result, name_sv,
  name_en, name_it, edibility, confidence, confidence_score FROM finds
  ORDER BY finds.taken_at_ms DESC, finds.id DESC`;
/**
 * The waiting find saved first after a given ID whose batch is complete, among the IDs the store
 * can read: one past 2^53 could not be passed over, since JavaScript cannot hold it to ask for the
 * next (PBI-1.26).
 */
const NEXT_WAITING = `SELECT ${FIND_COLUMNS} FROM finds WHERE state = 'waiting' AND batch_open = 0
  AND finds.id > ? AND finds.id <= ${Number.MAX_SAFE_INTEGER} ORDER BY finds.id ASC LIMIT 1`;
/**
 * The IDs the store cannot read, those `SAFE_ID` gives back as NULL: `deleteUnreadable` matches
 * only these, so it never deletes a find whose ID the store can read, which `delete` is for.
 */
const UNREADABLE_ID = `(id < 1 OR id > ${Number.MAX_SAFE_INTEGER})`;
/** The files of, and the deletion of, a find named by its ID as SQLite writes it. */
const FILES_OF_STORED = `SELECT photos, picture_file FROM finds WHERE CAST(id AS TEXT) = ?
  AND ${UNREADABLE_ID}`;
const DELETE_STORED = `DELETE FROM finds WHERE CAST(id AS TEXT) = ? AND ${UNREADABLE_ID}`;
/** An SQLite integer's decimal form, as CAST(… AS TEXT) writes it: at most 19 digits. */
const STORED_ID = /^(0|-?[1-9][0-9]{0,18})$/;
/**
 * An answer's columns, set from what its analysis sent against what the find holds as it is
 * stored (review of #49, fix 1): the photos added since are waiting when the find now holds a
 * photo whose name is not among the names sent (a JSON array), and analysed otherwise; the
 * self-check waits only when the number of photos sent is 0, the answer is a match and the find
 * has text, so the answer is from the text alone (docs/SPEC.md 3.9). The confidence is written
 * to both of its columns, the level's left empty, so that a new answer to a Phase 1 find drops
 * its level (PBI-2.3).
 */
const ANSWER_COLUMNS = `state = 'done', failure_cause = NULL, failure_detail = NULL,
  answer_json = ?, model = ?, analysed_at_ms = ?, result = ?, name_sv = ?, name_en = ?,
  name_it = ?, edibility = ?, confidence = ?, confidence_score = ?,
  added_photos = CASE WHEN EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(finds.photos)
    THEN finds.photos ELSE '[]' END) WHERE json_extract(value, '$.file') NOT IN
    (SELECT value FROM json_each(?))) THEN 'waiting' ELSE 'analysed' END,
  picture_file = NULL, picture_author = NULL, picture_licence = NULL, picture_page = NULL,
  self_check = CASE WHEN ? = 0 AND ? = 'match' AND text IS NOT NULL THEN 'waiting' END,
  check_name_sv = NULL, check_name_en = NULL, check_name_la = NULL, check_name_it = NULL`;
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
const FILES_OF = "SELECT photos, picture_file FROM finds WHERE id = ?";
const DELETE = "DELETE FROM finds WHERE id = ?";
const ALL_FILES = "SELECT photos, picture_file FROM finds";
/**
 * Completing a batch (docs/SPEC.md 3.9): a failed find waits again, without why it failed; a done
 * find's new photos wait. SQLite reads every column on the right as it was before the UPDATE.
 */
const COMPLETE_SET = `batch_open = 0,
  state = CASE WHEN state = 'failed' THEN 'waiting' ELSE state END,
  failure_cause = CASE WHEN state = 'failed' THEN NULL ELSE failure_cause END,
  failure_detail = CASE WHEN state = 'failed' THEN NULL ELSE failure_detail END,
  added_photos = CASE WHEN state = 'done' THEN 'waiting' ELSE added_photos END`;
const COMPLETE_BATCH = `UPDATE finds SET ${COMPLETE_SET} WHERE id = ? AND batch_open = 1`;
const COMPLETE_OPEN_BATCHES = `UPDATE finds SET ${COMPLETE_SET} WHERE batch_open = 1`;
const BATCH_OPEN_OF = `SELECT ${SAFE_BATCH_OPEN} FROM finds WHERE id = ?`;
/** The batch a photo added now comes in: the open one, or a new one past the last begun. */
const NEXT_BATCH = "CASE WHEN batch_open = 1 THEN batches ELSE batches + 1 END";
const ADD_PHOTO = `UPDATE finds SET photos = json_insert(photos, '$[#]',
  json_object('file', ?, 'batch', ${NEXT_BATCH})), batches = ${NEXT_BATCH}, batch_open = 1
  WHERE id = ? AND ${PHOTO_COUNT} < ?`;
const PHOTOS_OF = `SELECT text, photos, ${SAFE_BATCHES} FROM finds WHERE id = ?`;
/**
 * Removes the photo at a JSON path, only while that photo is the one read and it is not the last
 * of a find without text, so a change between the read and this leaves the photos as they are.
 */
const REMOVE_PHOTO = `UPDATE finds SET photos = json_remove(photos, ?) WHERE id = ?
  AND json_extract(photos, ?) = ? AND (text IS NOT NULL OR ${PHOTO_COUNT} > 1)`;
const SET_ADDED_PHOTOS = "UPDATE finds SET added_photos = ? WHERE id = ? AND added_photos = ?";
const ADDED_PHOTOS_OF = "SELECT added_photos FROM finds WHERE id = ?";
const SET_PICTURE = `UPDATE finds SET picture_file = ?, picture_author = ?, picture_licence = ?,
  picture_page = ? WHERE id = ? AND self_check = 'waiting' AND picture_file IS NULL`;
const SELF_CHECK_OF = "SELECT self_check FROM finds WHERE id = ?";
const SET_SELF_CHECK = `UPDATE finds SET self_check = ?, check_name_sv = ?, check_name_en = ?,
  check_name_la = ?, check_name_it = ? WHERE id = ? AND self_check = 'waiting'
  AND picture_file IS NOT NULL`;
const SET_NO_PICTURE = `UPDATE finds SET self_check = 'no-picture' WHERE id = ?
  AND self_check = 'waiting' AND picture_file IS NULL`;

type Params = (string | number | null)[];

/**
 * Opens the store on a database and a photo directory: brings the database to the current
 * schema, completes every batch still open (docs/SPEC.md 3.9: "a batch still open when the app
 * starts is complete then"), makes the directory, and removes the files no find refers to.
 */
export async function createFindStore(
  db: FindDatabase,
  photos: PhotoFiles,
  options: StoreOptions,
): Promise<FindStore & LookupStore> {
  await migrate(db);
  await db.runAsync(COMPLETE_OPEN_BATCHES, []);
  photos.prepare();
  await removeOrphans(db, photos);

  /** Throws `not-found` when no find has the ID, or else what `otherwise` gives. */
  async function refusal(
    id: number,
    sql: string,
    otherwise: (row: Row) => StoreError,
  ): Promise<never> {
    const row = await db.getFirstAsync(sql, [id]);
    if (row === null) {
      throw new StoreError("not-found", `no find has the ID ${id}`);
    }
    throw otherwise(record(row));
  }

  /** Runs an update that applies only in some states; says why when it changed nothing. */
  async function update(id: number, sql: string, params: Params) {
    const { changes } = await db.runAsync(sql, [...params, id]);
    if (changes > 0) {
      return;
    }
    await refusal(id, STATE_OF, (row) => {
      const state = enumOf(row, "state", FIND_STATES);
      return new StoreError("wrong-state", `find ${id} is ${state}; the change does not apply`);
    });
  }

  /**
   * Stores an answer with what its analysis sent. The find's photos are read only to name the
   * photos sent; the UPDATE itself compares those names with the photos the find holds then, so a
   * photo added after the read, too, is seen as not sent (review of #49, fix 1). A URI sent that
   * names no photo the find holds is of a photo removed since, and covers nothing.
   */
  async function answer(
    id: number,
    analysed: AnalysedAnswer,
    sent: AnalysisSent,
    sql: string,
  ): Promise<void> {
    checkId(id);
    checkSent(sent);
    const columns = answerColumns(analysed);
    const row = await db.getFirstAsync(PHOTOS_OF, [id]);
    if (row === null) {
      throw new StoreError("not-found", `no find has the ID ${id}`);
    }
    const byUri = new Map(readPhotoNames(record(row)).map((name) => [photos.uriOf(name), name]));
    const sentNames = sent.photoUris.flatMap((uri) => byUri.get(uri) ?? []);
    // The answer's result, the fourth of its columns, once more for the self-check.
    const result = columns[3] ?? null;
    await update(id, sql, [...columns, JSON.stringify(sentNames), sent.photoUris.length, result]);
  }

  /** Copies a file in, then runs `save` with its name; removes the copy when `save` fails. */
  async function withCopy<T>(uri: string, save: (name: string) => Promise<T>): Promise<T> {
    const name = await photos.copyIn(uri, options.newPhotoName());
    try {
      return await save(name);
    } catch (error) {
      removeQuietly(photos, name);
      throw error;
    }
  }

  async function addPhotoFind(find: NewFind, sql: string): Promise<number> {
    checkNewFind(find);
    return withCopy(find.photoUri, async (name) => {
      const { lastInsertRowId } = await db.runAsync(sql, [...timeAndPosition(find), name]);
      return lastInsertRowId;
    });
  }

  /** Deletes a find by a statement after reading its files, then removes them. */
  async function deleteWith(
    filesOf: string,
    remove: string,
    key: number | string,
  ): Promise<{ photoRemoved: boolean }> {
    const row = await db.getFirstAsync(filesOf, [key]);
    if (row === null) {
      throw new StoreError("not-found", `no find has the ID ${key}`);
    }
    const files = namedFiles(row);
    // A DELETE that changed no row deleted no find (another delete of it came first, say), so the
    // files are not its to remove (PBI-1.27).
    const { changes } = await db.runAsync(remove, [key]);
    if (changes === 0) {
      throw new StoreError("not-found", `no find has the ID ${key}`);
    }
    // A list damaged past naming every file may also name another find's file, so then none is
    // removed; the next opening removes those that were this find's (review of #49, note 1).
    if (!files.complete) {
      return { photoRemoved: false };
    }
    let removed = true;
    for (const name of files.names) {
      removed = removeQuietly(photos, name) && removed;
    }
    return { photoRemoved: removed };
  }

  /** Why a change of the self-check or the picture applied to no row. */
  function selfCheckRefusal(id: number): Promise<never> {
    return refusal(id, SELF_CHECK_OF, (row) => {
      const check = row.self_check === null ? null : enumOf(row, "self_check", SELF_CHECK_STATES);
      return new StoreError(
        "wrong-state",
        check === null
          ? `find ${id} has no self-check`
          : `find ${id}'s self-check is ${check}, or its picture does not fit the change`,
      );
    });
  }

  return {
    add: (find) => addPhotoFind(find, INSERT),

    addWithOpenBatch: (find) => addPhotoFind(find, INSERT_OPEN),

    async addText(find) {
      checkNewTextFind(find);
      const { lastInsertRowId } = await db.runAsync(INSERT_TEXT, [
        ...timeAndPosition(find),
        find.text,
      ]);
      return lastInsertRowId;
    },

    async get(id) {
      checkId(id);
      const row = await db.getFirstAsync(GET, [id]);
      return row === null ? null : readFind(record(row), photos);
    },

    async getStored(id) {
      checkId(id);
      const row = await db.getFirstAsync(GET, [id]);
      return row === null ? null : readStored(record(row), photos);
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
        if (readsAsStored(row, photos)) {
          return id;
        }
        after = id;
      }
    },

    setAnswer: (id, analysed, sent) => answer(id, analysed, sent, SET_ANSWER),

    replaceAnswer: (id, analysed, sent) => answer(id, analysed, sent, REPLACE_ANSWER),

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
      await refusal(id, POSITION_SOURCE_OF, (row) => {
        const had = enumOf(row, "position_source", POSITION_SOURCES);
        return new StoreError("wrong-state", `find ${id} already has a position (${had})`);
      });
    },

    async addPhoto(id, photoUri) {
      checkId(id);
      checkUri(photoUri, "the photo URI");
      const max = config.maxPhotosPerFind;
      await withCopy(photoUri, async (name) => {
        const { changes } = await db.runAsync(ADD_PHOTO, [name, id, max]);
        if (changes > 0) {
          return;
        }
        await refusal(id, PHOTOS_OF, (row) => {
          const count = readPhotoNames(row).length;
          return new StoreError("wrong-state", `find ${id} holds ${count} photos, the most it may`);
        });
      });
    },

    async completeBatch(id) {
      checkId(id);
      const { changes } = await db.runAsync(COMPLETE_BATCH, [id]);
      if (changes > 0) {
        return;
      }
      await refusal(id, BATCH_OPEN_OF, (row) => {
        flagOf(row, "batch_open");
        return new StoreError("wrong-state", `find ${id} has no open batch`);
      });
    },

    async removePhoto(id, photoNumber) {
      checkId(id);
      if (!Number.isSafeInteger(photoNumber) || photoNumber < 1) {
        throw invalid("the photo number is not a positive whole number");
      }
      const row = await db.getFirstAsync(PHOTOS_OF, [id]);
      if (row === null) {
        throw new StoreError("not-found", `no find has the ID ${id}`);
      }
      const stored = record(row);
      const names = readPhotoNames(stored);
      const name = names[photoNumber - 1];
      if (name === undefined) {
        throw invalid(`find ${id} has no photo ${photoNumber}`);
      }
      if (stored.text === null && names.length === 1) {
        throw new StoreError("wrong-state", `find ${id} has no text, so keeps its last photo`);
      }
      const at = `$[${photoNumber - 1}]`;
      const { changes } = await db.runAsync(REMOVE_PHOTO, [at, id, `${at}.file`, name]);
      if (changes === 0) {
        throw new StoreError("wrong-state", `find ${id}'s photos changed since they were read`);
      }
      return { photoRemoved: removeQuietly(photos, name) };
    },

    async setAddedPhotos(id, state) {
      checkId(id);
      if (state !== "waiting" && state !== "not-analysed") {
        throw invalid("the photos added since the answer are set only to waiting or not-analysed");
      }
      const from = state === "waiting" ? "not-analysed" : "waiting";
      const { changes } = await db.runAsync(SET_ADDED_PHOTOS, [state, id, from]);
      if (changes > 0) {
        return;
      }
      await refusal(id, ADDED_PHOTOS_OF, (row) => {
        const had: AddedPhotosState | null =
          row.added_photos === null ? null : enumOf(row, "added_photos", ADDED_PHOTOS_STATES);
        return new StoreError(
          "wrong-state",
          `find ${id}'s added photos are ${had ?? "none, as it has no answer"}, not ${from}`,
        );
      });
    },

    async setPicture(id, picture) {
      checkId(id);
      checkNewPicture(picture);
      const { author, licence, page } = picture;
      await withCopy(picture.sourceUri, async (name) => {
        const { changes } = await db.runAsync(SET_PICTURE, [name, author, licence, page, id]);
        if (changes === 0) {
          await selfCheckRefusal(id);
        }
      });
    },

    async setSelfCheck(id, outcome) {
      checkId(id);
      checkSelfCheckOutcome(outcome);
      const { changes } =
        outcome.state === "no-picture"
          ? await db.runAsync(SET_NO_PICTURE, [id])
          : await db.runAsync(SET_SELF_CHECK, [...selfCheckColumns(outcome), id]);
      if (changes === 0) {
        await selfCheckRefusal(id);
      }
    },

    delete(id) {
      checkId(id);
      return deleteWith(FILES_OF, DELETE, id);
    },

    async deleteUnreadable(storedId) {
      if (typeof storedId !== "string" || !STORED_ID.test(storedId)) {
        throw invalid("the stored ID is not an SQLite integer's decimal form");
      }
      return deleteWith(FILES_OF_STORED, DELETE_STORED, storedId);
    },
  };
}

/** The time and position columns of a new find, in the order of the INSERTs. */
function timeAndPosition({ time, position }: { time: FindTime; position: Position | null }) {
  return [
    time.takenAtMs,
    time.utcOffsetMinutes,
    time.source,
    position?.latitude ?? null,
    position?.longitude ?? null,
    position?.accuracyM ?? null,
    position?.source ?? null,
  ];
}

/** The self-check's state and the names of the species it named, for `SET_SELF_CHECK`. */
function selfCheckColumns(outcome: SelfCheckOutcome): Params {
  if (outcome.state !== "disagreed") {
    return [outcome.state, null, null, null, null];
  }
  const { sv, en, la, it } = outcome.names;
  return ["disagreed", sv, en, la, it];
}

/**
 * Removes the files no find refers to. When a find's files cannot all be named (a damaged file),
 * that find's could be any of them, so none is removed; the store opens all the same (PBI-1.26).
 */
async function removeOrphans(db: FindDatabase, photos: PhotoFiles): Promise<void> {
  const rows = await db.getAllAsync(ALL_FILES, []);
  const kept = new Set<string>();
  for (const row of rows) {
    const files = namedFiles(row);
    if (!files.complete) {
      return;
    }
    for (const name of files.names) {
      kept.add(name);
    }
  }
  for (const name of photos.list()) {
    if (!kept.has(name)) {
      removeQuietly(photos, name);
    }
  }
}

/**
 * The names of a find's photos and picture, as far as they can be read: a row damaged past
 * reading still has its find deleted, and the names it does give are its own. `complete` is false
 * when one could not be read. A row that is not an object is refused as corrupt.
 */
function namedFiles(stored: unknown): { names: string[]; complete: boolean } {
  const row = record(stored);
  const names: string[] = [];
  let complete = true;
  const list = parseJson(row.photos);
  if (Array.isArray(list)) {
    for (const photo of list) {
      if (isRecord(photo) && typeof photo.file === "string") {
        names.push(photo.file);
      } else {
        complete = false;
      }
    }
  } else {
    complete = false;
  }
  if (typeof row.picture_file === "string") {
    names.push(row.picture_file);
  } else if (row.picture_file !== null) {
    complete = false;
  }
  return { names, complete };
}

/** Removes a file; says whether that worked. One left behind is removed at the next opening. */
function removeQuietly(photos: PhotoFiles, name: string): boolean {
  try {
    photos.remove(name);
    return true;
  } catch {
    return false;
  }
}

/**
 * The values of `ANSWER_COLUMNS`, from an answer checked against the shape. A new answer is
 * checked as one from the API, so its confidence is a whole number from 1 to 100: a Phase 1 level
 * is only ever read, never written again (docs/SPEC.md 3.9, PBI-2.3).
 */
function answerColumns(analysed: AnalysedAnswer): Params {
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
    return [json, model, analysedAtMs, valid.result, null, null, null, null, null, null];
  }
  const { sv, en, it } = valid.names;
  const { confidence } = valid;
  const [level, score] = typeof confidence === "number" ? [null, confidence] : [confidence, null];
  return [json, model, analysedAtMs, "match", sv, en, it, valid.edibility, level, score];
}

type Row = Record<string, unknown>;

function record(row: unknown): Row {
  if (typeof row !== "object" || row === null || Array.isArray(row)) {
    throw corrupt("a stored row is not an object");
  }
  return Object.fromEntries(Object.entries(row));
}

/** Phase 1's view of a find: by its first photo. A find without one has none (`FindStore`). */
function readFind(row: Row, photos: PhotoFiles): Find {
  const { id, photos: stored, time, position, analysis } = readStored(row, photos);
  const first = stored[0];
  if (first === undefined) {
    throw corrupt(`find ${id} has no photo, by which Phase 1's view shows a find`);
  }
  return { id, photoUri: first.uri, time, position, analysis };
}

/** Everything the store holds of a find, each column checked against what the store writes. */
function readStored(row: Row, photos: PhotoFiles): StoredFind {
  const id = idOf(row);
  const text = row.text === null ? null : nonEmptyTextOf(row, "text");
  const batches = integerOf(row, "batches");
  const found = readPhotos(row, batches).map(({ name, batch }) => ({
    uri: photos.uriOf(name),
    batch,
  }));
  if (text === null && found.length === 0) {
    throw corrupt(`find ${id} has neither text nor a photo`);
  }
  const batchOpen = flagOf(row, "batch_open");
  const analysis = readAnalysis(row);
  const addedPhotos =
    analysis.state === "done"
      ? enumOf(row, "added_photos", ADDED_PHOTOS_STATES)
      : none(row, "added_photos");
  const selfCheck = readSelfCheck(row, analysis, text);
  return {
    id,
    text,
    photos: found,
    batchOpen,
    time: readTime(row),
    position: readPosition(row),
    analysis,
    addedPhotos,
    picture: readPicture(row, selfCheck, photos),
    selfCheck,
  };
}

/** The stored photo list: `{"file", "batch"}` objects, their batches in order, none past `batches`. */
function readPhotos(row: Row, batches: number): { name: string; batch: number }[] {
  const list = parseJson(row.photos);
  if (!Array.isArray(list)) {
    throw corrupt("the stored photos are not a JSON array");
  }
  let last = 1;
  return list.map((photo: unknown) => {
    if (!isRecord(photo) || Object.keys(photo).some((key) => key !== "file" && key !== "batch")) {
      throw corrupt("a stored photo is not an object of its file and batch");
    }
    const { file, batch } = photo;
    if (typeof file !== "string" || file.length === 0) {
      throw corrupt("a stored photo's file is not a name");
    }
    if (
      typeof batch !== "number" ||
      !Number.isSafeInteger(batch) ||
      batch < last ||
      batch > batches
    ) {
      throw corrupt("a stored photo's batch is not one begun, in the order of the photos");
    }
    last = batch;
    return { name: file, batch };
  });
}

/** The names of the stored photos, in order, read as `readPhotos` reads them. */
function readPhotoNames(row: Row): string[] {
  return readPhotos(row, integerOf(row, "batches")).map(({ name }) => name);
}

function readSelfCheck(row: Row, analysis: Analysis, text: string | null): SelfCheck | null {
  if (row.self_check === null) {
    noCheckNames(row);
    return null;
  }
  const state = enumOf(row, "self_check", SELF_CHECK_STATES);
  if (analysis.state !== "done" || analysis.answer.result !== "match" || text === null) {
    throw corrupt("a self-check is stored on a find without a text answer naming a species");
  }
  if (state !== "disagreed") {
    noCheckNames(row);
    return { state };
  }
  return {
    state,
    names: {
      sv: nonEmptyTextOf(row, "check_name_sv"),
      en: nonEmptyTextOf(row, "check_name_en"),
      la: nonEmptyTextOf(row, "check_name_la"),
      it: nonEmptyTextOf(row, "check_name_it"),
    },
  };
}

function noCheckNames(row: Row): void {
  for (const column of ["check_name_sv", "check_name_en", "check_name_la", "check_name_it"]) {
    none(row, column);
  }
}

/**
 * The picture, all four of its columns or none. It is stored only beside a self-check that waits
 * or has an outcome from it; the outcomes of a check other than "no-picture" need it.
 */
function readPicture(row: Row, selfCheck: SelfCheck | null, photos: PhotoFiles): Picture | null {
  const state = selfCheck?.state ?? null;
  if (row.picture_file === null) {
    for (const column of ["picture_author", "picture_licence", "picture_page"]) {
      none(row, column);
    }
    if (state !== null && state !== "waiting" && state !== "no-picture") {
      throw corrupt(`a self-check that is ${state} is stored without its picture`);
    }
    return null;
  }
  if (state === null || state === "no-picture") {
    throw corrupt("a picture is stored without a self-check that has one");
  }
  return {
    uri: photos.uriOf(nonEmptyTextOf(row, "picture_file")),
    author: nonEmptyTextOf(row, "picture_author"),
    licence: nonEmptyTextOf(row, "picture_licence"),
    page: nonEmptyTextOf(row, "picture_page"),
  };
}

/**
 * Whether the row reads as `getStored` reads a find, a text find without photos included (PBI-2.4);
 * an error that is not about what is stored passes through.
 */
function readsAsStored(row: Row, photos: PhotoFiles): boolean {
  try {
    readStored(row, photos);
    return true;
  } catch (error) {
    if (isCorrupt(error)) {
      return false;
    }
    throw error;
  }
}

/**
 * A row of the list, or its mark when it cannot be read. A row is judged as `getStored` and the
 * queue's pick judge it, by reading the whole find, its position and its answer included, so the
 * Log never shows as readable a find whose screen cannot open or which the queue passes over.
 */
function listed(stored: unknown, photos: PhotoFiles): ListedFind {
  try {
    const row = record(stored);
    const find = readStored(row, photos);
    return { readable: true, ...readSummary(row, find) };
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

function readSummary(row: Row, find: StoredFind): FindSummary {
  return {
    id: find.id,
    photoUri: find.photos[0]?.uri ?? null,
    time: find.time,
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
      const parsed = parseStoredAnswerText(textOf(row, "answer_json"));
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
    confidence: readConfidence(row),
  };
}

/**
 * A match's confidence from its two columns, of which exactly one is set: the number from 1 to 100
 * (docs/SPEC.md 3.9), or the level of an answer given in Phase 1.
 */
function readConfidence(row: Row): Confidence {
  if (row.confidence_score === null) {
    return enumOf(row, "confidence", CONFIDENCE_LEVELS);
  }
  none(row, "confidence");
  const score = row.confidence_score;
  if (!isConfidenceScore(score)) {
    throw corrupt("the stored confidence_score is not a whole number from 1 to 100");
  }
  return score;
}

function readFailure(row: Row): FindFailure {
  return {
    cause: enumOf(row, "failure_cause", FAILURE_CAUSES),
    detail: textOf(row, "failure_detail"),
  };
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function textOf(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== "string") {
    throw corrupt(`the stored ${column} is not text`);
  }
  return value;
}

function nonEmptyTextOf(row: Row, column: string): string {
  const value = textOf(row, column);
  if (value.trim().length === 0) {
    throw corrupt(`the stored ${column} is empty`);
  }
  return value;
}

/** A column that is to hold nothing; null, as the caller needs it. */
function none(row: Row, column: string): null {
  if (row[column] !== null) {
    throw corrupt(`the stored ${column} is set where it has no place`);
  }
  return null;
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

/** A flag stored as 0 or 1. */
function flagOf(row: Row, column: string): boolean {
  const value = row[column];
  if (value !== 0 && value !== 1) {
    throw corrupt(`the stored ${column} is not 0 or 1`);
  }
  return value === 1;
}
