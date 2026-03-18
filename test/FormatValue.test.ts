import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { formatValue } from "../src/Logic/QueryRunner";
import { ECDb } from "@itwin/core-backend";
import { QueryPropertyMetaData } from "@itwin/core-common";
import { UnifiedDb } from "../src/UnifiedDb";
import { ensureIModelHost, getTestDir, cleanupTestDir, shutdownIModelHost } from "./TestHelper";
import path from "path";

// Helper to create a minimal metadata object
function meta(overrides: Partial<QueryPropertyMetaData> = {}): QueryPropertyMetaData {
  return {
    name: "col",
    typeName: "string",
    ...overrides,
  } as QueryPropertyMetaData;
}

describe("formatValue", () => {
  const cache: Record<string, string> = {};
  let db: UnifiedDb;
  let ecdb: ECDb;

  beforeAll(async () => {
    await ensureIModelHost();
    ecdb = new ECDb();
    ecdb.createDb(path.join(getTestDir(), "format-value-test.ecdb"));
    db = new UnifiedDb(ecdb);
  });

  afterAll(async () => {
    db[Symbol.dispose]();
    cleanupTestDir();
    await shutdownIModelHost();
  });

  it("returns empty string for null", async () => {
    const result = await formatValue(null, meta(), db, cache);
    expect(result.value).toBe("");
  });

  it("returns empty string for undefined", async () => {
    const result = await formatValue(undefined, meta(), db, cache);
    expect(result.value).toBe("");
  });

  it("returns string values as-is", async () => {
    const result = await formatValue("hello world", meta(), db, cache);
    expect(result.value).toBe("hello world");
  });

  it("pretty-prints JSON strings", async () => {
    const jsonStr = '{"key":"value","nested":{"a":1}}';
    const result = await formatValue(jsonStr, meta({ extendedType: "json" }), db, cache);
    expect(result.value).toContain('"key": "value"');
    expect(result.detectedType).toBe("json");
  });

  it("returns plain string when JSON parse fails", async () => {
    const result = await formatValue("{not-valid-json", meta({ extendedType: "json" }), db, cache);
    expect(result.value).toBe("{not-valid-json");
  });

  it("formats numbers as strings", async () => {
    const result = await formatValue(42, meta({ typeName: "int" }), db, cache);
    expect(result.value).toBe("42");
  });

  it("formats booleans as strings", async () => {
    const result = await formatValue(true, meta({ typeName: "boolean" }), db, cache);
    expect(result.value).toBe("true");
  });

  it("formats arrays with Promise.all", async () => {
    const result = await formatValue([1, 2, 3], meta({ typeName: "int" }), db, cache);
    expect(result.value).toBe("[1, 2, 3]");
  });

  it("formats navigation values with Id and RelECClassId", async () => {
    // We can't resolve class names from a bare ECDb since it has no meta schema,
    // but we can test the structural handling
    const nav = { Id: "0x1", RelECClassId: "0x100" };
    const result = await formatValue(nav, meta({ typeName: "navigation" }), db, cache);
    // Should contain the Id at minimum
    expect(result.value).toContain("0x1");
  });

  it("handles empty navigation value", async () => {
    const nav = { Id: "", RelECClassId: "" };
    const result = await formatValue(nav, meta({ typeName: "navigation" }), db, cache);
    expect(result.value).toBe("");
  });

  it("JSON-stringifies unknown object types", async () => {
    const obj = { custom: "data", count: 5 };
    const result = await formatValue(obj, meta({ typeName: "struct" }), db, cache);
    expect(result.value).toContain('"custom"');
    expect(result.value).toContain('"data"');
  });

  it("detects JSON in string columns", async () => {
    const jsonStr = '{"foo":"bar"}';
    // typeName=string, no extendedType - should still detect JSON
    const result = await formatValue(jsonStr, meta({ typeName: "string" }), db, cache);
    expect(result.value).toContain('"foo": "bar"');
    expect(result.detectedType).toBe("json");
  });
});
