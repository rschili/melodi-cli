import { QueryOptionsBuilder, QueryPropertyMetaData, QueryRowFormat } from "@itwin/core-common";
import { DbResult } from "@itwin/core-bentley";
import chalk from "chalk";
import { ColumnUserConfig, table, TableUserConfig } from "table";
import { formatWarning, resetChar } from "../ConsoleHelper";
import { UnifiedDb } from "../UnifiedDb";
import { common, createEmphasize } from "emphasize";
import { performance } from "node:perf_hooks";

const emphasize = createEmphasize(common);
const MAX_ROWS = 100;

export interface QueryResult {
    rowCount: number;
    durationMs: number;
    truncated: boolean;
}

/**
 * Executes an ECSql query, prints results as a formatted table to stdout,
 * and returns summary metadata.
 */
export async function executeAndPrintQuery(db: UnifiedDb, ecsql: string): Promise<QueryResult> {
    const queryOptions = new QueryOptionsBuilder();
    queryOptions.setRowFormat(QueryRowFormat.UseECSqlPropertyIndexes);
    queryOptions.setLimit({ count: MAX_ROWS + 1 });
    queryOptions.setAbbreviateBlobs(true);

    const startTicks = performance.now();
    const reader = db.createQueryReader(ecsql, undefined, queryOptions.getOptions());
    const rows = await reader.toArray();

    if (!rows || rows.length === 0) {
        const durationMs = performance.now() - startTicks;
        console.log("No rows returned.");
        return { rowCount: 0, durationMs, truncated: false };
    }

    const metadata = await reader.getMetaData();
    if (metadata.length === 0) {
        const durationMs = performance.now() - startTicks;
        console.log("No metadata returned.");
        return { rowCount: 0, durationMs, truncated: false };
    }

    const durationMs = performance.now() - startTicks;
    const truncated = rows.length > MAX_ROWS;
    const displayRows = truncated ? rows.slice(0, MAX_ROWS) : rows;

    const classIdCache: Record<string, string> = {};
    const output = await buildTableData(displayRows, metadata, db, classIdCache);

    const widths = calculateColumnWidths(output, process.stdout.columns);
    const columns: ColumnUserConfig[] = [];
    for (let i = 0; i < output[0].length; i++) {
        const meta = metadata[i];
        const width = widths[i];
        const isNumericType = meta.typeName === "int" || meta.typeName === "double" || meta.typeName === "long";
        const alignment = isNumericType ? "right" : "left";
        columns.push({ alignment, width, wrapWord: false });
    }

    const headerRow = output[0];
    const jsonCells: { rowIndex: number; colIndex: number }[] = [];

    // Detect JSON cells before adding title row
    for (let colIndex = 0; colIndex < metadata.length; colIndex++) {
        for (let rowIndex = 1; rowIndex < output.length; rowIndex++) {
            const cell = output[rowIndex][colIndex];
            if (cell && metadata[colIndex].extendedType?.toLowerCase() === "json") {
                // Will be at rowIndex + 1 after title row is prepended
                jsonCells.push({ rowIndex: rowIndex + 1, colIndex });
            }
        }
    }

    // Complement header row with types and colors
    for (let i = 0; i < metadata.length; i++) {
        const value = output[0][i];
        const meta = metadata[i];
        const typeName = meta.extendedType ?? meta.typeName;
        output[0][i] = `${chalk.bold(value)}\n${chalk.italic(typeName)}`;
    }

    const formattedSql = emphasize.highlight("sql", ecsql).value;
    output.unshift([formattedSql, ...Array(headerRow.length - 1).fill("")]);

    if (jsonCells.length > 0) {
        for (const cell of jsonCells) {
            const highlighted = emphasize.highlight("json", output[cell.rowIndex][cell.colIndex]);
            if (highlighted.value) {
                output[cell.rowIndex][cell.colIndex] = highlighted.value + resetChar;
            }
        }
    }

    const config: TableUserConfig = {
        columns,
        spanningCells: [{ col: 0, row: 0, colSpan: headerRow.length, alignment: "center" }],
    };

    console.log(table(output, config));

    if (truncated) {
        console.log(formatWarning(`More than ${MAX_ROWS} rows returned. Only the first ${MAX_ROWS} rows are displayed.`));
    }

    if (durationMs < 1000) {
        console.log(`Executed in ${durationMs.toFixed()} ms.`);
    } else {
        console.log(`Executed in ${(durationMs / 1000).toFixed(2)} seconds.`);
    }

    return { rowCount: displayRows.length, durationMs, truncated };
}

async function buildTableData(
    rows: unknown[],
    metadata: QueryPropertyMetaData[],
    db: UnifiedDb,
    classIdCache: Record<string, string>
): Promise<string[][]> {
    const output: string[][] = [];
    const headerRow = metadata.map((col) => col.name);
    output.push(headerRow);

    for (let colIndex = 0; colIndex < metadata.length; colIndex++) {
        const colInfo = metadata[colIndex];
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const row = rows[rowIndex] as unknown[];
            const { value: cValue } = await formatValue(row[colIndex], colInfo, db, classIdCache);
            let value = cValue;

            if (colIndex === 0) {
                output.push(new Array(metadata.length));
            }

            if (value === null || value === undefined) {
                value = "";
            }

            output[rowIndex + 1][colIndex] = String(value);
        }
    }

    return output;
}

