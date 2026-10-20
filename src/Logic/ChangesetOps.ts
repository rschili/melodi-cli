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
    relativePath: z.string().optional(),
}));

export type ChangesetList = z.infer<typeof ChangesetListSchema>;

export function getChangesetsFolder(ctx: Context, file: WorkspaceFile): string {
    const contextFolder = getFileContextFolderPath(ctx.folders.rootDir, file.relativePath);
    return path.join(contextFolder, "changesets");
}

export function getChangesetRelativePath(ctx: Context, file: WorkspaceFile, absolutePath: string): string {
    const changesetsDir = getChangesetsFolder(ctx, file);
    if (!absolutePath.startsWith(changesetsDir))
        throw new Error(`Absolute path ${absolutePath} does not start with changesets directory ${changesetsDir}`);

    const relativePath = path.relative(changesetsDir, absolutePath);
    if (!relativePath)
        throw new Error(`Could not determine relative path for ${absolutePath} in changesets directory ${changesetsDir}`);

    return relativePath;
}

export function calculateOverallFileSize(changesets: MinimalChangeset[]): number {
    return changesets.reduce((total, changeset) => total + (changeset.fileSize || 0), 0);
}

export function downloadedChangesetsToChangesetList(ctx: Context, file: WorkspaceFile, downloadedChangesets: DownloadedChangeset[]): ChangesetList {
    return downloadedChangesets.map(changeset => ({
        id: changeset.id,
        displayName: changeset.displayName,
        index: changeset.index,
        parentId: changeset.parentId,
        pushDateTime: changeset.pushDateTime,
        containingChanges: changeset.containingChanges,
        fileSize: changeset.fileSize,
        relativePath: getChangesetRelativePath(ctx, file, changeset.filePath),
    }));
}

export async function readChangesetListFromFile(ctx: Context, file: WorkspaceFile): Promise<ChangesetList> {
    const changesetsDir = getChangesetsFolder(ctx, file);
    const changesetListFile = path.join(changesetsDir, "changeset-list.json");
    if (!existsSync(changesetListFile))
        return [];

    const content = await fs.readFile(changesetListFile, 'utf-8');
    try {
        return ChangesetListSchema.parse(JSON.parse(content));
    } catch (error) {
        throw new Error(`Failed to parse changeset list from file ${changesetListFile}: ${error}`, { cause: error });
    }
}

export async function writeChangesetListToFile(ctx: Context, file: WorkspaceFile, changesetList: ChangesetList): Promise<void> {
    const changesetsDir = getChangesetsFolder(ctx, file);
    if (!existsSync(changesetsDir))
        mkdirSync(changesetsDir, { recursive: true });

    const changesetListFile = path.join(changesetsDir, "changeset-list.json");
    await fs.writeFile(changesetListFile, JSON.stringify(changesetList, null, 2), 'utf-8');
}

const changesetTypeFlagLabels: Array<[ContainingChanges, string]> = [
    [ContainingChanges.Definition, "Definition"],
    [ContainingChanges.SpatialData, "Spatial"],
    [ContainingChanges.SheetsAndDrawings, "Sheets/Drawings"],
    [ContainingChanges.ViewsAndModels, "Views/Models"],
    [ContainingChanges.GlobalProperties, "GlobalProps"],
];

/** Hub sets the Schema flag together with SchemaSync for changesets pushed by SchemaSync. */
export function isSchemaChangeset(containingChanges: number): boolean {
    return (containingChanges & (ContainingChanges.Schema | ContainingChanges.SchemaSync)) !== 0;
}

/** Turns iModelHub's containingChanges flags into short labels. Unknown flags are shown as hex. */
export function describeChangesetType(containingChanges: number): string[] {
    if (containingChanges === ContainingChanges.Regular)
        return ["Data"];

    const labels: string[] = [];
    let remainingFlags = containingChanges;
    if ((remainingFlags & ContainingChanges.SchemaSync) !== 0) {
        labels.push("SchemaSync");
        remainingFlags &= ~(ContainingChanges.SchemaSync | ContainingChanges.Schema);
    } else if ((remainingFlags & ContainingChanges.Schema) !== 0) {
        labels.push("Schema");
        remainingFlags &= ~ContainingChanges.Schema;
    }

    for (const [flag, label] of changesetTypeFlagLabels) {
        if ((remainingFlags & flag) !== 0) {
            labels.push(label);
            remainingFlags &= ~flag;
        }
    }

    if (remainingFlags !== 0)
        labels.push(`0x${(remainingFlags >>> 0).toString(16)}`);
    return labels;
}

/** Parses "900-950" or "900" into an inclusive index range. */
export function parseChangesetIndexRange(input: string): { first: number; last: number } | undefined {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(input);
    if (!match)
        return undefined;

    const first = Number(match[1]);
    const last = match[2] === undefined ? first : Number(match[2]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last < first)
        return undefined;
    return { first, last };
}
