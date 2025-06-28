import path from "path";
import { getFileContextFolderPath, Workspace, WorkspaceFile } from "../Workspace";
import { isCancel, text } from "@clack/prompts";
import Progress from "ts-progress";
import fs from "node:fs/promises";
import * as fsSync from 'fs';

export class Backup {
    public static async run(ws: Workspace, file: WorkspaceFile): Promise<void> {
        const absolutePath = path.join(ws.workspaceRootPath, file.relativePath);
        const contextDirPath = getFileContextFolderPath(ws.workspaceRootPath, file.relativePath);
        const ext = path.extname(file.relativePath);
        const relativePathWithoutExt = file.relativePath.slice(0, -ext.length);

        const targetName = await text({
            message: "Enter a name for the backup (without extension):",
            initialValue: relativePathWithoutExt + "_backup"
        });
        if (isCancel(targetName)) {
            return; // User cancelled the prompt
        }
        let targetWithExt = targetName.trim();
        if (!targetWithExt.endsWith(ext)) {
            targetWithExt += ext;
        }
        const targetPath = path.join(ws.workspaceRootPath, targetWithExt);
        const targetContextDirPath = getFileContextFolderPath(ws.workspaceRootPath, targetWithExt);

        const targetExists = fsSync.existsSync(targetPath);
        const contextDirExists = fsSync.existsSync(targetContextDirPath);
        if (targetExists || contextDirExists) {
            console.log("Backup file or its context directory already exists. Please choose a different name.");
            await Backup.run(ws, file);
            return;
        }

        await this.copyFile(absolutePath, targetPath);
        if (fsSync.existsSync(contextDirPath)) {
            await this.copyDirectoryRecursive(contextDirPath, targetContextDirPath);
        }
    }

    private static async copyFile(sourcePath: string, targetPath: string): Promise<void> {
        let progress: Progress.Progress | undefined;
        try {
            progress = Progress.create({
                total: 100, updateFrequency: 150,
                pattern: 'Progress: {current}/{total} | Remaining: {remaining} | Elapsed: {elapsed} ', textColor: 'blue'
            });
        } finally {
            progress?.done();
        }
    }

    private static async copyDirectoryRecursive(sourceDir: string, targetDir: string): Promise<void> {
        let progress: Progress.Progress | undefined;
        try {
            progress = Progress.create({
                total: 100, updateFrequency: 150,
                pattern: 'Progress: {current}/{total} | Remaining: {remaining} | Elapsed: {elapsed} ', textColor: 'blue'
            });
        } finally {
            progress?.done();
        }
    }
}