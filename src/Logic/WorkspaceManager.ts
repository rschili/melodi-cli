import Listr from "listr";
import { detectWorkspaceFiles, Workspace } from "../Workspace";
import { withTimeout } from "../PromiseHelper";

export class WorkspaceManager {
    public static async run(ws: Workspace): Promise<void> {
        if(ws.config === undefined) {
            throw new Error("The 'config' property must be undefined during initialization.");
        }

        // identify all existing files in the workspace
        const tasks = new Listr([
            {
                title: 'Loading workspace contents',
                task: () => withTimeout(() => detectWorkspaceFiles(ws), 15),
            },
        ]);

        await tasks.run();

    }

    
}