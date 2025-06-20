
import { loadWorkspace, Workspace } from "./Workspace";
import { applicationVersion } from "./Diagnostics";
import { Initialize } from "./Logic/Initialize";
import { exitProcessOnAbort, formatPath, formatWarning } from "./ConsoleHelper";
import { WorkspaceManager } from "./Logic/WorkspaceManager";
import * as fs from 'fs';
import prompts from 'prompts';

export class Runner {
    public async run(): Promise<void> {
        const workspace: Workspace = await loadWorkspace();
        const activeMelodiVersion = applicationVersion;

        console.log(`User settings directory: ${formatPath(workspace.userConfigDirPath)}`);
        if(workspace.config !== undefined) {
            console.log(`Detected workspace at: ${formatPath(workspace.workspaceRootPath)}`);
            if(workspace.config.melodiVersion !== activeMelodiVersion) {
                console.log(formatWarning(`The workspace was saved using a different version of melodi (${workspace.config.melodiVersion}). Running version (${activeMelodiVersion}).`));
            }
        } else {
            console.log(`No workspace configuration found.`);
            const response = await prompts({
                type: 'confirm',
                name: 'init',
                message: `Do you want to initialize a new workspace at ${formatPath(workspace.workspaceRootPath)}?`,
                onState: exitProcessOnAbort,
            });

            const init = response.init;
            if(!init)
                return;

        await Initialize.run(workspace);
        }

        if (!fs.existsSync(workspace.cacheDirPath)) {
            await fs.promises.mkdir(workspace.cacheDirPath, { recursive: true });
        }

        await WorkspaceManager.run(workspace);
    }
}