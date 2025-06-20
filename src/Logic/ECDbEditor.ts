import { ECDb, ECDbOpenMode, IModelHost } from "@itwin/core-backend";
import { Workspace, WorkspaceFile } from "../Workspace";
import path from "path";
import prompts from "prompts";
import { ECSqlReader, QueryOptionsBuilder, QueryPropertyMetaData, QueryRowFormat } from "@itwin/core-common";
import { exitProcessOnAbort, formatSuccess, formatWarning, printError } from "../ConsoleHelper";

export class ECDbEditor {
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
                message: "What do you want to do?",
                choices: [
                    { title: "Run an ECSql statement", value: "ECSql" },
                    { title: "Run a Sqlite statement", value: "Sqlite" },
                    { title: "Get database statistics", value: "Stats" },
                    { title: "Close the database", value: "Close" }
                ],
                initial: 0,
                onState: exitProcessOnAbort,
            });
            const operation = operationAnswer.value;

            try {
                switch (operation) {
                    case "ECSql":
                        await this.runECSql(db);
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

    static async runECSql(db: ECDb) {
        const queryOptions = new QueryOptionsBuilder();
        queryOptions.setRowFormat(QueryRowFormat.UseECSqlPropertyIndexes);
        queryOptions.setLimit({ count: 101 }); // limiting to 101 rows for now. If we exceed 100 we print that we have more than 100 rows.
        queryOptions.setAbbreviateBlobs(true);

        let reader: ECSqlReader | undefined;
        let rows: any[] | undefined;

        const ecsqlAnswer = await prompts({
            name: "value",
            type: "text",
            message: "ECSql",
            onState: exitProcessOnAbort,
            validate: async(value: string) => {
                if (value.trim() === "") {
                    return "ECSql statement cannot be empty.";
                }
                try {
                    reader = db.createQueryReader(value, undefined, queryOptions.getOptions());
                    rows = await reader.toArray();
                    return true;
                } catch (error: unknown) {
                    reader = undefined;
                    return "Invalid ECSql statement.";
                }
            }
        });

        if (reader === undefined) {
            console.log("No valid ECSql statement provided.");
            return;
        }

        if (rows === undefined || rows.length === 0) {
            console.log("No rows returned.");
            return;
        }

        const metadata = await reader.getMetaData();
        if (metadata.length === 0) {
            console.log("No metadata returned.");
            return;
        }

        const output: string[][] = [];
        const headerRow = metadata.map(col => col.name);
        output.push(headerRow);
        const typeRow = metadata.map(col => (col.extendedType === undefined ? col.typeName : `${col.typeName} (${col.extendedType})`));
        output.push(typeRow);

        const maxRowIndex = rows.length > 100 ? 99 : rows.length;
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