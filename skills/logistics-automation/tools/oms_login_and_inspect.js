#!/usr/bin/env node
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.sessions');
const ARTIFACTS_DIR = path.join(ROOT_DIR, '.artifacts/inspection');
const SESSION_FILE = path.join(SESSIONS_DIR, 'staging-oms_kevin_d_imas_gmail_com_session.json');

async function run() {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  if (!fs.existsSync(ARTIFACTS_DIR)) fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const username = process.env.OMS_USERNAME || 'kevin.d.imas@gmail.com';
  const password = process.env.OMS_PASSWORD || '@Admin123.';

  console.log('=== OMS Login & Order Form Inspector ===');
  console.log('Target Application: https://sr-pos-oms-web.nisims.web.id');
  console.log(`Username: ${username}`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  console.log('[1] Navigating to https://sr-pos-oms-web.nisims.web.id/login...');
  await page.goto('https://sr-pos-oms-web.nisims.web.id/login', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(async () => {
    console.log('[Info] /login redirect fallback, navigating to root...');
    await page.goto('https://sr-pos-oms-web.nisims.web.id/', { waitUntil: 'domcontentloaded' });
  });

  await page.waitForTimeout(2000);
  console.log(`Current URL: ${page.url()}`);

  // If on landing page and not on login page, look for login / masuk button
  if (!page.url().includes('/login') && !page.url().includes('/auth') && !page.url().includes('/signin')) {
    const loginLink = page.getByRole('link', { name: /masuk|login|sign in/i })
      .or(page.getByRole('button', { name: /masuk|login|sign in/i }))
      .or(page.locator('a[href*="login"], a[href*="auth"]').first());
    
    if (await loginLink.isVisible().catch(() => false)) {
      console.log('Clicking login link from navigation...');
      await loginLink.click();
      await page.waitForTimeout(2000);
      console.log(`Navigated to: ${page.url()}`);
    }
  }

  // Look for inputs
  console.log('[2] Locating login form inputs...');
  const userField = page.locator('input[type="email"], input[name*="user"], input[name*="email"], input[type="text"]').first();
  const passField = page.locator('input[type="password"]').first();
  const submitBtn = page.getByRole('button', { name: /masuk|login|sign in|submit/i })
    .or(page.locator('button[type="submit"], input[type="submit"]').first());

  const hasUserField = await userField.isVisible().catch(() => false);
  const hasPassField = await passField.isVisible().catch(() => false);

  if (hasUserField && hasPassField) {
    console.log('[3] Filling login credentials into form...');
    await userField.fill(username);
    await passField.fill(password);
    console.log('[4] Clicking login submit button...');
    await submitBtn.click();
    console.log('Awaiting navigation post-login...');
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);
    await page.waitForTimeout(3000);
  } else {
    console.log('[Info] Login fields not immediately detected on current page. Current URL:', page.url());
  }

  console.log(`Current page URL after login attempt: ${page.url()}`);

  // Save session storage state
  console.log(`[5] Saving authenticated session state to ${SESSION_FILE}...`);
  await context.storageState({ path: SESSION_FILE });

  // Navigate to International Shipping
  const targetUrl = 'https://sr-pos-oms-web.nisims.web.id/international-shipping';
  console.log(`[6] Navigating to ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(async () => {
    await page.waitForLoadState('domcontentloaded');
  });
  await page.waitForTimeout(3000);

  // If there is a button like "Buat Pengiriman" or "Create Shipment", click it or inspect
  console.log('[7] Inspecting International Shipping page...');
  const createBtn = page.getByRole('button', { name: /buat pengiriman|create shipment|order|pesan/i })
    .or(page.getByRole('link', { name: /buat pengiriman|create shipment|order|pesan/i }));

  if (await createBtn.first().isVisible().catch(() => false)) {
    console.log('Found Create Shipment / Buat Pengiriman button. Inspecting its target...');
  }

  // Take screenshot
  const timestamp = Date.now();
  const screenshotPath = path.join(ARTIFACTS_DIR, `oms_international_form_${timestamp}.png`);
  const jsonPath = path.join(ARTIFACTS_DIR, `oms_international_form_${timestamp}.json`);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  // Extract comprehensive DOM info
  const domInfo = await page.evaluate(() => {
    function clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }

    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
      .map(el => ({ tag: el.tagName.toLowerCase(), text: clean(el.innerText) }))
      .filter(h => h.text.length > 0);

    const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
      .map(el => clean(el.innerText || el.getAttribute('value') || el.getAttribute('aria-label')))
      .filter(Boolean);

    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]'))
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
          role: el.getAttribute('role') || undefined,
          value: el.value || undefined,
        };
      });

    return {
      title: document.title,
      url: window.location.href,
      headings,
      buttons: Array.from(new Set(buttons)),
      inputs,
    };
  });

  fs.writeFileSync(jsonPath, JSON.stringify(domInfo, null, 2), 'utf-8');
  console.log(`DOM inspection report saved to: ${jsonPath}`);
  console.log(`Total inputs/controls discovered: ${domInfo.inputs.length}`);
  console.log(`Buttons: ${domInfo.buttons.join(', ')}`);

  await browser.close();
}

run().catch(err => {
  console.error('[Error]', err);
  process.exit(1);
});
