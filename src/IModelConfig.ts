import * as fs from "fs";
import path from "path";
import { z } from "zod/v4";
import { Environment } from "./EnvironmentManager";
import { logError } from "./ConsoleHelper";
import { applicationVersion } from "./Diagnostics";
import { getFileContextFolderPath, Workspace } from "./Workspace";
import { log } from "@clack/prompts";

const IModelConfigSchema = z.object({
    melodiVersion: z.string(),
    iModelId: z.string(),
    iTwinId: z.string().optional(),
    environment: z.enum([Environment.PROD, Environment.QA, Environment.DEV]),
    displayName: z.string(),
});

export type IModelConfig = z.infer<typeof IModelConfigSchema>;

const IModelConfigFileName = "config.json";


export async function readIModelConfig(ws: Workspace, relativePath: string): Promise<IModelConfig | undefined> {
    try {
        const fileContextDir = getFileContextFolderPath(ws.workspaceRootPath, relativePath);
        const configPath = path.join(fileContextDir, IModelConfigFileName);
        if (!fs.existsSync(configPath)) {
            return undefined; // No config file found for this iModel
        }

        const data = await fs.promises.readFile(configPath, "utf-8");
        const json = JSON.parse(data);
        return await IModelConfigSchema.parseAsync(json);
    } catch (err: unknown) {
        log.error("Failed to read iModel config.");
        logError(err);
    }
    return undefined;
}

export async function saveIModelConfig(ws: Workspace, relativePath: string, cfg: IModelConfig): Promise<void> {
    const fileContextDir = getFileContextFolderPath(ws.workspaceRootPath, relativePath);
    const configPath = path.join(fileContextDir, IModelConfigFileName);

    if (!fs.existsSync(fileContextDir)) {
        await fs.promises.mkdir(fileContextDir, { recursive: true });
    }

    if (!fs.lstatSync(fileContextDir).isDirectory()) {
        throw new Error(`The iModel config directory is not a valid directory: ${fileContextDir}`);
    }

    try {
        fs.accessSync(fileContextDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
        throw new Error(`The iModel config directory is not accessible: ${fileContextDir}. Please check permissions.`);
    }

    cfg.melodiVersion = applicationVersion; // Ensure the version is up-to-date
    const data = JSON.stringify(cfg, undefined, 2);
    await fs.promises.writeFile(configPath, data, "utf-8");
}