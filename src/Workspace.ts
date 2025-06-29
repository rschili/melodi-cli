import * as fs from 'fs';
import path from "path";
import os from "os";
import { z } from "zod/v4";
import { globby } from 'globby';
import { SQLiteDb, SqliteStatement } from "@itwin/core-backend";
import { DbResult, OpenMode } from "@itwin/core-bentley";
import { printError } from "./ConsoleHelper.js";
import { SemVer } from "semver";
import { applicationVersion } from "./Diagnostics.js";
import { EnvironmentManager } from "./EnvironmentManager.js";
import { UserConfig } from "./Workspace.UserConfig.js";

const WorkspaceConfigSchema = z.object({
    melodiVersion: z.string(),
    ecsqlHistory: z.array(z.string()).optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const MelodiConfigFolderName = '.melodi';
export const CacheFolderName = '.itwinjs-cache';
export const ConfigFileName = 'config.json';

export type Workspace = {
    workspaceRootPath: string;
    workspaceConfigDirPath: string;
    config?: WorkspaceConfig;
    userConfig: UserConfig;
    files?: WorkspaceFile[];

    envManager: EnvironmentManager;
}

export type WorkspaceFile = {
    relativePath: string;
    lastTouched: Date;
    parentChangeSetId?: string;
    beDbVersion?: SchemaVersion;
    ecDbVersion?: SchemaVersion;
    dgn_DbVersion?: SchemaVersion;
    bisCoreVersion?: SemVer;
    elements?: number; // Optional: number of bis_Element records in the iModel, if applicable
}

export async function loadWorkspace(userConfig: UserConfig, root: string = process.cwd()): Promise<Workspace> {
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
    const environment = new EnvironmentManager(cacheDirPath);
    if (!fs.existsSync(configPath)) {
        return {
            workspaceRootPath,
            workspaceConfigDirPath: melodiConfigPath,
            envManager: environment,
            userConfig
        };
    }

    const config = await readWorkspaceConfig(configPath);
    // create the user config directory if it doesn't exist
    if (!fs.existsSync(userConfigDirPath)) {
        await fs.promises.mkdir(userConfigDirPath, { recursive: true });
    }

    return {
        workspaceRootPath,
        workspaceConfigDirPath: melodiConfigPath,
        config,
        envManager: environment,
        userConfig
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
    ws.config.melodiVersion = applicationVersion; // Ensure the version is up-to-date
    const data = JSON.stringify(ws.config, undefined, 2);
    await fs.promises.writeFile(configPath, data, 'utf-8');
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
        const absolutePath = path.join(ws.workspaceRootPath, file);

        const stats = fs.statSync(absolutePath);
        const lastTouched = new Date(Math.max(stats.mtime.getTime(), stats.birthtime.getTime(), stats.ctime.getTime()));

        return {
            relativePath: file,
            lastTouched,
        };
    });

    await readFileProps(ws, workspaceFiles);
    ws.files = workspaceFiles;
}

// Folder to hold context information for a file. for file /home/user/workspace/file.bim the folder would be /home/user/workspace/.file.bim/
export function getFileContextFolderPath(root: string, relativeFilePath: string): string {
    const absolutePath = path.join(root, `.${relativeFilePath}`);
    return absolutePath;
}

const schemaVersionSchema = z.object({
    major: z.number(),
    minor: z.number(),
    sub1: z.number(),
    sub2: z.number(),
});

export type SchemaVersion = z.infer<typeof schemaVersionSchema>;

async function readFileProps(ws: Workspace, files: WorkspaceFile[]): Promise<void> {
    if (files.length === 0) {
        return;
    }

    const db = new SQLiteDb();
    for (const file of files) {
        try {
            const absolutePath = path.join(ws.workspaceRootPath, file.relativePath);
            db.openDb(absolutePath, OpenMode.Readonly);
            db.withPreparedSqliteStatement("SELECT Name, Val FROM be_Local", (stmt: SqliteStatement) => {
                while (stmt.step() === DbResult.BE_SQLITE_ROW) {
                    const name = stmt.getValueString(0);
                    if(name === "ParentChangeSetId") {
                        file.parentChangeSetId = stmt.getValueString(1);
                    }
                }
            });
            
            db.withPreparedSqliteStatement("SELECT Namespace, StrData FROM be_Prop WHERE Name = ?", (stmt: SqliteStatement) => {
                stmt.bindString(1, "SchemaVersion");
                while (stmt.step() === DbResult.BE_SQLITE_ROW) {
                    const namespace = stmt.getValueString(0);
                    const schemaVersion = stmt.getValueString(1);
                    const parsedSchemaVersion = schemaVersionSchema.safeParse(JSON.parse(schemaVersion));
                    if (parsedSchemaVersion.success) {
                        switch (namespace.toLowerCase()) {
                            case "be_db":
                                file.beDbVersion = parsedSchemaVersion.data;
                                break;
                            case "ec_db":
                                file.ecDbVersion = parsedSchemaVersion.data;
                                break;
                            case "dgn_db":
                                file.dgn_DbVersion = parsedSchemaVersion.data;
                                break;
                            default:
                                console.warn(`Unknown schema version namespace: ${namespace}. This may not be supported by melodi.`);
                                break;
                        }
                    }
                }
            });

            db.withPreparedSqliteStatement("SELECT VersionDigit1, VersionDigit2, VersionDigit3 from ec_Schema WHERE Name = ?", (stmt: SqliteStatement) => {
                stmt.bindString(1, "BisCore");
                if (stmt.step() === DbResult.BE_SQLITE_ROW) {
                    const major = stmt.getValueInteger(0);
                    const minor = stmt.getValueInteger(1);
                    const sub1 = stmt.getValueInteger(2);
                    file.bisCoreVersion = new SemVer(`${major}.${minor}.${sub1}`);
                }
            });

            if(file.bisCoreVersion !== undefined) {
                db.withPreparedSqliteStatement("SELECT COUNT(*) FROM bis_Element", (stmt: SqliteStatement) => {
                    if (stmt.step() === DbResult.BE_SQLITE_ROW) {
                        file.elements = stmt.getValueInteger(0);
                    }
                });
            }

            db.closeDb();
        } catch (error) {
            printError(error);
        } finally {
            if(db.isOpen) {
                db.closeDb();
            }
        }
    }
    

    
}