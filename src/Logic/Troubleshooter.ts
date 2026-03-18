import { BriefcaseDb, ProgressStatus } from "@itwin/core-backend";
import { DbResult } from "@itwin/core-bentley";
import { log, select, isCancel, spinner, confirm } from "@clack/prompts";
import chalk from "chalk";
import { table } from "table";
import { UnifiedDb } from "../UnifiedDb";
import { Context, WorkspaceFile } from "../Context";
import { logError } from "../ConsoleHelper";
import { DbSettings } from "./DbSettings";

const FK_VIOLATIONS_FLAG = "DebugAllowFkViolations";

type ForeignKeyFailure = {
    tableName: string;
    rowId: string;
    referredTable: string;
    fkIndex: string;
};

type ForeignKeyDetail = {
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string;
    onDelete: string;
    onUpdate: string;
};

/**
 * Interactive troubleshooter for diagnosing FK constraint violations during changeset application.
 *
 * When a changeset fails to apply due to FK violations, the typical workflow is:
 * 1. Set the DebugAllowFkViolations flag in be_Local so the native changeset merge skips FK errors
 * 2. Pull the problematic changesets
 * 3. Run PRAGMA foreign_key_check to find the actual violations
 * 4. Run PRAGMA integrity_check and/or ECSQL PRAGMA integrity_check for deeper analysis
 * 5. Remove the flag when done
 *
 * This automates the workflow described in the checkpoint-v2-troubleshoot job (imodels-jobs)
 * so developers don't have to remember the steps each time.
 */
export class Troubleshooter {

    static async run(ctx: Context, file: WorkspaceFile, db: UnifiedDb): Promise<void> {
        if (!db.supportsChangesets) {
            log.error("Troubleshooter is only available for BriefcaseDb instances.");
            return;
        }

        while (true) {
            const flagSet = this.isFkViolationsFlagSet(db);
            const flagLabel = flagSet
                ? chalk.yellowBright("SET - FK violations will be skipped during pull")
                : chalk.dim("not set");

            const options: { label: string; value: string; hint?: string }[] = [
                { label: `DebugAllowFkViolations: ${flagLabel}`, value: "toggle-flag", hint: "Toggle the flag" },
                { label: "Pull with FK violations allowed", value: "pull-skip-fk", hint: "Sets flag, pulls, then runs checks" },
                { label: "Run PRAGMA foreign_key_check", value: "fk-check", hint: "SQLite FK constraint check" },
                { label: "Run PRAGMA integrity_check", value: "integrity-check", hint: "SQLite structural integrity" },
                { label: "Run ECSql PRAGMA integrity_check", value: "ecsql-integrity", hint: "ECDb-level data integrity (experimental)" },
                { label: "(Back)", value: "back" },
            ];

            const action = await select({
                message: "Troubleshooter",
                options,
            });

            if (action === "back" || isCancel(action))
                return;

            try {
                switch (action) {
                    case "toggle-flag":
                        await this.toggleFkFlag(db);
                        break;
                    case "pull-skip-fk":
                        await this.pullWithFkViolationsAllowed(ctx, db);
                        break;
                    case "fk-check":
                        await this.runForeignKeyCheck(db);
                        break;
                    case "integrity-check":
                        await this.runSqliteIntegrityCheck(db);
                        break;
                    case "ecsql-integrity":
                        await this.runEcsqlIntegrityCheck(db);
                        break;
                }
            } catch (error: unknown) {
                logError(error);
            }
        }
    }

    private static isFkViolationsFlagSet(db: UnifiedDb): boolean {
        return db.withSqliteStatement("SELECT Val FROM be_Local WHERE Name = ?", (stmt) => {
            stmt.bindString(1, FK_VIOLATIONS_FLAG);
            return stmt.step() === DbResult.BE_SQLITE_ROW;
        });
    }

