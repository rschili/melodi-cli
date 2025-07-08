#!/usr/bin/env node

import { Runner } from "./Runner";
import { applicationBuildDate, applicationVersion } from "./Diagnostics";
import gradient from "gradient-string";
import { printError } from "./ConsoleHelper";
import { readUserConfig } from "./Workspace.UserConfig";
import chalk from "chalk";

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
  process.exit(10);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  process.exit(5);
});

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 14)) {
  console.error(chalk.yellowBright(`Warning: melodi-cli requires Node.js 22.14 or newer. You are running ${process.versions.node}.`));
}

const subtitle = ` iModel repository utility      built ${applicationBuildDate} `;
const separatorLine = "-".repeat(subtitle.length);
const banner =
  `                      _               _   _ 
   _ __ ___     ___  | |   ___     __| | (_)
  | '_ \` _ \\   / _ \\ | |  / _ \\   / _\` | | |
  | | | | | | |  __/ | | | (_) | | (_| | | |
  |_| |_| |_|  \\___| |_|  \\___/   \\__,_| |_| CLI v${applicationVersion}
${separatorLine}
 ${subtitle}
${separatorLine}`;
console.log(gradient(['cyan', 'white']).multiline(banner));
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