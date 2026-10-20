import { Context, WorkspaceFile } from "../Context";
import { log, select, text, isCancel, tasks, Option, spinner, confirm, type CANCEL_SYMBOL } from "@clack/prompts";
import type { ITwinMinimal } from "@itwin/itwins-client";
import chalk from "chalk";
import { generateColorizerMap, logError } from "../ConsoleHelper";
import { Guid } from "@itwin/core-bentley";
import type { Checkpoint, MinimalIModel, MinimalNamedVersion } from "@itwin/imodels-client-management";
import { existsSync } from "node:fs";
import { createECDb, createStandaloneDb, openBriefcaseDb } from "../UnifiedDb";
import { DbEditor } from "./DbEditor";
import fs from "node:fs/promises";
import { IModelConfig, saveIModelConfig } from "../IModelConfig";
import { applicationVersion } from "../Diagnostics";
import { CheckpointManager, ProgressStatus } from "@itwin/core-backend";
import path from "path";
import { ChangesetIdWithIndex } from "@itwin/core-common";
import { calculateOverallFileSize, isSchemaChangeset } from "./ChangesetOps";
import { formatSize, printChangesetTable, queryLatestChangesetIndex, queryRemoteChangesets } from "./ChangesetList";

export class NewFile {
    public static async run(ctx: Context): Promise<void> {
        const workspaceType = await select({
            message: 'Choose an option:',
            options: [
                { label: 'Download an iModel from iModelHub', value: "__download__" },
                { label: 'Initialize a new ECDb', value: "__ecdb__" },
                { label: 'Initialize a new standalone iModel', value: "__standalone__" },
            ],
        });

        if(isCancel(workspaceType)) {
            return; // User cancelled the prompt
        }

        switch (workspaceType) {
            case "__download__":
                return this.downloadFromHub(ctx);
            case "__ecdb__":
                return this.initializeECDb(ctx);
            case "__standalone__":
                return this.initializeStandaloneDb(ctx);
        }
    }

    public static async initializeECDb(ctx: Context): Promise<void> {
        const fileName = await text({
            message: "Enter the name for the new ECDb file (without extension):",
        });
        if(isCancel(fileName)) {
            return; // User cancelled the prompt
        }
        const filePath = path.join(ctx.folders.rootDir, fileName.trim() + ".ecdb");
        const dirPath = path.dirname(filePath);
        if (!existsSync(dirPath)) {
            // Ensure the directory exists
            await fs.mkdir(dirPath, { recursive: true });
        }
        if (existsSync(filePath)) {
            log.error(`File "${filePath}" already exists. Please choose a different name.`);
            return this.initializeECDb(ctx);
        }

        const db = createECDb(filePath);
        await DbEditor.run(ctx, { relativePath: fileName.trim() + ".ecdb", lastTouched: new Date(), hasITwinId: false }, db);
    }

    public static async initializeStandaloneDb(ctx: Context): Promise<void> {
        const fileName = await text({
            message: "Enter the name for the new standalone iModel file (without extension):",
        });
        if(isCancel(fileName)) {
            return; // User cancelled the prompt
        }
        const fileNameWithExt = fileName.trim() + ".bim";
        const filePath = path.join(ctx.folders.rootDir, fileNameWithExt);
        const dirPath = path.dirname(filePath);
        if (!existsSync(dirPath)) {
            // Ensure the directory exists
            await fs.mkdir(dirPath, { recursive: true });
        }
        if (existsSync(filePath)) {
            log.error(`File "${filePath}" already exists. Please choose a different name.`);
            return this.initializeStandaloneDb(ctx);
        }

        const rootSubject = await text({
            message: "Enter the root subject name for the new standalone iModel:",
            initialValue: fileName.trim(),
        });
        if(isCancel(rootSubject)) {
            return; // User cancelled the prompt
        }
        const db = createStandaloneDb(filePath, rootSubject.trim());
        await DbEditor.run(ctx, { relativePath: fileNameWithExt, lastTouched: new Date(), hasITwinId: false }, db);
    }

