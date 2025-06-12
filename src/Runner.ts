
import { select, Separator } from '@inquirer/prompts';
import Listr from 'listr';

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

        const tasks = new Listr([
            {
                title: 'Git',
                task: () => {
                    return new Listr([
                        {
                            title: 'Checking git status',
                            task: () => this.runFor5Seconds(true)
                        },
                        {
                            title: 'Checking remote history',
                            task: () => this.runFor5Seconds(true)
                        }]);
                }
            },
            {
                title: 'Publish package',
                task: () => this.runFor5Seconds(false)
            }
        ]);

        await tasks.run();
    }

    private async runFor5Seconds(succeed: boolean): Promise<void> {
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                if (succeed) {
                    resolve();
                } else {
                    reject(new Error('Task failed after 5 seconds'));
                }
            }, 5000);
        });
    }
}