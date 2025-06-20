
import prompts from "prompts";
import { NodeCliAuthorizationClient } from "@itwin/node-cli-authorization";
import { GoogleClientStorage } from "@itwin/object-storage-google/lib/client";
import { ClientStorageWrapperFactory } from "@itwin/object-storage-google/lib/client/wrappers";
import { AzureClientStorage, BlockBlobClientWrapperFactory } from "@itwin/object-storage-azure";
import { ClientStorage, StrategyClientStorage} from "@itwin/object-storage-core";
import { IModelsClient, IModelsClientOptions } from "@itwin/imodels-client-authoring";
import { LogBuffer } from "../LogBuffer";
import { withTimeout } from "../PromiseHelper";
import yoctoSpinner from "yocto-spinner";
import { printError, formatError, exitProcessOnAbort } from "../ConsoleHelper";
import { Environment, FileType, Workspace } from "../Workspace";

export class NewFile {
    public static async run(ws: Workspace): Promise<void> {
        const workspaceTypeAnswer = await prompts({
            name: "value",
            type: "select",
            message: 'What type of file do you want to create?',
            choices: [
                { title: 'Briefcase', value: FileType.BRIEFCASE, description: 'Connects to iModelHub and pulls a briefcase of an existing iModel you have access to.' },
                { title: 'ECDb', value: FileType.ECDB, description: 'Initialize with a blank ECDb (SQLite) database.' },
                { title: 'Standalone', value: FileType.STANDALONE, description: 'Creates an empty standalone iModel.' },
            ],
            initial: 0,
            onState: exitProcessOnAbort,
        });
        const workspaceType: FileType = workspaceTypeAnswer.value;

        switch (workspaceType) {
            case FileType.BRIEFCASE:
                return this.initBriefcase();
            case FileType.ECDB:
                throw new Error("ECDb workspace initialization is not yet implemented.");
            case FileType.STANDALONE:
                throw new Error("Standalone workspace initialization is not yet implemented.");
        }
    }

    public static async initBriefcase(): Promise<void> {
        const envAnswer = await prompts({
            name: "value",
            type: "select",
            message: "Select an environment",
            choices: [
                {title: "PROD", value: Environment.PROD },
                {title: "QA", value: Environment.QA },
                {title: "DEV", value: Environment.DEV },
            ],
            initial: 0,
            onState: exitProcessOnAbort,
        });
        const environment = envAnswer.value as Environment;

        const authority = environment === Environment.PROD ? "https://ims.bentley.com/" : environment === Environment.QA ? "https://qa-ims.bentley.com/" : "https://dev-ims.bentley.com/";
        if(environment !== Environment.PROD) {
            throw new Error(`Environment ${environment} is not supported yet. Please use PROD.`);
        }

        const authClient = new NodeCliAuthorizationClient({
            issuerUrl: authority,
            clientId: "native-b517RwSFtag94aBZ5lM40QCf6",
            redirectUri: "http://localhost:3000/signin-callback",
            scope: "itwin-platform"
        });


        // collect nested logs
        var logger = new LogBuffer();

        const spinner = yoctoSpinner({text: "Signing in (please check for a browser window)..." });
        try {
            logger.start();
            spinner.start();
            await withTimeout(authClient.signIn(), 30);
            spinner.success("Sign in successful.");
        }
        catch (error: unknown) {
            spinner.error("Sign in failed.");
            printError(error);
            logger.restorePrintAndClear();
            throw error;
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

        const methodAnswer = await prompts({
            name: "value",
            type: "select",
            message: 'Choose the method to connect',
            choices: [
                { title: "Load available iModel IDs for a provided iTwin ID", value: "iTwin" },
                { title: "Load a single iModel by ID", value: "iModel" }
            ],
            initial: 0,
            onState: exitProcessOnAbort,
        });
        const method: "iTwin" | "iModel" = methodAnswer.value;

        let iModelId: string | undefined = undefined;

        const idAnswer = await prompts({
            name: "value",
            type: "text",
            message: `Please provide the ${method} ID`,
            onState: exitProcessOnAbort,
        });
        const id = idAnswer.value;

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
                    title: `${iModel.displayName} (ID: ${iModel.id})`,
                    value: iModel.id,
                });
            }

            if (iModelChoices.length === 0) {
                console.error(formatError("No iModels found for the provided iTwin ID."));
                return;
            }

            const iModelAnswer = await prompts({
                name: "value",
                type: "select",
                message: 'Select an iModel',
                choices: iModelChoices,
                initial: 0,
                onState: exitProcessOnAbort,
            });
            iModelId = iModelAnswer.value;
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