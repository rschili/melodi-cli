import { select, Separator } from "@inquirer/prompts";
import { QueryBinder, QueryOptionsBuilder, QueryPropertyMetaData, QueryRowFormat } from "@itwin/core-common";
import chalk from "chalk";
import { stdin, stdout } from 'node:process';
import { createInterface } from "node:readline/promises";
import semver from "semver";
import { ColumnUserConfig, table, TableUserConfig } from 'table';
import { formatWarning, printError } from "../ConsoleHelper";
import { loadSchemaInventory } from "../GithubBisSchemasHelper";
import { UnifiedDb } from "../UnifiedDb";
import { saveWorkspaceConfig, Workspace, WorkspaceFile } from "../Workspace";
import { common, createEmphasize } from 'emphasize'

type Choice<T> = Exclude<
    Parameters<typeof select<T>>[0]["choices"][number],
    string | Separator
>;

type SchemaInfo = {
    name: string;
    version?: semver.SemVer;
    latestVersion?: semver.SemVer;
    path?: string;
};

const emphasize = createEmphasize(common);

export class DbEditor {
    public static async run(ws: Workspace, file: WorkspaceFile, db: UnifiedDb): Promise<void> {
        if (!db.isOpen) {
            throw new Error(`Db failed to open: ${file.relativePath}`);
        }

        while (true) {
            const operation = await select({
                message: `${file.relativePath}${(db.isReadOnly ? ' (read-only)' : '')}`,
                choices: [
                    { name: "ECSql", value: "ECSql", disabled: !db.supportsECSql },
                    { name: "Sqlite", value: "Sqlite" },
                    { name: "Stats", value: "Stats" },
                    { name: "Schemas", value: "Schemas", description: chalk.yellowBright("On ECDb level, the support for importing schemas is limited to a single schema at a time. Use iModelDb if you need more options.") },
                    { name: "Close", value: "Close" }
                ],
            });

            try {
                switch (operation) {
                    case "ECSql":
                        console.log(chalk.gray(" (up/down for history, Ctrl+C to exit, use semicolon to end statement)"));
                        while (await this.runECSql(ws, db)) { }
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
                        console.log("database closed.");
                        return;
                }
            } catch (error: unknown) {
                printError(error);
            }
        }
    }

    public static async getClassName(db: UnifiedDb, classIdHex: string, cache: Record<string, string>): Promise<string> {
        const params = new QueryBinder();
        params.bindId(1, classIdHex);
        const reader = db.createQueryReader(
            `SELECT Name FROM meta.ECClassDef WHERE ECInstanceId = ? LIMIT 1`,
            params,
            { rowFormat: QueryRowFormat.UseECSqlPropertyIndexes }
        );
        const rows = await reader.toArray();
        if (rows.length === 0) {
            cache[classIdHex] = "UnknownClass";
        } else {
            const className = rows[0][0];
            cache[classIdHex] = className;
        }

        return cache[classIdHex];
    }

