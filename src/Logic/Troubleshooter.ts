import { BriefcaseDb, ProgressStatus } from "@itwin/core-backend";
import { log, select, isCancel, spinner, confirm } from "@clack/prompts";
import chalk from "chalk";
import { table } from "table";
import { UnifiedDb } from "../UnifiedDb";
import { Context, WorkspaceFile } from "../Context";
import { logError } from "../ConsoleHelper";
import { DbSettings } from "./DbSettings";
import { isFkFlagSet, setFkFlag, runForeignKeyCheck, enrichFailures, runIntegrityCheck, runEcsqlIntegrityCheck } from "./TroubleshootOps";

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
 *
 * Pure logic lives in TroubleshootOps.ts; this class is the thin interactive shell.
 */
export class Troubleshooter {

    static async run(ctx: Context, file: WorkspaceFile, db: UnifiedDb): Promise<void> {
        if (!db.supportsChangesets) {
            log.error("Troubleshooter is only available for BriefcaseDb instances.");
            return;
        }

        while (true) {
            const flagSet = isFkFlagSet(db);
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
                        await this.displayForeignKeyCheck(db);
                        break;
                    case "integrity-check":
                        await this.displayIntegrityCheck(db);
                        break;
                    case "ecsql-integrity":
                        await this.displayEcsqlIntegrityCheck(db);
                        break;
                }
            } catch (error: unknown) {
                logError(error);
            }
        }
    }

    private static async toggleFkFlag(db: UnifiedDb): Promise<void> {
        const currentlySet = isFkFlagSet(db);
        setFkFlag(db, !currentlySet);
        if (currentlySet) {
            log.success("DebugAllowFkViolations flag removed.");
        } else {
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
        if (!isFkFlagSet(db)) {
            setFkFlag(db, true);
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
        await this.displayForeignKeyCheck(db);

        // Step 4: Ask about cleanup
        const removeFlag = await confirm({
            message: "Remove the DebugAllowFkViolations flag? (Recommended after troubleshooting)",
            initialValue: true,
        });
        if (!isCancel(removeFlag) && removeFlag) {
            setFkFlag(db, false);
            briefcaseDb.saveChanges();
            log.success("Flag removed.");
        }
    }

    private static async displayForeignKeyCheck(db: UnifiedDb): Promise<void> {
        const loader = spinner();
        loader.start("Running PRAGMA foreign_key_check...");

        const failures = runForeignKeyCheck(db);

        if (failures.length === 0) {
            loader.stop("No foreign key violations found.");
            return;
        }

        loader.stop(`Found ${chalk.red(String(failures.length))} foreign key violation(s).`);

        const enriched = enrichFailures(db, failures);

        const output: string[][] = [
            ["Table", "RowId", "Referred Table", "FK Column (from -> to)"],
        ];
        for (const f of enriched) {
            output.push([f.tableName, f.rowId, f.referredTable, f.fkDescription]);
        }

        console.log(table(output));
        const tableCount = new Set(failures.map(f => f.tableName)).size;
        log.info(`Total: ${failures.length} violation(s) across ${tableCount} table(s).`);
    }

    private static async displayIntegrityCheck(db: UnifiedDb): Promise<void> {
        const loader = spinner();
        loader.start("Running PRAGMA integrity_check...");

        const results = runIntegrityCheck(db);

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

    private static async displayEcsqlIntegrityCheck(db: UnifiedDb): Promise<void> {
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
            const rows = await runEcsqlIntegrityCheck(db);

            loader.stop("ECSql integrity check complete.");

            if (rows.length === 0) {
                log.success("No issues found.");
                return;
            }

            const output: string[][] = [["Result"]];
            for (const row of rows.slice(0, 100)) {
                output.push([row]);
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
