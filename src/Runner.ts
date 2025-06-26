
import { loadWorkspace, Workspace } from "./Workspace";
import { applicationVersion } from "./Diagnostics";
import { Initialize } from "./Logic/Initialize";
import { formatPath, formatWarning } from "./ConsoleHelper";
import { WorkspaceManager } from "./Logic/WorkspaceManager";
import * as fs from 'fs';
import { IModelHost } from "@itwin/core-backend";
import { Logger } from "./Logger";
import { LogLevel } from "@itwin/core-bentley";
import { confirm } from '@clack/prompts'
import { isCancel } from "axios";

export class Runner {
    public async run(): Promise<void> {
        const ws: Workspace = await loadWorkspace();
        const activeMelodiVersion = applicationVersion;
        Logger.setLevel(ws.userConfig.logging ?? LogLevel.None);

        console.log(`User settings directory: ${formatPath(ws.userConfigDirPath)}`);
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

        await Initialize.run(ws);
        }

        if (!fs.existsSync(ws.envManager.cacheDirectory)) {
            await fs.promises.mkdir(ws.envManager.cacheDirectory, { recursive: true });
        }

        try {
            await ws.envManager.startup();
            await WorkspaceManager.run(ws);
        } finally {
            await ws.envManager.shutdown();
        }
    }
}