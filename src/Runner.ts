
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

        Initialize.run(workspace);
        }

        // collect nested logs
        var logger = new LogBuffer();

        try {
            logger.start();

            const tasks = new Listr([
                {
                    title: 'Checking git status',
                    task: () => this.runFor2Seconds(true)
                },
                {
                    title: 'Checking remote history',
                    task: () => this.runFor2Seconds(true)
                },
                {
                    title: 'Publish package',
                    task: () => this.runFor2Seconds(false)
                }
            ]);

            await tasks.run();
        } finally {
            logger.restorePrintAndClear();
        }
    }

    private async runFor2Seconds(succeed: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            let seconds = 0;
            const interval = setInterval(() => {
                seconds++;
                console.log(`Running... (${seconds}s)`);
            }, 1000);
    
            setTimeout(() => {
                clearInterval(interval);
                if (succeed) {
                    resolve();
                } else {
                    reject(new Error('Task failed after 5 seconds'));
                }
            }, 2000);
        });
    }
}