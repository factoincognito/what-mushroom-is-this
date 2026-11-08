import type { SQLiteBindParams } from "expo-sqlite";

/**
 * The part of expo-sqlite's `SQLiteDatabase` the store uses. Rows come back as `unknown`: the
 * store checks each value it reads.
 */
export interface SqlRunner {
  execAsync(source: string): Promise<void>;
  runAsync(
    source: string,
    params: SQLiteBindParams,
  ): Promise<{ changes: number; lastInsertRowId: number }>;
  getFirstAsync(source: string, params: SQLiteBindParams): Promise<unknown>;
  getAllAsync(source: string, params: SQLiteBindParams): Promise<unknown[]>;
}

export interface FindDatabase extends SqlRunner {
  /** Runs `task` in a transaction that commits when it resolves and rolls back when it throws. */
  withExclusiveTransactionAsync(task: (txn: SqlRunner) => Promise<void>): Promise<void>;
}
