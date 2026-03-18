import chalk from "chalk";
import { stdin, stdout } from 'node:process';
import { createInterface } from "node:readline/promises";
import { formatWarning, logError, printError } from "../ConsoleHelper";
import { UnifiedDb } from "../UnifiedDb";
import { saveCommandHistory, Context, WorkspaceFile } from "../Context";
import { log, select, isCancel } from "@clack/prompts"
import { SchemaEditor } from "./SchemaEditor";
import { DbSettings } from "./DbSettings";
import { McpServerHost } from "./McpServer";
import { executeAndPrintQuery, executeAndPrintSqliteQuery } from "./QueryRunner";
import { ChangesetEditor } from "./Changesets";
import { Troubleshooter } from "./Troubleshooter";

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
                ...(db.supportsSqlite ? [{ label: "SQLite", value: "SQLite" }] : []),
                ...(db.supportsECSql ? [{ label: "Host MCP (Http)", value: "MCP" }] : []),
                ...(db.supportsSchemas ? [{ label: "Schemas", value: "Schemas" }] : []),
                ...(db.supportsChangesets ? [{ label: "Changesets", value: "Changesets" }] : []),
                ...(db.supportsChangesets ? [{ label: "Troubleshoot", value: "Troubleshoot", hint: "FK violations, integrity checks" }] : []),
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
                    case "SQLite":
                        console.log();
                        log.message("SQLite editor. (press up/down for history, Ctrl+C to exit, use semicolon to end statement)");
                        console.log();
                        while (await this.runSqlite(ctx, db)) {
                            // Loop intentionally left empty
                        }
                        break;
                    case "MCP":
                        await McpServerHost.run(file, db);
                        break;
                    case "Schemas":
                        await SchemaEditor.run(ctx, file, db);
                        break;
                    case "Changesets":
                        await ChangesetEditor.run(ctx, file, db);
                        break;
                    case "Troubleshoot":
                        await Troubleshooter.run(ctx, file, db);
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

    static async runSqlite(ctx: Context, db: UnifiedDb): Promise<boolean> {
        const history = ctx.commandCache?.sqliteHistory ?? [];

        const rl = createInterface({
            input: stdin,
            output: stdout,
            terminal: true,
            prompt: "SQLite> ",
            history,
        });

        let interrupted = false;
        rl.on('SIGINT', () => {
            interrupted = true;
            rl.close();
            console.log("\n");
        });

        let sql = "";
        rl.prompt();
        for await (const line of rl) {
            if (sql === "")
                sql = line;
            else
                sql += "\n" + line;

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
            ctx.commandCache!.sqliteHistory = history.slice(-10);
        }
        await saveCommandHistory(ctx);

        try {
            executeAndPrintSqliteQuery(db, sql);
        } catch (error: unknown) {
            console.error(formatWarning(`SQLite query failed: ${sql}`));
            printError(error);
        }

        return true;
    }

    static async runECSql(ctx: Context, db: UnifiedDb): Promise<boolean> {
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
            ctx.commandCache!.ecsqlHistory = history.slice(-10);
        }
        await saveCommandHistory(ctx);

        try {
            await executeAndPrintQuery(db, ecsql);
        } catch (error: unknown) {
            console.error(formatWarning(`ECSql query failed: ${ecsql}`));
            printError(error);
        }

        return true;
    }
}