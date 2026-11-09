/*
 * jest-expo backs expo-file-system's native module with an in-memory file system. The find log is
 * opened once per loading of `deviceFindStore` (PBI-1.16), so each test loads it afresh, with its
 * own expo-file-system and expo-sqlite, through `load()`.
 */

type DeviceFindStore = typeof import("./deviceFindStore");
type FileSystem = typeof import("expo-file-system");
type Sqlite = typeof import("expo-sqlite");

/** What reaches expo-sqlite: each statement and its parameters. */
const mockSent: { sql: string; params: unknown }[] = [];
/** When set, an INSERT waits for this before it completes. */
let mockInsertGate: Promise<void> | null = null;
const mockDatabase = {
  execAsync: async (sql: string) => {
    mockSent.push({ sql, params: [] });
  },
  runAsync: async (sql: string, params: unknown) => {
    mockSent.push({ sql, params });
    if (sql.startsWith("INSERT") && mockInsertGate !== null) {
      await mockInsertGate;
    }
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

function load(): { log: DeviceFindStore; fs: FileSystem; sqlite: Sqlite } {
  let loaded: { log: DeviceFindStore; fs: FileSystem; sqlite: Sqlite } | null = null;
  jest.isolateModules(() => {
    loaded = {
      log: jest.requireActual<DeviceFindStore>("./deviceFindStore"),
      fs: jest.requireActual<FileSystem>("expo-file-system"),
      sqlite: jest.requireMock<Sqlite>("expo-sqlite"),
    };
  });
  if (loaded === null) {
    throw new Error("the modules did not load");
  }
  return loaded;
}

function photoNames(fs: FileSystem): string[] {
  return new fs.Directory(fs.Paths.document, "photos").list().map((entry) => entry.name);
}

function cameraPhoto(fs: FileSystem): string {
  const source = new fs.File(fs.Paths.cache, "IMG_1.jpg");
  source.write(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  return source.uri;
}

const time = { takenAtMs: 1_762_590_000_000, utcOffsetMinutes: 60, source: "saved" } as const;

beforeEach(() => {
  mockSent.length = 0;
  mockInsertGate = null;
});

describe("openFindLog", () => {
  it("opens the one find-log database, brings it to the current schema and makes the photo directory", async () => {
    const { log, fs, sqlite } = load();
    await log.openFindLog();
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith("finds.db");
    expect(mockSent.map((sent) => sent.sql)).toContain("PRAGMA user_version = 1");
    expect(new fs.Directory(fs.Paths.document, "photos").exists).toBe(true);
  });

  it("removes a photo in the directory that no find refers to", async () => {
    const { log, fs } = load();
    const photos = new fs.Directory(fs.Paths.document, "photos");
    photos.create({ intermediates: true, idempotent: true });
    const orphan = new fs.File(photos, "left-over.jpg");
    orphan.write(new Uint8Array([1]));
    await log.openFindLog();
    expect(orphan.exists).toBe(false);
  });

  it("copies a new find's photo in under a fresh name with the source's extension", async () => {
    const { log, fs } = load();
    const store = await log.openFindLog();
    await store.add({ photoUri: cameraPhoto(fs), time, position: null });
    const names = photoNames(fs);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[a-z0-9]+-[a-z0-9]+\.jpg$/);
    expect(mockSent.at(-1)?.params).toEqual(expect.arrayContaining([names[0]]));
  });

  it("gives one store however often the find log is opened, and opens the database once (PBI-1.16)", async () => {
    const { log, sqlite } = load();
    const [first, second] = await Promise.all([log.openFindLog(), log.openFindLog()]);
    const later = await log.openFindLog();
    expect(second).toBe(first);
    expect(later).toBe(first);
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(1);
  });

  it("does not remove the photo of a find being added when the find log is opened again (PBI-1.16)", async () => {
    const { log, fs } = load();
    let release: () => void = () => undefined;
    mockInsertGate = new Promise((resolve) => {
      release = resolve;
    });
    const store = await log.openFindLog();
    const adding = store.add({ photoUri: cameraPhoto(fs), time, position: null });
    // The photo is copied in; its row is not saved yet.
    while (!mockSent.some((sent) => sent.sql.startsWith("INSERT"))) {
      await Promise.resolve();
    }
    const [copied] = photoNames(fs);
    await log.openFindLog();
    expect(photoNames(fs)).toEqual([copied]);
    release();
    await expect(adding).resolves.toBe(1);
  });

  it("opens the find log again at the next call after an opening failed", async () => {
    const { log, sqlite } = load();
    jest.mocked(sqlite.openDatabaseAsync).mockRejectedValueOnce(new Error("disk I/O error"));
    await expect(log.openFindLog()).rejects.toThrow("disk I/O error");
    await expect(log.openFindLog()).resolves.toBeDefined();
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });
});
