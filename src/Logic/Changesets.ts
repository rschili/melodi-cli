import fs from "node:fs/promises";
import path from "path";
import { z } from "zod/v4";
import { ContainingChanges, MinimalChangeset } from "@itwin/imodels-client-management";
import { getFileContextFolderPath, Context, WorkspaceFile } from "../Context";
import { DownloadedChangeset } from "@itwin/imodels-client-authoring";
import { existsSync, mkdirSync } from "node:fs";


export const ChangesetListSchema = z.array(z.object({
    id: z.string(),
    displayName: z.string(),
    index: z.number(),
    parentId: z.string(),
    pushDateTime: z.string(),
    containingChanges: z.enum(ContainingChanges),
    fileSize: z.number(),
    relativePath: z.string().optional(), // path relative to the 
}));

export type ChangesetList = z.infer<typeof ChangesetListSchema>;

export class Changesets {
    public static getChangesetsFolder(ctx: Context, file: WorkspaceFile): string {
        const contextFolder = getFileContextFolderPath(ctx.folders.rootDir, file.relativePath);
        const changesetsDir = path.join(contextFolder, "changesets");
        return changesetsDir;
    }

    public static getChangesetRelativePath(ctx: Context, file: WorkspaceFile, absolutePath: string): string {
        const changesetsDir = this.getChangesetsFolder(ctx, file);
        if (!absolutePath.startsWith(changesetsDir)) {
            throw new Error(`Absolute path ${absolutePath} does not start with changesets directory ${changesetsDir}`);
        }
        const relativePath = path.relative(changesetsDir, absolutePath);
        if (!relativePath) {
            throw new Error(`Could not determine relative path for ${absolutePath} in changesets directory ${changesetsDir}`);
        }
        return relativePath;
    }

    public static calculateOverallFileSize(changesets: MinimalChangeset[]): number {
        return changesets.reduce((total, changeset) => total + (changeset.fileSize || 0), 0);
    }

    public static downloadedChangesetsToChangesetList(ctx: Context, file: WorkspaceFile, downloadedChangesets: DownloadedChangeset[]): ChangesetList {
        const list: ChangesetList = [];
        for (const changeset of downloadedChangesets) {
            const relativePath = this.getChangesetRelativePath(ctx, file, changeset.filePath);
            list.push({
                id: changeset.id,
                displayName: changeset.displayName,
                index: changeset.index,
                parentId: changeset.parentId,
                pushDateTime: changeset.pushDateTime,
                containingChanges: changeset.containingChanges,
                fileSize: changeset.fileSize,
                relativePath: relativePath
            });
        }
        return list;
    }

    public static async readChangesetListFromFile(ctx: Context, file: WorkspaceFile): Promise<ChangesetList> {
        const changesetsDir = this.getChangesetsFolder(ctx, file);
        const changesetListFile = path.join(changesetsDir, "changeset-list.json");
        if (!existsSync(changesetListFile)) {
            return [];
        }
        const content = await fs.readFile(changesetListFile, 'utf-8');
        try {
            return ChangesetListSchema.parse(JSON.parse(content));
        } catch (error) {
            throw new Error(`Failed to parse changeset list from file ${changesetListFile}: ${error}`);
        }
    }

    public static async writeChangesetListToFile(ctx: Context, file: WorkspaceFile, changesetList: ChangesetList): Promise<void> {
        const changesetsDir = this.getChangesetsFolder(ctx, file);
        if (!existsSync(changesetsDir)) {
            mkdirSync(changesetsDir, { recursive: true });
        }
        const changesetListFile = path.join(changesetsDir, "changeset-list.json");
        await fs.writeFile(changesetListFile, JSON.stringify(changesetList, null, 2), 'utf-8');
    }

    public static async downloadChangesets(ctx: Context, file: WorkspaceFile, iModelId: string): Promise<void> {
        const changesetsDir = this.getChangesetsFolder(ctx, file);
        if (!existsSync(changesetsDir)) {
            mkdirSync(changesetsDir, { recursive: true });
        }
        if (!existsSync(changesetsDir)) {
            // Ensure the directory exists
            await fs.mkdir(changesetsDir, { recursive: true });
        }

        const downloaded = await ctx.envManager.iModelsClient.changesets.downloadList({
            authorization: () => ctx.envManager.getAuthorization(),
            iModelId,
            targetDirectoryPath: changesetsDir
        });

        const cacheList = Changesets.downloadedChangesetsToChangesetList(ctx, file, downloaded);
        await Changesets.writeChangesetListToFile(ctx, file, cacheList)
    }
}