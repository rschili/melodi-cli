
import { NodeCliAuthorizationClient } from "@itwin/node-cli-authorization";
import { GoogleClientStorage } from "@itwin/object-storage-google/lib/client";
import { ClientStorageWrapperFactory } from "@itwin/object-storage-google/lib/client/wrappers";
import { AzureClientStorage, BlockBlobClientWrapperFactory } from "@itwin/object-storage-azure";
import { ClientStorage, StrategyClientStorage} from "@itwin/object-storage-core";
import { IModelsClient, IModelsClientOptions } from "@itwin/imodels-client-authoring";
import { printError, formatError, logError } from "../ConsoleHelper";
import { Environment, ITwinHistoryEntry, saveUserConfig, Workspace } from "../Workspace";
import { DbApiKind } from "./FileActions";
import { log, select, spinner, text, isCancel } from "@clack/prompts";

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
                return this.initBriefcase(ws);
            case DbApiKind.ECDb:
                throw new Error("ECDb workspace initialization is not yet implemented.");
            case DbApiKind.StandaloneDb:
                throw new Error("StandaloneDb workspace initialization is not yet implemented.");
        }
    }

    public static async initBriefcase(ws: Workspace): Promise<void> {
        const history = ws.userConfig.iTwinHistory ?? [];
        const method = await select<string | ITwinHistoryEntry>({
            message: 'Choose the method to connect',
            options: [
                { label: "List available iModels by iTwin", value: "iTwin" },
                { label: "Specify a single iModel by ID", value: "iModel" }
                ,
                ...(history.length > 0
                    ? history.map((entry, idx) => ({
                            label: `Recent: ${entry.iTwinId} on ${entry.environment}`,
                            value: entry,
                        }))
                    : [])
            ],
        });

        // 65f5eeec-326e-4814-ac57-74977e9456a1
        // d08c6ecb-5925-40a7-853d-b69c8d15deaf
        // 75b98df9b64f52154a020139387d844e859a5680

        if (isCancel(method)) {
            return; // User cancelled the prompt
        }

        let id: string = "";
        let environment: Environment = Environment.PROD;
        if( method == "iTwin" || method == "iModel") {
            const selectedEnv = await select({
                message: "Select an environment",
                options: [
                    {label: "PROD", value: Environment.PROD },
                    {label: "QA", value: Environment.QA },
                    {label: "DEV", value: Environment.DEV },
                ],
            });

            if(isCancel(selectedEnv)) {
                return; // User cancelled the prompt
            }

            environment = selectedEnv;
            
            const input = await text({
                message: `Please provide the ${method} ID`,
            });

            if (isCancel(input)) {
                return; // User cancelled the prompt
            }

            id = input.trim();
        } else {
            const historyEntry = method as ITwinHistoryEntry;
            id = historyEntry.iTwinId;
            environment = historyEntry.environment;
        }

        const authority = environment === Environment.PROD ? "https://ims.bentley.com/" : environment === Environment.QA ? "https://qa-ims.bentley.com/" : "https://dev-ims.bentley.com/";
        if(environment !== Environment.PROD) {
            throw new Error(`Environment ${String(environment)} is not supported yet. Please use PROD.`);
        }

        const authClient = new NodeCliAuthorizationClient({
            issuerUrl: authority,
            clientId: "native-b517RwSFtag94aBZ5lM40QCf6",
            redirectUri: "http://localhost:3000/signin-callback",
            scope: "itwin-platform"
        });

        const s = spinner();
        try {
            s.start("Signing in (please check for a browser window)...");
            await authClient.signIn();
            //await withTimeout(authClient.signIn(), 30);
            s.stop("Sign in successful.");
        }
        catch (error: unknown) {
            s.stop("Sign in failed.");
            logError(error);
            return;
        }

        const getTokenCallback = async () => {
            const parts = (await authClient.getAccessToken()).split(" ");
            return { scheme: parts[0], token: parts[1] };
            };

        const iModelsClientOptions: IModelsClientOptions = {
            cloudStorage: NewFile.createDefaultClientStorage(),
        }

        /*if(environment === Environment.DEV) {
            iModelsClientOptions.api = {baseUrl: "https://dev-api.bentley.com/imodels"};
        } else if (environment === Environment.QA) {
            iModelsClientOptions.api = {baseUrl: "https://qa-api.bentley.com/imodels"};
        }*/
        const iModelsCLient = new IModelsClient(iModelsClientOptions);
        let iModelId: string | undefined = undefined;

        if (method === "iTwin") {
            const iModelIterator = iModelsCLient.iModels.getMinimalList({
                    authorization: getTokenCallback,
                    urlParams: {
                        iTwinId: id,
                    },
                });

            // Add the used iTwin id to history
            const historyEntry: ITwinHistoryEntry = {
                iTwinId: id,
                environment: environment,
            };
            if (!ws.userConfig.iTwinHistory) {
                ws.userConfig.iTwinHistory = [historyEntry];
            } else {
                // Check if the iTwinId already exists in history
                const existingIndex = ws.userConfig.iTwinHistory.findIndex(entry => entry.iTwinId === id && entry.environment === environment);
                if (existingIndex === -1) {
                    ws.userConfig.iTwinHistory.unshift(historyEntry);
                }
            }
            if(ws.userConfig.iTwinHistory.length > 10) {
                // Limit history to the last 10 entries
                ws.userConfig.iTwinHistory = ws.userConfig.iTwinHistory.slice(10);
            }
            await saveUserConfig(ws);

            const iModelChoices = [];
            for await (const iModel of iModelIterator) {
                iModelChoices.push({
                    label: `${iModel.displayName} (ID: ${iModel.id})`,
                    value: iModel.id,
                });
            }

            if (iModelChoices.length === 0) {
                log.error("No iModels found for the provided iTwin ID.");
                return;
            }

            const selectedIModelId = await select({
                message: 'Select an iModel',
                options: iModelChoices,
            });

            if(isCancel(selectedIModelId)) {
                return; // User cancelled the prompt
            }

            iModelId = selectedIModelId;
        } else {
            iModelId = id;
        }

        // get the imodel

    }

    public static createDefaultClientStorage(): ClientStorage {
        return new StrategyClientStorage([
        {
        instanceName: "azure",
        instance: new AzureClientStorage(new BlockBlobClientWrapperFactory()),
        },
        {
        instanceName: "google",
        instance: new GoogleClientStorage(new ClientStorageWrapperFactory()),
        }
        ]);
    }
}