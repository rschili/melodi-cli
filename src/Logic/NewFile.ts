import { NodeCliAuthorizationClient } from "@itwin/node-cli-authorization";
import { GoogleClientStorage } from "@itwin/object-storage-google/lib/client";
import { ClientStorageWrapperFactory } from "@itwin/object-storage-google/lib/client/wrappers";
import { AzureClientStorage, BlockBlobClientWrapperFactory } from "@itwin/object-storage-azure";
import { ClientStorage, StrategyClientStorage} from "@itwin/object-storage-core";
import { IModelsClient, IModelsClientOptions } from "@itwin/imodels-client-authoring";
import { saveUserConfig, Workspace } from "../Workspace";
import { DbApiKind } from "./FileActions";
import { log, select, spinner, text, isCancel, tasks, Option } from "@clack/prompts";
import { EnvironmentManager } from "../EnvironmentManager";
import { ITwin, ITwinSubClass } from "@itwin/itwins-client";
import chalk from "chalk";
import { generateColorizerMap } from "../ConsoleHelper";
import { Guid } from "@itwin/core-bentley";
import { MinimalIModel } from "@itwin/imodels-client-management";

export class NewFile {
    public static async run(ws: Workspace): Promise<void> {
        const workspaceType = await select({
            message: 'Choose an option:',
            options: [
                { label: 'Pull a briefcase from iModelHub', value: DbApiKind.BriefcaseDb },
                { label: 'Initialize a new ECDb', value: DbApiKind.ECDb },
                { label: 'Initialize a new standalone iModel', value: DbApiKind.StandaloneDb },
            ],
        });

        if(isCancel(workspaceType)) {
            return; // User cancelled the prompt
        }

        switch (workspaceType) {
            case DbApiKind.BriefcaseDb:
                return this.pullBriefcase(ws);
            case DbApiKind.ECDb:
                throw new Error("ECDb workspace initialization is not yet implemented.");
            case DbApiKind.StandaloneDb:
                throw new Error("StandaloneDb workspace initialization is not yet implemented.");
        }
    }

    public static async pullBriefcase(ws: Workspace): Promise<void> {
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

            iModelId = selectedIModel.id;
        }

/*
        // get the imodel*/

    }
}