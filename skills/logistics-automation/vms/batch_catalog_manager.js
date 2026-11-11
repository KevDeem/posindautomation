/**
 * VMS Batch Service Catalog Manager
 * Orchestrates batch parsing, normalization, review, and single-session
 * sequential execution of multiple VMS service catalogs.
 */

const { parseRoutePrompt, normalizeRouteSpecification } = require('./vms_spec_builder');
const { createParentCatalog, getAvailableCatalogs } = require('./catalog_manager');
const { createCatalogRoutesBatch } = require('./route_manager');
const { getAuthenticatedVmsPage } = require('./vms_auth');

// Month mapping for date parsing
const MONTH_NAMES = {
  jan: 0, januari: 0, january: 0,
  feb: 1, februari: 1, february: 1,
  mar: 2, maret: 2, march: 2,
  apr: 3, april: 3,
  may: 4, mei: 4,
  jun: 5, juni: 5, june: 5,
  jul: 6, juli: 6, july: 6,
  aug: 7, agustus: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, oktober: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, desember: 11, december: 11,
};

/**
 * Format Date to YYYY-MM-DD
 */
function formatDateISO(d) {
  if (!d) return '';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const dateObj = new Date(d);
  if (isNaN(dateObj.getTime())) return '';
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Parse date string like "1 December 2026" or "2026-12-01"
 */
function parseDateString(str) {
  if (!str) return null;
  const trimmed = str.trim();

  // Pattern 1: ISO YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    return formatDateISO(`${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`);
  }

  // Pattern 2: DD Month YYYY
  const ddMonMatch = trimmed.match(/^(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})/);
  if (ddMonMatch) {
    const day = parseInt(ddMonMatch[1], 10);
    const monthKey = ddMonMatch[2].toLowerCase();
    const month = MONTH_NAMES[monthKey];
    const year = parseInt(ddMonMatch[3], 10);
    if (month !== undefined) {
      const dt = new Date(Date.UTC(year, month, day));
      return formatDateISO(dt);
    }
  }

  return null;
}

/**
 * Split multi-catalog input text into raw catalog blocks.
 * Supports numbered blocks ("1. ... \n 2. ..."), markdown bullets, or double newlines.
 */
function splitBatchInput(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // Remove generic headers like "Create these catalogs:" or "Daftar katalog:"
  const cleaned = trimmed.replace(/^(?:create\s+these\s+catalogs|create\s+catalogs|buat\s+katalog(?:\s+ini)?|daftar\s+katalog)\s*:?\s*/i, '').trim();

  // Check if numbered: "1. ... 2. ..."
  const numberedPattern = /(?:^|\n)\s*(?:\d+[\.\)]\s+)(?=[^\n]+)/g;
  const matchIndices = [];
  let m;
  while ((m = numberedPattern.exec(cleaned)) !== null) {
    matchIndices.push(m.index);
  }

  if (matchIndices.length >= 2) {
    const blocks = [];
    for (let i = 0; i < matchIndices.length; i++) {
      const start = matchIndices[i];
      const end = i + 1 < matchIndices.length ? matchIndices[i + 1] : cleaned.length;
      const chunk = cleaned.slice(start, end).trim();
      // Remove leading number indicator: "1. " or "1) "
      const stripped = chunk.replace(/^\d+[\.\)]\s+/, '').trim();
      if (stripped) blocks.push(stripped);
    }
    return blocks;
  }

  // Split by double newlines or '---'
  const sections = cleaned.split(/\n\s*[-=]{3,}\s*\n|\n\s*\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (sections.length > 1) {
    return sections;
  }

  // Fallback: split by double newline
  const paragraphs = cleaned.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  if (paragraphs.length > 0) {
    return paragraphs;
  }

  return [cleaned];
}

/**
 * Parse a single catalog text block into a normalized specification.
 */
