import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { StandaloneDb } from "@itwin/core-backend";
import { UnifiedDb } from "../src/UnifiedDb";
import { executeAndPrintSqliteQuery } from "../src/Logic/QueryRunner";
import { ensureIModelHost, getTestDir, cleanupTestDir, shutdownIModelHost } from "./TestHelper";
import path from "path";

describe("executeAndPrintSqliteQuery", () => {
  beforeAll(async () => {
    await ensureIModelHost();
  });

  afterAll(async () => {
    cleanupTestDir();
    await shutdownIModelHost();
  });

  it("returns results for a simple SELECT", () => {
    const dbPath = path.join(getTestDir(), "sqlite-query-test.bim");
    const imodel = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "Query Test" } });

    using db = new UnifiedDb(imodel);

    // Suppress console.log during test
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = executeAndPrintSqliteQuery(db, "SELECT name FROM sqlite_master WHERE type='table' LIMIT 5");
      expect(result.rowCount).toBeGreaterThan(0);
      expect(result.rowCount).toBeLessThanOrEqual(5);
      expect(result.truncated).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns zero rows for empty result set", () => {
    const dbPath = path.join(getTestDir(), "sqlite-empty-test.bim");
    const imodel = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "Empty Test" } });

    using db = new UnifiedDb(imodel);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = executeAndPrintSqliteQuery(db, "SELECT * FROM sqlite_master WHERE 1=0");
      expect(result.rowCount).toBe(0);
      expect(result.truncated).toBe(false);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("handles DDL statements (CREATE TABLE)", () => {
    const dbPath = path.join(getTestDir(), "sqlite-ddl-test.bim");
    const imodel = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "DDL Test" } });

    using db = new UnifiedDb(imodel);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      // DDL returns no rows
      const result = executeAndPrintSqliteQuery(db, "CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, name TEXT)");
      expect(result.rowCount).toBe(0);

      // Now insert and query
      executeAndPrintSqliteQuery(db, "INSERT INTO test_table (id, name) VALUES (1, 'hello')");
      const selectResult = executeAndPrintSqliteQuery(db, "SELECT * FROM test_table");
      expect(selectResult.rowCount).toBe(1);
    } finally {
      logSpy.mockRestore();
    }
  });
});
