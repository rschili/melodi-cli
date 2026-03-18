import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  calculateOverallFileSize,
  getChangesetsFolder,
  getChangesetRelativePath,
  downloadedChangesetsToChangesetList,
  type ChangesetList,
  readChangesetListFromFile,
  writeChangesetListToFile,
} from "../src/Logic/ChangesetOps";
import { getTestDir } from "./TestHelper";
import type { Context, WorkspaceFile } from "../src/Context";
import type { DownloadedChangeset } from "@itwin/imodels-client-authoring";
import type { MinimalChangeset } from "@itwin/imodels-client-management";
import { ContainingChanges } from "@itwin/imodels-client-management";

describe("ChangesetOps", () => {
  const rootDir = getTestDir();
  const ctx = {
    folders: { rootDir },
  } as unknown as Context;
  const file = {
    relativePath: "models/sample.bim",
  } as WorkspaceFile;

  it("calculates overall file size", () => {
    const total = calculateOverallFileSize([
      { fileSize: 10 } as unknown as MinimalChangeset,
      { fileSize: 15 } as unknown as MinimalChangeset,
      { fileSize: undefined } as unknown as MinimalChangeset,
    ]);
    expect(total).toBe(25);
  });

  it("builds changesets folder path", () => {
    const folder = getChangesetsFolder(ctx, file);
    expect(folder).toContain("sample_extras");
    expect(folder).toContain("changesets");
  });

  it("builds relative changeset path", () => {
    const folder = getChangesetsFolder(ctx, file);
    const absolute = path.join(folder, "abc", "001.cs");
    const rel = getChangesetRelativePath(ctx, file, absolute);
    expect(rel).toBe(path.join("abc", "001.cs"));
  });

  it("throws if path is outside changeset folder", () => {
    expect(() => getChangesetRelativePath(ctx, file, "/tmp/nope.cs")).toThrow();
  });

  it("maps downloaded changesets to cache list", () => {
    const folder = getChangesetsFolder(ctx, file);
    const list = downloadedChangesetsToChangesetList(ctx, file, [
      {
        id: "1",
        displayName: "cs1",
        index: 1,
        parentId: "",
        pushDateTime: "2020-01-01",
        containingChanges: ContainingChanges.Regular,
        fileSize: 123,
        filePath: path.join(folder, "001.cs"),
      } as unknown as DownloadedChangeset,
    ]);

    expect(list).toHaveLength(1);
    expect(list[0].relativePath).toBe("001.cs");
  });

  it("writes and reads changeset list", async () => {
    const list = [
      {
        id: "1",
        displayName: "cs1",
        index: 1,
        parentId: "",
        pushDateTime: "2020-01-01",
        containingChanges: ContainingChanges.Regular,
        fileSize: 123,
        relativePath: "001.cs",
      },
    ] as unknown as ChangesetList;

    await writeChangesetListToFile(ctx, file, list);
    const readBack = await readChangesetListFromFile(ctx, file);
    expect(readBack).toEqual(list);

    const folder = getChangesetsFolder(ctx, file);
    await fs.rm(folder, { recursive: true, force: true });
  });
});
