#!/usr/bin/env node

import { Runner } from "./Runner";
import { applicationVersion } from "./Diagnostics";
import gradient from "gradient-string";
import { formatError, formatSuccess, printError } from "./ConsoleFormatter";

const banner =
`                      _               _   _ 
   _ __ ___     ___  | |   ___     __| | (_)
  | '_ \` _ \\   / _ \\ | |  / _ \\   / _\` | | |
  | | | | | | |  __/ | | | (_) | | (_| | | |
  |_| |_| |_|  \\___| |_|  \\___/   \\__,_| |_| CLI
------------------------------------------------------
          iModel repository utility
------------------------------------------------------`;
console.log(gradient(['cyan','white']).multiline(banner));
console.log(formatSuccess(`v${applicationVersion}`));

const runner = new Runner();
runner.run()
  .then(() => {
    console.log(formatSuccess('Process completed successfully!'));
    process.exit(0);
  })
  .catch((error: unknown) => {
    if (error instanceof Error) {
      if (error.name === "ExitPromptError") { // When pressing ctrl+c during an inquirer prompt
        process.exit(0);
      }
    }
    printError(error);
    process.exit(1);
  });