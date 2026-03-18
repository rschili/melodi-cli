import { describe, it, expect } from "vitest";
import semver from "semver";
import { stripLeadingZeros, buildSchemaInfoMap, buildSchemaTableRows } from "../src/Logic/SchemaEditorOps";

describe("SchemaEditorOps", () => {
  it("strips leading zeros in version strings", () => {
    expect(stripLeadingZeros("01.00.03")).toBe("1.0.3");
    expect(stripLeadingZeros("1.2.3")).toBe("1.2.3");
  });

  it("builds schema info map with latest versions", () => {
    const map = buildSchemaInfoMap(
      [{ name: "BisCore", versionMajor: 1, versionWrite: 0, versionMinor: 0 }],
      {
        BisCore: [
          { name: "BisCore", version: "01.00.01", released: true, path: "a" },
          { name: "BisCore", version: "01.00.05", released: true, path: "b" },
        ],
      }
    );

    expect(map.BisCore.version?.toString()).toBe("1.0.0");
    expect(map.BisCore.latestVersion?.toString()).toBe("1.0.5");
    expect(map.BisCore.path).toBe("b");
  });

  it("builds schema table rows with statuses", () => {
    const rows = buildSchemaTableRows({
      A: {
        name: "A",
        version: semver.parse("1.0.0") ?? undefined,
        latestVersion: semver.parse("1.0.0") ?? undefined,
      },
      B: {
        name: "B",
        version: semver.parse("1.0.0") ?? undefined,
        latestVersion: semver.parse("1.0.1") ?? undefined,
      },
    });

    const a = rows.find(r => r.name === "A");
    const b = rows.find(r => r.name === "B");
    expect(a?.status).toBe("up-to-date");
    expect(b?.status).toBe("update-available");
  });

  it("buildSchemaTableRows marks 'ahead' when DB version is newer", () => {
    const rows = buildSchemaTableRows({
      X: {
        name: "X",
        version: semver.parse("2.0.0") ?? undefined,
        latestVersion: semver.parse("1.0.0") ?? undefined,
      },
    });
    expect(rows[0].status).toBe("ahead");
  });

  it("buildSchemaTableRows skips schemas without a DB version", () => {
    const rows = buildSchemaTableRows({
      OnlyAvailable: {
        name: "OnlyAvailable",
        latestVersion: semver.parse("1.0.0") ?? undefined,
      },
    });
    expect(rows).toHaveLength(0);
  });

  it("buildSchemaTableRows shows empty latestVersion when no inventory match", () => {
    const rows = buildSchemaTableRows({
      Custom: {
        name: "Custom",
        version: semver.parse("1.0.0") ?? undefined,
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].latestVersion).toBe("");
    expect(rows[0].status).toBe("not-in-db");
  });

  it("buildSchemaInfoMap skips DB rows with unparseable versions", () => {
    const map = buildSchemaInfoMap(
      [{ name: "Bad", versionMajor: -1, versionWrite: 0, versionMinor: 0 }],
      {}
    );
    expect(map.Bad).toBeUndefined();
  });

  it("buildSchemaInfoMap skips unreleased or pathless inventory entries", () => {
    const map = buildSchemaInfoMap(
      [{ name: "A", versionMajor: 1, versionWrite: 0, versionMinor: 0 }],
      {
        A: [
          { name: "A", version: "1.0.1", released: false, path: "x" },
          { name: "A", version: "1.0.2", released: true },
        ],
      }
    );
    expect(map.A.latestVersion).toBeUndefined();
  });

  it("buildSchemaInfoMap skips inventory entries where name doesn't match outer key", () => {
    const map = buildSchemaInfoMap(
      [{ name: "A", versionMajor: 1, versionWrite: 0, versionMinor: 0 }],
      {
        A: [
          { name: "B", version: "1.0.1", released: true, path: "y" },
        ],
      }
    );
    expect(map.A.latestVersion).toBeUndefined();
  });

  it("buildSchemaInfoMap adds inventory-only schemas not present in DB", () => {
    const map = buildSchemaInfoMap(
      [],
      {
        NewSchema: [
          { name: "NewSchema", version: "2.0.0", released: true, path: "/schemas/new" },
        ],
      }
    );
    expect(map.NewSchema).toBeDefined();
    expect(map.NewSchema.version).toBeUndefined();
    expect(map.NewSchema.latestVersion?.toString()).toBe("2.0.0");
    expect(map.NewSchema.path).toBe("/schemas/new");
  });

  it("buildSchemaInfoMap picks the highest released version from inventory", () => {
    const map = buildSchemaInfoMap(
      [{ name: "S", versionMajor: 1, versionWrite: 0, versionMinor: 0 }],
      {
        S: [
          { name: "S", version: "1.0.3", released: true, path: "p3" },
          { name: "S", version: "1.0.1", released: true, path: "p1" },
          { name: "S", version: "1.0.5", released: true, path: "p5" },
          { name: "S", version: "1.0.2", released: true, path: "p2" },
        ],
      }
    );
    expect(map.S.latestVersion?.toString()).toBe("1.0.5");
    expect(map.S.path).toBe("p5");
  });

  it("stripLeadingZeros handles edge cases", () => {
    expect(stripLeadingZeros("00.00.00")).toBe("0.0.0");
    expect(stripLeadingZeros("10.20.30")).toBe("10.20.30");
    expect(stripLeadingZeros("01.02.03")).toBe("1.2.3");
  });
});
