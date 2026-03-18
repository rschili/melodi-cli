import { DbResult } from "@itwin/core-bentley";
import { UnifiedDb } from "../UnifiedDb";

const FK_VIOLATIONS_FLAG = "DebugAllowFkViolations";

export type ForeignKeyFailure = {
    tableName: string;
    rowId: string;
    referredTable: string;
    fkIndex: string;
};

export type ForeignKeyDetail = {
    id: number;
    seq: number;
    table: string;
    from: string;
    to: string;
    onDelete: string;
    onUpdate: string;
};

export type EnrichedFailure = ForeignKeyFailure & {
    fkDescription: string;
};

/** Check whether the DebugAllowFkViolations flag is set in be_Local. */
export function isFkFlagSet(db: UnifiedDb): boolean {
    return db.withSqliteStatement("SELECT Val FROM be_Local WHERE Name = ?", (stmt) => {
        stmt.bindString(1, FK_VIOLATIONS_FLAG);
        return stmt.step() === DbResult.BE_SQLITE_ROW;
    });
}

/** Set or remove the DebugAllowFkViolations flag. */
export function setFkFlag(db: UnifiedDb, enabled: boolean): void {
    if (enabled) {
        db.withSqliteStatement("INSERT OR REPLACE INTO be_Local (Name, Val) VALUES (?, ?)", (stmt) => {
            stmt.bindString(1, FK_VIOLATIONS_FLAG);
            stmt.bindString(2, "");
            stmt.step();
        });
    } else {
        db.withSqliteStatement("DELETE FROM be_Local WHERE Name = ?", (stmt) => {
            stmt.bindString(1, FK_VIOLATIONS_FLAG);
            stmt.step();
        });
    }
}

/** Run PRAGMA foreign_key_check and return any violations. */
export function runForeignKeyCheck(db: UnifiedDb): ForeignKeyFailure[] {
    const failures: ForeignKeyFailure[] = [];
    db.withSqliteStatement("PRAGMA foreign_key_check", (stmt) => {
        while (stmt.step() === DbResult.BE_SQLITE_ROW) {
            failures.push({
                tableName: stmt.getValueString(0),
                rowId: stmt.getValueString(1),
                referredTable: stmt.getValueString(2),
                fkIndex: stmt.getValueString(3),
            });
        }
    });
    return failures;
}

/** Get FK metadata for a given table via PRAGMA foreign_key_list. */
export function getForeignKeyDetails(db: UnifiedDb, tableName: string): ForeignKeyDetail[] {
    const details: ForeignKeyDetail[] = [];
    db.withSqliteStatement(`PRAGMA foreign_key_list([${tableName}])`, (stmt) => {
        while (stmt.step() === DbResult.BE_SQLITE_ROW) {
            details.push({
                id: stmt.getValueInteger(0),
                seq: stmt.getValueInteger(1),
                table: stmt.getValueString(2),
                from: stmt.getValueString(3),
                to: stmt.getValueString(4),
                onDelete: stmt.getValueString(5),
                onUpdate: stmt.getValueString(6),
            });
        }
    });
    return details;
}

/** Enrich FK failures with human-readable FK detail descriptions. */
export function enrichFailures(db: UnifiedDb, failures: ForeignKeyFailure[]): EnrichedFailure[] {
    const tablesWithFailures = new Set(failures.map(f => f.tableName));
    const fkDetailsMap = new Map<string, ForeignKeyDetail[]>();
    for (const tableName of tablesWithFailures) {
        fkDetailsMap.set(tableName, getForeignKeyDetails(db, tableName));
    }

    return failures.map(f => {
        const fkDetails = fkDetailsMap.get(f.tableName);
        const fkIdx = parseInt(f.fkIndex);
        const fk = fkDetails?.[fkIdx];
        const fkDescription = fk ? `${fk.from} -> ${fk.table}.${fk.to}` : `FK index ${f.fkIndex}`;
        return { ...f, fkDescription };
    });
}

/** Run PRAGMA integrity_check and return the result rows. */
export function runIntegrityCheck(db: UnifiedDb): string[] {
    const results: string[] = [];
    db.withSqliteStatement("PRAGMA integrity_check", (stmt) => {
        while (stmt.step() === DbResult.BE_SQLITE_ROW) {
            results.push(stmt.getValueString(0));
        }
    });
    return results;
}

/** Run ECSql PRAGMA integrity_check and return the result rows. */
export async function runEcsqlIntegrityCheck(db: UnifiedDb): Promise<string[]> {
    const reader = db.createQueryReader("PRAGMA integrity_check");
    const rows = await reader.toArray();
    return rows.map(row => {
        const values = row as unknown[];
        return String(values[0] ?? "");
    });
}
