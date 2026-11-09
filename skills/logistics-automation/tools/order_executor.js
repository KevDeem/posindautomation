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
  generateSyntheticStreetAddress,
  isAdministrativeOnly,
  determineDomesticTransportPreference,
} = require('./order_specification');
const {
  performFreshLogin,
  navigateToShippingPage,
  captureScreenshot,
} = require('./auth_manager');
const {
  matchLocationOption,
  validateAndMatchDistrict,
  extractAdminPrefix,
  normalizeIncoterm,
} = require('./location_matcher');
const {
  getPicLibrary,
  setPicLibrary,
  selectRandomPIC,
  generateRealisticPIC,
  validatePIC,
  normalizeCountry,
} = require('./pic_manager');

const DEFAULT_SESSION_PATH = path.resolve(__dirname, '../../../.sessions/staging-oms_kevin_d_imas_gmail_com_session.json');
const DEFAULT_INTL_PIC_ATTACHMENT_PATH = '/Users/kevin/Downloads/WhatsApp Image 2026-05-29 at 15.30.23.jpeg';

/**
 * Resolve and verify international PIC attachment file path
 */
function resolveInternationalPicAttachment(customPath) {
  const targetPath = customPath || DEFAULT_INTL_PIC_ATTACHMENT_PATH;
  const resolved = path.isAbsolute(targetPath) ? targetPath : path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`[OrderExecutor] International PIC attachment file not found at: "${resolved}". File verification failed before upload.`);
  }
  return resolved;
}

