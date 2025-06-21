import * as fs from 'fs';
import path from "path";
import os from "os";
import { z } from "zod/v4";
import { globby } from 'globby';

const WorkspaceConfigSchema = z.object({
    melodiVersion: z.string(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;


/*const BriefcaseConfigSchema = z.object({
    type: z.enum([WorkspaceType.BRIEFCASE]),
    melodiVersion: z.string(),
    environment: z.enum([Environment.PROD, Environment.QA, Environment.DEV]),
});

export type BriefcaseConfigProps = z.infer<typeof BriefcaseConfigSchema>;*/

export const MelodiConfigFolderName = '.melodi';
export const CacheFolderName = '.itwinjs-cache';
export const ConfigFileName = 'config.json';

export interface Workspace {
    workspaceRootPath: string;
    workspaceConfigDirPath: string;
    userConfigDirPath: string;
    cacheDirPath: string;
    config?: WorkspaceConfig;
    files?: WorkspaceFile[];
}

export async function loadWorkspace(root: string = process.cwd()): Promise<Workspace> {
    // check if there is a ".melodi" subdirectory in the current working directory
    
    const workspaceRootPath = root;
    const userConfigDirPath = path.join(os.homedir(), MelodiConfigFolderName)
    const melodiConfigPath = path.join(workspaceRootPath, MelodiConfigFolderName);
    const cacheDirPath = path.join(workspaceRootPath, CacheFolderName);
    if (!fs.existsSync(workspaceRootPath) || !fs.lstatSync(workspaceRootPath).isDirectory()) {
        throw new Error(`The current working directory is not a valid directory: ${workspaceRootPath}`);
    }

    try {
        fs.accessSync(workspaceRootPath, fs.constants.R_OK | fs.constants.W_OK)
    }
    catch (err) {
        throw new Error(`The current working directory is not accessible: ${workspaceRootPath}. Please check permissions.`);
    }

    const configPath = path.join(melodiConfigPath, ConfigFileName);
    if (!fs.existsSync(configPath)) {
        return {
            userConfigDirPath,
            workspaceRootPath,
            workspaceConfigDirPath: melodiConfigPath,
            cacheDirPath,
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
        cacheDirPath,
    };
}

// Read and validate config
export async function readWorkspaceConfig(configPath: string): Promise<WorkspaceConfig> {
    const data = await fs.promises.readFile(configPath, 'utf-8');
    const json = JSON.parse(data);
    return await WorkspaceConfigSchema.parseAsync(json);
}

// Save config (overwrite)
export async function saveWorkspaceConfig(ws: Workspace): Promise<void> {
    if(ws.config === undefined) {
        throw new Error("Workspace config is undefined. Please provide a valid config.");
    }

    // Validate the config before saving
    if (!fs.existsSync(ws.workspaceConfigDirPath)) {
        await fs.promises.mkdir(ws.workspaceConfigDirPath, { recursive: true });
    }

    if (!fs.lstatSync(ws.workspaceConfigDirPath).isDirectory()) {
        throw new Error(`The workspace config directory is not a valid directory: ${ws.workspaceConfigDirPath}`);
    }

    try {
        fs.accessSync(ws.workspaceConfigDirPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
        throw new Error(`The workspace config directory is not accessible: ${ws.workspaceConfigDirPath}. Please check permissions.`);
    }

    const configPath = path.join(ws.workspaceConfigDirPath, ConfigFileName);
    const data = JSON.stringify(ws.config, undefined, 2);
    await fs.promises.writeFile(configPath, data, 'utf-8');

    if (!fs.existsSync(ws.cacheDirPath)) {
        await fs.promises.mkdir(ws.cacheDirPath, { recursive: true });
    }
}


export enum Environment {
    PROD = 'PROD',
    QA = 'QA',
    DEV = 'DEV',
}

export enum FileType {
    BRIEFCASE = 'Briefcase',
    ECDB = 'ECDb',
    STANDALONE = 'Standalone',
}

export interface WorkspaceFile {
    relativePath: string;
    fileType: FileType;
    lastTouched: Date;
}

export async function detectWorkspaceFiles(ws: Workspace): Promise<void> {
    const patterns = [
        '**/*.bim',
        '**/*.ecdb',
    ];

    const ignore = [
        '**/.*',       // Ignore dotfiles and dotfolders
        '**/.*/**',    // Also ignore anything inside dotfolders
    ];

    const files = await globby(patterns, {
        cwd: ws.workspaceRootPath,
        absolute: false,
        deep: 2,          // Limit to 2 levels deep
        dot: false,       // Don't match dotfiles/folders
        ignore,
        caseSensitiveMatch: false,
    });

    const workspaceFiles: WorkspaceFile[] = files.map(file => {
        const ext = path.extname(file).toLowerCase();
        const baseName = path.basename(file);
        const dirName = path.join(ws.workspaceRootPath, path.dirname(file));
        const absolutePath = path.join(ws.workspaceRootPath, file);

        let fileType: FileType;
        if (ext === '.ecdb') {
            fileType = FileType.ECDB;
        } else if (ext === '.bim') {
            const dotFolderPath = path.join(dirName, `.${baseName}`);
            if (fs.existsSync(dotFolderPath) && fs.lstatSync(dotFolderPath).isDirectory()) {
            fileType = FileType.BRIEFCASE;
            } else {
            fileType = FileType.STANDALONE;
            }
        } else {
            throw new Error(`Unsupported file type: ${file}`);
        }

        const stats = fs.statSync(absolutePath);
        const lastTouched = new Date(Math.max(stats.mtime.getTime(), stats.birthtime.getTime(), stats.ctime.getTime()));

        return {
            relativePath: file,
            fileType,
            lastTouched,
        };
    });

    ws.files = workspaceFiles;

}
