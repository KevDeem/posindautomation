/**
 * OMS Authentication & Session Lifecycle Manager
 * 
 * Enforces fresh authentication on every execution run:
 * 1. Launches clean browser context without stale storageState interference.
 * 2. Navigates to OMS landing/login page.
 * 3. Enters and submits configured credentials via Playwright UI.
 * 4. Explicitly verifies authentication success and absence of login errors.
 * 5. Captures error screenshots on failure.
 * 6. Navigates to target shipping workflow and verifies required page elements.
 * 7. Supports single-sign-on batch caching (authenticates once per batch).
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, '.artifacts/screenshots');

function ensureScreenshotsDir() {
  if (!fs.existsSync(SCREENSHOTS_DIR)) {
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  }
}

async function captureScreenshot(page, prefix = 'auth_error') {
  try {
    ensureScreenshotsDir();
    const filepath = path.join(SCREENSHOTS_DIR, `${prefix}_${Date.now()}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    console.warn(`[Screenshot] Diagnostic screenshot captured: ${filepath}`);
    return filepath;
  } catch (err) {
    console.error(`[Screenshot] Failed to capture diagnostic screenshot:`, err.message);
    return null;
  }
}

/**
 * Perform a fresh UI login to the POSIND OMS application.
 * 
 * @param {import('playwright').Page} page
 * @param {import('playwright').BrowserContext} context
 * @param {Object} options
 * @param {string} [options.omsUrl]
 * @param {string} [options.username]
 * @param {string} [options.password]
 * @param {string} [options.sessionPath]
 * @returns {Promise<boolean>}
 */
