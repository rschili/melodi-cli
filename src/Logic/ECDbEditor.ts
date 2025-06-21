import { ECDb, ECDbOpenMode, IModelHost } from "@itwin/core-backend";
import { Workspace, WorkspaceFile } from "../Workspace";
import path from "path";
import prompts from "prompts";
import { select, Separator } from "@inquirer/prompts";
import { ECSqlReader, QueryOptionsBuilder, QueryPropertyMetaData, QueryRowFormat } from "@itwin/core-common";
import { exitProcessOnAbort, formatSuccess, formatWarning, printError } from "../ConsoleHelper";
import { stdin, stdout } from 'node:process';
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { loadSchemaInventory } from "../GithubBisSchemasHelper";
import semver from "semver";

type Choice<T> = Exclude<
  Parameters<typeof select<T>>[0]["choices"][number],
  string | Separator
>;

export class ECDbEditor {
    private static ecsqlHistory: string[] = [];

    public static async run(ws: Workspace, file: WorkspaceFile, openMode: ECDbOpenMode): Promise<void> {
        await IModelHost.startup({
            cacheDir: ws.cacheDirPath,
        });
        using db: ECDb = new ECDb();
        db.openDb(path.join(ws.workspaceRootPath, file.relativePath), openMode);
        if(!db.isOpen) {
            throw new Error(`Failed to open ECDb file: ${file.relativePath}`);
        }

        while(true) {
            const operationAnswer = await prompts({
                name: "value",
                type: "select",
                message: `${file.relativePath} (ECDb, ${ECDbOpenMode[openMode]})`,
                choices: [
                    { title: "ECSql", value: "ECSql" },
                    { title: "Sqlite", value: "Sqlite" },
                    { title: "Stats", value: "Stats" },
                    { title: "Schemas", value: "Schemas" },
                    { title: "Close", value: "Close" }
                ],
                initial: 0,
                onState: exitProcessOnAbort,
            });
            const operation = operationAnswer.value;

            try {
                switch (operation) {
                    case "ECSql":
                        console.log(chalk.gray(" (up/down for history, Ctrl+C to exit, use semicolon to end statement)"));
                        while (await this.runECSql(db)) {}
                        break;
                    case "Sqlite":
                        console.log("Sqlite operation selected.");
                        // Add Sqlite operation logic here
                        break;
                    case "Stats":
                        console.log("Stats operation selected.");
                        // Add Stats operation logic here
                        break;
                    case "Schemas":
                        await this.runSchemas(ws, db);
                        break;
                    case "Close":
                        db.closeDb();
                        console.log("database closed.");
                        return;
                }
            } catch (error: unknown) {
                printError(error);
            }
        }
    }

    static async runECSql(db: ECDb): Promise<boolean> {
        const queryOptions = new QueryOptionsBuilder();
        queryOptions.setRowFormat(QueryRowFormat.UseECSqlPropertyIndexes);
        queryOptions.setLimit({ count: 101 }); // limiting to 101 rows for now. If we exceed 100 we print that we have more than 100 rows.
        queryOptions.setAbbreviateBlobs(true);

        const rl = createInterface({
            input: stdin,
            output: stdout,
            terminal: true,
            prompt: "ECSql> ",
            history: this.ecsqlHistory,
        });

        let interrupted = false;
        rl.on('SIGINT', () => {
            interrupted = true;
            rl.close();
            console.log("\n"); // Move to a new line to avoid overwriting the prompt
        });

        //const ecsql = await rl.question("ecsql>");
        let ecsql = "";
        rl.prompt();
        for await (const line of rl) {
            ecsql += line;

            if (line.trim().endsWith(';')) {
                rl.close();
                break;
            }

            rl.prompt();
        }

        if( interrupted) {
            return false;
        }

        const reader = db.createQueryReader(ecsql, undefined, queryOptions.getOptions());
        const rows = await reader.toArray();
        this.ecsqlHistory.push(ecsql);

        if (rows === undefined || rows.length === 0) {
            console.log("No rows returned.");
            return true;
        }

        const metadata = await reader.getMetaData();
        if (metadata.length === 0) {
            console.log("No metadata returned.");
            return true;
        }

        const output: string[][] = [];
        const headerRow = metadata.map(col => col.name);
        output.push(headerRow);
        const typeRow = metadata.map(col => (col.extendedType === undefined ? col.typeName : `${col.typeName} (${col.extendedType})`));
        output.push(typeRow);

        const maxRowIndex = rows.length > 100 ? 99 : rows.length -1;
        for (let colIndex = 0; colIndex < metadata.length; colIndex++) {
            const colInfo = metadata[colIndex];
            for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
                const value = rows[rowIndex][colIndex];

                if (colIndex === 0) {
                    output.push(new Array(metadata.length));
                }

                if(value !== null && value !== undefined) {
                    let formattedValue = String(value);
                    if (formattedValue.length > 100) {
                        formattedValue = formattedValue.substring(0, 97) + "...";
                    }
                    output[rowIndex + 2][colIndex] = formattedValue;
                }
            }
        }

