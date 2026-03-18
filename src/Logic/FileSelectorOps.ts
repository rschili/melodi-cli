import chalk from "chalk";
import { SchemaVersion, WorkspaceFile } from "../Context";
import { timeSpanToString } from "../ConsoleHelper";

export function getSchemaVersionString(version: SchemaVersion): string {
    return `${version.major}.${version.minor}.${version.sub1}.${version.sub2}`;
}

export function getFileDescription(file: WorkspaceFile): string {
    const descriptions: string[] = [];
    if (file.bisCoreVersion !== undefined)
        descriptions.push(file.hasITwinId ? chalk.green("Briefcase") : chalk.yellow("Standalone"));

    if (file.ecDbVersion !== undefined)
        descriptions.push(`ECDb ${chalk.white(getSchemaVersionString(file.ecDbVersion))}`);

    if (file.bisCoreVersion !== undefined) {
        descriptions.push(`BisCore ${chalk.white(file.bisCoreVersion.toString())}`);
        if (file.elements !== undefined)
            descriptions.push(`Elements: ${chalk.white(file.elements.toLocaleString())}`);
    }

    if (file.parentChangeSetId !== undefined)
        descriptions.push(`ChangeSet: ${chalk.white(file.parentChangeSetId)}`);

    return descriptions.join(" ");
}

export function padFileChoiceLabels(
    choices: Array<{ label?: string; value: WorkspaceFile }>,
    now: number = Date.now(),
): Array<{ label?: string; value: WorkspaceFile }> {
    const longestLabelLength = choices.reduce((max, choice) => Math.max(max, choice.label?.length ?? 0), 0);
    const lengthBeforeLastMod = longestLabelLength + 5;

    for (const choice of choices) {
        const baseLabel = choice.label ?? "";
        const lastModTimeSpan = now - choice.value.lastTouched.getTime();
        const timeSpanString = timeSpanToString(lastModTimeSpan);
        choice.label = baseLabel.padEnd(lengthBeforeLastMod, " ") + (timeSpanString ? `(${timeSpanString} ago)` : "");
    }

    return choices;
}
