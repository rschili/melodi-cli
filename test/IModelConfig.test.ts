import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readIModelConfig, saveIModelConfig, type IModelConfig } from "../src/IModelConfig";
import { type Context } from "../src/Context";
import { Environment } from "../src/EnvironmentManager";
import fs from "fs";
import os from "os";
import path from "path";

function makeCtx(rootDir: string): Context {
  return {
    folders: { rootDir, cacheDir: rootDir, configDir: rootDir },
    commandCache: { melodiVersion: "1.0.0" },
    userConfig: { melodiVersion: "1.0.0" },
    envManager: {} as Context["envManager"],
  };
}

describe("IModelConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "melodi-imodelcfg-test-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns undefined when no config exists", async () => {
    const ctx = makeCtx(tempDir);
    const cfg = await readIModelConfig(ctx, "some/imodel.bim");
    expect(cfg).toBeUndefined();
  });

  it("round-trips save and read", async () => {
    const ctx = makeCtx(tempDir);
    const config: IModelConfig = {
      melodiVersion: "1.0.0",
      iModelId: "abc-123",
      iTwinId: "twin-456",
      environment: Environment.PROD,
      displayName: "Test iModel",
    };

    await saveIModelConfig(ctx, "my/imodel.bim", config);
    const loaded = await readIModelConfig(ctx, "my/imodel.bim");
    expect(loaded).toBeDefined();
    expect(loaded!.iModelId).toBe("abc-123");
    expect(loaded!.iTwinId).toBe("twin-456");
    expect(loaded!.displayName).toBe("Test iModel");
    expect(loaded!.environment).toBe(Environment.PROD);
  });

  it("returns undefined for corrupted config file", async () => {
    const ctx = makeCtx(tempDir);
    // Create the context dir and write garbage
    const contextDir = path.join(tempDir, ".melodi-context", "test.bim");
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(path.join(contextDir, "config.json"), "not-json");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const cfg = await readIModelConfig(ctx, "test.bim");
    expect(cfg).toBeUndefined();
    spy.mockRestore();
  });
});