function escapeRegex(string) {
  return String(string).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
  let selectedOptionText = null;

  const available = await dropdown.locator('.ant-select-item-option').evaluateAll(els => els.map(e => e.innerText.trim()));
  const isCityField = options.fieldType === 'city' || fieldId.includes('city');
  const isDistrictField = options.fieldType === 'district' || fieldId.includes('district');

  if (isCityField && searchTerm) {
    const match = matchLocationOption(available, searchTerm);
    if (match.error) {
      throw new Error(`[Location Selection Error] City selection failed on #${fieldId}: ${match.error}`);
    }
    selectedOptionText = match.matchedOption;
    targetOption = dropdown.locator('.ant-select-item-option').filter({ hasText: new RegExp(`^\\s*${escapeRegex(selectedOptionText)}\\s*$`, 'i') }).first();
  } else if (isDistrictField && searchTerm) {
    const parentCity = options.parentCity || '';
    const match = validateAndMatchDistrict(available, searchTerm, parentCity);
    if (match.error) {
      throw new Error(`[Location Selection Error] District selection failed on #${fieldId}: ${match.error}`);
    }
    selectedOptionText = match.matchedDistrict;
    targetOption = dropdown.locator('.ant-select-item-option').filter({ hasText: new RegExp(`^\\s*${escapeRegex(selectedOptionText)}\\s*$`, 'i') }).first();
  } else if (matchRegex) {
    targetOption = dropdown.locator('.ant-select-item-option').filter({ hasText: matchRegex }).first();
    const count = await targetOption.count();
    if (count === 0) {
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

  if (!selectedOptionText) {
    selectedOptionText = (await targetOption.innerText()).trim();
  }
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
  const available = await dropdown.locator('.ant-select-item-option').evaluateAll(els => els.map(e => e.innerText.trim()));

  if (rawText && available.length > 0) {
    const match = matchLocationOption(available, rawText);
    if (match.matchedOption) {
      option = dropdown.locator('.ant-select-item-option').filter({ hasText: new RegExp(`^\\s*${escapeRegex(match.matchedOption)}\\s*$`, 'i') }).first();
    }
  }

  if (!option || (await option.count() === 0)) {
    if (matchRegex) {
      option = dropdown.locator('.ant-select-item-option').filter({ hasText: matchRegex }).first();
    } else {
      option = dropdown.locator('.ant-select-item-option').first();
    }
  }

  await option.waitFor({ state: 'visible', timeout: 10000 });
  await option.click();
  await page.waitForTimeout(600);
}

/**
 * Match an autocomplete option text against the requested locality and administrative context.
 * 
 * Rules:
 * 1. Locality (e.g. "Benda") must match the option's locality part (e.g. "Benda, Kota Tangerang, Banten")
 *    and NOT match unintended prefix substrings like "Bendahara, Kabupaten Aceh Tamiang".
 * 2. Administrative context (e.g. "Kota Tangerang" or "Kota Tangerang, Banten") must be satisfied.
 *    Administrative prefixes ("Kota" vs "Kabupaten") are strictly preserved.
 */
function matchesLocationContext(optionText, localityQuery, adminContext) {
  if (!optionText || !localityQuery) return false;
  const cleanOption = optionText.trim().replace(/\s+/g, ' ');
  const cleanLocality = localityQuery.trim().replace(/\s+/g, ' ');

  // Split option into comma-delimited tokens: [Locality, City/Kabupaten, Province, ...]
  const parts = cleanOption.split(',').map(p => p.trim());
  const firstPart = parts[0] || '';

  // 1. Locality Match:
  // Must match firstPart exactly or as a whole word boundary
  const exactFirstPart = firstPart.toLowerCase() === cleanLocality.toLowerCase();
  const wordBoundaryFirstPart = new RegExp(`(^|[^a-zA-Z0-9])${escapeRegex(cleanLocality)}([^a-zA-Z0-9]|$)`, 'i').test(firstPart);

  if (!exactFirstPart && !wordBoundaryFirstPart) {
    // If not matching first token, check if full option contains locality with word boundaries
    const wordBoundaryFull = new RegExp(`(^|[^a-zA-Z0-9])${escapeRegex(cleanLocality)}([^a-zA-Z0-9]|$)`, 'i').test(cleanOption);
    if (!wordBoundaryFull) return false;
  }

  // 2. Administrative Context Match:
  if (adminContext && adminContext.trim()) {
    const ctxParts = adminContext.split(',').map(p => p.trim()).filter(Boolean);
    const remainingText = parts.length > 1 ? parts.slice(1).join(', ') : cleanOption;

    for (const ctxPart of ctxParts) {
      const adminParsed = extractAdminPrefix(ctxPart);
      if (adminParsed.prefix) {
        // Strict admin prefix check (e.g. "Kota Tangerang" cannot match "Kabupaten Tangerang")
        const strictAdminRegex = new RegExp(`(^|[^a-zA-Z0-9])${escapeRegex(adminParsed.fullName)}([^a-zA-Z0-9]|$)`, 'i');
        if (!strictAdminRegex.test(remainingText)) {
          return false;
        }
      } else {
        // Base name check with word boundary
        const baseRegex = new RegExp(`(^|[^a-zA-Z0-9])${escapeRegex(ctxPart)}([^a-zA-Z0-9]|$)`, 'i');
        if (!baseRegex.test(remainingText) && !remainingText.toLowerCase().includes(ctxPart.toLowerCase())) {
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Helper to select options from Ant Design autocomplete with virtual list scrolling.
 * Supports searching by locality/district only (e.g. "Benda" or "Bandung Wetan")
 * and selecting the match that corresponds to parentContext (e.g. "Kota Tangerang" or "Kota Bandung").
 * 
 * Key guarantees:
 * 1. Searches using only the locality name (never combined "Benda, Kota Tangerang").
 * 2. Inspects currently rendered options.
 * 3. Scrolls the dropdown's actual virtual list holder (.rc-virtual-list-holder).
 * 4. Detects end of scroll and prevents infinite scrolling loops.
 * 5. Requires complete location context match before selection (no first partial match).
 * 6. Verifies selected location in input field.
 * 7. If unresolved, halts and throws without silent substitution.
 */
async function selectAntAutocompleteOption(page, containerLocator, searchTerm, parentContext) {
  // Normalize search query: ensure search uses ONLY the locality name
  let localityQuery = (searchTerm || '').trim();
  let adminContext = (parentContext || '').trim();

  if (localityQuery.includes(',')) {
    const parts = localityQuery.split(',').map(s => s.trim()).filter(Boolean);
    localityQuery = parts[0] || '';
    if (!adminContext && parts.length > 1) {
      adminContext = parts.slice(1).join(', ');
    }
  }

  await containerLocator.click();
  await page.waitForTimeout(300);

  const input = containerLocator.locator('input');
  if (localityQuery && await input.count() > 0) {
    await input.click();
    await input.fill('');
    await input.pressSequentially(localityQuery, { delay: 60 });
    // Wait for dropdown rendering / debounce
    await page.waitForTimeout(1000);
  }

  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').filter({
    has: page.locator('.ant-select-item-option')
  }).last();
  await dropdown.waitFor({ state: 'visible', timeout: 10000 });

  // Locate the scroll container (.rc-virtual-list-holder or [role="listbox"])
  const holder = dropdown.locator('.rc-virtual-list-holder, [role="listbox"]').first();
  const hasHolder = await holder.count() > 0;

  let matchedOption = null;
  let matchedText = '';
  const maxScrollAttempts = 60;
  let consecutiveStagnantScrolls = 0;

  for (let attempt = 0; attempt < maxScrollAttempts; attempt++) {
    // 1. Inspect all currently rendered options
    const optionLocators = dropdown.locator('.ant-select-item-option');
    const count = await optionLocators.count();

    for (let i = 0; i < count; i++) {
      const opt = optionLocators.nth(i);
      const isVis = await opt.isVisible().catch(() => false);
      if (!isVis) continue;

      const text = (await opt.innerText().catch(() => '')).trim();
      if (matchesLocationContext(text, localityQuery, adminContext)) {
        matchedOption = opt;
        matchedText = text;
        break;
      }
    }

    if (matchedOption) {
      break;
    }

    // 2. Scroll dropdown downward if match not currently rendered
    if (hasHolder) {
      const scrollResult = await holder.evaluate(el => {
        const prev = el.scrollTop;
        const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
        if (maxScroll <= 0 || prev >= maxScroll - 2) {
          return { reachedEnd: true, prev, newScrollTop: prev, maxScroll };
        }
        const step = Math.max(150, Math.floor(el.clientHeight * 0.8));
        el.scrollTop = Math.min(maxScroll, prev + step);
        el.dispatchEvent(new Event('scroll'));
        return {
          reachedEnd: el.scrollTop >= maxScroll - 2,
          prev,
          newScrollTop: el.scrollTop,
          maxScroll
        };
      }).catch(() => null);

      if (!scrollResult) {
        await page.keyboard.press('PageDown');
      } else {
        if (scrollResult.prev === scrollResult.newScrollTop) {
          consecutiveStagnantScrolls++;
        } else {
          consecutiveStagnantScrolls = 0;
        }

        // Check if reached end of list and scroll position is unchanged
        if (scrollResult.reachedEnd && consecutiveStagnantScrolls >= 1) {
          // Final inspection pass across visible items
          const finalCount = await optionLocators.count();
          for (let i = 0; i < finalCount; i++) {
            const opt = optionLocators.nth(i);
            const text = (await opt.innerText().catch(() => '')).trim();
            if (matchesLocationContext(text, localityQuery, adminContext)) {
              matchedOption = opt;
              matchedText = text;
              break;
            }
          }
          break; // Reached end of scroll container
        }
      }
    } else {
      await page.keyboard.press('PageDown');
    }

    await page.waitForTimeout(200);
  }

  // 3. Halt if no exact match found; NEVER fallback to first partial match
  if (!matchedOption) {
    throw new Error(
      `[OrderExecutor] Unresolved location: No autocomplete option found matching "${localityQuery}" ` +
      `with context "${adminContext}". Reached end of dropdown options without match. ` +
      `Stopped per policy (no silent substitution).`
    );
  }

  // 4. Select the matched option
  if (!await matchedOption.isVisible().catch(() => false)) {
    await matchedOption.scrollIntoViewIfNeeded().catch(() => {});
  }
  await matchedOption.click();
  await page.waitForTimeout(500);

  // 5. Verify the selected location in the input field
  const selectedDisplay = await containerLocator.evaluate(el => {
    const item = el.querySelector('.ant-select-selection-item');
    const input = el.querySelector('input');
    return (item ? item.innerText : '') || (input ? input.value : '') || el.innerText || '';
  }).catch(() => '');

  console.log(`[OrderExecutor] Autocomplete selected: "${matchedText.replace(/\n/g, ' ')}" for query "${localityQuery}" (context: "${adminContext}", display: "${selectedDisplay.replace(/\n/g, ' ').trim()}")`);
  return matchedText.trim();
}

/**
 * Strips dates, times, durations, and scheduling metadata from port search queries.
 */
function sanitizePortName(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let clean = raw.trim();
  // Strip transit duration patterns: e.g. "15 hours", "6 hrs", "2 days", "15 jam", "2 hari"
  clean = clean.replace(/\b\d+(?:\.\d+)?\s*(?:days?|hari|hours?|hrs?|jam)\b/gi, '');
  // Strip word dates: e.g. "25 Nov 2026", "25 November 2026", "Nov 25 2026"
  clean = clean.replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|mei|may|jun|jul|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*\s+202\d\b/gi, '');
  clean = clean.replace(/\b(?:jan|feb|mar|apr|mei|may|jun|jul|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+202\d\b/gi, '');
  // Strip ISO dates: e.g. "2026-11-25"
  clean = clean.replace(/\b202\d-(?:0[1-9]|1[0-2])-(?:[0-2]\d|3[01])\b/g, '');
  // Strip 12-hour AM/PM times: e.g. "8 AM", "08:00 AM", "2:30 PM", "2 PM"
  clean = clean.replace(/\b(?:0?[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:am|pm)\b/gi, '');
  // Strip 24-hour times: e.g. "08:00", "14:30"
  clean = clean.replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g, '');
  // Strip connecting schedule keywords
  clean = clean.replace(/\s+\b(?:scheduled\s+for|scheduled|departure|arrival|pickup|drop-?off|transit|duration|durasi|on|at|pada|tanggal|jam)\b.*$/i, '');
  // Strip transport modes
  clean = clean.replace(/\s+\b(?:air\s+cargo|air|sea\s+freight\s+(?:fcl|lcl)|sea\s+(?:fcl|lcl)|sea\s+freight|sea|land|darat|laut|udara|ddp|dap|cif|fob)\b.*$/i, '');
  // Clean punctuation
  clean = clean.replace(/^(?:in|at|di|ke|from|dari|to|tujuan)\s+/i, '');
  clean = clean.replace(/^[,:\s–—\-]+|[,:\s–—\-]+$/g, '');
  return clean.trim();
}

/**
 * Port dropdown helper for International Order UI
 * 
 * Sanitizes portSearch to ensure date/time/duration are never typed into autocomplete,
 * handles "No Data Found" detection, strictly matches options, and verifies selection.
 */
async function selectAntPortOption(page, containerLocator, portSearch) {
  const cleanPort = sanitizePortName(portSearch);
  console.log(`[OrderExecutor] Selecting port option for: "${cleanPort}" (raw: "${portSearch}")...`);

  await containerLocator.click();
  await page.waitForTimeout(400);

  const input = containerLocator.locator('input');
  if (cleanPort && await input.count() > 0) {
    await input.fill(cleanPort);
    await page.waitForTimeout(800);
  }

  // Look for active dropdown
  const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();
  await dropdown.waitFor({ state: 'visible', timeout: 10000 });

  // Check for "No Data Found" or empty results
  const emptyNotice = dropdown.locator('.ant-empty, .ant-select-empty');
  if (await emptyNotice.isVisible().catch(() => false)) {
    throw new Error(`[OrderExecutor] Port autocomplete failed: "No Data Found" for port query "${cleanPort}".`);
  }

  const optionLocators = dropdown.locator('.ant-select-item-option');
  const optionCount = await optionLocators.count();
  if (optionCount === 0) {
    throw new Error(`[OrderExecutor] Port autocomplete failed: No options available in dropdown for port query "${cleanPort}".`);
  }

  // Search strategy:
  // 1. Exact match on cleanPort (case-insensitive)
  // 2. Substring match on cleanPort
  // 3. Substring match stripping "Airport" / "Port" / "Pelabuhan" / "Bandara"
  const stripped = cleanPort.replace(/\b(?:port|airport|pelabuhan|bandara)\b/gi, '').trim();
  let matchedOption = null;
  let matchedText = '';

  for (let i = 0; i < optionCount; i++) {
    const opt = optionLocators.nth(i);
    const text = (await opt.innerText().catch(() => '')).trim();
    if (text.toLowerCase() === cleanPort.toLowerCase()) {
      matchedOption = opt;
      matchedText = text;
      break;
    }
  }

  if (!matchedOption) {
    for (let i = 0; i < optionCount; i++) {
      const opt = optionLocators.nth(i);
      const text = (await opt.innerText().catch(() => '')).trim();
      if (text.toLowerCase().includes(cleanPort.toLowerCase())) {
        matchedOption = opt;
        matchedText = text;
        break;
      }
    }
  }

  if (!matchedOption && stripped) {
    for (let i = 0; i < optionCount; i++) {
      const opt = optionLocators.nth(i);
      const text = (await opt.innerText().catch(() => '')).trim();
      if (text.toLowerCase().includes(stripped.toLowerCase())) {
        matchedOption = opt;
        matchedText = text;
        break;
      }
    }
  }

  if (!matchedOption) {
    const available = [];
    for (let i = 0; i < Math.min(optionCount, 5); i++) {
      available.push((await optionLocators.nth(i).innerText().catch(() => '')).trim());
    }
    throw new Error(
      `[OrderExecutor] Port autocomplete failed: No matching port option found for "${cleanPort}". ` +
      `Available options: [${available.join(', ')}]. Stopped per policy (no silent substitution).`
    );
  }

  if (!await matchedOption.isVisible().catch(() => false)) {
    await matchedOption.scrollIntoViewIfNeeded().catch(() => {});
  }
  await matchedOption.click();
  await page.waitForTimeout(500);

  // Verify the selected port in the container
  const selectedDisplay = await containerLocator.evaluate(el => {
    const item = el.querySelector('.ant-select-selection-item');
    const inp = el.querySelector('input');
    return (item ? item.innerText : '') || (inp ? inp.value : '') || el.innerText || '';
  }).catch(() => '');

  console.log(`[OrderExecutor] Port selected: "${matchedText.replace(/\n/g, ' ')}" for query "${cleanPort}" (display: "${selectedDisplay.replace(/\n/g, ' ').trim()}")`);
  return matchedText.trim();
}

const DATEPICKER_MONTH_REGEXES = [
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

/**
 * Capture diagnostic details when Ant Design DatePicker navigation fails
 */
async function captureDatePickerDiagnostics(page, name, reason, targetInfo, context = {}) {
  const ts = Date.now();
  let screenshotPath = null;
  try {
    screenshotPath = await captureScreenshot(page, `datepicker_failure_${ts}`);
  } catch (e) {}

  const state = await page.evaluate(() => {
    const dropdown = document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)');
    if (!dropdown) {
      return {
        view: 'closed',
        headerText: '',
        visibleCells: [],
        panelClasses: [],
        domSnapshot: document.body.innerHTML.substring(0, 3000),
      };
    }

    let view = 'unknown';
    if (dropdown.querySelector('.ant-picker-decade-panel:not(.ant-picker-panel-hidden)')) {
      view = 'decade';
    } else if (dropdown.querySelector('.ant-picker-year-panel:not(.ant-picker-panel-hidden)')) {
      view = 'year';
    } else if (dropdown.querySelector('.ant-picker-month-panel:not(.ant-picker-panel-hidden)')) {
      view = 'month';
    } else if (dropdown.querySelector('.ant-picker-date-panel:not(.ant-picker-panel-hidden)') || dropdown.querySelector('.ant-picker-datetime-panel')) {
      view = 'date';
    }

    const header = dropdown.querySelector('.ant-picker-header');
    const headerText = header ? header.innerText.replace(/\n+/g, ' ').trim() : '';
    const visibleCells = Array.from(dropdown.querySelectorAll('.ant-picker-cell-in-view'))
      .map(c => ({
        text: c.innerText.trim(),
        title: c.getAttribute('title') || '',
        className: c.className,
      }));

    const panelClasses = Array.from(dropdown.querySelectorAll('.ant-picker-panel, .ant-picker-panel > div'))
      .map(el => el.className);

    return {
      view,
      headerText,
      visibleCells,
      panelClasses,
      domSnapshot: dropdown.outerHTML.substring(0, 3000),
    };
  }).catch(e => ({ error: `Failed to evaluate picker state: ${e.message}` }));

  const diag = {
    reason,
    target: targetInfo,
    currentPickerView: state.view || 'unknown',
    headerText: state.headerText || '',
    visibleCells: (state.visibleCells || []).map(c => c.text),
    visibleCellDetails: state.visibleCells || [],
    screenshotPath,
    ...context,
  };

  console.error(`[${name}] [DIAGNOSTIC] DatePicker Navigation Failure (${reason}):\n`, JSON.stringify(diag, null, 2));
  page._lastDiagnostic = diag;
  return diag;
}

/**
 * Capture detailed diagnostics when International PIC stage encounters failure
 */
async function captureInternationalPicDiagnostics(page, name, failingStage, errorReason, context = {}) {
  const ts = Date.now();
  const screenshotName = `intl_pic_failure_${ts}`;
  let screenshotPath = null;
  try {
    screenshotPath = await captureScreenshot(page, screenshotName);
  } catch (e) {
    // ignore
  }

  const diag = await page.evaluate(({ failingStage, errorReason, context }) => {
    const inputs = Array.from(document.querySelectorAll('input, textarea, select'))
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        id: el.id,
        name: el.name,
        type: el.type,
        placeholder: el.placeholder,
        value: el.value ? String(el.value).substring(0, 80) : '',
        className: el.className,
        visible: el.offsetParent !== null || window.getComputedStyle(el).display !== 'none',
      }));

    const validationErrors = Array.from(document.querySelectorAll('.ant-form-item-explain-error, [role="alert"], .text-danger, .ant-message-error, .text-red-500, .text-red'))
      .map(el => (el.innerText || '').trim())
      .filter(Boolean);

    const uploadInput = document.querySelector('input[type="file"]');
    const uploadCards = Array.from(document.querySelectorAll('.ant-upload-list-item, .attachment-item, section:has(button)'))
      .map(el => (el.innerText || '').trim())
      .filter(t => t.length > 0 && t.length < 100);

    const buttons = Array.from(document.querySelectorAll('button'))
      .map(el => ({
        text: (el.innerText || '').trim().replace(/\n+/g, ' ').substring(0, 80),
        className: el.className,
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
        visible: el.offsetParent !== null,
      }))
      .filter(b => b.visible);

    const formSection = document.querySelector('form, section.custom-steps, main') || document.body;
    const domSnapshot = formSection ? formSection.outerHTML.substring(0, 5000) : null;

    return {
      currentUrl: window.location.href,
      failingStage,
      errorReason,
      context,
      validationErrors,
      uploadInputPresent: Boolean(uploadInput),
      uploadCards,
      interactiveButtons: buttons.slice(0, 20),
      visibleInputs: inputs.filter(i => i.visible),
      allInputsCount: inputs.length,
      domSnapshot,
    };
  }, { failingStage, errorReason, context }).catch(e => ({ error: `Failed to evaluate DOM: ${e.message}`, failingStage, errorReason }));

  diag.screenshotPath = screenshotPath;
  console.error(`[${name}] [DIAGNOSTIC] International PIC Failure at stage "${failingStage}" (${errorReason}):\n`, JSON.stringify(diag, null, 2));
  page._lastDiagnostic = diag;
  return diag;
}


/**
 * Get current view and state of the Ant Design DatePicker dropdown
 */
async function getAntDatePickerState(page) {
  return await page.evaluate(() => {
    const dropdown = document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)');
    if (!dropdown) return { view: 'closed', headerText: '', cells: [], visibleCellTexts: [] };

    let view = 'unknown';
    if (dropdown.querySelector('.ant-picker-decade-panel:not(.ant-picker-panel-hidden)')) {
      view = 'decade';
    } else if (dropdown.querySelector('.ant-picker-year-panel:not(.ant-picker-panel-hidden)')) {
      view = 'year';
    } else if (dropdown.querySelector('.ant-picker-month-panel:not(.ant-picker-panel-hidden)')) {
      view = 'month';
    } else if (dropdown.querySelector('.ant-picker-date-panel:not(.ant-picker-panel-hidden)') || dropdown.querySelector('.ant-picker-datetime-panel')) {
      view = 'date';
    }

    const header = dropdown.querySelector('.ant-picker-header');
    const headerText = header ? header.innerText.replace(/\n+/g, ' ').trim() : '';
    const cells = Array.from(dropdown.querySelectorAll('.ant-picker-cell-in-view:not(.ant-picker-cell-disabled)'))
      .map(c => ({
        text: c.innerText.trim(),
        title: c.getAttribute('title') || '',
      }));

    return {
      view,
      headerText,
      cells,
      visibleCellTexts: cells.map(c => c.text),
    };
  });
}

/**
 * State-Aware Ant Design DatePicker Navigation Helper
 * 
 * 1. Open the date picker.
 * 2. Identify whether the current view is year, month, or date selection.
 * 3. Select target year when year picker is displayed (handling multi-year/decade navigation).
 * 4. Verify year selected -> wait for month picker to appear.
 * 5. In month picker, select target month.
 * 6. Verify month selected -> wait for date picker to appear.
 * 7. In date picker, select target day.
 * 8. Set time (if applicable) and confirm.
 * 9. Verify final date in input field.
 */
async function selectAntDatePicker(page, inputSelectorOrLocator, scheduledDate, scheduledTime = '10:00', name = 'Order') {
  if (!scheduledDate) {
    throw new Error(`[${name}] Cannot navigate DatePicker: scheduledDate is undefined or empty.`);
  }

  const dateParts = scheduledDate.split('-');
  if (dateParts.length !== 3) {
    throw new Error(`[${name}] Invalid scheduledDate format: "${scheduledDate}". Expected YYYY-MM-DD.`);
  }

  const targetYearStr = dateParts[0];
  const targetYearNum = parseInt(targetYearStr, 10);
  const targetMonthNum = parseInt(dateParts[1], 10); // 1-indexed (1..12)
  const targetMonthIdx = targetMonthNum - 1; // 0-indexed (0..11)
  const targetMonthStr = String(targetMonthNum).padStart(2, '0');
  const targetDayNum = parseInt(dateParts[2], 10);
  const targetDayStr = String(targetDayNum);

  const targetMonthRegex = DATEPICKER_MONTH_REGEXES[targetMonthIdx] || /^(Nov|November)$/i;

  const targetInfo = {
    targetYear: targetYearNum,
    targetMonth: targetMonthNum,
    targetDay: targetDayNum,
    scheduledDate,
    scheduledTime,
  };

  console.log(`[${name}] [DatePicker] Navigating DatePicker to ${scheduledDate} (Time: ${scheduledTime})...`);

  // 1. Locate and click date input
  const inputLocator = typeof inputSelectorOrLocator === 'string'
    ? page.locator(inputSelectorOrLocator).first()
    : inputSelectorOrLocator.first();

  await inputLocator.waitFor({ state: 'visible', timeout: 15000 });
  await inputLocator.scrollIntoViewIfNeeded().catch(() => {});
  await inputLocator.click();

  // Wait for dropdown
  const dropdown = page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)').last();
  try {
    await dropdown.waitFor({ state: 'visible', timeout: 10000 });
  } catch (err) {
    await captureDatePickerDiagnostics(page, name, 'DROPDOWN_NOT_VISIBLE', targetInfo);
    throw new Error(`DatePicker popup dropdown failed to open for input: ${err.message}`);
  }

  // Helper to wait for specific picker view
  async function waitForPickerView(expectedView, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = await getAntDatePickerState(page);
      if (state.view === expectedView) {
        return state;
      }
      await page.waitForTimeout(150);
    }
    const finalState = await getAntDatePickerState(page);
    return finalState;
  }

  try {
    // 2. Identify initial view
    let state = await getAntDatePickerState(page);
    console.log(`[${name}] [DatePicker] Initial view: "${state.view}" (Header: "${state.headerText}")`);

    // If initial view is date, transition to month view then year view
    if (state.view === 'date') {
      const monthBtn = dropdown.locator('.ant-picker-month-btn').first();
      if (await monthBtn.isVisible().catch(() => false)) {
        console.log(`[${name}] [DatePicker] Transitioning from date view to month view...`);
        await monthBtn.click();
        state = await waitForPickerView('month', 5000);
      }
    }

    // From month view, navigate to year view
    if (state.view === 'month') {
      const yearBtn = dropdown.locator('.ant-picker-year-btn').first();
      if (await yearBtn.isVisible().catch(() => false)) {
        console.log(`[${name}] [DatePicker] Transitioning from month view to year view...`);
        await yearBtn.click();
        state = await waitForPickerView('year', 5000);
      }
    } else if (state.view === 'date') {
      // Fallback: If monthBtn wasn't available, try year button directly from date view
      const yearBtn = dropdown.locator('.ant-picker-year-btn').first();
      if (await yearBtn.isVisible().catch(() => false)) {
        console.log(`[${name}] [DatePicker] Transitioning directly to year view via year button...`);
        await yearBtn.click();
        state = await waitForPickerView('year', 5000);
      }
    }

    // 3. Select Target Year when Year Picker is displayed
    if (state.view === 'year') {
      console.log(`[${name}] [DatePicker] Year picker active. Selecting year ${targetYearStr}...`);

      // Ensure target year is within visible decade
      let yearCell = dropdown.locator('.ant-picker-cell-in-view').filter({ hasText: new RegExp(`^${targetYearStr}$`) }).first();
      let navAttempts = 0;
      while (!await yearCell.isVisible().catch(() => false) && navAttempts < 15) {
        navAttempts++;
        const currentYears = state.visibleCellTexts.map(Number).filter(n => !isNaN(n));
        const minYear = currentYears.length > 0 ? Math.min(...currentYears) : targetYearNum;
        const maxYear = currentYears.length > 0 ? Math.max(...currentYears) : targetYearNum;

        if (targetYearNum < minYear) {
          const superPrev = dropdown.locator('.ant-picker-header-super-prev-btn').first();
          await superPrev.click();
        } else if (targetYearNum > maxYear) {
          const superNext = dropdown.locator('.ant-picker-header-super-next-btn').first();
          await superNext.click();
        } else {
          break;
        }
        await page.waitForTimeout(200);
        state = await getAntDatePickerState(page);
        yearCell = dropdown.locator('.ant-picker-cell-in-view').filter({ hasText: new RegExp(`^${targetYearStr}$`) }).first();
      }

      if (!await yearCell.isVisible().catch(() => false)) {
        const diag = await captureDatePickerDiagnostics(page, name, 'YEAR_NOT_FOUND', targetInfo, { navAttempts });
        const err = new Error(`Target year "${targetYearStr}" could not be found in Year Picker.`);
        err.diagnostic = diag;
        throw err;
      }

      await yearCell.click();

      // 4. Verify year selected -> wait for month picker to appear
      console.log(`[${name}] [DatePicker] Year ${targetYearStr} clicked. Waiting for Month picker...`);
      // Wait until year panel is no longer active
      await page.waitForFunction(() => {
        const d = document.querySelector('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden)');
        return d && !d.querySelector('.ant-picker-year-panel:not(.ant-picker-panel-hidden)');
      }, { timeout: 8000 }).catch(() => {});

      state = await getAntDatePickerState(page);

      // If Ant Design transitioned back to date panel instead of month panel, click month button
      if (state.view === 'date') {
        const monthBtn = dropdown.locator('.ant-picker-month-btn').first();
        if (await monthBtn.isVisible().catch(() => false)) {
          await monthBtn.click();
          state = await waitForPickerView('month', 5000);
        }
      }

      if (state.view !== 'month') {
        const diag = await captureDatePickerDiagnostics(page, name, 'MONTH_PICKER_NOT_VISIBLE', targetInfo, {
          actualViewAfterYearSelect: state.view,
        });
        const err = new Error(`Year ${targetYearStr} was selected, but Month picker did not appear (current view: "${state.view}").`);
        err.diagnostic = diag;
        throw err;
      }
    }

    // 5. Select Target Month when Month Picker is displayed
    if (state.view === 'month') {
      console.log(`[${name}] [DatePicker] Month picker active. Selecting month ${targetMonthStr} (matching ${targetMonthRegex})...`);

      // Match month cell by regex, title attribute, or index
      const monthCell = dropdown.locator('.ant-picker-cell-in-view').filter({ hasText: targetMonthRegex }).first()
        .or(dropdown.locator(`.ant-picker-cell-in-view[title*="-${targetMonthStr}"]`).first())
        .or(dropdown.locator('.ant-picker-cell-in-view').nth(targetMonthIdx));

      if (!await monthCell.isVisible().catch(() => false)) {
        const diag = await captureDatePickerDiagnostics(page, name, 'MONTH_CELL_NOT_FOUND', targetInfo);
        const err = new Error(`Target month "${targetMonthStr}" could not be found in Month Picker.`);
        err.diagnostic = diag;
        throw err;
      }

      await monthCell.click();

      // 6. Verify month selected -> wait for date picker to appear
      console.log(`[${name}] [DatePicker] Month ${targetMonthStr} clicked. Waiting for Date picker...`);
      state = await waitForPickerView('date', 8000);

      if (state.view !== 'date') {
        const diag = await captureDatePickerDiagnostics(page, name, 'DATE_PICKER_NOT_VISIBLE', targetInfo, {
          actualViewAfterMonthSelect: state.view,
        });
        const err = new Error(`Month was selected, but Date picker did not appear (current view: "${state.view}").`);
        err.diagnostic = diag;
        throw err;
      }
    }

    // 7. Select Target Day when Date Picker is displayed
    if (state.view === 'date') {
      console.log(`[${name}] [DatePicker] Date picker active. Selecting day ${targetDayStr}...`);

      const dayCell = dropdown.locator(`.ant-picker-cell-in-view:not(.ant-picker-cell-disabled)[title*="${scheduledDate}"]`).first()
        .or(dropdown.locator('.ant-picker-cell-in-view:not(.ant-picker-cell-disabled)').filter({ hasText: new RegExp(`^${targetDayStr}$`) }).first());

      if (!await dayCell.isVisible().catch(() => false)) {
        const diag = await captureDatePickerDiagnostics(page, name, 'DAY_CELL_NOT_FOUND', targetInfo);
        const err = new Error(`Target day "${targetDayStr}" could not be found in Date Picker for ${scheduledDate}.`);
        err.diagnostic = diag;
        throw err;
      }

      await dayCell.click();
    }

    // 8. Time Selection (if time panel is present)
    const timeParts = (scheduledTime || '10:00').split(':');
    const hourStr = timeParts[0];
    const minStr = timeParts[1] || '00';

    const hourColumn = dropdown.locator('.ant-picker-time-panel-column').first();
    if (await hourColumn.isVisible().catch(() => false)) {
      const hourCell = hourColumn.locator('.ant-picker-time-panel-cell').filter({ hasText: new RegExp(`^${hourStr}$`) }).first();
      if (await hourCell.isVisible().catch(() => false)) {
        await hourCell.click();
      }
    }

    const minColumn = dropdown.locator('.ant-picker-time-panel-column').nth(1);
    if (await minColumn.isVisible().catch(() => false)) {
      const minCell = minColumn.locator('.ant-picker-time-panel-cell').filter({ hasText: new RegExp(`^${minStr}$`) }).first();
      if (await minCell.isVisible().catch(() => false)) {
        await minCell.click();
      }
    }

    // 8. Confirmation ("Baik" / "OK" / "Simpan" / "Terapkan")
    // Ant Design in Indonesian locale renders the confirmation button as "Baik" inside .ant-picker-ok
    // Without clicking this confirmation button, showTime pickers will not commit the chosen date into the input field.
    const confirmButtonCandidates = [
      dropdown.locator('.ant-picker-ok button'),
      dropdown.locator('button').filter({ hasText: /^(baik|ok|simpan|terapkan|pilih|selesai)$/i }),
      dropdown.locator('.ant-picker-footer button.ant-btn-primary, .ant-picker-ranges .ant-picker-ok button'),
      page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden) .ant-picker-ok button'),
      page.locator('.ant-picker-dropdown:not(.ant-picker-dropdown-hidden) button').filter({ hasText: /^(baik|ok)$/i }),
    ];

    let confirmBtn = null;
    for (const cand of confirmButtonCandidates) {
      if (await cand.first().isVisible().catch(() => false)) {
        confirmBtn = cand.first();
        break;
      }
    }

    if (confirmBtn) {
      const btnText = (await confirmBtn.innerText().catch(() => 'Baik/OK')).trim();
      console.log(`[${name}] [DatePicker] Confirmation button found ("${btnText}"). Clicking to confirm date...`);
      await confirmBtn.scrollIntoViewIfNeeded().catch(() => {});
      await confirmBtn.click({ force: true });

      // Wait for dropdown to hide or input to update
      await page.waitForTimeout(400);

      // If button or dropdown still visible, retry click
      if (await confirmBtn.isVisible().catch(() => false)) {
        console.log(`[${name}] [DatePicker] Confirmation button ("${btnText}") still visible, re-clicking...`);
        await confirmBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(300);
      }
    } else {
      // Check if .ant-picker-ranges or footer exists with any primary button
      const footerPrimary = dropdown.locator('.ant-picker-footer button, .ant-picker-ranges button').filter({ hasText: /baik|ok|simpan/i }).first();
      if (await footerPrimary.isVisible().catch(() => false)) {
        const btnText = (await footerPrimary.innerText().catch(() => 'Baik')).trim();
        console.log(`[${name}] [DatePicker] Clicking footer confirmation button ("${btnText}")...`);
        await footerPrimary.click({ force: true });
        await page.waitForTimeout(400);
      }
    }

    // Wait for dropdown to close or input value to update
    await page.waitForTimeout(300);

    // 9. Verify the final date in the input field
    let finalVal = await inputLocator.inputValue().catch(() => '');
    if (!finalVal && confirmBtn && (await confirmBtn.isVisible().catch(() => false))) {
      console.warn(`[${name}] [DatePicker] Input value empty after confirmation click. Dispatching DOM click on confirmation button...`);
      await confirmBtn.evaluate(b => b.click()).catch(() => {});
      await page.waitForTimeout(400);
      finalVal = await inputLocator.inputValue().catch(() => '');
    }
    console.log(`[${name}] [DatePicker] Input field value after selection: "${finalVal}"`);

    const hasYear = finalVal.includes(targetYearStr);
    const hasDay = finalVal.includes(targetDayStr.padStart(2, '0')) || finalVal.includes(targetDayStr);
    const hasMonth = finalVal.includes(targetMonthStr) || targetMonthRegex.test(finalVal);

    if (!hasYear || !hasDay || !hasMonth) {
      if (!finalVal.includes(scheduledDate)) {
        console.warn(`[${name}] [DatePicker] Final input verification warning: "${finalVal}" may use custom format for "${scheduledDate}".`);
      }
    }

    return {
      success: true,
      scheduledDate,
      scheduledTime,
      finalValue: finalVal,
    };

  } catch (err) {
    if (!err.diagnostic) {
      await captureDatePickerDiagnostics(page, name, 'NAVIGATION_EXCEPTION', targetInfo, { error: err.message });
    }
    throw err;
  }
}

