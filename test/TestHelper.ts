import { IModelHost } from "@itwin/core-backend";
import fs from "fs";
import os from "os";
import path from "path";

let testDir: string | undefined;

/**
 * Shared test infrastructure for melodi-cli tests.
 *
 * - `setupTestDir()` creates a temp dir for test output, returns it. Call in beforeAll/beforeEach.
 * - `cleanupTestDir()` removes it. Call in afterAll/afterEach.
 * - `ensureIModelHost()` starts IModelHost once (idempotent). Needed for any test that touches ECDb/IModelDb.
 * - `shutdownIModelHost()` stops it. Call in afterAll of integration suites.
 */
export function getTestDir(): string {
  if (!testDir) {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "melodi-test-"));
  }
  return testDir;
}

export function cleanupTestDir(): void {
  if (testDir) {
    fs.rmSync(testDir, { recursive: true, force: true });
    testDir = undefined;
  }
}

export async function ensureIModelHost(): Promise<void> {
  if (IModelHost.isValid)
    return;
  await IModelHost.startup({ cacheDir: getTestDir() });
}

export async function shutdownIModelHost(): Promise<void> {
  if (IModelHost.isValid)
    await IModelHost.shutdown();
}
