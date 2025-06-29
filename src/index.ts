#!/usr/bin/env node

import { Runner } from "./Runner.js";
import { applicationVersion } from "./Diagnostics.js";
import gradient from "gradient-string";
import { formatSuccess, printError } from "./ConsoleHelper.js";
import { readUserConfig } from "./Workspace.UserConfig.js";

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
try {
  const args = process.argv.slice(2);
  if (args.length == 1) {
    if (args[0] === '-v' || args[0] === '--version' || args[0] === 'version') {
      console.log(`Version ${applicationVersion}`);
      process.exit(0);
    }
    if (args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
      console.log(`Version ${applicationVersion}`);
      console.log(`Usage: melodi-cli [options]`);
      console.log(`Options:`);
      console.log(`  -v, --version    Show version number`);
      console.log(`  -h, --help       Show this help message`);
      console.log();
      console.log("The tool is designed to be interactive, so it is usually run without arguments.");
      process.exit(0);
    }
  }

  const userConfig = await readUserConfig();

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