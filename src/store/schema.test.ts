import type { SQLiteBindParams } from "expo-sqlite";

import type { FindDatabase, SqlRunner } from "./database";
import { StoreError } from "./find";
import { MIGRATIONS, migrate } from "./schema";

type Event = { exec: string } | { tx: "begin" | "commit" | "rollback" } | { first: string };

/** A database at a given `user_version` that records what it is sent. */
class VersionedDatabase implements FindDatabase {
  readonly events: Event[] = [];
  failOn: string | null = null;

  constructor(public version: unknown) {}

  async execAsync(source: string): Promise<void> {
    this.events.push({ exec: source });
    if (this.failOn !== null && source.includes(this.failOn)) {
      throw new Error("disk I/O error");
    }
  }

  async runAsync(_source: string, _params: SQLiteBindParams) {
    throw new Error("not used by migrate");
  }

  async getFirstAsync(source: string, _params: SQLiteBindParams): Promise<unknown> {
    this.events.push({ first: source });
    return source === "PRAGMA user_version" ? { user_version: this.version } : null;
  }

  async getAllAsync(_source: string, _params: SQLiteBindParams): Promise<unknown[]> {
    throw new Error("not used by migrate");
  }

  async withExclusiveTransactionAsync(task: (txn: SqlRunner) => Promise<void>): Promise<void> {
    this.events.push({ tx: "begin" });
    try {
      await task(this);
      this.events.push({ tx: "commit" });
    } catch (error) {
      this.events.push({ tx: "rollback" });
      throw error;
    }
  }
}

describe("migrate", () => {
  it("creates schema version 1 on an empty database, in one exclusive transaction", async () => {
    const db = new VersionedDatabase(0);
    await expect(migrate(db)).resolves.toBe(1);
    expect(db.events).toEqual([
      { first: "PRAGMA user_version" },
      { tx: "begin" },
      { exec: MIGRATIONS[0] },
      { exec: "PRAGMA user_version = 1" },
      { tx: "commit" },
    ]);
  });

  it("sends nothing more to a database already at the current version", async () => {
    const db = new VersionedDatabase(MIGRATIONS.length);
    await expect(migrate(db)).resolves.toBe(MIGRATIONS.length);
    expect(db.events).toEqual([{ first: "PRAGMA user_version" }]);
  });

  it("takes a version 1 database only through the migrations after version 1", async () => {
    const db = new VersionedDatabase(1);
    const toTwo = "ALTER TABLE finds ADD COLUMN note TEXT;";
    await expect(migrate(db, ["CREATE TABLE v1;", toTwo])).resolves.toBe(2);
    expect(db.events).toEqual([
      { first: "PRAGMA user_version" },
      { tx: "begin" },
      { exec: toTwo },
      { exec: "PRAGMA user_version = 2" },
      { tx: "commit" },
    ]);
  });

  it("runs each migration in its own transaction, in order", async () => {
    const db = new VersionedDatabase(0);
    await migrate(db, ["ONE;", "TWO;"]);
    expect(db.events).toEqual([
      { first: "PRAGMA user_version" },
      { tx: "begin" },
      { exec: "ONE;" },
      { exec: "PRAGMA user_version = 1" },
      { tx: "commit" },
      { tx: "begin" },
      { exec: "TWO;" },
      { exec: "PRAGMA user_version = 2" },
      { tx: "commit" },
    ]);
  });

  it("rolls back a migration that fails, and stops before the next one", async () => {
    const db = new VersionedDatabase(0);
    db.failOn = "TWO;";
    await expect(migrate(db, ["ONE;", "TWO;", "THREE;"])).rejects.toThrow("disk I/O error");
    expect(db.events.slice(-3)).toEqual([{ tx: "begin" }, { exec: "TWO;" }, { tx: "rollback" }]);
    expect(db.events).not.toContainEqual({ exec: "THREE;" });
  });

  it("refuses a database newer than the app knows, and sends nothing to it", async () => {
    const db = new VersionedDatabase(MIGRATIONS.length + 1);
    const opening = migrate(db);
    await expect(opening).rejects.toBeInstanceOf(StoreError);
    await expect(opening).rejects.toMatchObject({ code: "newer-schema" });
    expect(db.events).toEqual([{ first: "PRAGMA user_version" }]);
  });

  it.each<[string, unknown]>([
    ["a negative number", -1],
    ["a fraction", 1.5],
    ["a string", "1"],
    ["null", null],
  ])("refuses a user_version that is %s", async (_, version) => {
    const db = new VersionedDatabase(version);
    await expect(migrate(db)).rejects.toMatchObject({ code: "corrupt" });
    expect(db.events).toEqual([{ first: "PRAGMA user_version" }]);
  });
});

describe("schema version 1", () => {
  const v1 = (MIGRATIONS[0] ?? "").replace(/\s+/g, " ");

  it("keeps finds under IDs that are never used again", () => {
    expect(v1).toContain("id INTEGER PRIMARY KEY AUTOINCREMENT");
  });

  it("lets the database refuse a state, a time source or a position source it does not know", () => {
    expect(v1).toContain("state TEXT NOT NULL CHECK (state IN ('waiting', 'done', 'failed'))");
    expect(v1).toContain("CHECK (time_source IN ('saved', 'photo', 'photo-phone-offset'))");
    expect(v1).toContain("CHECK (position_source IN ('fix', 'last-known', 'photo'))");
  });

  it("lets the database hold an answer only on a done find, and a failure only on a failed one", () => {
    expect(v1).toContain("CHECK ((state = 'done') = (answer_json IS NOT NULL))");
    expect(v1).toContain("CHECK ((state = 'failed') = (failure_cause IS NOT NULL))");
  });

  it("indexes the finds in the Log's order", () => {
    expect(v1).toContain("CREATE INDEX finds_newest_first ON finds (taken_at_ms DESC, id DESC)");
  });
});
