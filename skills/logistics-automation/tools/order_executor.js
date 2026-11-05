/**
 * Reusable General Order Execution Engine for POSIND Logistics Automation
 * 
 * Responsibilities:
 * 1. Interface: `executeOrder(specification, options)`
 * 2. Accepts dynamic specification, resolves granular defaults and policies.
 * 3. Dispatches to Domestic or International UI workflow based on `orderType`.
 * 4. Enforces global Non-Contract ordering policy.
 * 5. Handles full UI interaction:
 *    - Pickup & Dropoff location entries
 *    - Schedule date/time selection
 *    - Cargo manifest & packaging linkage
 *    - Service catalog discovery & selection
 *    - HALTS immediately if no applicable service catalog exists (No automatic inquiry fallback).
 * 6. Form submission and dynamic extraction of Order ID, Shipment ID, and Total Cost.
 * 7. Structured return data:
 *    `{ success, orderId, shipmentId, amount, serviceCatalog, status, error, spec }`
 * 8. Never hardcodes routes, dates, cargo, PICs, order IDs, or amounts.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const {
  resolveSpecification,
  savePreviousSpecification,
  formatSpecificationReview,
} = require('./order_specification');
const {
  performFreshLogin,
  navigateToShippingPage,
  captureScreenshot,
} = require('./auth_manager');

const DEFAULT_SESSION_PATH = path.resolve(__dirname, '../../../.sessions/staging-oms_kevin_d_imas_gmail_com_session.json');

/**
 * Normalize location search term (strip formal administrative prefixes for Ant Design search)
 */
function getSearchTerm(val) {
  if (!val) return '';
  let str = String(val).trim();
  str = str.replace(/^(DKI|Daerah Khusus Ibukota)\s+/i, '');
  str = str.replace(/^(Kota|Kabupaten|Kab\.?)\s+/i, '');
  return str.trim();
}

/**
 * Robust helper to select an option in an Ant Design dropdown with network suggestion waiting
 * and verification.
 */
async function selectAntLocationOption(page, dialog, fieldId, searchTerm, matchRegex, options = {}) {
  const input = dialog.locator(`#${fieldId}`);
  const container = dialog.locator(`.ant-select:has(#${fieldId})`).first();

  await container.waitFor({ state: 'visible', timeout: 15000 });

  // 1. Wait until enabled (disabled class removed)
  const isCurrentlyDisabled = await container.evaluate(el => el.classList.contains('ant-select-disabled'));
  if (isCurrentlyDisabled) {
    console.log(`[OrderExecutor] Waiting for #${fieldId} to become enabled...`);
    await page.waitForFunction(
      el => !el.classList.contains('ant-select-disabled'),
      await container.elementHandle(),
      { timeout: 15000 }
    );
    await page.waitForTimeout(300);
  }

  // 2. Click to open dropdown
  await container.click();
  await page.waitForTimeout(300);

  // 3. Type search term using pressSequentially if provided
  let query = searchTerm ? getSearchTerm(searchTerm) : '';
  if (/jakarta/i.test(query)) query = 'Jakarta';
  if (/surabaya/i.test(query)) query = 'Surabaya';
  if (/cirebon/i.test(query)) query = 'Cirebon';
  if (/tegal/i.test(query)) query = 'Tegal';

  if (query && String(query).trim() !== '') {
    await input.click();
    await input.fill('');
    await input.pressSequentially(query, { delay: 60 });
    await page.waitForTimeout(600);
  }

  // 4. Locate active dropdown
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  await dropdown.waitFor({ state: 'visible', timeout: 10000 });

  // 5. Check loading / empty results distinctly
  const hasEmpty = await dropdown.locator('.ant-empty').isVisible().catch(() => false);
  if (hasEmpty && !options.fallbackFirst) {
    throw new Error(`Autocomplete search for "${query}" on #${fieldId} returned no results (ant-empty).`);
  }

  // Wait for network-backed options to populate
  await page.waitForFunction(d => {
    return d.querySelectorAll('.ant-select-item-option').length > 0;
  }, await dropdown.elementHandle(), { timeout: 10000 }).catch(() => {});

  const optionCount = await dropdown.locator('.ant-select-item-option').count();
  if (optionCount === 0) {
    throw new Error(`No selectable options found in dropdown for #${fieldId} (query: "${query}").`);
  }

  // 6. Select matching option
  let targetOption;
  if (matchRegex) {
    targetOption = dropdown.locator('.ant-select-item-option').filter({ hasText: matchRegex }).first();
    const count = await targetOption.count();
    if (count === 0) {
      const available = await dropdown.locator('.ant-select-item-option').evaluateAll(els => els.map(e => e.innerText.trim()));
      if (options.fallbackFirst && available.length > 0) {
        console.warn(`[OrderExecutor] Exact match for ${matchRegex} not found on #${fieldId}, using first available: "${available[0]}"`);
        targetOption = dropdown.locator('.ant-select-item-option').first();
      } else {
        throw new Error(`No option matching "${matchRegex}" found on #${fieldId}. Available: ${available.slice(0, 8).join(', ')}`);
      }
    }
  } else {
    targetOption = dropdown.locator('.ant-select-item-option').first();
  }

  const selectedOptionText = (await targetOption.innerText()).trim();
  await targetOption.click();
  await page.waitForTimeout(500);

  // 7. Verify selection updated in container
  const containerText = await container.innerText();
  console.log(`[OrderExecutor] #${fieldId} selected: "${selectedOptionText}" (display: "${containerText.replace(/\n/g, ' ')}")`);
  return selectedOptionText;
}

