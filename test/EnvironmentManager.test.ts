import { describe, it, expect } from "vitest";
import { Environment, EnvironmentManager } from "../src/EnvironmentManager";

// Helper to access/set private fields without `any` casts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Writable<T> = { -readonly [P in keyof T]: T[P] } & Record<string, any>;
function asWritable(mgr: EnvironmentManager): Writable<EnvironmentManager> {
  return mgr as Writable<EnvironmentManager>;
}

describe("EnvironmentManager", () => {
  describe("constructor and getters", () => {
    it("defaults to PROD environment", () => {
      const mgr = new EnvironmentManager("/tmp/cache");
      expect(mgr.currentEnvironment).toBe(Environment.PROD);
    });

    it("returns cacheDirectory from constructor", () => {
      const mgr = new EnvironmentManager("/my/cache/dir");
      expect(mgr.cacheDirectory).toBe("/my/cache/dir");
    });
  });

  describe("authority", () => {
    it("returns PROD authority URL by default", () => {
      const mgr = new EnvironmentManager("/tmp");
      expect(mgr.authority).toBe("https://ims.bentley.com/");
    });

    it("returns QA authority URL when set to QA", () => {
      const mgr = new EnvironmentManager("/tmp");
      asWritable(mgr)._currentEnvironment = Environment.QA;
      expect(mgr.authority).toBe("https://qa-ims.bentley.com/");
    });

    it("throws for unknown environment", () => {
      const mgr = new EnvironmentManager("/tmp");
      asWritable(mgr)._currentEnvironment = "UNKNOWN";
      expect(() => mgr.authority).toThrow("Unknown environment");
    });
  });

  describe("clientId", () => {
    it("returns PROD client ID by default", () => {
      const mgr = new EnvironmentManager("/tmp");
      expect(mgr.clientId).toContain("native-");
    });

    it("returns different client ID for QA", () => {
      const mgr = new EnvironmentManager("/tmp");
      const prodId = mgr.clientId;
      asWritable(mgr)._currentEnvironment = Environment.QA;
      const qaId = mgr.clientId;
      expect(qaId).toContain("native-");
      expect(qaId).not.toBe(prodId);
    });

    it("throws for unknown environment", () => {
      const mgr = new EnvironmentManager("/tmp");
      asWritable(mgr)._currentEnvironment = "BOGUS";
      expect(() => mgr.clientId).toThrow("Unknown environment");
    });
  });

  describe("getAccessToken", () => {
    it("throws when auth client is not initialized", async () => {
      const mgr = new EnvironmentManager("/tmp");
      await expect(mgr.getAccessToken()).rejects.toThrow("Authorization client is not initialized");
    });
  });

  describe("getAuthorization", () => {
    it("throws when auth client is not initialized", async () => {
      const mgr = new EnvironmentManager("/tmp");
      await expect(mgr.getAuthorization()).rejects.toThrow("Authorization client is not initialized");
    });
  });

  describe("shutdown when not started", () => {
    it("is a no-op when not started up", async () => {
      const mgr = new EnvironmentManager("/tmp");
      await mgr.shutdown();
    });
  });

  describe("selectEnvironment", () => {
    it("is a no-op when selecting the current environment", async () => {
      const mgr = new EnvironmentManager("/tmp");
      await mgr.selectEnvironment(Environment.PROD);
      expect(mgr.currentEnvironment).toBe(Environment.PROD);
    });
  });

  describe("startup idempotency", () => {
    it("skips startup when already started", async () => {
      const mgr = new EnvironmentManager("/tmp");
      asWritable(mgr)._isStartedUp = true;
      await mgr.startup();
      expect(asWritable(mgr)._isStartedUp).toBe(true);
    });
  });
});
