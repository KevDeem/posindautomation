/**
 * Reusable Playwright Browser Infrastructure for Logistics Automation
 * Provides browser lifecycle, session persistence, screenshot error capture,
 * and UI authentication helpers.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.sessions');
const ARTIFACTS_DIR = path.join(ROOT_DIR, '.artifacts');

function logAction(action, detail = '') {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [BrowserManager] ${action} ${detail}`);
}

function logError(action, error) {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [BrowserManager:ERROR] ${action}: ${error?.message || error}`);
}

/**
 * Launch Chromium browser instance.
 * Defaults to HEADED mode (headless: false) for visual inspection and execution.
 * Headless mode is opt-in when options.headless is explicitly passed as true.
 */
async function launchBrowser(options = {}) {
  const headless = options.headless === true;
  const slowMo = options.slowMo !== undefined ? options.slowMo : (headless ? 0 : 100);
  const timeoutMs = options.timeoutMs || 30000;

  logAction('Launching Chromium browser', `(headless: ${headless}, slowMo: ${slowMo}ms)`);
  try {
    const browser = await chromium.launch({
      headless,
      slowMo,
      timeout: timeoutMs,
    });
    return browser;
  } catch (err) {
    logError('Failed to launch Chromium browser', err);
    throw err;
  }
}

/**
 * Resolve session file path for a given environment and account.
 */
function getSessionPath(envName, accountId, customDir) {
  const baseDir = customDir ? path.resolve(ROOT_DIR, customDir) : SESSIONS_DIR;
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  const safeEnv = (envName || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeAccount = (accountId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(baseDir, `${safeEnv}_${safeAccount}_session.json`);
}

/**
 * Create a new browser context with session persistence support.
 */
async function createContext(browser, options = {}) {
  const envName = options.envName || 'default';
  const accountId = options.accountId || 'default';
  const customDir = options.storageStateDir;
  const sessionPath = getSessionPath(envName, accountId, customDir);
  const viewport = options.viewport || { width: 1280, height: 800 };
  const actionTimeoutMs = options.actionTimeoutMs || 10000;
  const navigationTimeoutMs = options.navigationTimeoutMs || 30000;

  const contextOptions = {
    viewport,
  };

  if (fs.existsSync(sessionPath)) {
    try {
      contextOptions.storageState = sessionPath;
      logAction('Loaded existing session state', sessionPath);
    } catch (err) {
      logError('Failed to read storage state, starting fresh session', err);
    }
  } else {
    logAction('No existing session state found; creating fresh context', sessionPath);
  }

  const context = await browser.newContext(contextOptions);
  context.setDefaultTimeout(actionTimeoutMs);
  context.setDefaultNavigationTimeout(navigationTimeoutMs);

  return { context, sessionPath };
}

/**
 * Save browser context storage state to disk.
 */
async function saveStorageState(context, sessionPath) {
  try {
    const parentDir = path.dirname(sessionPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    await context.storageState({ path: sessionPath });
    logAction('Session state saved', sessionPath);
  } catch (err) {
    logError('Failed to save session state', err);
  }
}

/**
 * Capture error screenshot and HTML snapshot for debugging.
 */
async function captureErrorArtifact(page, errorPrefix = 'error', customOutputDir) {
  try {
    const outputDir = customOutputDir || path.join(ARTIFACTS_DIR, 'errors');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = Date.now();
    const screenshotPath = path.join(outputDir, `${errorPrefix}_${timestamp}.png`);
    const htmlPath = path.join(outputDir, `${errorPrefix}_${timestamp}.html`);

    await page.screenshot({ path: screenshotPath, fullPage: true });
    const content = await page.content();
    fs.writeFileSync(htmlPath, content, 'utf-8');

    logAction('Error artifact captured', `Screenshot: ${screenshotPath} | DOM: ${htmlPath}`);
    return { screenshotPath, htmlPath };
  } catch (err) {
    logError('Failed to capture error artifact', err);
    return null;
  }
}

/**
 * UI Authentication Helper.
 * Handles standard login forms or awaits interactive login.
 */
async function executeUiLogin(page, {
  loginUrl,
  loginMethod = 'standard-ui-form',
  username = '',
  password = '',
  targetUrl,
  timeoutMs = 30000,
}) {
  logAction('Initiating UI Login', `Method: ${loginMethod} | LoginURL: ${loginUrl}`);

  if (loginUrl) {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  }

  if (loginMethod === 'manual-interactive-login') {
    logAction('Waiting for manual user login in headed browser (max 120s)...');
    if (targetUrl) {
      await page.waitForURL((url) => url.href.includes(targetUrl), { timeout: 120000 });
    } else {
      await page.waitForLoadState('networkidle', { timeout: 120000 });
    }
    logAction('Manual interactive login detected.');
    return true;
  }

  if (loginMethod === 'standard-ui-form') {
    if (!username || !password) {
      throw new Error('Username or password environment variable value is missing for standard-ui-form login');
    }

    // Attempt accessible and semantic locators first
    const userField = page.getByLabel(/username|email|user|id/i)
      .or(page.getByPlaceholder(/username|email|user/i))
      .or(page.locator('input[type="text"], input[type="email"], input[name*="user"], input[name*="login"]').first());

    const passField = page.getByLabel(/password|kata sandi/i)
      .or(page.getByPlaceholder(/password|kata sandi/i))
      .or(page.locator('input[type="password"]').first());

    const submitBtn = page.getByRole('button', { name: /log in|sign in|masuk|submit/i })
      .or(page.locator('button[type="submit"], input[type="submit"]').first());

    await userField.waitFor({ state: 'visible', timeout: 10000 });
    await userField.fill(username);
    logAction('Username filled');

    await passField.waitFor({ state: 'visible', timeout: 10000 });
    await passField.fill(password);
    logAction('Password filled');

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: timeoutMs }).catch(() => null),
      submitBtn.click(),
    ]);

    logAction('Login form submitted');
    return true;
  }

  if (loginMethod === 'sso-ui-redirect') {
    logAction('SSO UI redirect: waiting for navigation to settle');
    await page.waitForLoadState('networkidle', { timeout: timeoutMs });
    return true;
  }

  throw new Error(`Unsupported login method: ${loginMethod}`);
}

/**
 * Cleanly close context and browser instance.
 */
async function closeBrowser(browser, context) {
  try {
    if (context) {
      await context.close();
    }
    if (browser) {
      await browser.close();
    }
    logAction('Browser and context closed cleanly');
  } catch (err) {
    logError('Error while closing browser', err);
  }
}

module.exports = {
  launchBrowser,
  createContext,
  saveStorageState,
  captureErrorArtifact,
  executeUiLogin,
  closeBrowser,
  getSessionPath,
  ROOT_DIR,
  SESSIONS_DIR,
  ARTIFACTS_DIR,
};
