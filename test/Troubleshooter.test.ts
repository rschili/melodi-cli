import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StandaloneDb } from "@itwin/core-backend";
import { UnifiedDb } from "../src/UnifiedDb";
import { ensureIModelHost, getTestDir, cleanupTestDir, shutdownIModelHost } from "./TestHelper";
import {
  isFkFlagSet,
  setFkFlag,
  runForeignKeyCheck,
  getForeignKeyDetails,
  enrichFailures,
  runIntegrityCheck,
} from "../src/Logic/TroubleshootOps";
import path from "path";

describe("TroubleshootOps", () => {
  beforeAll(async () => {
    await ensureIModelHost();
  });

  afterAll(async () => {
    cleanupTestDir();
    await shutdownIModelHost();
  });

  function createTestDb(name: string): UnifiedDb {
    const dbPath = path.join(getTestDir(), name);
    const imodel = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "Troubleshoot Test" } });
    return new UnifiedDb(imodel);
  }

  describe("FK flag operations", () => {
    it("flag is not set on a fresh db", () => {
      using db = createTestDb("ops-flag-fresh.bim");
      expect(isFkFlagSet(db)).toBe(false);
    });

    it("can set the flag", () => {
      using db = createTestDb("ops-flag-set.bim");
      setFkFlag(db, true);
      expect(isFkFlagSet(db)).toBe(true);
    });

    it("can remove the flag", () => {
      using db = createTestDb("ops-flag-remove.bim");
      setFkFlag(db, true);
      expect(isFkFlagSet(db)).toBe(true);
      setFkFlag(db, false);
      expect(isFkFlagSet(db)).toBe(false);
    });

    it("setting flag twice is idempotent", () => {
      using db = createTestDb("ops-flag-idempotent.bim");
      setFkFlag(db, true);
      setFkFlag(db, true);
      expect(isFkFlagSet(db)).toBe(true);
    });

    it("removing unset flag is a no-op", () => {
      using db = createTestDb("ops-flag-remove-noop.bim");
      setFkFlag(db, false);
      expect(isFkFlagSet(db)).toBe(false);
    });
  });

  describe("runForeignKeyCheck", () => {
    it("returns no violations on a clean db", () => {
      using db = createTestDb("ops-fk-clean.bim");
      const failures = runForeignKeyCheck(db);
      expect(failures).toHaveLength(0);
    });
  });

  describe("getForeignKeyDetails", () => {
    it("returns FK metadata for system tables", () => {
      using db = createTestDb("ops-fk-details.bim");
      // bis_Element should have FKs (ModelId, CodeSpecId, etc.)
      const details = getForeignKeyDetails(db, "bis_Element");
      expect(details.length).toBeGreaterThan(0);
      // each detail should have the expected shape
      for (const d of details) {
        expect(d).toHaveProperty("id");
        expect(d).toHaveProperty("table");
        expect(d).toHaveProperty("from");
        expect(d).toHaveProperty("to");
      }
    });

    it("returns empty array for a table with no FKs", () => {
      using db = createTestDb("ops-fk-details-empty.bim");
      // be_Local is a simple key-value table with no FK constraints
      const details = getForeignKeyDetails(db, "be_Local");
      expect(details).toHaveLength(0);
    });
  });

  describe("enrichFailures", () => {
    it("produces description even with no FK match", () => {
      using db = createTestDb("ops-enrich-no-match.bim");
      const failures = [{ tableName: "be_Local", rowId: "1", referredTable: "none", fkIndex: "99" }];
      const enriched = enrichFailures(db, failures);
      expect(enriched).toHaveLength(1);
      expect(enriched[0].fkDescription).toBe("FK index 99");
    });
  });

  describe("runIntegrityCheck", () => {
    it("passes on a clean db", () => {
      using db = createTestDb("ops-integrity-clean.bim");
      const results = runIntegrityCheck(db);
      expect(results).toHaveLength(1);
      expect(results[0]).toBe("ok");
    });
  });
});