        for(const row of output) {
            console.log(row.map(cell => cell === undefined ? "" : cell).join(" | "));
        }

        if( rows.length > 100) {
            console.log(formatWarning("More than 100 rows returned. Only the first 100 rows are displayed."));
        }

        return true;
    }

    static arrayToTable(metadata: QueryPropertyMetaData[], data: any[], headerCount: number = 0): string {
        if (data.length === 0) {
            return "";
        }

        const headers: string[] = Array.from(data.reduce((headersSet, row) => {
            Object.keys(row).forEach(header => headersSet.add(header));
            return headersSet;
        }, new Set<string>()));

        const columnWidths = headers.map(header =>
            Math.max(header.length, ...data.map(row => String(row[header]).length))
        );

        const formatRow = (row: any) =>
            `| ${headers.map((header, i) => String(row[header]).padEnd(columnWidths[i])).join(" | ")} |`;

        const headerRow = formatRow(headers.reduce((acc, header) => ({ ...acc, [header]: header }), {}));
        const separatorRow = `| ${columnWidths.map(width => "-".repeat(width)).join(" | ")} |`;
        const dataRows = data.map(formatRow);

        return [headerRow, separatorRow, ...dataRows].join("\n");
    }

    static normalizeCellWidths(data: string[][]): void {
        if (data.length === 0) {
            return;
        }

        const columnWidths: number[] = [];
        for (const row of data) {
            for (let i = 0; i < row.length; i++) {
                const cell = row[i];
                if (!columnWidths[i] || cell.length > columnWidths[i]) {
                    columnWidths[i] = cell.length;
                }
            }
        }

        for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
            for (let colIndex = 0; colIndex < data[rowIndex].length; colIndex++) {
                data[rowIndex][colIndex] = data[rowIndex][colIndex].padEnd(columnWidths[colIndex]);
            }
        }
    }

    static printTable(data: string[][], headerCount: number = 1) {
        if (data.length === 0) {
            console.log("(no data)");
            return;
        }

        const horizontalLine = "+-" + data[0].map((headerValue) => "-".repeat(headerValue.length)).join("-+-") + "-+";

        console.log();
        console.log(horizontalLine);
        for (let i = 0; i < data.length; i++) {
            if (i === headerCount && headerCount > 0) {
                console.log(horizontalLine);
            }
            console.log("| " + data[i].map(cell => cell ?? "").join(" | ") + " |");
        }
        if (data.length > headerCount) {
            console.log(horizontalLine);
        }
    }

    static async runSchemas(ws: Workspace, db: ECDb): Promise<void> {
        const queryOptions = new QueryOptionsBuilder();
        queryOptions.setRowFormat(QueryRowFormat.UseECSqlPropertyIndexes);
        const reader = db.createQueryReader(
            "SELECT Name, VersionMajor ,VersionWrite, VersionMinor FROM meta.ECSchemaDef",
            undefined,
            queryOptions.getOptions()
        );
        const schemasInDb = await reader.toArray();

        const availableSchemas = await loadSchemaInventory(ws.userConfigDirPath);

        type SchemaInfo = {
            name: string;
            version?: semver.SemVer;
            latestVersion?: semver.SemVer;
            path?: string;
        };

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
                if(!schema.released || !schema.path)
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

        const choices: Choice<SchemaInfo>[] = [];
        for (const schema of Object.values(schemaInfoMap)) {
            let name = schema.name;
            const version = schema.version ? schema.version.toString() : "        ";
            const latestVersion = schema.latestVersion ? schema.latestVersion.toString() : "        ";
            const path = schema.path ? schema.path : "              ";
            if(schema.version)
            {
                if(schema.latestVersion) {
                    if (semver.eq(schema.version, schema.latestVersion)) {
                        choices.push({ name: `${name} (${version} - ${chalk.green('latest')})`, value: schema });
                    } else if (semver.lt(schema.version, schema.latestVersion)) {
                        choices.push({ name: `${name} (${version} - ${chalk.yellow(`${schema.latestVersion} available`)})`, value: schema });
                    } else {
                        choices.push({ name: `${name} (${version} - ${chalk.magenta('newer than known??')})`, value: schema });
                    }
                } else {
                    choices.push({ name: `${name} (${version})`, value: schema });
                }
            } else {
                choices.push({ name: `${name} (${chalk.gray('available for import')})`, value: schema });
            }
        }
        choices.sort((a, b) => {
            if (a.value.version && !b.value.version) return -1;
            if (!a.value.version && b.value.version) return 1;
            return a.name!.localeCompare(b.name!);
        });

        const answer = await select({
            message: "Select schema to view options",
            choices: choices,
            pageSize: 25,
            loop: false,
        });
    }
}

function stripLeadingZeros(str: string): string {
    return str.replace(/(^|\.)0+(?=\d)/g, '$1');
}