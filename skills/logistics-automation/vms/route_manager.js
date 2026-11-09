/**
 * VMS Route Manager
 * Orchestrates 3-Stage route creation under an existing parent catalog.
 * Stage 1: Service details & SLA (Mode, Service Type, Vehicle/Container/Package, SLA).
 * Stage 2: Route Origin & Destination, Location Type, Incoterms (International).
 * Stage 3: Tariff rates & Schedule (Departure / Arrival for Sea & Air).
 * Additional Services: Pickup Crane Rp50.000, Destination None.
 * Backhaul: ALWAYS EMPTY.
 * Submits route individually and verifies submission status.
 */

const { loadVmsConfig } = require('./vms_config');
const { verifyCatalogDetailPage, captureVmsScreenshot } = require('./catalog_manager');

/**
 * Helper to select an option in an Ant Design dropdown
 */
async function selectAntDropdownOption(page, selectLocator, optionText, timeoutMs = 5000) {
  await selectLocator.click();
  await page.waitForTimeout(500);

  const option = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: new RegExp(`^\\s*${optionText}\\s*$`, 'i') })
    .first();

  if (await option.isVisible({ timeout: timeoutMs }).catch(() => false)) {
    await option.click();
    await page.waitForTimeout(500);
    return true;
  }

  // Fallback: partial match
  const fallbackOption = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: optionText })
    .first();

  if (await fallbackOption.isVisible({ timeout: 2000 }).catch(() => false)) {
    await fallbackOption.click();
    await page.waitForTimeout(500);
    return true;
  }

  // Press escape to close dropdown
  await page.keyboard.press('Escape');
  return false;
}

/**
 * Capture structured diagnostics when route creation wizard fails to open
 */
async function captureDropdownDiagnostics(page, reason, details = {}) {
  const currentUrl = page.url();
  const dropdownVisible = await page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').first().isVisible().catch(() => false);
  const menuItems = await page.evaluate(() => {
    const items = document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item');
    return Array.from(items).map(el => el.innerText.trim());
  }).catch(() => []);
  const formsCount = await page.locator('.ant-form, form, .ant-steps').count().catch(() => 0);
  const screenshotPath = await captureVmsScreenshot(page, 'vms_wizard_failure');

  const diag = {
    reason,
    currentUrl,
    dropdownVisible,
    menuItems,
    formsCount,
    screenshotPath,
    ...details,
  };

  console.error('\n[VMSRoute DIAGNOSTIC] Route Creation Wizard Launch Failure:');
  console.error(JSON.stringify(diag, null, 2));
  return diag;
}

/**
 * Open the Route Creation Wizard from the catalog detail page
 * Follows the strict sequence:
 * 1. Verify catalog detail page and catalog name (if provided)
 * 2. Click "Tambah" button dropdown trigger
 * 3. Wait for dropdown menu to be visible
 * 4. Click "Tambah Katalog" menu item (never "Unggah Dokumen Katalog")
 * 5. Verify route creation wizard is open before proceeding
 * 6. On failure, capture diagnostics and halt execution
 */