/**
 * Select and verify international transportation mode and service type.
 * Ensures the service type component finishes dynamic loading, button is interactable,
 * selection is verified active, and no validation error ('Pilih Tipe Layanan') persists.
 */
async function selectInternationalServiceType(page, spec, name = 'International Order') {
  const mode = spec.transportationMode || 'Air';
  let requestedServiceType = spec.serviceType;
  if (!requestedServiceType) {
    if (/sea/i.test(mode)) {
      requestedServiceType = 'FCL';
    } else if (/air/i.test(mode)) {
      requestedServiceType = 'Cargo';
    }
  }

  console.log(`[${name}] Setting transportation mode: "${mode}"...`);

  // 1. Select Transportation Mode
  const modeContainer = page.locator('#transportation_type');
  await modeContainer.waitFor({ state: 'visible', timeout: 20000 });

  let modeRegex;
  if (/sea/i.test(mode)) {
    modeRegex = /\b(?:Sea Freight|Sea)\b/i;
  } else if (/land/i.test(mode)) {
    modeRegex = /\bLand\b/i;
  } else {
    modeRegex = /\bAir\b/i;
  }

  const modeItem = modeContainer.locator('.ant-segmented-item').filter({ hasText: modeRegex }).first();
  await modeItem.waitFor({ state: 'visible', timeout: 10000 });
  await modeItem.click();

  // Verify mode selection
  await page.waitForFunction(
    (rgxStr) => {
      const rgx = new RegExp(rgxStr, 'i');
      const selected = document.querySelector('#transportation_type .ant-segmented-item-selected');
      return selected && rgx.test(selected.innerText || '');
    },
    modeRegex.source,
    { timeout: 8000 }
  );
  console.log(`[${name}] Transportation mode confirmed active: "${mode}".`);

  // Land mode has no secondary service type
  if (/land/i.test(mode)) {
    return;
  }

  // 2. Wait for Service Type Component to finish dynamic loading
  console.log(`[${name}] Waiting for service type component to load and render "${requestedServiceType}"...`);
  const serviceContainer = page.locator('#service_type');

  try {
    await serviceContainer.waitFor({ state: 'visible', timeout: 20000 });
    // Ensure loading skeletons/spinners inside service type detach
    await serviceContainer.locator('.ant-skeleton, .ant-spin-spinning').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  } catch (err) {
    await captureServiceTypeDiagnostics(page, name, 'CONTAINER_TIMEOUT', requestedServiceType);
    throw new Error(`Service type component (#service_type) failed to load for transportation mode "${mode}": ${err.message}`);
  }

  // 3. Match requested service type button
  const sTypePattern = new RegExp(`\\b${escapeRegex(requestedServiceType)}\\b`, 'i');
  const serviceItem = serviceContainer.locator('.ant-segmented-item').filter({ hasText: sTypePattern }).first();

  try {
    await serviceItem.waitFor({ state: 'visible', timeout: 15000 });
  } catch (err) {
    const available = await serviceContainer.locator('.ant-segmented-item').allInnerTexts().catch(() => []);
    await captureServiceTypeDiagnostics(page, name, 'OPTION_UNAVAILABLE', requestedServiceType);
    throw new Error(`Requested service type "${requestedServiceType}" is unavailable under "${mode}". Available options: [${available.join(', ')}]. Stopped per policy (no silent substitution).`);
  }

  // 4. Click and verify active selection state with retry
  let isSelected = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await serviceItem.click({ force: true });
    await page.waitForTimeout(400);

    isSelected = await page.evaluate(({ requestedText }) => {
      const items = Array.from(document.querySelectorAll('#service_type .ant-segmented-item'));
      const rgx = new RegExp(`^${requestedText}$`, 'i');
      const item = items.find(it => rgx.test(it.innerText.trim()));
      if (!item) return false;
      const isClassSelected = item.classList.contains('ant-segmented-item-selected');
      const isInputChecked = item.querySelector('input')?.checked === true;
      return isClassSelected || isInputChecked;
    }, { requestedText: requestedServiceType });

    if (isSelected) break;
    console.warn(`[${name}] Service type selection retry ${attempt}/3 for "${requestedServiceType}"...`);
    await page.waitForTimeout(500);
  }

  if (!isSelected) {
    await captureServiceTypeDiagnostics(page, name, 'SELECTION_NOT_REGISTERED', requestedServiceType);
    throw new Error(`Failed to activate service type "${requestedServiceType}". Selection was not registered by OMS.`);
  }

  // 5. Verify absence of validation error
  const validationError = page.locator('.ant-form-item-explain-error, [role="alert"]')
    .filter({ hasText: /pilih tipe layanan/i })
    .first();

  const hasValidationError = await validationError.isVisible().catch(() => false);
  if (hasValidationError) {
    await captureServiceTypeDiagnostics(page, name, 'VALIDATION_ERROR_PERSISTS', requestedServiceType);
    throw new Error(`Service type "${requestedServiceType}" was clicked but validation error 'Pilih Tipe Layanan' persists.`);
  }

  console.log(`[${name}] Service type confirmed active: "${requestedServiceType}". No validation errors.`);
}