/**
 * Container-based Ant Design select helper (used in International order UI)
 */
async function selectAntOption(page, containerLocator, rawText, matchRegex) {
  await containerLocator.click();
  await page.waitForTimeout(400);

  const searchText = getSearchTerm(rawText);
  if (searchText) {
    const input = containerLocator.locator('input');
    if (await input.count() > 0) {
      await input.fill(searchText);
      await page.waitForTimeout(600);
    }
  }

  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  await dropdown.waitFor({ state: 'visible', timeout: 10000 });

  let option;
  if (matchRegex) {
    option = dropdown.locator('.ant-select-item-option').filter({ hasText: matchRegex }).first();
  } else {
    option = dropdown.locator('.ant-select-item-option').first();
  }

  await option.waitFor({ state: 'visible', timeout: 10000 });
  await option.click();
  await page.waitForTimeout(600);
}

/**
 * Step 3: Service Catalog Discovery & Selection
 * 
 * Handles State A (Selectable service cards available) and State B (Explicit unavailable notice).
 * Verifies workflow advancement to Step 4.
 */
async function handleServiceCatalogStep3(page, spec, name = 'Domestic Order', result = {}) {
  console.log(`[${name}] [ServiceCatalog] Entering Step 3: Pilih Layanan...`);

  const simpanLayananBtn = page.getByRole('button', { name: /simpan pilihan layanan/i })
    .or(page.locator('button:has-text("Simpan Pilihan Layanan")')).first();

  try {
    await simpanLayananBtn.waitFor({ state: 'attached', timeout: 25000 });
  } catch (err) {
    throw new Error(`[UI Detection Error] 'Simpan Pilihan Layanan' button not found at Step 3: ${err.message}`);
  }

  // Wait for loading indicators to detach
  await page.locator('.ant-spin-spinning, .ant-skeleton').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);

  // Selectors for State A (Selectable Service Cards) and State B (Explicit Unavailable State)
  const cardLocator = page.locator('.ant-card, [class*="card"]')
    .filter({ hasText: /PENGIRIMAN TERBAIK|LTL|FTL|Estimasi|Rp\s*[0-9]/i })
    .or(page.locator('div.border, div.rounded, div[role="radio"]').filter({ hasText: /Rp\s*[0-9]/i }));

  const unavailableNotice = page.locator('text=/Maaf,\\s*layanan belum tersedia/i')
    .or(page.locator('text=/layanan belum tersedia/i'))
    .or(page.getByRole('button', { name: /ajukan quotation layanan/i }))
    .or(page.locator('button:has-text("Ajukan Quotation Layanan")'));

  let detectedState = null; // 'AVAILABLE' | 'UNAVAILABLE'
  const pollStart = Date.now();

  while (Date.now() - pollStart < 15000) {
    if (await cardLocator.first().isVisible().catch(() => false)) {
      detectedState = 'AVAILABLE';
      break;
    }
    if (await unavailableNotice.first().isVisible().catch(() => false)) {
      detectedState = 'UNAVAILABLE';
      break;
    }
    await page.waitForTimeout(400);
  }

  const pickupCity = spec?.pickup?.city || 'Origin';
  const dropoffCity = spec?.dropoff?.city || 'Destination';

  if (detectedState === 'UNAVAILABLE') {
    console.warn(`[${name}] [ServiceCatalog] Explicit unavailable state detected: 'Maaf, layanan belum tersedia.'`);
    throw new Error(`No applicable Service Catalog found for domestic route ${pickupCity} -> ${dropoffCity}. Staging OMS confirmed unavailable: 'Maaf, layanan belum tersedia'. Stopped per policy (no quotation/inquiry fallback).`);
  }

  if (detectedState !== 'AVAILABLE') {
    throw new Error(`[UI Detection Error] Neither selectable service cards nor explicit unavailable state ('Maaf, layanan belum tersedia') detected at Step 3 for route ${pickupCity} -> ${dropoffCity}.`);
  }

  // State A: Service Catalog Available
  const cardCount = await cardLocator.count();
  console.log(`[${name}] [ServiceCatalog] Detected ${cardCount} selectable service card(s):`);

  for (let i = 0; i < cardCount; i++) {
    const cardText = (await cardLocator.nth(i).innerText().catch(() => '')).trim().replace(/\s+/g, ' ');
    console.log(`[${name}] [ServiceCatalog] Card #${i + 1}: ${cardText}`);
  }

  // Match preference or default to PENGIRIMAN TERBAIK / first available
  const catalogPref = spec?.serviceCatalogPreference && spec.serviceCatalogPreference !== 'auto'
    ? spec.serviceCatalogPreference
    : null;

  let selectedCard = null;
  let selectedCatalogName = null;

  if (catalogPref) {
    const prefCard = cardLocator.filter({ hasText: new RegExp(catalogPref, 'i') }).first();
    if (await prefCard.isVisible().catch(() => false)) {
      selectedCard = prefCard;
      selectedCatalogName = catalogPref;
    }
  }

  if (!selectedCard) {
    const bestCard = cardLocator.filter({ hasText: /PENGIRIMAN TERBAIK/i }).first();
    if (await bestCard.isVisible().catch(() => false)) {
      selectedCard = bestCard;
    } else {
      selectedCard = cardLocator.first();
    }
  }

  await selectedCard.click();
  await page.waitForTimeout(500);

  const fullCardText = (await selectedCard.innerText().catch(() => '')).trim();
  const firstLine = fullCardText.split('\n')[0].trim();
  selectedCatalogName = selectedCatalogName || firstLine || 'LTL (Standard)';
  result.serviceCatalog = selectedCatalogName;
  console.log(`[${name}] [ServiceCatalog] Selected card: ${selectedCatalogName}`);

  // Confirm Simpan Pilihan Layanan button is enabled and click
  if (!await simpanLayananBtn.isEnabled()) {
    await selectedCard.click().catch(() => {});
    await page.waitForTimeout(500);
  }

  if (!await simpanLayananBtn.isEnabled()) {
    throw new Error(`[ServiceCatalog] 'Simpan Pilihan Layanan' button remained disabled after card selection for ${pickupCity} -> ${dropoffCity}.`);
  }

  console.log(`[${name}] [ServiceCatalog] Clicking 'Simpan Pilihan Layanan'...`);
  await simpanLayananBtn.click();
  await page.waitForTimeout(1500);

  // Verify workflow advances to Step 4 (Ringkasan Pengiriman)
  const step4ShipmentBtn = page.getByRole('button', { name: /simpan shipment/i }).first()
    .or(page.locator('button:has-text("Simpan Shipment")').first());

  try {
    await step4ShipmentBtn.waitFor({ state: 'visible', timeout: 15000 });
    console.log(`[${name}] [ServiceCatalog] Workflow successfully advanced to Step 4 (Ringkasan Pengiriman).`);
  } catch (advErr) {
    throw new Error(`[ServiceCatalog] Workflow failed to advance to Step 4 after selecting service catalog: ${advErr.message}`);
  }

  return selectedCatalogName;
}

