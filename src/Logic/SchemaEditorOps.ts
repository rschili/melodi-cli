import semver from "semver";

export type SchemaInfo = {
    name: string;
    version?: semver.SemVer;
    latestVersion?: semver.SemVer;
    path?: string;
};

export type SchemaInventoryEntry = {
    name: string;
    version: string;
    released?: boolean;
    path?: string;
};

/** Strip leading zeros from semver-like version strings (e.g. "01.00.03" -> "1.0.3"). */
export function stripLeadingZeros(str: string): string {
    return str.replace(/(^|\.)0+(?=\d)/g, '$1');
}

/**
 * Build a merged schema info map from the DB schemas and the available schema inventory.
 * Returns a record keyed by schema name with version/latestVersion/path populated.
 */
export function buildSchemaInfoMap(
    schemasInDb: Array<{ name: string; versionMajor: number; versionWrite: number; versionMinor: number }>,
    availableSchemas: Record<string, SchemaInventoryEntry[]>,
): Record<string, SchemaInfo> {
    const schemaInfoMap: Record<string, SchemaInfo> = {};

    for (const row of schemasInDb) {
        const versionString = `${row.versionMajor}.${row.versionWrite}.${row.versionMinor}`;
        const version = semver.parse(versionString);
        if (!version)
            continue;

        schemaInfoMap[row.name] = { name: row.name, version };
    }

    for (const [outerName, schemaGroup] of Object.entries(availableSchemas)) {
        for (const schema of schemaGroup) {
            if (!schema.released || !schema.path)
                continue;
            if (schema.name !== outerName)
                continue;

            const cleanedVersion = stripLeadingZeros(schema.version);
            const version = semver.parse(cleanedVersion);
            if (!version)
                continue;

            const existing = schemaInfoMap[schema.name];
            if (existing) {
                if (!existing.latestVersion || semver.lt(existing.latestVersion, version)) {
                    existing.latestVersion = version;
                    existing.path = schema.path;
                }
            } else {
                schemaInfoMap[schema.name] = {
                    name: schema.name,
                    latestVersion: version,
                    path: schema.path,
                };
            }
        }
    }

    return schemaInfoMap;
}

export type SchemaTableRow = {
    name: string;
    currentVersion: string;
    latestVersion: string;
    status: "up-to-date" | "update-available" | "ahead" | "not-in-db";
};

/** Build a flat list of schema table rows from the merged schema info map. Only includes schemas present in the DB. */
export function buildSchemaTableRows(schemaInfoMap: Record<string, SchemaInfo>): SchemaTableRow[] {
    const rows: SchemaTableRow[] = [];
    for (const schema of Object.values(schemaInfoMap)) {
        if (!schema.version)
            continue;

        let latestVersion = "";
        let status: SchemaTableRow["status"] = "not-in-db";
        if (schema.latestVersion) {
            latestVersion = schema.latestVersion.toString();
            if (semver.eq(schema.version, schema.latestVersion))
                status = "up-to-date";
            else if (semver.lt(schema.version, schema.latestVersion))
                status = "update-available";
            else
                status = "ahead";
        }

        rows.push({
            name: schema.name,
            currentVersion: schema.version.toString(),
            latestVersion,
            status,
        });
    }
    return rows;
}