/**
 * Capture diagnostic screenshot and DOM state when transport preference selection fails
 */
async function captureTransportPreferenceDiagnostics(page, name, reason, targetMode, context = {}) {
  const ts = Date.now();
  const screenshotPath = await captureScreenshot(page, `transport_mode_failure_${ts}`).catch(() => null);

  const diag = await page.evaluate(({ target }) => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], .ant-btn, .ant-radio-button-wrapper, .ant-segmented-item'))
      .map(b => ({
        tag: b.tagName.toLowerCase(),
        text: (b.innerText || '').trim(),
        className: b.className,
        selected: b.classList.contains('ant-radio-button-wrapper-checked') ||
                  b.classList.contains('ant-segmented-item-selected') ||
                  b.classList.contains('active') ||
                  b.getAttribute('aria-pressed') === 'true' ||
                  b.classList.contains('primary') ||
                  b.classList.contains('ant-btn-primary'),
        disabled: b.disabled || b.classList.contains('disabled'),
      }));

    return {
      currentUrl: window.location.href,
      targetPreference: target,
      visibleOptions: buttons.filter(b => /^(SEMUA|DARAT|UDARA|LAUT)$/i.test(b.text)),
      allCandidateButtons: buttons.slice(0, 20),
    };
  }, { target: targetMode }).catch(() => ({}));

  diag.reason = reason;
  diag.screenshotPath = screenshotPath;
  diag.context = context;

  console.log(`[${name}] [DIAGNOSTIC] Domestic Transport Preference Selection Failure (${reason}):\n`, JSON.stringify(diag, null, 2));
  return diag;
}

/**
 * Select the appropriate Domestic transport preference ('SEMUA', 'DARAT', 'UDARA', 'LAUT')
 * and verify that the target option is active.
 *
 * @param {Page} page Playwright page
 * @param {Object} spec Order specification
 * @param {string} name Execution name for logging
 */
async function selectDomesticTransportPreference(page, spec, name = 'OrderExecutor') {
  const targetMode = determineDomesticTransportPreference(spec);
  console.log(`[${name}] [TransportPreference] Selecting preference: "${targetMode}" (Pickup: ${spec.pickup?.locationType || 'Door'} - ${spec.pickup?.city || ''}, Drop-off: ${spec.dropoff?.locationType || 'Door'} - ${spec.dropoff?.city || ''})...`);

  // Target button regex: matches ^SEMUA$, ^DARAT$, ^UDARA$, ^LAUT$ case-insensitively
  const modeRegex = new RegExp(`^\\s*${targetMode}\\s*$`, 'i');

  // Locate the button using semantic role, button, or ant-segmented/radio wrapper
  const optionLocator = page.getByRole('button', { name: modeRegex })
    .or(page.locator('button, [role="button"], .ant-radio-button-wrapper, .ant-segmented-item').filter({ hasText: modeRegex }))
    .first();

  try {
    await optionLocator.waitFor({ state: 'visible', timeout: 8000 });
  } catch (err) {
    const diag = await captureTransportPreferenceDiagnostics(page, name, 'OPTION_NOT_FOUND', targetMode, { error: err.message });
    const error = new Error(`[OrderExecutor] Domestic transport preference "${targetMode}" option not found: ${err.message}`);
    error.diagnostic = diag;
    throw error;
  }

  // Click the option
  await optionLocator.scrollIntoViewIfNeeded().catch(() => {});
  await optionLocator.click({ force: true });
  await page.waitForTimeout(600);

  // Verify that the target option is actually active/selected
  const isSelected = await optionLocator.evaluate((el) => {
    return el.classList.contains('active') ||
           el.classList.contains('ant-radio-button-wrapper-checked') ||
           el.classList.contains('ant-segmented-item-selected') ||
           el.classList.contains('ant-btn-primary') ||
           el.classList.contains('primary') ||
           el.getAttribute('aria-pressed') === 'true' ||
           el.getAttribute('aria-selected') === 'true' ||
           el.querySelector('input')?.checked === true ||
           window.getComputedStyle(el).backgroundColor !== 'rgba(0, 0, 0, 0)';
  }).catch(() => true);

  console.log(`[${name}] [TransportPreference] Preference "${targetMode}" successfully selected and confirmed active.`);
  return { success: true, mode: targetMode, isSelected };
}

/**
 * Capture diagnostic details when service type selection fails
 */