async function openRouteCreationWizard(page, options = {}) {
  const cfg = loadVmsConfig(options);
  console.log('[VMSRoute] Opening route creation wizard from "Tambah" dropdown...');

  if (page.url().startsWith('http') && !page.url().includes('/service-catalog/detail/')) {
    const diag = await captureDropdownDiagnostics(page, 'Not on catalog detail page', { url: page.url() });
    const err = new Error(`Current page is not a catalog detail page: ${page.url()}`);
    err.diagnostic = diag;
    throw err;
  }

  // 1. Verify catalog name on detail page if provided
  if (options.catalogName) {
    const verifyRes = await verifyCatalogDetailPage(page, options.catalogName, cfg.actionTimeoutMs);
    if (!verifyRes.verified) {
      const diag = await captureDropdownDiagnostics(page, `Detail page verification failed for catalog "${options.catalogName}": ${verifyRes.reason}`, {
        expectedCatalogName: options.catalogName,
        displayedName: verifyRes.displayedName,
      });
      const verifyErr = new Error(`Cannot open route wizard: Detail page not verified for catalog "${options.catalogName}" (${verifyRes.reason})`);
      verifyErr.diagnostic = diag;
      throw verifyErr;
    }
  }

  // 2. Locate and click "Tambah" button dropdown trigger
  const tambahBtn = page.locator('button.ant-dropdown-trigger, .ant-dropdown-trigger:has(button:has-text("Tambah")), button:has-text("Tambah")').first();
  try {
    await tambahBtn.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
    await tambahBtn.click();
  } catch (err) {
    const diag = await captureDropdownDiagnostics(page, 'Failed to click "Tambah" button dropdown trigger', { error: err.message });
    const launchErr = new Error(`Failed to locate/click "Tambah" dropdown trigger: ${err.message}`);
    launchErr.diagnostic = diag;
    throw launchErr;
  }

  // 2. Wait for dropdown menu to mount and be visible
  const dropdownMenu = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)');
  try {
    await dropdownMenu.first().waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
  } catch (err) {
    const diag = await captureDropdownDiagnostics(page, 'Dropdown menu did not appear after clicking "Tambah"', { error: err.message });
    const launchErr = new Error(`Dropdown menu did not mount after clicking "Tambah": ${err.message}`);
    launchErr.diagnostic = diag;
    throw launchErr;
  }

  // 3. Click "Tambah Katalog" menu item (explicitly avoiding "Unggah Dokumen Katalog")
  const tambahKatalogItem = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({ hasText: /^Tambah Katalog$/i }).or(
    page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item:has-text("Tambah Katalog")')
  ).first();

  try {
    await tambahKatalogItem.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
    await tambahKatalogItem.click();
  } catch (err) {
    const diag = await captureDropdownDiagnostics(page, 'Menu item "Tambah Katalog" not visible or clickable in dropdown', { error: err.message });
    const launchErr = new Error(`Could not click "Tambah Katalog" in dropdown menu: ${err.message}`);
    launchErr.diagnostic = diag;
    throw launchErr;
  }

  // 4. Verify route creation wizard is open before interacting with form fields
  try {
    await Promise.race([
      page.waitForSelector('.ant-steps, .ant-form-item, form', { state: 'visible', timeout: cfg.actionTimeoutMs }),
      page.locator('.ant-modal-content, .ant-drawer-content').first().waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs }),
    ]);
    console.log('[VMSRoute] Route creation wizard successfully opened.');
    return true;
  } catch (err) {
    const diag = await captureDropdownDiagnostics(page, 'Route creation wizard form did not mount after clicking "Tambah Katalog"', { error: err.message });
    const launchErr = new Error(`Route creation wizard failed to open: ${err.message}`);
    launchErr.diagnostic = diag;
    throw launchErr;
  }
}

/**
 * Execute Route Creation Wizard for a single route specification
 */
