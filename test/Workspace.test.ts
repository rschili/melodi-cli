import path from 'path';
import { test, expect, beforeAll, afterAll } from 'vitest';
import { detectFiles, loadWorkspace } from '../src/Context';
import { IModelHost } from "@itwin/core-backend";

beforeAll(async () => {
  await IModelHost.startup({});
});

afterAll(async () => {
  await IModelHost.shutdown();
});

test('processes input file', async () => {
  const testWorkspacePath = path.resolve(__dirname, 'test-workspace');

  const ws = await loadWorkspace({melodiVersion: "1.0.0"}, testWorkspacePath);
  expect(ws).toBeDefined();
  expect(ws.workspaceRootPath).toBe(testWorkspacePath);
  expect(ws.files).toBeUndefined();
  expect(ws.commandCache).toBeDefined();
  expect(ws.commandCache!.melodiVersion).toEqual("0.9.1");

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
