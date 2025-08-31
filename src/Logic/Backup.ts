import path from "path";
import { getFileContextFolderPath, Context, WorkspaceFile } from "../Context";
import { isCancel, spinner, text } from "@clack/prompts";
import fs from "node:fs/promises";
import * as fsSync from 'fs';

export class Backup {
    public static async run(ws: Context, file: WorkspaceFile): Promise<void> {
        const absolutePath = path.join(ws.folders.rootDir, file.relativePath);
        const contextDirPath = getFileContextFolderPath(ws.folders.rootDir, file.relativePath);
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
        const targetPath = path.join(ws.folders.rootDir, targetWithExt);
        const targetContextDirPath = getFileContextFolderPath(ws.folders.rootDir, targetWithExt);

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
        const loader = spinner();
        try {
            loader.start(`Copying file from ${sourcePath} to ${targetPath}`);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.copyFile(sourcePath, targetPath);
            loader.stop(`Copy successful`);
        } catch (error: unknown) {
            loader.stop(`Copying failed`);
            throw error;
        }
    }

    private static async copyDirectoryRecursive(sourceDir: string, targetDir: string): Promise<void> {
        const loader = spinner();
        try {
            loader.start(`Copying context directory from ${sourceDir} to ${targetDir}`);

            await fs.cp(sourceDir, targetDir, {
                recursive: true});

            loader.stop(`Context directory copy successful`);
        } catch (error: unknown) {
            loader.stop(`Copying failed`);
            throw error;
        }
    }
}