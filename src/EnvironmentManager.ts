import { select } from "@clack/prompts";
import { IModelHost } from "@itwin/core-backend";
import { ECClass, EntityClass, RelationshipClass } from "@itwin/ecschema-metadata";
import { IModelsClient, IModelsClientOptions } from "@itwin/imodels-client-authoring";
import { ITwinsAccessClient } from "@itwin/itwins-client";
import { NodeCliAuthorizationClient } from "@itwin/node-cli-authorization";
import { AzureClientStorage, BlockBlobClientWrapperFactory } from "@itwin/object-storage-azure";
import { StrategyClientStorage } from "@itwin/object-storage-core";
import { GoogleClientStorage } from "@itwin/object-storage-google/lib/client";
import { ClientStorageWrapperFactory } from "@itwin/object-storage-google/lib/client/wrappers";

export enum Environment {
    PROD = 'PROD',
    QA = 'QA',
    DEV = 'DEV',
}

export class EnvironmentManager {
    private cacheDir: string;
    private currentEnvironment: Environment = Environment.PROD;
    private authClient?: NodeCliAuthorizationClient;
    private iModelsClient?: IModelsClient;
    private iTwinsClient?: ITwinsAccessClient;
    private isSignedIn: boolean = false;
    private isStartedUp: boolean = false;

    constructor(cacheDir: string) {
        this.cacheDir = cacheDir;
    }

    public get environment(): Environment {
        return this.currentEnvironment;
    }

    public get cacheDirectory(): string {
        return this.cacheDir;
    }

    public changeEnvironment(newEnvironment: Environment, cacheDir: string): void {
        if(newEnvironment !== this.currentEnvironment) {
            this.shutdown();
            this.currentEnvironment = newEnvironment;
            this.startup();
        }
    }

    public async startup(): Promise<void> {
        if(this.isStartedUp) {
            return;
        }

        // may have to set HubAccess here if we want to use it, but it needs auth client to be initialized first
        await IModelHost.startup({ 
            cacheDir: this.cacheDir,
        });
        this.isStartedUp = true;
    }

    public async shutdown(): Promise<void> {
        if(this.isStartedUp) {
            this.authClient = undefined;
            this.iModelsClient = undefined;
            this.iTwinsClient = undefined;
            this.isSignedIn = false;
            this.isStartedUp = false;

        await IModelHost.shutdown();
        }
    }

    public get authority(): string {
        const authority = this.currentEnvironment === Environment.PROD
            ? "https://ims.bentley.com/"
            : this.currentEnvironment === Environment.QA
                ? "https://qa-ims.bentley.com/"
                : "https://dev-ims.bentley.com/";
        return authority;
    }

    public get clientId(): string {
        switch (this.currentEnvironment) {
            case Environment.PROD:
            return "native-b517RwSFtag94aBZ5lM40QCf6";
            case Environment.QA:
            return "get a qa key you lazy bum";
            case Environment.DEV:
            return "get a dev key you lazy bum";
            default:
            throw new Error(`Unknown environment: ${this.currentEnvironment}`);
        }
    }

    public async getAccessToken(): Promise<{scheme: string, token: string}> {
        if (this.authClient === undefined) {
            throw new Error("Authorization client is not initialized. Call signInIfNecessary() first.");
        }

        const parts = (await this.authClient.getAccessToken()).split(" ");
        return { scheme: parts[0], token: parts[1] };
    }
    public get auth(): NodeCliAuthorizationClient {
        if (!this.authClient) {
            this.authClient = new NodeCliAuthorizationClient({
            issuerUrl: this.authority,
            clientId: this.clientId,
            redirectUri: "http://localhost:3000/signin-callback",
            scope: "itwin-platform"
        });
        }

        return this.authClient;
    }

    public async signInIfNecessary(): Promise<void> {
        if (!this.isSignedIn) {
            await this.auth.signIn();
        }
    }

    public get iModels(): IModelsClient {
        if (!this.iModelsClient) {
            const iModelsClientOptions: IModelsClientOptions = {
                cloudStorage: new StrategyClientStorage([
                    {
                    instanceName: "azure",
                    instance: new AzureClientStorage(new BlockBlobClientWrapperFactory()),
                    },
                    {
                    instanceName: "google",
                    instance: new GoogleClientStorage(new ClientStorageWrapperFactory()),
                    }
                    ]),
            }

            this.iModelsClient = new IModelsClient(iModelsClientOptions);
        }
        return this.iModelsClient;
    }

    public get iTwins(): ITwinsAccessClient {
        if (!this.iTwinsClient) {
            this.iTwinsClient = new ITwinsAccessClient();
        }
        return this.iTwinsClient;
    }

    public static async promptEnvironment(selected: Environment) : Promise<Environment | symbol> {
        return await select({
            message: "Select an environment",
            options: [
                {label: "PROD", value: Environment.PROD },
                {label: "QA", value: Environment.QA },
                {label: "DEV", value: Environment.DEV },
            ],
        });
    }
}