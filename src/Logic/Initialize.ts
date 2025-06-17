import { select, input } from "@inquirer/prompts";
import { Environment, WorkspaceType } from "../Interfaces";
import { WorkspaceProps } from "../Workspace";
import { NodeCliAuthorizationClient } from "@itwin/node-cli-authorization";
import { GoogleClientStorage } from "@itwin/object-storage-google/lib/client";
import { ClientStorageWrapperFactory } from "@itwin/object-storage-google/lib/client/wrappers";
import { AzureClientStorage, BlockBlobClientWrapperFactory } from "@itwin/object-storage-azure";
import { ClientStorage, StrategyClientStorage} from "@itwin/object-storage-core";
import { IModelsClient, IModelsClientOptions } from "@itwin/imodels-client-authoring";
import { LogBuffer } from "../LogBuffer";
import Listr from "listr";
import { withTimeout } from "../PromiseHelper";
import { formatError, printError } from "../ConsoleFormatter";

export class Initialize {
    public static async run(props: WorkspaceProps): Promise<void> {
        if (props.config !== undefined) {
            throw new Error("The 'config' property must be undefined during initialization.");
        }

        const workspaceType: WorkspaceType = await select({
            message: 'What type of workspace do you want to initialize?',
            choices: [
                { name: 'Briefcase', value: WorkspaceType.BRIEFCASE, description: 'Connects to iModelHub and pulls a briefcase of an existing iModel you have access to.' },
                { name: 'ECDb', value: WorkspaceType.ECDB, description: 'Initialize with a blank or existing ECDb (SQLite) database for local testing.' },
                { name: 'Standalone', value: WorkspaceType.STANDALONE, description: 'Creates a standalone iModel for local testing.' },
            ],
        });

        switch (workspaceType) {
            case WorkspaceType.BRIEFCASE:
                return this.initBriefcase();
            case WorkspaceType.ECDB:
                throw new Error("ECDb workspace initialization is not yet implemented.");
            case WorkspaceType.STANDALONE:
                throw new Error("Standalone workspace initialization is not yet implemented.");
        }
    }

    public static async initBriefcase(): Promise<void> {
        const environment: Environment = await select({
            message: 'Select an environment',
            choices: [Environment.PROD, Environment.QA, Environment.DEV],
        });

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

        try {
            logger.start();

            const tasks = new Listr([
                {
                    title: 'Signing in (please check for a browser window)',
                    task: () => withTimeout(() => authClient.signIn(), 30),
                },
            ]);

            await tasks.run();
        }
        catch (error: unknown) {
            printError(error);
            logger.restorePrintAndClear();
            throw error;
        }

        const getTokenCallback = async () => {
            const parts = (await authClient.getAccessToken()).split(" ");
            return { scheme: parts[0], token: parts[1] };
            };

        const iModelsClientOptions: IModelsClientOptions = {
            cloudStorage: Initialize.createDefaultClientStorage(),
        }

        /*if(environment === Environment.DEV) {
            iModelsClientOptions.api = {baseUrl: "https://dev-api.bentley.com/imodels"};
        } else if (environment === Environment.QA) {
            iModelsClientOptions.api = {baseUrl: "https://qa-api.bentley.com/imodels"};
        }*/
        const iModelsCLient = new IModelsClient(iModelsClientOptions);

        const method: "iTwin" | "iModel" = await select({
            message: 'Choose the method to connect',
            choices: [ { value: "iTwin", name: "Load available iModel IDs for a provided iTwin ID" },
                { value: "iModel", name: "Load a single iModel by ID" }],
        });

        let iModelId: string | undefined = undefined;

        const id = await input({message: `Please provide the ${method} ID`});
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
                    name: `${iModel.displayName} (ID: ${iModel.id})`,
                    value: iModel.id,
                });
            }

            iModelId = await select({
                message: 'Select an iModel',
                choices: iModelChoices,
            });
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