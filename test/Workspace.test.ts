import path from 'path';
import { test, expect, beforeAll, afterAll } from 'vitest';
import { detectFiles, loadContext } from '../src/Context';
import { IModelHost } from "@itwin/core-backend";
import { getCacheDir, getConfigDir } from "../src/SystemFolders";

beforeAll(async () => {
  await IModelHost.startup({});
});

afterAll(async () => {
  await IModelHost.shutdown();
});

test('processes input file', async () => {
  const testWorkspacePath = path.resolve(__dirname, 'test-workspace');
  const folders = {
    rootDir: testWorkspacePath,
    cacheDir: getCacheDir(),
    configDir: getConfigDir(),
  };

  const ws = await loadContext({melodiVersion: "1.0.0"}, folders);
  expect(ws).toBeDefined();
  expect(ws.folders.rootDir).toBe(testWorkspacePath);
  expect(ws.files).toBeUndefined();
  expect(ws.commandCache).toBeDefined();

  await detectFiles(ws);
  expect(ws.files).toBeDefined();
  expect(ws.files!.length).toBeGreaterThan(0);
  const expectedFiles = [
    { relativePath: 'ecdb.ecdb' },
    { relativePath: 'ecdb2.eCdB' },
    { relativePath: 'standalone.bim' },
    { relativePath: 'subfolder/briefcase.bim' },
    { relativePath: 'subfolder/standalone2.bim' },
  ];
  // Compare only the relativePath property, ignoring others like lastTouched
  const actualRelativePaths = ws.files!.map(f => ({ relativePath: f.relativePath }));
  expect(actualRelativePaths).toEqual(expect.arrayContaining(expectedFiles));
});
