import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { calculateColumnWidths, formatValue, executeAndPrintQuery } from "../src/Logic/QueryRunner";
import { QueryPropertyMetaData } from "@itwin/core-common";
import { StandaloneDb } from "@itwin/core-backend";
import { UnifiedDb } from "../src/UnifiedDb";
import { ensureIModelHost, getTestDir, cleanupTestDir, shutdownIModelHost } from "./TestHelper";
import path from "path";

describe("calculateColumnWidths", () => {
  it("returns empty for empty data", () => {
    expect(calculateColumnWidths([], 120)).toEqual([]);
  });

  it("sizes columns based on content width", () => {
    const data = [
      ["Name", "Age"],
      ["Alice", "30"],
      ["Bob", "7"],
    ];
    const widths = calculateColumnWidths(data, 120);
    expect(widths).toHaveLength(2);
    expect(widths[0]).toBeGreaterThanOrEqual(5); // "Alice"
    expect(widths[1]).toBeGreaterThanOrEqual(3); // "Age"
  });

  it("shrinks widest column when total exceeds maxWidth", () => {
    // 5 + 67 = 72 content + 2*3 = 78 total, fits in 80, so no shrink.
    // Use a tighter table to force shrinking:
    const data = [
      ["ShortCol", "AnotherCol", "A very very very long column value that exceeds anything"],
    ];
    const widths = calculateColumnWidths(data, 80); // floors to 80
    // Total must fit: sum(widths) + cols*3 <= 80
    const total = widths.reduce((s, w) => s + w, 0) + widths.length * 3;
    expect(total).toBeLessThanOrEqual(80);
    // The widest column should have been shrunk
    expect(widths[2]).toBeLessThan(54);
  });

  it("applies minimum width per column when many columns exceed max", () => {
    // Need >10 columns so that 80 < numCols * 8
    const cols = Array.from({ length: 11 }, (_, i) => `C${i}`);
    const data = [cols];
    // 11 * 8 = 88 > 80 (floored maxWidth), so the min branch kicks in
    const widths = calculateColumnWidths(data, 10);
    expect(widths).toHaveLength(11);
    for (const w of widths) {
      expect(w).toBe(8);
    }
  });

  it("handles multiline cells", () => {
    const data = [
      ["Header"],
      ["line1\na-much-longer-line2"],
    ];
    const widths = calculateColumnWidths(data, 120);
    expect(widths[0]).toBeGreaterThanOrEqual(19); // "a-much-longer-line2"
  });
});

function makeMeta(typeName: string, extendedType?: string): QueryPropertyMetaData {
  return { name: "col", typeName, extendedType } as QueryPropertyMetaData;
}

describe("formatValue", () => {
  // formatValue needs a db only for navigation type lookups; a dummy cast works for most paths
  const dummyDb = {} as UnifiedDb;

  it("returns empty string for null", async () => {
    const { value } = await formatValue(null, makeMeta("string"), dummyDb, {});
    expect(value).toBe("");
  });

  it("returns empty string for undefined", async () => {
    const { value } = await formatValue(undefined, makeMeta("string"), dummyDb, {});
    expect(value).toBe("");
  });

  it("returns string value as-is for plain string", async () => {
    const { value } = await formatValue("hello", makeMeta("string"), dummyDb, {});
    expect(value).toBe("hello");
  });

  it("pretty-prints JSON objects in string columns", async () => {
    const json = JSON.stringify({ a: 1, b: 2 });
    const { value } = await formatValue(json, makeMeta("string", "json"), dummyDb, {});
    expect(value).toContain("\n"); // pretty-printed
    expect(JSON.parse(value)).toEqual({ a: 1, b: 2 });
  });

  it("leaves non-JSON strings alone even with json extended type", async () => {
    const { value } = await formatValue("plain text", makeMeta("string", "json"), dummyDb, {});
    expect(value).toBe("plain text");
  });

  it("returns string for numbers", async () => {
    const { value } = await formatValue(42, makeMeta("int"), dummyDb, {});
    expect(value).toBe("42");
  });

  it("returns string for booleans", async () => {
    const { value } = await formatValue(true, makeMeta("bool"), dummyDb, {});
    expect(value).toBe("true");
  });

  it("returns empty string for navigation with missing Id", async () => {
    const { value } = await formatValue({ Id: "", RelECClassId: "0x1" }, makeMeta("navigation"), dummyDb, {});
    expect(value).toBe("");
  });

  it("JSON-serializes unknown objects", async () => {
    const obj = { x: 99 };
    const { value } = await formatValue(obj, makeMeta("blob"), dummyDb, {});
    expect(value).toBe(JSON.stringify(obj));
  });

  it("formats arrays recursively", async () => {
    const { value } = await formatValue([1, 2, 3], makeMeta("int"), dummyDb, {});
    expect(value).toBe("[1, 2, 3]");
  });
});

describe("executeAndPrintQuery", () => {
  beforeAll(async () => {
    await ensureIModelHost();
  });

  afterAll(async () => {
    cleanupTestDir();
    await shutdownIModelHost();
  });

  it("returns row count for a simple ECSql query", async () => {
    const dbPath = path.join(getTestDir(), "exec-query-test.bim");
    const imodel = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "Query" } });
    using db = new UnifiedDb(imodel);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await executeAndPrintQuery(db, "SELECT ECInstanceId FROM bis.Element LIMIT 5");
      expect(result.rowCount).toBeGreaterThanOrEqual(1);
      expect(result.truncated).toBe(false);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns zero rows for empty result set", async () => {
    const dbPath = path.join(getTestDir(), "exec-query-empty.bim");
    const imodel = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "Empty" } });
    using db = new UnifiedDb(imodel);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await executeAndPrintQuery(db, "SELECT ECInstanceId FROM bis.Element WHERE 1=0");
      expect(result.rowCount).toBe(0);
    } finally {
      logSpy.mockRestore();
    }
  });
});
