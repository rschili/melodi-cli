import fs from "node:fs";
import path from "node:path";
import { BriefcaseDb, IModelDb } from "@itwin/core-backend";
import { DbResult } from "@itwin/core-bentley";

export type ECXmlVersion = { readVersion: number; writeVersion: number };

export type SchemaDumpEntry = {
    name: string;
    version: string;
    /** EC XML version the schema was originally imported with, as recorded in ec_Schema. */
    originalECXmlVersion?: string;
    writtenECXmlVersion?: string;
    fileName?: string;
    error?: string;
};

export type SchemaDumpManifest = {
    iModelId: string;
    changeset?: { id: string; index?: number };
    exportedAt: string;
    schemas: SchemaDumpEntry[];
};

export const schemaDumpManifestFileName = "manifest.json";

/**
 * Native serialization only supports writing 3.1 and later as-is. Schemas originally imported from 2.0/3.0 XML are
 * stored converted, so they are written as 3.2, the same rule native `exportSchemas` applies.
 * Later entries are fallbacks if serialization at the preferred version fails.
 */
export function getECXmlVersionsToTry(originalMajor: number | undefined, originalMinor: number | undefined): ECXmlVersion[] {
    const versions: ECXmlVersion[] = [];
    if (originalMajor === 3 && originalMinor !== undefined && originalMinor >= 1)
        versions.push({ readVersion: 3, writeVersion: originalMinor });

    for (const fallback of [{ readVersion: 3, writeVersion: 2 }, { readVersion: 3, writeVersion: 1 }]) {
        if (!versions.some(v => v.readVersion === fallback.readVersion && v.writeVersion === fallback.writeVersion))
            versions.push(fallback);
    }
    return versions;
}

/** Folder name for a schema dump, based on the changeset the iModel is at. */
export function getSchemaDumpFolderName(db: IModelDb, now: Date = new Date()): string {
    const timestamp = Math.floor((now.getTime() - new Date("2020-01-01").getTime()) / 1000).toString(36);
    const changesetIndex = getChangesetIndex(db);
    return changesetIndex === undefined ? `schemas_${timestamp}` : `schemas_cs${changesetIndex}`;
}

/** Changeset index the iModel is at, or undefined for files that never had a Hub timeline. */
function getChangesetIndex(db: IModelDb): number | undefined {
    const hasTimeline = db.changeset.id !== "" || (db instanceof BriefcaseDb && !db.isStandalone);
    return hasTimeline ? (db.changeset.index ?? 0) : undefined;
}

/**
 * Writes every schema to its own file and continues past schemas that fail to serialize.
 * Also writes a manifest with the iModel's changeset and the EC XML version used for each schema.
 */
export function dumpSchemas(db: IModelDb, outputDirectory: string): SchemaDumpManifest {
    fs.mkdirSync(outputDirectory, { recursive: true });

    type SchemaRow = { name: string; version: string; originalMajor?: number; originalMinor?: number };
    const schemaRows: SchemaRow[] = [];
    db.withSqliteStatement("SELECT Name, VersionDigit1, VersionDigit2, VersionDigit3, OriginalECXmlVersionMajor, OriginalECXmlVersionMinor FROM ec_Schema ORDER BY Name", (stmt) => {
        while (stmt.step() === DbResult.BE_SQLITE_ROW) {
            const version = [1, 2, 3].map(i => String(stmt.getValueInteger(i)).padStart(2, "0")).join(".");
            schemaRows.push({
                name: stmt.getValueString(0),
                version,
                originalMajor: stmt.isValueNull(4) ? undefined : stmt.getValueInteger(4),
                originalMinor: stmt.isValueNull(5) ? undefined : stmt.getValueInteger(5),
            });
        }
    });

    const entries: SchemaDumpEntry[] = [];
    for (const row of schemaRows) {
        const entry: SchemaDumpEntry = {
            name: row.name,
            version: row.version,
            originalECXmlVersion: row.originalMajor === undefined ? undefined : `${row.originalMajor}.${row.originalMinor ?? 0}`,
        };
        entries.push(entry);

        const errors: string[] = [];
        for (const xmlVersion of getECXmlVersionsToTry(row.originalMajor, row.originalMinor)) {
            const versionLabel = `${xmlVersion.readVersion}.${xmlVersion.writeVersion}`;
            try {
                const xml = db.exportSchemaXmlString(row.name, xmlVersion);
                if (xml === undefined) {
                    errors.push(`${versionLabel}: serialization failed`);
                    continue;
                }
                entry.fileName = `${row.name}.${row.version}.ecschema.xml`;
                entry.writtenECXmlVersion = versionLabel;
                fs.writeFileSync(path.join(outputDirectory, entry.fileName), xml, "utf-8");
                break;
            } catch (error: unknown) {
                errors.push(`${versionLabel}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (entry.fileName === undefined)
            entry.error = errors.join("; ");
    }

    const changesetIndex = getChangesetIndex(db);
    const changeset = changesetIndex === undefined ? undefined : { id: db.changeset.id, index: changesetIndex };
    const manifest: SchemaDumpManifest = {
        iModelId: db.iModelId,
        changeset,
        exportedAt: new Date().toISOString(),
        schemas: entries,
    };
    fs.writeFileSync(path.join(outputDirectory, schemaDumpManifestFileName), JSON.stringify(manifest, undefined, 2), "utf-8");
    return manifest;
}