function parseCatalogBlock(blockText, defaultIndex = 1) {
  const lines = blockText.split('\n').map(l => l.trim()).filter(Boolean);
  const now = new Date();
  const defaultYear = now.getFullYear();

  let name = '';
  let startDate = null;
  let endDate = null;
  let catalogType = 'Retail'; // default catalog type
  const routeLines = [];
  const missingFields = [];
  const generatedValues = [];

  // Determine line 0 as potential name
  if (lines.length > 0) {
    let firstLine = lines[0];
    // Remove "Catalog Name: " or "Name: " prefix
    firstLine = firstLine.replace(/^(?:catalog\s+name|nama\s+katalog|name|nama)\s*[:=]\s*/i, '').trim();
    name = firstLine;
  }

  if (!name) {
    name = `Catalog ${formatDateISO(now)} #${defaultIndex}`;
    generatedValues.push({ field: 'name', value: name, reason: 'Generated default name' });
  }

  // Process remaining lines or regex on block
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Validity dates matching
    // e.g. "Valid from 1 December 2026 until 31 December 2026"
    // or "Valid: 2026-12-01 to 2026-12-31"
    const validMatch = line.match(/(?:valid(?:\s+from|\s+period)?|periode|berlaku)\s*(?:from|dari)?\s*[:=]?\s*([0-9a-zA-Z\s-]+?)\s+(?:until|to|sampai|s\/d|-)\s+([0-9a-zA-Z\s-]+)/i);
    if (validMatch) {
      const parsedStart = parseDateString(validMatch[1]);
      const parsedEnd = parseDateString(validMatch[2]);
      if (parsedStart) startDate = parsedStart;
      if (parsedEnd) endDate = parsedEnd;
      continue;
    }

    // Start date matching
    const startMatch = line.match(/(?:start(?:\s+date)?|tanggal\s+mulai)\s*[:=]?\s*([0-9a-zA-Z\s-]+)/i);
    if (startMatch) {
      const parsedStart = parseDateString(startMatch[1]);
      if (parsedStart) startDate = parsedStart;
      continue;
    }

    // End date matching
    const endMatch = line.match(/(?:end(?:\s+date)?|tanggal\s+selesai|tanggal\s+berakhir|until|sampai)\s*[:=]?\s*([0-9a-zA-Z\s-]+)/i);
    if (endMatch) {
      const parsedEnd = parseDateString(endMatch[1]);
      if (parsedEnd) endDate = parsedEnd;
      continue;
    }

    // Catalog Type
    const typeMatch = line.match(/(?:catalog\s+type|tipe\s+katalog|type|tipe)\s*[:=]?\s*([a-zA-Z]+)/i);
    if (typeMatch) {
      catalogType = typeMatch[1].trim();
      continue;
    }

    // Remaining lines treated as route lines
    routeLines.push(line);
  }

  // If dates still missing, attempt regex across whole block
  if (!startDate || !endDate) {
    const blockMatch = blockText.match(/(?:valid(?:\s+from|\s+period)?|berlaku)\s*(?:from|dari)?\s*[:=]?\s*([0-9a-zA-Z\s-]+?)\s+(?:until|to|sampai|s\/d|-)\s+([0-9a-zA-Z\s-]+)/i);
    if (blockMatch) {
      if (!startDate) startDate = parseDateString(blockMatch[1]);
      if (!endDate) endDate = parseDateString(blockMatch[2]);
    }
  }

  // Apply default dates if still not resolved
  if (!startDate) {
    startDate = formatDateISO(now);
    generatedValues.push({ field: 'startDate', value: startDate, reason: 'Defaulted to current date' });
  }

  if (!endDate) {
    const twoYearsLater = new Date(Date.UTC(defaultYear + 2, 11, 31));
    endDate = formatDateISO(twoYearsLater);
    generatedValues.push({ field: 'endDate', value: endDate, reason: `Defaulted to 2 years validity (${endDate})` });
  }

  // Check date sanity
  if (startDate && endDate && startDate > endDate) {
    missingFields.push(`Start date (${startDate}) cannot be after end date (${endDate})`);
  }

  // Parse intended routes
  const normalizedRoutes = [];
  const routeParsingErrors = [];

  for (const rLine of routeLines) {
    // Check if line represents a route description (e.g., contains mode, service type, or origin - destination)
    // Examples: "Domestic Land FTL", "International Sea FCL", "Pasar Minggu - Rawalumbu 5 hours FTL"
    const parsed = parseRoutePrompt(rLine);
    const normalized = normalizeRouteSpecification(parsed);

    // If route line was just a mode/service hint without origin/dest, keep as intended route metadata
    if (normalized.origin && normalized.origin.error && normalized.destination && normalized.destination.error) {
      // It's a template/mode specifier, e.g. "Domestic Land FTL"
      const modeMatch = rLine.match(/\b(darat|land|laut|sea|udara|air)\b/i);
      const servMatch = rLine.match(/\b(ftl|ltl|fcl|lcl|cargo)\b/i);
      if (modeMatch || servMatch) {
        normalizedRoutes.push({
          rawText: rLine,
          isTemplate: true,
          mode: modeMatch ? modeMatch[1].toUpperCase() : 'DARAT',
          serviceType: servMatch ? servMatch[1].toUpperCase() : 'FTL',
          description: rLine,
        });
      }
    } else {
      normalizedRoutes.push(normalized);
      if (normalized.origin && normalized.origin.error) {
        routeParsingErrors.push(`Route origin unresolved in "${rLine}"`);
      }
      if (normalized.destination && normalized.destination.error) {
        routeParsingErrors.push(`Route destination unresolved in "${rLine}"`);
      }
    }
  }

  return {
    index: defaultIndex,
    name,
    startDate,
    endDate,
    catalogType,
    routes: normalizedRoutes,
    missingFields: [...missingFields, ...routeParsingErrors],
    generatedValues,
    rawBlock: blockText,
    isValid: missingFields.length === 0 && routeParsingErrors.length === 0,
  };
}

