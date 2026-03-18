import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

// Mock axios before importing the module
vi.mock("axios", () => {
  return {
    default: {
      get: vi.fn(),
    },
  };
});

import axios from "axios";
import { loadSchemaInventory } from "../src/GithubBisSchemasHelper";

describe("GithubBisSchemasHelper", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "melodi-schemas-test-"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("fetches and parses schema inventory from network", async () => {
    const mockInventory = {
      BisCore: [
        { name: "BisCore", version: "1.0.16", released: true },
        { name: "BisCore", version: "1.0.17", released: true, path: "Schemas/BisCore" },
      ],
    };

    vi.mocked(axios.get).mockResolvedValue({
      status: 200,
      data: JSON.stringify(mockInventory),
      headers: { etag: '"abc123"' },
    });

    const result = await loadSchemaInventory(tempDir);
    expect(result).toBeDefined();
    expect(result.BisCore).toHaveLength(2);
    expect(result.BisCore[0].name).toBe("BisCore");
    expect(result.BisCore[0].released).toBe(true);
  });

  it("uses cached content on 304 response", async () => {
    // Pre-populate cache
    const cacheFile = path.join(tempDir, "SchemaInventory.json");
    const cachedInventory = { Cached: [{ name: "Cached", version: "1.0.0", released: true }] };
    fs.writeFileSync(cacheFile, JSON.stringify(cachedInventory));

    // Write etag cache
    const etagFile = path.join(tempDir, "etag.json");
    const inventoryUrl = "https://raw.githubusercontent.com/iTwin/bis-schemas/refs/heads/master/SchemaInventory.json";
    fs.writeFileSync(etagFile, JSON.stringify({ [inventoryUrl]: '"cached-etag"' }));

    vi.mocked(axios.get).mockResolvedValue({
      status: 304,
      data: "",
      headers: {},
    });

    const result = await loadSchemaInventory(tempDir);
    expect(result).toBeDefined();
    expect(result.Cached).toHaveLength(1);
    expect(result.Cached[0].name).toBe("Cached");
  });
});
