import { Workspace, WorkspaceFile } from "../Workspace";
import { ECDbOpenMode } from "@itwin/core-backend";
import { DbEditor } from "./FileEditor";
import { select } from "@inquirer/prompts";
import { Backup } from "./Backup";
import { openECDb, UnifiedDb } from "../UnifiedDb";
import path from "path";

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
            choices: [
                { name: "Open as BriefcaseDb", value: DbApiKind.BriefcaseDb, short: "BriefcaseDb" },
                { name: "Open as StandaloneDb", value: DbApiKind.StandaloneDb, short: "StandaloneDb" },
                { name: "Open as SnapshotDb", value: DbApiKind.SnapshotDb, short: "SnapshotDb" },
                { name: "Open as ECDb", value: DbApiKind.ECDb, short: "ECDb" },
                { name: "Open as SQLiteDb", value: DbApiKind.SQLiteDb, short: "SQLiteDb" },
                { name: "Create a backup in the same workspace", value: "__backup__", short: "Backup" },
            ],
        });

        if(response === "__backup__") {
            // Create a backup of the file in the same workspace
            await Backup.run(ws, file);
            return;
            }

        const dbApiKind = response as DbApiKind;
        const absolutePath = path.join(ws.workspaceRootPath, file.relativePath);
        using db = await this.openDb(dbApiKind, absolutePath);
        await DbEditor.run(ws, file, db);
    }

    private static openDb(kind: DbApiKind, absolutePath: string): Promise<UnifiedDb> {
        switch (kind) {
            case DbApiKind.BriefcaseDb:
            case DbApiKind.StandaloneDb:
            case DbApiKind.SnapshotDb:
            case DbApiKind.SQLiteDb:
                // These types are not supported in the current implementation.
                throw new Error("The selected DB type is not supported in this version of the tool.");
            case DbApiKind.ECDb:
                return openECDb(absolutePath);
        }
    }
}