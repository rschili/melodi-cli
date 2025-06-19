import { ECDb, ECDbOpenMode, IModelHost } from "@itwin/core-backend";
import { Workspace, WorkspaceFile } from "../Workspace";
import path from "path";
import { select } from "@inquirer/prompts";

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
                    console.log("ECSql operation selected.");
                    // Add ECSql operation logic here
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
}