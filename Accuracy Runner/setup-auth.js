/**
 * setup-auth.js
 *
 * One-time Playwright login helper.
 * Auto-fills email + password and waits for the app dashboard.
 * If Clerk requires a verification code, the terminal will prompt for it.
 *
 * Usage:
 *   node setup-auth.js --email you@example.com --password yourpassword
 *   node setup-auth.js --email you@example.com --password yourpassword --url http://localhost:3001
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const readline = require('readline');

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

const APP_URL   = arg('--url')      ?? 'http://localhost:3000';
const EMAIL     = arg('--email');
const PASSWORD  = arg('--password');
const AUTH_FILE = path.join(__dirname, 'auth.json');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  console.log('\n=== Estimatch Accuracy Runner — Auth Setup ===\n');

  const email    = EMAIL    ?? await prompt('Email    : ');
  const password = PASSWORD ?? await prompt('Password : ');

  console.log(`\nApp URL : ${APP_URL}`);
  console.log(`Email   : ${email}`);
  console.log(`Auth    : ${AUTH_FILE}\n`);
  console.log('Launching Edge and signing in automatically...\n');

  const browser = await chromium.launch({ channel: 'msedge', headless: false });
  const context = await browser.newContext();
  const page    = await context.newPage();

  await page.goto(`${APP_URL}/sign-in`);

  // Fill email
  await page.waitForSelector('input[name="identifier"], input[type="email"]', { timeout: 15000 });
  await page.fill('input[name="identifier"], input[type="email"]', email);
  await page.keyboard.press('Enter');

  // Fill password (Clerk shows this on the next step)
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.fill('input[type="password"]', password);
  await page.keyboard.press('Enter');

  // Wait for the user to confirm they're on the app dashboard.
  // Playwright filled in the credentials — just handle any remaining steps
  // (e.g. verification code) in the browser window, then press Enter here.
  console.log('\nBrowser is filling in your credentials...');
  console.log('If a verification code screen appears, enter the code in the browser.');
  console.log('Once you can see the app dashboard, come back here and press Enter.\n');
  await prompt('>> Press Enter once you are on the app dashboard: ');

  console.log('\nSaving auth state...');
  await context.storageState({ path: AUTH_FILE });
  console.log(`Auth state saved to ${AUTH_FILE}`);
  console.log('You can now run the accuracy runner with: node runner.js\n');

  await browser.close();
}

main().catch(err => {
  console.error('\nsetup-auth failed:', err.message);
  process.exit(1);
});