/**
 * Parse a full multi-catalog batch natural language input
 */
function parseBatchCatalogInput(input) {
  const blocks = splitBatchInput(input);
  if (blocks.length === 0) return [];
  return blocks.map((block, idx) => parseCatalogBlock(block, idx + 1));
}

/**
 * Format human-readable Batch Review for CLI display
 */
function formatBatchReview(catalogs) {
  const lines = [];
  lines.push('======================================================');
  lines.push('           VMS BATCH CATALOG CREATION REVIEW          ');
  lines.push('======================================================');
  lines.push(`Total Catalogs in Batch: ${catalogs.length}`);
  lines.push('');

  catalogs.forEach((c, idx) => {
    lines.push(`[Catalog #${idx + 1}] ${c.name}`);
    lines.push(`  • Validity Period:  ${c.startDate} s/d ${c.endDate}`);
    lines.push(`  • Catalog Type:     ${c.catalogType || 'Retail'}`);
    
    if (c.routes && c.routes.length > 0) {
      lines.push(`  • Intended Routes:  ${c.routes.length} route(s)`);
      c.routes.forEach((r, rIdx) => {
        if (r.isTemplate) {
          lines.push(`      - [Template #${rIdx + 1}] Mode: ${r.mode}, Service: ${r.serviceType} ("${r.rawText}")`);
        } else {
          lines.push(`      - [Route #${rIdx + 1}] ${r.routeName || r.rawPrompt}`);
        }
      });
    } else {
      lines.push('  • Intended Routes:  None (Header only)');
    }

    if (c.generatedValues && c.generatedValues.length > 0) {
      lines.push('  • Generated Values:');
      c.generatedValues.forEach(g => {
        lines.push(`      * ${g.field}: "${g.value}" (${g.reason})`);
      });
    }

    if (c.missingFields && c.missingFields.length > 0) {
      lines.push('  • Validation Warnings / Missing Fields:');
      c.missingFields.forEach(w => {
        lines.push(`      ! [WARNING] ${w}`);
      });
    }
    lines.push('');
  });

  lines.push('======================================================');
  return lines.join('\n');
}

/**
 * Format Batch Summary Report
 */
function formatBatchSummaryReport(results) {
  const total = results.length;
  const created = results.filter(r => r.status === 'CREATED').length;
  const failed = results.filter(r => r.status === 'FAILED').length;
  const skipped = results.filter(r => r.status === 'SKIPPED').length;

  let overallStatus = 'SUCCESS';
  if (created === 0 && failed > 0) {
    overallStatus = 'FAILED';
  } else if (failed > 0 || skipped > 0) {
    overallStatus = 'PARTIAL SUCCESS';
  }

  const lines = [];
  lines.push('');
  lines.push('========================================');
  lines.push('   VMS BATCH CATALOG CREATION REPORT    ');
  lines.push('========================================');
  lines.push(`Total Catalogs: ${total}`);
  lines.push(`Created:        ${created}`);
  lines.push(`Failed:         ${failed}`);
  if (skipped > 0) lines.push(`Skipped:        ${skipped}`);
  lines.push('');

  results.forEach((r, idx) => {
    const detailStr = r.detailUrl ? ` (URL: ${r.detailUrl})` : '';
    const errStr = r.error ? ` - Error: ${r.error}` : '';
    const routeStr = r.routeCount !== undefined ? ` [${r.routeCount} route(s)]` : '';
    lines.push(`[${idx + 1}] ${r.name}${routeStr} - ${r.status}${detailStr}${errStr}`);
  });

  lines.push('');
  lines.push(`Batch Status: ${overallStatus}`);
  lines.push('========================================\n');

  return {
    summaryText: lines.join('\n'),
    total,
    created,
    failed,
    skipped,
    overallStatus,
  };
}

