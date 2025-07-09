import { QueryOptionsBuilder, QueryRowFormat } from "@itwin/core-common";
import chalk from "chalk";
import semver from "semver";
import { table } from 'table';
import { formatWarning } from "../ConsoleHelper";
import { loadSchemaInventory } from "../GithubBisSchemasHelper";
import { UnifiedDb } from "../UnifiedDb";
import { getFileContextFolderPath, Workspace, WorkspaceFile } from "../Workspace";
import { log, select, isCancel } from "@clack/prompts"
import { getUserCacheDir } from "../Workspace.UserConfig";
import path from "node:path";
import { mkdirSync } from "node:fs";

type SchemaInfo = {
    name: string;
    version?: semver.SemVer;
    latestVersion?: semver.SemVer;
    path?: string;
};

export class SchemaEditor {

    static async run(ws: Workspace, file: WorkspaceFile, db: UnifiedDb): Promise<void> {
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

        const availableSchemas = await loadSchemaInventory(getUserCacheDir());

        const schemaInfoMap: Record<string, SchemaInfo> = {};
        for (const row of schemasInDb) {
            const name = row[0];
            const versionString = `${row[1]}.${row[2]}.${row[3]}`;
            const version = semver.parse(versionString);
            if (!version) {
                console.log(formatWarning(`Schema ${row[0]} has an invalid version: ${row[1]}`));
                continue;
            }

            schemaInfoMap[name] = {
                name,
                version,
            }
        }

        for (const [outerName, schemaGroup] of Object.entries(availableSchemas)) {
            for (const schema of schemaGroup) {
                if (!schema.released || !schema.path)
                    continue; // Skip unreleased schemas
                if (schema.name !== outerName) {
                    console.log(formatWarning(`Schema name mismatch: expected ${outerName}, got ${schema.name}`));
                    continue;
                }
                const cleanedVersion = stripLeadingZeros(schema.version);
                const version = semver.parse(cleanedVersion);
                if (!version) {
                    console.log(formatWarning(`Schema ${schema.name} has an invalid version: ${schema.version}`));
                    continue;
                }

                const existingSchema = schemaInfoMap[schema.name];
                if (existingSchema) {
                    if (!existingSchema.latestVersion || semver.lt(existingSchema.latestVersion, version)) {
                        existingSchema.latestVersion = version;
                        existingSchema.path = schema.path;
                    }
                } else {
                    schemaInfoMap[schema.name] = {
                        name: schema.name,
                        latestVersion: version,
                        path: schema.path,
                    };
                }
            }
        }

        const schemaTable: string[][] = [
            ["Name", "Current Version", "Latest published Version"],
        ];
        for (const schema of Object.values(schemaInfoMap)) {
            if(!schema.version) {
                continue; // Skip schemas that are not in the database
            }

            let latestVersion = "";
            if(schema.latestVersion) {
                if (semver.eq(schema.version, schema.latestVersion)) {
                    latestVersion = chalk.green(schema.latestVersion.toString() + "\n(github)");
                } else if (semver.lt(schema.version, schema.latestVersion)) {
                    latestVersion = chalk.yellowBright(schema.latestVersion.toString() + "\n(github)");
                } else {
                    latestVersion = chalk.magenta(schema.latestVersion.toString() + "\n(github)");
                }
            }

            schemaTable.push([
                schema.name,
                schema.version.toString(),
                latestVersion,
            ]);
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
            const dumpPath = path.join(getFileContextFolderPath(ws.workspaceRootPath, file.relativePath), `schemas_dump_${currentTime}`) ;
            log.info(`Dumping all schemas to: ${dumpPath}`);
            mkdirSync(dumpPath, { recursive: true });

            await db.dumpSchemas(dumpPath);
            return;
        }
    }
}

function stripLeadingZeros(str: string): string {
    return str.replace(/(^|\.)0+(?=\d)/g, '$1');
}