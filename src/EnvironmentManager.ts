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
import { AccessTokenAdapter } from "@itwin/imodels-access-common";
import { Authorization } from "@itwin/imodels-client-management";


export enum Environment {
    PROD = 'PROD',
    QA = 'QA',
    DEV = 'DEV',
}

/**
 * This manages all clients that need to be initialized based on a selected environment.
 * Makes it easier to switch between environments and ensures that the clients are properly initialized.
 */
export class EnvironmentManager {
    private _cacheDir: string;
    private _currentEnvironment: Environment = Environment.PROD;
    private _authClient?: NodeCliAuthorizationClient;
    private _iModelsClient?: IModelsClient;
    private _iTwinsClient?: ITwinsAccessClient;
    private _isSignedIn: boolean = false;
    private _isStartedUp: boolean = false;

    constructor(cacheDir: string) {
        this._cacheDir = cacheDir;
    }

    public get currentEnvironment(): Environment {
        return this._currentEnvironment;
    }

    public get cacheDirectory(): string {
        return this._cacheDir;
    }

    public async selectEnvironment(newEnvironment: Environment): Promise<void> {
        if(newEnvironment !== this._currentEnvironment) {
            await this.shutdown();
            this._currentEnvironment = newEnvironment;
            await this.startup();
        }
    }

    public async startup(): Promise<void> {
        if(this._isStartedUp) {
            return;
        }

        // may have to set HubAccess here if we want to use it, but it needs auth client to be initialized first
        await IModelHost.startup({ 
            cacheDir: this._cacheDir,
        });
        this._isStartedUp = true;
    }

    public async shutdown(): Promise<void> {
        if(this._isStartedUp) {
            this._authClient = undefined;
            this._iModelsClient = undefined;
            this._iTwinsClient = undefined;
            this._isSignedIn = false;
            this._isStartedUp = false;

        await IModelHost.shutdown();
        }
    }

    public get authority(): string {
        const authority = this._currentEnvironment === Environment.PROD
            ? "https://ims.bentley.com/"
            : this._currentEnvironment === Environment.QA
                ? "https://qa-ims.bentley.com/"
                : "https://dev-ims.bentley.com/";
        return authority;
    }

    public get clientId(): string {
        switch (this._currentEnvironment) {
            case Environment.PROD:
            return "native-b517RwSFtag94aBZ5lM40QCf6";
            case Environment.QA:
            return "get a qa key you lazy bum";
            case Environment.DEV:
            return "get a dev key you lazy bum";
            default:
            throw new Error(`Unknown environment: ${this._currentEnvironment}`);
        }
    }

    public async getAccessToken(): Promise<{scheme: string, token: string}> {
        if (this._authClient === undefined) {
            throw new Error("Authorization client is not initialized. Call signInIfNecessary() first.");
        }

        const parts = (await this._authClient.getAccessToken()).split(" ");
        return { scheme: parts[0], token: parts[1] };
    }

    public async getAuthorization(): Promise<Authorization> {
        if (this._authClient === undefined) {
            throw new Error("Authorization client is not initialized. Call signInIfNecessary() first.");
        }

        return AccessTokenAdapter.toAuthorization(await this._authClient!.getAccessToken());
    }
    public get authClient(): NodeCliAuthorizationClient {
        if (!this._authClient) {
            this._authClient = new NodeCliAuthorizationClient({
            issuerUrl: this.authority,
            clientId: this.clientId,
            redirectUri: "http://localhost:3000/signin-callback",
            scope: "itwin-platform"
        });
        }

        return this._authClient;
    }

    public async signInIfNecessary(): Promise<void> {
        if (!this._isSignedIn) {
            await this.authClient.signIn();
        }
    }

    public get iModelsClient(): IModelsClient {
        if (!this._iModelsClient) {
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

            this._iModelsClient = new IModelsClient(iModelsClientOptions);
        }
        return this._iModelsClient;
    }

    public get iTwinsClient(): ITwinsAccessClient {
        if (!this._iTwinsClient) {
            this._iTwinsClient = new ITwinsAccessClient();
        }
        return this._iTwinsClient;
    }

    public async promptEnvironment() : Promise<Environment | symbol> {
        return await select({
            message: "Select an environment",
            options: [
                {label: "PROD", value: Environment.PROD },
                {label: "QA", value: Environment.QA },
                {label: "DEV", value: Environment.DEV },
            ],
            initialValue: this._currentEnvironment,
        });
    }
}