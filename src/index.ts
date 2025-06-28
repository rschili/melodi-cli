#!/usr/bin/env node

import { Runner } from "./Runner";
import { applicationVersion } from "./Diagnostics";
import gradient from "gradient-string";
import { formatSuccess, printError } from "./ConsoleHelper";
import { readUserConfig, setup } from "./Workspace.UserConfig";

const banner =
  `                      _               _   _ 
   _ __ ___     ___  | |   ___     __| | (_)
  | '_ \` _ \\   / _ \\ | |  / _ \\   / _\` | | |
  | | | | | | |  __/ | | | (_) | | (_| | | |
  |_| |_| |_|  \\___| |_|  \\___/   \\__,_| |_| CLI
------------------------------------------------------
          iModel repository utility
------------------------------------------------------`;
console.log(gradient(['cyan', 'white']).multiline(banner));
console.log(formatSuccess(`v${applicationVersion}`));
async function main() {
  try {
    const args = process.argv.slice(2);
    let runSetup = false;
    if (args.length == 1) {
      if (args[0] === '-v' || args[0] === '--version' || args[0] === 'version') {
        console.log(`Version ${applicationVersion}`);
        return;
      }
      if (args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
        console.log(`Version ${applicationVersion}`);
        console.log(`Usage: melodi-cli [options]`);
        console.log(`Options:`);
        console.log(`  -v, --version    Show version number`);
        console.log(`  -h, --help       Show this help message`);
        console.log(`  --setup          Setup the user configuration`);
        console.log();
        console.log("The tool is designed to be interactive, so it is usually run without arguments.");
        return;
      }
      if (args[0] === '--setup' || args[0] === 'setup') {
        runSetup = true;
      }
    }

    const userConfig = await readUserConfig();
    if (runSetup) {
      await setup(userConfig);
      console.log(formatSuccess("User configuration setup completed."));
    }

    const runner = new Runner();
    await runner.run(userConfig);
    process.exit(0);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'ExitPromptError') { // ctrl+c on inquirer
      process.exit(0);
    }
    printError(error);
    process.exit(1);
  }
};

main();
