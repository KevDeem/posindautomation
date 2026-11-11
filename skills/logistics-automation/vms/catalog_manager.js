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
const { getAuthenticatedVmsPage, getStoredVmsSessionCookie, ensureVmsSessionCookie } = require('./vms_auth');
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

  // Wait for active spinning overlays to detach/hide (specifically .ant-spin-spinning, avoiding static .ant-spin)
  await page.locator('.ant-spin-spinning, .ant-skeleton-active').first().waitFor({ state: 'hidden', timeout: Math.min(timeoutMs, 3000) }).catch(() => {});

  // Wait for either populated table rows or empty placeholder to appear
  await Promise.race([
    page.locator('.ant-table-tbody tr.ant-table-row td:not(:empty)').first().waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => null),
    page.locator('.ant-table-tbody tr.ant-table-row:not(.ant-table-measure-row)').first().waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => null),
    page.locator('.ant-empty, .ant-table-placeholder').first().waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => null),
  ]);

  await page.waitForTimeout(300);
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

  // Wait for detail content h1 to render if navigating live
  const detailTitleCandidateSelector = 'main section h1, main h1, .ant-layout-content h1, h1.text-\\[24px\\]';
  try {
    await page.locator(detailTitleCandidateSelector).first().waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 8000) });
  } catch (waitErr) {
    // If specific h1 did not mount within timeout, proceed to evaluate error banners or DOM state
  }

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
      inspectedElement: 'body (permission check)',
    };
  }

  // Extract catalog title specifically from detail page main content
  const domInspection = await page.evaluate((targetClean) => {
    const isExcluded = (text) => {
      if (!text) return true;
      const lower = text.toLowerCase();
      return (
        lower.includes('vendor management system') ||
        lower.startsWith('hi,') ||
        lower.includes('dashboard vendor') ||
        lower.includes('live chat') ||
        lower === 'rute aktif' ||
        lower === 'rute tidak aktif' ||
        lower === 'total rute' ||
        lower === 'service rute' ||
        lower === 'katalog layanan'
      );
    };

    // Strategy 1: Title element located in detail header container above validity period
    // In VMS: <section class="mb-5">...<h1 class="text-[24px] font-semibold mb-2">Title</h1>...<p>Berlaku ...</p>
    const allP = Array.from(document.querySelectorAll('main p, .ant-layout-content p, section p, p'));
    const validityP = allP.find(p => (p.innerText || '').includes('Berlaku'));
    if (validityP) {
      const container = validityP.closest('div.w-full, .ant-col, section') || validityP.parentElement;
      if (container) {
        const titleH1 = container.querySelector('h1.text-\\[24px\\], h1.font-semibold, h1');
        if (titleH1) {
          const titleText = (titleH1.innerText || '').trim();
          if (titleText && !isExcluded(titleText)) {
            return {
              strategy: 'validity_header_container',
              selector: 'section.mb-5 h1.text-[24px]',
              displayedName: titleText,
              outerHTML: titleH1.outerHTML,
              tag: titleH1.tagName,
              matches: titleText.toLowerCase() === targetClean || titleText.toLowerCase().includes(targetClean),
            };
          }
        }
      }
    }

    // Strategy 2: Specific detail page title locators within main / ant-layout-content
    const mainTitleSelectors = [
      'main section h1.text-\\[24px\\]',
      '.ant-layout-content section h1.text-\\[24px\\]',
      'section.mb-5 h1',
      'main h1.text-\\[24px\\]',
      '.ant-layout-content h1.text-\\[24px\\]',
      'main h1.font-semibold',
      'main h1',
      '.ant-layout-content h1',
      '.ant-page-header-heading-title',
    ];

    for (const sel of mainTitleSelectors) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = (el.innerText || '').trim();
        if (text && !isExcluded(text)) {
          return {
            strategy: 'main_title_selector',
            selector: sel,
            displayedName: text,
            outerHTML: el.outerHTML,
            tag: el.tagName,
            matches: text.toLowerCase() === targetClean || text.toLowerCase().includes(targetClean),
          };
        }
      }
    }

    // Strategy 3: Check headings within main, filtering out known stats and branding
    const mainEl = document.querySelector('main.ant-layout-content, main, .ant-layout-content') || document.body;
    const headings = Array.from(mainEl.querySelectorAll('h1, h2, h3'));
    for (const h of headings) {
      const text = (h.innerText || '').trim();
      if (text && !isExcluded(text)) {
        return {
          strategy: 'main_headings_fallback',
          selector: `${mainEl.tagName.toLowerCase()} ${h.tagName.toLowerCase()}.${(h.className || '').trim().replace(/\\s+/g, '.')}`,
          displayedName: text,
          outerHTML: h.outerHTML,
          tag: h.tagName,
          matches: text.toLowerCase() === targetClean || text.toLowerCase().includes(targetClean),
        };
      }
    }

    return {
      strategy: 'not_found',
      selector: null,
      displayedName: 'Not Found',
      outerHTML: null,
      tag: null,
      matches: false,
    };
  }, targetClean).catch((err) => ({
    strategy: 'eval_error',
    selector: null,
    displayedName: 'Evaluation error',
    outerHTML: null,
    tag: null,
    matches: false,
    error: err.message,
  }));

  if (domInspection.matches) {
    return {
      verified: true,
      displayedName: domInspection.displayedName,
      matchedSelector: domInspection.selector,
      strategy: domInspection.strategy,
      inspectedElement: domInspection.outerHTML || domInspection.selector,
    };
  }

  return {
    verified: false,
    displayedName: domInspection.displayedName,
    reason: `Catalog name "${expectedCatalogName}" does not match displayed detail title "${domInspection.displayedName}"`,
    inspectedElement: domInspection.outerHTML || domInspection.selector || 'No valid title element found in main layout',
    strategy: domInspection.strategy,
  };
}

