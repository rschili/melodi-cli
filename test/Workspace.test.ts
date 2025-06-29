import path from 'path';
import { test, expect } from 'vitest';
import { detectWorkspaceFiles, loadWorkspace } from '../src/Workspace';

test('processes input file', async () => {
  const testWorkspacePath = path.resolve(__dirname, 'test-workspace');

  const ws = await loadWorkspace({melodiVersion: "1.0.0"}, testWorkspacePath);
  expect(ws).toBeDefined();
  expect(ws.workspaceRootPath).toBe(testWorkspacePath);
  expect(ws.files).toBeUndefined();
  expect(ws.config).toBeDefined();
  expect(ws.config!.melodiVersion).toEqual("0.9.1");

  await detectWorkspaceFiles(ws);
  expect(ws.files).toBeDefined();
  expect(ws.files!.length).toBeGreaterThan(0);
  const expectedFiles = [
    { relativePath: 'ecdb.ecdb' },
    { relativePath: 'ecdb2.eCdB' },
    { relativePath: 'standalone.bim' },
    { relativePath: 'subfolder/briefcase.bim' },
    { relativePath: 'subfolder/standalone2.bim' },
  ];
  expect(ws.files).toEqual(expect.arrayContaining(expectedFiles));
});
