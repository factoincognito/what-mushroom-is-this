import type { SQLiteBindParams } from "expo-sqlite";

import { EDIBILITIES } from "../analysis/answer";
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

  async runAsync(
    _source: string,
    _params: SQLiteBindParams,
  ): Promise<{ changes: number; lastInsertRowId: number }> {
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
  it("knows three schema versions (PBI-2.2, PBI-2.15)", () => {
    expect(MIGRATIONS).toHaveLength(3);
  });

  it("creates the current schema on an empty database, each version in one exclusive transaction", async () => {
    const db = new VersionedDatabase(0);
    await expect(migrate(db)).resolves.toBe(3);
    expect(db.events).toEqual([
      { first: "PRAGMA user_version" },
      { tx: "begin" },
      { exec: MIGRATIONS[0] },
      { exec: "PRAGMA user_version = 1" },
      { tx: "commit" },
      { tx: "begin" },
      { exec: MIGRATIONS[1] },
      { exec: "PRAGMA user_version = 2" },
      { tx: "commit" },
      { tx: "begin" },
      { exec: MIGRATIONS[2] },
      { exec: "PRAGMA user_version = 3" },
      { tx: "commit" },
    ]);
  });

  it("takes a version 1 database to version 3 by the second migration and then the third, each in its own transaction (PBI-2.2, PBI-2.15)", async () => {
    const db = new VersionedDatabase(1);
    await expect(migrate(db)).resolves.toBe(3);
    expect(db.events).toEqual([
      { first: "PRAGMA user_version" },
      { tx: "begin" },
      { exec: MIGRATIONS[1] },
      { exec: "PRAGMA user_version = 2" },
      { tx: "commit" },
      { tx: "begin" },
      { exec: MIGRATIONS[2] },
      { exec: "PRAGMA user_version = 3" },
      { tx: "commit" },
    ]);
  });

  it("takes a version 2 database to version 3 by the third migration alone (PBI-2.15)", async () => {
    const db = new VersionedDatabase(2);
    await expect(migrate(db)).resolves.toBe(3);
    expect(db.events).toEqual([
      { first: "PRAGMA user_version" },
      { tx: "begin" },
      { exec: MIGRATIONS[2] },
      { exec: "PRAGMA user_version = 3" },
      { tx: "commit" },
    ]);
  });

  it("keeps a version 2 database at version 2 when the third migration fails, rolled back (PBI-2.15)", async () => {
    const db = new VersionedDatabase(2);
    db.failOn = "finds_v3";
    await expect(migrate(db)).rejects.toThrow("disk I/O error");
    expect(db.events).toEqual([
      { first: "PRAGMA user_version" },
      { tx: "begin" },
      { exec: MIGRATIONS[2] },
      { tx: "rollback" },
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

  it("refuses a database at a version past 3, and sends nothing to it (PBI-2.2, PBI-2.15)", async () => {
    const db = new VersionedDatabase(4);
    await expect(migrate(db)).rejects.toMatchObject({ code: "newer-schema" });
    expect(db.events).toEqual([{ first: "PRAGMA user_version" }]);
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

  it("declares the table STRICT (PBI-1.16; the refusal itself is in schema.sqlite.test.ts)", () => {
    expect(v1).toMatch(/\) STRICT;/);
  });

  it("keeps both times within JavaScript's safe-integer range (Clead's review of #26, decision 3)", () => {
    const range = `BETWEEN ${-Number.MAX_SAFE_INTEGER} AND ${Number.MAX_SAFE_INTEGER}`;
    expect(v1).toContain(`taken_at_ms INTEGER NOT NULL CHECK (taken_at_ms ${range})`);
    expect(v1).toContain(`analysed_at_ms INTEGER CHECK (analysed_at_ms ${range})`);
  });

  it("lets the database refuse an edibility the answer's shape does not have (PBI-1.16)", () => {
    const listed = EDIBILITIES.map((edibility) => `'${edibility}'`).join(", ");
    expect(v1).toContain(`edibility TEXT CHECK (edibility IN (${listed}))`);
  });

  it("indexes the finds in the Log's order", () => {
    expect(v1).toContain("CREATE INDEX finds_newest_first ON finds (taken_at_ms DESC, id DESC)");
  });
});

describe("schema version 2 (PBI-2.2)", () => {
  const v2 = (MIGRATIONS[1] ?? "").replace(/\s+/g, " ");

  it("rebuilds the finds table, still STRICT and with IDs that are never used again", () => {
    expect(v2).toContain("CREATE TABLE finds_v2 ( id INTEGER PRIMARY KEY AUTOINCREMENT");
    expect(v2).toMatch(/\) STRICT;/);
    expect(v2).toContain("DROP TABLE finds;");
    expect(v2).toContain("ALTER TABLE finds_v2 RENAME TO finds;");
  });

  it("copies the finds past the CHECKs, so a damaged row is kept as it is, and turns the CHECKs on again", () => {
    expect(v2.indexOf("PRAGMA ignore_check_constraints = ON;")).toBeLessThan(
      v2.indexOf("INSERT INTO finds_v2"),
    );
    expect(v2.trim().endsWith("PRAGMA ignore_check_constraints = OFF;")).toBe(true);
  });

  it("keeps each find's photo as its first photo, in batch 1, and its answer's state as analysed", () => {
    expect(v2).toContain("json_array(json_object('file', photo_file, 'batch', 1)), 1, 0");
    expect(v2).toContain("CASE WHEN answer_json IS NULL THEN NULL ELSE 'analysed' END");
  });

  it("lets the database refuse a self-check state and a state of the added photos it does not know", () => {
    expect(v2).toContain(
      "self_check TEXT CHECK (self_check IN ('waiting', 'agreed', 'disagreed', 'no-species', 'failed', 'no-picture'))",
    );
    expect(v2).toContain(
      "added_photos TEXT CHECK (added_photos IN ('analysed', 'waiting', 'not-analysed'))",
    );
  });

  it("holds the confidence as a level or as a whole number from 1 to 100, never both", () => {
    expect(v2).toContain("confidence TEXT CHECK (confidence IN ('low', 'medium', 'high'))");
    expect(v2).toContain("confidence_score INTEGER CHECK (confidence_score BETWEEN 1 AND 100)");
    expect(v2).toContain("CHECK (confidence IS NULL OR confidence_score IS NULL)");
  });

  it("indexes the finds in the Log's order again", () => {
    expect(v2).toContain("CREATE INDEX finds_newest_first ON finds (taken_at_ms DESC, id DESC)");
  });
});

describe("schema version 3 (PBI-2.15)", () => {
  const v3 = (MIGRATIONS[2] ?? "").replace(/\s+/g, " ");

  it("rebuilds the finds table, still STRICT and with IDs that are never used again, keeping the high-water mark", () => {
    expect(v3).toContain("CREATE TABLE finds_v3 ( id INTEGER PRIMARY KEY AUTOINCREMENT");
    expect(v3).toMatch(/\) STRICT;/);
    expect(v3).toContain(
      "INSERT INTO sqlite_sequence (name, seq) SELECT 'finds_v3', seq FROM sqlite_sequence WHERE name = 'finds';",
    );
    expect(v3).toContain("DROP TABLE finds;");
    expect(v3).toContain("ALTER TABLE finds_v3 RENAME TO finds;");
  });

  it("keeps every column and every CHECK of version 2, as version 2 wrote them", () => {
    const v2 = MIGRATIONS[1] ?? "";
    const body = v2.slice(v2.indexOf("CREATE TABLE finds_v2 ("), v2.indexOf(") STRICT;"));
    // Each line after the CREATE TABLE line: a column or a CHECK.
    const lines = body
      .split("\n")
      .slice(1)
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(40);
    for (const line of lines) {
      expect(v3).toContain(line.replace(/\s+/g, " "));
    }
  });

  it("copies the finds past the CHECKs, so a damaged row is kept as it is, and turns the CHECKs on again", () => {
    expect(v3.indexOf("PRAGMA ignore_check_constraints = ON;")).toBeLessThan(
      v3.indexOf("INSERT INTO finds_v3"),
    );
    expect(v3.trim().endsWith("PRAGMA ignore_check_constraints = OFF;")).toBe(true);
  });

  it("lets the database refuse a basis it does not know, and one that does not fit the find's other columns", () => {
    expect(v3).toContain("answer_basis TEXT CHECK (answer_basis IN ('text', 'photos'))");
    expect(v3).toContain("CHECK (answer_basis IS NULL OR answer_json IS NOT NULL)");
    expect(v3).toContain("CHECK (COALESCE(answer_basis, '') <> 'text' OR text IS NOT NULL)");
    expect(v3).toContain("CHECK (COALESCE(answer_basis, '') <> 'photos' OR self_check IS NULL)");
    expect(v3).toContain(
      "CHECK (COALESCE(answer_basis, '') <> 'text' OR COALESCE(result, '') <> 'match' OR self_check IS NOT NULL)",
    );
    expect(v3).toContain(
      "CHECK (answer_basis IS NOT NULL OR answer_json IS NULL OR (text IS NOT NULL AND COALESCE(result, '') <> 'match' AND batches > 0))",
    );
  });

  it("fills the basis only where the stored data proves it, and leaves it empty otherwise", () => {
    expect(v3).toContain(
      "CASE WHEN answer_json IS NULL THEN NULL WHEN text IS NULL THEN 'photos' WHEN self_check IS NOT NULL THEN 'text' WHEN result = 'match' THEN 'photos' WHEN batches = 0 THEN 'text' END",
    );
  });

  it("indexes the finds in the Log's order again", () => {
    expect(v3).toContain("CREATE INDEX finds_newest_first ON finds (taken_at_ms DESC, id DESC)");
  });
});