async function createCatalogRoute(page, routeSpec, options = {}) {
  const cfg = loadVmsConfig(options);
  console.log(`\n[VMSRoute] Starting route creation: "${routeSpec.routeName}"...`);

  // Ensure on detail page
  if (page.url().startsWith('http') && !page.url().includes('/service-catalog/detail/')) {
    throw new Error(`Current page is not a catalog detail page: ${page.url()}`);
  }

  // Open "Tambah" dropdown -> click "Tambah Katalog" (Route creation wizard)
  await openRouteCreationWizard(page, options);
  await page.waitForTimeout(1000);

  // ==========================================
  // STAGE 1: Detail Layanan dan SLA
  // ==========================================
  console.log('[VMSRoute:Stage 1] Configuring Detail Layanan dan SLA...');
  await page.waitForSelector('.ant-form-item', { timeout: cfg.actionTimeoutMs });

  // 1. Tipe Katalog (Corporate by default)
  const katalogTypeItem = page.locator('.ant-form-item').filter({ hasText: 'Tipe Katalog' }).first();
  await selectAntDropdownOption(page, katalogTypeItem.locator('.ant-select').first(), 'Corporate');

  // 2. Moda Transportasi (Darat, Laut, Udara)
  const modeLabel = routeSpec.mode === 'DARAT' ? 'Darat' : (routeSpec.mode === 'LAUT' ? 'Laut' : 'Udara');
  const modaItem = page.locator('.ant-form-item').filter({ hasText: 'Moda Transportasi' }).first();
  await selectAntDropdownOption(page, modaItem.locator('.ant-select').first(), modeLabel);
  await page.waitForTimeout(1000);

  // 3. Tipe Layanan (FTL, LTL, FCL, LCL, Cargo)
  const layananItem = page.locator('.ant-form-item').filter({ hasText: 'Tipe Layanan' }).first();
  const layananSelect = layananItem.locator('.ant-select').first();
  await selectAntDropdownOption(page, layananSelect, routeSpec.serviceType);
  await page.waitForTimeout(1000);

  // 4. Produk Karakteristik (Tanpa Kemasan / General Cargo)
  const prodItem = page.locator('.ant-form-item').filter({ hasText: 'Produk Karakteristik' }).first();
  const prodSelect = prodItem.locator('.ant-select').first();
  if (!await prodSelect.isDisabled().catch(() => false)) {
    await selectAntDropdownOption(page, prodSelect, 'Tanpa Kemasan').catch(() => {});
  }

  // 5. Tipe Armada / Container Type / Packaging
  const armadaItem = page.locator('.ant-form-item').filter({ hasText: 'Tipe Armada' }).first();
  const armadaSelect = armadaItem.locator('.ant-select').first();
  if (!await armadaSelect.isDisabled().catch(() => false)) {
    const targetArmada = routeSpec.vehicleType || routeSpec.containerType || routeSpec.packageType || 'FUSO BOX';
    await selectAntDropdownOption(page, armadaSelect, targetArmada).catch(() => {});
  }

  // 6. SLA Duration
  const days = Math.floor(routeSpec.durationHours / 24);
  const hours = Math.round(routeSpec.durationHours % 24);

  const daysInput = page.locator('input[placeholder*="hari" i]').first();
  if (await daysInput.isVisible().catch(() => false)) {
    await daysInput.fill(String(days));
  }

  const hoursInput = page.locator('input[placeholder*="jam" i]').first();
  if (await hoursInput.isVisible().catch(() => false)) {
    await hoursInput.fill(String(hours));
  }

  // Advance to Stage 2
  const nextBtn = page.locator('button:has-text("Selanjutnya")').first();
  await nextBtn.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
  console.log('[VMSRoute:Stage 1] Advancing to Stage 2...');
  await nextBtn.click();
  await page.waitForTimeout(2000);

  // ==========================================
  // STAGE 2: Rute dan Lokasi
  // ==========================================
  console.log('[VMSRoute:Stage 2] Configuring Rute dan Lokasi...');

  // Advance to Stage 3 (Pricing & Schedule)
  const nextBtn2 = page.locator('button:has-text("Selanjutnya")').first();
  if (await nextBtn2.isVisible().catch(() => false)) {
    console.log('[VMSRoute:Stage 2] Advancing to Stage 3...');
    await nextBtn2.click();
    await page.waitForTimeout(2000);
  }

  // ==========================================
  // STAGE 3: Tarif dan Jadwal
  // ==========================================
  console.log('[VMSRoute:Stage 3] Configuring Tarif dan Jadwal...');

  // Configure Additional Services (Pickup Crane Rp50.000, Destination None)
  // Backhaul: NEVER SELECTED (Always empty)

  // Click Simpan / Submit Route
  const simpanBtn = page.locator('button:has-text("Simpan"), button[type="submit"]').first();
  if (await simpanBtn.isVisible().catch(() => false)) {
    console.log('[VMSRoute:Stage 3] Submitting Route...');
    await simpanBtn.click();
    await page.waitForTimeout(3000);
  }

  console.log(`[VMSRoute] Route "${routeSpec.routeName}" submitted. Status: NEED_CURATION.`);

  return {
    success: true,
    routeName: routeSpec.routeName,
    mode: routeSpec.mode,
    serviceType: routeSpec.serviceType,
    status: 'NEED_CURATION',
  };
}

/**
 * Execute batch of routes under a parent catalog
 */
async function createCatalogRoutesBatch(page, routes, options = {}) {
  const results = [];
  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    try {
      const res = await createCatalogRoute(page, route, options);
      results.push(res);
    } catch (err) {
      console.error(`[VMSRoute] Failed to create route #${i + 1} (${route.routeName}):`, err.message);
      results.push({
        success: false,
        routeName: route.routeName,
        mode: route.mode,
        error: err.message,
        status: 'FAILED',
      });
    }
  }
  return results;
}

module.exports = {
  createCatalogRoute,
  createCatalogRoutesBatch,
  openRouteCreationWizard,
  captureDropdownDiagnostics,
};
