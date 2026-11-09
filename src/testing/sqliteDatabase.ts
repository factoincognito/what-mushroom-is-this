/**
 * The find store against a real SQLite, for tests: Node's own `node:sqlite` (no added
 * dependency) in place of expo-sqlite, and a photo directory in memory. The tests that use it
 * check what the fake database of the other store tests cannot: that SQLite accepts the schema,
 * that its constraints refuse what they should, and that the store's SQL does what the store says.
 * The app does not import this module.
 */

import type { SQLiteBindParams } from "expo-sqlite";

import type { FindDatabase, SqlRunner } from "../store/database";
import type { PhotoFiles } from "../store/photoFiles";

/** The part of a `node:sqlite` statement the tests use. */
export interface Statement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** The part of `node:sqlite`'s `DatabaseSync` the tests use. */
export interface DatabaseSync {
  exec(source: string): void;
  prepare(source: string): Statement;
  close(): void;
}

const { DatabaseSync: Database } = jest.requireActual<{
  DatabaseSync: new (path: string) => DatabaseSync;
}>("node:sqlite");

/** A new SQLite database in memory. */
export function memorySqlite(): DatabaseSync {
  return new Database(":memory:");
}

function params(values: SQLiteBindParams): unknown[] {
  return Array.isArray(values) ? values : [values];
}

/** A FindDatabase over a real SQLite, as the store sees expo-sqlite. */
export function sqliteDatabase(sqlite: DatabaseSync): FindDatabase {
  const runner: SqlRunner = {
    async execAsync(source) {
      sqlite.exec(source);
    },
    async runAsync(source, values) {
      const { changes, lastInsertRowid } = sqlite.prepare(source).run(...params(values));
      return { changes: Number(changes), lastInsertRowId: Number(lastInsertRowid) };
    },
    async getFirstAsync(source, values) {
      return sqlite.prepare(source).get(...params(values)) ?? null;
    },
    async getAllAsync(source, values) {
      return sqlite.prepare(source).all(...params(values));
    },
  };
  return {
    ...runner,
    async withExclusiveTransactionAsync(task) {
      sqlite.exec("BEGIN EXCLUSIVE");
      try {
        await task(runner);
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/** A photo directory in memory; `files` holds the names in it. */
export function memoryPhotos(): PhotoFiles & { readonly files: Set<string> } {
  const files = new Set<string>();
  return {
    files,
    prepare: () => undefined,
    copyIn: async (_source, baseName) => {
      const name = `${baseName}.jpg`;
      files.add(name);
      return name;
    },
    remove: (name) => {
      files.delete(name);
    },
    list: () => [...files],
    uriOf: (name) => `file:///photos/${name}`,
  };
}
