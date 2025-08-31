#!/usr/bin/env node

import { applicationBuildDate, applicationVersion, checkUpdates } from "./Diagnostics";
import gradient from "gradient-string";
import { formatPath, formatSuccess, printError } from "./ConsoleHelper";
import { readUserConfig } from "./UserConfig";
import chalk from "chalk";
import { getCacheDir, getConfigDir, getRootDir } from "./SystemFolders";
import { promises as fs } from "fs";
import { Context, loadContext } from "./Context";
import { FileSelector } from "./Logic/FileSelector";

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
  await checkUpdates();
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
      console.log("Location of workspace, config and cache can be overwritten using environment variables.");
      console.log("  - MELODI_CONFIG: Location of the config directory");
      console.log("  - MELODI_CACHE: Location of the cache directory");
      console.log("  - MELODI_ROOT: Location of the root directory");
      process.exit(0);
    }
  }

  const cacheDir = getCacheDir();
  const configDir = getConfigDir();
  const rootDir = getRootDir();
  // Ensure directories exist
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.mkdir(rootDir, { recursive: true });
  const userConfig = await readUserConfig(configDir);
  console.log(`Using config directory: ${formatPath(configDir)}`);
  console.log(`Using cache directory: ${formatPath(cacheDir)}`);
  console.log(`Using documents directory: ${formatPath(rootDir)}`);
  const ctx: Context = await loadContext(userConfig, { cacheDir, configDir, rootDir });
  if(ctx.commandCache.melodiVersion !== applicationVersion) {
      console.log(formatSuccess(`The workspace was saved using a different version of melodi (${ctx.commandCache.melodiVersion}). Running version (${applicationVersion}).`));
  }

  try {
      await ctx.envManager.startup();
      await FileSelector.run(ctx);
  } finally {
      await ctx.envManager.shutdown();
  }
  process.exit(0);
} catch (error: unknown) {
  if (error instanceof Error && error.name === 'ExitPromptError') { // ctrl+c on inquirer
    process.exit(0);
  }
  printError(error);
  process.exit(1);
}