    public static async downloadFromHub(ctx: Context): Promise<void> {
        const envManager = ctx.envManager;
        const environment = await envManager.promptEnvironment();
        if(isCancel(environment)) {
            return; // User cancelled the prompt
        }

        let token: string = "";
        let iTwins: ITwinMinimal[] = [];
        await tasks([
            {
            title: `Setting up environment to ${environment.toString()}`,
            task: async () => {
                await envManager.selectEnvironment(environment);
                return `Environment set up to ${environment.toString()}`;
                },
            },
            {
            title: "Authenticating...",
            task: async () => {
                await envManager.signInIfNecessary();
                token = await envManager.authClient.getAccessToken();
                return "Authenticated.";
                }
            },
            {
                title: "Detecting available iTwins...",
                task: async () => {
                    const iTwinsResponse = await envManager.iTwinsClient.getRecentUsedITwins(token);
                    if (iTwinsResponse.status !== 200) {
                        throw new Error(`Failed to fetch iTwins: ${iTwinsResponse.error?.message ?? "Unknown error"}`);
                        }

                    iTwins = iTwinsResponse.data?.iTwins ?? [];
                    return `Found ${iTwins.length} available iTwins.`;
                }
            }
        ]);

        const subClasses = iTwins.map(iTwin => iTwin.subClass ?? "Project");
        const colorizerMap = generateColorizerMap(subClasses);

        const iTwinChoices: Option<ITwinMinimal>[] = iTwins.map(iTwin => {
            const subClass = iTwin.subClass;
            let colorizedSubClass = '';
            if(subClass !== undefined) {
                const colorizer = colorizerMap.get(subClass);
                if(colorizer) {
                    colorizedSubClass = colorizer(subClass);
                }
            }
            return {
                label: `${chalk.bold(iTwin.displayName)} (${iTwin.id}) ${colorizedSubClass}`,
                value: iTwin
            }});

        const thingToPull = await select<ITwinMinimal | "iModel" | "iTwin">({
            message: 'Select an iTwin',
            options: [
                { label: "Pull by iModel ID", value: "iModel" },
                { label: "Pull by iTwin ID", value: "iTwin" },
                ...iTwinChoices
            ],

            maxItems: 20,
        });

        if(isCancel(thingToPull)) {
            return; // User cancelled the prompt
        }

        let iTwinOrIModelId: string | undefined;
        let iModelId: string | undefined;
        if (thingToPull === "iModel" || thingToPull === "iTwin") {
            // in case of iTwin or iModel we need to ask for the ID
            const unverifiedId = await text({ message: "Please provide the ID:"});
            if(isCancel(unverifiedId)) {
                return; // User cancelled the prompt
            }

            if(!Guid.isV4Guid(unverifiedId.trim())) {
                log.error("The provided ID does not appear to be a valid GUID.");
                return;
            }

            iTwinOrIModelId = unverifiedId.trim();
        } else {
            // in case of iTwin we can use the selected iTwin ID
            iTwinOrIModelId = thingToPull.id;
        }

        if( thingToPull === "iModel") {
            iModelId = iTwinOrIModelId!;
        } else {
            // If the user selected iTwin or provided an iTwin ID, list available iModels
            const client = envManager.iModelsClient;
            const iModelIterator = await client.iModels.getMinimalList({
                authorization: async () => envManager.getAuthorization(),
                urlParams: {
                    iTwinId: iTwinOrIModelId!,
                },
            });

            const iModelChoices: Option<MinimalIModel>[] = [];
            for await (const iModel of iModelIterator) {
                iModelChoices.push({
                    label: `${chalk.bold(iModel.displayName)} (${iModel.id})`,
                    value: iModel,
                });
            }
            if (iModelChoices.length === 0) {
                log.error("No iModels found for the provided iTwin ID.");
                return;
            }

            const selectedIModel = await select({
                message: "Select an iModel",
                options: iModelChoices,
                maxItems: 20,
            });

            if(isCancel(selectedIModel)) {
                return; // User cancelled the prompt
            }

            iModelId = selectedIModel.id;
        }

        const authCallback = () => envManager.getAuthorization();
        const imodel = await envManager.iModelsClient.iModels.getSingle({
            authorization: authCallback,
            iModelId: iModelId!,
        });

        const config: IModelConfig = {
            melodiVersion: applicationVersion,
            iModelId: imodel.id,
            iTwinId: imodel.iTwinId,
            environment: environment,
            displayName: imodel.displayName ?? imodel.name ?? imodel.id,
        }

        const target = await this.selectDownloadTarget(ctx, imodel.id, imodel.displayName ?? imodel.id);
        if (isCancel(target)) {
            return; // User cancelled the prompt
        }

        let relativePath: string;
        let absolutePath: string;
        while (true) {
            const selectedName = await text({
                message: "Enter a name for the downloaded iModel file (without extension):",
                initialValue: target.suggestedName,
            });

            if (isCancel(selectedName)) {
                return; // User cancelled the prompt
            }

            relativePath = selectedName.trim() + ".bim";
            absolutePath = path.join(ctx.folders.rootDir, relativePath);

            if (existsSync(absolutePath)) {
                log.error(`File "${absolutePath}" already exists. Please choose a different name.`);
                continue;
            }
            break;
        }

        const loader = spinner();
        try {
            loader.start("Downloading checkpoint...");
            await CheckpointManager.downloadCheckpoint({
                localFile: absolutePath,
                checkpoint: {
                    iTwinId: imodel.iTwinId,
                    iModelId: imodel.id,
                    changeset: target.changeset,
                },
                onProgress: (loaded: number, total: number) => {
                    if (total > 0) {
                        // Progress only covers the checkpoint transfer. Applying changesets afterwards reports nothing.
                        loader.message(loaded < total
                            ? `Downloading checkpoint... ${(loaded / total * 100).toFixed(2)}%`
                            : "Checkpoint downloaded, applying changesets up to the requested index (if any)...");
                    }
                    return ProgressStatus.Continue;
                }
            });
            await saveIModelConfig(ctx, relativePath, config);
            loader.stop("Download successful.");
        }
        catch (error: unknown) {
            loader.stop("Failed to download iModel file.");
            logError(error);
            return;
        }

        const wsFile: WorkspaceFile = { relativePath, lastTouched: new Date(), hasITwinId: true }
        const db = await openBriefcaseDb(ctx, wsFile, config);
        if(isCancel(db)) {
            return; // User cancelled the prompt
        }
        await DbEditor.run(ctx, wsFile, db);
    }

