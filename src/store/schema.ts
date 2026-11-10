/**
 * The find log's schema and its versions. The database's `user_version` is its schema version:
 * 0 for a new, empty database. `MIGRATIONS[n]` takes the schema from version n to n + 1, so a
 * later version adds its migration at the end and a database at any earlier version, version 1
 * included, is brought up one version at a time. A migration is never changed once released.
 */

import type { FindDatabase } from "./database";
import { corrupt, StoreError } from "./find";

/**
 * Version 1: one row per find, its answer as JSON and, beside it, what the Log list shows. Released
 * with Phase 1's first build (PBI-1.10), so no longer changed. Before that it was changed in place: the failure causes `photo` (PBI-1.7) and `refused`
 * (PBI-1.21) were added without a migration (Clead's decisions on #17 and for PBI-1.21), and the
 * table made STRICT, with a CHECK on the edibility and the two times kept within JavaScript's
 * safe-integer range (PBI-1.16). The edibilities are written out, not taken from the analysis
 * module, so a later change there cannot change this version.
 */
const VERSION_1 = `
CREATE TABLE finds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at_ms INTEGER NOT NULL CHECK (taken_at_ms BETWEEN -9007199254740991 AND 9007199254740991),
  utc_offset_min INTEGER NOT NULL CHECK (utc_offset_min BETWEEN -1080 AND 1080),
  time_source TEXT NOT NULL CHECK (time_source IN ('saved', 'photo', 'photo-phone-offset')),
  latitude REAL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m REAL CHECK (accuracy_m >= 0),
  position_source TEXT CHECK (position_source IN ('fix', 'last-known', 'photo')),
  photo_file TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN ('waiting', 'done', 'failed')),
  failure_cause TEXT CHECK (failure_cause IN ('segment-check', 'request', 'answer', 'photo', 'refused')),
  failure_detail TEXT,
  answer_json TEXT,
  model TEXT,
  analysed_at_ms INTEGER CHECK (analysed_at_ms BETWEEN -9007199254740991 AND 9007199254740991),
  result TEXT CHECK (result IN ('match', 'no_mushroom', 'cannot_tell')),
  name_sv TEXT,
  name_en TEXT,
  name_it TEXT,
  edibility TEXT CHECK (edibility IN ('edible', 'edible_after_preparation', 'not_edible', 'poisonous', 'deadly_poisonous', 'unknown')),
  confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  CHECK ((latitude IS NULL) = (position_source IS NULL)),
  CHECK ((longitude IS NULL) = (position_source IS NULL)),
  CHECK (accuracy_m IS NULL OR position_source IS NOT NULL),
  CHECK ((state = 'failed') = (failure_cause IS NOT NULL)),
  CHECK ((failure_cause IS NULL) = (failure_detail IS NULL)),
  CHECK ((state = 'done') = (answer_json IS NOT NULL)),
  CHECK ((answer_json IS NULL) = (model IS NULL)),
  CHECK ((answer_json IS NULL) = (analysed_at_ms IS NULL)),
  CHECK ((answer_json IS NULL) = (result IS NULL)),
  CHECK ((COALESCE(result, '') = 'match') = (name_sv IS NOT NULL AND name_en IS NOT NULL AND name_it IS NOT NULL AND edibility IS NOT NULL AND confidence IS NOT NULL)),
  CHECK (COALESCE(result, '') = 'match' OR (name_sv IS NULL AND name_en IS NULL AND name_it IS NULL AND edibility IS NULL AND confidence IS NULL))
) STRICT;
CREATE INDEX finds_newest_first ON finds (taken_at_ms DESC, id DESC);
`;

/** The columns version 1 and version 2 share, copied as they are. */
const KEPT_COLUMNS = `id, taken_at_ms, utc_offset_min, time_source, latitude, longitude, accuracy_m,
  position_source, state, failure_cause, failure_detail, answer_json, model, analysed_at_ms, result,
  name_sv, name_en, name_it, edibility, confidence`;

