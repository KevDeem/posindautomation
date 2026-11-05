#!/usr/bin/env node
/**
 * UI Inspection Tool for Logistics Automation
 * Safely inspects web pages without submitting forms or modifying data.
 * Extracts title, URL, visible headings, buttons, links, inputs, and dropdowns,
 * and saves a full-page screenshot and inspection report in `.artifacts/inspection/`.
 */

const { program } = require('commander');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const {
  launchBrowser,
  createContext,
  saveStorageState,
  closeBrowser,
  ROOT_DIR,
  ARTIFACTS_DIR,
} = require('./browser_manager');

const CONFIG_PATH = path.join(__dirname, '../config/environments.json');

function loadEnvironmentConfig(envName) {
  if (!fs.existsSync(CONFIG_PATH)) {
    return null;
  }
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  return config.environments?.[envName] || null;
}

async function promptForEnter(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function inspectPage(page) {
  return await page.evaluate(() => {
    function getCleanText(el) {
      return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    const title = document.title;
    const url = window.location.href;

    // Headings
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: getCleanText(el),
      }))
      .filter((h) => h.text.length > 0);

    // Buttons
    const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]'))
      .map((el) => ({
        text: getCleanText(el) || el.getAttribute('aria-label') || el.getAttribute('value') || '',
        type: el.getAttribute('type') || 'button',
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
        id: el.id || undefined,
        role: el.getAttribute('role') || 'button',
      }))
      .filter((b) => b.text.length > 0);

    // Inputs
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="button"]):not([type="submit"]), textarea'))
      .map((el) => {
        const id = el.id;
        let labelText = '';
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`);
          if (label) labelText = getCleanText(label);
        }
        if (!labelText && el.closest('label')) {
          labelText = getCleanText(el.closest('label'));
        }
        return {
          type: el.getAttribute('type') || el.tagName.toLowerCase(),
          name: el.getAttribute('name') || undefined,
          id: el.id || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          label: labelText || el.getAttribute('aria-label') || undefined,
          required: el.hasAttribute('required') || el.getAttribute('aria-required') === 'true',
          disabled: el.hasAttribute('disabled'),
          value: el.value ? '(has value)' : '(empty)',
        };
      });

    // Dropdowns & Comboboxes
    const selects = Array.from(document.querySelectorAll('select, [role="combobox"], [role="listbox"]'))
      .map((el) => {
        const id = el.id;
        let labelText = '';
        if (id) {
          const label = document.querySelector(`label[for="${id}"]`);
          if (label) labelText = getCleanText(label);
        }
        const options = el.tagName.toLowerCase() === 'select'
          ? Array.from(el.querySelectorAll('option')).map((o) => getCleanText(o)).filter(Boolean)
          : [];
        return {
          type: el.tagName.toLowerCase() === 'select' ? 'native-select' : 'custom-combobox',
          name: el.getAttribute('name') || undefined,
          id: el.id || undefined,
          label: labelText || el.getAttribute('aria-label') || undefined,
          sampleOptions: options.slice(0, 10),
          totalOptions: options.length,
        };
      });

    // Navigation links
    const navLinks = Array.from(document.querySelectorAll('nav a, header a, [role="navigation"] a'))
      .map((el) => ({
        text: getCleanText(el),
        href: el.getAttribute('href') || '',
      }))
      .filter((l) => l.text.length > 0 && l.href && !l.href.startsWith('javascript:'))
      .slice(0, 25);

    return {
      title,
      url,
      headings,
      buttons,
      inputs,
      selects,
      navLinks,
    };
  });
}

async function run() {
  program
    .name('inspect_ui')
    .description('Inspect web pages, DOM controls, and accessible locators using Playwright without modifying data')
    .option('-e, --env <name>', 'Environment name from config/environments.json')
    .option('-u, --url <url>', 'Direct URL to inspect (overrides environment applicationUrl)')
    .option('-a, --account <id>', 'Account identifier for session persistence')
    .option('--headless', 'Run browser in headless background mode (default is headed)', false)
    .option('--headed', 'Explicitly run browser in headed visual mode (default)', true)
    .option('--manual-login', 'Pause headed browser to allow manual user login before inspection', false)
    .option('-o, --output-dir <path>', 'Custom directory to save artifacts')
    .parse(process.argv);

  const opts = program.opts();

  let targetUrl = opts.url;
  let envName = opts.env;
  let accountId = opts.account;

  if (envName) {
    const envConfig = loadEnvironmentConfig(envName);
    if (!envConfig) {
      console.error(`[Error] Environment "${envName}" not found in ${CONFIG_PATH}`);
      process.exit(1);
    }
    targetUrl = targetUrl || envConfig.applicationUrl;
    accountId = accountId || envConfig.defaultAccount;
  }

  if (!targetUrl) {
    console.error('[Error] You must provide either --url <URL> or --env <ENV_NAME>');
    process.exit(1);
  }

  // Headed is default; headless only when explicitly requested
  const isHeadless = opts.headless === true && !opts.manualLogin;

  console.log(`=== UI Inspection Tool ===`);
  console.log(`Target URL: ${targetUrl}`);
  console.log(`Environment: ${envName || '(standalone)'} | Account: ${accountId || '(default)'}`);
  console.log(`Headless: ${isHeadless} (Default: Headed) | Manual Login: ${opts.manualLogin}\n`);

  const browser = await launchBrowser({
    headless: isHeadless,
    slowMo: isHeadless ? 0 : 150,
  });

  const { context, sessionPath } = await createContext(browser, {
    envName,
    accountId,
  });

  const page = await context.newPage();

  try {
    console.log(`[1/4] Navigating to ${targetUrl}...`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000); // Allow dynamic frameworks (React/Vue/Angular) to render

    if (opts.manualLogin) {
      console.log('\n>>> Manual login requested.');
      console.log('>>> Please complete the login in the browser window.');
      await promptForEnter('>>> Press [ENTER] here once logged in to proceed with inspection...');
      await saveStorageState(context, sessionPath);
      console.log('>>> Updated session state saved.\n');
    }

    console.log('[2/4] Inspecting page DOM structure & accessible locators...');
    const inspectionData = await inspectPage(page);

    const inspectionDir = opts.outputDir || path.join(ARTIFACTS_DIR, 'inspection');
    if (!fs.existsSync(inspectionDir)) {
      fs.mkdirSync(inspectionDir, { recursive: true });
    }

    const timestamp = Date.now();
    const safeEnv = (envName || 'standalone').replace(/[^a-zA-Z0-9_-]/g, '_');
    const screenshotPath = path.join(inspectionDir, `${safeEnv}_${timestamp}.png`);
    const jsonPath = path.join(inspectionDir, `${safeEnv}_${timestamp}.json`);

    console.log('[3/4] Capturing full-page screenshot...');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    console.log('[4/4] Writing inspection report...');
    const report = {
      inspectionTimestamp: new Date().toISOString(),
      targetUrl,
      actualUrl: inspectionData.url,
      title: inspectionData.title,
      summary: {
        totalHeadings: inspectionData.headings.length,
        totalButtons: inspectionData.buttons.length,
        totalInputs: inspectionData.inputs.length,
        totalSelects: inspectionData.selects.length,
        totalNavLinks: inspectionData.navLinks.length,
      },
      screenshotFile: screenshotPath,
      domElements: inspectionData,
    };

    fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

    console.log(`\n[Inspection Completed Successfully]`);
    console.log(` - Title: "${inspectionData.title}"`);
    console.log(` - URL: ${inspectionData.url}`);
    console.log(` - Elements Found: ${report.summary.totalButtons} buttons, ${report.summary.totalInputs} inputs, ${report.summary.totalSelects} selects/comboboxes`);
    console.log(` - Screenshot: ${screenshotPath}`);
    console.log(` - JSON Report: ${jsonPath}`);

  } catch (err) {
    console.error(`[Error] Inspection failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await closeBrowser(browser, context);
  }
}

run();
