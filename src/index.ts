#!/usr/bin/env node

import chalk from 'chalk';
import figlet from 'figlet';
import readline from 'readline';

const banner = figlet.textSync('melodi', {
  horizontalLayout: 'full',
  verticalLayout: 'default'
});
console.log(banner + " CLI");
console.log();
console.log(chalk.blueBright('A gentle tune that makes iModels sing and sound.'));

type Environment = 'PROD' | 'QA' | 'DEV';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const environments: Environment[] = ['PROD', 'QA', 'DEV'];
const defaultEnvironment: Environment = 'PROD'; // Default to PROD

console.log('Please select an environment:');
environments.forEach((env, index) => {
  console.log(`${index + 1}. ${env}`);
});

rl.question(`Enter your choice (number or name) [${defaultEnvironment}]: `, (answer) => {
  const choice = answer.trim().toUpperCase();
  let selectedEnvironment: Environment = defaultEnvironment; // Default to PROD

  if (choice) {
    if (!isNaN(Number(choice))) {
      const index = Number(choice) - 1;
      if (index >= 0 && index < environments.length) {
        selectedEnvironment = environments[index];
      }
    } else if (environments.includes(choice as Environment)) {
      selectedEnvironment = choice as Environment;
    }
  }

  console.log(`Selected environment: ${selectedEnvironment}`);
  rl.close();
});