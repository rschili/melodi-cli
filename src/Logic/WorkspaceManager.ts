import Listr from "listr";
import { detectWorkspaceFiles, Workspace, WorkspaceFile } from "../Workspace";
import { withTimeout } from "../PromiseHelper";
import { select, Separator } from "@inquirer/prompts";
import { NewFile } from "./NewFile";
import { OpenFile } from "./OpenFile";

export class WorkspaceManager {
    public static async run(ws: Workspace): Promise<void> {
        if(ws.config === undefined) {
            throw new Error("The 'config' property must be undefined during initialization.");
        }

        while(true) { // loop so we can return to the menu after each action
            // identify all existing files in the workspace
            const tasks = new Listr([
                {
                    title: 'Loading workspace contents',
                    task: () => withTimeout(() => detectWorkspaceFiles(ws), 15),
                },
            ]);

            await tasks.run();

            if(ws.files === undefined || ws.files.length === 0) {
                console.log("Workspace is curently empty");
            }

            const fileChoices = [];
            if(ws.files !== undefined) {
                fileChoices.push(...ws.files!.map(file => ({
                    name: `${file.relativePath} (${file.fileType})`, 
                    value: file,})));
            }

            const createNewValue = "__createNew__";
            const refreshValue = "__refresh__";
            const exitValue = "__exit__";
            const choice = await select<WorkspaceFile | string>({
                message: 'Select an option',
                choices: [
                    { name: "Create a new Db...", value: createNewValue},
                    { name: "Refresh list of files", value: refreshValue},
                    ... fileChoices,
                    { name: "Exit", value: exitValue },
                ],
                pageSize: 10,
                default: fileChoices.length !== 0 ? fileChoices[0].value : undefined,
            });

            if (choice === exitValue) {
                return;
            }

            if (choice === refreshValue) {
                continue; // re-run the loop to refresh the workspace
            }

            if (choice === createNewValue) {
                await NewFile.run(ws);
                continue; // re-run the loop after creating a new Db
            }

            await OpenFile.run(ws, choice as WorkspaceFile)
        }
    }


}