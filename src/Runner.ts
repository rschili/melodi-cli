
import { loadWorkspace, Workspace } from "./Workspace";
import { applicationVersion } from "./Diagnostics";
import { Initialize } from "./Logic/Initialize";
import { formatPath, formatWarning } from "./ConsoleHelper";
import { WorkspaceManager } from "./Logic/WorkspaceManager";
import * as fs from 'fs';
import { confirm } from "@inquirer/prompts";
import { IModelHost } from "@itwin/core-backend";
import { Logger } from "./Logger";
import { LogLevel } from "@itwin/core-bentley";

export class Runner {
    public async run(): Promise<void> {
        const workspace: Workspace = await loadWorkspace();
        const activeMelodiVersion = applicationVersion;
        Logger.setLevel(workspace.userConfig.logging ?? LogLevel.None);

        console.log(`User settings directory: ${formatPath(workspace.userConfigDirPath)}`);
        if(workspace.config !== undefined) {
            console.log(`Detected workspace at: ${formatPath(workspace.workspaceRootPath)}`);
            if(workspace.config.melodiVersion !== activeMelodiVersion) {
                console.log(formatWarning(`The workspace was saved using a different version of melodi (${workspace.config.melodiVersion}). Running version (${activeMelodiVersion}).`));
            }
        } else {
            console.log(`No workspace configuration found.`);
            const response = await confirm({
                message: `Do you want to initialize a new workspace at ${formatPath(workspace.workspaceRootPath)}?`,
            });

            if(!response)
                return;

        await Initialize.run(workspace);
        }

        if (!fs.existsSync(workspace.cacheDirPath)) {
            await fs.promises.mkdir(workspace.cacheDirPath, { recursive: true });
        }

        // Initialize the IModelHost here so it's ready. If we connect to a briefcase we will have to re-initialize it with hubAccess available.
        await IModelHost.startup({
            cacheDir: workspace.cacheDirPath,
        });

        try {
            await WorkspaceManager.run(workspace);
        } finally {
            await IModelHost.shutdown();
        }
    }
}