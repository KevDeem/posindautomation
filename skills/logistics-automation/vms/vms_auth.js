/**
 * VMS Authentication Manager
 * Handles login to Vendor Management System via Playwright, session persistence,
 * and isolated browser contexts without interfering with OMS sessions.
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { loadVmsConfig } = require('./vms_config');

async function performVmsLogin(page, context, config = {}) {
  const cfg = loadVmsConfig(config);
  const loginUrl = `${cfg.vmsUrl}/login`;

  console.log('[VMSAuth] Navigating to VMS login page...');
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });

  // Check if already authenticated and redirected away from login
  if (!page.url().includes('/login')) {
    console.log('[VMSAuth] Already authenticated, redirected to:', page.url());
    return { success: true, url: page.url() };
  }

  // Wait for login form inputs
  const emailInput = page.locator('#user_email, input[placeholder*="email" i], input[type="text"]').first();
  const passwordInput = page.locator('#password, input[type="password"]').first();
  const submitBtn = page.locator('button:has-text("Masuk"), button:has-text("Login"), button[type="submit"]').first();

  await emailInput.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
  await emailInput.fill(cfg.username);
  await passwordInput.fill(cfg.password);
  await submitBtn.click();

  // Wait for post-login redirect away from /login
  await page.waitForFunction(
    () => !window.location.pathname.includes('/login'),
    { timeout: cfg.navigationTimeoutMs }
  );

  console.log('[VMSAuth] Login successful. Landed on:', page.url());

  // Save storage state if sessionPath configured
  if (cfg.sessionPath) {
    try {
      const dir = path.dirname(cfg.sessionPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await context.storageState({ path: cfg.sessionPath });
      console.log('[VMSAuth] Saved storage state to:', cfg.sessionPath);
    } catch (saveErr) {
      console.warn('[VMSAuth] Could not save storage state:', saveErr.message);
    }
  }

  return { success: true, url: page.url() };
}

async function getAuthenticatedVmsPage(options = {}) {
  const cfg = loadVmsConfig(options);
  const headless = options.headless !== undefined
    ? Boolean(options.headless)
    : (cfg.headless !== undefined ? Boolean(cfg.headless) : false);

  const browser = options.existingBrowser || await chromium.launch({
    headless,
    slowMo: headless ? 0 : 50,
  });

  let context;
  if (options.existingContext) {
    context = options.existingContext;
  } else if (cfg.sessionPath && fs.existsSync(cfg.sessionPath)) {
    try {
      context = await browser.newContext({ storageState: cfg.sessionPath });
    } catch (e) {
      context = await browser.newContext();
    }
  } else {
    context = await browser.newContext();
  }

  const page = options.existingPage || await context.newPage();

  // Test session validity by navigating to /service-catalog
  if (!options.skipLogin) {
    try {
      await page.goto(`${cfg.vmsUrl}/service-catalog`, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
      
      const needsLogin = await Promise.race([
        page.waitForURL(url => url.pathname.includes('/login'), { timeout: 6000 }).then(() => true).catch(() => false),
        page.waitForSelector('#user_email, input[placeholder*="email" i]', { state: 'visible', timeout: 6000 }).then(() => true).catch(() => false),
        page.waitForSelector('.ant-table, .ant-menu, .ant-layout-sider, .ant-layout-header', { state: 'visible', timeout: 6000 }).then(() => false).catch(() => false),
      ]);

      if (needsLogin || page.url().includes('/login')) {
        console.log('[VMSAuth] Session invalid or unauthenticated. Performing login...');
        await performVmsLogin(page, context, cfg);
        if (!page.url().includes('/service-catalog')) {
          await page.goto(`${cfg.vmsUrl}/service-catalog`, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
        }
      }
    } catch (err) {
      console.log('[VMSAuth] Navigation failed or unauthenticated. Performing fresh login...');
      await performVmsLogin(page, context, cfg);
      if (!page.url().includes('/service-catalog')) {
        await page.goto(`${cfg.vmsUrl}/service-catalog`, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
      }
    }
  }

  return { browser, context, page, isNewBrowser: !options.existingBrowser, headless };
}

module.exports = {
  performVmsLogin,
  getAuthenticatedVmsPage,
};
