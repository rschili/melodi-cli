import * as fs from 'fs';
import path from "path";
import os from "os";
import { z } from "zod/v4";
import { printError, formatError } from "./ConsoleHelper";
import { applicationVersion } from "./Diagnostics";
import chalk from "chalk";
import { isCancel, text } from "@clack/prompts";

export enum LogLevel { // copied so it's independent of @itwin/core-bentley
    /** Tracing and debugging - low level */
    Trace = 0,
    /** Information - mid level */
    Info = 1,
    /** Warnings - high level */
    Warning = 2,
    /** Errors - highest level */
    Error = 3,
    /** Higher than any real logging level. This is used to turn a category off. */
    None = 4
}

const UserConfigSchema = z.object({
    melodiVersion: z.string(),
    logging: z.enum(LogLevel).optional(),
    iTwinJsDir: z.string().optional(),
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

export const UserConfigFileName = 'config.json';

export async function readUserConfig(): Promise<UserConfig> {
    try {
        const userConfigDir = getUserConfigDir();
        const userConfigPath = path.join(userConfigDir, UserConfigFileName);
        if (fs.existsSync(getUserConfigDir())) {
            // If the user config does not exist, return the default user config
            const data = await fs.promises.readFile(userConfigPath, 'utf-8');
            const json = JSON.parse(data);
            return await UserConfigSchema.parseAsync(json);
        }
    } catch (err: unknown) {
        console.error(formatError("Failed to read user config. Using default config."));
        printError(err);
    }

    return {
        melodiVersion: applicationVersion,
        logging: LogLevel.None,
    };
}

export function getUserConfigDir(): string {
    return path.join(os.homedir(), UserConfigFileName)
}

export async function saveUserConfig(cfg: UserConfig): Promise<void> {
    const userConfigDir = getUserConfigDir();
    const userConfigPath = path.join(userConfigDir, UserConfigFileName);
    // Validate the config before saving
    if (!fs.existsSync(userConfigDir)) {
        await fs.promises.mkdir(userConfigDir, { recursive: true });
    }

    if (!fs.lstatSync(userConfigDir).isDirectory()) {
        throw new Error(`The user config directory is not a valid directory: ${userConfigDir}`);
    }

    try {
        fs.accessSync(userConfigDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
        throw new Error(`The user config directory is not accessible: ${userConfigDir}. Please check permissions.`);
    }

    cfg.melodiVersion = applicationVersion; // Ensure the version is up-to-date
    const data = JSON.stringify(cfg, undefined, 2);
    await fs.promises.writeFile(userConfigPath, data, 'utf-8');
}

export async function setup(cfg: UserConfig): Promise<void> {
    if(cfg.iTwinJsDir !== undefined) {
        console.log(chalk.yellowBright(`Melodi is currently configured to use iTwin.js from: ${cfg.iTwinJsDir}`));
        if (!fs.existsSync(cfg.iTwinJsDir)) {
            console.log(chalk.redBright(`The specified iTwin.js path does not exist`));
        }
    }

    const iTwinJsDir = await text({
        message: "Enter the path to your local iTwin.js repository root from which to use the packages (leave empty to use the installed node module):",
        initialValue: cfg.iTwinJsDir ?? "",
    });
    if(isCancel(iTwinJsDir)) {
        return; // User cancelled the prompt
    }
    if (iTwinJsDir.trim() === "") {
        cfg.iTwinJsDir = undefined; // Use the installed node module
        saveUserConfig(cfg);
        return;
    } else {
        const trimmedPath = iTwinJsDir.trim();
        if (!fs.existsSync(trimmedPath)) {
            console.log(chalk.redBright(`The specified iTwin.js path does not exist: ${trimmedPath}. Aborting.`));
            return;
        }
        cfg.iTwinJsDir = trimmedPath;
        await saveUserConfig(cfg);
    }
}