import * as fs from 'fs';
import path from "path";
import os from "os";
import { z } from "zod/v4";
import { Environment, WorkspaceType } from "./Interfaces";

export interface WorkspaceConfigProps {
    type: WorkspaceType;
    melodiVersion: string;
}

const BriefcaseConfigSchema = z.object({
    type: z.enum([WorkspaceType.BRIEFCASE]),
    melodiVersion: z.string(),
    environment: z.enum([Environment.PROD, Environment.QA, Environment.DEV]),
});

export type BriefcaseConfigProps = z.infer<typeof BriefcaseConfigSchema>;

export function isBriefcaseConfig(config: WorkspaceConfigProps): config is BriefcaseConfigProps {
    return config.type === WorkspaceType.BRIEFCASE;
}

const ECDbConfigSchema = z.object({
    type: z.enum([WorkspaceType.ECDB]),
    melodiVersion: z.string(),
    fileName: z.string()
});

export type ECDbConfigProps = z.infer<typeof ECDbConfigSchema>;

export function isECDbConfig(config: WorkspaceConfigProps): config is ECDbConfigProps {
    return config.type === WorkspaceType.ECDB;
}


const StandaloneConfigSchema = z.object({
    type: z.enum([WorkspaceType.STANDALONE]),
    melodiVersion: z.string(),
});
export type StandaloneConfigProps = z.infer<typeof StandaloneConfigSchema>;

export function isStandaloneConfig(config: WorkspaceConfigProps): config is StandaloneConfigProps {
    return config.type === WorkspaceType.STANDALONE;
}

export interface WorkspaceProps {
    workspaceRootPath: string;
    workspaceConfigDirPath: string;
    userConfigDirPath: string;
    config?: WorkspaceConfigProps;
}

export async function detectWorkspace(): Promise<WorkspaceProps> {
    // check if there is a ".melodi" subdirectory in the current working directory
    const melodiConfigFolder = '.melodi';
    const workspaceRootPath = process.cwd();
    const userConfigDirPath = path.join(os.homedir(), melodiConfigFolder)
    const melodiConfigPath = path.join(workspaceRootPath, melodiConfigFolder);
    if (!fs.existsSync(workspaceRootPath) || !fs.lstatSync(workspaceRootPath).isDirectory()) {
        return {
            userConfigDirPath,
            workspaceRootPath,
            workspaceConfigDirPath: melodiConfigPath,
        };
    }

    const configFileName = 'config.json';
    const configPath = path.join(melodiConfigPath, configFileName);
    if (!fs.existsSync(configPath)) {
        return {
            userConfigDirPath,
            workspaceRootPath,
            workspaceConfigDirPath: melodiConfigPath,
        };
    }

    const config = await readWorkspaceConfig(configPath);
    // create the user config directory if it doesn't exist
    if (!fs.existsSync(userConfigDirPath)) {
        await fs.promises.mkdir(userConfigDirPath, { recursive: true });
    }

    return {
        userConfigDirPath,
        workspaceRootPath,
        workspaceConfigDirPath: melodiConfigPath,
        config,
    };
}

// Read and validate config
export async function readWorkspaceConfig(configPath: string): Promise<WorkspaceConfigProps> {
    const data = await fs.promises.readFile(configPath, 'utf-8');
    const json = JSON.parse(data);
    const type = json.type;
    if (type === WorkspaceType.BRIEFCASE) {
        return await BriefcaseConfigSchema.parseAsync(json);
    } else if (type === WorkspaceType.ECDB) {
        return await ECDbConfigSchema.parseAsync(json);
    } else if (type === WorkspaceType.STANDALONE) {
        return await StandaloneConfigSchema.parseAsync(json);
    } else {
        throw new Error(`Unknown workspace type: ${type}`);
    }
}

// Save config (overwrite)
export async function saveWorkspaceConfig(configPath: string, config: WorkspaceConfigProps): Promise<void> {
    const data = JSON.stringify(config, undefined, 2);
    await fs.promises.writeFile(configPath, data, 'utf-8');
}