/**
 * Version 2 (PBI-2.2, docs/SPEC.md 3.9 "The store"): a find also holds its text; its photos, in the
 * order added, as a JSON array of `{"file", "batch"}` in the one row, so that each change to them
 * is one statement; the number of batches begun and whether the last is open; the state of the
 * photos added since its answer; its confidence as a number from 1 to 100 in place of a level; its
 * representative picture with its credit; and its self-check, with the species the check named
 * when it disagreed.
 *
 * The table is rebuilt, since `photo_file` is UNIQUE and so cannot be dropped. Every version 1 row
 * is copied as it is, its photo as its first photo in batch 1 and its answer as it was, and the
 * CHECKs are off while it is copied, so that a row only a damaged file could hold is kept for the
 * list to show and the user to delete, rather than failing the migration and with it every
 * opening of the log. AUTOINCREMENT's high-water mark is carried over as it was, in place of the
 * one the copy left, so that the ID of a find deleted in Phase 1 is not given again; a table that
 * never had a row has none, and SQLite then starts from the highest ID in the table. The migration runs in one transaction (`migrate`): it
 * changes nothing unless it all succeeds.
 */
const VERSION_2 = `
PRAGMA ignore_check_constraints = ON;
CREATE TABLE finds_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at_ms INTEGER NOT NULL CHECK (taken_at_ms BETWEEN -9007199254740991 AND 9007199254740991),
  utc_offset_min INTEGER NOT NULL CHECK (utc_offset_min BETWEEN -1080 AND 1080),
  time_source TEXT NOT NULL CHECK (time_source IN ('saved', 'photo', 'photo-phone-offset')),
  latitude REAL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m REAL CHECK (accuracy_m >= 0),
  position_source TEXT CHECK (position_source IN ('fix', 'last-known', 'photo')),
  text TEXT CHECK (length(text) > 0),
  photos TEXT NOT NULL CHECK (CASE WHEN json_valid(photos) THEN json_type(photos) = 'array' ELSE 0 END),
  batches INTEGER NOT NULL CHECK (batches BETWEEN 0 AND 9007199254740991),
  batch_open INTEGER NOT NULL CHECK (batch_open IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('waiting', 'done', 'failed')),
  failure_cause TEXT CHECK (failure_cause IN ('segment-check', 'request', 'answer', 'photo', 'refused')),
  failure_detail TEXT,
  answer_json TEXT,
  model TEXT,
  analysed_at_ms INTEGER CHECK (analysed_at_ms BETWEEN -9007199254740991 AND 9007199254740991),
  result TEXT CHECK (result IN ('match', 'no_mushroom', 'cannot_tell')),
  name_sv TEXT,
  name_en TEXT,
  name_it TEXT,
  edibility TEXT CHECK (edibility IN ('edible', 'edible_after_preparation', 'not_edible', 'poisonous', 'deadly_poisonous', 'unknown')),
  confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  confidence_score INTEGER CHECK (confidence_score BETWEEN 1 AND 100),
  added_photos TEXT CHECK (added_photos IN ('analysed', 'waiting', 'not-analysed')),
  picture_file TEXT UNIQUE,
  picture_author TEXT,
  picture_licence TEXT,
  picture_page TEXT,
  self_check TEXT CHECK (self_check IN ('waiting', 'agreed', 'disagreed', 'no-species', 'failed', 'no-picture')),
  check_name_sv TEXT,
  check_name_en TEXT,
  check_name_la TEXT,
  check_name_it TEXT,
  CHECK ((latitude IS NULL) = (position_source IS NULL)),
  CHECK ((longitude IS NULL) = (position_source IS NULL)),
  CHECK (accuracy_m IS NULL OR position_source IS NOT NULL),
  CHECK ((state = 'failed') = (failure_cause IS NOT NULL)),
  CHECK ((failure_cause IS NULL) = (failure_detail IS NULL)),
  CHECK ((state = 'done') = (answer_json IS NOT NULL)),
  CHECK ((answer_json IS NULL) = (model IS NULL)),
  CHECK ((answer_json IS NULL) = (analysed_at_ms IS NULL)),
  CHECK ((answer_json IS NULL) = (result IS NULL)),
  CHECK ((COALESCE(result, '') = 'match') = (name_sv IS NOT NULL AND name_en IS NOT NULL AND name_it IS NOT NULL AND edibility IS NOT NULL AND (confidence IS NOT NULL OR confidence_score IS NOT NULL))),
  CHECK (COALESCE(result, '') = 'match' OR (name_sv IS NULL AND name_en IS NULL AND name_it IS NULL AND edibility IS NULL AND confidence IS NULL AND confidence_score IS NULL)),
  CHECK (confidence IS NULL OR confidence_score IS NULL),
  CHECK (text IS NOT NULL OR (CASE WHEN json_valid(photos) THEN json_array_length(photos) > 0 ELSE 0 END)),
  CHECK (batch_open = 0 OR batches > 0),
  CHECK ((answer_json IS NULL) = (added_photos IS NULL)),
  CHECK ((picture_file IS NULL) = (picture_author IS NULL)),
  CHECK ((picture_file IS NULL) = (picture_licence IS NULL)),
  CHECK ((picture_file IS NULL) = (picture_page IS NULL)),
  CHECK (self_check IS NULL OR (COALESCE(result, '') = 'match' AND text IS NOT NULL)),
  CHECK (picture_file IS NULL OR COALESCE(self_check, '') IN ('waiting', 'agreed', 'disagreed', 'no-species', 'failed')),
  CHECK (COALESCE(self_check, '') NOT IN ('agreed', 'disagreed', 'no-species', 'failed') OR picture_file IS NOT NULL),
  CHECK ((COALESCE(self_check, '') = 'disagreed') = (check_name_sv IS NOT NULL AND check_name_en IS NOT NULL AND check_name_la IS NOT NULL AND check_name_it IS NOT NULL)),
  CHECK (COALESCE(self_check, '') = 'disagreed' OR (check_name_sv IS NULL AND check_name_en IS NULL AND check_name_la IS NULL AND check_name_it IS NULL))
) STRICT;
INSERT INTO finds_v2 (${KEPT_COLUMNS}, photos, batches, batch_open, added_photos)
  SELECT ${KEPT_COLUMNS}, json_array(json_object('file', photo_file, 'batch', 1)), 1, 0,
    CASE WHEN answer_json IS NULL THEN NULL ELSE 'analysed' END
  FROM finds;
DELETE FROM sqlite_sequence WHERE name = 'finds_v2';
INSERT INTO sqlite_sequence (name, seq)
  SELECT 'finds_v2', seq FROM sqlite_sequence WHERE name = 'finds';
DROP TABLE finds;
ALTER TABLE finds_v2 RENAME TO finds;
CREATE INDEX finds_newest_first ON finds (taken_at_ms DESC, id DESC);
PRAGMA ignore_check_constraints = OFF;
`;

