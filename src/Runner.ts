
import { select, Separator } from '@inquirer/prompts';
import chalk from "chalk";
import Listr, { ListrOptions } from 'listr';
import { Environment } from "./Interfaces";
import { detectWorkspace, WorkspaceProps } from "./Workspace";
import { applicationVersion } from "./Diagnostics";


export class Runner {
    public async run(): Promise<void> {
        const workspace: WorkspaceProps = await detectWorkspace();

        const activeMelodiVersion = applicationVersion;
        if(workspace.config !== undefined) {
            console.log(chalk.white(`Detected workspace at: ${workspace.workspaceRootPath}`));
            console.log(chalk.white(`Workspace is using environment: ${workspace.config.environment}`));
            if(workspace.config.melodiVersion !== activeMelodiVersion) {
                console.log(chalk.blueBright(`The workspace was saved using a different version of melodi (${workspace.config.melodiVersion}) than the active version (${activeMelodiVersion}).`));
            }
        }

        const environment: Environment = await select({
            message: 'Select an environment',
            choices: [Environment.PROD, Environment.QA, Environment.DEV],
        });

        console.log(`Selected environment: ${environment}`);

        // collect nested logs
        const buffer: string[] = [];
        const originalLog = console.log;
        console.log = (...args) => buffer.push(args.join(' '));

        try {

            const tasks = new Listr([
                {
                    title: 'Checking git status',
                    task: () => this.runFor5Seconds(true)
                },
                {
                    title: 'Checking remote history',
                    task: () => this.runFor5Seconds(true)
                },
                {
                    title: 'Publish package',
                    task: () => this.runFor5Seconds(false)
                }
            ]);

            await tasks.run();
        } finally {
            // restore original console.log
            console.log = originalLog;
            // print collected logs
            if( buffer.length > 0) {
                console.log(chalk.white('Collected logs:'));
                buffer.forEach(log => console.log("\t\t" + chalk.gray(log)));
            }
        }
    }

    private async runFor5Seconds(succeed: boolean): Promise<void> {
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
            }, 5000);
        });
    }
}