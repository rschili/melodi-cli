import path from "path";
import { getFileContextFolderPath, Context, WorkspaceFile } from "../Context";
import * as fsSync from "fs";

export type BackupPaths = {
    sourceFilePath: string;
    sourceContextDirPath: string;
    targetFilePath: string;
    targetContextDirPath: string;
    extension: string;
};

export function getBackupPaths(ctx: Context, file: WorkspaceFile, targetName: string): BackupPaths {
    const sourceFilePath = path.join(ctx.folders.rootDir, file.relativePath);
    const sourceContextDirPath = getFileContextFolderPath(ctx.folders.rootDir, file.relativePath);
    const extension = path.extname(file.relativePath);

    let targetWithExt = targetName.trim();
    if (!targetWithExt.endsWith(extension))
        targetWithExt += extension;

    const targetFilePath = path.join(ctx.folders.rootDir, targetWithExt);
    const targetContextDirPath = getFileContextFolderPath(ctx.folders.rootDir, targetWithExt);

    return {
        sourceFilePath,
        sourceContextDirPath,
        targetFilePath,
        targetContextDirPath,
        extension,
    };
}

export function getDefaultBackupName(file: WorkspaceFile): string {
    const ext = path.extname(file.relativePath);
    const relativePathWithoutExt = file.relativePath.slice(0, -ext.length);
    return relativePathWithoutExt + "_backup";
}

export function validateBackupTarget(paths: BackupPaths): { valid: true } | { valid: false; reason: string } {
    const targetExists = fsSync.existsSync(paths.targetFilePath);
    const contextDirExists = fsSync.existsSync(paths.targetContextDirPath);
    if (targetExists || contextDirExists) {
        return {
            valid: false,
            reason: "Backup file or its context directory already exists. Please choose a different name.",
        };
    }

    return { valid: true };
}
