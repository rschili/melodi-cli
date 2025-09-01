import { select, isCancel, log } from "@clack/prompts"
import { BriefcaseDb, ECDb, ECDbOpenMode, ECSqlStatement, IModelDb, SnapshotDb, SQLiteDb, StandaloneDb } from "@itwin/core-backend";
import { ECSqlReader, QueryBinder, QueryOptions } from "@itwin/core-common";
import { OpenMode } from "@itwin/core-bentley";
import { IModelConfig } from "./IModelConfig";
import { Context, WorkspaceFile } from "./Context";
import path from "path";

/**
 * Common interface for all DB implementations.
 * Add or adjust methods as needed.
 */
export type InnerDb = ECDb | StandaloneDb | SnapshotDb | BriefcaseDb | SQLiteDb

/**
 * Generic wrapper that dispatches to a concrete DB implementation.
 * Implements Disposable; will forward dispose() if the concrete instance supports it.
 */
export class UnifiedDb implements Disposable {
    private readonly db: InnerDb;
    private readonly iModelConfig?: IModelConfig;

    public get innerDb(): InnerDb {
        return this.db;
    }

    public get config(): IModelConfig | undefined {
        return this.iModelConfig;
    }

    constructor(dbInstance: InnerDb, iModelConfig?: IModelConfig) {
        this.db = dbInstance;
        this.iModelConfig = iModelConfig;
    }

    public get isOpen(): boolean {
        if (this.db instanceof IModelDb) {
            return this.db.isOpen;
        }
        if (this.db instanceof ECDb) {
            return this.db.isOpen;
        }
        if (this.db instanceof SQLiteDb) {
            return this.db.isOpen;
        }
        throw new Error("Unsupported DB type for isOpen check.");
    }

    public get supportsECSql(): boolean {
        return !(this.db instanceof SQLiteDb);
        }

    public get isReadOnly(): boolean {
        if (this.db instanceof IModelDb) {
            return this.db.isReadonly;
        }
        if (this.db instanceof ECDb) {
            return false; // ECDb cannot tell us if it is read-only, so we assume it is always read-only.
        }
        if (this.db instanceof SQLiteDb) {
            return this.db.isReadonly;
        }
        throw new Error("Unsupported DB type for isReadOnly check.");
    }

    public createQueryReader(ecsql: string, params?: QueryBinder, config?: QueryOptions): ECSqlReader {
        if (this.db instanceof IModelDb) {
            return this.db.createQueryReader(ecsql, params, config);
        }
        if (this.db instanceof ECDb) {
            return this.db.createQueryReader(ecsql, params, config);
        }
        throw new Error("ECSql is not supported by this DB type.");
    }

    public withECSqlStatement<T>(ecsql: string, callback: (stmt: ECSqlStatement) => T, logErrors?: boolean): T {
        if(!this.supportsECSql) {
            throw new Error("ECSql statements are not supported by this DB type.");
        }

        if (this.db instanceof IModelDb) {
            return this.db.withStatement(ecsql, callback, logErrors);
        }
        if (this.db instanceof ECDb) {
            return this.db.withStatement(ecsql, callback, logErrors);
        }
        throw new Error("ECSql statements are not supported by this DB type.");
    }

    public get supportsSchemas(): boolean {
        return this.db instanceof IModelDb || this.db instanceof ECDb;
    }

    public get supportsDumpSchemas(): boolean {
        return this.db instanceof IModelDb;
    }

    public async dumpSchemas(dir: string) : Promise<void> {
        if (this.db instanceof IModelDb) {
            await this.db.exportSchemas(dir);
            return;
        }
        throw new Error("Dumping schemas is not implemented by this DB type (native addon wants at least DgnDb for this). Try StandaloneDb.");
    }

    public get supportsChangesets(): boolean {
        return this.db instanceof BriefcaseDb;
    }


    [Symbol.dispose](): void {
        // All IModelDb instances are not disposable.
        if (this.db instanceof IModelDb) { // Handles BriefcaseDb, SnapshotDb, StandaloneDb
            if(this.db.isOpen) {
                this.db.close();
            }
            return;
        }

        if (this.db instanceof ECDb) {
            if(this.db.isOpen) {
                this.db.closeDb();
            }
            this.db[Symbol.dispose]();
            return;
        }

        if (this.db instanceof SQLiteDb) {
            if(this.db.isOpen) {
                this.db.closeDb();
            }
            return;
        }
    }
}

/**
 * Factory and opener functions for each DB type.
 */
export async function openECDb(path: string): Promise<UnifiedDb | symbol> {
    const mode = await promptECDbOpenMode();
    if (isCancel(mode)) {
        return mode; // User cancelled the prompt
    }
    const db = new ECDb();
    db.openDb(path, mode);
    return new UnifiedDb(db);
}

export function createECDb(path: string): UnifiedDb {
    const db = new ECDb();
    db.createDb(path);
    return new UnifiedDb(db);
}

export async function openStandaloneDb(path: string): Promise<UnifiedDb | symbol> {
    const mode = await promptOpenMode();
    if (isCancel(mode)) {
        return mode; // User cancelled the prompt
    }
    const db = StandaloneDb.openFile(path, mode);
    return new UnifiedDb(db);
}

export async function openSnapshotDb(path: string): Promise<UnifiedDb | symbol> {
    const db = SnapshotDb.openFile(path);
    return new UnifiedDb(db);
}

export function createStandaloneDb(path: string, rootSubject: string): UnifiedDb {
    const db = StandaloneDb.createEmpty(path, { rootSubject: { name: rootSubject } });
    return new UnifiedDb(db);
}

export async function openBriefcaseDb(ctx: Context, file: WorkspaceFile, config: IModelConfig): Promise<UnifiedDb | symbol> {
    if (config === undefined) {
        throw new Error(`No iModel config found for file ${file.relativePath}. This file should exist for pulled imodels.`);
    }
    const absolutePath = path.join(ctx.folders.rootDir, file.relativePath);
    await ctx.envManager.selectEnvironment(config.environment);
    await ctx.envManager.signInIfNecessary();
    const mode = await promptOpenMode();
    const db = await BriefcaseDb.open({ fileName: absolutePath, key: config.iModelId, readonly: mode === OpenMode.Readonly });
    if(db.iModelId !== config.iModelId) {
        log.warn(`The iModel ID in the config (${config.iModelId}) does not match the opened iModel ID (${db.iModelId}). This may indicate a mismatch between the config and the file.`);
    }
    return new UnifiedDb(db);
}

async function promptECDbOpenMode(): Promise<ECDbOpenMode | symbol> {
    return await select({
        message: 'Select the open mode for the file',
        options: [
        { label: "Open in read-only mode", value: ECDbOpenMode.Readonly },
        { label: "Open in read-write mode", value: ECDbOpenMode.ReadWrite },
        { label: "Open the file in read-write mode and upgrade it to the latest file format version if necessary.", value: ECDbOpenMode.FileUpgrade },
        ],
    });
}

async function promptOpenMode(): Promise<OpenMode | symbol> {
    return await select({
        message: 'Select the open mode for the file',
        options: [
        { label: "Open in read-only mode", value: OpenMode.Readonly },
        { label: "Open in read-write mode", value: OpenMode.ReadWrite },
        ],
    });
}

/*
        //Snapshot iModels are a static point-in-time representation of the state of an iModel. Once created, they can not be modified.
        const db = SnapshotDb.openFile(path.join(ws.workspaceRootPath, file.relativePath));
        */