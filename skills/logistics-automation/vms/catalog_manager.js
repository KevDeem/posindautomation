/**
 * VMS Catalog Manager
 * Handles UI automation for creating, verifying, and listing parent catalogs.
 * - Navigates to /service-catalog
 * - Creates parent catalog via /service-catalog/add
 * - Submits header details (Name, Start Date, End Date)
 * - Verifies parent catalog presence in list
 * - Navigates to route detail page for a catalog
 */

const path = require('path');
const fs = require('fs');
const { getAuthenticatedVmsPage } = require('./vms_auth');
const { loadVmsConfig } = require('./vms_config');
const { getOrFetchCatalogs, invalidateCatalogCache } = require('./catalog_cache');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const SCREENSHOTS_DIR = path.join(ROOT_DIR, '.artifacts/screenshots');

/**
 * Capture error / diagnostic screenshot
 */
async function captureVmsScreenshot(page, prefix = 'vms_failure') {
  try {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    const timestamp = Date.now();
    const filepath = path.join(SCREENSHOTS_DIR, `${prefix}_${timestamp}.png`);
    if (page && typeof page.screenshot === 'function') {
      await page.screenshot({ path: filepath, fullPage: true }).catch(() => {});
      return filepath;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDateInput(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dateObj = new Date(d);
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Create a new Parent Catalog
 */
async function createParentCatalog(page, catalogData, options = {}) {
  const cfg = loadVmsConfig(options);
  const catalogName = catalogData.name || `Catalog ${new Date().toISOString().slice(0, 10)}`;
  const startDate = formatDateInput(catalogData.startDate || new Date());
  const endDate = formatDateInput(catalogData.endDate || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000 * 2)); // Default 2 years

  console.log(`[VMSCatalog] Creating Parent Catalog: "${catalogName}" (${startDate} to ${endDate})...`);

  // Navigate to /service-catalog
  await page.goto(`${cfg.vmsUrl}/service-catalog`, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
  await page.waitForTimeout(1000);

  // Click "Tambah" button to open header creation form (/service-catalog/add)
  const tambahBtn = page.locator('button:has-text("Tambah")').first();
  await tambahBtn.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
  await tambahBtn.click();

  // Wait for /service-catalog/add form to mount
  await page.waitForSelector('#catalog_name, input[placeholder*="nama katalog" i]', { timeout: cfg.actionTimeoutMs });

  // Fill Catalog Name
  const nameInput = page.locator('#catalog_name, input[placeholder*="nama katalog" i]').first();
  await nameInput.fill(catalogName);

  // Fill Start Date
  const startPicker = page.locator('#start_date, input[placeholder*="tanggal mulai" i]').first();
  await startPicker.click();
  await startPicker.fill(startDate);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // Fill End Date
  const endPicker = page.locator('#end_date, input[placeholder*="tanggal berakhir" i]').first();
  await endPicker.click();
  await endPicker.fill(endDate);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);

  // Click Simpan button
  const simpanBtn = page.locator('button:has-text("Simpan"), button[type="submit"]').first();
  console.log('[VMSCatalog] Submitting parent catalog form...');
  await simpanBtn.click();

  // Wait for redirect back to /service-catalog
  await page.waitForFunction(
    () => window.location.pathname === '/service-catalog',
    { timeout: cfg.navigationTimeoutMs }
  );

  console.log('[VMSCatalog] Parent catalog saved successfully. Verifying catalog in table...');
  invalidateCatalogCache();
  await page.waitForTimeout(2000);

  // Verify newly created catalog in table
  const catalogRow = page.locator(`.ant-table-tbody tr.ant-table-row:has-text("${catalogName}")`).first();
  const isFound = await catalogRow.isVisible().catch(() => false);

  let detailUrl = null;
  if (isFound) {
    const actionBtn = catalogRow.locator('.ant-dropdown-trigger').first();
    await actionBtn.click();
    await page.waitForTimeout(500);

    const lihatRouteItem = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item:has-text("Lihat Route")').first();
    await lihatRouteItem.click();
    await page.waitForFunction(
      () => window.location.pathname.includes('/service-catalog/detail/'),
      { timeout: cfg.navigationTimeoutMs }
    );
    detailUrl = page.url();
    console.log('[VMSCatalog] Navigated to Route Detail URL:', detailUrl);
  }

  return {
    success: true,
    catalogName,
    startDate,
    endDate,
    isFoundInTable: isFound,
    detailUrl,
  };
}

/**
 * Wait for VMS Service Catalog table to finish rendering and loading data
 */
async function waitForCatalogTableLoaded(page, timeoutMs = 15000) {
  // Ensure we are on /service-catalog if navigating a real HTTP URL
  if (page.url().startsWith('http') && !page.url().includes('/service-catalog')) {
    const cfg = loadVmsConfig();
    await page.goto(`${cfg.vmsUrl}/service-catalog`, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  }

  // Wait for table container to mount
  await page.locator('.ant-table-wrapper, .ant-table').first().waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {});

  // Wait for loading spinners or skeleton pulses to detach/hide
  await page.locator('.ant-spin-spinning, .ant-skeleton, .ant-spin').first().waitFor({ state: 'hidden', timeout: timeoutMs }).catch(() => {});

  // Wait for either rows or empty state to appear
  await Promise.race([
    page.waitForSelector('.ant-table-tbody tr.ant-table-row', { state: 'visible', timeout: timeoutMs }).catch(() => null),
    page.waitForSelector('.ant-empty, .ant-table-placeholder', { state: 'visible', timeout: timeoutMs }).catch(() => null),
  ]);

  await page.waitForTimeout(600);
}

/**
 * Extract visible catalog rows from the current table page
 */
async function extractVisibleCatalogRows(page) {
  return await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.ant-table-tbody tr.ant-table-row'));
    return rows.map((tr, index) => {
      const tds = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      const rowKey = tr.getAttribute('data-row-key') || null;
      const detailLink = tr.querySelector('a[href*="/service-catalog/detail/"]');

      let catalogId = null;
      let detailUrl = null;

      // Extract real detailUrl from link if present and identifier is authentic (not a numeric row index)
      if (detailLink && detailLink.getAttribute('href')) {
        const href = detailLink.getAttribute('href');
        const match = href.match(/\/service-catalog\/detail\/([^?#/]+)/);
        if (match && match[1] && !/^\d+$/.test(match[1])) {
          catalogId = match[1];
          detailUrl = detailLink.href;
        }
      }

      // Check rowKey: ONLY accept if it is a genuine hash / uuid (at least 16 chars, non-integer)
      if (!catalogId && rowKey && !/^\d+$/.test(rowKey) && rowKey.length >= 16) {
        catalogId = rowKey;
        detailUrl = `${window.location.origin}/service-catalog/detail/${catalogId}`;
      }

      return {
        rowIndex: index,
        catalogId,
        detailUrl,
        name: tds[0] || '',
        services: tds[1] || '0',
        startDate: tds[2] || '',
        endDate: tds[3] || '',
        status: tds[4] || '',
      };
    }).filter(c => c.name);
  });
}

/**
 * Capture structured diagnostics when catalog lookup fails
 */
async function captureCatalogLookupDiagnostics(page, targetCatalogName, visibleCatalogs = [], paginationAttempted = false) {
  const currentUrl = page.url();
  const isLoginPage = currentUrl.includes('/login');
  const hasAuthHeader = await page.locator('.ant-layout-header, .ant-menu, .ant-layout-sider').first().isVisible().catch(() => false);
  const loginSucceeded = !isLoginPage && hasAuthHeader;

  const vendorAccount = await page.evaluate(() => {
    const header = document.querySelector('.ant-layout-header, header');
    if (!header) return 'Unknown';
    const text = header.innerText || '';
    const match = text.match(/Hi,\s*([^\n\r]+)/i);
    return match ? match[1].trim() : text.slice(0, 50).trim();
  }).catch(() => 'Unknown');

  const rowsCount = await page.locator('.ant-table-tbody tr.ant-table-row').count().catch(() => 0);
  const tableLoaded = rowsCount > 0;

  const catalogNames = visibleCatalogs.map(c => c.name);
  const screenshotPath = await captureVmsScreenshot(page, 'catalog_lookup_failure');

  const diag = {
    targetCatalogName,
    currentUrl,
    loginSucceeded,
    vendorAccount,
    serviceCatalogUrl: page.url(),
    tableLoaded,
    visibleCatalogsCount: visibleCatalogs.length,
    catalogNamesRetrieved: catalogNames,
    paginationAttempted,
    screenshotPath,
  };

  console.error('\n[VMSCatalog DIAGNOSTIC] Catalog Lookup Failure:');
  console.error(JSON.stringify(diag, null, 2));
  return diag;
}

/**
 * List existing catalogs from /service-catalog table, supporting pagination
 */
async function listServiceCatalogs(page, options = {}) {
  const cfg = loadVmsConfig(options);
  if (page.url().startsWith('http') && !page.url().includes('/service-catalog')) {
    await page.goto(`${cfg.vmsUrl}/service-catalog`, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
  }
  await waitForCatalogTableLoaded(page, cfg.actionTimeoutMs);

  // Extract page 1 catalogs
  const allCatalogs = [];
  const page1Rows = await extractVisibleCatalogRows(page);
  page1Rows.forEach(r => allCatalogs.push({ ...r, pageIndex: 1 }));

  // Check if multiple pagination pages exist
  const pageItems = await page.locator('.ant-pagination li.ant-pagination-item').all();
  if (pageItems.length > 1) {
    for (let p = 1; p < pageItems.length; p++) {
      try {
        await pageItems[p].click();
        await waitForCatalogTableLoaded(page, cfg.actionTimeoutMs);
        const rows = await extractVisibleCatalogRows(page);
        rows.forEach(r => allCatalogs.push({ ...r, pageIndex: p + 1 }));
      } catch (pageErr) {
        console.warn(`[VMSCatalog] Could not paginate to page ${p + 1}:`, pageErr.message);
      }
    }

    // Return to page 1
    const firstPageBtn = page.locator('.ant-pagination li.ant-pagination-item-1').first();
    if (await firstPageBtn.isVisible().catch(() => false)) {
      await firstPageBtn.click().catch(() => {});
      await waitForCatalogTableLoaded(page, cfg.actionTimeoutMs);
    }
  }

  return allCatalogs;
}

/**
 * Verify catalog detail page:
 * - Checks for error banners (Not Permission, 403, 404, Unauthorized)
 * - Verifies expected catalog name is displayed on the page
 */
async function verifyCatalogDetailPage(page, expectedCatalogName, timeoutMs = 10000) {
  const targetClean = (expectedCatalogName || '').trim().toLowerCase();

  // Check for immediate error banners
  const permissionError = await page.evaluate(() => {
    const text = document.body ? document.body.innerText : '';
    if (/Not\s+Permission/i.test(text)) return 'Not Permission';
    if (/403\s+Forbidden/i.test(text)) return '403 Forbidden';
    if (/404\s+Not\s+Found/i.test(text)) return '404 Not Found';
    if (/Unauthorized/i.test(text)) return 'Unauthorized';
    return null;
  }).catch(() => null);

  if (permissionError) {
    return {
      verified: false,
      displayedName: permissionError,
      reason: `Page displayed error banner: "${permissionError}"`,
    };
  }

  // Check for catalog name in header, title, breadcrumbs, descriptions, or content
  const displayedInfo = await page.evaluate((targetClean) => {
    const candidateSelectors = [
      '.ant-page-header-heading-title',
      '.ant-page-header-heading-sub-title',
      '.ant-breadcrumb',
      'h1, h2, h3, h4, h5',
      '.ant-descriptions-item-content',
      '.ant-descriptions-item',
      '.ant-card-head-title',
      '.catalog-name, .catalog-title',
    ];

    for (const sel of candidateSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = (el.innerText || '').trim();
        if (text && text.toLowerCase().includes(targetClean)) {
          return { found: true, text, selector: sel };
        }
      }
    }

    const bodyText = (document.body ? document.body.innerText : '').trim();
    if (bodyText.toLowerCase().includes(targetClean)) {
      return { found: true, text: targetClean, selector: 'body' };
    }

    const fallbackEl = document.querySelector('.ant-page-header-heading-title, h1, h2, h3, .ant-descriptions-item-content');
    const fallbackText = fallbackEl ? (fallbackEl.innerText || '').trim() : 'Unknown';

    return { found: false, text: fallbackText, selector: null };
  }, targetClean).catch(() => ({ found: false, text: 'Evaluation error', selector: null }));

  if (displayedInfo.found) {
    return {
      verified: true,
      displayedName: displayedInfo.text,
      matchedSelector: displayedInfo.selector,
    };
  }

  return {
    verified: false,
    displayedName: displayedInfo.text,
    reason: `Catalog name "${expectedCatalogName}" not found on detail page`,
  };
}

/**
 * Headless catalog list retrieval.
 * Always uses a dedicated headless Playwright session and closes it immediately after extraction.
 */
async function retrieveAvailableCatalogsHeadless(options = {}) {
  const { browser, context, page } = await getAuthenticatedVmsPage({ ...options, headless: true });
  try {
    return await listServiceCatalogs(page, options);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Get available catalogs using cache or headless fetch
 */
async function getAvailableCatalogs(options = {}) {
  return await getOrFetchCatalogs(() => retrieveAvailableCatalogsHeadless(options), options);
}

/**
 * Open existing catalog via UI-based navigation and navigate to its route detail page.
 * Strictly navigates through the actual VMS Service Catalog UI:
 * 1. Navigates to /service-catalog
 * 2. Locates the actual catalog row corresponding to the selected catalog
 * 3. Clicks the row's verified detail action (.ant-dropdown-trigger -> "Lihat Route")
 * 4. Waits for the actual catalog detail page to load
 * 5. Verifies the displayed catalog name matches the selected catalog
 * 6. Logs all required diagnostics
 */
async function openCatalogDetail(page, catalogInfo, options = {}) {
  const cfg = loadVmsConfig(options);
  const catalogName = typeof catalogInfo === 'string' ? catalogInfo : (catalogInfo.name || '');
  const selectedCliIndex = (options && options.selectedCliIndex !== undefined && options.selectedCliIndex !== null)
    ? options.selectedCliIndex
    : (typeof catalogInfo === 'object' && catalogInfo !== null && catalogInfo.selectedCliIndex !== undefined && catalogInfo.selectedCliIndex !== null ? catalogInfo.selectedCliIndex : null);
  const initialCatalogId = (typeof catalogInfo === 'object' && catalogInfo !== null ? catalogInfo.catalogId : null) || null;
  const initialDetailUrl = (typeof catalogInfo === 'object' && catalogInfo !== null ? catalogInfo.detailUrl : null) || null;

  console.log('\n[VMSCatalog] === Catalog Detail UI Navigation ===');
  console.log(`[VMSCatalog] Selected CLI catalog index: ${selectedCliIndex !== null ? `#${selectedCliIndex}` : 'N/A'}`);
  console.log(`[VMSCatalog] Selected catalog name: "${catalogName}"`);
  console.log(`[VMSCatalog] Actual catalog identifier: ${initialCatalogId || 'Pending UI resolution'}`);
  console.log(`[VMSCatalog] Actual catalog detail URL: ${initialDetailUrl || 'Pending UI resolution'}`);

  if (page.url().startsWith('http') && !page.url().includes('/service-catalog')) {
    await page.goto(`${cfg.vmsUrl}/service-catalog`, { waitUntil: 'domcontentloaded', timeout: cfg.navigationTimeoutMs });
  }
  await waitForCatalogTableLoaded(page, cfg.actionTimeoutMs);

  const targetClean = (catalogName || '').trim().toLowerCase();
  let targetRow = null;
  let pageItems = await page.locator('.ant-pagination li.ant-pagination-item').all();
  const totalPages = Math.max(1, pageItems.length);
  let checkedCatalogs = [];
  let foundPage = 1;
  let foundRowIndex = -1;
  let howLocated = '';

  for (let p = 0; p < totalPages; p++) {
    if (p > 0 && pageItems[p]) {
      await pageItems[p].click();
      await waitForCatalogTableLoaded(page, cfg.actionTimeoutMs);
    }

    const rows = await extractVisibleCatalogRows(page);
    checkedCatalogs.push(...rows);

    // Exact match first
    let matchIdx = rows.findIndex(r => r.name.trim().toLowerCase() === targetClean);
    let isExact = true;
    if (matchIdx === -1) {
      matchIdx = rows.findIndex(r => r.name.trim().toLowerCase().includes(targetClean));
      isExact = false;
    }

    if (matchIdx !== -1) {
      foundPage = p + 1;
      foundRowIndex = rows[matchIdx].rowIndex;
      howLocated = `${isExact ? 'Exact name match' : 'Partial name match'} on table page ${foundPage} (row index ${foundRowIndex})`;
      const tableRows = await page.locator('.ant-table-tbody tr.ant-table-row').all();
      if (tableRows[foundRowIndex]) {
        targetRow = tableRows[foundRowIndex];
        break;
      }
    }
  }

  if (!targetRow) {
    const screenshotPath = await captureVmsScreenshot(page, 'vms_catalog_not_found');
    const diag = await captureCatalogLookupDiagnostics(page, catalogName, checkedCatalogs, totalPages > 1);
    diag.selectedCliIndex = selectedCliIndex;
    diag.screenshotPath = screenshotPath;
    console.error(`[VMSCatalog ERROR] Selected catalog "${catalogName}" is unavailable in the VMS table.`);
    const err = new Error(`Catalog "${catalogName}" not found in VMS Service Catalog table.`);
    err.diagnostic = diag;
    throw err;
  }

  console.log(`[VMSCatalog] How catalog was located in UI: ${howLocated}`);

  // Trigger verified detail navigation control
  const actionBtn = targetRow.locator('.ant-dropdown-trigger, button:has-text("..."), .anticon-more').first();
  await actionBtn.click();
  await page.waitForTimeout(500);

  const lihatRouteItem = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({ hasText: /Lihat\s+(?:Route|Rute|Detail)/i }).first();
  await lihatRouteItem.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
  await lihatRouteItem.click();

  await page.waitForFunction(
    () => (window.location.pathname.includes('/service-catalog/detail/')) || Boolean(window.__navigatedUrl && window.__navigatedUrl.includes('/service-catalog/detail/')),
    { timeout: cfg.navigationTimeoutMs }
  );

  const finalUrl = page.url() === 'about:blank'
    ? ((await page.evaluate(() => window.__navigatedUrl).catch(() => '')) || page.url())
    : page.url();

  const idMatch = finalUrl.match(/\/service-catalog\/detail\/([^?#/]+)/);
  const actualCatalogId = idMatch ? idMatch[1] : null;

  console.log(`[VMSCatalog] Final URL after navigation: ${finalUrl}`);
  console.log(`[VMSCatalog] Actual catalog identifier: ${actualCatalogId || 'Unknown'}`);

  // Check if detail URL was mistakenly an integer selection index
  if (actualCatalogId && /^\d+$/.test(actualCatalogId)) {
    console.warn(`[VMSCatalog WARNING] Detected numeric identifier "${actualCatalogId}" in detail URL.`);
  }

  // Verify the displayed catalog name on detail page
  const verification = await verifyCatalogDetailPage(page, catalogName, cfg.actionTimeoutMs);
  if (!verification.verified) {
    const screenshotPath = await captureVmsScreenshot(page, 'vms_detail_verification_failed');
    const diag = {
      selectedCliIndex,
      selectedCatalogName: catalogName,
      finalUrl,
      actualCatalogId,
      displayedCatalogName: verification.displayedName,
      verificationReason: verification.reason,
      screenshotPath,
    };
    console.error('\n[VMSCatalog DIAGNOSTIC] Detail Page Verification Failed:');
    console.error(JSON.stringify(diag, null, 2));
    const err = new Error(`Catalog detail page verification failed for "${catalogName}": ${verification.reason}. Final URL: ${finalUrl}`);
    err.diagnostic = diag;
    throw err;
  }

  console.log(`[VMSCatalog] Catalog name displayed on detail page: "${verification.displayedName}" (Verified)`);
  console.log('[VMSCatalog] =============================================\n');

  return {
    success: true,
    catalogName,
    catalogId: actualCatalogId,
    detailUrl: finalUrl,
    displayedCatalogName: verification.displayedName,
    howLocated,
    selectedCliIndex,
  };
}

/**
 * Open existing catalog by name and navigate to its route detail page.
 * Alias to openCatalogDetail.
 */
async function openCatalogDetailByName(page, catalogName, options = {}) {
  return await openCatalogDetail(page, { name: catalogName }, options);
}

module.exports = {
  createParentCatalog,
  openCatalogDetailByName,
  openCatalogDetail,
  verifyCatalogDetailPage,
  captureVmsScreenshot,
  listServiceCatalogs,
  retrieveAvailableCatalogsHeadless,
  getAvailableCatalogs,
  waitForCatalogTableLoaded,
  extractVisibleCatalogRows,
  captureCatalogLookupDiagnostics,
};
