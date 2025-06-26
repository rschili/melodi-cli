
import { NodeCliAuthorizationClient } from "@itwin/node-cli-authorization";
import { GoogleClientStorage } from "@itwin/object-storage-google/lib/client";
import { ClientStorageWrapperFactory } from "@itwin/object-storage-google/lib/client/wrappers";
import { AzureClientStorage, BlockBlobClientWrapperFactory } from "@itwin/object-storage-azure";
import { ClientStorage, StrategyClientStorage} from "@itwin/object-storage-core";
import { IModelsClient, IModelsClientOptions } from "@itwin/imodels-client-authoring";
import { printError, formatError, logError } from "../ConsoleHelper";
import { Environment, Workspace } from "../Workspace";
import { DbApiKind } from "./FileActions";
import { log, select, spinner, text, isCancel } from "@clack/prompts";

export class NewFile {
    public static async run(ws: Workspace): Promise<void> {
        const workspaceType = await select({
            message: 'Which API do you want to use to create a file?',
            options: [
                { label: 'Briefcase', value: DbApiKind.BriefcaseDb },
                { label: 'ECDb', value: DbApiKind.ECDb },
                { label: 'Standalone', value: DbApiKind.StandaloneDb },
                { label: 'Snapshot', value: DbApiKind.SnapshotDb },
                { label: 'SQLite', value: DbApiKind.SQLiteDb },
            ],
        });

        if(isCancel(workspaceType)) {
            return; // User cancelled the prompt
        }

        switch (workspaceType) {
            case DbApiKind.BriefcaseDb:
                return this.initBriefcase();
            case DbApiKind.ECDb:
                throw new Error("ECDb workspace initialization is not yet implemented.");
            case DbApiKind.StandaloneDb:
                throw new Error("StandaloneDb workspace initialization is not yet implemented.");
            case DbApiKind.SnapshotDb:
                throw new Error("SnapshotDb workspace initialization is not yet implemented.");
            case DbApiKind.SQLiteDb:
                throw new Error("SQLiteDb workspace initialization is not yet implemented.");
        }
    }

    public static async initBriefcase(): Promise<void> {
        const environment = await select({
            message: "Select an environment",
            options: [
                {label: "PROD", value: Environment.PROD },
                {label: "QA", value: Environment.QA },
                {label: "DEV", value: Environment.DEV },
            ],
        });

        if(isCancel(environment)) {
            return; // User cancelled the prompt
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

        const method = await select({
            message: 'Choose the method to connect',
            options: [
                { label: "Load available iModel IDs for a provided iTwin ID", value: "iTwin" },
                { label: "Load a single iModel by ID", value: "iModel" }
            ],
        });

        if (isCancel(method)) {
            return; // User cancelled the prompt
        }

        let iModelId: string | undefined = undefined;

        const id = await text({
            message: `Please provide the ${method} ID`,
        });

        if (isCancel(id)) {
            return; // User cancelled the prompt
        }

        if (method === "iTwin") {
            const iModelIterator = iModelsCLient.iModels.getMinimalList({
                    authorization: getTokenCallback,
                    urlParams: {
                        iTwinId: id,
                    },
                });

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