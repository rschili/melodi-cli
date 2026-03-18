import fs from "node:fs/promises";
import path from "path";
import { z } from "zod/v4";
import { ContainingChanges, MinimalChangeset } from "@itwin/imodels-client-management";
import { getFileContextFolderPath, Context, WorkspaceFile } from "../Context";
import { DownloadedChangeset } from "@itwin/imodels-client-authoring";
import { existsSync, mkdirSync } from "node:fs";
import { BriefcaseDb, ProgressStatus } from "@itwin/core-backend";
import { log, select, isCancel, spinner, text } from "@clack/prompts";
import chalk from "chalk";
import { UnifiedDb } from "../UnifiedDb";
import { logError } from "../ConsoleHelper";


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
            throw new Error(`Failed to parse changeset list from file ${changesetListFile}: ${error}`, { cause: error });
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

        const loader = spinner();
        loader.start("Downloading changesets...");
        try {
            const downloaded = await ctx.envManager.iModelsClient.changesets.downloadList({
                authorization: () => ctx.envManager.getAuthorization(),
                iModelId,
                targetDirectoryPath: changesetsDir
            });

            const cacheList = Changesets.downloadedChangesetsToChangesetList(ctx, file, downloaded);
            await Changesets.writeChangesetListToFile(ctx, file, cacheList);
            loader.stop(`Downloaded ${downloaded.length} changeset(s).`);
        } catch (error: unknown) {
            loader.stop("Changeset download failed.");
            throw error;
        }
    }
}

export class ChangesetEditor {
    static async run(ctx: Context, file: WorkspaceFile, db: UnifiedDb): Promise<void> {
        const briefcaseDb = db.innerDb;
        if (!(briefcaseDb instanceof BriefcaseDb)) {
            log.error("Changeset operations are only supported for BriefcaseDb instances.");
            return;
        }

        while (true) {
            const currentChangeset = briefcaseDb.changeset;
            const currentIndex = currentChangeset.index ?? 0;
            const currentId = currentChangeset.id || "(seed - no changesets applied)";

            log.info(`Current changeset: index ${chalk.bold(currentIndex)}, id ${chalk.dim(currentId)}`);

            const options: { label: string; value: string }[] = [];
            if (!db.isReadOnly) {
                options.push({ label: "Pull to latest", value: "pull-latest" });
                options.push({ label: "Pull to specific index", value: "pull-index" });
            } else {
                options.push({ label: chalk.dim("Pull requires read-write mode"), value: "readonly-hint" });
            }
            options.push({ label: "Show remote changeset info", value: "remote-info" });
            options.push({ label: "(Back)", value: "back" });

            const action = await select({
                message: "Changeset operations",
                options,
            });

            if (action === "back" || isCancel(action))
                return;

            if (action === "readonly-hint") {
                log.warn("Re-open the file in read-write mode to pull changesets.");
                continue;
            }

            try {
                if (action === "remote-info") {
                    await this.showRemoteInfo(ctx, briefcaseDb);
                } else if (action === "pull-latest") {
                    await this.pullChanges(briefcaseDb);
                } else if (action === "pull-index") {
                    await this.pullToIndex(briefcaseDb);
                }
            } catch (error: unknown) {
                logError(error);
            }
        }
    }

    private static async showRemoteInfo(ctx: Context, db: BriefcaseDb): Promise<void> {
        const loader = spinner();
        loader.start("Querying iModelHub for changeset info...");
        try {
            const changesets = ctx.envManager.iModelsClient.changesets.getMinimalList({
                authorization: () => ctx.envManager.getAuthorization(),
                iModelId: db.iModelId,
            });

            let count = 0;
            let latestIndex = 0;
            let latestId = "";
            for await (const cs of changesets) {
                count++;
                if (cs.index > latestIndex) {
                    latestIndex = cs.index;
                    latestId = cs.id;
                }
            }

            loader.stop("Remote changeset info retrieved.");
            const localIndex = db.changeset.index ?? 0;
            log.info(`Remote: ${chalk.bold(count)} total changesets, latest index ${chalk.bold(latestIndex)} (${chalk.dim(latestId)})`);
            if (localIndex >= latestIndex) {
                log.success("Already up to date.");
            } else {
                log.info(`Behind by ${chalk.yellow(String(latestIndex - localIndex))} changeset(s).`);
            }
        } catch (error: unknown) {
            loader.stop("Failed to query remote changeset info.");
            throw error;
        }
    }

    private static async pullChanges(db: BriefcaseDb): Promise<void> {
        const loader = spinner();
        loader.start("Pulling latest changesets...");
        try {
            await db.pullChanges({
                onProgress: (loaded: number, total: number) => {
                    if (total > 0) {
                        const pct = (loaded / total * 100).toFixed(1);
                        loader.message(`Pulling changesets... ${pct}%`);
                    }
                    return ProgressStatus.Continue;
                },
            });
            loader.stop("Pull complete.");
            const updated = db.changeset;
            log.success(`Now at changeset index ${chalk.bold(updated.index ?? 0)}, id ${chalk.dim(updated.id || "(seed)")}`);
        } catch (error: unknown) {
            loader.stop("Pull failed.");
            throw error;
        }
    }

    private static async pullToIndex(db: BriefcaseDb): Promise<void> {
        const indexInput = await text({
            message: "Enter the target changeset index:",
        });

        if (isCancel(indexInput))
            return;

        const toIndex = parseInt(indexInput.trim(), 10);
        if (isNaN(toIndex) || toIndex < 0) {
            log.error("Invalid changeset index. Must be a non-negative integer.");
            return;
        }

        const currentIndex = db.changeset.index ?? 0;
        if (toIndex <= currentIndex) {
            log.warn(`Target index ${toIndex} is not ahead of current index ${currentIndex}. Reverting is not supported here.`);
            return;
        }

        const loader = spinner();
        loader.start(`Pulling changesets up to index ${toIndex}...`);
        try {
            await db.pullChanges({
                toIndex,
                onProgress: (loaded: number, total: number) => {
                    if (total > 0) {
                        const pct = (loaded / total * 100).toFixed(1);
                        loader.message(`Pulling changesets... ${pct}%`);
                    }
                    return ProgressStatus.Continue;
                },
            });
            loader.stop("Pull complete.");
            const updated = db.changeset;
            log.success(`Now at changeset index ${chalk.bold(updated.index ?? 0)}, id ${chalk.dim(updated.id || "(seed)")}`);
        } catch (error: unknown) {
            loader.stop("Pull failed.");
            throw error;
        }
    }
}