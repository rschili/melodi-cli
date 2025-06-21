import { FileType, Workspace, WorkspaceFile } from "../Workspace";
import { ECDbOpenMode } from "@itwin/core-backend";
import { ECDbEditor } from "./ECDbEditor";
import { select } from "@inquirer/prompts";
import { Backup } from "./Backup";

export class FileOperations {
    public static async run(ws: Workspace, file: WorkspaceFile): Promise<void> {
        if (ws.config === undefined) {
            throw new Error("The 'config' property must be defined before opening a file.");
        }

        enum DbApiKind {
            ECDb,
            iModelDb,
        }

        let response: DbApiKind | string | undefined; 
        if (file.fileType === FileType.BRIEFCASE || file.fileType === FileType.STANDALONE) {
            const dbApiKindResponse = await select<DbApiKind | string>({
                message: 'You can open the file as low level ECDb or as iModelDb. Which one do you want to use?',
                choices: [
                    { name: "Open as ECDb", value: DbApiKind.ECDb },
                    { name: "Open as iModelDb", value: DbApiKind.iModelDb },
                    { name: "Create a backup in the same workspace", value: "__backup__" },
                ],
            });
        } else {
            const dbApiKindResponse = await select<DbApiKind | string>({
                message: 'You can open the file as low level ECDb or as iModelDb. Which one do you want to use?',
                choices: [
                    { name: "Open", value: DbApiKind.ECDb },
                    { name: "Create a backup in the same workspace", value: "__backup__" },
                ],
            });
        }

        if(response === "__backup__") {
            // Create a backup of the file in the same workspace
            await Backup.run(ws, file);
            return;
            }

        const dbApiKind = response as DbApiKind;

        const openMode = await select({
            message: 'Select the open mode for the file',
            choices: [
            { name: "Open in read-only mode", value: ECDbOpenMode.Readonly },
            { name: "Open in read-write mode", value: ECDbOpenMode.ReadWrite },
            { name: "Open the file in read-write mode and upgrade it to the latest file format version if necessary.", value: ECDbOpenMode.FileUpgrade },
            ],
        });

        if(dbApiKind === DbApiKind.ECDb) {
            await ECDbEditor.run(ws, file, openMode);
            return;
        }

    }
}