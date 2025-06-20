import { ECDb, ECDbOpenMode, IModelHost } from "@itwin/core-backend";
import { Workspace, WorkspaceFile } from "../Workspace";
import path from "path";
import prompts from "prompts";
import { ECSqlReader, QueryOptionsBuilder, QueryPropertyMetaData, QueryRowFormat } from "@itwin/core-common";
import { exitProcessOnAbort, formatSuccess, formatWarning, printError } from "../ConsoleHelper";
import { stdin, stdout } from 'node:process';
import { createInterface } from "node:readline/promises";
import chalk from "chalk";

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

        console.log(formatSuccess(`Opened ECDb file: ${file.relativePath} in mode: ${ECDbOpenMode[openMode]}`));

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

    static arrayToTable(metadata: QueryPropertyMetaData[], data: any[]): string {
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
}