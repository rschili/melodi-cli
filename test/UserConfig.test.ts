import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readUserConfig, saveUserConfig, LogLevel, type UserConfig } from "../src/UserConfig";
import fs from "fs";
import os from "os";
import path from "path";

describe("UserConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "melodi-userconfig-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns default config when no file exists", async () => {
    const cfg = await readUserConfig(tempDir);
    expect(cfg.melodiVersion).toBeDefined();
    expect(cfg.logging).toBe(LogLevel.None);
  });

  it("reads a valid config from disk", async () => {
    const configPath = path.join(tempDir, "config.json");
    const data: UserConfig = { melodiVersion: "1.0.0", logging: LogLevel.Warning };
    fs.writeFileSync(configPath, JSON.stringify(data));

    const cfg = await readUserConfig(tempDir);
    expect(cfg.melodiVersion).toBe("1.0.0");
    expect(cfg.logging).toBe(LogLevel.Warning);
  });

  it("returns default config on invalid JSON", async () => {
    const configPath = path.join(tempDir, "config.json");
    fs.writeFileSync(configPath, "not json at all");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cfg = await readUserConfig(tempDir);
    expect(cfg.logging).toBe(LogLevel.None);
    spy.mockRestore();
  });

  it("round-trips through save and read", async () => {
    const cfg: UserConfig = { melodiVersion: "2.0.0", logging: LogLevel.Info };
    await saveUserConfig(cfg, tempDir);

    const loaded = await readUserConfig(tempDir);
    expect(loaded.logging).toBe(LogLevel.Info);
  });

  it("throws when save directory is not accessible", async () => {
    const badDir = path.join(tempDir, "nonexistent");
    const cfg: UserConfig = { melodiVersion: "1.0.0" };
    await expect(saveUserConfig(cfg, badDir)).rejects.toThrow();
  });
});