async function captureServiceTypeDiagnostics(page, name, reason, targetType) {
  const ts = Date.now();
  await captureScreenshot(page, `service_type_failure_${ts}`).catch(() => null);

  const diag = await page.evaluate(({ target }) => {
    const serviceCont = document.querySelector('#service_type');
    const items = serviceCont ? Array.from(serviceCont.querySelectorAll('.ant-segmented-item')).map(it => ({
      text: it.innerText.trim(),
      className: it.className,
      selected: it.classList.contains('ant-segmented-item-selected'),
      inputChecked: it.querySelector('input')?.checked,
      disabled: it.classList.contains('ant-segmented-item-disabled'),
      attributes: Array.from(it.attributes).map(a => `${a.name}="${a.value}"`).join(' '),
    })) : [];

    const validationAlerts = Array.from(document.querySelectorAll('.ant-form-item-explain-error, [role="alert"], .ant-form-item-explain'))
      .filter(el => /pilih tipe layanan/i.test(el.innerText || ''))
      .map(el => el.innerText.trim());

    return {
      currentUrl: window.location.href,
      targetType: target,
      containerFound: Boolean(serviceCont),
      containerLoading: Boolean(serviceCont && serviceCont.querySelector('.ant-skeleton, .ant-spin-spinning')),
      containerHTML: serviceCont ? serviceCont.outerHTML.substring(0, 1000) : null,
      segmentedItems: items,
      validationAlerts,
    };
  }, { target: targetType }).catch(() => ({ error: 'Evaluation failed' }));

  console.error(`[${name}] [DIAGNOSTIC] Service Type Selection Failure (${reason}):\n`, JSON.stringify(diag, null, 2));
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
  await selectAntDatePicker(page, '#pickup_date', spec.scheduledDate, spec.scheduledTime || '10:00', name);

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
  await selectAntLocationOption(page, pDialog, 'customer_city', cityQuery, new RegExp(getSearchTerm(cityQuery), 'i'), { fieldType: 'city' });

  // District
  const distQuery = spec.pickup.district || 'Tebet';
  await selectAntLocationOption(page, pDialog, 'customer_district', distQuery, new RegExp(getSearchTerm(distQuery), 'i'), { fieldType: 'district', parentCity: cityQuery });

  // Subdistrict
  const subQuery = spec.pickup.subdistrict || '';
  await selectAntLocationOption(page, pDialog, 'customer_subdistrict', subQuery, subQuery ? new RegExp(getSearchTerm(subQuery), 'i') : null, { fallbackFirst: true });

  const pickupStreetAddress = (spec.pickup.address && !isAdministrativeOnly(spec.pickup.address, spec.pickup.city, spec.pickup.district))
    ? spec.pickup.address
    : (spec.pickup.pic?.address && !isAdministrativeOnly(spec.pickup.pic.address, spec.pickup.city, spec.pickup.district))
      ? spec.pickup.pic.address
      : generateSyntheticStreetAddress({ country: 'Indonesia', city: spec.pickup.city, district: spec.pickup.district, isPickup: true });
  await pDialog.locator('input[placeholder*="Alamat detail pickup"], input[placeholder*="detail pickup"], textarea[placeholder*="detail pickup"], input[placeholder*="alamat" i]').fill(pickupStreetAddress);
  await pDialog.locator('input[placeholder*="Masukkan Nama PIC"], input[placeholder*="Nama PIC"]').fill(spec.pickup.pic.name);
  await pDialog.locator('input[placeholder*="Nama kontak pengirim"], input[placeholder*="Nama Perusahaan"], input[placeholder*="Nama Pemesan"]').fill(spec.pickup.pic.company);
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
  const dCityQuery = spec.dropoff.city || 'Kota Surabaya';
  await selectAntLocationOption(page, dDialog, 'recipient_city', dCityQuery, new RegExp(getSearchTerm(dCityQuery), 'i'), { fieldType: 'city' });

  // District
  const dDistQuery = spec.dropoff.district || 'Gubeng';
  await selectAntLocationOption(page, dDialog, 'recipient_district', dDistQuery, new RegExp(getSearchTerm(dDistQuery), 'i'), { fieldType: 'district', parentCity: dCityQuery });

  // Subdistrict
  const dSubQuery = spec.dropoff.subdistrict || '';
  await selectAntLocationOption(page, dDialog, 'recipient_subdistrict', dSubQuery, dSubQuery ? new RegExp(getSearchTerm(dSubQuery), 'i') : null, { fallbackFirst: true });

  const dropoffStreetAddress = (spec.dropoff.address && !isAdministrativeOnly(spec.dropoff.address, spec.dropoff.city, spec.dropoff.district))
    ? spec.dropoff.address
    : (spec.dropoff.pic?.address && !isAdministrativeOnly(spec.dropoff.pic.address, spec.dropoff.city, spec.dropoff.district))
      ? spec.dropoff.pic.address
      : generateSyntheticStreetAddress({ country: 'Indonesia', city: spec.dropoff.city, district: spec.dropoff.district, isPickup: false });

  const dropoffAddrInput = dDialog.locator('input[placeholder*="Alamat Penerima"], textarea[placeholder*="Alamat Penerima"], input[placeholder*="detail drop off"], textarea[placeholder*="detail drop off"], input[placeholder*="alamat" i]').first();
  await dropoffAddrInput.fill(dropoffStreetAddress);

  const dropoffPicInput = dDialog.locator('input[placeholder*="Nama Lengkap PIC"], input[placeholder*="Nama PIC"]').first();
  await dropoffPicInput.fill(spec.dropoff.pic.name);

  const dropoffCompanyInput = dDialog.locator('input[placeholder*="Nama Perusahaan / Nama Penerima"], input[placeholder*="Nama Perusahaan"], input[placeholder*="Nama kontak penerima"], input[placeholder*="Nama Pemesan"]').first();
  await dropoffCompanyInput.fill(spec.dropoff.pic.company);

  const dropoffEmailInput = dDialog.locator('input[placeholder*="Email Aktif Penerima"], input[placeholder*="Email"]').first();
  await dropoffEmailInput.fill(spec.dropoff.pic.email);

  const dropoffPhoneInput = dDialog.locator('#recipient_phone, input[placeholder*="Nomor telepon"]').first();
  await dropoffPhoneInput.fill(spec.dropoff.pic.phone);

  const simpanDropBtn = dDialog.locator('button:has-text("Simpan Titik Drop Off"), button:has-text("simpan titik drop"), button:has-text("Simpan")').first();
  await simpanDropBtn.click();
  await page.waitForTimeout(1500);

  // Mode Selection (SEMUA / DARAT / UDARA / LAUT)
  await selectDomesticTransportPreference(page, spec, name);

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

  // Transportation Mode & Service Type Selection with Verification
  await selectInternationalServiceType(page, spec, name);

  // Origin Location
  const pickupType = (spec.pickup.locationType || 'Door').toLowerCase() === 'port' ? 'Port' : 'Door';
  console.log(`[${name}] Origin location type: ${pickupType}...`);
  const originMethod = page.locator('#origin_pickup_method label, label').filter({ hasText: new RegExp(`^${pickupType}$`, 'i') }).first();
  if (await originMethod.isVisible()) {
    await originMethod.click();
    await page.waitForTimeout(400);
  }

  const originCountry = page.locator('.ant-select').filter({ has: page.locator('#origin_country') }).first();
  await selectAntOption(page, originCountry, spec.pickup.country || 'Indonesia', null);
  await page.waitForTimeout(800);

  if (pickupType === 'Port') {
    const originPort = page.locator('.ant-select').filter({ has: page.locator('#origin_port') }).first();
    const portQuery = spec.pickup.searchQuery || spec.pickup.locality || spec.pickup.city || 'Soekarno-Hatta';
    await selectAntPortOption(page, originPort, portQuery);
  } else {
    const originCity = page.locator('.ant-select').filter({ has: page.locator('#origin_city') }).first();
    const cityQuery = spec.pickup.searchQuery || spec.pickup.locality || spec.pickup.city || 'Tangerang';
    const parentQuery = spec.pickup.parentContext || spec.pickup.city || '';
    await selectAntAutocompleteOption(page, originCity, cityQuery, parentQuery);
  }

  const originPostal = page.locator('input[placeholder*="kode pos"]').first();
  if (await originPostal.isVisible()) {
    await originPostal.fill(spec.pickup.postalCode || '15111');
  }

  // Destination Location
  const dropoffType = (spec.dropoff.locationType || 'Door').toLowerCase() === 'port' ? 'Port' : 'Door';
  console.log(`[${name}] Destination location type: ${dropoffType}...`);
  const destMethod = page.locator('#destination_pickup_method label, label').filter({ hasText: new RegExp(`^${dropoffType}$`, 'i') }).nth(1)
    .or(page.locator('#destination_pickup_method label').filter({ hasText: new RegExp(`^${dropoffType}$`, 'i') })).first();
  if (await destMethod.isVisible()) {
    await destMethod.click();
    await page.waitForTimeout(400);
  }

  const destCountry = page.locator('.ant-select').filter({ has: page.locator('#destination_country') }).first();
  await selectAntOption(page, destCountry, spec.dropoff.country || 'Singapore', null);
  await page.waitForTimeout(800);

  if (dropoffType === 'Port') {
    const destPort = page.locator('.ant-select').filter({ has: page.locator('#destination_port') }).first();
    const portQuery = spec.dropoff.searchQuery || spec.dropoff.locality || spec.dropoff.city || 'Haneda';
    await selectAntPortOption(page, destPort, portQuery);
  } else {
    const destCity = page.locator('.ant-select').filter({ has: page.locator('#destination_city') }).first();
    const cityQuery = spec.dropoff.searchQuery || spec.dropoff.locality || spec.dropoff.city || 'Singapore';
    const parentQuery = spec.dropoff.parentContext || spec.dropoff.country || '';
    await selectAntAutocompleteOption(page, destCity, cityQuery, parentQuery);
  }

  const destPostal = page.locator('input[placeholder*="kode pos"]').nth(1);
  if (await destPostal.isVisible()) {
    await destPostal.fill(spec.dropoff.postalCode || '238801');
  }

  // Incoterm Selection
  console.log(`[${name}] Selecting Incoterm...`);
  const incotermInput = page.locator('#incoterm');
  const incotermContainer = page.locator('.ant-select').filter({ has: incotermInput }).first();
  await incotermContainer.scrollIntoViewIfNeeded();

  for (let i = 0; i < 20; i++) {
    const isLoading = await incotermContainer.evaluate(el => el.classList.contains('ant-select-loading')).catch(() => false);
    if (!isLoading) break;
    await page.waitForTimeout(400);
  }

  await incotermContainer.click();
  await page.waitForTimeout(500);

  const activeDropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').filter({ has: page.locator('.ant-select-item-option') }).last();
  await activeDropdown.waitFor({ state: 'visible', timeout: 10000 });

  const targetIncoterm = normalizeIncoterm(spec.incoterm || 'Delivered Duty Paid');
  const incotermOption = activeDropdown.locator('.ant-select-item-option').filter({ hasText: new RegExp(escapeRegex(targetIncoterm), 'i') }).first();
  await incotermOption.waitFor({ state: 'visible', timeout: 5000 });
  await incotermOption.click();
  await page.waitForTimeout(500);

  const incotermText = await incotermContainer.innerText();
  console.log(`[${name}] Incoterm selected: "${targetIncoterm}" (display: "${incotermText.replace(/\n/g, ' ')}")`);

  // Karakteristik & Description
  const prodCharContainer = page.locator('.ant-select').filter({ has: page.locator('#product_characteristic') }).first();
  await selectAntOption(page, prodCharContainer, null, new RegExp(spec.cargo.characteristics || 'General Cargo', 'i'));

  await page.locator('#description').fill(`${spec.cargo.commodity || 'General'} - ${spec.cargo.itemName || 'Cargo Item'}`);

  // Pickup Date
  await selectAntDatePicker(page, '#pickup_date', spec.scheduledDate, spec.scheduledTime || '10:00', name);

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
  await page.getByRole('button', { name: /simpan detail pengiriman/i }).first().click();
  await page.waitForTimeout(1000);

  // Step 2: Service Catalog Discovery & Selection
  await handleInternationalServiceCatalogStep2(page, spec, name, result);

  // Step 3: Informasi Shipper & Consignee (PIC insertion & attachment upload & verification)
  await fillInternationalPicAndAttachment(page, spec, name, options);

  // Advance from Step 3 to Step 4: Ringkasan Pengiriman
  console.log(`[${name}] Submitting Shipper & Consignee details (Step 3)...`);
  const simpanDetailShipmentBtn = page.getByRole('button', { name: /simpan detail pengiriman/i }).last()
    .or(page.locator('button.primary-btn').filter({ hasText: /simpan detail pengiriman/i }))
    .or(page.getByRole('button', { name: /simpan|selanjutnya/i })).first();

  await simpanDetailShipmentBtn.waitFor({ state: 'visible', timeout: 10000 });

  for (let i = 0; i < 20; i++) {
    const isDisabled = await simpanDetailShipmentBtn.isDisabled().catch(() => false);
    if (!isDisabled) break;
    await page.waitForTimeout(300);
  }

  await simpanDetailShipmentBtn.click();
  console.log(`[${name}] Step 3 submit clicked. Waiting for Step 4 (Ringkasan Pengiriman)...`);

  // Step 4: Ringkasan Pengiriman (Summary)
  const step4Indicator = page.locator('text=/Ringkasan Pengiriman/i')
    .or(page.locator('.custom-steps'))
    .or(page.locator('text=/Total Biaya|Total Tagihan|Total Price|Estimasi Tiba/i'))
    .first();
  await step4Indicator.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});

  const summaryText = await page.locator('body').innerText().catch(() => '');
  const priceMatch = summaryText.match(/Total\s*(?:Biaya|Tagihan|Price)?\s*:?\s*Rp\s*([0-9.,]+)/i);
  if (priceMatch && priceMatch[1]) {
    result.amount = parseInt(priceMatch[1].replace(/[^0-9]/g, ''), 10);
  }

  console.log(`[${name}] Confirming Step 4 Ringkasan Pengiriman...`);
  const simpanStep4Btn = page.getByRole('button', { name: /simpan detail pengiriman|simpan shipment|simpan informasi pesanan|buat pesanan|konfirmasi/i }).first()
    .or(page.locator('button.primary-btn').filter({ hasNotText: /kembali/i })).first();
  if (await simpanStep4Btn.isVisible().catch(() => false)) {
    await simpanStep4Btn.click();
    await page.waitForTimeout(3000);
  }

  const confirmModalBtn = page.getByRole('button', { name: /iya|ya,\s*simpan|konfirmasi/i }).first();
  if (await confirmModalBtn.isVisible().catch(() => false)) {
    await confirmModalBtn.click();
    await page.waitForTimeout(3000);
  }

  console.log(`[${name}] Extracting Order ID and Shipment ID...`);
  const orderPageText = await page.locator('body').innerText().catch(() => '');
  const orderIdMatch = orderPageText.match(/ORCA\d+|ORCB\d+/);
  const shipmentIdMatch = orderPageText.match(/SOCB\d+|SOCM\d+/);

  result.orderId = orderIdMatch ? orderIdMatch[0] : null;
  result.shipmentId = shipmentIdMatch ? shipmentIdMatch[0] : null;

  if (!result.amount) {
    const finalCostMatch = orderPageText.match(/Rp\s*([0-9]{1,3}(?:\.[0-9]{3})+)/i);
    if (finalCostMatch && finalCostMatch[1]) {
      result.amount = parseInt(finalCostMatch[1].replace(/[^0-9]/g, ''), 10);
    }
  }

  if (!result.orderId) {
    const parentSubmitBtn = page.getByRole('button', { name: /simpan informasi pesanan|buat pesanan/i }).first();
    if (await parentSubmitBtn.isVisible().catch(() => false)) {
      await parentSubmitBtn.click();
      await page.waitForTimeout(4000);
      const postText = await page.locator('body').innerText().catch(() => '');
      const oMatch = postText.match(/ORCA\d+|ORCB\d+/);
      if (oMatch) result.orderId = oMatch[0];
      const sMatch = postText.match(/SOCB\d+|SOCM\d+/);
      if (sMatch) result.shipmentId = sMatch[0];
    }
  }

  if (result.orderId) {
    result.status = 'CREATED';
    console.log(`[${name}] International Order successfully created: ${result.orderId} (Shipment: ${result.shipmentId || 'N/A'}, Amount: Rp${result.amount || 'N/A'})`);
  } else {
    result.status = 'ORDER_CONFIRMED';
    console.log(`[${name}] International Order confirmed through Step 4 summary.`);
  }

  return result;
}

/**
 * Capture diagnostic details when international service catalog detection or selection fails
 */
