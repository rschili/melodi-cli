import path from "path";
import { Context, WorkspaceFile } from "../Context";
import { isCancel, spinner, text } from "@clack/prompts";
import fs from "node:fs/promises";
import * as fsSync from 'fs';
import { getBackupPaths, getDefaultBackupName, validateBackupTarget } from "./BackupOps";

export class Backup {
    public static async run(ctx: Context, file: WorkspaceFile): Promise<void> {
        const targetName = await text({
            message: "Enter a name for the backup (without extension):",
            initialValue: getDefaultBackupName(file),
        });
        if (isCancel(targetName)) {
            return; // User cancelled the prompt
        }

        const paths = getBackupPaths(ctx, file, targetName);
        const validation = validateBackupTarget(paths);
        if (!validation.valid) {
            console.log(validation.reason);
            await Backup.run(ctx, file);
            return;
        }

        await this.copyFile(paths.sourceFilePath, paths.targetFilePath);
        if (fsSync.existsSync(paths.sourceContextDirPath)) {
            await this.copyDirectoryRecursive(paths.sourceContextDirPath, paths.targetContextDirPath);
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