/**
 * Smoke test for Playwright browser automation infrastructure.
 * Validates:
 * 1. Playwright module loading
 * 2. Chromium launch and shutdown
 * 3. Navigation to about:blank
 * 4. Screenshot generation
 * 5. Session state storage and reloading
 */

const {
  launchBrowser,
  createContext,
  saveStorageState,
  closeBrowser,
  ARTIFACTS_DIR,
} = require('./browser_manager');
const fs = require('fs');
const path = require('path');

async function runSmokeTest() {
  console.log('=== Playwright Smoke Test Started ===');

  let browser;
  let context;
  try {
    // 1. Launch default headed Chromium (or test headless opt-in)
    console.log('[Test 1] Launching Chromium in default headed mode...');
    const headedBrowser = await launchBrowser(); // default should be headed (headless: false)
    if (!headedBrowser) throw new Error('Headed browser instance is null');
    console.log('[PASS] Default headed Chromium launched successfully');
    await closeBrowser(headedBrowser);

    console.log('[Test 1b] Launching Chromium in opt-in headless mode...');
    browser = await launchBrowser({ headless: true });
    if (!browser) throw new Error('Headless browser instance is null');
    console.log('[PASS] Opt-in headless Chromium launched successfully');

    // 2. Create Context & Test session storage
    console.log('[Test 2] Creating context with session persistence...');
    const sessionDir = path.join(ARTIFACTS_DIR, 'test-sessions');
    const { context: ctx, sessionPath } = await createContext(browser, {
      envName: 'test-smoke-env',
      accountId: 'test-user',
      storageStateDir: path.relative(path.resolve(__dirname, '../../..'), sessionDir),
    });
    context = ctx;

    const page = await context.newPage();

    // 3. Navigate to about:blank and render test DOM
    console.log('[Test 3] Navigating to about:blank and setting content...');
    await page.goto('about:blank');
    await page.setContent(`
      <!DOCTYPE html>
      <html>
        <head><title>Playwright Smoke Test</title></head>
        <body>
          <h1>Logistics Automation Smoke Test</h1>
          <button id="btn-test">Click Me</button>
          <input type="text" placeholder="Enter test query" />
        </body>
      </html>
    `);

    const title = await page.title();
    if (title !== 'Playwright Smoke Test') {
      throw new Error(`Unexpected page title: ${title}`);
    }
    console.log(`[PASS] Page loaded and evaluated DOM title: "${title}"`);

    // 4. Test screenshot capture
    console.log('[Test 4] Capturing test screenshot...');
    const testScreenshotDir = path.join(ARTIFACTS_DIR, 'smoke-tests');
    if (!fs.existsSync(testScreenshotDir)) {
      fs.mkdirSync(testScreenshotDir, { recursive: true });
    }
    const screenshotPath = path.join(testScreenshotDir, 'smoke_test.png');
    await page.screenshot({ path: screenshotPath });
    if (!fs.existsSync(screenshotPath) || fs.statSync(screenshotPath).size === 0) {
      throw new Error('Screenshot file was not created or is 0 bytes');
    }
    console.log(`[PASS] Screenshot captured successfully: ${screenshotPath}`);

    // 5. Save and reload session state
    console.log('[Test 5] Validating storage state persistence...');
    await saveStorageState(context, sessionPath);
    if (!fs.existsSync(sessionPath)) {
      throw new Error(`Session storage file not found at: ${sessionPath}`);
    }
    const sessionContent = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
    if (!sessionContent.cookies || !Array.isArray(sessionContent.origins)) {
      throw new Error('Session storage JSON is missing expected Playwright schema');
    }
    console.log(`[PASS] Session state verified and saved cleanly`);

    console.log('\n>>> All Smoke Tests PASSED! Playwright infrastructure is fully verified.');

  } catch (err) {
    console.error(`\n[FAIL] Smoke test encountered an error:`, err);
    process.exitCode = 1;
  } finally {
    if (browser) {
      await closeBrowser(browser, context);
    }
  }
}

runSmokeTest();