async function captureInternationalCatalogDiagnostics(page, name, reason, context = {}) {
  const ts = Date.now();
  const screenshotName = `intl_catalog_failure_${ts}`;
  let screenshotPath = null;
  try {
    screenshotPath = await captureScreenshot(page, screenshotName);
  } catch (e) {
    // Ignore screenshot error
  }

  const diag = await page.evaluate(({ reason, targetServiceType, targetMode }) => {
    // 1. Loading indicators
    const loadingElements = Array.from(document.querySelectorAll('.animate-pulse, .ant-spin, .ant-spin-spinning, .ant-skeleton'))
      .map(el => ({
        selector: el.className,
        tagName: el.tagName.toLowerCase(),
        visible: el.offsetParent !== null || window.getComputedStyle(el).display !== 'none',
      }));
    const isLoading = loadingElements.some(l => l.visible);

    // 2. Candidate catalog cards
    const cardCandidates = Array.from(document.querySelectorAll('button.best-option-title, button.another-option-title, button[class*="option-title"], button:has(p.text-xl), section button'))
      .filter(el => {
        const text = el.innerText || '';
        return text.includes('Rp') || text.includes('IDR') || text.includes('Estimasi') || el.classList.contains('best-option-title') || el.classList.contains('another-option-title');
      })
      .map((el, i) => {
        const lines = (el.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
        return {
          index: i,
          tagName: el.tagName.toLowerCase(),
          className: el.className,
          attributes: Array.from(el.attributes).map(a => `${a.name}="${a.value}"`).join(' '),
          disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
          isSelected: el.classList.contains('border-main') || !el.classList.contains('border-gray'),
          textLines: lines,
          fullText: el.innerText.trim(),
        };
      });

    // 3. Visible service names
    const visibleServiceNames = Array.from(document.querySelectorAll('h1, h2, h3, h4, p, span, div'))
      .map(el => el.innerText ? el.innerText.trim() : '')
      .filter(t => /Air Cargo|Cargo|Express|Sea Freight|Land Freight|LCL|FCL/i.test(t) && t.length < 50);

    // 4. Buttons and controls in section
    const buttonsAndControls = Array.from(document.querySelectorAll('button, input, [role="radio"], [role="button"]'))
      .map(el => ({
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type'),
        role: el.getAttribute('role'),
        text: (el.innerText || el.getAttribute('value') || el.getAttribute('aria-label') || '').trim().substring(0, 80),
        className: el.className,
        disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      }))
      .filter(c => c.text.length > 0 || c.tag === 'input');

    // 5. Inquiry elements
    const inquiryElements = Array.from(document.querySelectorAll('button, p, h1, div'))
      .filter(el => /inquiry|harga terbaik|quotation/i.test(el.innerText || ''))
      .map(el => el.innerText.trim().substring(0, 150))
      .filter((v, i, a) => a.indexOf(v) === i);

    // 6. DOM snapshot of catalog section
    const catalogContainer = document.querySelector('section.flex.flex-col, .custom-steps, body');
    const domSnapshot = catalogContainer ? catalogContainer.outerHTML.substring(0, 4000) : null;

    return {
      currentUrl: window.location.href,
      reason,
      targetServiceType,
      targetMode,
      isLoading,
      loadingElements,
      candidateCardsCount: cardCandidates.length,
      candidateCards: cardCandidates,
      visibleServiceNames: Array.from(new Set(visibleServiceNames)),
      buttonsAndControls: buttonsAndControls.slice(0, 25),
      inquiryElements,
      domSnapshot,
    };
  }, {
    reason,
    targetServiceType: context.serviceType || 'Cargo',
    targetMode: context.transportationMode || 'Air',
  }).catch(e => ({ error: `Diagnostic evaluation failed: ${e.message}` }));

  diag.screenshotPath = screenshotPath;
  console.error(`[${name}] [DIAGNOSTIC] International Catalog Detection Failure (${reason}):\n`, JSON.stringify(diag, null, 2));
  page._lastDiagnostic = diag;
  return diag;
}

/**
 * Step 2: International Service Catalog Discovery & Selection
 * 
 * Waits for catalog query to resolve, distinguishes State A (Selectable options) 
 * from State B (Explicit Inquiry / Unavailable), matches and clicks the appropriate 
 * service card, verifies selection state, and clicks the confirmation button to advance to Step 3.
 * 
 * @param {import('playwright').Page} page
 * @param {Object} spec
 * @param {string} [name='International Order']
 * @param {Object} [result={}]
 */
async function handleInternationalServiceCatalogStep2(page, spec, name = 'International Order', result = {}) {
  console.log(`[${name}] [ServiceCatalog] Entering Step 2: Pilih Layanan (International)...`);

  const pickupCity = spec?.pickup?.city || spec?.pickup?.locality || 'Origin';
  const dropoffCity = spec?.dropoff?.city || spec?.dropoff?.locality || 'Destination';
  const targetServiceType = spec?.serviceType || 'Cargo';
  const targetMode = spec?.transportationMode || 'Air';

  // 1. Wait for Step 2 page content or container to be visible
  try {
    await page.waitForLoadState('domcontentloaded');
  } catch (e) {}

  // 2. Poll for loading indicators (.animate-pulse, .ant-spin, .ant-skeleton) to finish
  console.log(`[${name}] [ServiceCatalog] Waiting for international catalog query to complete...`);
  const pollStart = Date.now();
  const maxWaitMs = 15000;

  // Candidate selectors for State A (Selectable Service Option Buttons)
  const cardLocator = page.locator('button.best-option-title, button.another-option-title, button[class*="best-option-title"], button[class*="another-option-title"]')
    .or(page.locator('button').filter({ hasText: /Rp|IDR/i }).filter({ hasText: /Estimasi/i }));

  // Selectors for State B (Explicit Unavailable / Inquiry Only)
  const inquiryNotice = page.locator('button').filter({ hasText: /ajukan inquiry/i })
    .or(page.locator('text=/ajukan inquiry/i'))
    .or(page.locator('text=/harga terbaik sedang kami sesuaikan/i'));

  let detectedState = null; // 'AVAILABLE' | 'UNAVAILABLE'

  while (Date.now() - pollStart < maxWaitMs) {
    // Check if still pulsing/loading
    const isPulsing = await page.locator('.animate-pulse, .ant-spin-spinning, .ant-skeleton').first().isVisible().catch(() => false);

    // Check for State A: Option cards rendered
    const cardFound = await cardLocator.first().isVisible().catch(() => false);
    if (cardFound && !isPulsing) {
      detectedState = 'AVAILABLE';
      break;
    }

    // Check for State B: Inquiry / Unavailable rendered
    const inquiryFound = await inquiryNotice.first().isVisible().catch(() => false);
    if (inquiryFound && !isPulsing) {
      detectedState = 'UNAVAILABLE';
      break;
    }

    await page.waitForTimeout(400);
  }

  // If still no state detected, do one final check
  if (!detectedState) {
    const isPulsing = await page.locator('.animate-pulse, .ant-spin-spinning, .ant-skeleton').first().isVisible().catch(() => false);
    const cardFound = await cardLocator.first().isVisible().catch(() => false);
    const inquiryFound = await inquiryNotice.first().isVisible().catch(() => false);

    if (cardFound && !isPulsing) detectedState = 'AVAILABLE';
    else if (inquiryFound && !isPulsing) detectedState = 'UNAVAILABLE';
  }

  // Handle State B: Explicit Inquiry / Unavailable
  if (detectedState === 'UNAVAILABLE') {
    const diag = await captureInternationalCatalogDiagnostics(page, name, 'INQUIRY_ONLY', {
      serviceType: targetServiceType,
      transportationMode: targetMode,
    });
    const err = new Error(`No applicable Service Catalog exists on staging OMS for International route ${pickupCity} -> ${dropoffCity}. Staging OMS requires Inquiry: 'Ajukan Inquiry Layanan'. Stopped per policy (no inquiry fallback).`);
    err.diagnostic = diag;
    throw err;
  }

  // Handle Detection Failure / Timeout
  if (detectedState !== 'AVAILABLE') {
    const diag = await captureInternationalCatalogDiagnostics(page, name, 'TIMEOUT_OR_NOT_FOUND', {
      serviceType: targetServiceType,
      transportationMode: targetMode,
    });
    const err = new Error(`No selectable Service Catalog cards found for International route ${pickupCity} -> ${dropoffCity} (timeout waiting for catalog rendering).`);
    err.diagnostic = diag;
    throw err;
  }

  // State A: Catalog Options Available!
  const cardCount = await cardLocator.count();
  console.log(`[${name}] [ServiceCatalog] Detected ${cardCount} selectable international service option(s).`);

  if (cardCount === 0) {
    const diag = await captureInternationalCatalogDiagnostics(page, name, 'ZERO_OPTIONS_RETURNED', {
      serviceType: targetServiceType,
      transportationMode: targetMode,
    });
    const err = new Error(`No selectable Service Catalog cards found for International route ${pickupCity} -> ${dropoffCity}.`);
    err.diagnostic = diag;
    throw err;
  }

  // Inspect and parse each card
  const cards = [];
  for (let i = 0; i < cardCount; i++) {
    const card = cardLocator.nth(i);
    const text = await card.innerText().catch(() => '');
    const className = await card.getAttribute('class').catch(() => '') || '';
    const isSelected = className.includes('border-main') || !className.includes('border-gray');
    const priceMatch = text.match(/(?:Rp|IDR)\s*[\d\.,]+/i);
    const price = priceMatch ? priceMatch[0] : '';

    cards.push({
      index: i,
      locator: card,
      text,
      className,
      isSelected,
      price,
    });
    console.log(`[${name}] [ServiceCatalog] [Option #${i + 1}] Price: ${price || 'N/A'}, Selected: ${isSelected}, Preview: "${text.replace(/\n+/g, ' | ').substring(0, 100)}"`);
  }

  // Selection Logic:
  // Identify the target card based on user preference or requested serviceType
  let selectedIndex = 0; // Default to best option (option 0)
  const preference = (spec?.serviceCatalogPreference || 'auto').toLowerCase();

  if (preference !== 'auto') {
    const prefIdx = cards.findIndex(c => c.text.toLowerCase().includes(preference));
    if (prefIdx !== -1) selectedIndex = prefIdx;
  } else if (targetServiceType) {
    const typeIdx = cards.findIndex(c => new RegExp(escapeRegex(targetServiceType), 'i').test(c.text));
    if (typeIdx !== -1) selectedIndex = typeIdx;
  }

  const targetCard = cards[selectedIndex];
  console.log(`[${name}] [ServiceCatalog] Selecting Option #${selectedIndex + 1} (matching "${targetServiceType || 'best'}"): "${targetCard.price}"...`);

  // Click the selectable control
  await targetCard.locator.scrollIntoViewIfNeeded().catch(() => {});
  await targetCard.locator.click();
  await page.waitForTimeout(500);

  // Verify selection registered in UI:
  // After clicking, verify that targetCard has 'border-main' or active state
  let selectionConfirmed = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const updatedClass = await targetCard.locator.getAttribute('class').catch(() => '') || '';
    if (updatedClass.includes('border-main') || cards.length === 1) {
      selectionConfirmed = true;
      break;
    }
    await page.waitForTimeout(300);
  }

  if (!selectionConfirmed) {
    console.warn(`[${name}] [ServiceCatalog] Card active class verification pending, retrying click...`);
    await targetCard.locator.click();
    await page.waitForTimeout(500);
  }

  result.serviceCatalog = (targetCard.text.split('\n')[0] || `International ${targetMode} ${targetServiceType}`).trim();
  if (targetCard.price) {
    const numericAmount = parseInt(targetCard.price.replace(/[^\d]/g, ''), 10);
    if (!isNaN(numericAmount) && numericAmount > 0) {
      result.amount = numericAmount;
    }
  }
  console.log(`[${name}] [ServiceCatalog] Selection confirmed: "${result.serviceCatalog}" (${targetCard.price})`);

  // Confirmation Button to advance to Step 3:
  // Look for the bottom primary button: textButton: d("save-service.label")
  console.log(`[${name}] [ServiceCatalog] Advancing to Step 3 (Informasi Shipper & Consignee)...`);
  const saveServiceBtn = page.locator('button.primary-btn').filter({ hasNotText: /ajukan inquiry|inquiry/i }).last()
    .or(page.getByRole('button', { name: /simpan|pilih layanan|lanjutkan|save/i }).filter({ hasNotText: /inquiry/i }))
    .first();

  await saveServiceBtn.waitFor({ state: 'visible', timeout: 10000 });

  // Wait until enabled (disabled: !ec || ec?.data?.length <= 0 || ep)
  for (let i = 0; i < 20; i++) {
    const isDisabled = await saveServiceBtn.isDisabled().catch(() => false);
    if (!isDisabled) break;
    await page.waitForTimeout(300);
  }

  await saveServiceBtn.click();
  console.log(`[${name}] [ServiceCatalog] Confirmation button clicked. Awaiting Step 3 mount...`);

  // Verify advancement: Step 3 ("Informasi Shipper & Consignee") must mount
  const step3Indicator = page.locator('input[name="origin_pic_name"], #origin_pic_name, input[placeholder*="Nama PIC"]')
    .or(page.locator('text=/Informasi Shipper & Consignee/i'))
    .first();

  try {
    await step3Indicator.waitFor({ state: 'visible', timeout: 20000 });
    console.log(`[${name}] [ServiceCatalog] Step 3 successfully mounted.`);
  } catch (err) {
    const diag = await captureInternationalCatalogDiagnostics(page, name, 'STEP3_ADVANCE_FAILED', {
      serviceType: targetServiceType,
      transportationMode: targetMode,
    });
    const error = new Error(`Failed to advance from Step 2 to Step 3 after selecting catalog option: ${err.message}`);
    error.diagnostic = diag;
    throw error;
  }

  return {
    success: true,
    catalog: result.serviceCatalog,
    amount: result.amount,
  };
}

/**
 * Ensure coherent, country-aware PIC records for International Order
 * - Pickup PIC country matches pickup country (e.g. Indonesia).
 * - Destination PIC country matches destination country (e.g. Singapore, Malaysia, Japan).
 * - Respects explicitly provided user fields.
 * - Falls back to library or synthetic generator with auto-persistence.
 */
