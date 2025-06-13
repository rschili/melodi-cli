#!/usr/bin/env node

import chalk from 'chalk';
import { Runner } from "./Runner";
import { applicationVersion } from "./Diagnostics";
import gradient from "gradient-string";

const banner =
`                     _               _   _ 
  _ __ ___     ___  | |   ___     __| | (_)
 | '_ \` _ \\   / _ \\ | |  / _ \\   / _\` | | |
 | | | | | | |  __/ | | | (_) | | (_| | | |
 |_| |_| |_|  \\___| |_|  \\___/   \\__,_| |_| CLI
--------------------------------------------------
  A gentle tune that makes iModels sing and sound.
--------------------------------------------------`;
console.log(gradient(['cyan','white']).multiline(banner));
console.log(chalk.blueBright(`v${applicationVersion}`));

const runner = new Runner();
runner.run()
  .then(() => {
    console.log(chalk.green('Process completed successfully!'));
    process.exit(0);
  })
  .catch((error: any) => {
    console.error(chalk.red('An error occurred:'), error);
    process.exit(1);
  });