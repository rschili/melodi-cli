import { FileType, Workspace, WorkspaceFile } from "../Workspace";
import { ECDbOpenMode } from "@itwin/core-backend";
import { ECDbEditor } from "./ECDbEditor";
import prompts from "prompts";
import { exitProcessOnAbort } from "../ConsoleHelper";

export class OpenFile {
    public static async run(ws: Workspace, file: WorkspaceFile): Promise<void> {
        if (ws.config === undefined) {
            throw new Error("The 'config' property must be defined before opening a file.");
        }

        enum DbApiKind {
            ECDb,
            iModelDb,
        }

        let dbApiKind: DbApiKind = DbApiKind.ECDb;
        if (file.fileType === FileType.BRIEFCASE || file.fileType === FileType.STANDALONE) {
            const dbApiKindResponse = await prompts({
            type: 'select',
            name: 'dbApiKind',
            message: 'You can open the file as low level ECDb or as iModelDb. Which one do you want to use?',
            choices: [
                { title: "Open as ECDb", value: DbApiKind.ECDb },
                { title: "Open as iModelDb", value: DbApiKind.iModelDb },
            ],
            initial: 1, // Default to iModelDb
            onState: exitProcessOnAbort,
            });
            dbApiKind = dbApiKindResponse.dbApiKind;
        }

        const openModeResponse = await prompts({
            type: 'select',
            name: 'openMode',
            message: 'Select the open mode for the file',
            choices: [
            { title: "Open in read-only mode", value: ECDbOpenMode.Readonly },
            { title: "Open in read-write mode", value: ECDbOpenMode.ReadWrite },
            { title: "Open the file in read-write mode and upgrade it to the latest file format version if necessary.", value: ECDbOpenMode.FileUpgrade },
            ],
            initial: 0, // Default to Readonly
            onState: exitProcessOnAbort,
        });
        const openMode = openModeResponse.openMode;

        if(dbApiKind === DbApiKind.ECDb) {
            await ECDbEditor.run(ws, file, openMode);
            return;
        }

    }
}