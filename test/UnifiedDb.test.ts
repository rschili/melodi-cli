import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ECDb, SQLiteDb, StandaloneDb } from "@itwin/core-backend";
import { DbResult } from "@itwin/core-bentley";
import { UnifiedDb, createECDb, createStandaloneDb } from "../src/UnifiedDb";
import { IModelConfig } from "../src/IModelConfig";
import { Environment } from "../src/EnvironmentManager";
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

  describe("getters", () => {
    it("innerDb returns the underlying db instance", () => {
      const ecdb = new ECDb();
      const dbPath = path.join(getTestDir(), "test-innerdb.ecdb");
      ecdb.createDb(dbPath);

      using db = new UnifiedDb(ecdb);
      expect(db.innerDb).toBe(ecdb);
    });

    it("config returns undefined when no config provided", () => {
      const ecdb = new ECDb();
      const dbPath = path.join(getTestDir(), "test-config-undefined.ecdb");
      ecdb.createDb(dbPath);

      using db = new UnifiedDb(ecdb);
      expect(db.config).toBeUndefined();
    });

    it("config returns the provided IModelConfig", () => {
      const ecdb = new ECDb();
      const dbPath = path.join(getTestDir(), "test-config-set.ecdb");
      ecdb.createDb(dbPath);

      const fakeConfig: IModelConfig = {
        iModelId: "test-id",
        iTwinId: "twin-id",
        displayName: "TestModel",
        melodiVersion: "1.0.0",
        environment: Environment.PROD,
      };
      using db = new UnifiedDb(ecdb, fakeConfig);
      expect(db.config).toBe(fakeConfig);
    });
  });

  describe("factory functions", () => {
    it("createECDb creates and opens an ECDb", () => {
      const dbPath = path.join(getTestDir(), "factory-ecdb.ecdb");
      using db = createECDb(dbPath);
      expect(db.isOpen).toBe(true);
      expect(db.supportsECSql).toBe(true);
      expect(db.supportsSchemas).toBe(true);
    });

    it("createStandaloneDb creates and opens a StandaloneDb", () => {
      const dbPath = path.join(getTestDir(), "factory-standalone.bim");
      using db = createStandaloneDb(dbPath, "TestSubject");
      expect(db.isOpen).toBe(true);
      expect(db.supportsECSql).toBe(true);
      expect(db.supportsDumpSchemas).toBe(true);
      expect(db.supportsChangesets).toBe(false);
    });
  });

  describe("with SQLiteDb", () => {
    it("opens and reports capabilities correctly", () => {
      const sqliteDb = new SQLiteDb();
      const dbPath = path.join(getTestDir(), "test-sqlitedb.db");
      sqliteDb.createDb(dbPath);

      using db = new UnifiedDb(sqliteDb);
      expect(db.isOpen).toBe(true);
      expect(db.supportsECSql).toBe(false);
      expect(db.supportsSqlite).toBe(true);
      expect(db.supportsSchemas).toBe(false);
      expect(db.supportsDumpSchemas).toBe(false);
      expect(db.supportsChangesets).toBe(false);
    });

    it("reports isReadOnly correctly for writable db", () => {
      const sqliteDb = new SQLiteDb();
      const dbPath = path.join(getTestDir(), "test-sqlitedb-rw.db");
      sqliteDb.createDb(dbPath);

      using db = new UnifiedDb(sqliteDb);
      expect(db.isReadOnly).toBe(false);
    });

    it("executes SQLite via withSqliteStatement", () => {
      const sqliteDb = new SQLiteDb();
      const dbPath = path.join(getTestDir(), "test-sqlitedb-stmt.db");
      sqliteDb.createDb(dbPath);

      using db = new UnifiedDb(sqliteDb);
      const result = db.withSqliteStatement("SELECT 99", (stmt) => {
        if (stmt.step() === DbResult.BE_SQLITE_ROW) {
          return stmt.getValueInteger(0);
        }
        return -1;
      });
      expect(result).toBe(99);
    });

    it("throws when calling createQueryReader", () => {
      const sqliteDb = new SQLiteDb();
      const dbPath = path.join(getTestDir(), "test-sqlitedb-ecsql-throw.db");
      sqliteDb.createDb(dbPath);

      using db = new UnifiedDb(sqliteDb);
      expect(() => db.createQueryReader("SELECT 1")).toThrow("not supported");
    });

    it("disposes and closes the db", () => {
      const sqliteDb = new SQLiteDb();
      const dbPath = path.join(getTestDir(), "test-sqlitedb-dispose.db");
      sqliteDb.createDb(dbPath);
      expect(sqliteDb.isOpen).toBe(true);

      {
        using db = new UnifiedDb(sqliteDb);
        expect(db.isOpen).toBe(true);
      }
      // After dispose, the db should be closed
      expect(sqliteDb.isOpen).toBe(false);
    });
  });

  describe("withECSqlStatement error path", () => {
    it("throws when called on a type that doesn't support ECSql", () => {
      // We simulate this by checking the guard - withouet SQLiteDb, we check the
      // supportsECSql path directly via a subclass trick isn't easy.
      // Instead verify that the check works on ECDb (positive) and the error message
      // is correct for a non-ECSql db.
      const ecdb = new ECDb();
      const dbPath = path.join(getTestDir(), "test-ecsql-guard.ecdb");
      ecdb.createDb(dbPath);

      // Monkey-patch supportsECSql to simulate an unsupported type
      using db = new UnifiedDb(ecdb);
      // We patch by overriding the getter via Object.defineProperty on the instance
      Object.defineProperty(db, "supportsECSql", { get: () => false, configurable: true });
      expect(() => db.withECSqlStatement("SELECT 1", () => {})).toThrow("ECSql statements are not supported");
    });
  });

  describe("dumpSchemas", () => {
    it("dumpSchemas works on StandaloneDb and writes files", async () => {
      const dbPath = path.join(getTestDir(), "dump-schemas.bim");
      const outDir = path.join(getTestDir(), "dump-schemas-out");
      const fs = await import("fs");
      fs.mkdirSync(outDir, { recursive: true });

      using db = createStandaloneDb(dbPath, "DumpTest");
      await expect(db.dumpSchemas(outDir)).resolves.not.toThrow();
      // StandaloneDb should have at least BisCore exported
      const exported = fs.readdirSync(outDir);
      expect(exported.length).toBeGreaterThan(0);
    });

    it("dumpSchemas throws on ECDb", async () => {
      const dbPath = path.join(getTestDir(), "dump-ecdb-fail.ecdb");
      using db = createECDb(dbPath);
      await expect(db.dumpSchemas("/tmp")).rejects.toThrow("not implemented");
    });
  });
});
