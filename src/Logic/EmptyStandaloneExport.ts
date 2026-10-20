import fs from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { BriefcaseDb, IModelDb, StandaloneDb } from "@itwin/core-backend";
import { OpenMode } from "@itwin/core-bentley";

/** Elements and models every iModel needs: root Subject/RepositoryModel, RealityDataSources and Dictionary partitions/models. */
export const bootstrapElementIds = [0x1, 0xe, 0x10];

/** Tables whose rows are kept as-is. CodeSpecs are needed to insert elements and are small. */
const tablesToKeep = new Set(["bis_CodeSpec"]);

/** Tables outside the EC mapping that hold data derived from elements. */
const spatialIndexTable = "dgn_SpatialIndex";
const derivedDataTables = ["dgn_fts_content", "dgn_Rebase"];

export type EmptyStandaloneExportResult = {
    targetPath: string;
    clearedTables: { name: string; deletedRows: number }[];
    keptTables: string[];
    removedSchemaSyncInfo: boolean;
    fileSizeBytes: number;
};

type DataTable = { name: string; idColumn: string; holdsBootstrapRows: boolean };

/**
 * Copies an iModel into a standalone file and deletes the contents of all data tables, so only schemas, mappings
 * and file properties remain. Bootstrap elements/models and CodeSpecs are kept so the file can be opened and used normally.
 * SchemaSync is disabled in the copy, so schema imports go through the normal path.
 */
export async function exportEmptyStandaloneCopy(source: IModelDb, targetPath: string, onStep: (message: string) => void = () => { }): Promise<EmptyStandaloneExportResult> {
    // The work is synchronous; yield after each step so progress output gets rendered.
    const reportStep = async (message: string) => {
        onStep(message);
        await new Promise(resolve => setImmediate(resolve));
    };

    if (fs.existsSync(targetPath))
        throw new Error(`Target file already exists: ${targetPath}`);
    if (source instanceof BriefcaseDb && !source.isReadonly && source.txns.hasUnsavedChanges)
        throw new Error("The iModel has unsaved changes. Save or discard them before exporting.");

    await reportStep("Copying iModel...");
    source.performCheckpoint();
    await fs.promises.copyFile(source.pathName, targetPath);
    const sourceWal = `${source.pathName}-wal`;
    if (fs.existsSync(sourceWal))
        await fs.promises.copyFile(sourceWal, `${targetPath}-wal`);

    try {
        await reportStep("Converting to standalone...");
        StandaloneDb.convertToStandalone(targetPath);

        const result = await deleteDataTableContents(targetPath, reportStep);

        await reportStep("Verifying the result opens as a standalone iModel...");
        const verifyDb = StandaloneDb.openFile(targetPath, OpenMode.Readonly);
        verifyDb.close();

        return { ...result, targetPath, fileSizeBytes: fs.statSync(targetPath).size };
    } catch (error: unknown) {
        fs.rmSync(targetPath, { force: true });
        fs.rmSync(`${targetPath}-wal`, { force: true });
        fs.rmSync(`${targetPath}-shm`, { force: true });
        throw error;
    }
}

