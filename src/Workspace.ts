import * as fs from 'fs';
import path from "path";
import { z } from "zod/v4";
import { Environment, WorkspaceType } from "./Interfaces";

export interface ConfigProps {
    type: WorkspaceType;
    melodiVersion: string;
}

const BriefcaseConfigSchema = z.object({
    type: z.enum([WorkspaceType.BRIEFCASE]),
    melodiVersion: z.string(),
    environment: z.enum([Environment.PROD, Environment.QA, Environment.DEV]),
});

export type BriefcaseConfigProps = z.infer<typeof BriefcaseConfigSchema>;

export function isBriefcaseConfig(config: ConfigProps): config is BriefcaseConfigProps {
    return config.type === WorkspaceType.BRIEFCASE;
}


const ECDbConfigSchema = z.object({
    type: z.enum([WorkspaceType.ECDB]),
    melodiVersion: z.string(),
    fileName: z.string()
});

export type ECDbConfigProps = z.infer<typeof ECDbConfigSchema>;

export function isECDbConfig(config: ConfigProps): config is ECDbConfigProps {
    return config.type === WorkspaceType.ECDB;
}


const StandaloneConfigSchema = z.object({
    type: z.enum([WorkspaceType.STANDALONE]),
    melodiVersion: z.string(),
});
export type StandaloneConfigProps = z.infer<typeof StandaloneConfigSchema>;

export function isStandaloneConfig(config: ConfigProps): config is StandaloneConfigProps {
    return config.type === WorkspaceType.STANDALONE;
}

export interface WorkspaceProps {
    workspaceRootPath: string;
    melodiPath: string;
    config?: ConfigProps;
}

export async function detectWorkspace(): Promise<WorkspaceProps> {
    // check if there is a ".melodi" subdirectory in the current working directory
    const melodiConfigFolder = '.melodi';
    const workspaceRootPath = process.cwd();
    const melodiConfigPath = path.join(workspaceRootPath, melodiConfigFolder);
    if (!fs.existsSync(workspaceRootPath) || !fs.lstatSync(workspaceRootPath).isDirectory()) {
        return {
            workspaceRootPath,
            melodiPath: melodiConfigPath,
        };
    }

    const configFileName = 'config.json';
    const configPath = path.join(melodiConfigPath, configFileName);
    if (!fs.existsSync(configPath)) {
        return {
            workspaceRootPath,
            melodiPath: melodiConfigPath,
        };
    }

    const config = await readMelodiConfig(configPath);
    return {
        workspaceRootPath,
        melodiPath: melodiConfigPath,
        config,
    };
}

// Read and validate config
export async function readMelodiConfig(configPath: string): Promise<ConfigProps> {
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
export async function saveMelodiConfig(configPath: string, config: ConfigProps): Promise<void> {
    const data = JSON.stringify(config, undefined, 2);
    await fs.promises.writeFile(configPath, data, 'utf-8');
}