    static async runECSql(ws: Workspace, db: UnifiedDb): Promise<boolean> {
        const queryOptions = new QueryOptionsBuilder();
        queryOptions.setRowFormat(QueryRowFormat.UseECSqlPropertyIndexes);
        queryOptions.setLimit({ count: 101 }); // limiting to 101 rows for now. If we exceed 100 we print that we have more than 100 rows.
        queryOptions.setAbbreviateBlobs(true);

        const rl = createInterface({
            input: stdin,
            output: stdout,
            terminal: true,
            prompt: "ECSql> ",
            history: ws.config?.ecsqlHistory,
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
            if (ecsql === "")
                ecsql = line;
            else
                ecsql += "\n" + line;

            if (line.trim().endsWith(';')) {
                rl.close();
                break;
            }

            rl.prompt();
        }

        if (interrupted) {
            return false;
        }

        if (ws.config?.ecsqlHistory === undefined) {
            ws.config!.ecsqlHistory = [];
        }
        const ecsqlSingleLine = ecsql.replace(/\s*\n\s*/g, ' ').trim();
        if (!ws.config!.ecsqlHistory.includes(ecsqlSingleLine)) {
            ws.config!.ecsqlHistory.push(ecsqlSingleLine);
            if (ws.config!.ecsqlHistory.length > 10) {
                ws.config!.ecsqlHistory = ws.config!.ecsqlHistory.slice(-10);
            }
        }
        saveWorkspaceConfig(ws);

        let rows: any[] = [];
        let metadata: QueryPropertyMetaData[] = [];
        let classIdCache: Record<string, string> = {};

        try {
            const reader = db.createQueryReader(ecsql, undefined, queryOptions.getOptions());
            rows = await reader.toArray();

            if (rows === undefined || rows.length === 0) {
                console.log("No rows returned.");
                return true;
            }

            metadata = await reader.getMetaData();
            if (metadata.length === 0) {
                console.log("No metadata returned.");
                return true;
            }
        } catch (error: unknown) {
            console.error(formatWarning(`ECSql query failed: ${ecsql}`));
            printError(error);
            return true; // Return true to allow the user to enter a new query
        }

        const output: string[][] = [];
        const headerRow = metadata.map(col => col.name);
        output.push(headerRow);

        const maxRowIndex = rows.length > 100 ? 99 : rows.length - 1;
        for (let colIndex = 0; colIndex < metadata.length; colIndex++) {
            const colInfo = metadata[colIndex];
            for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
                let value = await this.formatValue(rows[rowIndex][colIndex], colInfo, db, classIdCache);

                if (colIndex === 0) {
                    output.push(new Array(metadata.length));
                }

                if (value === null || value === undefined) {
                    value = ""; // Normalize null/undefined to empty string
                }

                if (value !== null && value !== undefined) {
                    let formattedValue = String(value);
                    output[rowIndex + 1][colIndex] = formattedValue;
                }
            }
        }

        /*this.normalizeCellWidths(output, process.stdout.columns);
        this.printTable(output, 2);*/
        const widths = this.calculateColumnWidths(output, process.stdout.columns);
        const columns: ColumnUserConfig[] = [];
        for (let i = 0; i < output[0].length; i++) {
            const meta = metadata[i];
            const width = widths[i];
            const isNumericType = meta.typeName === "int" || meta.typeName === "double" || meta.typeName === "long";
            const alignment = isNumericType ? "right" : "left";
            columns.push({ alignment, width, wrapWord: !isNumericType });
        }

        let config: TableUserConfig = {
            columns,
            spanningCells: [
                { col: 0, row: 0, colSpan: output[0].length, alignment: "center" },
            ]
        }

        const formattedSql = emphasize.highlight('sql', ecsql).value;

        // complement header row with types and colors
        for(let i = 0; i < metadata.length; i++) {
            const value = output[0][i];
            const meta = metadata[i];
            const typeName = meta.extendedType ?? meta.typeName;
            output[0][i] = `${chalk.bold(value)}\n${chalk.italic(typeName)}`;
        }
        output.unshift([formattedSql, ...Array(headerRow.length - 1).fill("")]);

        console.log(table(output, config));

        if (rows.length > 100) {
            console.log(formatWarning("More than 100 rows returned. Only the first 100 rows are displayed."));
        }

        return true;
    }

    static async formatValue(value: any, colInfo: QueryPropertyMetaData, db: UnifiedDb, classIdCache: Record<string, string>): Promise<string> {
        if (value === null || value === undefined) {
            return "";
        }

        if (typeof value === "string") {
            return value;
        }

        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }

        if (colInfo.typeName === "navigation") {
            const id = value.Id;
            const classId = value.RelECClassId;
            if (!id || !classId) {
                return "";
            }
            const className = await this.getClassName(db, classId, classIdCache);
            return `${className} ${id}`;
        }