/**
 * Domestic Order UI Execution
 */
async function executeDomesticOrderUI(page, spec, options = {}) {
  const result = {
    orderId: null,
    shipmentId: null,
    amount: null,
    serviceCatalog: null,
    status: 'IN_PROGRESS',
    error: null,
  };

  const name = options.transactionLabel || 'Domestic Order';
  await navigateToShippingPage(page, 'domestic', options);

  // 1. Page Readiness & Pickup Date Input Detection
  const dateInputLocator = page.locator('#pickup_date, input[placeholder*="Pilih Tanggal"]');
  if (!await dateInputLocator.isVisible()) {
    const addShipmentBtn = page.locator('button.shipment-title, button:has-text("Tambah Pengiriman")').first();
    await addShipmentBtn.waitFor({ state: 'visible', timeout: 30000 });

    let dateVisible = false;
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (await dateInputLocator.isVisible()) {
        dateVisible = true;
        break;
      }
      console.log(`[${name}] Clicking Tambah Pengiriman (Attempt ${attempt}/4)...`);
      await addShipmentBtn.click({ force: true }).catch(() => {});
      try {
        await dateInputLocator.waitFor({ state: 'visible', timeout: 3500 });
        dateVisible = true;
        break;
      } catch (err) {
        await page.waitForTimeout(800);
      }
    }

    if (!dateVisible) {
      const buttonsOnPage = await page.locator('button').allInnerTexts().catch(() => []);
      const inputsOnPage = await page.locator('input').evaluateAll(els => els.map(e => e.id || e.placeholder)).catch(() => []);
      console.error(`[${name}] DIAGNOSTIC: date input not found. Visible buttons: ${buttonsOnPage.slice(0, 10).join(', ')}. Inputs: ${inputsOnPage.slice(0, 10).join(', ')}`);
      throw new Error('Pickup date selector (#pickup_date) could not be located after clicking Tambah Pengiriman.');
    }
  }

  await page.waitForTimeout(400);

  // 1. Pickup Date & Time
  const dateParts = spec.scheduledDate.split('-'); // [YYYY, MM, DD]
  const yearStr = dateParts[0];
  const dayStr = String(parseInt(dateParts[2], 10));
  const monthRegexes = [
    /^(Jan|Januari|January)$/i,
    /^(Feb|Februari|February)$/i,
    /^(Mar|Maret|March)$/i,
    /^(Apr|April)$/i,
    /^(Mei|May)$/i,
    /^(Jun|Juni|June)$/i,
    /^(Jul|Juli|July)$/i,
    /^(Agt|Aug|Agustus|August)$/i,
    /^(Sep|September)$/i,
    /^(Okt|Oct|Oktober|October)$/i,
    /^(Nov|November)$/i,
    /^(Des|Dec|Desember|December)$/i,
  ];
  const monthRegex = monthRegexes[parseInt(dateParts[1], 10) - 1] || /^(Des|Dec)$/i;

  const timeParts = (spec.scheduledTime || '10:00').split(':');
  const hourStr = timeParts[0];
  const minStr = timeParts[1] || '00';

  console.log(`[${name}] Setting date: ${spec.scheduledDate} ${spec.scheduledTime}...`);
  await page.locator('#pickup_date').click();
  await page.waitForTimeout(500);

  const yearBtn = page.locator('.ant-picker-year-btn').first();
  if (await yearBtn.isVisible()) {
    await yearBtn.click();
    await page.waitForTimeout(300);
    await page.locator('.ant-picker-cell-in-view').filter({ hasText: new RegExp(`^${yearStr}$`) }).first().click();
    await page.waitForTimeout(300);
    await page.locator('.ant-picker-cell-in-view').filter({ hasText: monthRegex }).first().click();
    await page.waitForTimeout(300);
  }

  await page.locator('.ant-picker-cell-in-view:not(.ant-picker-cell-disabled)').filter({ hasText: new RegExp(`^${dayStr}$`) }).first().click();
  await page.waitForTimeout(300);

  const hourCell = page.locator('.ant-picker-time-panel-column').first().locator('.ant-picker-time-panel-cell').filter({ hasText: new RegExp(`^${hourStr}$`) });
  if (await hourCell.count() > 0) await hourCell.first().click();

  const minCell = page.locator('.ant-picker-time-panel-column').nth(1).locator('.ant-picker-time-panel-cell').filter({ hasText: new RegExp(`^${minStr}$`) });
  if (await minCell.count() > 0) await minCell.first().click();

  const okBtn = page.locator('.ant-picker-ok button').first();
  if (await okBtn.isVisible()) await okBtn.click();
  await page.waitForTimeout(500);

  // 2. Pickup Location Modal
  console.log(`[${name}] Filling Pickup Point...`);
  await page.locator('button.pikcup-title').click();
  await page.waitForTimeout(1000);
  let pDialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
  await pDialog.locator('label').filter({ hasText: new RegExp(`^${spec.pickup.locationType || 'Door'}$`, 'i') }).first().click();

  // Province
  const provQuery = spec.pickup.province || 'Jakarta';
  await selectAntLocationOption(page, pDialog, 'customer_province', provQuery, new RegExp(getSearchTerm(provQuery), 'i'));

  // City
  const cityQuery = spec.pickup.city || 'Jakarta Selatan';
  await selectAntLocationOption(page, pDialog, 'customer_city', cityQuery, new RegExp(getSearchTerm(cityQuery), 'i'));

  // District
  const distQuery = spec.pickup.district || 'Tebet';
  await selectAntLocationOption(page, pDialog, 'customer_district', distQuery, new RegExp(getSearchTerm(distQuery), 'i'));

  // Subdistrict
  const subQuery = spec.pickup.subdistrict || '';
  await selectAntLocationOption(page, pDialog, 'customer_subdistrict', subQuery, subQuery ? new RegExp(getSearchTerm(subQuery), 'i') : null, { fallbackFirst: true });

  await pDialog.locator('input[placeholder*="Alamat detail pickup"], input[placeholder*="detail pickup"], textarea[placeholder*="detail pickup"]').fill(spec.pickup.address || `${spec.pickup.district || ''} ${spec.pickup.city || ''}`);
  await pDialog.locator('input[placeholder*="Masukkan Nama PIC"], input[placeholder*="Nama PIC"]').fill(spec.pickup.pic.name);
  await pDialog.locator('input[placeholder*="Nama kontak pengirim"], input[placeholder*="Nama Perusahaan"]').fill(spec.pickup.pic.company);
  await pDialog.locator('input[placeholder*="Email Aktif Pengirim"], input[placeholder*="Email"]').fill(spec.pickup.pic.email);
  await pDialog.locator('#customer_phone, input[placeholder*="Nomor telepon"]').first().fill(spec.pickup.pic.phone);

  await pDialog.getByRole('button', { name: /simpan titik pickup/i }).click();
  await page.waitForTimeout(1500);

  // 3. Dropoff Location Modal
  console.log(`[${name}] Filling Dropoff Point...`);
  const dropBtn = page.locator('button.dropoff-title');
  // Wait until dropoff button is enabled
  await page.waitForFunction(
    btn => !btn.classList.contains('disabled') && !btn.hasAttribute('disabled'),
    await dropBtn.elementHandle(),
    { timeout: 15000 }
  );
  await dropBtn.click();
  await page.waitForTimeout(1000);
  let dDialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
  await dDialog.locator('label').filter({ hasText: new RegExp(`^${spec.dropoff.locationType || 'Door'}$`, 'i') }).first().click();

  // Province
  const dProvQuery = spec.dropoff.province || 'Jawa Timur';
  await selectAntLocationOption(page, dDialog, 'recipient_province', dProvQuery, new RegExp(getSearchTerm(dProvQuery), 'i'));

  // City
  const dCityQuery = spec.dropoff.city || 'Surabaya';
  await selectAntLocationOption(page, dDialog, 'recipient_city', dCityQuery, new RegExp(getSearchTerm(dCityQuery), 'i'));

  // District
  const dDistQuery = spec.dropoff.district || 'Gubeng';
  await selectAntLocationOption(page, dDialog, 'recipient_district', dDistQuery, new RegExp(getSearchTerm(dDistQuery), 'i'));

  // Subdistrict
  const dSubQuery = spec.dropoff.subdistrict || '';
  await selectAntLocationOption(page, dDialog, 'recipient_subdistrict', dSubQuery, dSubQuery ? new RegExp(getSearchTerm(dSubQuery), 'i') : null, { fallbackFirst: true });

  const dropoffAddrInput = dDialog.locator('input[placeholder*="Alamat Penerima"], textarea[placeholder*="Alamat Penerima"], input[placeholder*="detail drop off"], textarea[placeholder*="detail drop off"]').first();
  await dropoffAddrInput.fill(spec.dropoff.address || `${spec.dropoff.district || ''} ${spec.dropoff.city || ''}`);

  const dropoffPicInput = dDialog.locator('input[placeholder*="Nama Lengkap PIC"], input[placeholder*="Nama PIC"]').first();
  await dropoffPicInput.fill(spec.dropoff.pic.name);

  const dropoffCompanyInput = dDialog.locator('input[placeholder*="Nama Perusahaan / Nama Penerima"], input[placeholder*="Nama Perusahaan"], input[placeholder*="Nama kontak penerima"]').first();
  await dropoffCompanyInput.fill(spec.dropoff.pic.company);

  const dropoffEmailInput = dDialog.locator('input[placeholder*="Email Aktif Penerima"], input[placeholder*="Email"]').first();
  await dropoffEmailInput.fill(spec.dropoff.pic.email);

  const dropoffPhoneInput = dDialog.locator('#recipient_phone, input[placeholder*="Nomor telepon"]').first();
  await dropoffPhoneInput.fill(spec.dropoff.pic.phone);

  const simpanDropBtn = dDialog.locator('button:has-text("Simpan Titik Drop Off"), button:has-text("simpan titik drop"), button:has-text("Simpan")').first();
  await simpanDropBtn.click();
  await page.waitForTimeout(1500);

  // Mode Selection (SEMUA / Land / etc.)
  const modeBtn = page.getByRole('button', { name: new RegExp(`^${spec.transportationMode || 'SEMUA'}$`, 'i') });
  if (await modeBtn.isVisible().catch(() => false)) {
    await modeBtn.click();
    await page.waitForTimeout(600);
  }

  // Save Locations
  console.log(`[${name}] Saving Locations...`);
  const simpanLokasiBtn = page.getByRole('button', { name: /simpan informasi lokasi/i });
  await simpanLokasiBtn.waitFor({ state: 'visible', timeout: 15000 });
  await simpanLokasiBtn.click();
  await page.waitForTimeout(2500);

  // 4. Cargo / Muatan
  console.log(`[${name}] Setting Cargo...`);
  const charSelect = page.locator('.ant-select').nth(0);
  await charSelect.click();
  await page.waitForTimeout(400);
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: new RegExp(spec.cargo.characteristics || 'General Cargo', 'i') }).first().click();
  await page.waitForTimeout(800);

  // 4a. Scoped Pickup Manifest Button
  console.log(`[${name}] [Cargo:Pickup] Locating and clicking Pickup Manifest button (+ Tambah Informasi Muatan)...`);
  const pickupManifestBtn = page.locator('button.manifest-pickup-title')
    .or(page.locator('.box-shadow-mod').filter({ hasText: /^Pickup/i }).locator('button:has-text("Tambah Informasi Muatan")'))
    .first();
  await pickupManifestBtn.waitFor({ state: 'visible', timeout: 15000 });
  await pickupManifestBtn.click();
  await page.waitForTimeout(1500);

  const cargoDialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
  console.log(`[${name}] [Cargo:Pickup] Opening Tambah Barang modal...`);
  await cargoDialog.getByRole('button', { name: /tambah barang/i }).click();
  await page.waitForTimeout(1500);

  const subDialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
  console.log(`[${name}] [Cargo:Pickup] Selecting commodity...`);
  const comSelect = subDialog.locator('.ant-select:has(#commodity), .ant-select').filter({ hasText: /komoditas/i }).first();
  await comSelect.click();
  await page.waitForTimeout(500);
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: new RegExp(spec.cargo.commodity || 'Elektronik', 'i') }).first().click();
  await page.waitForTimeout(500);

  await subDialog.locator('input[placeholder*="nama barang"]').fill(spec.cargo.itemName || 'Barang Kiriman');
  await subDialog.locator('input[name="weight"]').fill(String(spec.cargo.weightKg || 50));
  await subDialog.locator('input[name="quantity"]').fill(String(spec.cargo.quantity || 1));
  await subDialog.locator('input[name="length"]').fill(String(spec.cargo.lengthCm || 50));
  await subDialog.locator('input[name="width"]').fill(String(spec.cargo.widthCm || 50));
  await subDialog.locator('input[name="height"]').fill(String(spec.cargo.heightCm || 50));

  console.log(`[${name}] [Cargo:Pickup] Saving item manifest...`);
  await subDialog.getByRole('button', { name: /simpan item manifest/i }).click();
  await page.waitForTimeout(1500);

  const mDialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
  console.log(`[${name}] [Cargo:Packaging] Proceeding to packaging selection...`);
  await mDialog.getByRole('button', { name: /selanjutnya/i }).click();
  await page.waitForTimeout(1500);

  const packSelect = mDialog.locator('.ant-select').filter({ hasText: /kemasan/i }).first();
  if (await packSelect.count() > 0) {
    await packSelect.click();
  } else {
    await mDialog.locator('.ant-select').first().click();
  }
  await page.waitForTimeout(500);
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
    .filter({ hasText: new RegExp(spec.cargo.packagingType || 'Kardus XL', 'i') }).first().click();
  await page.waitForTimeout(500);

  await mDialog.locator('input[name="length"]').fill(String(spec.cargo.lengthCm || 50));
  await mDialog.locator('input[name="width"]').fill(String(spec.cargo.widthCm || 50));
  await mDialog.locator('input[name="height"]').fill(String(spec.cargo.heightCm || 50));

  console.log(`[${name}] [Cargo:Packaging] Saving packaging...`);
  await mDialog.getByRole('button', { name: /simpan kemasan/i }).click();
  await page.waitForTimeout(1500);

  console.log(`[${name}] [Cargo:Pickup] Confirming manifest goods...`);
  await page.getByRole('button', { name: /iya, simpan manifest barang/i }).click();
  await page.waitForTimeout(2000);

  // 4b. Scoped Dropoff Manifest Button
  console.log(`[${name}] [Cargo:Dropoff] Linking Drop-off Cargo Manifest (+ Tambah Informasi Muatan)...`);
  const dropMuatanBtn = page.locator('button.manifest-dropoff-title')
    .or(page.locator('.box-shadow-mod').filter({ hasText: /^Drop\s*Off/i }).locator('button:has-text("Tambah Informasi Muatan")'))
    .first();
  if (await dropMuatanBtn.count() > 0 && !await dropMuatanBtn.isDisabled()) {
    await dropMuatanBtn.click();
    await page.waitForTimeout(1500);
    const dMuatanDialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
    const chk = dMuatanDialog.locator('input[type="checkbox"], .ant-checkbox');
    if (await chk.count() > 0) {
      await chk.first().click();
      await page.waitForTimeout(500);
    }
    const simpanDrop = dMuatanDialog.getByRole('button', { name: /simpan/i });
    if (await simpanDrop.isVisible()) {
      await simpanDrop.click();
      await page.waitForTimeout(1500);
      console.log(`[${name}] [Cargo:Dropoff] Drop-off manifest items linked successfully.`);
    }
  } else {
    console.log(`[${name}] [Cargo:Dropoff] Drop-off manifest button not present or already completed.`);
  }

  await page.getByRole('button', { name: /simpan informasi muatan/i }).click();
  await page.waitForTimeout(2000);

  // 5. Step 3: Service Catalog Discovery & Selection
  await handleServiceCatalogStep3(page, spec, name, result);

  // 6. Step 4: Summary & Confirm Shipment
  console.log(`[${name}] Confirming Shipment...`);
  const simpanShipmentBtn = page.getByRole('button', { name: /simpan shipment/i }).first()
    .or(page.locator('button:has-text("Simpan Shipment")')).first();
  await simpanShipmentBtn.click();
  await page.waitForTimeout(1500);

  const confirmShipmentBtn = page.getByRole('button', { name: /iya, simpan shipment/i });
  if (await confirmShipmentBtn.isVisible()) {
    await confirmShipmentBtn.click();
    await page.waitForTimeout(3000);
  }

  // Extract dynamic amount from order summary before final submit
  const summaryText = await page.locator('body').innerText();
  const costMatch = summaryText.match(/Total\s*(?:Biaya|Tagihan)?\s*:?\s*Rp\s*([0-9.,]+)/i);
  if (costMatch && costMatch[1]) {
    result.amount = parseInt(costMatch[1].replace(/[^0-9]/g, ''), 10);
  }

  // 7. Simpan Informasi Pesanan
  console.log(`[${name}] Submitting Final Order...`);
  const simpanInfoPesananBtn = page.getByRole('button', { name: /simpan informasi pesanan/i });
  await simpanInfoPesananBtn.click();
  await page.waitForTimeout(2000);

  const finalConfirmBtn = page.getByRole('button', { name: /ya, simpan|iya|konfirmasi|buat pesanan/i }).first();
  if (await finalConfirmBtn.isVisible()) {
    await finalConfirmBtn.click();
    await page.waitForTimeout(5000);
  }

  // 8. Extract Order ID & Shipment ID from Confirmation Screen
  const orderPageText = await page.locator('body').innerText();
  const orderIdMatch = orderPageText.match(/ORCA\d+/);
  const shipmentIdMatch = orderPageText.match(/SOCB\d+/);

  result.orderId = orderIdMatch ? orderIdMatch[0] : null;
  result.shipmentId = shipmentIdMatch ? shipmentIdMatch[0] : null;

  if (!result.amount) {
    const finalCostMatch = orderPageText.match(/Rp\s*([0-9]{1,3}(?:\.[0-9]{3})+)/i);
    if (finalCostMatch && finalCostMatch[1]) {
      result.amount = parseInt(finalCostMatch[1].replace(/[^0-9]/g, ''), 10);
    }
  }

  if (!result.orderId) {
    throw new Error('Order ID could not be identified after final submission in OMS UI.');
  }

  result.status = 'CREATED';
  console.log(`[${name}] Order successfully created: ${result.orderId} (Shipment: ${result.shipmentId}, Amount: Rp${result.amount})`);
  return result;
}

