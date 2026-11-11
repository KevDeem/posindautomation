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
  await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: cfg.navigationTimeoutMs }).catch(async () => {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
  });

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

  // Wait for initial Next.js loading overlay to detach if present
  await page.locator('img[alt="loading image"], div:has(img[alt="loading image"])').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});

  try {
    await submitBtn.click({ timeout: 5000 });
  } catch (clickErr) {
    console.warn('[VMSAuth] Standard click on submit button intercepted, attempting forced click...');
    await submitBtn.click({ force: true }).catch(async () => {
      await submitBtn.evaluate(b => b.click());
    });
  }

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

      const bodyText = await page.locator('body').innerText().catch(() => '');
      const hasPermissionError = /not permission|doesn't have permission/i.test(bodyText);

      if (needsLogin || page.url().includes('/login') || hasPermissionError) {
        console.log('[VMSAuth] Session invalid, unauthenticated, or lacks permission. Performing login...');
        await performVmsLogin(page, context, cfg);
        
        // Navigate via UI menu to ensure proper session initialization
        await page.goto(`${cfg.vmsUrl}/`, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
        await page.waitForTimeout(1000);
        const vendorMenu = page.locator('.ant-menu-submenu:has-text("Vendor") .ant-menu-submenu-title, text=Vendor').first();
        if (await vendorMenu.isVisible().catch(() => false)) {
          await vendorMenu.click().catch(() => {});
          await page.waitForTimeout(500);
          const scLink = page.locator('.ant-menu-sub a[href*="service-catalog"], text="Service Catalog"').first();
          if (await scLink.isVisible().catch(() => false)) {
            await scLink.click().catch(() => {});
            await page.waitForTimeout(1500);
          }
        }
        if (!page.url().includes('/service-catalog')) {
          await page.goto(`${cfg.vmsUrl}/service-catalog`, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
        }
        if (cfg.sessionPath) {
          await context.storageState({ path: cfg.sessionPath }).catch(() => {});
        }
      }
    } catch (err) {
      console.log('[VMSAuth] Navigation failed or unauthenticated. Performing fresh login...');
      await performVmsLogin(page, context, cfg);
      if (!page.url().includes('/service-catalog')) {
        await page.goto(`${cfg.vmsUrl}/service-catalog`, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
      }
      if (cfg.sessionPath) {
        await context.storageState({ path: cfg.sessionPath }).catch(() => {});
      }
    }
  }

  return { browser, context, page, isNewBrowser: !options.existingBrowser, headless };
}

/**
 * Extract POS_SID cookie value from stored session file
 */
function getStoredVmsSessionCookie(config = {}) {
  const cfg = loadVmsConfig(config);
  if (!cfg.sessionPath || !fs.existsSync(cfg.sessionPath)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(cfg.sessionPath, 'utf8');
    const data = JSON.parse(raw);
    const cookie = data.cookies?.find(c => c.name === 'POS_SID');
    return cookie ? cookie.value : null;
  } catch (err) {
    return null;
  }
}

/**
 * Ensure valid VMS session cookie exists, performing login if missing or forced
 */
async function ensureVmsSessionCookie(options = {}) {
  const cfg = loadVmsConfig(options);
  const existingCookie = getStoredVmsSessionCookie(cfg);
  if (existingCookie && !options.forceRefresh) {
    return existingCookie;
  }

  console.log('[VMSAuth] Acquiring fresh VMS session cookie via headless login...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await performVmsLogin(page, context, cfg);
    return getStoredVmsSessionCookie(cfg);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

module.exports = {
  performVmsLogin,
  getAuthenticatedVmsPage,
  getStoredVmsSessionCookie,
  ensureVmsSessionCookie,
};
