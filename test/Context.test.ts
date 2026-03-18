import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readCommandHistory, saveCommandHistory, type Context } from "../src/Context";
import fs from "fs";
import os from "os";
import path from "path";

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
