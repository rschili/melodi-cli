import { detectWorkspaceFiles, Workspace, WorkspaceFile } from "../Workspace";
import { withTimeout } from "../PromiseHelper";
import { NewFile } from "./NewFile";
import { FileOperations } from "./FileOperations";
import { select } from "@inquirer/prompts";
import yoctoSpinner from "yocto-spinner";

export class WorkspaceManager {
    public static async run(ws: Workspace): Promise<void> {
        if(ws.config === undefined) {
            throw new Error("The 'config' property must be undefined during initialization.");
        }

        while(true) { // loop so we can return to the menu after each action
            // identify all existing files in the workspace
            const spinner = yoctoSpinner({text: "Loading workspace contents..." });
            try {
                spinner.start();
                await withTimeout(detectWorkspaceFiles(ws), 15);
                spinner.success();
            }
            catch (error: unknown) {
                spinner.error("Loading workspace contents failed.");
                throw error;
            }

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
            const choice = await select<string | WorkspaceFile>({
                message: 'Select an option',
                choices: [
                    { name: "Create a new Db...", value: createNewValue },
                    { name: "Refresh list of files", value: refreshValue },
                    ...fileChoices.map(file => ({ name: file.name, value: file.value })),
                    { name: "Exit", value: exitValue },
                ],
                default: (fileChoices.length > 0 ? fileChoices[0].value : createNewValue),
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

            await FileOperations.run(ws, choice as WorkspaceFile)
        }
    }


}