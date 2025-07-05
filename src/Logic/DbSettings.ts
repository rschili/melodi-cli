import { UnifiedDb } from "../UnifiedDb";
import { select, isCancel, confirm, log } from "@clack/prompts"
import { ECSqlStatement } from "@itwin/core-backend";
import { DbResult } from "@itwin/core-bentley";
import chalk from "chalk";

export class DbSettings {
    public static async getExperimentalFeaturesEnabled(db: UnifiedDb): Promise<boolean> {
        if(!db.supportsECSql) {
            return false; // Experimental features are only available for IModelDb or ECDb
        }

        let result = false;
        db.withECSqlStatement("PRAGMA experimental_features_enabled", (stmt: ECSqlStatement) => {
            if (stmt.step() !== DbResult.BE_SQLITE_ROW) {
                log.error("Failed to read experimental features enabled flag");
                return;
            }
            result = stmt.getValue(0).getBoolean();
        });
        return result;
    }

    public static async setExperimentalFeaturesEnabled(db: UnifiedDb, enabled: boolean): Promise<void> {
        if(!db.supportsECSql) {
            throw new Error("Experimental features can only be set for IModelDb or ECDb.");
        }

        db.withECSqlStatement(`PRAGMA experimental_features_enabled=${enabled ? 'true' : 'false'}`, (stmt: ECSqlStatement) => {
            const result = stmt.step();
            if(result != DbResult.BE_SQLITE_ROW) {
                log.error(`Failed to set experimental features enabled flag`);
            }
        });
    }

    public static async run(db: UnifiedDb): Promise<void> {
        while (true) {
            const experimentalEnabled = await this.getExperimentalFeaturesEnabled(db);
            const choice = await select(
                {
                    message: "Select a setting to change:",
                    options: [
                        { label: `Experimental features enabled: ${experimentalEnabled ? chalk.greenBright('true') : chalk.redBright('false')})`, value: "experimental" },
                        { label: "Back", value: "back" },
                    ],
                });

            if (isCancel(choice) || choice === "back") {
                return;
            }

            if (choice === "experimental") {
                const newExperimentalEnabled = await confirm({message: "Enable experimental features?", initialValue: experimentalEnabled});
                if (isCancel(newExperimentalEnabled)) {
                    continue; // User cancelled, go back to the menu
                }
                await this.setExperimentalFeaturesEnabled(db, newExperimentalEnabled);
            }
        }
    }
}