/**
 * Execute Batch Catalog Creation in one workflow session
 * - Reuses existing VMS authentication/session and browser context
 * - Single sequential workflow
 * - Does not offer Sequential vs Concurrent
 * - Continues processing remaining catalogs on single failure
 * - Avoids duplicate creation if catalog already exists in VMS
 */
async function executeBatchCatalogs(catalogs, options = {}) {
  const results = [];
  if (!catalogs || catalogs.length === 0) {
    return results;
  }

  let initialExisting = [];
  if (Array.isArray(options.catalogs)) {
    initialExisting = options.catalogs;
  } else if (Array.isArray(options.existingCatalogs)) {
    initialExisting = options.existingCatalogs;
  } else {
    const existingCatalogsResult = await getAvailableCatalogs(options).catch(() => ({ catalogs: [] }));
    initialExisting = existingCatalogsResult.catalogs || [];
  }
  const existingNames = new Set(initialExisting.map(c => (typeof c === 'string' ? c : (c.name || '')).trim().toLowerCase()));

  // Reusable page/browser options
  let browser = options.browser || null;
  let context = options.context || null;
  let page = options.page || null;
  let ownsBrowser = false;

  if (!page) {
    const authRes = await getAuthenticatedVmsPage(options);
    browser = authRes.browser;
    context = authRes.context;
    page = authRes.page;
    ownsBrowser = true;
  }

  try {
    for (let i = 0; i < catalogs.length; i++) {
      const cat = catalogs[i];
      const catName = cat.name.trim();

      // Duplicate Check
      if (existingNames.has(catName.toLowerCase())) {
        console.log(`[VMSBatch] Catalog "${catName}" already exists in VMS. Skipping duplicate creation.`);
        results.push({
          index: i + 1,
          name: catName,
          status: 'SKIPPED',
          error: 'Catalog already exists in VMS table',
          detailUrl: null,
          routeCount: 0,
        });
        continue;
      }

      console.log(`\n[VMSBatch] Processing Catalog [${i + 1}/${catalogs.length}]: "${catName}"...`);

      try {
        // Create Parent Catalog using existing catalog manager
        const parentRes = await createParentCatalog(page, {
          name: catName,
          startDate: cat.startDate,
          endDate: cat.endDate,
        }, options);

        if (!parentRes.success) {
          throw new Error('Parent catalog creation returned unsuccessful');
        }

        existingNames.add(catName.toLowerCase());

        // Process any non-template executable routes
        const executableRoutes = (cat.routes || []).filter(r => !r.isTemplate && !r.origin?.error && !r.destination?.error);
        let routeResults = [];

        if (executableRoutes.length > 0 && parentRes.detailUrl) {
          console.log(`[VMSBatch] Adding ${executableRoutes.length} executable route(s) to "${catName}"...`);
          routeResults = await createCatalogRoutesBatch(page, executableRoutes, options);
        }

        results.push({
          index: i + 1,
          name: catName,
          status: 'CREATED',
          detailUrl: parentRes.detailUrl || null,
          routeCount: executableRoutes.length,
          routeResults,
        });

        console.log(`[VMSBatch] Successfully created catalog "${catName}".`);
      } catch (err) {
        console.error(`[VMSBatch ERROR] Failed creating catalog "${catName}":`, err.message);

        // Check if page or browser crashed
        const isSessionDead = page.isClosed() || (err.message && /Target page, context or browser has been closed|session closed|navigation/i.test(err.message));
        if (isSessionDead) {
          results.push({
            index: i + 1,
            name: catName,
            status: 'FAILED',
            error: `Session terminated: ${err.message}`,
          });

          // Mark remaining as FAILED due to session failure
          for (let j = i + 1; j < catalogs.length; j++) {
            results.push({
              index: j + 1,
              name: catalogs[j].name,
              status: 'FAILED',
              error: 'Browser session terminated prematurely',
            });
          }
          break;
        } else {
          results.push({
            index: i + 1,
            name: catName,
            status: 'FAILED',
            error: err.message,
          });
        }
      }
    }
  } finally {
    if (ownsBrowser) {
      await page.close().catch(() => {});
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }

  return results;
}

module.exports = {
  splitBatchInput,
  parseCatalogBlock,
  parseBatchCatalogInput,
  formatBatchReview,
  formatBatchSummaryReport,
  executeBatchCatalogs,
};