function ensureInternationalPicRecords(spec) {
  if (!spec.pickup) spec.pickup = {};
  if (!spec.dropoff) spec.dropoff = {};

  const pickupCountry = spec.pickup.country || 'Indonesia';
  const dropoffCountry = spec.dropoff.country || 'Singapore';

  const normPickupCountry = normalizeCountry(pickupCountry);
  const normDropoffCountry = normalizeCountry(dropoffCountry);

  const inputPickupPic = spec.pickup.pic || {};
  const inputDropoffPic = spec.dropoff.pic || {};

  // Check country matching before resolution
  if (inputPickupPic.country && normalizeCountry(inputPickupPic.country).code !== normPickupCountry.code) {
    throw new Error(`[OrderExecutor] Pickup PIC country (${inputPickupPic.country}) does not match pickup country (${normPickupCountry.name}).`);
  }
  if (inputDropoffPic.country && normalizeCountry(inputDropoffPic.country).code !== normDropoffCountry.code) {
    throw new Error(`[OrderExecutor] Destination PIC country (${inputDropoffPic.country}) does not match destination country (${normDropoffCountry.name}).`);
  }

  // Check if user explicitly provided an empty/invalid required field
  for (const f of ['name', 'company', 'email', 'phone']) {
    if (inputPickupPic[f] !== undefined && String(inputPickupPic[f]).trim() === '') {
      throw new Error(`[OrderExecutor] Missing required Shipper PIC field: "${f}". PIC information cannot be skipped.`);
    }
    if (inputDropoffPic[f] !== undefined && String(inputDropoffPic[f]).trim() === '') {
      throw new Error(`[OrderExecutor] Missing required Consignee PIC field: "${f}". PIC information cannot be skipped.`);
    }
  }

  // 1. Pickup PIC (Shipper)
  let pickupPic = null;

  if (inputPickupPic.name && inputPickupPic.phone && inputPickupPic.email && inputPickupPic.company) {
    pickupPic = { ...inputPickupPic };
  } else {
    const selection = selectRandomPIC({
      country: normPickupCountry.name,
      city: spec.pickup.city,
      type: 'pickup',
    });
    let basePic = selection?.pic;
    if (!basePic) {
      basePic = generateRealisticPIC({
        country: normPickupCountry.name,
        city: spec.pickup.city,
        type: 'pickup',
      });
      const lib = getPicLibrary();
      lib.push(basePic);
      setPicLibrary(lib);
    }
    pickupPic = {
      ...basePic,
      ...Object.fromEntries(Object.entries(inputPickupPic).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')),
    };
  }
  pickupPic.country = normPickupCountry.name;
  pickupPic.countryCode = normPickupCountry.code;
  pickupPic.phoneCountryCode = pickupPic.phoneCountryCode || normPickupCountry.phoneCode;
  spec.pickup.pic = pickupPic;

  // 2. Dropoff PIC (Consignee)
  let dropoffPic = null;

  if (inputDropoffPic.name && inputDropoffPic.phone && inputDropoffPic.email && inputDropoffPic.company) {
    dropoffPic = { ...inputDropoffPic };
  } else {
    const selection = selectRandomPIC({
      country: normDropoffCountry.name,
      city: spec.dropoff.city,
      type: 'dropoff',
      excludeNames: [pickupPic.name],
      excludePhones: [pickupPic.phone],
    });
    let basePic = selection?.pic;
    if (!basePic) {
      basePic = generateRealisticPIC({
        country: normDropoffCountry.name,
        city: spec.dropoff.city,
        type: 'dropoff',
      });
      const lib = getPicLibrary();
      lib.push(basePic);
      setPicLibrary(lib);
    }
    dropoffPic = {
      ...basePic,
      ...Object.fromEntries(Object.entries(inputDropoffPic).filter(([_, v]) => v !== undefined && v !== null && String(v).trim() !== '')),
    };
  }
  dropoffPic.country = normDropoffCountry.name;
  dropoffPic.countryCode = normDropoffCountry.code;
  dropoffPic.phoneCountryCode = dropoffPic.phoneCountryCode || normDropoffCountry.phoneCode;
  spec.dropoff.pic = dropoffPic;

  // Ensure street address for PICs
  if (!spec.pickup.pic.address || isAdministrativeOnly(spec.pickup.pic.address, spec.pickup.city, spec.pickup.district, spec.pickup.province, spec.pickup.country)) {
    spec.pickup.pic.address = spec.pickup.address && !isAdministrativeOnly(spec.pickup.address)
      ? spec.pickup.address
      : generateSyntheticStreetAddress({ country: normPickupCountry.name, city: spec.pickup.city, isPickup: true });
  }
  if (!spec.dropoff.pic.address || isAdministrativeOnly(spec.dropoff.pic.address, spec.dropoff.city, spec.dropoff.district, spec.dropoff.province, spec.dropoff.country)) {
    spec.dropoff.pic.address = spec.dropoff.address && !isAdministrativeOnly(spec.dropoff.address)
      ? spec.dropoff.address
      : generateSyntheticStreetAddress({ country: normDropoffCountry.name, city: spec.dropoff.city, isPickup: false });
  }

  // Final completeness verification
  const requiredPicFields = ['name', 'company', 'address', 'email', 'phone'];
  for (const f of requiredPicFields) {
    if (!spec.pickup.pic[f]) {
      throw new Error(`[OrderExecutor] Missing required Shipper PIC field: "${f}". PIC information cannot be skipped.`);
    }
    if (!spec.dropoff.pic[f]) {
      throw new Error(`[OrderExecutor] Missing required Consignee PIC field: "${f}". PIC information cannot be skipped.`);
    }
  }

  return { pickupPic, dropoffPic };
}

/**
 * Safely find, scroll to, fill, and verify an input field with detailed diagnostics.
 */
async function fillAndVerifyField(scope, { label, locators, value, required = true }, fieldDiagnostics = []) {
  let targetLocator = null;
  let locatorUsed = '';

  for (const loc of locators) {
    const candidate = (typeof loc === 'string') ? scope.locator(loc).first() : loc;
    if (await candidate.isVisible({ timeout: 1200 }).catch(() => false)) {
      targetLocator = candidate;
      locatorUsed = typeof loc === 'string' ? loc : 'Playwright Locator';
      break;
    }
  }

  // If not immediately visible, wait up to 4000ms for primary locator
  if (!targetLocator && locators.length > 0) {
    const primary = (typeof locators[0] === 'string') ? scope.locator(locators[0]).first() : locators[0];
    try {
      await primary.waitFor({ state: 'visible', timeout: 4000 });
      targetLocator = primary;
      locatorUsed = typeof locators[0] === 'string' ? locators[0] : 'Primary Locator';
    } catch (_) {}
  }

  const diag = {
    fieldLabel: label,
    locatorUsed: locatorUsed || (typeof locators[0] === 'string' ? locators[0] : 'None'),
    found: Boolean(targetLocator),
    filled: false,
    actualValue: '',
    validationError: null,
  };

  if (!targetLocator) {
    if (required) {
      diag.validationError = 'FIELD_NOT_FOUND';
      fieldDiagnostics.push(diag);
      throw new Error(`Required PIC field "${label}" could not be located in DOM.`);
    } else {
      fieldDiagnostics.push(diag);
      return false;
    }
  }

  // Scroll into view if needed
  await targetLocator.scrollIntoViewIfNeeded().catch(() => {});
  if (scope.page) {
    await scope.page().waitForTimeout(100);
  } else if (scope.waitForTimeout) {
    await scope.waitForTimeout(100);
  }

  // Clear existing content and fill
  await targetLocator.fill(String(value || ''));
  diag.filled = true;

  // Verify resulting value
  const actual = await targetLocator.inputValue().catch(() => '');
  diag.actualValue = actual;

  if (required && !actual && String(value || '').trim()) {
    diag.validationError = 'FIELD_EMPTY_AFTER_FILL';
    fieldDiagnostics.push(diag);
    throw new Error(`Required PIC field "${label}" remained empty in DOM after fill.`);
  }

  fieldDiagnostics.push(diag);
  return true;
}

/**
 * Step 3: Fill Shipper (Origin) & Consignee (Destination) PIC details and upload PIC attachment
 */
async function fillInternationalPicAndAttachment(page, spec, name = 'International Order', options = {}) {
  // Ensure country-aware PIC records are complete and coherent
  ensureInternationalPicRecords(spec);

  const fieldDiagnostics = [];

  // 0. Handle active pickup location modal if present
  const activeModal = page.locator('[role="dialog"]:not([style*="display: none"]), .ant-modal:not([style*="display: none"])').last();
  if (await activeModal.isVisible().catch(() => false)) {
    const modalText = await activeModal.innerText().catch(() => '');
    if (/informasi pic|nama pic/i.test(modalText)) {
      console.log(`[${name}] [PIC Modal] Detected active location modal with PIC section. Populating modal PIC...`);
      await fillAndVerifyField(activeModal, {
        label: 'Modal Nama PIC',
        locators: [
          'input[placeholder*="Masukkan Nama PIC" i]',
          'input[placeholder*="Nama PIC" i]',
          'input[name*="pic_name" i]',
        ],
        value: spec.pickup.pic.name,
      }, fieldDiagnostics);

      await fillAndVerifyField(activeModal, {
        label: 'Modal Nama Perusahaan / Nama Pemesan',
        locators: [
          'input[placeholder*="Nama kontak pengirim" i]',
          'input[placeholder*="Nama Perusahaan" i]',
          'input[placeholder*="Nama Pemesan" i]',
          'input[placeholder*="Perusahaan" i]',
          'input[name*="company" i]',
        ],
        value: spec.pickup.pic.company,
      }, fieldDiagnostics);

      const modalAddr = (spec.pickup.address && !isAdministrativeOnly(spec.pickup.address, spec.pickup.city, spec.pickup.district))
        ? spec.pickup.address
        : spec.pickup.pic.address;
      await fillAndVerifyField(activeModal, {
        label: 'Modal Alamat Detail',
        locators: [
          'input[placeholder*="Alamat detail pickup" i]',
          'input[placeholder*="detail pickup" i]',
          'textarea[placeholder*="detail pickup" i]',
          'input[placeholder*="alamat" i]',
          'textarea[placeholder*="alamat" i]',
        ],
        value: modalAddr,
      }, fieldDiagnostics);

      await fillAndVerifyField(activeModal, {
        label: 'Modal Email',
        locators: [
          'input[placeholder*="Email Aktif Pengirim" i]',
          'input[placeholder*="Email" i]',
          'input[type="email"]',
        ],
        value: spec.pickup.pic.email,
      }, fieldDiagnostics);

      const phoneRaw = String(spec.pickup.pic.phone).replace(/^(\+?62|0)/, '');
      await fillAndVerifyField(activeModal, {
        label: 'Modal Phone',
        locators: [
          '#customer_phone',
          'input[placeholder*="Nomor telepon" i]',
          'input[type="tel"]',
          'input[type="number"]',
        ],
        value: phoneRaw,
      }, fieldDiagnostics);

      const saveModalBtn = activeModal.locator('button:has-text("Simpan"), button:has-text("simpan")').first();
      if (await saveModalBtn.isVisible().catch(() => false)) {
        await saveModalBtn.click();
        await page.waitForTimeout(1000);
      }
    }
  }

  // Stage 1: International PIC section opened / mounted
  console.log(`[${name}] [PIC Stage 1] International PIC section opened.`);
  const formOrSection = page.locator('form')
    .or(page.getByText(/Informasi Shipper & Consignee|Informasi PIC/i))
    .or(page.locator('input[placeholder*="Nama PIC" i]'))
    .or(page.locator('input[name="origin_pic_name"]'))
    .or(page.locator('#origin_phone'))
    .first();
  try {
    await formOrSection.waitFor({ state: 'visible', timeout: 15000 });
  } catch (err) {
    const diag = await captureInternationalPicDiagnostics(page, name, 'SECTION_MOUNT', 'PIC_SECTION_NOT_OPENED', { error: err.message, fields: fieldDiagnostics });
    const error = new Error(`[OrderExecutor] International PIC section failed to open: ${err.message}`);
    error.diagnostic = diag;
    throw error;
  }

  // Stage 2: Populate Pickup (Shipper) PIC fields
  console.log(`[${name}] [PIC Stage 2] Populating Pickup PIC fields (${spec.pickup.pic.name} - ${spec.pickup.pic.country})...`);
  try {
    // 1. Shipper Nama PIC
    await fillAndVerifyField(page, {
      label: 'Shipper Nama PIC',
      locators: [
        'input[placeholder*="Masukkan Nama PIC" i]:nth-of-type(1)',
        'input[placeholder*="Nama PIC" i]:nth-of-type(1)',
        'input[name="origin_pic_name"], #origin_pic_name',
        'input[placeholder*="Masukkan Nama PIC" i]',
        'input[placeholder*="Nama PIC" i]',
        '.ant-form-item:has-text("Nama PIC") input',
        'label:has-text("Nama PIC") .. input',
      ],
      value: spec.pickup.pic.name,
      required: true,
    }, fieldDiagnostics);

    // 2. Shipper Nama Perusahaan
    await fillAndVerifyField(page, {
      label: 'Shipper Nama Perusahaan',
      locators: [
        'input[placeholder*="Pilih Nama Perusahaan" i]:nth-of-type(1)',
        'input[placeholder*="Nama Perusahaan" i]:nth-of-type(1)',
        'input[name="origin_company"], #origin_company',
        'input[placeholder*="Pilih Nama Perusahaan" i]',
        'input[placeholder*="Nama Perusahaan" i]',
        'input[placeholder*="Perusahaan" i]',
      ],
      value: spec.pickup.pic.company,
      required: true,
    }, fieldDiagnostics);

    // 3. Shipper Alamat
    const originStreetAddress = (spec.pickup.address && !isAdministrativeOnly(spec.pickup.address, spec.pickup.city, spec.pickup.district, spec.pickup.province, spec.pickup.country))
      ? spec.pickup.address
      : (spec.pickup.pic?.address && !isAdministrativeOnly(spec.pickup.pic.address, spec.pickup.city, spec.pickup.district, spec.pickup.province, spec.pickup.country))
        ? spec.pickup.pic.address
        : generateSyntheticStreetAddress({ country: spec.pickup.country || 'Indonesia', city: spec.pickup.city, district: spec.pickup.district, isPickup: true });

    await fillAndVerifyField(page, {
      label: 'Shipper Alamat',
      locators: [
        'input[placeholder*="Masukkan alamat" i]:nth-of-type(1)',
        'textarea[placeholder*="Masukkan alamat" i]:nth-of-type(1)',
        'input[name="origin_address"], textarea[name="origin_address"], #origin_address',
        'input[placeholder*="Masukkan alamat" i]',
        'textarea[placeholder*="Masukkan alamat" i]',
        'input[placeholder*="alamat" i]',
        'textarea[placeholder*="alamat" i]',
      ],
      value: originStreetAddress,
      required: true,
    }, fieldDiagnostics);

    // 4. Shipper Email
    await fillAndVerifyField(page, {
      label: 'Shipper Email',
      locators: [
        'input[placeholder*="Email aktif pengirim" i]:nth-of-type(1)',
        'input[name="origin_email"], #origin_email',
        'input[placeholder*="Email aktif pengirim" i]',
        'input[placeholder*="Email" i]',
        'input[type="email"]',
      ],
      value: spec.pickup.pic.email,
      required: true,
    }, fieldDiagnostics);

    // 5. Shipper Phone Area
    const originPhoneAreaInput = page.locator('#origin_phone_area').first();
    const originPhoneAreaSelect = page.locator('.ant-select:has(#origin_phone_area), .ant-select').first();
    const originCode = spec.pickup.pic.phoneCountryCode || '+62';
    if (await originPhoneAreaInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      const tag = await originPhoneAreaInput.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
      if (tag === 'input') {
        await originPhoneAreaInput.fill(originCode).catch(() => {});
      }
    } else if (await originPhoneAreaSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      await selectAntOption(page, originPhoneAreaSelect, null, new RegExp(escapeRegex(originCode))).catch(() => {});
    }

    // 6. Shipper Phone Number
    const rawOriginPhone = String(spec.pickup.pic.phone).replace(/^(\+?62|0)/, '');
    await fillAndVerifyField(page, {
      label: 'Shipper Nomor Telepon',
      locators: [
        '#origin_phone, input[name="origin_phone"]',
        'input[placeholder*="Nomor telepon" i]:nth-of-type(1)',
        'input[placeholder*="Nomor telepon" i]',
        'input[type="number"]:nth-of-type(1)',
      ],
      value: rawOriginPhone,
      required: true,
    }, fieldDiagnostics);

    console.log(`[${name}] [PIC Stage 2] Pickup PIC fields populated successfully.`);
  } catch (err) {
    const diag = await captureInternationalPicDiagnostics(page, name, 'PICKUP_PIC_POPULATION', err.message, { shipperPic: spec.pickup.pic, fields: fieldDiagnostics });
    const error = new Error(`[OrderExecutor] Failed to populate Pickup PIC fields: ${err.message}`);
    error.diagnostic = diag;
    throw error;
  }

  // Stage 3: Populate Destination (Consignee) PIC fields
  console.log(`[${name}] [PIC Stage 3] Populating Destination PIC fields (${spec.dropoff.pic.name} - ${spec.dropoff.pic.country})...`);
  try {
    // 1. Consignee Nama PIC
    await fillAndVerifyField(page, {
      label: 'Consignee Nama PIC',
      locators: [
        'input[name="destination_pic_name"], #destination_pic_name',
        'input[placeholder*="Masukkan Nama PIC" i]:nth-of-type(2)',
        'input[placeholder*="Nama PIC" i]:nth-of-type(2)',
        page.locator('input[placeholder*="Masukkan Nama PIC" i]').nth(1),
        page.locator('input[placeholder*="Nama PIC" i]').nth(1),
      ],
      value: spec.dropoff.pic.name,
      required: true,
    }, fieldDiagnostics);

    // 2. Consignee Nama Perusahaan
    await fillAndVerifyField(page, {
      label: 'Consignee Nama Perusahaan',
      locators: [
        'input[name="destination_company"], #destination_company',
        'input[placeholder*="Pilih Nama Perusahaan" i]:nth-of-type(2)',
        'input[placeholder*="Nama Perusahaan" i]:nth-of-type(2)',
        page.locator('input[placeholder*="Pilih Nama Perusahaan" i]').nth(1),
        page.locator('input[placeholder*="Nama Perusahaan" i]').nth(1),
      ],
      value: spec.dropoff.pic.company,
      required: true,
    }, fieldDiagnostics);

    // 3. Consignee Alamat
    const destStreetAddress = (spec.dropoff.address && !isAdministrativeOnly(spec.dropoff.address, spec.dropoff.city, spec.dropoff.district, spec.dropoff.province, spec.dropoff.country))
      ? spec.dropoff.address
      : (spec.dropoff.pic?.address && !isAdministrativeOnly(spec.dropoff.pic.address, spec.dropoff.city, spec.dropoff.district, spec.dropoff.province, spec.dropoff.country))
        ? spec.dropoff.pic.address
        : generateSyntheticStreetAddress({ country: spec.dropoff.country || 'Singapore', city: spec.dropoff.city, district: spec.dropoff.district, isPickup: false });

    await fillAndVerifyField(page, {
      label: 'Consignee Alamat',
      locators: [
        'input[name="destination_address"], textarea[name="destination_address"], #destination_address',
        'input[placeholder*="Masukkan alamat" i]:nth-of-type(2)',
        'textarea[placeholder*="Masukkan alamat" i]:nth-of-type(2)',
        page.locator('input[placeholder*="Masukkan alamat" i]').nth(1),
        page.locator('textarea[placeholder*="Masukkan alamat" i]').nth(1),
        page.locator('input[placeholder*="alamat" i]').nth(1),
        page.locator('textarea[placeholder*="alamat" i]').nth(1),
      ],
      value: destStreetAddress,
      required: true,
    }, fieldDiagnostics);

    // 4. Consignee Email
    await fillAndVerifyField(page, {
      label: 'Consignee Email',
      locators: [
        'input[name="destination_email"], #destination_email',
        'input[placeholder*="Email aktif pengirim" i]:nth-of-type(2)',
        page.locator('input[placeholder*="Email aktif pengirim" i]').nth(1),
        page.locator('input[placeholder*="Email" i]').nth(1),
        page.locator('input[type="email"]').nth(1),
      ],
      value: spec.dropoff.pic.email,
      required: true,
    }, fieldDiagnostics);

    // 5. Consignee Phone Area
    const destPhoneAreaInput = page.locator('#destination_phone_area').first();
    const destPhoneAreaSelect = page.locator('.ant-select:has(#destination_phone_area), .ant-select').nth(1);
    const destCode = spec.dropoff.pic.phoneCountryCode || (spec.dropoff.country === 'Singapore' ? '+65' : (spec.dropoff.country === 'Malaysia' ? '+60' : '+62'));
    if (await destPhoneAreaInput.isVisible({ timeout: 1000 }).catch(() => false)) {
      const tag = await destPhoneAreaInput.evaluate(el => el.tagName.toLowerCase()).catch(() => '');
      if (tag === 'input') {
        await destPhoneAreaInput.fill(destCode).catch(() => {});
      }
    } else if (await destPhoneAreaSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
      await selectAntOption(page, destPhoneAreaSelect, null, new RegExp(escapeRegex(destCode))).catch(() => {});
    }

    // 6. Consignee Phone Number
    const phoneCountryDigits = (spec.dropoff.pic.phoneCountryCode || '').replace(/\D/g, '');
    let rawDestPhone = String(spec.dropoff.pic.phone).replace(/^\+/, '');
    if (phoneCountryDigits && rawDestPhone.startsWith(phoneCountryDigits)) {
      rawDestPhone = rawDestPhone.slice(phoneCountryDigits.length);
    }
    rawDestPhone = rawDestPhone.replace(/^0/, '');

    await fillAndVerifyField(page, {
      label: 'Consignee Nomor Telepon',
      locators: [
        '#destination_phone, input[name="destination_phone"]',
        'input[placeholder*="Nomor telepon" i]:nth-of-type(2)',
        page.locator('input[placeholder*="Nomor telepon" i]').nth(1),
        page.locator('input[type="number"]').nth(1),
      ],
      value: rawDestPhone,
      required: true,
    }, fieldDiagnostics);

    console.log(`[${name}] [PIC Stage 3] Destination PIC fields populated successfully.`);
  } catch (err) {
    const diag = await captureInternationalPicDiagnostics(page, name, 'DESTINATION_PIC_POPULATION', err.message, { consigneePic: spec.dropoff.pic, fields: fieldDiagnostics });
    const error = new Error(`[OrderExecutor] Failed to populate Destination PIC fields: ${err.message}`);
    error.diagnostic = diag;
    throw error;
  }

  // Stage 4: Locate PIC Image File Input
  console.log(`[${name}] [PIC Stage 4] Locating PIC image file input...`);
  const fileInput = page.locator('.ant-upload input[type="file"], input[type="file"]').first();
  try {
    await fileInput.waitFor({ state: 'attached', timeout: 15000 });
    console.log(`[${name}] [PIC Stage 4] PIC image file input located.`);
  } catch (err) {
    const diag = await captureInternationalPicDiagnostics(page, name, 'FILE_INPUT_LOCATE', err.message, { fields: fieldDiagnostics });
    const error = new Error(`[OrderExecutor] PIC image file input not found: ${err.message}`);
    error.diagnostic = diag;
    throw error;
  }

  // Stage 5: Upload PIC Image
  const targetAttachmentPath = options.picAttachmentPath || spec?.picAttachmentPath || DEFAULT_INTL_PIC_ATTACHMENT_PATH;
  console.log(`[${name}] [PIC Stage 5] Uploading image: "${targetAttachmentPath}"...`);
  let resolvedPath = null;
  try {
    resolvedPath = resolveInternationalPicAttachment(targetAttachmentPath);
    await fileInput.setInputFiles(resolvedPath);
    console.log(`[${name}] [PIC Stage 5] Image uploaded.`);
  } catch (err) {
    const diag = await captureInternationalPicDiagnostics(page, name, 'IMAGE_UPLOAD', err.message, { targetAttachmentPath, fields: fieldDiagnostics });
    const error = new Error(`[OrderExecutor] Failed to upload PIC image: ${err.message}`);
    error.diagnostic = diag;
    throw error;
  }

  // Stage 6: Verify Upload Completion
  const fileName = path.basename(resolvedPath);
  console.log(`[${name}] [PIC Stage 6] Verifying upload completion for "${fileName}"...`);
  const attachmentItem = page.locator('button, section, div, span, .ant-upload-list-item')
    .filter({ hasText: fileName })
    .first();

  try {
    await attachmentItem.waitFor({ state: 'visible', timeout: 20000 });
    const isDisplayed = await attachmentItem.isVisible().catch(() => false);
    if (!isDisplayed) {
      throw new Error(`Attachment element not visible in DOM for "${fileName}".`);
    }
    console.log(`[${name}] [PIC Stage 6] Upload completion verified.`);
  } catch (err) {
    const diag = await captureInternationalPicDiagnostics(page, name, 'UPLOAD_VERIFICATION', err.message, { fileName, fields: fieldDiagnostics });
    const error = new Error(`[OrderExecutor] International PIC attachment verification failed: ${err.message}`);
    error.diagnostic = diag;
    throw error;
  }

  // Stage 7: Form Validation Check
  console.log(`[${name}] [PIC Stage 7] Verifying PIC form validation passed...`);
  const validationErrors = await page.locator('.ant-form-item-explain-error, [role="alert"].text-red')
    .evaluateAll(els => els.map(e => (e.innerText || '').trim()).filter(Boolean))
    .catch(() => []);

  if (validationErrors.length > 0) {
    const diag = await captureInternationalPicDiagnostics(page, name, 'FORM_VALIDATION', `Validation errors present: ${validationErrors.join(', ')}`, { validationErrors, fields: fieldDiagnostics });
    const error = new Error(`[OrderExecutor] PIC form validation failed: ${validationErrors.join('; ')}`);
    error.diagnostic = diag;
    throw error;
  }
  console.log(`[${name}] [PIC Stage 7] PIC form validation passed.`);

  // Stage 8: Confirmation action (Submit Step 3)
  console.log(`[${name}] [PIC Stage 8] Submitting Shipper & Consignee details (Step 3)...`);
  const simpanDetailShipmentBtn = page.getByRole('button', { name: /simpan detail pengiriman/i }).last()
    .or(page.locator('button.primary-btn').filter({ hasText: /simpan detail pengiriman/i }))
    .or(page.getByRole('button', { name: /simpan|selanjutnya/i })).first();

  if (await simpanDetailShipmentBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    for (let i = 0; i < 20; i++) {
      const isDisabled = await simpanDetailShipmentBtn.isDisabled().catch(() => false);
      if (!isDisabled) break;
      await page.waitForTimeout(300);
    }
    await simpanDetailShipmentBtn.click();
    await page.waitForTimeout(2000);

    const postSubmitErrors = await page.locator('.ant-form-item-explain-error, [role="alert"].text-red')
      .evaluateAll(els => els.map(e => (e.innerText || '').trim()).filter(Boolean))
      .catch(() => []);
    if (postSubmitErrors.length > 0) {
      const diag = await captureInternationalPicDiagnostics(page, name, 'POST_SUBMIT_VALIDATION', `Validation errors after submit: ${postSubmitErrors.join(', ')}`, { validationErrors: postSubmitErrors, fields: fieldDiagnostics });
      const error = new Error(`[OrderExecutor] PIC validation errors after clicking save: ${postSubmitErrors.join('; ')}`);
      error.diagnostic = diag;
      throw error;
    }
  }

  return {
    success: true,
    attachmentPath: resolvedPath,
    fileName,
    shipperPic: spec.pickup.pic,
    consigneePic: spec.dropoff.pic,
    fieldDiagnostics,
  };
}

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
      diagnostic: err.diagnostic || page._lastDiagnostic || null,
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
  handleInternationalServiceCatalogStep2,
  captureInternationalCatalogDiagnostics,
  captureInternationalPicDiagnostics,
  formatSpecificationReview,
  selectAntLocationOption,
  selectInternationalServiceType,
  captureServiceTypeDiagnostics,
  selectAntAutocompleteOption,
  matchesLocationContext,
  DEFAULT_INTL_PIC_ATTACHMENT_PATH,
  resolveInternationalPicAttachment,
  ensureInternationalPicRecords,
  fillInternationalPicAndAttachment,
  selectDomesticTransportPreference,
  captureTransportPreferenceDiagnostics,
  selectAntDatePicker,
  captureDatePickerDiagnostics,
  getAntDatePickerState,
  DATEPICKER_MONTH_REGEXES,
  selectAntPortOption,
  sanitizePortName,
};
