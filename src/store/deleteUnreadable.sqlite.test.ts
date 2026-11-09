/**
 * `deleteUnreadable` against a real SQLite (`src/testing/sqliteDatabase.ts`): it never deletes a
 * find whose ID the store can read, nor that find's photo (Clead's review of #33, fix 2), and it
 * removes a photo only when its DELETE changed a row (PBI-1.27). The rest of its tests on a real
 * SQLite are in `schema.sqlite.test.ts`.
 */

import {
  type DatabaseSync,
  memoryPhotos,
  memorySqlite,
  sqliteDatabase,
} from "../testing/sqliteDatabase";
import { createFindStore, type FindStore } from "./findStore";

let sqlite: DatabaseSync;
let photos: ReturnType<typeof memoryPhotos>;
let store: FindStore;

beforeEach(async () => {
  sqlite = memorySqlite();
  photos = memoryPhotos();
  store = await createFindStore(sqliteDatabase(sqlite), photos, { newPhotoName: () => "p1" });
});

afterEach(() => {
  sqlite.close();
});

/** Inserts a waiting find straight into the table; gives its ID as SQLite writes it. */
function insert(id: bigint | null, timeSource: string, photo: string): string {
  // Past the CHECKs, as a damaged file could hold a row; STRICT typing still applies.
  sqlite.exec("PRAGMA ignore_check_constraints = ON");
  try {
    const { lastInsertRowid } = sqlite
      .prepare(
        `INSERT INTO finds (id, taken_at_ms, utc_offset_min, time_source, photo_file, state)
          VALUES (?, 1000, 0, ?, ?, 'waiting')`,
      )
      .run(id, timeSource, photo);
    return lastInsertRowid.toString();
  } finally {
    sqlite.exec("PRAGMA ignore_check_constraints = OFF");
  }
}

describe("deleteUnreadable on a real SQLite, given the ID of a find the store can read", () => {
  it.each<[string, () => Promise<string>, string]>([
    ["a readable find", async () => String(await store.add(newFind())), "p1.jpg"],
    [
      "a find with the highest ID the store can read",
      async () => insert(BigInt(Number.MAX_SAFE_INTEGER), "saved", "u1.jpg"),
      "u1.jpg",
    ],
    [
      "a find the store cannot read but whose ID it can",
      async () => insert(null, "gps", "u1.jpg"),
      "u1.jpg",
    ],
  ])("never deletes %s, which `delete` is for, nor its photo", async (_name, add, photo) => {
    const storedId = await add();
    photos.files.add(photo);
    await expect(store.deleteUnreadable(storedId)).rejects.toMatchObject({ code: "not-found" });
    expect(sqlite.prepare("SELECT CAST(id AS TEXT) AS id FROM finds").all()).toEqual([
      { id: storedId },
    ]);
    expect([...photos.files]).toEqual([photo]);
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: Number(storedId) }),
    ]);
  });
});

describe("deleteUnreadable on a real SQLite, when its DELETE changes no row (PBI-1.27)", () => {
  it("of two deletes of one find at once (a double tap), lets one delete the find and its photo, and has the other answer not-found and remove no photo", async () => {
    // Named from the ID itself: `node:sqlite` gives `lastInsertRowid` past 2^53 rounded.
    const id = 2n ** 53n + 1n;
    insert(id, "saved", "u1.jpg");
    const storedId = id.toString();
    photos.files.add("u1.jpg");
    const remove = jest.spyOn(photos, "remove");
    // Both read the photo's name before either deletes: the second DELETE changes no row.
    const [first, second] = await Promise.allSettled([
      store.deleteUnreadable(storedId),
      store.deleteUnreadable(storedId),
    ]);
    expect(first).toEqual({ status: "fulfilled", value: { photoRemoved: true } });
    expect(second).toMatchObject({ status: "rejected", reason: { code: "not-found" } });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(sqlite.prepare("SELECT id FROM finds").all()).toEqual([]);
    expect(photos.files.size).toBe(0);
  });
});

function newFind() {
  return {
    photoUri: "file:///cache/camera.jpg",
    time: { takenAtMs: 1_000, utcOffsetMinutes: 60, source: "saved" as const },
    position: null,
  };
}