const DEFAULT_VMS_NEXT_ACTION_ID = '403d98f6100e1212a1c6c8c0d5bdcf5bcd5d958bed';
let _currentNextActionId = DEFAULT_VMS_NEXT_ACTION_ID;

function setVmsNextActionId(actionId) {
  if (actionId && typeof actionId === 'string') {
    _currentNextActionId = actionId;
  }
}

function getVmsNextActionId() {
  return _currentNextActionId;
}

const INDO_MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];

function formatIndonesianDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = INDO_MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

function mapStatusCodeToIndonesian(statusCode, isActive) {
  if (!statusCode) return isActive ? 'Aktif' : 'Tidak Aktif';
  switch (statusCode.toUpperCase()) {
    case 'ACTIVE':
      return 'Aktif';
    case 'UPCOMING':
      return 'Akan Datang';
    case 'EXPIRED':
      return 'Kadaluwarsa';
    case 'INACTIVE':
      return 'Tidak Aktif';
    default:
      return statusCode;
  }
}

function parseRscResponse(text) {
  if (!text) return null;
  const lines = text.split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const candidate = line.slice(colonIdx + 1).trim();
      try {
        const json = JSON.parse(candidate);
        if (json && (json.data?.data || Array.isArray(json.data))) {
          return json;
        }
      } catch (_) {}
    }
  }
  try {
    const directJson = JSON.parse(text);
    if (directJson && (directJson.data?.data || Array.isArray(directJson.data))) {
      return directJson;
    }
  } catch (_) {}
  return null;
}

/**
 * Fetch service catalogs directly via Next.js Server Action endpoint.
 * Highly optimized (<250ms), reuses authenticated session cookie (POS_SID).
 */
