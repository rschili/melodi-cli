import chalk from "chalk";

export function formatPath(path: string): string {
    return chalk.blueBright.underline(path);
}

export function formatError(error: string): string {
    return chalk.redBright.bold(error);
}

export function formatWarning(warning: string): string {
    return chalk.yellowBright(warning);
}

export function formatSuccess(message: string): string {
    return chalk.greenBright.bold(message);
}