import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getBackupPaths, getDefaultBackupName, validateBackupTarget } from "../src/Logic/BackupOps";
import { getTestDir } from "./TestHelper";
import type { Context, WorkspaceFile } from "../src/Context";

describe("BackupOps", () => {
  const rootDir = getTestDir();
  const ctx = { folders: { rootDir } } as unknown as Context;
  const file = { relativePath: "models/a.bim" } as WorkspaceFile;

  it("builds default backup name", () => {
    expect(getDefaultBackupName(file)).toBe("models/a_backup");
  });

  it("builds backup paths and appends extension", () => {
    const paths = getBackupPaths(ctx, file, "models/a_copy");
    expect(paths.targetFilePath.endsWith(path.join("models", "a_copy.bim"))).toBe(true);
    expect(paths.targetContextDirPath).toContain("a_copy_extras");
  });

  it("validates non-existing target as valid", () => {
    const paths = getBackupPaths(ctx, file, "models/new_backup_name");
    const result = validateBackupTarget(paths);
    expect(result.valid).toBe(true);
  });

  it("validates existing target as invalid", () => {
    const paths = getBackupPaths(ctx, file, "models/existing_target");
    fs.mkdirSync(path.dirname(paths.targetFilePath), { recursive: true });
    fs.writeFileSync(paths.targetFilePath, "x", "utf-8");

    const result = validateBackupTarget(paths);
    expect(result.valid).toBe(false);

    fs.rmSync(paths.targetFilePath, { force: true });
  });
});
