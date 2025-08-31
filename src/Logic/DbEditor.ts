import { QueryBinder, QueryOptionsBuilder, QueryPropertyMetaData, QueryRowFormat } from "@itwin/core-common";
import chalk from "chalk";
import { stdin, stdout } from 'node:process';
import { createInterface } from "node:readline/promises";
import { ColumnUserConfig, table, TableUserConfig } from 'table';
import { formatWarning, logError, printError, resetChar } from "../ConsoleHelper";
import { UnifiedDb } from "../UnifiedDb";
import { saveCommandHistory, Context, WorkspaceFile } from "../Context";
import { common, createEmphasize } from 'emphasize'
import { performance } from "node:perf_hooks";
import { log, select, isCancel } from "@clack/prompts"
import { SchemaEditor } from "./SchemaEditor";
import { DbSettings } from "./DbSettings";

const emphasize = createEmphasize(common);

export class DbEditor {
    public static async run(ctx: Context, file: WorkspaceFile, db: UnifiedDb): Promise<void> {
        if (!db.isOpen) {
            throw new Error(`Db failed to open: ${file.relativePath}`);
        }

        while (true) {
            const experimentalEnabled = await DbSettings.getExperimentalFeaturesEnabled(db);
            const operation = await select({
                message: `${file.relativePath}${(db.isReadOnly ? ' (read-only)' : '')}`,
                options: [
                ...(db.supportsECSql ? [{ label: "ECSql", value: "ECSql" }] : []),
                /*{ label: "Sqlite", value: "Sqlite" },*/
                /*{ label: "Check", value: "Check" },*/
                ...(db.supportsSchemas ? [{ label: "Schemas", value: "Schemas" }] : []),
                ...(db.supportsChangesets ? [{ label: "Changesets", value: "Changesets" }] : []),
                { label: `Settings (Experimental features enabled: ${experimentalEnabled ? chalk.greenBright('true') : chalk.redBright('false')})`, value: "Settings" },
                { label: "Close", value: "Close" }
                ],
            });

            if(operation === "Close" || isCancel(operation)) {
                return; // Exit the loop and close the editor
            }

            try {
                switch (operation) {
                    case "ECSql":
                        console.log();
                        log.message("ECSql editor. (press up/down for history, Ctrl+C to exit, use semicolon to end statement)");
                        console.log();
                        while (await this.runECSql(ctx, db)) {
                            // Loop intentionally left empty: runECSql handles its own logic and exit condition
                        }
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
                        await SchemaEditor.run(ctx, file, db);
                        break;
                    case "Changesets":
                        console.log("Changesets operation selected.");
                        break;
                    case "Settings":
                        await DbSettings.run(db);
                        break;
                }
            } catch (error: unknown) {
                logError(error);
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

    static async runECSql(ctx: Context, db: UnifiedDb): Promise<boolean> {
        const queryOptions = new QueryOptionsBuilder();
        queryOptions.setRowFormat(QueryRowFormat.UseECSqlPropertyIndexes);
        queryOptions.setLimit({ count: 101 }); // limiting to 101 rows for now. If we exceed 100 we print that we have more than 100 rows.
        queryOptions.setAbbreviateBlobs(true);
        const history = ctx.commandCache?.ecsqlHistory ?? [];

        const rl = createInterface({
            input: stdin,
            output: stdout,
            terminal: true,
            prompt: "ECSql> ",
            history,
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

        const newLength = history.length;
        if (newLength > 10) {
            ctx.commandCache!.ecsqlHistory = history.slice(10);
            }
        await saveCommandHistory(ctx);

        let rows: unknown[] = [];
        let metadata: QueryPropertyMetaData[] = [];
        const classIdCache: Record<string, string> = {};
        const startTicks = performance.now();
        let queryDuration = 0;
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

            queryDuration = performance.now() - startTicks;
        } catch (error: unknown) {
            console.error(formatWarning(`ECSql query failed: ${ecsql}`));
            printError(error);
            return true; // Return true to allow the user to enter a new query
        }

        const output: string[][] = [];
        const headerRow = metadata.map(col => col.name);
        output.push(headerRow);
        const jsonCells: { rowIndex: number, colIndex: number}[] = []

        const maxRowIndex = rows.length > 100 ? 99 : rows.length - 1;
        for (let colIndex = 0; colIndex < metadata.length; colIndex++) {
            const colInfo = metadata[colIndex];
            for (let rowIndex = 0; rowIndex <= maxRowIndex; rowIndex++) {
                const row = rows[rowIndex] as unknown[];
                const { value: cValue, detectedType } = await this.formatValue(row[colIndex], colInfo, db, classIdCache);
                let value = cValue;
                if(detectedType === "json") {
                    jsonCells.push({ rowIndex: rowIndex + 2, colIndex }); // +2 for header and title rows
                }

                if (colIndex === 0) {
                    output.push(new Array(metadata.length));
                }

                if (value === null || value === undefined) {
                    value = ""; // Normalize null/undefined to empty string
                }

                if (value !== null && value !== undefined) {
                    const formattedValue = String(value);
                    output[rowIndex + 1][colIndex] = formattedValue;
                }
            }
        }

        const widths = this.calculateColumnWidths(output, process.stdout.columns);
        const columns: ColumnUserConfig[] = [];
        for (let i = 0; i < output[0].length; i++) {
            const meta = metadata[i];
            const width = widths[i];
            const isNumericType = meta.typeName === "int" || meta.typeName === "double" || meta.typeName === "long";
            const alignment = isNumericType ? "right" : "left";
            columns.push({ alignment, width, wrapWord: false });
        }

        const config: TableUserConfig = {
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

        if (jsonCells.length > 0) { // colorizing happens after calculateClumnWidths because the color characters should not be counted
            for (const cell of jsonCells) {
                const highlighted = emphasize.highlight('json', output[cell.rowIndex][cell.colIndex]);
                if(highlighted.value) {
                    output[cell.rowIndex][cell.colIndex] = highlighted.value + resetChar;
                }
            }
        }

        console.log(table(output, config));

        if (rows.length > 100) {
            console.log(formatWarning("More than 100 rows returned. Only the first 100 rows are displayed."));
        }

        if( queryDuration < 1000) {
            console.log(`Executed in ${queryDuration.toFixed()} ms.`);
        } else {
            console.log(`Executed in ${(queryDuration / 1000).toFixed(2)} seconds.`);
        }

        return true;
    }

    static async formatValue(value: unknown, colInfo: QueryPropertyMetaData, db: UnifiedDb, classIdCache: Record<string, string>)
    : Promise<{value: string, detectedType?: string}> {
        if (value === null || value === undefined) {
            return {value: ""};
        }

        if (typeof value === "string") {
            // Try to pretty-print JSON if possible
            try {
                if(value &&
                (colInfo.extendedType?.toLowerCase() === "json" || colInfo.typeName.toLowerCase() === "string") &&
                value.startsWith("{")) {
                    const jsonValue = JSON.parse(value);
                    if (typeof jsonValue === "object" && jsonValue) {
                        return { value: JSON.stringify(jsonValue, null, 2), detectedType: "json" };
                    }
                }

            } catch {
                // Not valid JSON, just return as is
            }
            return { value };
        }

        if (typeof value === "number" || typeof value === "boolean") {
            return { value: String(value)};
        }

        if (colInfo.typeName === "navigation") {
            if (
            typeof value === "object" &&
            value !== null &&
            "Id" in value &&
            "RelECClassId" in value
            ) {
            const id = (value as { Id: string }).Id;
            const classId = (value as { RelECClassId: string }).RelECClassId;
            if (!id || !classId) {
                return { value: "" };
            }
            const className = await this.getClassName(db, classId, classIdCache);
            return { value: `${className} ${id}` };
            }
            return { value: "" };
        }

        if (Array.isArray(value)) {
            return {value: `[${value.map(v => this.formatValue(v, colInfo, db, classIdCache)).join(", ")}]`};
        }

        return { value: JSON.stringify(value) };
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
                        const width = this.calculateWidth(cell);
                        columnWidths[i] = width;
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

    static calculateWidth(cell: string): number {
        if (cell.includes('\n')) {
            return cell.split('\n').reduce((max, line) => Math.max(max, line.length), 0);
        }
        return cell.length;
    }
}