/** The columns version 2 and version 3 share, copied as they are. */
const V2_COLUMNS = `id, taken_at_ms, utc_offset_min, time_source, latitude, longitude, accuracy_m,
  position_source, text, photos, batches, batch_open, state, failure_cause, failure_detail,
  answer_json, model, analysed_at_ms, result, name_sv, name_en, name_it, edibility, confidence,
  confidence_score, added_photos, picture_file, picture_author, picture_licence, picture_page,
  self_check, check_name_sv, check_name_en, check_name_la, check_name_it`;

/**
 * Version 3 (PBI-2.15, docs/SPEC.md 3.9 "Answers"): a find's answer also holds what it was based
 * on, `answer_basis`: the text alone ('text'), or photos, with the text when the find has one
 * ('photos'); none without an answer. Every answer the store writes from version 3 on has one.
 *
 * Version 2 did not record it, so the copy fills it only where the stored data proves it, by
 * these rules, in this order, and leaves it empty otherwise (Clead's decision 2 on PBI-2.15). It
 * judges a find by the columns the store reads it by, so that no row the version 2 store reads,
 * a damaged one included, reads as unreadable in version 3 (review of #84, fix 1): whether it has
 * an answer by its `state`, and whether the answer names a species by the answer's own JSON, not
 * by the `result` column beside it. On every row the stores wrote these agree, since the CHECKs
 * tie `state` to `answer_json` and the stores write `result` from the same answer.
 * - no answer: none;
 * - no text: 'photos'. A find's text is set only when it is saved, so the find never had one, and
 *   an analysis sends the text, the photos or both: every analysis of it sent photos. Every
 *   Phase 1 find is one;
 * - a self-check: 'text'. Every version 2 store started one exactly when the analysis sent no
 *   photo, the answer named a species and the find had text, and only a new answer ended it;
 * - an answer naming a species: 'photos', by the same rule, since it has no self-check;
 * - no batch begun (`batches` 0): 'text'. The count only goes up, so the find never had a photo;
 * - otherwise, an answer naming no species on a text find that has had a photo: none, and the
 *   wording of "no mushroom" and "cannot tell" follows whether the find has photos, as before.
 *
 * Its CHECKs keep the basis to what the store writes: none without an answer; 'text' only on a
 * find with text; 'photos' never beside a self-check, and 'text' with one when the answer names a
 * species; and none on an answer only where the copy may leave it empty.
 *
 * The table is rebuilt, as for version 2, so its constraints stand as one table definition. Every
 * version 2 row is copied with every column as it was, and the CHECKs are off while it is copied,
 * so that a row only a damaged file could hold is kept for the list to show and the user to
 * delete. AUTOINCREMENT's high-water mark is carried over as version 2 carried it. The migration
 * runs in one transaction (`migrate`): it changes nothing unless it all succeeds.
 */
