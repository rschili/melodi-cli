import { Workspace } from "../Workspace.js";
import { DbApiKind } from "./FileActions.js";
import { log, select, text, isCancel, tasks, Option, spinner } from "@clack/prompts";
import { ITwin, ITwinSubClass } from "@itwin/itwins-client";
import chalk from "chalk";
import { generateColorizerMap, logError } from "../ConsoleHelper.js";
import { Guid } from "@itwin/core-bentley";
import { MinimalIModel } from "@itwin/imodels-client-management";
import { existsSync } from "node:fs";
import { createECDb, createStandaloneDb, openStandaloneDb } from "../UnifiedDb.js";
import { DbEditor } from "./DbEditor.js";
import fs from "node:fs/promises";
import { IModelConfig, saveIModelConfig } from "../IModelConfig.js";
import { applicationVersion } from "../Diagnostics.js";
import { CheckpointManager, ProgressStatus } from "@itwin/core-backend";
import path from "path";

export class NewFile {
    public static async run(ws: Workspace): Promise<void> {
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
                return this.downloadFromHub(ws);
            case "__ecdb__":
                return this.initializeECDb(ws);
            case "__standalone__":
                return this.initializeStandaloneDb(ws);
        }
    }

    public static async initializeECDb(ws: Workspace): Promise<void> {
        const fileName = await text({
            message: "Enter the name for the new ECDb file (without extension):",
        });
        if(isCancel(fileName)) {
            return; // User cancelled the prompt
        }
        const filePath = path.join(ws.workspaceRootPath, fileName.trim() + ".ecdb");
        const dirPath = path.dirname(filePath);
        if (!existsSync(dirPath)) {
            // Ensure the directory exists
            await fs.mkdir(dirPath, { recursive: true });
        }
        if (existsSync(filePath)) {
            log.error(`File "${filePath}" already exists. Please choose a different name.`);
            return this.initializeECDb(ws);
        }

        const db = createECDb(filePath);
        await DbEditor.run(ws, { relativePath: fileName.trim() + ".ecdb", lastTouched: new Date() }, db);
    }

    public static async initializeStandaloneDb(ws: Workspace): Promise<void> {
        const fileName = await text({
            message: "Enter the name for the new standalone iModel file (without extension):",
        });
        if(isCancel(fileName)) {
            return; // User cancelled the prompt
        }
        const fileNameWithExt = fileName.trim() + ".bim";
        const filePath = path.join(ws.workspaceRootPath, fileNameWithExt);
        const dirPath = path.dirname(filePath);
        if (!existsSync(dirPath)) {
            // Ensure the directory exists
            await fs.mkdir(dirPath, { recursive: true });
        }
        if (existsSync(filePath)) {
            log.error(`File "${filePath}" already exists. Please choose a different name.`);
            return this.initializeStandaloneDb(ws);
        }

        const rootSubject = await text({
            message: "Enter the root subject name for the new standalone iModel:",
            initialValue: fileName.trim(),
        });
        if(isCancel(rootSubject)) {
            return; // User cancelled the prompt
        }
        const db = createStandaloneDb(filePath, rootSubject.trim());
        await DbEditor.run(ws, { relativePath: fileNameWithExt, lastTouched: new Date() }, db);
    }

    public static async downloadFromHub(ws: Workspace): Promise<void> {
        const envManager = ws.envManager;
        const environment = await envManager.promptEnvironment();
        if(isCancel(environment)) {
            return; // User cancelled the prompt
        }

        let token: string = "";
        let iTwins: ITwin[] = [];
        await tasks([
            {
            title: `Setting up environment to ${environment.toString()}`,
            task: async (_) => {
                await envManager.selectEnvironment(environment);
                return `Environment set up to ${environment.toString()}`;
                },
            },
            {
            title: "Authenticating...",
            task: async (_) => {
                await envManager.signInIfNecessary();
                token = await envManager.authClient.getAccessToken();
                return "Authenticated.";
                }
            },
            {
                title: "Detecting available iTwins...",
                task: async (_) => {
                    const iTwinsResponse = await envManager.iTwinsClient.queryAsync(token);
                    if (iTwinsResponse.status !== 200) {
                        throw new Error(`Failed to fetch iTwins: ${iTwinsResponse.error?.message ?? "Unknown error"}`);
                        }

                    iTwins = iTwinsResponse.data ?? [];
                    return `Found ${iTwins.length} available iTwins.`;
                }
            }
        ]);

        const subClasses = iTwins.map(iTwin => iTwin.subClass ?? ITwinSubClass.Project);
        const colorizerMap = generateColorizerMap(subClasses);

        const iTwinChoices: Option<ITwin>[] = iTwins.map(iTwin => {
            const subClass = iTwin.subClass;
            let colorizedSubClass = '';
            if(subClass !== undefined) {
                const colorizer = colorizerMap.get(subClass);
                if(colorizer) {
                    colorizedSubClass = colorizer(subClass);
                }
            } iTwin.type
            return {
            label: `${chalk.bold(iTwin.displayName)} (${iTwin.id}) ${colorizedSubClass}`,
            value: iTwin
            }});

        const thingToPull = await select<ITwin | "iModel" | "iTwin">({
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

        let iTwinOrIModelId: string | undefined = undefined;
        let iModelId: string | undefined = undefined;
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
            iModelId = iTwinOrIModelId;
        } else {
            // If the user selected iTwin or provided an ITWin ID, so we list the imodels for that
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

            const authCallback = () => envManager.getAuthorization();
            iModelId = selectedIModel.id;
            const imodel = await envManager.iModelsClient.iModels.getSingle({
                authorization: authCallback,
                iModelId
            });

            const config: IModelConfig = {
                melodiVersion: applicationVersion,
                iModelId: imodel.id,
                iTwinId: imodel.iTwinId,
                environment: environment,
                displayName: imodel.displayName ?? imodel.name ?? imodel.id,
            }

            const relativePath = imodel.displayName + ".bim";
            const absolutePath = path.join(ws.workspaceRootPath, relativePath);
            const loader = spinner();
            try {
                loader.start("Downloading seed file...");
                await CheckpointManager.downloadCheckpoint({
                    localFile: absolutePath,
                    checkpoint: {
                        iTwinId: imodel.iTwinId,
                        iModelId,
                        changeset: { id: "" },
                    },
                    onProgress: (loaded: number, total: number) => {
                        if(loaded !== 0 && total > 0) {
                            loader.message(`Downloading seed file... ${(loaded / total * 100).toFixed(2)}%`);
                        }
                        return ProgressStatus.Continue;
                    }
                });
                await saveIModelConfig(ws, relativePath, config);
                loader.stop("Seed file downloaded successfully.");
                /*loader.start("Loading list of changesets...");
                for await (const changeset of envManager.iModelsClient.changesets.getRepresentationList({ authorization: authCallback, iModelId })) {
                    changeset.
                    StatusLine.update(`adding or updating briefcase id:${cachedBriefcase.briefcaseId} owner:${cachedBriefcase.owner?.displayName ?? "unknown"}`);
                    this.setBriefcase(cachedBriefcase);
                }*/

            }
            catch (error: unknown) {
                loader.stop("Failed to download seed file.");
                logError(error);
                return;
            }

            const db = await openStandaloneDb(absolutePath);
            if(isCancel(db)) {
                return; // User cancelled the prompt
            }
            DbEditor.run(ws, { relativePath, lastTouched: new Date() }, db);
        }
/*
        // get the imodel*/

    }
}