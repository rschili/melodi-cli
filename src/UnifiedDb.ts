import { select, isCancel } from "@clack/prompts"
import { BriefcaseDb, ECDb, ECDbOpenMode, IModelDb, SnapshotDb, SQLiteDb, StandaloneDb } from "@itwin/core-backend";
import { ECSqlReader, QueryBinder, QueryOptions } from "@itwin/core-common";
import { OpenMode } from "@itwin/core-bentley";

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

    public get innerDb(): InnerDb {
        return this.db;
    }

    constructor(dbInstance: InnerDb) {
        this.db = dbInstance;
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
        //A local copy of an iModel from iModelHub that can pull and potentially push changesets.
        const db2 = BriefcaseDb.open({ fileName: path.join(ws.workspaceRootPath, file.relativePath)});
        //Standalone iModels are read/write files that are not associated with an iTwin or managed by iModelHub.
        const db3 = StandaloneDb.openFile(path.join(ws.workspaceRootPath, file.relativePath));
        */