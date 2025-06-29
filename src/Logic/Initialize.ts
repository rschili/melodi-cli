import { saveWorkspaceConfig, Workspace } from "../Workspace.js";
import { applicationVersion } from "../Diagnostics.js";
import { WorkspaceManager } from "./WorkspaceManager.js";

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