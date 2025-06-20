import chalk from "chalk";

export const formatPath = chalk.blueBright.underline;
export const formatError = chalk.redBright.bold;
export const formatWarning = chalk.yellowBright;
export const formatSuccess = chalk.greenBright.bold;

export function printError(error: unknown): void {
    if (error instanceof Error) {
        console.error(formatError(`Error: ${error.message}`));
        /*if (error.stack) {
            console.error(chalk.gray(error.stack));
        }*/
    } else {
        console.error(formatError(`Error: ${String(error)}`));
    }
}

interface PromptState {
  aborted: boolean
}

export function exitProcessOnAbort (state: PromptState) : void {
    if (state.aborted) {
        // re-enable the cursor or it may remain hidden
        process.stdout.write('\x1B[?25h')
        process.stdout.write('\n')
        process.exit(1)
    }
}
