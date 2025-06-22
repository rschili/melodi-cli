import { detectWorkspaceFiles, SchemaVersion, Workspace, WorkspaceFile } from "../Workspace";
import { withTimeout } from "../PromiseHelper";
import { NewFile } from "./NewFile";
import { FileOperations } from "./FileOperations";
import { select, Separator } from "@inquirer/prompts";
import yoctoSpinner from "yocto-spinner";
import chalk from "chalk";

type Choice<T> = Exclude<
  Parameters<typeof select<T>>[0]["choices"][number],
  string | Separator
>;

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

            const fileChoices: Choice<WorkspaceFile>[] = [];
            if(ws.files !== undefined) {
                fileChoices.push(...ws.files!.map(file => ({
                    name: `${file.relativePath} (${file.fileType})`, 
                    description: WorkspaceManager.getFileDescription(file),
                    value: file,})));

                fileChoices.sort((a, b) => {
                    return a.value.lastTouched.getTime() - b.value.lastTouched.getTime(); // newest first
                });
            }
            const createNewValue = "__createNew__";
            const refreshValue = "__refresh__";
            const exitValue = "__exit__";
            const choice = await select<string | WorkspaceFile>({
                message: 'Select an option',
                choices: [
                    { name: "Create a new Db...", value: createNewValue },
                    { name: "Refresh list of files", value: refreshValue },
                    ...fileChoices,
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

    static getFileDescription(file: WorkspaceFile): string {
        const descriptions: string[] = [];
        if(file.ecDbVersion !== undefined) {
            descriptions.push(`ECDb ${chalk.white(WorkspaceManager.getSchemaVersionString(file.ecDbVersion))}`);
        }

        if(file.bisCoreVersion !== undefined) {
            descriptions.push(`BisCore ${chalk.white(file.bisCoreVersion.toString())}`);
            if(file.elements !== undefined) {
                descriptions.push(`Elements: ${chalk.white(file.elements.toLocaleString())}`);
            }
        }

        if(file.parentChangeSetId !== undefined) {
            descriptions.push(`ChangeSet: ${chalk.white(file.parentChangeSetId)}`);
        }
        return descriptions.join("  ");
    }

    static getSchemaVersionString(version: SchemaVersion): string {
        return `${version.major}.${version.minor}.${version.sub1}.${version.sub2}`;
    }


}