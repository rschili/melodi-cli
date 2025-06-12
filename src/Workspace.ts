import * as fs from 'fs';
import path from "path";
import { z } from "zod/v4";
import { Environment } from "./Interfaces";

const ConfigSchema = z.object({
    melodiVersion: z.string(),
    environment: z.enum([Environment.PROD, Environment.QA, Environment.DEV]),
});

export type ConfigProps = z.infer<typeof ConfigSchema>;

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
    const parsed = await ConfigSchema.parseAsync(json);
    return parsed;
}

// Save config (overwrite)
export async function saveMelodiConfig(configPath: string, config: ConfigProps): Promise<void> {
    const data = JSON.stringify(config, undefined, 2);
    await fs.promises.writeFile(configPath, data, 'utf-8');
}