/**
 * International Order UI Execution (Non-Contract)
 */
async function executeInternationalOrderUI(page, spec, options = {}) {
  const result = {
    orderId: null,
    shipmentId: null,
    amount: null,
    serviceCatalog: null,
    status: 'IN_PROGRESS',
    error: null,
  };

  const name = options.transactionLabel || 'International Order';
  await navigateToShippingPage(page, 'international', options);

  const btn = page.locator('button.shipment-title');
  await btn.waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1000);
  await btn.click();

  await page.waitForSelector('#origin_country', { state: 'visible', timeout: 30000 });
  await page.waitForTimeout(500);

  // Transportation Mode & Service Type (Air -> Cargo)
  console.log(`[${name}] Setting transportation: Air Cargo...`);
  const airBtn = page.locator('button:has-text("Air")').first();
  if (await airBtn.isVisible()) {
    await airBtn.click();
    await page.waitForTimeout(500);
  }

  const cargoSegment = page.locator('.ant-segmented-item').filter({ hasText: /Cargo/i }).first();
  if (await cargoSegment.isVisible()) {
    await cargoSegment.click();
    await page.waitForTimeout(500);
  }

  // Origin Location
  await page.locator('label').filter({ hasText: new RegExp(`^${spec.pickup.locationType || 'Door'}$`, 'i') }).first().click();
  await page.waitForTimeout(300);

  const originCountry = page.locator('.ant-select').filter({ has: page.locator('#origin_country') }).first();
  await selectAntOption(page, originCountry, spec.pickup.country || 'Indonesia', null);

  const originCity = page.locator('.ant-select').filter({ has: page.locator('#origin_city') }).first();
  await selectAntOption(page, originCity, spec.pickup.city || 'Tangerang', null);

  await page.locator('input[placeholder="Masukkan kode pos"]').first().fill(spec.pickup.postalCode || '15111');

  // Destination Location
  await page.locator('label').filter({ hasText: new RegExp(`^${spec.dropoff.locationType || 'Door'}$`, 'i') }).nth(1).click();
  await page.waitForTimeout(300);

  const destCountry = page.locator('.ant-select').filter({ has: page.locator('#destination_country') }).first();
  await selectAntOption(page, destCountry, spec.dropoff.country || 'Singapore', null);

  const destCity = page.locator('.ant-select').filter({ has: page.locator('#destination_city') }).first();
  await selectAntOption(page, destCity, spec.dropoff.city || 'Singapore', null);

  await page.locator('input[placeholder="Masukkan kode pos"]').nth(1).fill(spec.dropoff.postalCode || '238801');

  // Incoterm
  const incotermContainer = page.locator('.ant-select').filter({ has: page.locator('#incoterm') }).first();
  await selectAntOption(page, incotermContainer, null, new RegExp(spec.incoterm || 'Delivered Duty Paid', 'i'));

  // Karakteristik & Description
  const prodCharContainer = page.locator('.ant-select').filter({ has: page.locator('#product_characteristic') }).first();
  await selectAntOption(page, prodCharContainer, null, new RegExp(spec.cargo.characteristics || 'General Cargo', 'i'));

  await page.locator('#description').fill(`${spec.cargo.commodity || 'General'} - ${spec.cargo.itemName || 'Cargo Item'}`);

  // Pickup Date
  const dateParts = spec.scheduledDate.split('-');
  const yearStr = dateParts[0];
  const dayStr = String(parseInt(dateParts[2], 10));
  const monthRegexes = [
    /^(Jan|Januari|January)$/i,
    /^(Feb|Februari|February)$/i,
    /^(Mar|Maret|March)$/i,
    /^(Apr|April)$/i,
    /^(Mei|May)$/i,
    /^(Jun|Juni|June)$/i,
    /^(Jul|Juli|July)$/i,
    /^(Agt|Aug|Agustus|August)$/i,
    /^(Sep|September)$/i,
    /^(Okt|Oct|Oktober|October)$/i,
    /^(Nov|November)$/i,
    /^(Des|Dec|Desember|December)$/i,
  ];
  const monthRegex = monthRegexes[parseInt(dateParts[1], 10) - 1] || /^(Des|Dec)$/i;

  await page.locator('#pickup_date').click();
  await page.waitForTimeout(500);
  const yearBtn = page.locator('.ant-picker-year-btn').first();
  if (await yearBtn.isVisible()) {
    await yearBtn.click();
    await page.waitForTimeout(300);
    await page.locator('.ant-picker-cell-in-view').filter({ hasText: new RegExp(`^${yearStr}$`) }).first().click();
    await page.waitForTimeout(300);
    await page.locator('.ant-picker-cell-in-view').filter({ hasText: monthRegex }).first().click();
    await page.waitForTimeout(300);
  }
  await page.locator('.ant-picker-cell-in-view:not(.ant-picker-cell-disabled)').filter({ hasText: new RegExp(`^${dayStr}$`) }).first().click();
  await page.waitForTimeout(400);

  const okBtn = page.locator('.ant-picker-ok button').first();
  if (await okBtn.isVisible()) await okBtn.click();
  await page.waitForTimeout(500);

  // Add Kemasan
  await page.getByRole('button', { name: /tambah kemasan/i }).first().click();
  await page.waitForTimeout(1500);

  await page.locator('input[placeholder="Jumlah item"]').fill(String(spec.cargo.quantity || 1));
  await page.locator('input[placeholder="Berat"]').fill(String(spec.cargo.weightKg || 50));
  await page.locator('input[placeholder="Length"]').fill(String(spec.cargo.lengthCm || 50));
  await page.locator('input[placeholder="Width"]').fill(String(spec.cargo.widthCm || 50));
  await page.locator('input[placeholder="Height"]').fill(String(spec.cargo.heightCm || 50));

  const pkgSelect = page.locator('.ant-select').filter({ hasText: /pilih jenis kemasan/i }).first();
  await selectAntOption(page, pkgSelect, null, new RegExp(spec.cargo.packagingType || 'Tanpa Kemasan', 'i'));

  const comSelect = page.locator('.ant-select').filter({ hasText: /pilih jenis komoditas/i }).first();
  await selectAntOption(page, comSelect, null, new RegExp(spec.cargo.commodity || 'Elektronik', 'i'));

  const hsSelect = page.locator('.ant-select').filter({ hasText: /pilih kode hs/i }).first();
  await selectAntOption(page, hsSelect, spec.cargo.hsCode || '85359010', null);

  const kemasanDialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
  const simpanKemasanBtn = kemasanDialog.getByRole('button', { name: /^simpan$/i })
    .or(page.getByRole('button', { name: /^simpan$/i }))
    .first();
  await simpanKemasanBtn.click();
  await page.waitForTimeout(1500);

  // Submit Step 1
  await page.getByRole('button', { name: /simpan detail pengiriman/i }).click();
  await page.waitForTimeout(5000);

  // Inspect Step 2: Service Catalog
  const step2Text = await page.locator('body').innerText();
  if (step2Text.includes('Ajukan Inquiry Layanan') || step2Text.includes('Harga terbaik sedang kami sesuaikan')) {
    throw new Error(`No applicable Service Catalog exists on staging OMS for International route ${spec.pickup.city} -> ${spec.dropoff.city}. Stopped per policy (no inquiry fallback).`);
  }

  // If service catalog cards exist, select one
  const anyServiceCard = page.locator('.ant-card-hoverable, .ant-card:has-text("Air Cargo")').first();
  if (await anyServiceCard.isVisible().catch(() => false)) {
    await anyServiceCard.click();
    result.serviceCatalog = (await anyServiceCard.innerText()).split('\n')[0];
    await page.getByRole('button', { name: /simpan|selanjutnya/i }).first().click();
    await page.waitForTimeout(3000);
  } else {
    throw new Error(`No selectable Service Catalog cards found for International route ${spec.pickup.city} -> ${spec.dropoff.city}.`);
  }

  result.status = 'CATALOG_SELECTED';
  return result;
}

