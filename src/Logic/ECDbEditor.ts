import { ECDb, ECDbOpenMode, IModelHost } from "@itwin/core-backend";
import { Workspace, WorkspaceFile } from "../Workspace";
import path from "path";
import { input, select } from "@inquirer/prompts";
import { Table } from "console-table-printer";

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

        console.log(`Opened ECDb file: ${file.relativePath} in mode: ${ECDbOpenMode[openMode]}`);

        while(true) {
            const operation = await select({
                message: "What do you want to do?",
                choices: [ { name: "Run an ECSql statement", value: "ECSql" },
                { name: "Run a Sqlite statement", value: "Sqlite" },
                { name: "Get database statistics", value: "Stats" },
                { name: "Close the database", value: "Close" } ]
            });

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
        }
    }

    static async runECSql(db: ECDb) {
        const ecsql = await input({
            message: "Enter the ECSql statement to execute. Results will be limited to 100 rows max.",
        });
        const reader = db.createQueryReader(ecsql, undefined, { limit: { count: 100 } });

        const table = new Table({
            //columns: [{ name: "Column", alignment: "left" },],
            title: `ECSql Results for: ${ecsql}`,
            defaultColumnOptions: { maxLen: 5 },
        });

        /*const columns = await reader.getMetaData();
        for (const col of columns) {
            table.addColumn(col.name);
        }*/
        for await (const row of reader) {
            table.addRow(row.toRow());
        }
        table.printTable();
        
    }
}