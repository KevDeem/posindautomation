#!/usr/bin/env node
/**
 * Interactive login helper for Logistics Automation.
 * Opens headed Chromium to the target application URL.
 * Automatically polls for authenticated state (URL change away from /login,
 * presence of user avatar/menu, or detection of target page content).
 * Once authenticated, automatically saves storageState to .sessions/ and captures
 * initial inspection data.
 */

const fs = require('fs');
const path = require('path');
const {
  launchBrowser,
  createContext,
  saveStorageState,
  closeBrowser,
  ARTIFACTS_DIR,
} = require('./browser_manager');

const CONFIG_PATH = path.join(__dirname, '../config/environments.json');

async function run() {
  const envName = process.argv[2] || 'staging-oms';
  const targetPath = process.argv[3] || '/international-shipping';

  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[Error] Config file not found at ${CONFIG_PATH}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  const envConfig = config.environments?.[envName];
  if (!envConfig) {
    console.error(`[Error] Environment "${envName}" not found in ${CONFIG_PATH}`);
    process.exit(1);
  }

  const appUrl = envConfig.applicationUrl.replace(/\/+$/, '');
  const accountId = envConfig.defaultAccount;
  const initialUrl = `${appUrl}${targetPath.startsWith('/') ? targetPath : '/' + targetPath}`;

  console.log(`=== Interactive Login & Session Capture ===`);
  console.log(`Environment: ${envName}`);
  console.log(`Account: ${accountId}`);
  console.log(`Target URL: ${initialUrl}\n`);

  const browser = await launchBrowser({
    headless: false,
    slowMo: 100,
  });

  const { context, sessionPath } = await createContext(browser, {
    envName,
    accountId,
  });

  const page = await context.newPage();

  console.log(`[1] Navigating to ${initialUrl}...`);
  await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

  console.log(`[2] Waiting for authentication...`);
  console.log(`    Please log in within the open Chromium browser window.`);
  console.log(`    Monitoring for login completion (timeout: 5 minutes)...`);

  const startTime = Date.now();
  const maxWaitMs = 300000; // 5 minutes
  let authenticated = false;

  while (Date.now() - startTime < maxWaitMs) {
    await page.waitForTimeout(2000);
    const currentUrl = page.url();

    // Check if URL indicates successful login
    const isLoginPage = currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl.includes('/signin');
    const onTargetApp = currentUrl.startsWith(appUrl);

    if (onTargetApp && !isLoginPage) {
      // Confirm authenticated state by looking for dashboard, navigation, or target route
      try {
        const hasNavOrTarget = await page.evaluate(() => {
          const bodyText = document.body ? document.body.innerText : '';
          const hasSidebar = !!document.querySelector('nav, aside, header, [role="navigation"]');
          const hasLogout = /keluar|logout|sign out|profile|dashboard/i.test(bodyText);
          const hasForms = !!document.querySelector('form, input, table, main');
          return hasSidebar || hasLogout || hasForms;
        });

        if (hasNavOrTarget) {
          authenticated = true;
          console.log(`\n[3] Authenticated state detected at: ${currentUrl}`);
          break;
        }
      } catch (err) {
        // Page might be navigating, ignore and continue polling
      }
    }
  }

  if (!authenticated) {
    console.error(`\n[Error] Login wait timed out after 5 minutes.`);
    await closeBrowser(browser, context);
    process.exit(1);
  }

  // Ensure on international-shipping page
  if (!page.url().includes(targetPath)) {
    console.log(`[4] Navigating to target page ${initialUrl}...`);
    await page.goto(initialUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => null);
  }

  await page.waitForTimeout(3000);

  // Save storageState
  console.log(`[5] Saving authenticated session state to ${sessionPath}...`);
  await saveStorageState(context, sessionPath);

  // Capture inspection artifact
  const inspectionDir = path.join(ARTIFACTS_DIR, 'inspection');
  if (!fs.existsSync(inspectionDir)) {
    fs.mkdirSync(inspectionDir, { recursive: true });
  }

  const timestamp = Date.now();
  const screenshotPath = path.join(inspectionDir, `oms_international_shipping_${timestamp}.png`);
  const jsonPath = path.join(inspectionDir, `oms_international_shipping_${timestamp}.json`);

  console.log(`[6] Capturing full-page screenshot to ${screenshotPath}...`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  console.log(`[7] Extracting DOM controls and fields...`);
  const domInfo = await page.evaluate(() => {
    function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map(el => clean(el.innerText)).filter(Boolean);

    const labels = Array.from(document.querySelectorAll('label, .form-label, [class*="label"]'))
      .map(el => clean(el.innerText)).filter(Boolean);

    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'))
      .map(el => {
        let label = '';
        if (el.id) {
          const l = document.querySelector(`label[for="${el.id}"]`);
          if (l) label = clean(l.innerText);
        }
        if (!label && el.closest('label')) label = clean(el.closest('label').innerText);
        return {
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute('type') || el.tagName.toLowerCase(),
          id: el.id || undefined,
          name: el.getAttribute('name') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          label: label || el.getAttribute('aria-label') || undefined,
          required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true' || el.classList.contains('required'),
        };
      });

    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]'))
      .map(el => clean(el.innerText || el.getAttribute('value') || el.getAttribute('aria-label'))).filter(Boolean);

    return {
      title: document.title,
      url: window.location.href,
      headings,
      labels: Array.from(new Set(labels)),
      inputs,
      buttons: Array.from(new Set(buttons)),
    };
  });

  fs.writeFileSync(jsonPath, JSON.stringify(domInfo, null, 2), 'utf-8');
  console.log(`[8] DOM inspection saved to ${jsonPath}`);

  console.log(`\n=== Inspection Complete ===`);
  console.log(`URL: ${domInfo.url}`);
  console.log(`Title: ${domInfo.title}`);
  console.log(`Found ${domInfo.inputs.length} inputs and ${domInfo.buttons.length} buttons.`);

  await closeBrowser(browser, context);
}

run().catch((err) => {
  console.error('[Error] Fatal error in interactive login:', err);
  process.exit(1);
});
