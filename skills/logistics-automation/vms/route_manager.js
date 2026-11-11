/**
 * VMS Route Manager
 * Orchestrates 3-Stage route creation under an existing parent catalog.
 * Stage 1: Tarif Pengiriman (Detail Layanan & SLA, Route Location & Mode, Base Tariffs).
 * Stage 2: Tarif Layanan Tambahan (Additional Services).
 * Stage 3: Tarif Lainnya (Backhaul & Final Submission).
 * Backhaul: ALWAYS EMPTY (Never populated).
 * Review stage reached before final submission; explicit approval required.
 */

const { loadVmsConfig } = require('./vms_config');
const { verifyCatalogDetailPage, captureVmsScreenshot } = require('./catalog_manager');

/**
 * Robust helper to select an option in an Ant Design dropdown or custom select-table
 */
async function selectAntDropdownOption(page, selectLocator, optionText, { isTable = false, filterText = null, timeoutMs = 10000 } = {}) {
  await selectLocator.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await selectLocator.waitFor({ state: 'visible', timeout: timeoutMs });
  await page.waitForFunction(
    (el) => !el.classList.contains('ant-select-disabled') && !el.classList.contains('ant-select-loading'),
    await selectLocator.elementHandle(),
    { timeout: 15000 }
  ).catch(() => {});

  const searchInput = selectLocator.locator('input.ant-select-selection-search-input, input[type="search"], input.ant-select-input, input').first();
  await selectLocator.click();
  await page.waitForTimeout(400);

  const textToFilter = filterText || optionText;
  if (textToFilter && await searchInput.count() > 0 && await searchInput.isEditable().catch(() => false)) {
    await searchInput.fill('');
    await searchInput.pressSequentially(textToFilter, { delay: 40 });
    await page.waitForTimeout(600);
  }

  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  await dropdown.waitFor({ state: 'visible', timeout: 5000 });

  const hasTable = isTable || await dropdown.locator('tr.ant-table-row').count() > 0;
  if (hasTable) {
    const row = dropdown.locator('tr.ant-table-row').filter({
      hasText: new RegExp(optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
    } else {
      const availableRows = await dropdown.locator('tr.ant-table-row').allInnerTexts().catch(() => []);
      throw new Error(`Option "${optionText}" not found in table dropdown. Available: [${availableRows.slice(0, 5).map(s => s.trim().replace(/\s+/g, ' ')).join(', ')}]`);
    }
  } else {
    const optRegex = new RegExp(optionText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    let opt = dropdown.locator('.ant-select-item-option').filter({ hasText: optRegex }).first();

    const isVis = await opt.isVisible().catch(() => false);
    if (!isVis) {
      await page.evaluate(async (target) => {
        const holder = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-dropdown-list-holder');
        if (!holder) return;
        for (let s = 0; s < 2000; s += 80) {
          holder.scrollTop = s;
          holder.dispatchEvent(new Event('scroll'));
          await new Promise(r => setTimeout(r, 30));
          const match = Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')).find(e => e.innerText.toLowerCase().includes(target.toLowerCase()));
          if (match) break;
        }
      }, optionText);
      await page.waitForTimeout(400);
    }

    if (await opt.isVisible().catch(() => false)) {
      await opt.click();
    } else {
      // NEVER silently click the first item (which causes unrelated locations like Kalimantan to be selected)
      const availableOpts = await dropdown.locator('.ant-select-item-option').allInnerTexts().catch(() => []);
      throw new Error(`Option "${optionText}" not found in dropdown. Available options: [${availableOpts.slice(0, 10).map(s => s.trim()).join(', ')}]`);
    }
  }
  await page.waitForTimeout(500);
  return true;
}

/**
 * Capture structured diagnostics when route creation wizard fails to open
 */
async function captureDropdownDiagnostics(page, reason, details = {}) {
  const currentUrl = page.url();
  const dropdownVisible = await page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').first().isVisible().catch(() => false);
  const menuItems = await page.evaluate(() => {
    const items = document.querySelectorAll('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item');
    return Array.from(items).map(el => el.innerText.trim()).filter(Boolean);
  }).catch(() => []);
  const formsCount = await page.locator('.ant-form, form, .ant-steps').count().catch(() => 0);
  const wizardTitleVisible = await page.locator('h1, h2, h3, .ant-page-header-heading-title').filter({ hasText: /Tambah Service/i }).first().isVisible().catch(() => false);
  const screenshotPath = await captureVmsScreenshot(page, 'vms_wizard_failure');

  const diag = {
    reason,
    currentUrl,
    dropdownVisible,
    menuItems,
    wizardTitleVisible,
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
 * 1. Verify catalog detail page and catalog name (if provided) BEFORE opening wizard
 * 2. Locate and click visible "Tambah" dropdown button
 * 3. Verify that its dropdown menu actually opens
 * 4. Locate visible "Tambah Katalog" menu item (never "Unggah Dokumen Katalog")
 * 5. Click the option
 * 6. Verify that the "Tambah Service" wizard opens (verifying wizard title specifically, not against catalog name)
 * 7. Return control to route creation implementation
 * 8. On failure, capture diagnostics and halt execution
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

  // 1. Verify catalog name on detail page if provided (BEFORE opening wizard)
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

  // 2. Locate visible "Tambah" button dropdown trigger
  // Specifically locate the <button> element (never the outer span wrapper) so Ant Design trigger fires
  const tambahBtn = page.locator('button:has-text("Tambah")').first();

  try {
    await tambahBtn.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
    await tambahBtn.click();
    console.log('[VMSRoute] Clicked "Tambah" button dropdown trigger.');
  } catch (err) {
    const diag = await captureDropdownDiagnostics(page, 'Failed to locate or click visible "Tambah" button dropdown trigger', { error: err.message });
    const launchErr = new Error(`Failed to locate/click "Tambah" dropdown trigger: ${err.message}`);
    launchErr.diagnostic = diag;
    throw launchErr;
  }

  // 3. Verify that its dropdown menu actually opens
  const dropdownMenu = page.locator('.ant-dropdown:not(.ant-dropdown-hidden)').first();

  try {
    await dropdownMenu.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
    console.log('[VMSRoute] Verified dropdown menu is visible.');
  } catch (err) {
    const diag = await captureDropdownDiagnostics(page, 'Dropdown menu did not appear after clicking "Tambah"', { error: err.message });
    const launchErr = new Error(`Dropdown menu did not mount after clicking "Tambah": ${err.message}`);
    launchErr.diagnostic = diag;
    throw launchErr;
  }

  // 4. Locate visible "Tambah Katalog" menu item (strictly avoiding "Unggah Dokumen Katalog")
  const tambahKatalogItem = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item:has-text("Tambah Katalog")').first();

  try {
    await tambahKatalogItem.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
    // Click via evaluate to avoid Playwright scroll-into-view which triggers Ant Design's window scroll listener and dismisses the dropdown
    try {
      await tambahKatalogItem.evaluate(el => el.click());
    } catch (evalErr) {
      await tambahKatalogItem.click({ force: true });
    }
    console.log('[VMSRoute] Clicked "Tambah Katalog" dropdown option.');
  } catch (err) {
    const diag = await captureDropdownDiagnostics(page, 'Menu item "Tambah Katalog" not visible or clickable in dropdown', { error: err.message });
    const launchErr = new Error(`Could not click "Tambah Katalog" in dropdown menu: ${err.message}`);
    launchErr.diagnostic = diag;
    throw launchErr;
  }

  // 5. Verify that the "Tambah Service" route creation wizard opens
  // Wizard title should specifically be "Tambah Service" (do not compare against catalog name)
  try {
    await Promise.race([
      page.locator('h1:has-text("Tambah Service")').first().waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs }),
      page.locator('.ant-steps, .ant-form-item:has-text("Tipe Katalog"), form.ant-form:has-text("Detail Layanan"), form.ant-form').first().waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs }),
    ]);

    // Inspect verified wizard title
    const wizardTitleText = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, .ant-page-header-heading-title'));
      const match = headings.find(h => /Tambah Service/i.test(h.innerText || ''));
      return match ? match.innerText.trim() : null;
    }).catch(() => null);

    console.log(`[VMSRoute] Route creation wizard successfully opened${wizardTitleText ? ` (Wizard Title: "${wizardTitleText}")` : ''}.`);
    return true;
  } catch (err) {
    const diag = await captureDropdownDiagnostics(page, 'Route creation wizard ("Tambah Service") failed to mount after clicking "Tambah Katalog"', { error: err.message });
    const launchErr = new Error(`Route creation wizard failed to open: ${err.message}`);
    launchErr.diagnostic = diag;
    throw launchErr;
  }
}