async function performFreshLogin(page, context, options = {}) {
  const omsUrl = (options.omsUrl || 'https://sr-pos-oms-web.nisims.web.id').replace(/\/+$/, '');
  const username = options.username || process.env.OMS_USERNAME || 'kevin.d.imas@gmail.com';
  const password = options.password || process.env.OMS_PASSWORD || '@Admin123.';
  const sessionPath = options.sessionPath;

  console.log('[Authentication] Starting fresh OMS login...');

  // 1. Clear any existing cookies to avoid stale session interference
  if (context && typeof context.clearCookies === 'function') {
    await context.clearCookies().catch(() => {});
  }

  // 2. Navigate to OMS home/login
  try {
    await page.goto(omsUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1500);
  } catch (err) {
    await captureScreenshot(page, 'login_nav_failure');
    throw new Error(`[Authentication] Failed to load OMS URL ${omsUrl}: ${err.message}`);
  }

  // 3. Detect and open login form
  let emailInput = page.locator('input[placeholder*="email" i], input[type="email"], input[name*="email" i]').first();
  let passInput = page.locator('input[placeholder*="sandi" i], input[placeholder*="password" i], input[type="password"]').first();

  for (let attempt = 0; attempt < 3; attempt++) {
    if (await emailInput.isVisible().catch(() => false)) break;
    const masukBtn = page.locator('button:has-text("Masuk Sekarang"):visible, a:has-text("Masuk Sekarang"):visible').first()
      .or(page.getByRole('button', { name: /masuk sekarang/i }).first());

    if (await masukBtn.isVisible().catch(() => false)) {
      await masukBtn.click().catch(() => {});
      await page.waitForTimeout(1500);
    } else {
      await page.waitForTimeout(1000);
    }
  }

  // Re-verify form inputs
  try {
    await emailInput.waitFor({ state: 'visible', timeout: 15000 });
    await passInput.waitFor({ state: 'visible', timeout: 15000 });
    console.log('[Authentication] Login page detected.');
  } catch (err) {
    await captureScreenshot(page, 'login_form_missing');
    throw new Error(`[Authentication] Login form inputs not detected on ${page.url()}: ${err.message}`);
  }

  // 4. Fill credentials and submit
  await emailInput.fill(username);
  await page.waitForTimeout(200);
  await passInput.fill(password);
  await page.waitForTimeout(200);

  const submitBtn = page.locator('button.primary-btn:has-text("Masuk Sekarang"), button:has-text("Masuk Sekarang")').last()
    .or(page.getByRole('button', { name: /masuk sekarang|masuk|sign in/i }).last());

  await submitBtn.click();
  console.log('[Authentication] Credentials submitted.');

  // 5. Await response and check for error messages
  await page.waitForTimeout(2500);

  // Check for authentication error alerts
  const errorAlert = page.locator('.ant-message-error, .ant-notification-notice-error, .text-danger, p:has-text("Incorrect email or password")')
    .or(page.locator('[role="alert"]').filter({ hasText: /incorrect|gagal|salah|invalid/i }));

  if (await errorAlert.first().isVisible().catch(() => false)) {
    const errMsg = await errorAlert.first().innerText().catch(() => 'Incorrect credentials');
    await captureScreenshot(page, 'login_credentials_rejected');
    throw new Error(`[Authentication] Login failed: ${errMsg.trim().replace(/\n/g, ' ')}`);
  }

  // 6. Explicitly verify authenticated OMS session
  // Wait up to 10s for auth indicators: absence of Masuk Sekarang, presence of user avatar / GLID Bisnis / POS_SID cookie
  let isAuthenticated = false;
  const startTime = Date.now();
  while (Date.now() - startTime < 12000) {
    const cookies = context ? await context.cookies().catch(() => []) : [];
    const hasSidCookie = cookies.some(c => c.name === 'POS_SID' && c.value);
    const hasUserIndicator = await page.evaluate(() => {
      const headerText = document.querySelector('header, nav, body')?.innerText || '';
      const hasMasuk = /masuk sekarang/i.test(headerText);
      const hasUser = /glid bisnis|keluar|logout|profil/i.test(headerText) || !!document.querySelector('.avatar, [class*="avatar"]');
      return hasUser || !hasMasuk;
    }).catch(() => false);

    if (hasSidCookie || hasUserIndicator) {
      isAuthenticated = true;
      break;
    }
    await page.waitForTimeout(800);
  }

  if (!isAuthenticated) {
    await captureScreenshot(page, 'login_unverified');
    throw new Error('[Authentication] Authentication verification failed: OMS session not established after submitting credentials.');
  }

  console.log('[Authentication] Login successful.');
  console.log('[Authentication] Verified authenticated OMS session.');

  // Save session state to disk if path is provided
  if (sessionPath && context && typeof context.storageState === 'function') {
    try {
      const dir = path.dirname(sessionPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      await context.storageState({ path: sessionPath });
    } catch (_) {}
  }

  return true;
}

/**
 * Navigate to target workflow page and verify page elements.
 * 
 * @param {import('playwright').Page} page
 * @param {'domestic'|'international'} orderType
 * @param {Object} options
 * @returns {Promise<boolean>}
 */
async function navigateToShippingPage(page, orderType = 'domestic', options = {}) {
  const omsUrl = (options.omsUrl || 'https://sr-pos-oms-web.nisims.web.id').replace(/\/+$/, '');
  const isIntl = orderType === 'international';
  const targetUrl = isIntl ? `${omsUrl}/international-shipping` : `${omsUrl}/domestic-shipping`;
  const workflowName = isIntl ? 'International Shipping' : 'Domestic Shipping';

  console.log(`[Navigation] Opening ${workflowName}...`);

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(1500);
  } catch (err) {
    await captureScreenshot(page, 'nav_timeout');
    throw new Error(`[Navigation] Failed to navigate to ${targetUrl}: ${err.message}`);
  }

  // Verify page URL
  const currentUrl = page.url();
  const expectedPath = isIntl ? '/international-shipping' : '/domestic-shipping';

  if (!currentUrl.includes(expectedPath)) {
    // Redirected away, likely auth expired or unauthenticated
    await captureScreenshot(page, 'nav_redirect_failure');
    throw new Error(`[Authentication] Authentication expired mid-batch or session lost during navigation. Redirected to: ${currentUrl}`);
  }

  // Verify expected form elements exist
  const shipmentBtn = page.locator('button.shipment-title, button:has-text("Tambah Pengiriman")').first();
  const formElement = isIntl ? page.locator('#origin_country') : page.locator('#pickup_date');

  let elementReady = false;
  for (let i = 0; i < 5; i++) {
    if (await shipmentBtn.isVisible().catch(() => false) || await formElement.isVisible().catch(() => false)) {
      elementReady = true;
      break;
    }
    await page.waitForTimeout(600);
  }

  if (!elementReady) {
    await captureScreenshot(page, 'nav_elements_missing');
    throw new Error(`[Navigation] ${workflowName} page elements missing or page failed to load properly on ${currentUrl}.`);
  }

  console.log(`[Navigation] ${workflowName} page verified.`);
  return true;
}

module.exports = {
  performFreshLogin,
  navigateToShippingPage,
  captureScreenshot,
  SCREENSHOTS_DIR,
};
