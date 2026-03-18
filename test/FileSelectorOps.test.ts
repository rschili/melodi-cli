import { describe, it, expect } from "vitest";
import semver from "semver";
import { getSchemaVersionString, getFileDescription, padFileChoiceLabels } from "../src/Logic/FileSelectorOps";
import type { SchemaVersion, WorkspaceFile } from "../src/Context";

describe("FileSelectorOps", () => {
  it("formats schema version string", () => {
    const version: SchemaVersion = { major: 4, minor: 0, sub1: 0, sub2: 2 };
    expect(getSchemaVersionString(version)).toBe("4.0.0.2");
  });

  it("builds file description for briefcase file", () => {
    const file: WorkspaceFile = {
      relativePath: "sample.bim",
      lastTouched: new Date(),
      hasITwinId: true,
      bisCoreVersion: semver.parse("1.0.0")!,
      ecDbVersion: { major: 4, minor: 0, sub1: 0, sub2: 1 },
      elements: 123,
      parentChangeSetId: "abc",
    };
    const desc = getFileDescription(file);

    expect(desc).toContain("Briefcase");
    expect(desc).toContain("ECDb");
    expect(desc).toContain("BisCore");
    expect(desc).toContain("Elements:");
    expect(desc).toContain("ChangeSet:");
  });

  it("pads labels with age text", () => {
    const now = new Date("2026-01-01T00:00:00.000Z").getTime();
    const choices: Array<{ label: string; value: WorkspaceFile }> = [
      { label: "a.bim", value: { relativePath: "a.bim", lastTouched: new Date(now - 5_000), hasITwinId: false } },
      { label: "long-name-file.ecdb", value: { relativePath: "long-name-file.ecdb", lastTouched: new Date(now - 60_000), hasITwinId: false } },
    ];

    const out = padFileChoiceLabels(choices, now);
    expect(out[0].label).toContain("ago");
    expect(out[1].label).toContain("ago");
  });
});
