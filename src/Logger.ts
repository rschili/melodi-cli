import { Context } from "./Context";
import { Logger as BeLogger, LogLevel } from "@itwin/core-bentley";
import chalk from "chalk";
import { isCancel, log, select } from "@clack/prompts";
import { saveUserConfig } from "./UserConfig";

export class Logger {
    public static setLevel(level: LogLevel): void {
        const errorFn = (cat: string, message: string) =>
            log.error(`[${cat} Logger] ${chalk.white(message)}`);
        const warningFn = (cat: string, message: string) =>
            log.warn(`[${cat} Logger] ${chalk.white(message)}`);
        const infoFn = (cat: string, message: string) =>
            log.info(`[${cat} Logger] ${chalk.white(message)}`);
        const traceFn = (cat: string, message: string) =>
            log.message(`[${cat} Logger] ${chalk.gray(message)}`);

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

    public static async configure(ctx: Context) {
        const selectedLevel = ctx.userConfig.logging ?? LogLevel.None;
        const choice = await select<LogLevel>({
                message: 'Logging',
                options: [
                    { label: "off", value: LogLevel.None },
                    { label: this.getCurrentLevelString(LogLevel.Error), value: LogLevel.Error },
                    { label: this.getCurrentLevelString(LogLevel.Warning) , value: LogLevel.Warning },
                    { label: this.getCurrentLevelString(LogLevel.Info), value: LogLevel.Info },
                    { label: this.getCurrentLevelString(LogLevel.Trace), value: LogLevel.Trace },
                ],
                initialValue: selectedLevel,
                maxItems: 5,
            });

        if(isCancel(choice)) {
            return;
        }

        ctx.userConfig.logging = choice;
        this.setLevel(choice);
        await saveUserConfig(ctx.userConfig, ctx.folders.configDir);

    }
}