    private static async selectDownloadTarget(ctx: Context, iModelId: string, iModelName: string): Promise<DownloadTarget | typeof CANCEL_SYMBOL> {
        const envManager = ctx.envManager;
        const authorization = () => envManager.getAuthorization();

        const namedVersionChoices: Option<MinimalNamedVersion>[] = [];
        for await (const nv of envManager.iModelsClient.namedVersions.getMinimalList({ authorization, iModelId })) {
            namedVersionChoices.push({
                label: `${chalk.bold(nv.displayName)} (Changeset Index: ${nv.changesetIndex}, Changeset ID: ${nv.changesetId})`,
                value: nv,
            });
        }

        const selected = await select<MinimalNamedVersion | "seed" | "index">({
            message: "Select which version of the iModel to download",
            options: [
                { label: "Seed iModel", value: "seed", hint: "before any changesets" },
                { label: "Specific changeset index...", value: "index", hint: "nearest checkpoint, then applies changesets" },
                ...namedVersionChoices,
            ],
            maxItems: 20,
        });
        if (isCancel(selected))
            return selected;

        if (selected === "seed")
            return { changeset: { id: "", index: 0 }, suggestedName: iModelName };

        if (selected !== "index") {
            if (selected.changesetId === null || selected.changesetIndex === 0)
                return { changeset: { id: "", index: 0 }, suggestedName: selected.displayName ?? iModelName };
            return { changeset: { id: selected.changesetId, index: selected.changesetIndex }, suggestedName: selected.displayName ?? iModelName };
        }

        const latestIndex = await queryLatestChangesetIndex(ctx, iModelId);
        const showSchemaChangesets = await confirm({
            message: `The iModel has ${latestIndex} changesets. List schema changesets first? (reads the full changeset history)`,
            initialValue: true,
        });
        if (isCancel(showSchemaChangesets))
            return showSchemaChangesets;

        if (showSchemaChangesets) {
            const schemaChangesets = (await queryRemoteChangesets(ctx, iModelId)).filter(cs => isSchemaChangeset(cs.containingChanges));
            printChangesetTable(schemaChangesets);
            log.info("To reproduce a schema changeset, download the index before it.");
        }

        const indexInput = await text({
            message: `Changeset index to download (0-${latestIndex}):`,
            validate: (value) => {
                const index = Number(value?.trim());
                return Number.isSafeInteger(index) && index >= 0 && index <= latestIndex ? undefined : `Enter a number between 0 and ${latestIndex}.`;
            },
        });
        if (isCancel(indexInput))
            return indexInput;

        const index = Number(indexInput.trim());
        if (index === 0)
            return { changeset: { id: "", index: 0 }, suggestedName: iModelName };

        const changeset = await envManager.iModelsClient.changesets.getSingle({ authorization, iModelId, changesetIndex: index });
        await this.logCheckpointDistance(ctx, iModelId, index, () => changeset.getCurrentOrPrecedingCheckpoint());
        return { changeset: { id: changeset.id, index }, suggestedName: `${iModelName}_cs${index}` };
    }

    /** Tells the user how many changesets have to be applied on top of the nearest checkpoint. Informational only. */
    private static async logCheckpointDistance(ctx: Context, iModelId: string, index: number, getCheckpoint: () => Promise<Checkpoint | undefined>): Promise<void> {
        try {
            const checkpoint = await getCheckpoint();
            const checkpointIndex = checkpoint?.changesetIndex ?? 0;
            if (checkpointIndex >= index) {
                log.info(`A checkpoint exists for changeset ${index}.`);
                return;
            }
            const changesetsToApply = await queryRemoteChangesets(ctx, iModelId, { first: checkpointIndex + 1, last: index });
            log.info(`Nearest checkpoint is at index ${checkpointIndex}. ${changesetsToApply.length} changeset(s) (${formatSize(calculateOverallFileSize(changesetsToApply))}) will be applied after downloading it.`);
        } catch (error: unknown) {
            log.warn(`Could not determine the nearest checkpoint: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

type DownloadTarget = {
    changeset: ChangesetIdWithIndex;
    suggestedName: string;
};
