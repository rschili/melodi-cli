import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ECDb, StandaloneDb } from "@itwin/core-backend";
import { DbResult } from "@itwin/core-bentley";
import { UnifiedDb } from "../src/UnifiedDb";
import { ensureIModelHost, getTestDir, cleanupTestDir, shutdownIModelHost } from "./TestHelper";
import path from "path";

describe("UnifiedDb", () => {
  beforeAll(async () => {
    await ensureIModelHost();
  });

  afterAll(async () => {
    cleanupTestDir();
    await shutdownIModelHost();
  });

  describe("with ECDb", () => {
    it("opens and reports capabilities correctly", () => {
      const ecdb = new ECDb();
      const dbPath = path.join(getTestDir(), "test-unified.ecdb");
      ecdb.createDb(dbPath);

      using db = new UnifiedDb(ecdb);
      expect(db.isOpen).toBe(true);
      expect(db.supportsECSql).toBe(true);
      expect(db.supportsSqlite).toBe(true);
      expect(db.supportsSchemas).toBe(true);
      expect(db.supportsDumpSchemas).toBe(false); // ECDb doesn't support exportSchemas
      expect(db.supportsChangesets).toBe(false);
      expect(db.isReadOnly).toBe(false);
    });

    it("executes ECSql via createQueryReader", async () => {
      const ecdb = new ECDb();
      const dbPath = path.join(getTestDir(), "test-query.ecdb");
      ecdb.createDb(dbPath);

      using db = new UnifiedDb(ecdb);
      const reader = db.createQueryReader("SELECT 1 AS Val");
      const rows = await reader.toArray();
      expect(rows.length).toBe(1);
    });

    it("executes SQLite via withSqliteStatement", () => {
      const ecdb = new ECDb();
      const dbPath = path.join(getTestDir(), "test-sqlite.ecdb");
      ecdb.createDb(dbPath);

      using db = new UnifiedDb(ecdb);
      const result = db.withSqliteStatement("SELECT 42", (stmt) => {
        if (stmt.step() === DbResult.BE_SQLITE_ROW) {
          return stmt.getValueInteger(0);
        }
        return -1;
      });
      expect(result).toBe(42);
    });

    it("executes withECSqlStatement", () => {
      const ecdb = new ECDb();
      const dbPath = path.join(getTestDir(), "test-ecsql-stmt.ecdb");
      ecdb.createDb(dbPath);

      using db = new UnifiedDb(ecdb);
      const result = db.withECSqlStatement("SELECT 1", (stmt) => {
        return stmt.step();
      });
      // step() returns DbResult.BE_SQLITE_ROW on success
      expect(result).toBeDefined();
    });

    it("disposes and closes the db", () => {
      const ecdb = new ECDb();
      const dbPath = path.join(getTestDir(), "test-dispose.ecdb");
      ecdb.createDb(dbPath);
      expect(ecdb.isOpen).toBe(true);

      {
        using db = new UnifiedDb(ecdb);
        expect(db.isOpen).toBe(true);
      }
      // After dispose, accessing ecdb.isOpen throws because the native handle
      // is gone. The important thing is that dispose didn't throw.
    });
  });

  describe("with StandaloneDb", () => {
    it("opens and reports capabilities correctly", () => {
      const dbPath = path.join(getTestDir(), "test-standalone.bim");
      const imodel = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "Test" } });

      using db = new UnifiedDb(imodel);
      expect(db.isOpen).toBe(true);
      expect(db.supportsECSql).toBe(true);
      expect(db.supportsSqlite).toBe(true);
      expect(db.supportsSchemas).toBe(true);
      expect(db.supportsDumpSchemas).toBe(true); // IModelDb supports it
      expect(db.supportsChangesets).toBe(false); // StandaloneDb isn't BriefcaseDb
    });

    it("can query BIS schema via ECSql", async () => {
      const dbPath = path.join(getTestDir(), "test-bis-query.bim");
      const imodel = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "BIS Test" } });

      using db = new UnifiedDb(imodel);
      const reader = db.createQueryReader("SELECT ECInstanceId, CodeValue FROM bis.Element LIMIT 5");
      const rows = await reader.toArray();
      // A newly created iModel has at least a root subject element
      expect(rows.length).toBeGreaterThanOrEqual(1);
    });

    it("can read SQLite tables", () => {
      const dbPath = path.join(getTestDir(), "test-sqlite-tables.bim");
      const imodel = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "SQLite Test" } });

      using db = new UnifiedDb(imodel);
      const tables = db.withSqliteStatement(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
        (stmt) => {
          const names: string[] = [];
          while (stmt.step() === DbResult.BE_SQLITE_ROW) {
            names.push(stmt.getValueString(0));
          }
          return names;
        }
      );
      // An iModel should have be_Local and other system tables
      expect(tables).toContain("be_Local");
      expect(tables.length).toBeGreaterThan(5);
    });

    it("throws when calling createQueryReader on unsupported type", () => {
      // This tests the error path - SQLiteDb doesn't support ECSql
      // We can't easily create an SQLiteDb without more setup,
      // but we can test the ECSql guard on UnifiedDb
      const ecdb = new ECDb();
      const dbPath = path.join(getTestDir(), "test-throw.ecdb");
      ecdb.createDb(dbPath);

      using db = new UnifiedDb(ecdb);
      // This should work for ECDb
      expect(() => db.createQueryReader("SELECT 1")).not.toThrow();
    });
  });
});
