/**
 * The schema and the store against a real SQLite: Node's own `node:sqlite` (no added
 * dependency), not expo-sqlite. It checks what the fake database of the other store tests cannot:
 * that SQLite accepts the schema, that its CHECKs refuse what they should, and that the store's
 * SQL does what the store says.
 */

import type { SQLiteBindParams } from "expo-sqlite";

import type { FindDatabase, SqlRunner } from "./database";
import { FAILURE_CAUSES, type NewFind } from "./find";
import { createFindStore, type FindStore } from "./findStore";
import type { PhotoFiles } from "./photoFiles";
import { MIGRATIONS } from "./schema";

/** The part of `node:sqlite` these tests use. */
interface Statement {
  run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface DatabaseSync {
  exec(source: string): void;
  prepare(source: string): Statement;
  close(): void;
}

const { DatabaseSync: Database } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseSync;
};

function params(values: SQLiteBindParams): unknown[] {
  return Array.isArray(values) ? values : [values];
}

/** A FindDatabase over a real SQLite in memory. */
function realDatabase(sqlite: DatabaseSync): FindDatabase {
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

/** A photo directory in memory. */
function memoryPhotos(): PhotoFiles {
  const files = new Set<string>();
  return {
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

function newFind(takenAtMs: number): NewFind {
  return {
    photoUri: "file:///cache/camera.jpg",
    time: { takenAtMs, utcOffsetMinutes: 60, source: "saved" },
    position: null,
  };
}

let sqlite: DatabaseSync;
let store: FindStore;

beforeEach(async () => {
  sqlite = new Database(":memory:");
  let photo = 0;
  store = await createFindStore(realDatabase(sqlite), memoryPhotos(), {
    newPhotoName: () => {
      photo += 1;
      return `p${photo}`;
    },
  });
});

afterEach(() => {
  sqlite.close();
});

/** Inserts a failed find straight into the table, past the store's own checks. */
function insertFailed(cause: string): void {
  sqlite
    .prepare(
      `INSERT INTO finds (taken_at_ms, utc_offset_min, time_source, photo_file, state,
        failure_cause, failure_detail) VALUES (1, 0, 'saved', ?, 'failed', ?, 'why')`,
    )
    .run(`f-${cause}.jpg`, cause);
}

describe("schema version 1 on a real SQLite", () => {
  it("is accepted by SQLite, at user_version 1", () => {
    expect(sqlite.prepare("PRAGMA user_version").get()).toEqual({
      user_version: MIGRATIONS.length,
    });
  });

  it.each(FAILURE_CAUSES)("accepts the failure cause %s the store knows", (cause) => {
    expect(() => insertFailed(cause)).not.toThrow();
  });

  it("accepts the failure cause photo, for a photo that cannot be read (PBI-1.7)", () => {
    expect(FAILURE_CAUSES).toContain("photo");
    expect(() => insertFailed("photo")).not.toThrow();
  });

  it("refuses a failure cause the store does not know", () => {
    expect(() => insertFailed("bad-luck")).toThrow(/CHECK constraint failed/);
  });
});

describe("the store on a real SQLite", () => {
  it("gives the oldest waiting find by its ID, not by the time taken", async () => {
    const late = await store.add(newFind(3_000));
    const early = await store.add(newFind(1_000));
    expect(late).toBeLessThan(early);
    await expect(store.oldestWaiting()).resolves.toBe(late);
    await store.markFailed(late, { cause: "photo", detail: "the image could not be loaded" });
    await expect(store.oldestWaiting()).resolves.toBe(early);
  });

  it("gives null when no find is waiting", async () => {
    await expect(store.oldestWaiting()).resolves.toBeNull();
  });

  it("marks a find failed for its photo and reads it back", async () => {
    const id = await store.add(newFind(1_000));
    await store.markFailed(id, { cause: "photo", detail: "invalid-size: 0 x 0" });
    await expect(store.get(id)).resolves.toMatchObject({
      analysis: { state: "failed", failure: { cause: "photo", detail: "invalid-size: 0 x 0" } },
    });
    const [summary] = await store.list();
    expect(summary?.analysis).toEqual({
      state: "failed",
      failure: { cause: "photo", detail: "invalid-size: 0 x 0" },
    });
  });

  it("puts a find failed for its photo back to waiting", async () => {
    const id = await store.add(newFind(1_000));
    await store.markFailed(id, { cause: "photo", detail: "gone" });
    await store.markWaiting(id);
    await expect(store.oldestWaiting()).resolves.toBe(id);
  });
});
