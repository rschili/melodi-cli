#!/usr/bin/env node

import { Runner } from "./Runner";
import { applicationVersion } from "./Diagnostics";
import gradient from "gradient-string";
import { formatError, formatSuccess } from "./ConsoleFormatter";

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
  .catch((error: Error) => {
    console.error(formatError('An error occurred:'), error.message);
    process.exit(1);
  });