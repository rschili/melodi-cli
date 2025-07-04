import { Workspace, WorkspaceFile } from "../Workspace";
import { log, select, text, isCancel, tasks, Option, spinner, confirm } from "@clack/prompts";
import { ITwin, ITwinSubClass } from "@itwin/itwins-client";
import chalk from "chalk";
import { generateColorizerMap, logError } from "../ConsoleHelper";
import { Guid } from "@itwin/core-bentley";
import { MinimalIModel, MinimalNamedVersion } from "@itwin/imodels-client-management";
import { existsSync } from "node:fs";
import { createECDb, createStandaloneDb, openBriefcaseDb } from "../UnifiedDb";
import { DbEditor } from "./DbEditor";
import fs from "node:fs/promises";
import { IModelConfig, saveIModelConfig } from "../IModelConfig";
import { applicationVersion } from "../Diagnostics";
import { CheckpointManager, ProgressStatus } from "@itwin/core-backend";
import path from "path";
import { ChangesetIdWithIndex } from "@itwin/core-common";
import { Changesets } from "./Changesets";

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
            }
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

            const namedVersionsIterator = envManager.iModelsClient.namedVersions.getMinimalList({
                authorization: authCallback,
                iModelId
            });
            const namedVersionChoices: Option<MinimalNamedVersion>[] = [];
            for await (const nv of namedVersionsIterator) {
                namedVersionChoices.push({
                    label: `${chalk.bold(nv.displayName)} (Changeset Index: ${nv.changesetIndex}, Changeset ID: ${nv.changesetId})`,
                    value: nv,
                });
            }

            let selectedVersion: MinimalNamedVersion | "__seed__" | symbol = "__seed__";
            if(namedVersionChoices.length === 0) {
                log.info("There are no named versions for the selected iModel, so downloading seed.");
            } else {
                selectedVersion = await select<MinimalNamedVersion | "__seed__">({
                    message: "Select which version of the iModel to download",
                    options: [
                        { label: "Seed iModel", value: "__seed__" },
                        ...namedVersionChoices,
                    ],
                    maxItems: 20,
                });
                if(isCancel(selectedVersion)) {
                    return; // User cancelled the prompt
                }
            }

            const selectedNamedVersion = selectedVersion === "__seed__" ? undefined : (selectedVersion as MinimalNamedVersion);

            const checkpointId: ChangesetIdWithIndex = 
                selectedNamedVersion === undefined || selectedNamedVersion.changesetId === null
                    ? { id: "" }
                    : { id: selectedNamedVersion.changesetId, index: selectedNamedVersion.changesetIndex };

            const name = (selectedNamedVersion === undefined ? imodel.displayName : (selectedNamedVersion.displayName ?? imodel.displayName));

            
            let selectedName: string | symbol;
            let relativePath: string;
            let absolutePath: string;
            while (true) {
                selectedName = await text({
                    message: "Enter a name for the downloaded iModel file (without extension):",
                    initialValue: name,
                });

                if (isCancel(selectedName)) {
                    return; // User cancelled the prompt
                }

                relativePath = selectedName.trim() + ".bim";
                absolutePath = path.join(ws.workspaceRootPath, relativePath);

                if (existsSync(absolutePath)) {
                    log.error(`File "${absolutePath}" already exists. Please choose a different name.`);
                    continue;
                }
                break;
            }
            const loader = spinner();
            try {
                loader.start("Downloading iModel file...");
                await CheckpointManager.downloadCheckpoint({
                    localFile: absolutePath,
                    checkpoint: {
                        iTwinId: imodel.iTwinId,
                        iModelId,
                        changeset: checkpointId,
                    },
                    onProgress: (loaded: number, total: number) => {
                        if(loaded !== 0 && total > 0) {
                            loader.message(`Downloading iModel file... ${(loaded / total * 100).toFixed(2)}%`);
                        }
                        return ProgressStatus.Continue;
                    }
                });
                await saveIModelConfig(ws, relativePath, config);
                loader.stop("Downloaded successful.");
            }
            catch (error: unknown) {
                loader.stop("Failed to download iModel file.");
                logError(error);
                return;
            }

            const wsFile: WorkspaceFile = { relativePath, lastTouched: new Date() }

            log.message("Checking for available changesets...");
            const changesets = await envManager.iModelsClient.changesets.getMinimalList({
                authorization: authCallback,
                iModelId
            });
            const changesetsArray = [];
            for await (const cs of changesets) {
                changesetsArray.push(cs);
            }
            const size = Changesets.calculateOverallFileSize(changesetsArray);
            if(changesetsArray.length > 0) {
                const downloadChangesets = await confirm({
                    message: `Downloaded iModel has ${changesetsArray.length} changesets. Do you want to download them? (Total size to download: ${(size / (1024 * 1024)).toFixed(2)} MB)`,
                    initialValue: true,
                });
                if(isCancel(downloadChangesets)) {
                    return; // User cancelled the prompt
                }

                if(downloadChangesets) {
                    await Changesets.downloadChangesets(ws, wsFile, iModelId);
                }

            } else {
                log.info("Downloaded iModel has no changesets available.");
            }

            const db = await openBriefcaseDb(absolutePath);
            if(isCancel(db)) {
                return; // User cancelled the prompt
            }
            await DbEditor.run(ws, { relativePath, lastTouched: new Date() }, db);
        }
    }
}