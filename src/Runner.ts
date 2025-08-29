
import { loadWorkspace, saveWorkspaceConfig, Workspace } from "./Workspace";
import { applicationVersion } from "./Diagnostics";
import { formatPath, formatSuccess } from "./ConsoleHelper";
import { FileSelector } from "./Logic/FileSelector";
import * as fs from 'fs';
import { Logger } from "./Logger";
import { LogLevel } from "@itwin/core-bentley";
import { confirm, isCancel } from '@clack/prompts'
import { UserConfig } from "./Workspace.UserConfig";
import chalk from "chalk";

export class Runner {
    public async run(cfg: UserConfig): Promise<void> {
        const ws: Workspace = await loadWorkspace(cfg);
        const activeMelodiVersion = applicationVersion;
        Logger.setLevel(ws.userConfig.logging ?? LogLevel.None);
        if(ws.config !== undefined) {
            console.log(`Detected workspace at: ${formatPath(ws.workspaceRootPath)}`);
            if(ws.config.melodiVersion !== activeMelodiVersion) {
                console.log(formatSuccess(`The workspace was saved using a different version of melodi (${ws.config.melodiVersion}). Running version (${activeMelodiVersion}).`));
            }
        } else {
            console.log('This directory is not a workspace. A workspace is like a project folder that contains your files and keeps track of your settings and history.');
            console.log(`Current directory: ${formatPath(ws.workspaceRootPath)}?`);
            if (fs.readdirSync(ws.workspaceRootPath).length !== 0) {
                console.log(chalk.yellow('Warning: This directory is not empty.'));
            }
            const response = await confirm({
                message: 'Would you like to initialize a new workspace here?',
            });

            if(isCancel(response)) {
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
    }
}