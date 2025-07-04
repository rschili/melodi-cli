import { detectWorkspaceFiles, SchemaVersion, Workspace, WorkspaceFile } from "../Workspace";
import { NewFile } from "./NewFile";
import { FileActions } from "./FileActions";
import chalk from "chalk";
import { timeSpanToString } from "../ConsoleHelper";
import { Logger } from "../Logger";
import { intro, outro, spinner, log, select, Option, isCancel } from "@clack/prompts"

export class FileSelector {

    public static async run(ws: Workspace): Promise<void> {
        if(ws.config === undefined) {
            throw new Error("The 'config' property must be undefined during initialization.");
        }
        intro (`Workspace ${ws.workspaceRootPath}`);
        try {
            while(await this.runInternal(ws)) {
                // Keep showing the menu until the user chooses to exit
            } 
        } finally {
            outro();
        }
    }

    private static async runInternal(ws: Workspace): Promise<boolean> {
        const loader = spinner();
        try {
            loader.start("Detecting files...");
            await detectWorkspaceFiles(ws);
            loader.stop("Workspace contents loaded successfully.");
        }
        catch (error: unknown) {
            loader.stop("Loading workspace contents failed.");
            throw error;
        }

        if(ws.files === undefined || ws.files.length === 0) {
            log.step("Workspace is curently empty");
        }

        const fileChoices: Option<WorkspaceFile>[] = [];
        if(ws.files !== undefined) {
            fileChoices.push(...ws.files!.map(file => ({
                label: file.relativePath, 
                hint: FileSelector.getFileDescription(file),
                value: file,})));

            fileChoices.sort((a, b) => {
                return b.value.lastTouched.getTime() - a.value.lastTouched.getTime(); // newest first
            });
        }

        const longestFileChoiceNameLength = fileChoices.reduce((max, choice) => {
            return Math.max(max, choice.label!.length);
        }, 0);
        const lengthBeforeLastMod = longestFileChoiceNameLength + 5;
        const now = Date.now();
        for (const choice of fileChoices) {
            // Pad the name to align descriptions
            const lastModTimeSpan = now - choice.value.lastTouched.getTime();
            const timeSpanString = timeSpanToString(lastModTimeSpan);
            choice.label = choice.label!.padEnd(lengthBeforeLastMod, ' ') + (timeSpanString ? `(${timeSpanString} ago)` : '');
        }


        const createNewValue = "__createNew__";
        const refreshValue = "__refresh__";
        const settingsValue = "__settings__";
        const exitValue = "__exit__";
        const choice = await select<string | WorkspaceFile>({
            message: 'Select a file to open or an action to perform',
            options: [
                { label: "New...", value: createNewValue },
                { label: "Reload", value: refreshValue },
                ...fileChoices,
                { label: "Settings", value: settingsValue },
                { label: "Exit", value: exitValue },
            ],
            initialValue: (fileChoices.length > 0 ? fileChoices[0].value : createNewValue),
            maxItems: 20,
        });

        if (choice === exitValue || isCancel(choice)) {
            return false;
        }

        if (choice === refreshValue) {
            return true; // re-run the loop to refresh the workspace
        }

        if (choice === settingsValue) {
            await this.showSettings(ws);
            return true; // re-run the loop after showing settings
        }

        if (choice === createNewValue) {
            await NewFile.run(ws);
            return true; // re-run the loop after creating a new Db
        }

        await FileActions.run(ws, choice as WorkspaceFile)
        return true; // re-run the loop after file actions
    }

    static getFileDescription(file: WorkspaceFile): string {
        const descriptions: string[] = [];
        if(file.ecDbVersion !== undefined) {
            descriptions.push(`ECDb ${chalk.white(FileSelector.getSchemaVersionString(file.ecDbVersion))}`);
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

    static async showSettings(ws: Workspace): Promise<void> {
        while (true) {
            const choice = await select<string>({
                message: 'Select a setting to change',
                options: [
                    { label: "Logging: " + Logger.getCurrentLevelString(ws.userConfig.logging), value: "logging" },
                    { label: "(Back)", value: "exit" },
                ],
                maxItems: 10,
            });

            if (choice === "exit" || isCancel(choice)) {
                return; // Exit settings menu
            }

            if (choice === "logging") {
                await Logger.configure(ws);
                return; //continue; So long as there is only one option, we can return here
            }
        }
    }


}