export async function formatValue(
    value: unknown,
    colInfo: QueryPropertyMetaData,
    db: UnifiedDb,
    classIdCache: Record<string, string>
): Promise<{ value: string; detectedType?: string }> {
    if (value === null || value === undefined) {
        return { value: "" };
    }

    if (typeof value === "string") {
        try {
            if (
                value &&
                (colInfo.extendedType?.toLowerCase() === "json" || colInfo.typeName.toLowerCase() === "string") &&
                value.startsWith("{")
            ) {
                const jsonValue = JSON.parse(value);
                if (typeof jsonValue === "object" && jsonValue) {
                    return { value: JSON.stringify(jsonValue, null, 2), detectedType: "json" };
                }
            }
        } catch {
            // Not valid JSON
        }
        return { value };
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return { value: String(value) };
    }

    if (colInfo.typeName === "navigation") {
        if (typeof value === "object" && value !== null && "Id" in value && "RelECClassId" in value) {
            const id = (value as { Id: string }).Id;
            const classId = (value as { RelECClassId: string }).RelECClassId;
            if (!id || !classId) {
                return { value: "" };
            }
            const className = await getClassName(db, classId, classIdCache);
            return { value: `${className} ${id}` };
        }
        return { value: "" };
    }

    if (Array.isArray(value)) {
        const formatted = await Promise.all(value.map((v) => formatValue(v, colInfo, db, classIdCache)));
        return { value: `[${formatted.map((f) => f.value).join(", ")}]` };
    }

    return { value: JSON.stringify(value) };
}

async function getClassName(db: UnifiedDb, classIdHex: string, cache: Record<string, string>): Promise<string> {
    if (cache[classIdHex]) return cache[classIdHex];

    const { QueryBinder } = await import("@itwin/core-common");
    const params = new QueryBinder();
    params.bindId(1, classIdHex);
    const reader = db.createQueryReader(`SELECT Name FROM meta.ECClassDef WHERE ECInstanceId = ? LIMIT 1`, params, {
        rowFormat: QueryRowFormat.UseECSqlPropertyIndexes,
    });
    const rows = await reader.toArray();
    cache[classIdHex] = rows.length === 0 ? "UnknownClass" : (rows[0] as unknown[])[0] as string;
    return cache[classIdHex];
}

export function calculateColumnWidths(data: string[][], maxWidth: number): number[] {
    if (data.length === 0) return [];

    if (maxWidth < 80) maxWidth = 80;

    let columnWidths: number[] = [];
    const minWidthPerColumn = 8;
    const minRequiredWidth = data[0].length * minWidthPerColumn;
    if (maxWidth < minRequiredWidth) {
        columnWidths = new Array(data[0].length).fill(minWidthPerColumn);
    } else {
        for (const row of data) {
            for (let i = 0; i < row.length; i++) {
                const cell = row[i];
                if (!cell) continue;

                const width = calculateWidth(cell);
                if (!columnWidths[i] || width > columnWidths[i]) {
                    columnWidths[i] = width;
                }
            }
        }

        let totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + columnWidths.length * 3;
        while (totalWidth > maxWidth) {
            let maxColIdx = 0;
            for (let i = 1; i < columnWidths.length; i++) {
                if (columnWidths[i] > columnWidths[maxColIdx]) {
                    maxColIdx = i;
                }
            }
            columnWidths[maxColIdx] = Math.max(8, Math.floor(columnWidths[maxColIdx] / 2));
            totalWidth = columnWidths.reduce((sum, w) => sum + w, 0) + columnWidths.length * 3;
        }
    }
    return columnWidths;
}

function calculateWidth(cell: string): number {
    if (cell.includes("\n")) {
        return cell.split("\n").reduce((max, line) => Math.max(max, line.length), 0);
    }
    return cell.length;
}

/**
 * Executes a plain SQLite query via withSqliteStatement, prints results as a
 * formatted table, and returns summary metadata.
 */
export function executeAndPrintSqliteQuery(db: UnifiedDb, sql: string): QueryResult {
    const startTicks = performance.now();

    const result = db.withSqliteStatement(sql, (stmt) => {
        const rows: string[][] = [];
        let colCount = 0;

        while (stmt.step() === DbResult.BE_SQLITE_ROW) {
            if (colCount === 0)
                colCount = stmt.getColumnCount();
            const row: string[] = [];
            for (let i = 0; i < colCount; i++) {
                if (stmt.isValueNull(i)) {
                    row.push("");
                } else {
                    row.push(stmt.getValueString(i));
                }
            }
            rows.push(row);
            if (rows.length > MAX_ROWS)
                break;
        }
        return { rows, colCount };
    });

    const { rows, colCount } = result;
    const durationMs = performance.now() - startTicks;

    if (rows.length === 0 || colCount === 0) {
        console.log("No rows returned.");
        return { rowCount: 0, durationMs, truncated: false };
    }

    const truncated = rows.length > MAX_ROWS;
    const displayRows = truncated ? rows.slice(0, MAX_ROWS) : rows;

    // Build header from column indices since SQLite doesn't give us column names through this API
    const headerRow = Array.from({ length: colCount }, (_, i) => chalk.bold(`[${i}]`));
    const output: string[][] = [headerRow, ...displayRows];

    const formattedSql = emphasize.highlight("sql", sql).value;
    output.unshift([formattedSql, ...Array(colCount - 1).fill("")]);

    const widths = calculateColumnWidths(output, process.stdout.columns);
    const columns: ColumnUserConfig[] = widths.map(w => ({ width: w, wrapWord: false }));

    const config: TableUserConfig = {
        columns,
        spanningCells: [{ col: 0, row: 0, colSpan: colCount, alignment: "center" }],
    };

    console.log(table(output, config));

    if (truncated) {
        console.log(formatWarning(`More than ${MAX_ROWS} rows returned. Only the first ${MAX_ROWS} rows are displayed.`));
    }

    if (durationMs < 1000) {
        console.log(`Executed in ${durationMs.toFixed()} ms.`);
    } else {
        console.log(`Executed in ${(durationMs / 1000).toFixed(2)} seconds.`);
    }

    return { rowCount: displayRows.length, durationMs, truncated };
}
