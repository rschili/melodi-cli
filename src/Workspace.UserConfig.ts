import * as fs from 'fs';
import path from "path";
import os from "os";
import { z } from "zod/v4";
import { printError, formatError } from "./ConsoleHelper";
import { applicationVersion } from "./Diagnostics";

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
});

export type UserConfig = z.infer<typeof UserConfigSchema>;

export const MelodiConfigFolderName = '.melodi';
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
    return path.join(os.homedir(), MelodiConfigFolderName)
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
    } catch {
        throw new Error(`The user config directory is not accessible: ${userConfigDir}. Please check permissions.`);
    }

    cfg.melodiVersion = applicationVersion; // Ensure the version is up-to-date
    const data = JSON.stringify(cfg, undefined, 2);
    await fs.promises.writeFile(userConfigPath, data, 'utf-8');
}
