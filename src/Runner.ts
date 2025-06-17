
import { select, confirm } from '@inquirer/prompts';
import Listr from 'listr';
import { Environment } from "./Interfaces";
import { detectWorkspace, WorkspaceProps } from "./Workspace";
import { applicationVersion } from "./Diagnostics";
import { Initialize } from "./Logic/Initialize";
import { LogBuffer } from "./LogBuffer";
import { formatPath, formatWarning } from "./ConsoleFormatter";


export class Runner {
    public async run(): Promise<void> {
        const workspace: WorkspaceProps = await detectWorkspace();
        const activeMelodiVersion = applicationVersion;

        console.log(`User settings directory: ${formatPath(workspace.userConfigDirPath)}`);
        if(workspace.config !== undefined) {
            console.log(`Detected workspace at: ${formatPath(workspace.workspaceRootPath)}`);
            if(workspace.config.melodiVersion !== activeMelodiVersion) {
                console.log(formatWarning(`The workspace was saved using a different version of melodi (${workspace.config.melodiVersion}). Running version (${activeMelodiVersion}).`));
            }
        } else {
            console.log(`No workspace configuration found.`);
            const init = await confirm({ message: `Do you want to initialize a new workspace at ${formatPath(workspace.workspaceRootPath)}?` });
            if(!init)
                return;

        await Initialize.run(workspace);
        }
    }
}