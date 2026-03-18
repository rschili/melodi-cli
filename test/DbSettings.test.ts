import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ECDb, StandaloneDb } from "@itwin/core-backend";
import { DbSettings } from "../src/Logic/DbSettings";
import { UnifiedDb } from "../src/UnifiedDb";
import { ensureIModelHost, getTestDir, cleanupTestDir, shutdownIModelHost } from "./TestHelper";
import path from "path";

describe("DbSettings", () => {
  beforeAll(async () => {
    await ensureIModelHost();
  });

  afterAll(async () => {
    cleanupTestDir();
    await shutdownIModelHost();
  });

  it("reads experimental features flag from ECDb", async () => {
    const ecdb = new ECDb();
    ecdb.createDb(path.join(getTestDir(), "settings-ecdb.ecdb"));
    using db = new UnifiedDb(ecdb);
    // Default should be false
    const enabled = await DbSettings.getExperimentalFeaturesEnabled(db);
    expect(enabled).toBe(false);
  });

  it("toggles experimental features on ECDb", async () => {
    const ecdb = new ECDb();
    ecdb.createDb(path.join(getTestDir(), "settings-toggle.ecdb"));
    using db = new UnifiedDb(ecdb);

    await DbSettings.setExperimentalFeaturesEnabled(db, true);
    expect(await DbSettings.getExperimentalFeaturesEnabled(db)).toBe(true);

    await DbSettings.setExperimentalFeaturesEnabled(db, false);
    expect(await DbSettings.getExperimentalFeaturesEnabled(db)).toBe(false);
  });

  it("reads experimental features from StandaloneDb", async () => {
    const dbPath = path.join(getTestDir(), "settings-standalone.bim");
    const imodel = StandaloneDb.createEmpty(dbPath, { rootSubject: { name: "Settings Test" } });
    using db = new UnifiedDb(imodel);

    const enabled = await DbSettings.getExperimentalFeaturesEnabled(db);
    expect(typeof enabled).toBe("boolean");
  });
});
