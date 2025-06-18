import { saveWorkspaceConfig, Workspace } from "../Workspace";
import { applicationVersion } from "../Diagnostics";
import { WorkspaceManager } from "./WorkspaceManager";

export class Initialize {
    public static async run(ws: Workspace): Promise<void> {
        if (ws.config !== undefined) {
            throw new Error("The 'config' property must be undefined during initialization.");
        }

        ws.config = { melodiVersion: applicationVersion};
        await saveWorkspaceConfig(ws);
        await WorkspaceManager.run(ws);
    }
}