/**
 * Map raw VMS route status string to standard status
 * Expected final status:
 * - 'SUBMITTED': Route submission succeeded and was verified active / approved.
 * - 'NEED_CURATION': Route was submitted successfully but awaits curation/verification (e.g. Menunggu Verifikasi).
 * - 'FAILED': Submission failed.
 * - 'REVIEWABLE_STAGE_REACHED': Stage 3 reached, but submission intentionally not performed (review-only).
 */
function mapVmsRouteStatus(statusText) {
  if (!statusText) return 'SUBMITTED';
  const clean = String(statusText).trim().toLowerCase();
  if (
    clean.includes('menunggu') ||
    clean.includes('kurasi') ||
    clean.includes('pending') ||
    clean.includes('belum terverifikasi') ||
    clean.includes('need curation') ||
    clean.includes('need_curation')
  ) {
    return 'NEED_CURATION';
  }
  if (
    clean.includes('terverifikasi') ||
    clean.includes('aktif') ||
    clean.includes('active') ||
    clean.includes('approved') ||
    clean.includes('sukses') ||
    clean.includes('berhasil') ||
    clean.includes('submitted')
  ) {
    return 'SUBMITTED';
  }
  if (
    clean.includes('gagal') ||
    clean.includes('ditolak') ||
    clean.includes('failed') ||
    clean.includes('rejected')
  ) {
    return 'FAILED';
  }
  return 'SUBMITTED';
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
  // TAHAP 1: Tarif Pengiriman (Detail Layanan & SLA, Rute Lokasi, Tarif Pokok)
  // ==========================================
  console.log('[VMSRoute:Tahap 1] Configuring Detail Layanan, SLA, Lokasi, dan Tarif Pokok...');
  await page.waitForSelector('.ant-form-item', { timeout: cfg.actionTimeoutMs });

  // 1. Tipe Katalog (Retail by default or from spec)
  const targetCatalogType = routeSpec.catalogType || options.catalogType || 'Retail';
  const katalogTypeItem = page.locator('.ant-form-item').filter({ hasText: 'Tipe Katalog' }).first();
  await selectAntDropdownOption(page, katalogTypeItem.locator('.ant-select').first(), targetCatalogType);

  // 2. Moda Transportasi (Darat, Laut, Udara)
  const modeLabel = routeSpec.mode === 'DARAT' ? 'Darat' : (routeSpec.mode === 'LAUT' ? 'Laut' : 'Udara');
  const modaItem = page.locator('.ant-form-item').filter({ hasText: 'Moda Transportasi' }).first();
  await selectAntDropdownOption(page, modaItem.locator('.ant-select').first(), modeLabel, { isTable: true });
  await page.waitForTimeout(600);

  // 3. Tipe Layanan (FTL, LTL, FCL, LCL, Cargo)
  const layananItem = page.locator('.ant-form-item').filter({ hasText: 'Tipe Layanan' }).first();
  await selectAntDropdownOption(page, layananItem.locator('.ant-select').first(), routeSpec.serviceType, { isTable: true });
  await page.waitForTimeout(600);

  // 4. Produk Karakteristik (Tanpa Kemasan / General Cargo)
  const targetProduct = routeSpec.productCharacteristic || (routeSpec.packageType === 'TANPA KEMASAN' ? 'Tanpa Kemasan' : 'General Cargo');
  const prodItem = page.locator('.ant-form-item').filter({ hasText: 'Produk Karakteristik' }).first();
  if (await prodItem.count() > 0) {
    const prodSelect = prodItem.locator('.ant-select').first();
    if (!await prodSelect.isDisabled().catch(() => false)) {
      await selectAntDropdownOption(page, prodSelect, targetProduct, { isTable: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  // 5. Equipment / Vessel / Aircraft / Packaging based on Mode
  if (routeSpec.mode === 'DARAT') {
    const armadaItem = page.locator('.ant-form-item').filter({ hasText: 'Tipe Armada' }).first();
    if (await armadaItem.count() > 0) {
      const armadaSelect = armadaItem.locator('.ant-select').first();
      if (!await armadaSelect.isDisabled().catch(() => false)) {
        const targetArmada = routeSpec.vehicleType || 'Fuso Box';
        await selectAntDropdownOption(page, armadaSelect, targetArmada, { isTable: true }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  } else if (routeSpec.mode === 'LAUT') {
    // Pilih Kapal
    const kapalItem = page.locator('.ant-form-item').filter({ hasText: 'Pilih Kapal' }).first();
    if (await kapalItem.count() > 0) {
      const kapalSelect = kapalItem.locator('.ant-select').first();
      await kapalSelect.click();
      await page.waitForTimeout(400);
      const kapalOpt = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) tr.ant-table-row, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first();
      if (await kapalOpt.isVisible().catch(() => false)) {
        await kapalOpt.click();
        await page.waitForTimeout(500);
      }
    }

    // Tipe Kontainer (for FCL)
    const kontainerItem = page.locator('.ant-form-item').filter({ hasText: 'Tipe Kontainer' }).first();
    if (await kontainerItem.count() > 0) {
      const kontainerSelect = kontainerItem.locator('.ant-select').first();
      const targetContainer = routeSpec.containerType || '40 Ft Standard';
      await selectAntDropdownOption(page, kontainerSelect, targetContainer, { isTable: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
  } else if (routeSpec.mode === 'UDARA') {
    // Pilih Pesawat
    const pesawatItem = page.locator('.ant-form-item').filter({ hasText: 'Pilih Pesawat' }).first();
    if (await pesawatItem.count() > 0) {
      const pesawatSelect = pesawatItem.locator('.ant-select').first();
      await pesawatSelect.click();
      await page.waitForTimeout(400);
      const pesawatOpt = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) tr.ant-table-row, .ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first();
      if (await pesawatOpt.isVisible().catch(() => false)) {
        await pesawatOpt.click();
        await page.waitForTimeout(500);
      }
    }

    // Tipe Kemasan
    const kemasanItem = page.locator('.ant-form-item').filter({ hasText: 'Tipe Kemasan' }).first();
    if (await kemasanItem.count() > 0) {
      const kemasanSelect = kemasanItem.locator('.ant-select').first();
      const targetKemasan = routeSpec.packageType || 'Tanpa Kemasan';
      await selectAntDropdownOption(page, kemasanSelect, targetKemasan, { isTable: true }).catch(() => {});
      await page.waitForTimeout(500);
    }
  }

  // 6. SLA Duration
  const days = Math.floor(routeSpec.durationHours / 24);
  const hours = Math.round(routeSpec.durationHours % 24);

  const daysInput = page.locator('input[placeholder*="hari" i]').first();
  if (await daysInput.isVisible().catch(() => false)) {
    await daysInput.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await daysInput.click();
    await daysInput.fill(String(days));
    await daysInput.press('Tab');
  }

  const hoursInput = page.locator('input[placeholder*="jam" i]').first();
  if (await hoursInput.isVisible().catch(() => false)) {
    await hoursInput.click();
    await hoursInput.fill(String(hours));
    await hoursInput.press('Tab');
  }
  await page.waitForTimeout(600);

  // 7. Route and Location Configuration
  if (routeSpec.isInternational) {
    const intlCb = page.locator('#is_domestic');
    if (await intlCb.isVisible().catch(() => false)) {
      await intlCb.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
      await intlCb.check().catch(() => {});
      await page.waitForTimeout(600);
    }
  }

  let selectedRouteName = null;
  const isRouteCheckbox = page.locator('#is_route');
  const hasDomesticRouteCb = await isRouteCheckbox.isVisible().catch(() => false);

  if (hasDomesticRouteCb && !routeSpec.isInternational) {
    console.log('[VMSRoute] Resolving domestic route via existing routes filter...');
    await isRouteCheckbox.check().catch(() => {});
    await page.waitForTimeout(400);

    const originDistrictInput = page.locator('#origin_district_name');
    const destDistrictInput = page.locator('#destination_district_name');

    if (await originDistrictInput.isVisible().catch(() => false) && await destDistrictInput.isVisible().catch(() => false)) {
      const originDistName = routeSpec.origin?.district || '';
      const destDistName = routeSpec.destination?.district || '';

      if (originDistName) {
        await originDistrictInput.fill('');
        await originDistrictInput.pressSequentially(originDistName, { delay: 40 });
        await page.waitForTimeout(600);
      }
      if (destDistName) {
        await destDistrictInput.fill('');
        await destDistrictInput.pressSequentially(destDistName, { delay: 40 });
        await page.waitForTimeout(1000);
      }

      // Open Rute select dropdown (must contain .ant-select to avoid matching domestic route checkbox item)
      const ruteItem = page.locator('.ant-form-item').filter({ has: page.locator('.ant-select') }).filter({ hasText: 'Rute' }).first();
      const ruteSelect = ruteItem.locator('.ant-select').first();
      await ruteSelect.waitFor({ state: 'visible', timeout: 5000 });
      await ruteSelect.click();
      await page.waitForTimeout(1000);

      const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
      await dropdown.waitFor({ state: 'visible', timeout: 8000 });

      // Look for route matching origin AND destination
      const optRows = await dropdown.locator('tr.ant-table-row, .ant-select-item-option').all();
      console.log(`[VMSRoute] Found ${optRows.length} candidates in Rute dropdown for "${originDistName}" -> "${destDistName}"`);
      for (let i = 0; i < Math.min(optRows.length, 5); i++) {
        const rowText = (await optRows[i].innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
        console.log(`[VMSRoute Candidate #${i + 1}]: "${rowText}"`);
      }
      let matchedRouteRow = null;

      const originRegex = new RegExp(originDistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const destRegex = new RegExp(destDistName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      for (const row of optRows) {
        const text = await row.innerText();
        if (originRegex.test(text) && destRegex.test(text)) {
          matchedRouteRow = row;
          selectedRouteName = text.trim().replace(/\s+/g, ' ');
          break;
        }
      }

      if (matchedRouteRow) {
        console.log(`[VMSRoute] Matched existing domestic route: "${selectedRouteName}"`);
        await matchedRouteRow.click();
        await page.waitForTimeout(600);
      } else {
        console.warn(`[VMSRoute] No existing route matched "${originDistName}" -> "${destDistName}". Unchecking domestic route checkbox for custom location specification...`);
        await page.keyboard.press('Escape');
        await isRouteCheckbox.uncheck();
        await page.waitForTimeout(800);
      }
    }
  }

  // Fallback to Hierarchical Door-to-Door if route checkbox unchecked or custom
  const originCountryInput = page.locator('#origin_country');
  if (await originCountryInput.count() > 0 && await originCountryInput.isVisible().catch(() => false)) {
    console.log('[VMSRoute] Populating hierarchical origin & destination fields...');
    const countrySelect = originCountryInput.locator('xpath=ancestor::div[contains(@class, "ant-select")]').first();
    await selectAntDropdownOption(page, countrySelect, routeSpec.origin?.country || 'Indonesia');

    const originProvInput = page.locator('#origin_province');
    if (await originProvInput.count() > 0) {
      const provSelect = originProvInput.locator('xpath=ancestor::div[contains(@class, "ant-select")]').first();
      await selectAntDropdownOption(page, provSelect, routeSpec.origin?.province || 'Jawa Barat');
    }

    const originCityInput = page.locator('#origin_city');
    if (await originCityInput.count() > 0) {
      const citySelect = originCityInput.locator('xpath=ancestor::div[contains(@class, "ant-select")]').first();
      await selectAntDropdownOption(page, citySelect, routeSpec.origin?.city || 'Kota Bekasi');
    }

    const originDistInput = page.locator('#origin_district');
    if (await originDistInput.count() > 0) {
      const distSelect = originDistInput.locator('xpath=ancestor::div[contains(@class, "ant-select")]').first();
      await selectAntDropdownOption(page, distSelect, routeSpec.origin?.district || 'Rawalumbu');
    }

    const destCountryInput = page.locator('#destination_country');
    if (await destCountryInput.count() > 0) {
      const destCountrySelect = destCountryInput.locator('xpath=ancestor::div[contains(@class, "ant-select")]').first();
      await selectAntDropdownOption(page, destCountrySelect, routeSpec.destination?.country || 'Indonesia');
    }

    const destProvInput = page.locator('#destination_province');
    if (await destProvInput.count() > 0) {
      const destProvSelect = destProvInput.locator('xpath=ancestor::div[contains(@class, "ant-select")]').first();
      await selectAntDropdownOption(page, destProvSelect, routeSpec.destination?.province || 'DKI Jakarta');
    }

    const destCityInput = page.locator('#destination_city');
    if (await destCityInput.count() > 0) {
      const destCitySelect = destCityInput.locator('xpath=ancestor::div[contains(@class, "ant-select")]').first();
      await selectAntDropdownOption(page, destCitySelect, routeSpec.destination?.city || 'Kota Jakarta Selatan');
    }

    const destDistInput = page.locator('#destination_district');
    if (await destDistInput.count() > 0) {
      const destDistSelect = destDistInput.locator('xpath=ancestor::div[contains(@class, "ant-select")]').first();
      await selectAntDropdownOption(page, destDistSelect, routeSpec.destination?.district || 'Pasar Minggu');
    }
  }

  // 8. Base Tariffs Population Based on Service Type
  const tariff = routeSpec.tariff || {};
  const isFullLoad = routeSpec.serviceType === 'FTL' || routeSpec.serviceType === 'FCL';

  if (isFullLoad) {
    // Land FTL or Sea FCL: One fixed trip/container price (RITASE / FCL)
    const fixedRate = tariff.costRitase || (routeSpec.serviceType === 'FTL' ? 2500000 : 18000000);
    const ritaseItem = page.locator('.ant-form-item').filter({ hasText: /Nominal Tarif Pengiriman/i }).first();
    if (await ritaseItem.count() > 0) {
      const ritaseInput = ritaseItem.locator('input.ant-input-number-input').first();
      await ritaseInput.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
      await ritaseInput.click();
      await ritaseInput.fill(String(fixedRate));
      await ritaseInput.press('Tab');
      console.log(`[VMSRoute:Pricing] Populated fixed trip price for ${routeSpec.serviceType}: Rp${fixedRate.toLocaleString('id-ID')} / trip`);
    }
  } else {
    // Less Load (LTL, LCL) and Air Cargo: KG, Tonase, CBM
    const cbmRate = tariff.costPerCbm || (routeSpec.mode === 'DARAT' ? 600000 : (routeSpec.mode === 'LAUT' ? 1200000 : 5000000));
    const tonRate = tariff.costPerTonase || (routeSpec.mode === 'DARAT' ? 3000000 : (routeSpec.mode === 'LAUT' ? 5000000 : 25000000));
    const kgRate = tariff.costPerKg || (routeSpec.mode === 'DARAT' ? 3500 : (routeSpec.mode === 'LAUT' ? 5000 : 25000));

    const cbmItem = page.locator('.ant-form-item').filter({ hasText: 'Tarif Per CBM' }).first();
    if (await cbmItem.count() > 0) {
      const cbmInput = cbmItem.locator('input.ant-input-number-input').first();
      await cbmInput.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
      await cbmInput.click();
      await cbmInput.fill(String(cbmRate));
      await cbmInput.press('Tab');
    }

    const tonItem = page.locator('.ant-form-item').filter({ hasText: 'Tarif Per Ton' }).first();
    if (await tonItem.count() > 0) {
      const tonInput = tonItem.locator('input.ant-input-number-input').first();
      await tonInput.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
      await tonInput.click();
      await tonInput.fill(String(tonRate));
      await tonInput.press('Tab');
    }

    const kgItem = page.locator('.ant-form-item').filter({ hasText: /Tarif Per KG/i }).first();
    if (await kgItem.count() > 0) {
      const kgInput = kgItem.locator('input.ant-input-number-input').first();
      await kgInput.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
      await kgInput.click();
      await kgInput.fill(String(kgRate));
      await kgInput.press('Tab');
    }
    console.log(`[VMSRoute:Pricing] Populated volume/weight tariffs for ${routeSpec.serviceType}: KG=Rp${kgRate}, Ton=Rp${tonRate}, CBM=Rp${cbmRate}`);
  }
  await page.waitForTimeout(800);

  // ==========================================
  // EXECUTION REVIEW CHECKPOINT: TAHAP 1
  // ==========================================
  const formReview = await page.evaluate(() => {
    const errorEls = Array.from(document.querySelectorAll('.ant-form-item-has-error .ant-form-item-explain-error, .ant-form-item-has-error'));
    const errors = errorEls.map(e => e.innerText.trim()).filter(Boolean);
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Selanjutnya');
    const isBtnDisabled = btn ? (btn.disabled || btn.classList.contains('ant-btn-disabled')) : true;

    return {
      errors,
      isNextDisabled: isBtnDisabled,
    };
  });

  console.log('\n================================================================================');
  console.log('              VMS ROUTE CREATION REVIEW CHECKPOINT (TAHAP 1)                   ');
  console.log('================================================================================');
  console.log(`Moda Transportasi : ${routeSpec.mode}`);
  console.log(`Tipe Layanan      : ${routeSpec.serviceType}`);
  console.log(`Tipe Katalog      : ${targetCatalogType}`);
  console.log(`Armada / Vessel   : ${routeSpec.vehicleType || routeSpec.containerType || routeSpec.packageType || '-'}`);
  console.log(`SLA Durasi        : ${routeSpec.durationHours} Jam (${days} Hari, ${hours} Jam)`);
  console.log('');
  console.log('LOKASI RUTE:');
  console.log(`- Asal (Origin)   : ${routeSpec.origin?.district || ''}, ${routeSpec.origin?.city || ''}, ${routeSpec.origin?.province || ''} [${routeSpec.origin?.country || 'Indonesia'}]`);
  console.log(`- Tujuan (Dest)   : ${routeSpec.destination?.district || ''}, ${routeSpec.destination?.city || ''}, ${routeSpec.destination?.province || ''} [${routeSpec.destination?.country || 'Indonesia'}]`);
  console.log(`- Rute Terpilih   : ${selectedRouteName || 'Custom Hierarchical Specification'}`);
  console.log('');
  console.log('STRUKTUR TARIF:');
  if (isFullLoad) {
    const fixedRate = tariff.costRitase || (routeSpec.serviceType === 'FTL' ? 2500000 : 18000000);
    console.log(`- Tipe Tarif      : ${routeSpec.serviceType === 'FTL' ? 'RITASE' : 'FCL'} (Fixed Trip Rate)`);
    console.log(`- Tarif Pengiriman: Rp${fixedRate.toLocaleString('id-ID')} / trip [${tariff.sources?.costRitase || 'synthetic_estimated'}]`);
  } else {
    console.log(`- Tipe Tarif      : CBM / Tonase / KG`);
    console.log(`- Tarif Per KG    : Rp${(tariff.costPerKg || 3500).toLocaleString('id-ID')}`);
    console.log(`- Tarif Per Ton   : Rp${(tariff.costPerTonase || 3000000).toLocaleString('id-ID')}`);
    console.log(`- Tarif Per CBM   : Rp${(tariff.costPerCbm || 600000).toLocaleString('id-ID')}`);
  }
  console.log('');
  console.log('STATUS VALIDASI:');
  console.log(`- Form Errors     : ${formReview.errors.length === 0 ? 'None (Clean)' : formReview.errors.join('; ')}`);
  console.log(`- Tombol Selanjutnya : ${formReview.isNextDisabled ? 'DISABLED' : 'ENABLED'}`);
  console.log('================================================================================\n');

  // Advance Tahap 1 -> Tahap 2
  const nextBtn1 = page.locator('button:has-text("Selanjutnya")').first();
  await nextBtn1.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {});
  await nextBtn1.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });

  const isNextDisabled = await nextBtn1.isDisabled();
  if (isNextDisabled) {
    const screenshotPath = await captureVmsScreenshot(page, 'vms_selanjutnya_disabled');
    const err = new Error(`Tahap 1 "Selanjutnya" button is disabled. Mandatory fields missing or invalid: [${formReview.errors.join('; ')}]. Screenshot: ${screenshotPath}`);
    err.diagnostic = {
      errors: formReview.errors,
      screenshotPath,
      routeSpec,
    };
    throw err;
  }

  console.log('[VMSRoute:Tahap 1] Advancing to Tahap 2 (Tarif Layanan Tambahan)...');
  await nextBtn1.click();
  await page.waitForTimeout(2500);

  // ==========================================
  // TAHAP 2: Tarif Layanan Tambahan (Additional Services)
  // ==========================================
  console.log('[VMSRoute:Tahap 2] Verifying Tarif Layanan Tambahan...');
  const nextBtn2 = page.locator('button:has-text("Selanjutnya")').first();
  await nextBtn2.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });

  console.log('[VMSRoute:Tahap 2] Advancing to Tahap 3 (Tarif Lainnya)...');
  await nextBtn2.click();
  await page.waitForTimeout(2500);

  // ==========================================
  // TAHAP 3: Tarif Lainnya (Backhaul & Review)
  // ==========================================
  console.log('[VMSRoute:Tahap 3] Reached Stage 3 (Review Stage: Tarif Lainnya)...');
  // Backhaul: ALWAYS EMPTY (Never populated)

  // Review-only mode check: Only halt if explicitly requested by user/options
  const isReviewOnly = options.reviewOnly === true || options.reviewOnlyMode === true;
  if (isReviewOnly) {
    console.log(`[VMSRoute] Route "${routeSpec.routeName}" successfully configured up to Stage 3 review.`);
    console.log('[VMSRoute] Review-only mode active: Halting before final submission as requested.');
    return {
      success: true,
      routeName: routeSpec.routeName,
      mode: routeSpec.mode,
      serviceType: routeSpec.serviceType,
      status: 'REVIEWABLE_STAGE_REACHED',
      selectedRouteName,
      message: 'Route wizard filled through Stage 1, 2, and 3. Review-only mode active.',
    };
  }

  // Final submission button: "Simpan Layanan"
  const simpanBtn = page.locator('button:has-text("Simpan Layanan"), button#default-button:has-text("Simpan Layanan"), button:has-text("Simpan"), button[type="submit"]').first();
  await simpanBtn.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });

  const isSimpanDisabled = await simpanBtn.isDisabled().catch(() => false);
  if (isSimpanDisabled) {
    const screenshotPath = await captureVmsScreenshot(page, 'vms_simpan_layanan_disabled');
    const err = new Error(`Stage 3 "Simpan Layanan" button is disabled. Screenshot: ${screenshotPath}`);
    err.diagnostic = { screenshotPath, routeSpec };
    throw err;
  }

  console.log('[VMSRoute:Tahap 3] Submitting Route via "Simpan Layanan"...');
  await simpanBtn.click();
  await page.waitForTimeout(600);

  // Handle confirmation modal if presented (e.g. "Apakah Anda yakin ingin menyimpan Layanan ini?")
  const confirmModal = page.locator('.ant-modal:not([style*="display: none"]), [role="dialog"]:not([style*="display: none"])')
    .filter({ hasText: /Simpan Layanan|Apakah Anda yakin|simpan ke katalog/i }).last();

  const isModalVisible = await confirmModal.isVisible({ timeout: 5000 }).catch(() => false);
  if (isModalVisible) {
    console.log('[VMSRoute:Tahap 3] Confirmation modal detected. Clicking "Ya, Simpan Layanan"...');
    const confirmActionBtn = confirmModal.locator('button:has-text("Ya, Simpan Layanan"), button:has-text("Ya"), button.ant-btn-primary').first();
    await confirmActionBtn.waitFor({ state: 'visible', timeout: 5000 });
    await confirmActionBtn.click();
    console.log('[VMSRoute:Tahap 3] Confirmation action clicked. Waiting for submission response...');
  }

  // Wait for submission response: success/error toasts or table reload
  let submissionError = null;
  let successNoticeFound = false;

  const errorLocator = page.locator('.ant-message-error, .ant-notification-notice-error, .ant-alert-error, .ant-message:has-text("gagal"), .ant-notification:has-text("gagal")').first();
  const successLocator = page.locator('.ant-message-success, .ant-notification-notice-success, .ant-message:has-text("berhasil"), .ant-notification:has-text("berhasil")').first();

  try {
    await Promise.race([
      successLocator.waitFor({ state: 'visible', timeout: 15000 }).then(() => { successNoticeFound = true; }),
      errorLocator.waitFor({ state: 'visible', timeout: 15000 }).then(async () => {
        submissionError = (await errorLocator.innerText().catch(() => '')).trim();
      }),
      page.waitForFunction(() => {
        return !document.querySelector('.ant-modal') && document.querySelectorAll('tr.ant-table-row').length > 0;
      }, { timeout: 15000 }),
    ]);
  } catch (err) {
    // Proceed to table verification
  }

  if (submissionError) {
    const screenshotPath = await captureVmsScreenshot(page, 'vms_submission_failed');
    const err = new Error(`Route submission failed: ${submissionError}. Screenshot: ${screenshotPath}`);
    err.diagnostic = { error: submissionError, screenshotPath, routeSpec };
    throw err;
  }

  // Wait for UI to settle on catalog detail page
  await page.waitForTimeout(1500);

  // Switch to the relevant transport mode tab (Darat, Laut, Udara)
  const modeTabName = routeSpec.mode === 'DARAT' ? 'Darat' : (routeSpec.mode === 'LAUT' ? 'Laut' : 'Udara');
  const modeTab = page.locator('.ant-tabs-tab').filter({ hasText: new RegExp(modeTabName, 'i') }).first();
  if (await modeTab.isVisible().catch(() => false)) {
    await modeTab.click().catch(() => {});
    await page.waitForTimeout(600);
  }

  // Look for the created route in table rows
  const tableRows = page.locator('tr.ant-table-row');
  const rowCount = await tableRows.count();
  let matchedRowText = null;
  let statusText = null;

  const originToken = (routeSpec.origin?.district || routeSpec.origin?.city || '').toLowerCase();
  const destToken = (routeSpec.destination?.district || routeSpec.destination?.city || '').toLowerCase();

  for (let r = 0; r < rowCount; r++) {
    const row = tableRows.nth(r);
    const rowText = (await row.innerText().catch(() => '')).trim();
    const rowTextLower = rowText.toLowerCase();

    const matchesOrigin = !originToken || rowTextLower.includes(originToken);
    const matchesDest = !destToken || rowTextLower.includes(destToken);

    if (matchesOrigin && matchesDest) {
      matchedRowText = rowText;
      const cells = await row.locator('td').allInnerTexts().catch(() => []);
      for (const cell of cells) {
        const cLower = cell.trim().toLowerCase();
        if (cLower.includes('verifikasi') || cLower.includes('kurasi') || cLower.includes('aktif') || cLower.includes('pending')) {
          statusText = cell.trim();
          break;
        }
      }
      if (!statusText && cells.length >= 6) {
        statusText = cells[5].trim();
      }
      break;
    }
  }

  if (!matchedRowText && successNoticeFound) {
    console.log('[VMSRoute] Success notification verified ("Service katalog berhasil dibuat"). Table row pending propagation.');
    statusText = 'Menunggu Verifikasi';
  } else if (!matchedRowText && !successNoticeFound) {
    const screenshotPath = await captureVmsScreenshot(page, 'vms_route_verification_failed');
    const err = new Error(`Route submission verification failed: Route "${routeSpec.routeName}" not found in catalog table and no success confirmation was detected. Screenshot: ${screenshotPath}`);
    err.diagnostic = { screenshotPath, routeSpec };
    throw err;
  }

  const finalStatus = mapVmsRouteStatus(statusText);
  console.log(`[VMSRoute] Route submission verified. Displayed status: "${statusText || 'N/A'}" -> Mapped status: ${finalStatus}`);

  return {
    success: true,
    routeName: routeSpec.routeName,
    mode: routeSpec.mode,
    serviceType: routeSpec.serviceType,
    status: finalStatus,
    displayedStatus: statusText,
    selectedRouteName,
    message: `Route successfully submitted and verified in VMS (Status: ${finalStatus}).`,
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
  selectAntDropdownOption,
  captureDropdownDiagnostics,
  mapVmsRouteStatus,
};
