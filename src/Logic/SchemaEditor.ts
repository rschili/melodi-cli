import { QueryOptionsBuilder, QueryRowFormat } from "@itwin/core-common";
import chalk from "chalk";
import semver from "semver";
import { table } from 'table';
import { logError } from "../ConsoleHelper";
import { GithubBisSchemasRootUrl, loadSchemaInventory } from "../GithubBisSchemasHelper";
import { UnifiedDb } from "../UnifiedDb";
import { getFileContextFolderPath, Context, WorkspaceFile } from "../Context";
import { log, select, isCancel, spinner, multiselect, confirm } from "@clack/prompts"
import path from "node:path";
import { mkdirSync } from "node:fs";
import { IModelDb, ECDb } from "@itwin/core-backend";
import axios from "axios";
import { buildSchemaInfoMap, buildSchemaTableRows, type SchemaInfo } from "./SchemaEditorOps";

export class SchemaEditor {

    static async run(ctx: Context, file: WorkspaceFile, db: UnifiedDb): Promise<void> {
        //Workflow:
        // 1. Get schemas in DB, and available schemas
        // 2. Build a list of choices + info about available updates
        // 3. Let the user select a schema to update (up-to-date ones are disabled) or import an available schema
        // 4. before import, ask the user if they want to import the latest version or a specific version
        // 5. ask if all referenced schemas should be imported as well
        // 6. import the schema(s) into the DB

        const queryOptions = new QueryOptionsBuilder();
        queryOptions.setRowFormat(QueryRowFormat.UseECSqlPropertyIndexes);
        const reader = db.createQueryReader(
            "SELECT Name, VersionMajor ,VersionWrite, VersionMinor FROM meta.ECSchemaDef",
            undefined,
            queryOptions.getOptions()
        );
        const schemasInDb = await reader.toArray();

        const availableSchemas = await loadSchemaInventory(ctx.folders.cacheDir);

        const dbSchemaRows = schemasInDb.map(row => ({
            name: row[0] as string,
            versionMajor: row[1] as number,
            versionWrite: row[2] as number,
            versionMinor: row[3] as number,
        }));

        const schemaInfoMap = buildSchemaInfoMap(dbSchemaRows, availableSchemas);
        const tableRows = buildSchemaTableRows(schemaInfoMap);

        const schemaTable: string[][] = [
            ["Name", "Current Version", "Latest published Version"],
        ];
        for (const row of tableRows) {
            let latestDisplay = "";
            if (row.latestVersion) {
                if (row.status === "up-to-date")
                    latestDisplay = chalk.green(row.latestVersion + "\n(github)");
                else if (row.status === "update-available")
                    latestDisplay = chalk.yellowBright(row.latestVersion + "\n(github)");
                else
                    latestDisplay = chalk.magenta(row.latestVersion + "\n(github)");
            }
            schemaTable.push([row.name, row.currentVersion, latestDisplay]);
        }
        console.log(table(schemaTable));
        
        // Use base36 encoding to shorten the current date string for directory naming
        // 

        const schemaOption = await select({
            message: "Select a schema to update",
            options: [
                { label: "Import a schema", value: "__import__" },
                { label: "Import multiple schemas", value: "__import_multiple__" },
                { label: "Dump all schemas as XML" , value: "__dump__" },
                { label: "(Back)", value: "__back__" },
            ],
        });

        if (isCancel(schemaOption) || schemaOption === "__back__") {
            return; // User cancelled the selection
        }

        if (schemaOption === "__dump__") {
            const currentTime = Math.floor((Date.now() - new Date("2020-01-01").getTime()) / 1000).toString(36);
            const dumpPath = path.join(getFileContextFolderPath(ctx.folders.rootDir, file.relativePath), `schemas_dump_${currentTime}`) ;
            log.info(`Dumping all schemas to: ${dumpPath}`);
            mkdirSync(dumpPath, { recursive: true });

            await db.dumpSchemas(dumpPath);
            return;
        }

        if (schemaOption === "__import__") {
            await this.importSingleSchema(db, schemaInfoMap);
            return;
        }

        if (schemaOption === "__import_multiple__") {
            await this.importMultipleSchemas(db, schemaInfoMap);
            return;
        }
    }