        if (Array.isArray(value)) {
            return `[${value.map(v => this.formatValue(v, colInfo, db, classIdCache)).join(", ")}]`;
        }

        return JSON.stringify(value);
    }

    static calculateColumnWidths(data: string[][], maxWidth: number): number[] {
        if (data.length === 0) {
            return [];
        }

        if (maxWidth < 80) maxWidth = 80; // Ensure a minimum width for readability

        let columnWidths: number[] = [];
        const minWidthPerColumn = 8;
        const minRequiredWidth = data[0].length * minWidthPerColumn;
        if (maxWidth < minRequiredWidth) {
            columnWidths = new Array(data[0].length).fill(minWidthPerColumn);
        } else {
            for (const row of data) {
                for (let i = 0; i < row.length; i++) {
                    const cell = row[i];
                    if (!cell)
                        continue; // Skip undefined or null cells

                    if (!columnWidths[i] || cell.length > columnWidths[i]) {
                        columnWidths[i] = cell.length;
                    }
                }
            }

            // Ensure column widths do not exceed maxWidth
            let totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + (columnWidths.length * 3); // for padding;
            if (totalWidth > maxWidth) {
                while (totalWidth > maxWidth) {
                    // Find the index of the longest column
                    let maxColIdx = 0;
                    for (let i = 1; i < columnWidths.length; i++) {
                        if (columnWidths[i] > columnWidths[maxColIdx]) {
                            maxColIdx = i;
                        }
                    }
                    // Cut its width in half (at least 8 chars wide)
                    columnWidths[maxColIdx] = Math.max(8, Math.floor(columnWidths[maxColIdx] / 2));
                    totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + (columnWidths.length * 3); // for padding;
                }
            }
        }
        return columnWidths;
    }

    static async runSchemas(ws: Workspace, db: UnifiedDb): Promise<void> {
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

        const availableSchemas = await loadSchemaInventory(ws.userConfigDirPath);


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

        const choices: Choice<SchemaInfo | string>[] = [];
        for (const schema of Object.values(schemaInfoMap)) {
            let name = schema.name;
            if (!schema.version)
                continue; // Skip schemas that are not in the database

            const version = schema.version.toString();
            if (schema.latestVersion) {
                if (semver.eq(schema.version, schema.latestVersion)) {
                    choices.push({ name: `${name} (${version} - ${chalk.green('latest')})`, value: schema, disabled: true });
                } else if (semver.lt(schema.version, schema.latestVersion)) {
                    choices.push({ name: `${name} (${version} - ${chalk.yellowBright(`${schema.latestVersion} available`)})`, value: schema });
                } else {
                    choices.push({ name: `${name} (${version} - ${chalk.magenta('newer than known??')})`, value: schema });
                }
            } else {
                choices.push({ name: `${name} (${version})`, value: schema, disabled: true });
            }
        }
        choices.sort((a, b) => {
            return a.name!.localeCompare(b.name!);
        });
        choices.push({ name: "Import a new schema", value: "__import__" });

        if (choices.length === 0) {
            console.log("No schemas found in the database (that's odd).");
            return;
        }
        let pageSize = 25;
        const terminalRows = process.stdout.rows;
        if (terminalRows > 25) {
            pageSize = Math.max(25, Math.floor(terminalRows * 0.5));
        }

        const selectedSchema = await select({
            message: "Select a schema to update",
            choices: choices,
            pageSize: pageSize,
            loop: false,
        });

        if (typeof selectedSchema === "string") {
            if (selectedSchema === "__import__") {
                console.log("Importing a new schema is not yet implemented.");
            }
            return;
        }

        console.log(`Selected schema: ${selectedSchema.name}`);
        if (selectedSchema.version) {
            console.log(`Version: ${selectedSchema.version}`);
        }
    }
}

function stripLeadingZeros(str: string): string {
    return str.replace(/(^|\.)0+(?=\d)/g, '$1');
}