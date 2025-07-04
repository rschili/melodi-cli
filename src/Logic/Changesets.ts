import * as fs from 'fs';
import path from "path";
import os from "os";
import { z } from "zod/v4";
import { globby } from 'globby';
import { ContainingChanges, MinimalChangeset } from "@itwin/imodels-client-management";
import { getFileContextFolderPath, Workspace, WorkspaceFile } from "../Workspace";
import { DownloadedChangeset } from "@itwin/imodels-client-authoring";


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
    public static getChangesetsFolder(ws: Workspace, file: WorkspaceFile): string {
        const contextFolder = getFileContextFolderPath(ws.workspaceRootPath, file.relativePath);
        const changesetsDir = path.join(contextFolder, "changesets");
        return changesetsDir;
    }

    public static getChangesetRelativePath(ws: Workspace, file: WorkspaceFile, absolutePath: string): string {
        const changesetsDir = this.getChangesetsFolder(ws, file);
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

    public static downloadedChangesetsToChangesetList(ws: Workspace, file: WorkspaceFile, downloadedChangesets: DownloadedChangeset[]): ChangesetList {
        const folder = this.getChangesetsFolder(ws, file);
        const list: ChangesetList = [];
        for (const changeset of downloadedChangesets) {
            const relativePath = this.getChangesetRelativePath(ws, file, changeset.filePath);
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

    public static async readChangesetListFromFile(ws: Workspace, file: WorkspaceFile): Promise<ChangesetList> {
        const changesetsDir = this.getChangesetsFolder(ws, file);
        const changesetListFile = path.join(changesetsDir, "changeset-list.json");
        if (!fs.existsSync(changesetListFile)) {
            return [];
        }
        const content = await fs.promises.readFile(changesetListFile, 'utf-8');
        try {
            return ChangesetListSchema.parse(JSON.parse(content));
        } catch (error) {
            throw new Error(`Failed to parse changeset list from file ${changesetListFile}: ${error}`);
        }
    }

    public static async writeChangesetListToFile(ws: Workspace, file: WorkspaceFile, changesetList: ChangesetList): Promise<void> {
        const changesetsDir = this.getChangesetsFolder(ws, file);
        if (!fs.existsSync(changesetsDir)) {
            fs.mkdirSync(changesetsDir, { recursive: true });
        }
        const changesetListFile = path.join(changesetsDir, "changeset-list.json");
        await fs.promises.writeFile(changesetListFile, JSON.stringify(changesetList, null, 2), 'utf-8');
    }
}