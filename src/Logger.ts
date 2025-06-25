import { select } from "@inquirer/prompts";
import { saveUserConfig, Workspace } from "./Workspace";
import { Constructor, Logger as BeLogger, LoggerLevelsConfig, LogLevel } from "@itwin/core-bentley";
import chalk from "chalk";
import { formatError, formatWarning } from "./ConsoleHelper";

export class Logger {
    public static setLevel(level: LogLevel): void {
        const errorFn = (cat: string, message: string, _: unknown) =>
            console.error(`[${cat}] ${formatError(message)}`);
        const warningFn = (cat: string, message: string, _: unknown) =>
            console.error(`[${cat}] ${formatWarning(message)}`);
        const infoFn = (cat: string, message: string, _: unknown) =>
            console.log(`[${cat}] ${chalk.greenBright(message)}`);
        const traceFn = (cat: string, message: string, _: unknown) =>
            console.log(`[${cat}] ${chalk.gray(message)}`);

        switch (level) {
            case LogLevel.None:
                BeLogger.initialize(undefined, undefined, undefined, undefined);
                break;
            case LogLevel.Error:
                BeLogger.initialize(errorFn, undefined, undefined, undefined);
                break;
            case LogLevel.Warning:
                BeLogger.initialize(errorFn, warningFn, undefined, undefined);
                break;
            case LogLevel.Info:
                BeLogger.initialize(errorFn, warningFn, infoFn, undefined);
                break;
            case LogLevel.Trace:
                BeLogger.initialize(errorFn, warningFn, infoFn, traceFn);
                break;
            default:
                throw new Error(`Unsupported log level: ${level}`);
        }

        BeLogger.setLevelDefault(level);
    }

    public static getCurrentLevelString(level?: LogLevel): string {
        switch (level) {
            case LogLevel.None:
                return chalk.gray("off");
            case LogLevel.Error:
                return chalk.redBright("errors");
            case LogLevel.Warning:
                return `${chalk.redBright("errors")} and ${chalk.yellowBright("warnings")}`;
            case LogLevel.Info:
                return `${chalk.redBright("errors")}, ${chalk.yellowBright("warnings")} and ${chalk.greenBright("info")}`;
            case LogLevel.Trace:
                return `${chalk.redBright("errors")}, ${chalk.yellowBright("warnings")}, ${chalk.greenBright("info")} and ${chalk.gray("trace")}`;
            default:
                return chalk.gray("off");
        }
    }

    public static async configure(ws: Workspace) {
        const selectedLevel = ws.userConfig.logging ?? LogLevel.None;
        const choice = await select<LogLevel>({
                message: 'Logging',
                choices: [
                    { name: "off", value: LogLevel.None },
                    { name: this.getCurrentLevelString(LogLevel.Error), value: LogLevel.Error },
                    { name: this.getCurrentLevelString(LogLevel.Warning) , value: LogLevel.Warning },
                    { name: this.getCurrentLevelString(LogLevel.Info), value: LogLevel.Info },
                    { name: this.getCurrentLevelString(LogLevel.Trace), value: LogLevel.Trace },
                ],
                default: selectedLevel,
                pageSize: 5,
                loop: false,
            });
        ws.userConfig.logging = choice;
        this.setLevel(choice);
        await saveUserConfig(ws);

    }
}