    private static async importSingleSchema(db: UnifiedDb, schemaInfoMap: Record<string, SchemaInfo>): Promise<void> {
        // Build options: schemas not in DB, or schemas with available updates
        const importable = Object.values(schemaInfoMap).filter(s => s.path && s.latestVersion);
        if (importable.length === 0) {
            log.warn("No schemas available for import from the published inventory.");
            return;
        }

        const options = importable.map(s => {
            const status = s.version
                ? (s.latestVersion && semver.gt(s.latestVersion, s.version) ? chalk.yellow("update") : chalk.green("current"))
                : chalk.cyan("new");
            return {
                label: `${s.name} ${s.latestVersion?.toString() ?? "?"} [${status}]`,
                value: s,
            };
        });

        const selected = await select({
            message: "Select a schema to import",
            options: [...options, { label: "(Back)", value: undefined }],
            maxItems: 20,
        });

        if (isCancel(selected) || !selected)
            return;

        const schema = selected as SchemaInfo;
        await this.downloadAndImportSchemas(db, [schema]);
    }

    private static async importMultipleSchemas(db: UnifiedDb, schemaInfoMap: Record<string, SchemaInfo>): Promise<void> {
        const importable = Object.values(schemaInfoMap).filter(s => s.path && s.latestVersion);
        if (importable.length === 0) {
            log.warn("No schemas available for import from the published inventory.");
            return;
        }

        const options = importable.map(s => {
            const status = s.version
                ? (s.latestVersion && semver.gt(s.latestVersion, s.version) ? chalk.yellow("update") : chalk.green("current"))
                : chalk.cyan("new");
            return {
                label: `${s.name} ${s.latestVersion?.toString() ?? "?"} [${status}]`,
                value: s,
            };
        });

        const selected = await multiselect({
            message: "Select schemas to import (space to toggle, enter to confirm)",
            options,
        });

        if (isCancel(selected) || selected.length === 0)
            return;

        await this.downloadAndImportSchemas(db, selected as SchemaInfo[]);
    }

    private static async downloadAndImportSchemas(db: UnifiedDb, schemas: SchemaInfo[]): Promise<void> {
        if (db.isReadOnly) {
            log.error("Cannot import schemas - the database is open in read-only mode.");
            return;
        }

        const proceed = await confirm({
            message: `Import ${schemas.length} schema(s): ${schemas.map(s => s.name).join(", ")}?`,
            initialValue: true,
        });
        if (isCancel(proceed) || !proceed)
            return;

        const loader = spinner();
        loader.start("Downloading schema XML files from GitHub...");
        try {
            const schemaXmls: string[] = [];
            for (const schema of schemas) {
                if (!schema.path) {
                    log.warn(`Schema ${schema.name} has no download path, skipping.`);
                    continue;
                }
                const schemaUrl = new URL(schema.path.replace(/\\/g, "/"), GithubBisSchemasRootUrl);
                const response = await axios.get(schemaUrl.href, { responseType: "text", validateStatus: (s) => s === 200 });
                schemaXmls.push(response.data);
            }

            if (schemaXmls.length === 0) {
                loader.stop("No schemas to import.");
                return;
            }

            loader.message("Importing schemas into database...");
            const innerDb = db.innerDb;
            if (innerDb instanceof IModelDb) {
                await innerDb.importSchemaStrings(schemaXmls);
            } else if (innerDb instanceof ECDb) {
                // ECDb.importSchema takes a file path, so we need to write temp files
                const os = await import("node:os");
                const fs = await import("node:fs/promises");
                const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "melodi-schema-"));
                try {
                    for (let i = 0; i < schemaXmls.length; i++) {
                        const tmpFile = path.join(tmpDir, `schema_${i}.ecschema.xml`);
                        await fs.writeFile(tmpFile, schemaXmls[i], "utf-8");
                        innerDb.importSchema(tmpFile);
                    }
                } finally {
                    await fs.rm(tmpDir, { recursive: true, force: true });
                }
            } else {
                loader.stop("Import failed.");
                log.error("Schema import is not supported for this database type.");
                return;
            }

            loader.stop(`Successfully imported ${schemaXmls.length} schema(s).`);
        } catch (error: unknown) {
            loader.stop("Schema import failed.");
            logError(error);
        }
    }
}
}