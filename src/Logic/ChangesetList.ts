import { log, select, spinner, text, isCancel, type CANCEL_SYMBOL } from "@clack/prompts";
import { ChangesetOrderByProperty, OrderByOperator, type MinimalChangeset } from "@itwin/imodels-client-management";
import chalk from "chalk";
import { table } from "table";
import { Context } from "../Context";
import { describeChangesetType, isSchemaChangeset, parseChangesetIndexRange } from "./ChangesetOps";

const descriptionMaxLength = 60;
const pageSize = 50;

/** Reads changeset metadata from iModelHub. Without a range this reads the full history, which takes one request per 100 changesets. */
export async function queryRemoteChangesets(ctx: Context, iModelId: string, range?: { first: number; last?: number }): Promise<MinimalChangeset[]> {
    const loader = spinner();
    loader.start("Reading changesets from iModelHub...");
    try {
        const changesets: MinimalChangeset[] = [];
        const iterator = ctx.envManager.iModelsClient.changesets.getMinimalList({
            authorization: () => ctx.envManager.getAuthorization(),
            iModelId,
            urlParams: range === undefined ? undefined : { afterIndex: range.first - 1, lastIndex: range.last },
        });
        for await (const changeset of iterator) {
            changesets.push(changeset);
            if (changesets.length % 500 === 0)
                loader.message(`Reading changesets from iModelHub... ${changesets.length}`);
        }
        changesets.sort((a, b) => a.index - b.index);
        loader.stop(`Read ${changesets.length} changeset(s).`);
        return changesets;
    } catch (error: unknown) {
        loader.stop("Reading changesets failed.");
        throw error;
    }
}

export function printChangesetTable(changesets: MinimalChangeset[], currentIndex?: number): void {
    if (changesets.length === 0) {
        log.info("No changesets to show.");
        return;
    }

    const rows: string[][] = [["Index", "Pushed (UTC)", "Type", "Size", "Description"]];
    for (const changeset of changesets) {
        const typeLabels = describeChangesetType(changeset.containingChanges).join(", ");
        const isCurrent = changeset.index === currentIndex;
        const description = (changeset.description ?? "").replace(/\s+/g, " ").trim();
        const row = [
            isCurrent ? `${changeset.index} (current)` : String(changeset.index),
            changeset.pushDateTime.replace("T", " ").substring(0, 16),
            isSchemaChangeset(changeset.containingChanges) ? chalk.yellowBright(typeLabels) : typeLabels,
            formatSize(changeset.fileSize),
            description.length > descriptionMaxLength ? description.substring(0, descriptionMaxLength - 1) + "…" : description,
        ];
        rows.push(isCurrent ? row.map(cell => chalk.greenBright(cell)) : row);
    }
    console.log(table(rows));
}

export function formatSize(bytes: number): string {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024)
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Interactive listing of remote changesets. */
export async function listRemoteChangesets(ctx: Context, iModelId: string, currentIndex?: number): Promise<void | typeof CANCEL_SYMBOL> {
    const scope = await select({
        message: "Which changesets do you want to see?",
        options: [
            { label: "Schema changesets", value: "schema", hint: "reads the full history" },
            { label: `Next ${pageSize} changesets`, value: "next", hint: currentIndex === undefined ? "from the start" : `after index ${currentIndex}` },
            { label: "Index range", value: "range", hint: "e.g. 900-950" },
        ],
    });
    if (isCancel(scope))
        return scope;

    if (scope === "schema") {
        const changesets = await queryRemoteChangesets(ctx, iModelId);
        const schemaChangesets = changesets.filter(cs => isSchemaChangeset(cs.containingChanges));
        printChangesetTable(schemaChangesets, currentIndex);
        const latest = changesets.at(-1);
        log.info(`${schemaChangesets.length} of ${changesets.length} changesets contain schema changes. Latest index: ${latest?.index ?? 0}.`);
        return;
    }

    if (scope === "next") {
        const first = (currentIndex ?? 0) + 1;
        printChangesetTable(await queryRemoteChangesets(ctx, iModelId, { first, last: first + pageSize - 1 }), currentIndex);
        return;
    }

    const rangeInput = await text({
        message: "Enter an index range (e.g. 900-950):",
        validate: (value) => parseChangesetIndexRange(value ?? "") === undefined ? "Expected <first>-<last> or a single index." : undefined,
    });
    if (isCancel(rangeInput))
        return rangeInput;

    const range = parseChangesetIndexRange(rangeInput)!;
    printChangesetTable(await queryRemoteChangesets(ctx, iModelId, range), currentIndex);
}

export async function queryLatestChangesetIndex(ctx: Context, iModelId: string): Promise<number> {
    const iterator = ctx.envManager.iModelsClient.changesets.getMinimalList({
        authorization: () => ctx.envManager.getAuthorization(),
        iModelId,
        urlParams: { $top: 1, $orderBy: { property: ChangesetOrderByProperty.Index, operator: OrderByOperator.Descending } },
    });
    for await (const changeset of iterator)
        return changeset.index; // the iterator would otherwise page through the whole history
    return 0;
}
