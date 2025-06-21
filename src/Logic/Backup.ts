import { Workspace, WorkspaceFile } from "../Workspace";

export class Backup {
    public static async run(ws: Workspace, file: WorkspaceFile): Promise<void> {
        if (ws.config === undefined) {
            throw new Error("The 'config' property must be defined before creating a backup.");
        }

        throw new Error("Backup functionality is not implemented yet. Please implement the backup logic for the workspace and file.");
    }
}