import { Directory, File, Paths } from "expo-file-system";
import { openDatabaseAsync } from "expo-sqlite";

import { openFindLog } from "./deviceFindStore";

/*
 * jest-expo backs expo-file-system's native module with an in-memory file system, shared by the
 * tests of this file. Every opening removes the photos no find refers to, and the database here
 * holds no finds, so each test starts with an empty photo directory.
 */

/** What reaches expo-sqlite: each statement and its parameters. */
const mockSent: { sql: string; params: unknown }[] = [];
const mockDatabase = {
  execAsync: async (sql: string) => {
    mockSent.push({ sql, params: [] });
  },
  runAsync: async (sql: string, params: unknown) => {
    mockSent.push({ sql, params });
    return { changes: 1, lastInsertRowId: 1 };
  },
  getFirstAsync: async (sql: string, params: unknown) => {
    mockSent.push({ sql, params });
    return sql === "PRAGMA user_version" ? { user_version: 0 } : null;
  },
  getAllAsync: async (sql: string, params: unknown) => {
    mockSent.push({ sql, params });
    return [];
  },
  withExclusiveTransactionAsync: async (task: (txn: unknown) => Promise<void>) => {
    await task(mockDatabase);
  },
};

jest.mock("expo-sqlite", () => ({ openDatabaseAsync: jest.fn(async () => mockDatabase) }));

beforeEach(() => {
  mockSent.length = 0;
});

describe("openFindLog", () => {
  it("opens the one find-log database, brings it to the current schema and makes the photo directory", async () => {
    await openFindLog();
    expect(openDatabaseAsync).toHaveBeenCalledWith("finds.db");
    expect(mockSent.map((sent) => sent.sql)).toContain("PRAGMA user_version = 1");
    expect(new Directory(Paths.document, "photos").exists).toBe(true);
  });

  it("removes a photo in the directory that no find refers to", async () => {
    const photos = new Directory(Paths.document, "photos");
    photos.create({ intermediates: true, idempotent: true });
    const orphan = new File(photos, "left-over.jpg");
    orphan.write(new Uint8Array([1]));
    await openFindLog();
    expect(orphan.exists).toBe(false);
  });

  it("copies a new find's photo in under a fresh name with the source's extension", async () => {
    const store = await openFindLog();
    const source = new File(Paths.cache, "IMG_1.jpg");
    source.write(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    await store.add({
      photoUri: source.uri,
      time: { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" },
      position: null,
    });
    const names = new Directory(Paths.document, "photos").list().map((entry) => entry.name);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[a-z0-9]+-[a-z0-9]+\.jpg$/);
    expect(mockSent.at(-1)?.params).toEqual(expect.arrayContaining([names[0]]));
  });
});