    private static async toggleFkFlag(db: UnifiedDb): Promise<void> {
        const currentlySet = this.isFkViolationsFlagSet(db);
        if (currentlySet) {
            db.withSqliteStatement("DELETE FROM be_Local WHERE Name = ?", (stmt) => {
                stmt.bindString(1, FK_VIOLATIONS_FLAG);
                stmt.step();
            });
            log.success("DebugAllowFkViolations flag removed.");
        } else {
            db.withSqliteStatement("INSERT OR REPLACE INTO be_Local (Name, Val) VALUES (?, ?)", (stmt) => {
                stmt.bindString(1, FK_VIOLATIONS_FLAG);
                stmt.bindString(2, "");
                stmt.step();
            });
            const briefcaseDb = db.innerDb as BriefcaseDb;
            briefcaseDb.saveChanges();
            log.success("DebugAllowFkViolations flag set. FK violations will be skipped during changeset merge.");
        }
    }

    private static async pullWithFkViolationsAllowed(ctx: Context, db: UnifiedDb): Promise<void> {
        const briefcaseDb = db.innerDb as BriefcaseDb;

        if (db.isReadOnly) {
            log.error("Cannot pull - the database is open in read-only mode.");
            return;
        }

        const proceed = await confirm({
            message: "This will set the DebugAllowFkViolations flag, pull all pending changesets, then run foreign key checks. Continue?",
            initialValue: true,
        });
        if (isCancel(proceed) || !proceed)
            return;

        // Step 1: Set the flag
        if (!this.isFkViolationsFlagSet(db)) {
            db.withSqliteStatement("INSERT OR REPLACE INTO be_Local (Name, Val) VALUES (?, ?)", (stmt) => {
                stmt.bindString(1, FK_VIOLATIONS_FLAG);
                stmt.bindString(2, "");
                stmt.step();
            });
            briefcaseDb.saveChanges();
            log.step("DebugAllowFkViolations flag set.");
        } else {
            log.step("DebugAllowFkViolations flag already set.");
        }

        // Step 2: Pull changesets
        const loader = spinner();
        loader.start("Pulling changesets with FK violations allowed...");
        try {
            await briefcaseDb.pullChanges({
                onProgress: (loaded: number, total: number) => {
                    if (total > 0) {
                        const pct = (loaded / total * 100).toFixed(1);
                        loader.message(`Pulling changesets... ${pct}%`);
                    }
                    return ProgressStatus.Continue;
                },
            });
            const updated = briefcaseDb.changeset;
            loader.stop(`Pull complete. Now at changeset index ${updated.index ?? 0}.`);
        } catch (error: unknown) {
            loader.stop("Pull failed.");
            throw error;
        }

        // Step 3: Run FK check automatically
        log.step("Running PRAGMA foreign_key_check...");
        await this.runForeignKeyCheck(db);

        // Step 4: Ask about cleanup
        const removeFlag = await confirm({
            message: "Remove the DebugAllowFkViolations flag? (Recommended after troubleshooting)",
            initialValue: true,
        });
        if (!isCancel(removeFlag) && removeFlag) {
            db.withSqliteStatement("DELETE FROM be_Local WHERE Name = ?", (stmt) => {
                stmt.bindString(1, FK_VIOLATIONS_FLAG);
                stmt.step();
            });
            briefcaseDb.saveChanges();
            log.success("Flag removed.");
        }
    }

