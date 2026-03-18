import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { readCommandHistory, saveCommandHistory, loadContext, detectFiles, getFileContextFolderPath, type Context } from "../src/Context";
import fs from "fs";
import os from "os";
import path from "path";
import { ensureIModelHost, shutdownIModelHost } from "./TestHelper";
import { StandaloneDb } from "@itwin/core-backend";

describe("CommandHistory persistence", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "melodi-ctx-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("round-trips command history through save and read", async () => {
    const ctx: Context = {
      folders: { configDir: tempDir, cacheDir: tempDir, rootDir: tempDir },
      commandCache: {
        melodiVersion: "1.0.0-test",
        ecsqlHistory: ["SELECT 1", "SELECT 2"],
        sqliteHistory: ["PRAGMA integrity_check"],
      },
      userConfig: { melodiVersion: "1.0.0-test" },
      envManager: {} as Context["envManager"],
    };

    await saveCommandHistory(ctx);
    const filePath = path.join(tempDir, "commandHistory.json");
    expect(fs.existsSync(filePath)).toBe(true);

    const loaded = await readCommandHistory(filePath);
    expect(loaded.ecsqlHistory).toEqual(["SELECT 1", "SELECT 2"]);
    expect(loaded.sqliteHistory).toEqual(["PRAGMA integrity_check"]);
  });

  it("handles missing optional history fields gracefully", async () => {
    const filePath = path.join(tempDir, "commandHistory.json");
    fs.writeFileSync(filePath, JSON.stringify({ melodiVersion: "1.0.0" }));

    const loaded = await readCommandHistory(filePath);
    expect(loaded.melodiVersion).toBe("1.0.0");
    expect(loaded.ecsqlHistory).toBeUndefined();
    expect(loaded.sqliteHistory).toBeUndefined();
  });

  it("rejects invalid command history JSON", async () => {
    const filePath = path.join(tempDir, "commandHistory.json");
    fs.writeFileSync(filePath, JSON.stringify({ notAValidField: true }));

    await expect(readCommandHistory(filePath)).rejects.toThrow();
  });
});

describe("loadContext", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "melodi-loadctx-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns a fresh context with empty history when no history file exists", async () => {
    const ctx = await loadContext({ melodiVersion: "1.0.0" }, {
      configDir: tempDir,
      cacheDir: tempDir,
      rootDir: tempDir,
    });
    expect(ctx.commandCache.ecsqlHistory).toEqual([]);
    expect(ctx.folders.rootDir).toBe(tempDir);
  });

  it("loads existing history when history file is present", async () => {
    const historyPath = path.join(tempDir, "commandHistory.json");
    fs.writeFileSync(historyPath, JSON.stringify({
      melodiVersion: "1.0.0",
      ecsqlHistory: ["SELECT ECInstanceId FROM bis.Element"],
    }));

    const ctx = await loadContext({ melodiVersion: "1.0.0" }, {
      configDir: tempDir,
      cacheDir: tempDir,
      rootDir: tempDir,
    });
    expect(ctx.commandCache.ecsqlHistory).toEqual(["SELECT ECInstanceId FROM bis.Element"]);
  });

  it("throws when rootDir does not exist", async () => {
    await expect(loadContext({ melodiVersion: "1.0.0" }, {
      configDir: tempDir,
      cacheDir: tempDir,
      rootDir: path.join(tempDir, "does-not-exist"),
    })).rejects.toThrow("not accessible");
  });
});

describe("getFileContextFolderPath", () => {
  it("returns a sibling folder with _extras suffix", () => {
    const result = getFileContextFolderPath("/root", "models/sample.bim");
    expect(result).toBe(path.join("/root", "models", "sample_extras"));
  });

  it("handles files in the root directly", () => {
    const result = getFileContextFolderPath("/workspace", "mydb.ecdb");
    expect(result).toBe(path.join("/workspace", "mydb_extras"));
  });
});

describe("detectFiles", () => {
  let tempDir: string;

  beforeAll(async () => {
    await ensureIModelHost();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "melodi-detect-"));
  });

  afterAll(async () => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    await shutdownIModelHost();
  });

  it("finds .bim files and populates workspace file list", async () => {
    const dbPath = path.join(tempDir, "detect-test.bim");
    const db = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "DetectTest" } });
    db.close();

    const ctx: Context = {
      folders: { configDir: tempDir, cacheDir: tempDir, rootDir: tempDir },
      commandCache: { melodiVersion: "1.0.0", ecsqlHistory: [] },
      userConfig: { melodiVersion: "1.0.0" },
      envManager: {} as Context["envManager"],
    };

    await detectFiles(ctx);

    expect(ctx.files).toBeDefined();
    expect(ctx.files!.some(f => f.relativePath.endsWith("detect-test.bim"))).toBe(true);
  });

  it("populates bisCoreVersion for a StandaloneDb", async () => {
    const dbPath = path.join(tempDir, "detect-bis.bim");
    const db = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "BisTest" } });
    db.close();

    const ctx: Context = {
      folders: { configDir: tempDir, cacheDir: tempDir, rootDir: tempDir },
      commandCache: { melodiVersion: "1.0.0", ecsqlHistory: [] },
      userConfig: { melodiVersion: "1.0.0" },
      envManager: {} as Context["envManager"],
    };

    await detectFiles(ctx);

    const file = ctx.files?.find(f => f.relativePath.endsWith("detect-bis.bim"));
    expect(file).toBeDefined();
    expect(file!.bisCoreVersion).toBeDefined();
    expect(file!.bisCoreVersion!.major).toBeGreaterThan(0);
  });

  it("returns empty list when no db files are present", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "melodi-empty-"));
    try {
      const ctx: Context = {
        folders: { configDir: emptyDir, cacheDir: emptyDir, rootDir: emptyDir },
        commandCache: { melodiVersion: "1.0.0", ecsqlHistory: [] },
        userConfig: { melodiVersion: "1.0.0" },
        envManager: {} as Context["envManager"],
      };

      await detectFiles(ctx);
      expect(ctx.files).toEqual([]);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });
});
