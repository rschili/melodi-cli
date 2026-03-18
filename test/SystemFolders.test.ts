import { describe, it, expect, vi, afterEach } from "vitest";

// We need to test the functions with controlled env vars, so we'll
// dynamically import after setting up the env.
describe("SystemFolders", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // restore env
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  async function importFresh() {
    // Force a fresh import so the module re-evaluates with current env
    return await import("../src/SystemFolders");
  }

  describe("getConfigDir", () => {
    it("respects MELODI_CONFIG env override", async () => {
      process.env.MELODI_CONFIG = "/custom/config/path";
      const { getConfigDir } = await importFresh();
      expect(getConfigDir()).toBe("/custom/config/path");
    });

    it("returns XDG-based path when no override", async () => {
      delete process.env.MELODI_CONFIG;
      const { getConfigDir } = await importFresh();
      const result = getConfigDir();
      expect(result).toContain("melodi");
      expect(result.length).toBeGreaterThan(5);
    });
  });

  describe("getCacheDir", () => {
    it("respects MELODI_CACHE env override", async () => {
      process.env.MELODI_CACHE = "/custom/cache/path";
      const { getCacheDir } = await importFresh();
      expect(getCacheDir()).toBe("/custom/cache/path");
    });

    it("returns XDG-based path when no override", async () => {
      delete process.env.MELODI_CACHE;
      const { getCacheDir } = await importFresh();
      const result = getCacheDir();
      expect(result).toContain("melodi");
    });
  });

  describe("getRootDir", () => {
    it("respects MELODI_ROOT env override", async () => {
      process.env.MELODI_ROOT = "/custom/root/path";
      const { getRootDir } = await importFresh();
      expect(getRootDir()).toBe("/custom/root/path");
    });

    it("returns Documents-based path when no override", async () => {
      delete process.env.MELODI_ROOT;
      const { getRootDir } = await importFresh();
      const result = getRootDir();
      expect(result).toContain("melodi");
    });
  });
});
