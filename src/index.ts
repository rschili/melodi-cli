#!/usr/bin/env node

import chalk from 'chalk';
import figlet from 'figlet';

const banner = figlet.textSync('Melodi', {
  horizontalLayout: 'full',
  verticalLayout: 'default'
});
console.log(chalk.blue(banner));
console.log(chalk.blue('♫ A cleaner tune for iModel work'));

