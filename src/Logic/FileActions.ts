import { Workspace, WorkspaceFile } from "../Workspace";
import { DbEditor } from "./DbEditor";
import { Backup } from "./Backup";
import { openBriefcaseDb, openECDb, openStandaloneDb, UnifiedDb } from "../UnifiedDb";
import path from "path";
import { select, isCancel, log } from "@clack/prompts"

export enum DbApiKind {
    BriefcaseDb,
    StandaloneDb,
    SnapshotDb,
    ECDb,
    SQLiteDb,
}

export class FileActions {
    public static async run(ws: Workspace, file: WorkspaceFile): Promise<void> {
        if (ws.config === undefined) {
            throw new Error("The 'config' property must be defined before opening a file.");
        }

        const response = await select<DbApiKind | string>({
            message: `Choose an action for file ${file.relativePath}`,
            options: [
                { label: "Open as BriefcaseDb", value: DbApiKind.BriefcaseDb },
                { label: "Open as StandaloneDb", value: DbApiKind.StandaloneDb },
                { label: "Open as SnapshotDb", value: DbApiKind.SnapshotDb },
                { label: "Open as ECDb", value: DbApiKind.ECDb },
                { label: "Open as SQLiteDb", value: DbApiKind.SQLiteDb },
                { label: "Create a backup in the same workspace", value: "__backup__" },
            ],
        });

        if(isCancel(response)) {
            return;
        }

        if(response === "__backup__") {
            // Create a backup of the file in the same workspace
            await Backup.run(ws, file);
            return;
            }

        const dbApiKind = response as DbApiKind;
        
        try {
            const db = await this.openDb(dbApiKind, ws, file);
            if (isCancel(db)) {
                return;
            }
            await DbEditor.run(ws, file, db);
        }
        catch (error: unknown) {
            log.error(`Failed to open file ${file.relativePath} as ${DbApiKind[dbApiKind]}: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
    }

    private static openDb(kind: DbApiKind, ws: Workspace, file: WorkspaceFile): Promise<UnifiedDb | symbol> {
        const absolutePath = path.join(ws.workspaceRootPath, file.relativePath);
        switch (kind) {
            case DbApiKind.BriefcaseDb:
                return openBriefcaseDb(ws, file);
            case DbApiKind.StandaloneDb:
                return openStandaloneDb(absolutePath);
            case DbApiKind.SnapshotDb:
            case DbApiKind.SQLiteDb:
                // These types are not supported in the current implementation.
                throw new Error("The selected DB type is not supported in this version of the tool.");
            case DbApiKind.ECDb:
                return openECDb(absolutePath);
        }
    }
}