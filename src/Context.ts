import * as fs from 'fs';
import path from "path";
import { z } from "zod/v4";
import { globby } from 'globby';
import { SQLiteDb, SqliteStatement } from "@itwin/core-backend";
import { DbResult, OpenMode } from "@itwin/core-bentley";
import { printError } from "./ConsoleHelper";
import { SemVer } from "semver";
import { applicationVersion } from "./Diagnostics";
import { EnvironmentManager } from "./EnvironmentManager";
import { UserConfig } from "./UserConfig";

const CommandCacheSchema = z.object({
    melodiVersion: z.string(),
    ecsqlHistory: z.array(z.string()).optional(),
});

export type CommandCache = z.infer<typeof CommandCacheSchema>;

export const CommandHistoryFileName = 'commandHistory.json';

export type MelodiFolders = {
    configDir: string;
    cacheDir: string;
    rootDir: string;
};

export type Context = {
    folders: MelodiFolders;
    commandCache: CommandCache;
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
    hasITwinId: boolean
}

export async function loadContext(userConfig: UserConfig, folders: MelodiFolders): Promise<Context> {
    // check if there is a ".melodi" subdirectory in the current working directory
    
    try {
        fs.accessSync(folders.rootDir, fs.constants.R_OK | fs.constants.W_OK)
    }
    catch {
        throw new Error(`The root directory is not accessible: ${folders.rootDir}. Please check permissions.`);
    }

    const environment = new EnvironmentManager(folders.cacheDir);
    const commandHistoryPath = path.join(folders.cacheDir, CommandHistoryFileName);

    if (!fs.existsSync(commandHistoryPath)) {
        return {
            folders,
            commandCache: {
                melodiVersion: applicationVersion,
                ecsqlHistory: []
            },
            envManager: environment,
            userConfig
        };
    }

    const commandHistory = await readCommandHistory(commandHistoryPath);

    return {
        folders,
        commandCache: commandHistory,
        envManager: environment,
        userConfig
    };
}

// Read and validate config
export async function readCommandHistory(filePath: string): Promise<CommandCache> {
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const json = JSON.parse(data);
    return await CommandCacheSchema.parseAsync(json);
}

// Save config (overwrite)
export async function saveCommandHistory(ctx: Context): Promise<void> {
    if(ctx.commandCache === undefined) {
        throw new Error("Command history is undefined. Please provide a valid config.");
    }

    // Validate the config before saving
    if (!fs.existsSync(ctx.folders.cacheDir)) {
        await fs.promises.mkdir(ctx.folders.cacheDir, { recursive: true });
    }

    if (!fs.lstatSync(ctx.folders.cacheDir).isDirectory()) {
        throw new Error(`The cache directory is not a valid directory: ${ctx.folders.cacheDir}`);
    }

    try {
        fs.accessSync(ctx.folders.cacheDir, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
        throw new Error(`The cache directory is not accessible: ${ctx.folders.cacheDir}. Please check permissions.`);
    }

    const filePath = path.join(ctx.folders.cacheDir, CommandHistoryFileName);
    ctx.commandCache.melodiVersion = applicationVersion; // Ensure the version is up-to-date
    const data = JSON.stringify(ctx.commandCache, undefined, 2);
    await fs.promises.writeFile(filePath, data, 'utf-8');
}

export async function detectFiles(ctx: Context): Promise<void> {
    const patterns = [
        '**/*.bim',
        '**/*.ecdb',
    ];

    const ignore = [
        '**/.*',       // Ignore dotfiles and dotfolders
        '**/.*/**',    // Also ignore anything inside dotfolders
    ];

    const files = await globby(patterns, {
        cwd: ctx.folders.rootDir,
        absolute: false,
        deep: 2,          // Limit to 2 levels deep
        dot: false,       // Don't match dotfiles/folders
        ignore,
        caseSensitiveMatch: false,
    });

    const workspaceFiles: WorkspaceFile[] = files.map(file => {
        const absolutePath = path.join(ctx.folders.rootDir, file);

        const stats = fs.statSync(absolutePath);
        const lastTouched = new Date(Math.max(stats.mtime.getTime(), stats.birthtime.getTime(), stats.ctime.getTime()));

        return {
            relativePath: file,
            lastTouched,
            hasITwinId: false,
        };
    });

    await readFileProps(ctx, workspaceFiles);
    ctx.files = workspaceFiles;
}
// Folder to hold context information for a file. for file /home/user/workspace/file.bim the folder would be /home/user/workspace/file_extras/
export function getFileContextFolderPath(root: string, relativeFilePath: string): string {
    const parsed = path.parse(relativeFilePath);
    const contextFolderName = `${parsed.name}_extras`;
    return path.join(root, parsed.dir, contextFolderName);
}

const schemaVersionSchema = z.object({
    major: z.number(),
    minor: z.number(),
    sub1: z.number(),
    sub2: z.number(),
});

export type SchemaVersion = z.infer<typeof schemaVersionSchema>;

async function readFileProps(ctx: Context, files: WorkspaceFile[]): Promise<void> {
    if (files.length === 0) {
        return;
    }

    // ItwinId: 
    // Count(*) FROM be_Prop WHERE Namespace='be_Db' AND Name='ProjectGuid' AND Id=0 AND SubId=0 AND DATA <> NULL"

    const db = new SQLiteDb();
    for (const file of files) {
        try {
            const absolutePath = path.join(ctx.folders.rootDir, file.relativePath);
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

            db.withPreparedSqliteStatement("SELECT Count(*) FROM be_Prop WHERE Namespace='be_Db' AND Name='ProjectGuid' AND Id=0 AND SubId=0 AND DATA NOT NULL", (stmt: SqliteStatement) => {
                if (stmt.step() === DbResult.BE_SQLITE_ROW) {
                    file.hasITwinId = true;
                }
            });

            db.closeDb();
        } catch (error) {
            printError(error, true);
        } finally {
            if(db.isOpen) {
                db.closeDb();
            }
        }
    }
}