async function deleteDataTableContents(filePath: string, reportStep: (message: string) => Promise<void>): Promise<Omit<EmptyStandaloneExportResult, "targetPath" | "fileSizeBytes">> {
    // BeSQLite always enforces foreign keys, which turns every delete into per-row work with cascades.
    // Without enforcement SQLite empties a table without visiting its rows. foreign_key_check below verifies the result.
    const { DatabaseSync } = await importNodeSqlite();
    const db = new DatabaseSync(filePath, { enableForeignKeyConstraints: false });
    try {
        registerTriggerFunctionStubs(db);
        // VACUUM builds the compacted copy in temp storage; the result only holds metadata, so memory is fine.
        db.exec("PRAGMA temp_store=MEMORY");
        db.exec("BEGIN");

        const existingTables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name)));
        const clearedTables: { name: string; deletedRows: number }[] = [];
        const keptTables: string[] = [];
        const countRows = (table: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM [${table}]`).get()!.n);

        if (existingTables.has(spatialIndexTable)) {
            await reportStep(`Clearing ${spatialIndexTable}...`);
            // Recreating the r-tree is much faster than deleting its entries one by one.
            const deletedRows = countRows(spatialIndexTable);
            const createSql = String(db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(spatialIndexTable)!.sql);
            db.exec(`DROP TABLE [${spatialIndexTable}]; ${createSql}`);
            clearedTables.push({ name: spatialIndexTable, deletedRows });
        }

        for (const table of derivedDataTables) {
            if (!existingTables.has(table))
                continue;
            await reportStep(`Clearing ${table}...`);
            clearedTables.push({ name: table, deletedRows: Number(db.prepare(`DELETE FROM [${table}]`).run().changes) });
        }

        const keepIdList = bootstrapElementIds.join(",");
        for (const table of readDataTables(db)) {
            if (!existingTables.has(table.name))
                continue;
            if (tablesToKeep.has(table.name)) {
                keptTables.push(table.name);
                continue;
            }
            await reportStep(`Clearing ${table.name}...`);
            const rowCount = countRows(table.name);
            if (table.holdsBootstrapRows) {
                // A DELETE with a WHERE clause visits every row. Set the bootstrap rows aside and empty the table instead.
                db.exec(`CREATE TEMP TABLE melodi_kept AS SELECT * FROM [${table.name}] WHERE [${table.idColumn}] IN (${keepIdList});
                    DELETE FROM [${table.name}];
                    INSERT INTO [${table.name}] SELECT * FROM temp.melodi_kept;
                    DROP TABLE temp.melodi_kept;`);
            } else {
                db.exec(`DELETE FROM [${table.name}]`);
            }
            clearedTables.push({ name: table.name, deletedRows: rowCount - countRows(table.name) });
        }

        const removedSchemaSyncInfo = Number(db.prepare("DELETE FROM be_Prop WHERE (Namespace='ec_Db' AND Name='localDbInfo') OR (Namespace='itwinjs' AND Name='SchemaSync')").run().changes) > 0;

        await reportStep("Checking foreign keys...");
        const violations = db.prepare("PRAGMA foreign_key_check").all().map(row => `${row.table} row ${row.rowid} -> ${row.parent}`);
        if (violations.length > 0)
            throw new Error(`Foreign key violations after clearing data: ${violations.slice(0, 10).join(", ")}${violations.length > 10 ? ", ..." : ""}`);

        db.exec("COMMIT");
        await reportStep("Compacting file (VACUUM)...");
        db.exec("VACUUM");
        return { clearedTables, keptTables, removedSchemaSyncInfo };
    } catch (error: unknown) {
        try {
            db.exec("ROLLBACK");
        } catch {
            // no transaction open
        }
        throw error;
    } finally {
        db.close();
    }
}

/**
 * Tables created by the EC mapping (primary, joined and overflow), with the joined/overflow tables first.
 * Tables in the Element/Model hierarchy keep the bootstrap rows.
 */
function readDataTables(db: DatabaseSync): DataTable[] {
    const sql = `
        WITH RECURSIVE bootstrapTables(Id) AS (
            SELECT Id FROM ec_Table WHERE Name IN ('bis_Element', 'bis_Model')
            UNION SELECT t.Id FROM ec_Table t JOIN bootstrapTables b ON t.ParentTableId = b.Id)
        SELECT t.Name AS name,
            (SELECT c.Name FROM ec_Column c WHERE c.TableId = t.Id AND c.ColumnKind = 1 AND c.IsVirtual = 0) AS idColumn,
            t.Id IN (SELECT Id FROM bootstrapTables) AS holdsBootstrapRows
        FROM ec_Table t
        WHERE t.Type IN (0, 1, 3)
        ORDER BY CASE t.Type WHEN 3 THEN 0 WHEN 1 THEN 1 ELSE 2 END, t.Name`;

    return db.prepare(sql).all().map(row => {
        if (row.idColumn === null)
            throw new Error(`Could not find the id column of table ${String(row.name)}.`);
        return { name: String(row.name), idColumn: String(row.idColumn), holdsBootstrapRows: Number(row.holdsBootstrapRows) !== 0 };
    });
}

/**
 * Triggers on element tables call SQL functions that only exist inside the iModel runtime. SQLite needs them to
 * compile statements on those tables even though only the delete triggers run, and those don't call them.
 */
function registerTriggerFunctionStubs(db: DatabaseSync): void {
    const functionNames = new Set<string>();
    for (const row of db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger'").all()) {
        for (const match of String(row.sql).matchAll(/\b(DGN_\w+)\s*\(/gi))
            functionNames.add(match[1]);
    }
    for (const name of functionNames) {
        db.function(name, { varargs: true }, () => {
            throw new Error(`${name} is not available while clearing data.`);
        });
    }
}

/** node:sqlite prints an ExperimentalWarning when loaded, which would break the interactive output. */
async function importNodeSqlite(): Promise<typeof import("node:sqlite")> {
    const emitWarning = process.emitWarning;
    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
        const message = typeof warning === "string" ? warning : warning.message;
        if (message.includes("SQLite is an experimental feature"))
            return;
        return (emitWarning as (...a: unknown[]) => void).call(process, warning, ...args);
    }) as typeof process.emitWarning;
    try {
        return await import("node:sqlite");
    } finally {
        process.emitWarning = emitWarning;
    }
}