    private static async runForeignKeyCheck(db: UnifiedDb): Promise<void> {
        const loader = spinner();
        loader.start("Running PRAGMA foreign_key_check...");

        const failures: ForeignKeyFailure[] = [];
        db.withSqliteStatement("PRAGMA foreign_key_check", (stmt) => {
            while (stmt.step() === DbResult.BE_SQLITE_ROW) {
                failures.push({
                    tableName: stmt.getValueString(0),
                    rowId: stmt.getValueString(1),
                    referredTable: stmt.getValueString(2),
                    fkIndex: stmt.getValueString(3),
                });
            }
        });

        if (failures.length === 0) {
            loader.stop("No foreign key violations found.");
            return;
        }

        loader.stop(`Found ${chalk.red(String(failures.length))} foreign key violation(s).`);

        // Enrich with FK details per table
        const tablesWithFailures = new Set(failures.map(f => f.tableName));
        const fkDetailsMap = new Map<string, ForeignKeyDetail[]>();
        for (const tableName of tablesWithFailures) {
            const details: ForeignKeyDetail[] = [];
            db.withSqliteStatement(`PRAGMA foreign_key_list(${tableName})`, (stmt) => {
                while (stmt.step() === DbResult.BE_SQLITE_ROW) {
                    details.push({
                        id: stmt.getValueInteger(0),
                        seq: stmt.getValueInteger(1),
                        table: stmt.getValueString(2),
                        from: stmt.getValueString(3),
                        to: stmt.getValueString(4),
                        onDelete: stmt.getValueString(5),
                        onUpdate: stmt.getValueString(6),
                    });
                }
            });
            fkDetailsMap.set(tableName, details);
        }

        // Build output table
        const output: string[][] = [
            ["Table", "RowId", "Referred Table", "FK Column (from -> to)"],
        ];
        for (const f of failures) {
            const fkDetails = fkDetailsMap.get(f.tableName);
            const fkIdx = parseInt(f.fkIndex);
            const fk = fkDetails?.[fkIdx];
            const fkDesc = fk ? `${fk.from} -> ${fk.table}.${fk.to}` : `FK index ${f.fkIndex}`;

            output.push([f.tableName, f.rowId, f.referredTable, fkDesc]);
        }

        console.log(table(output));
        log.info(`Total: ${failures.length} violation(s) across ${tablesWithFailures.size} table(s).`);
    }

    private static async runSqliteIntegrityCheck(db: UnifiedDb): Promise<void> {
        const loader = spinner();
        loader.start("Running PRAGMA integrity_check...");

        const results: string[] = [];
        db.withSqliteStatement("PRAGMA integrity_check", (stmt) => {
            while (stmt.step() === DbResult.BE_SQLITE_ROW) {
                results.push(stmt.getValueString(0));
            }
        });

        loader.stop("Integrity check complete.");

        if (results.length === 1 && results[0] === "ok") {
            log.success("SQLite integrity check passed.");
        } else {
            log.error(`SQLite integrity check found ${results.length} issue(s):`);
            for (const r of results.slice(0, 50)) {
                log.warn(`  ${r}`);
            }
            if (results.length > 50) {
                log.warn(`  ... and ${results.length - 50} more.`);
            }
        }
    }

    private static async runEcsqlIntegrityCheck(db: UnifiedDb): Promise<void> {
        if (!db.supportsECSql) {
            log.error("ECSql integrity check requires an ECDb or IModelDb.");
            return;
        }

        const experimentalEnabled = await DbSettings.getExperimentalFeaturesEnabled(db);
        if (!experimentalEnabled) {
            const enable = await confirm({
                message: "ECSql PRAGMA integrity_check requires experimental features to be enabled. Enable now?",
                initialValue: true,
            });
            if (isCancel(enable) || !enable)
                return;
            await DbSettings.setExperimentalFeaturesEnabled(db, true);
        }

        const loader = spinner();
        loader.start("Running ECSql PRAGMA integrity_check (this may take a while)...");

        try {
            const reader = db.createQueryReader("PRAGMA integrity_check");
            const rows = await reader.toArray();

            loader.stop("ECSql integrity check complete.");

            if (rows.length === 0) {
                log.success("No issues found.");
                return;
            }

            const output: string[][] = [["Result"]];
            for (const row of rows.slice(0, 100)) {
                const values = row as unknown[];
                output.push([String(values[0] ?? "")]);
            }
            console.log(table(output));

            if (rows.length > 100) {
                log.warn(`Showing first 100 of ${rows.length} results.`);
            }
        } catch (error: unknown) {
            loader.stop("ECSql integrity check failed.");
            throw error;
        }
    }
}