const VERSION_3 = `
PRAGMA ignore_check_constraints = ON;
CREATE TABLE finds_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at_ms INTEGER NOT NULL CHECK (taken_at_ms BETWEEN -9007199254740991 AND 9007199254740991),
  utc_offset_min INTEGER NOT NULL CHECK (utc_offset_min BETWEEN -1080 AND 1080),
  time_source TEXT NOT NULL CHECK (time_source IN ('saved', 'photo', 'photo-phone-offset')),
  latitude REAL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude BETWEEN -180 AND 180),
  accuracy_m REAL CHECK (accuracy_m >= 0),
  position_source TEXT CHECK (position_source IN ('fix', 'last-known', 'photo')),
  text TEXT CHECK (length(text) > 0),
  photos TEXT NOT NULL CHECK (CASE WHEN json_valid(photos) THEN json_type(photos) = 'array' ELSE 0 END),
  batches INTEGER NOT NULL CHECK (batches BETWEEN 0 AND 9007199254740991),
  batch_open INTEGER NOT NULL CHECK (batch_open IN (0, 1)),
  state TEXT NOT NULL CHECK (state IN ('waiting', 'done', 'failed')),
  failure_cause TEXT CHECK (failure_cause IN ('segment-check', 'request', 'answer', 'photo', 'refused')),
  failure_detail TEXT,
  answer_json TEXT,
  model TEXT,
  analysed_at_ms INTEGER CHECK (analysed_at_ms BETWEEN -9007199254740991 AND 9007199254740991),
  result TEXT CHECK (result IN ('match', 'no_mushroom', 'cannot_tell')),
  name_sv TEXT,
  name_en TEXT,
  name_it TEXT,
  edibility TEXT CHECK (edibility IN ('edible', 'edible_after_preparation', 'not_edible', 'poisonous', 'deadly_poisonous', 'unknown')),
  confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  confidence_score INTEGER CHECK (confidence_score BETWEEN 1 AND 100),
  added_photos TEXT CHECK (added_photos IN ('analysed', 'waiting', 'not-analysed')),
  picture_file TEXT UNIQUE,
  picture_author TEXT,
  picture_licence TEXT,
  picture_page TEXT,
  self_check TEXT CHECK (self_check IN ('waiting', 'agreed', 'disagreed', 'no-species', 'failed', 'no-picture')),
  check_name_sv TEXT,
  check_name_en TEXT,
  check_name_la TEXT,
  check_name_it TEXT,
  answer_basis TEXT CHECK (answer_basis IN ('text', 'photos')),
  CHECK ((latitude IS NULL) = (position_source IS NULL)),
  CHECK ((longitude IS NULL) = (position_source IS NULL)),
  CHECK (accuracy_m IS NULL OR position_source IS NOT NULL),
  CHECK ((state = 'failed') = (failure_cause IS NOT NULL)),
  CHECK ((failure_cause IS NULL) = (failure_detail IS NULL)),
  CHECK ((state = 'done') = (answer_json IS NOT NULL)),
  CHECK ((answer_json IS NULL) = (model IS NULL)),
  CHECK ((answer_json IS NULL) = (analysed_at_ms IS NULL)),
  CHECK ((answer_json IS NULL) = (result IS NULL)),
  CHECK ((COALESCE(result, '') = 'match') = (name_sv IS NOT NULL AND name_en IS NOT NULL AND name_it IS NOT NULL AND edibility IS NOT NULL AND (confidence IS NOT NULL OR confidence_score IS NOT NULL))),
  CHECK (COALESCE(result, '') = 'match' OR (name_sv IS NULL AND name_en IS NULL AND name_it IS NULL AND edibility IS NULL AND confidence IS NULL AND confidence_score IS NULL)),
  CHECK (confidence IS NULL OR confidence_score IS NULL),
  CHECK (text IS NOT NULL OR (CASE WHEN json_valid(photos) THEN json_array_length(photos) > 0 ELSE 0 END)),
  CHECK (batch_open = 0 OR batches > 0),
  CHECK ((answer_json IS NULL) = (added_photos IS NULL)),
  CHECK ((picture_file IS NULL) = (picture_author IS NULL)),
  CHECK ((picture_file IS NULL) = (picture_licence IS NULL)),
  CHECK ((picture_file IS NULL) = (picture_page IS NULL)),
  CHECK (self_check IS NULL OR (COALESCE(result, '') = 'match' AND text IS NOT NULL)),
  CHECK (picture_file IS NULL OR COALESCE(self_check, '') IN ('waiting', 'agreed', 'disagreed', 'no-species', 'failed')),
  CHECK (COALESCE(self_check, '') NOT IN ('agreed', 'disagreed', 'no-species', 'failed') OR picture_file IS NOT NULL),
  CHECK ((COALESCE(self_check, '') = 'disagreed') = (check_name_sv IS NOT NULL AND check_name_en IS NOT NULL AND check_name_la IS NOT NULL AND check_name_it IS NOT NULL)),
  CHECK (COALESCE(self_check, '') = 'disagreed' OR (check_name_sv IS NULL AND check_name_en IS NULL AND check_name_la IS NULL AND check_name_it IS NULL)),
  CHECK (answer_basis IS NULL OR answer_json IS NOT NULL),
  CHECK (COALESCE(answer_basis, '') <> 'text' OR text IS NOT NULL),
  CHECK (COALESCE(answer_basis, '') <> 'photos' OR self_check IS NULL),
  CHECK (COALESCE(answer_basis, '') <> 'text' OR COALESCE(result, '') <> 'match' OR self_check IS NOT NULL),
  CHECK (answer_basis IS NOT NULL OR answer_json IS NULL OR (text IS NOT NULL AND COALESCE(result, '') <> 'match' AND batches > 0))
) STRICT;
INSERT INTO finds_v3 (${V2_COLUMNS}, answer_basis)
  SELECT ${V2_COLUMNS},
    CASE
      WHEN state IS NOT 'done' THEN NULL
      WHEN text IS NULL THEN 'photos'
      WHEN self_check IS NOT NULL THEN 'text'
      WHEN (CASE WHEN json_valid(answer_json) THEN json_extract(answer_json, '$.result') END) = 'match' THEN 'photos'
      WHEN batches = 0 THEN 'text'
    END
  FROM finds;
DELETE FROM sqlite_sequence WHERE name = 'finds_v3';
INSERT INTO sqlite_sequence (name, seq)
  SELECT 'finds_v3', seq FROM sqlite_sequence WHERE name = 'finds';
DROP TABLE finds;
ALTER TABLE finds_v3 RENAME TO finds;
CREATE INDEX finds_newest_first ON finds (taken_at_ms DESC, id DESC);
PRAGMA ignore_check_constraints = OFF;
`;

export const MIGRATIONS: readonly string[] = [VERSION_1, VERSION_2, VERSION_3];

/**
 * Brings the database to the last version of `migrations`, each step in its own transaction,
 * and gives that version. A database newer than the app knows is refused, untouched.
 */
export async function migrate(
  db: FindDatabase,
  migrations: readonly string[] = MIGRATIONS,
): Promise<number> {
  const version = readVersion(await db.getFirstAsync("PRAGMA user_version", []));
  if (version > migrations.length) {
    throw new StoreError(
      "newer-schema",
      `the database is at schema version ${version}; this app knows up to ${migrations.length}`,
    );
  }
  for (const [index, migration] of migrations.entries()) {
    if (index < version) {
      continue;
    }
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(migration);
      await txn.execAsync(`PRAGMA user_version = ${index + 1}`);
    });
  }
  return migrations.length;
}

function readVersion(row: unknown): number {
  const version =
    typeof row === "object" && row !== null && "user_version" in row ? row.user_version : null;
  if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0) {
    throw corrupt("the database's user_version is not a whole number of zero or more");
  }
  return version;
}
