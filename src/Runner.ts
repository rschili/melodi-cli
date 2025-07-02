
import { loadWorkspace, saveWorkspaceConfig, Workspace } from "./Workspace.js";
import { applicationVersion } from "./Diagnostics.js";
import { formatPath, formatWarning } from "./ConsoleHelper.js";
import { FileSelector } from "./Logic/FileSelector.js";
import * as fs from 'fs';
import { Logger } from "./Logger.js";
import { LogLevel } from "@itwin/core-bentley";
import { confirm, isCancel } from '@clack/prompts'
import { UserConfig } from "./Workspace.UserConfig.js";

export class Runner {
    public async run(cfg: UserConfig): Promise<void> {
        const ws: Workspace = await loadWorkspace(cfg);
        const activeMelodiVersion = applicationVersion;
        Logger.setLevel(ws.userConfig.logging ?? LogLevel.None);
        if(ws.config !== undefined) {
            console.log(`Detected workspace at: ${formatPath(ws.workspaceRootPath)}`);
            if(ws.config.melodiVersion !== activeMelodiVersion) {
                console.log(formatWarning(`The workspace was saved using a different version of melodi (${ws.config.melodiVersion}). Running version (${activeMelodiVersion}).`));
            }
        } else {
            console.log(`No workspace configuration found.`);
            const response = await confirm({
                message: `Do you want to initialize a new workspace at ${formatPath(ws.workspaceRootPath)}?`,
            });

            if(!isCancel(response)) {
                return;
            }

            if(!response)
                return;

        await Runner.initWorkspace(ws);
        }

        if (!fs.existsSync(ws.envManager.cacheDirectory)) {
            await fs.promises.mkdir(ws.envManager.cacheDirectory, { recursive: true });
        }

        try {
            await ws.envManager.startup();
            await FileSelector.run(ws);
        } finally {
            await ws.envManager.shutdown();
        }
    }

    private static async initWorkspace(ws: Workspace): Promise<void> {
        if (ws.config !== undefined) {
            throw new Error("The 'config' property must be undefined during initialization.");
        }

        ws.config = { melodiVersion: applicationVersion};
        await saveWorkspaceConfig(ws);
        await FileSelector.run(ws);
    }
}