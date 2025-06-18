import fs from 'fs-extra';
import path from 'path';
import { test, expect } from 'vitest';
import { detectWorkspaceFiles, FileType, loadWorkspace } from '../src/Workspace';

test('processes input file', async () => {
  const testWorkspacePath = path.resolve(__dirname, 'test-workspace');

  const ws = await loadWorkspace(testWorkspacePath);
  expect(ws).toBeDefined();
  expect(ws.workspaceRootPath).toBe(testWorkspacePath);
  expect(ws.files).toBeUndefined();
  expect(ws.config).toBeDefined();
  expect(ws.config!.melodiVersion).toEqual("0.9.1");

  await detectWorkspaceFiles(ws);
  expect(ws.files).toBeDefined();
  expect(ws.files!.length).toBeGreaterThan(0);
  const expectedFiles = [
    { relativePath: 'ecdb.ecdb', fileType: FileType.ECDB },
    { relativePath: 'ecdb2.eCdB', fileType: FileType.ECDB },
    { relativePath: 'standalone.bim', fileType: FileType.STANDALONE },
    { relativePath: 'subfolder/briefcase.bim', fileType: FileType.BRIEFCASE },
    { relativePath: 'subfolder/standalone2.bim', fileType: FileType.STANDALONE },
  ];
  expect(ws.files).toEqual(expect.arrayContaining(expectedFiles));
});