/**
 * General Order Execution Interface
 * 
 * @param {Object} inputSpecification User-supplied partial or full specification
 * @param {Object} options Execution options
 * @param {boolean} [options.headless=true] Playwright headless flag (defaults to true for programmatic execution)
 * @param {string} [options.sessionPath] Path to storageState JSON
 * @param {import('playwright').Browser} [options.existingBrowser] Reusable browser instance
 * @param {import('playwright').BrowserContext} [options.existingContext] Reusable browser context
 * @param {string} [options.transactionLabel] Friendly name for logging
 * @returns {Promise<Object>} Execution result object
 */
async function executeOrder(inputSpecification = {}, options = {}) {
  const { resolvedSpec, sources, missingMandatory } = resolveSpecification(inputSpecification);

  if (missingMandatory && missingMandatory.length > 0) {
    throw new Error(`Order specification cannot be executed. Missing mandatory fields: ${missingMandatory.join(', ')}`);
  }

  const headless = options.headless === true;
  const sessionPath = options.sessionPath || DEFAULT_SESSION_PATH;
  console.log(`[OrderExecutor] Executing ${resolvedSpec.orderType} order (Browser Mode: ${headless ? 'Headless (background)' : 'Headed (visible browser)'})`);

  let browser = options.existingBrowser;
  let context = options.existingContext;
  let ownsBrowser = false;

  if (!browser && !context) {
    browser = await chromium.launch({ headless, slowMo: headless ? 0 : 100 });
    ownsBrowser = true;
  }

  if (!context) {
    context = await browser.newContext({
      viewport: { width: 1440, height: 950 },
    });
  }

  const page = options.existingPage || await context.newPage();
  let result = null;

  try {
    if (!options.skipLogin) {
      await performFreshLogin(page, context, {
        ...options,
        sessionPath,
      });
    }

    if (resolvedSpec.orderType === 'international') {
      result = await executeInternationalOrderUI(page, resolvedSpec, options);
    } else {
      result = await executeDomesticOrderUI(page, resolvedSpec, options);
    }

    result.success = true;
    result.specification = resolvedSpec;

    // Save successful specification as remembered baseline
    savePreviousSpecification(resolvedSpec);

  } catch (err) {
    await captureScreenshot(page, 'order_exec_failure').catch(() => null);
    result = {
      success: false,
      orderId: null,
      shipmentId: null,
      amount: null,
      status: 'FAILED',
      error: err.message,
      specification: resolvedSpec,
    };
  } finally {
    if (ownsBrowser && browser) {
      await browser.close().catch(() => {});
    }
  }

  return { result, page, context, browser };
}

module.exports = {
  executeOrder,
  executeDomesticOrderUI,
  executeInternationalOrderUI,
  handleServiceCatalogStep3,
  formatSpecificationReview,
  selectAntLocationOption,
};
