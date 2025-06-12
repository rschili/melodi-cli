
import { select, Separator } from '@inquirer/prompts';
import chalk from "chalk";
import Listr, { ListrOptions } from 'listr';

export enum Environment {
    PROD = 'PROD',
    QA = 'QA',
    DEV = 'DEV',
}

export class Runner {
    public async run(): Promise<void> {

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