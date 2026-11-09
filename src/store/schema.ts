/**
 * The find log's schema and its versions. The database's `user_version` is its schema version:
 * 0 for a new, empty database. `MIGRATIONS[n]` takes the schema from version n to n + 1, so a
 * later version adds its migration at the end and a database at any earlier version, version 1
 * included, is brought up one version at a time. A migration is never changed once released.
 */

import type { FindDatabase } from "./database";
import { corrupt, StoreError } from "./find";

/**
 * Version 1: one row per find, its answer as JSON and, beside it, what the Log list shows. Not yet
 * released, so it is still changed in place: the failure causes `photo` (PBI-1.7) and `refused`
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

export const MIGRATIONS: readonly string[] = [VERSION_1];

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