async function fetchServiceCatalogsApi(options = {}) {
  const cfg = loadVmsConfig(options);
  const actionId = options.nextActionId || process.env.VMS_CATALOG_NEXT_ACTION_ID || _currentNextActionId;

  // Ensure authenticated session cookie
  let cookie = getStoredVmsSessionCookie(cfg);
  if (!cookie) {
    cookie = await ensureVmsSessionCookie(options);
  }

  const endpointUrl = `${cfg.vmsUrl}/service-catalog`;
  const pageNum = options.page || 1;
  const limitNum = options.limit || 50;

  async function performFetch(cookieVal) {
    return await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'cookie': `POS_SID=${cookieVal}`,
        'next-action': actionId,
        'accept': 'text/x-component',
        'content-type': 'text/plain;charset=UTF-8',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify([{ page: pageNum, limit: limitNum }]),
    });
  }

  let res = await performFetch(cookie);

  // If unauthorized / forbidden or redirected, refresh cookie once
  if (res.status === 401 || res.status === 403 || res.status === 302) {
    console.log(`[VMSCatalog] Session cookie expired or unauthorized (status ${res.status}). Refreshing cookie...`);
    cookie = await ensureVmsSessionCookie({ ...options, forceRefresh: true });
    res = await performFetch(cookie);
  }

  if (!res.ok) {
    throw new Error(`Server Action request failed with HTTP ${res.status} ${res.statusText}`);
  }

  const responseText = await res.text();
  const parsed = parseRscResponse(responseText);

  if (!parsed || !parsed.data || !Array.isArray(parsed.data.data)) {
    throw new Error('Unexpected RSC response format from VMS Server Action');
  }

  const items = parsed.data.data;
  return items.map((item, index) => ({
    rowIndex: index,
    catalogId: item.catalog_header_code || null,
    detailUrl: null, // UI navigation uses action menu "Lihat Route"
    name: item.catalog_name || '',
    services: String(item.services !== undefined ? item.services : 0),
    startDate: formatIndonesianDate(item.start_date),
    endDate: formatIndonesianDate(item.end_date),
    status: mapStatusCodeToIndonesian(item.status_code, item.is_active),
    pageIndex: pageNum,
    catalogHeaderCode: item.catalog_header_code,
    isActive: item.is_active,
  }));
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
 * Retrieve available catalogs.
 * Tries direct Server Action API first (fastest, ~200ms).
 * Transparently falls back to headless browser extraction if skipApi is true or if API fails.
 */
async function retrieveAvailableCatalogs(options = {}) {
  if (!options.skipApi) {
    try {
      const startTime = Date.now();
      const catalogs = await fetchServiceCatalogsApi(options);
      console.log(`[VMSCatalog] Retrieved ${catalogs.length} catalogs via direct API in ${Date.now() - startTime}ms`);
      return catalogs;
    } catch (apiErr) {
      console.warn(`[VMSCatalog] Direct API fetch failed (${apiErr.message}), falling back to headless browser extraction...`);
    }
  }

  return await retrieveAvailableCatalogsHeadless(options);
}

/**
 * Get available catalogs using cache or API/headless fetch
 */
async function getAvailableCatalogs(options = {}) {
  return await getOrFetchCatalogs(() => retrieveAvailableCatalogs(options), options);
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

    // Locate exact row using Playwright locator scoped to table and exact text
    const exactRowLocator = page.locator('.ant-table-tbody tr.ant-table-row').filter({
      has: page.locator('td').first().filter({ hasText: new RegExp(`^\\s*${catalogName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*$`, 'i') })
    }).or(
      page.locator('.ant-table-tbody tr.ant-table-row').filter({
        hasText: new RegExp(`^\\s*${catalogName.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*`, 'i')
      })
    ).first();

    if (await exactRowLocator.isVisible().catch(() => false)) {
      foundPage = p + 1;
      howLocated = `Exact name match on table page ${foundPage}`;
      targetRow = exactRowLocator;
      break;
    }

    // Fallback: search extracted row index
    const matchIdx = rows.findIndex(r => r.name.trim().toLowerCase() === targetClean || r.name.trim().toLowerCase().includes(targetClean));
    if (matchIdx !== -1) {
      foundPage = p + 1;
      foundRowIndex = rows[matchIdx].rowIndex;
      howLocated = `Name match on table page ${foundPage} (row index ${foundRowIndex})`;
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

  // Locate three-dot action button strictly scoped to the matched catalog row
  const rowActionBtn = targetRow.locator(
    'button.ant-dropdown-trigger, .ant-dropdown-trigger, button:has-text("..."), .anticon-more, button[aria-haspopup="menu"], td:last-child button, td:last-child .ant-dropdown-trigger'
  ).first();

  await rowActionBtn.waitFor({ state: 'visible', timeout: cfg.actionTimeoutMs });
  await rowActionBtn.click();
  await page.waitForTimeout(500);

  // Click "Lihat Route" menu item from opened action menu (ignoring "Edit" & "Nonaktifkan Katalog")
  const lihatRouteItem = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item').filter({
    hasText: /^\s*Lihat\s+Route\s*$/i
  }).or(
    page.locator('.ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item:has-text("Lihat Route")')
  ).first();

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
  retrieveAvailableCatalogs,
  getAvailableCatalogs,
  fetchServiceCatalogsApi,
  setVmsNextActionId,
  getVmsNextActionId,
  formatIndonesianDate,
  mapStatusCodeToIndonesian,
  parseRscResponse,
  waitForCatalogTableLoaded,
  extractVisibleCatalogRows,
  captureCatalogLookupDiagnostics,
};
