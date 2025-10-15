#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { App } from './components/App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Display banner before rendering the app
const displayBanner = () => {
  // Read brain ASCII art from file
  const brainPath = join(__dirname, 'brain-absolutely');
  const brainContent = readFileSync(brainPath, 'utf-8');
  const brain = brainContent.split('\n').filter((line) => line.length > 0);

  console.log('\n');
  // Apply pink gradient color to the brain
  brain.forEach((line) => {
    console.log('  ' + chalk.hex('#E91E63')(line));
  });
  console.log('\n  ' + chalk.bold.white('Watch Claude Think'));
  console.log(chalk.dim('  ──────────────────────────────────'));
  console.log('\n');
};

displayBanner();

render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
