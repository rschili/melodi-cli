#!/usr/bin/env node

import chalk from 'chalk';
import figlet from 'figlet';
import readline from 'readline';
import { Runner } from "./Runner";

const banner = figlet.textSync('melodi', {
  horizontalLayout: 'full',
  verticalLayout: 'default'
});
console.log(banner + " CLI");
console.log();
console.log(chalk.blueBright('A gentle tune that makes iModels sing and sound.'));

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