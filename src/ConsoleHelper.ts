import { log } from "@clack/prompts";
import chalk from "chalk";

export const formatPath = chalk.blueBright.underline;
export const formatError = chalk.redBright.bold;
export const formatWarning = chalk.yellowBright;
export const formatSuccess = chalk.greenBright.bold;
export const resetChar = "\x1B[0m";

export function printError(error: unknown, printAsWarning: boolean = false): void {
    const formatter = printAsWarning ? formatWarning : formatError;
    const label = printAsWarning ? "Warning" : "Error";
    if (error instanceof Error) {
        console.error(formatter(`${label}: ${error.message}`));
        /*if (error.stack) {
            console.error(chalk.gray(error.stack));
        }*/
    } else {
        console.error(formatter(`${label}: ${String(error)}`));
    }
}

export function logError(error: unknown): void {
    if (error instanceof Error) {
        log.error(error.message);
        /*if (error.stack) {
            console.error(chalk.gray(error.stack));
        }*/
    } else {
        log.error(`Error: ${String(error)}`);
    }
}

export function generateColorizerMap<T>(values: T[]): Map<T, (text: string) => string> {
    const colorizerMap = new Map<T, (text: string) => string>();
    const colors = [
        chalk.redBright,
        chalk.greenBright,
        chalk.blueBright,
        chalk.yellowBright,
        chalk.cyanBright,
        chalk.magentaBright,
        chalk.whiteBright,
    ];

    const uniqueValues = Array.from(new Set(values));
    uniqueValues.forEach((value, index) => {
        const color = colors[index % colors.length];
        colorizerMap.set(value, color);
    });

    return colorizerMap;
}

const msInSecond = 1000;
const msInMinute = msInSecond * 60;
const msInHour = msInMinute * 60;
const msInDay = msInHour * 24;
const msInYear = msInDay * 365.25;
export function timeSpanToString(span: number): string | undefined {
    if (span > msInYear * 100 || span <= 0) {
        return undefined;
    }

    if (span < msInMinute) {
        const seconds = Math.floor(span / msInSecond);
        return `${seconds} second${seconds !== 1 ? "s" : ""}`;
    } else if (span < msInHour) {
        const minutes = Math.floor(span / msInMinute);
        return `${minutes} minute${minutes !== 1 ? "s" : ""}`;
    } else if (span < msInDay) {
        const hours = Math.floor(span / msInHour);
        return `${hours} hour${hours !== 1 ? "s" : ""}`;
    } else if (span < msInYear) {
        const days = Math.floor(span / msInDay);
        return `${days} day${days !== 1 ? "s" : ""}`;
    } else {
        const years = Math.floor(span / msInYear);
        return `${years} year${years !== 1 ? "s" : ""}`;
    }
}