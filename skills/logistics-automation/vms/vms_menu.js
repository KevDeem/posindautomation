/**
 * VMS Interactive CLI Menu
 * Provides interactive terminal workflow for:
 * 1. Create Service Catalog (parent catalog + multi-route natural language wizard + review & execute)
 * 2. Manage Existing Service Catalogs (list active/upcoming catalogs, inspect status)
 * 3. Add Routes to Existing Catalog (select catalog, input natural language route, review & execute)
 * 4. Return to Main Menu
 * 
 * Respects CLI browser mode (Headed vs Headless).
 * Completely isolated from OMS session & state.
 */

const { getAuthenticatedVmsPage } = require('./vms_auth');
const {
  createParentCatalog,
  openCatalogDetailByName,
  openCatalogDetail,
  listServiceCatalogs,
  getAvailableCatalogs,
} = require('./catalog_manager');
const { createCatalogRoutesBatch } = require('./route_manager');
const {
  parseRoutePrompt,
  normalizeRouteSpecification,
  formatCatalogReview,
  formatRouteReview,
} = require('./vms_spec_builder');
const {
  parseBatchCatalogInput,
  formatBatchReview,
  formatBatchSummaryReport,
  executeBatchCatalogs,
} = require('./batch_catalog_manager');

/**
 * Prompt helper matching order_bot readline convention
 */
async function promptQuestion(rl, questionText) {
  const answer = await rl.question(questionText);
  return (answer || '').trim();
}

/**
 * Split route inputs separated by semicolon or newline
 */
function splitRoutePrompts(text) {
  if (!text) return [];
  return text.split(/[;\n]+/).map(s => s.trim()).filter(Boolean);
}

/**
 * Flow 1: Create a new Parent Catalog and optional initial routes
 */
async function handleCreateCatalogFlow(rl, options = {}) {
  const modeLabel = options.headless ? 'Headless (background)' : 'Headed (visible browser)';
  console.log('\n=== Create Service Catalog ===');
  console.log('Provide catalog header details:');

  const nameAns = await promptQuestion(rl, 'Catalog Name (e.g. "Smart Routing Corporate 2027"): ');
  const catalogName = nameAns || `Catalog ${new Date().toISOString().slice(0, 10)}`;

  const startDateAns = await promptQuestion(rl, 'Start Date (YYYY-MM-DD, default today): ');
  const startDate = startDateAns || new Date().toISOString().slice(0, 10);

  const defaultEndYear = new Date().getFullYear() + 2;
  const defaultEnd = `${defaultEndYear}-12-31`;
  const endDateAns = await promptQuestion(rl, `End Date (YYYY-MM-DD, default ${defaultEnd}): `);
  const endDate = endDateAns || defaultEnd;

  console.log('\nEnter natural language route descriptions for this catalog.');
  console.log('Examples:');
  console.log('  - Land:  "Rawalumbu, Bekasi - Bandung Wetan, Bandung, 5 hours, FTL"');
  console.log('  - Sea:   "Tanjung Priok, Jakarta - Pasir Panjang, Singapore FCL 15 Dec 2026 08:00, 15 hours"');
  console.log('  - Air:   "Soekarno-Hatta, Tangerang - Changi, Singapore Cargo 15 Dec 2026 08:00, 6 hours"');
  console.log('(Separate multiple routes with semicolons or add them one by one)');

  const initialRoutesInput = await promptQuestion(rl, '\nRoute description (Press Enter to create empty catalog): ');
  const rawPrompts = splitRoutePrompts(initialRoutesInput);

  // Allow adding more routes interactively
  if (rawPrompts.length > 0) {
    while (true) {
      const more = await promptQuestion(rl, 'Add another route description? (Press Enter to finish): ');
      if (!more || /^(?:n|no|selesai|done|tidak)$/i.test(more.trim())) break;
      const parts = splitRoutePrompts(more);
      rawPrompts.push(...parts);
    }
  }

  // Parse and normalize routes
  const normalizedRoutes = rawPrompts.map(p => {
    const parsed = parseRoutePrompt(p);
    return normalizeRouteSpecification(parsed);
  });

  // Verify location resolutions
  let hasLocationError = false;
  console.log('\n======================================================');
  console.log('         LOCATION RESOLUTION REVIEW');
  console.log('======================================================');
  normalizedRoutes.forEach((r, idx) => {
    const origInfo = r.origin.portName
      ? `${r.origin.portName} (${r.origin.city}, ${r.origin.country}) [PORT]`
      : `${r.origin.district}, ${r.origin.city}, ${r.origin.province} [DOOR] (Match: ${r.origin.confidence || 'NORMAL'})`;
    const destInfo = r.destination.portName
      ? `${r.destination.portName} (${r.destination.city}, ${r.destination.country}) [PORT]`
      : `${r.destination.district}, ${r.destination.city}, ${r.destination.province} [DOOR] (Match: ${r.destination.confidence || 'NORMAL'})`;

    console.log(`[Route #${idx + 1}] Input: "${r.rawPrompt || r.routeName}"`);
    console.log(`  • Resolved Origin:      ${origInfo}`);
    console.log(`  • Resolved Destination: ${destInfo}`);

    if (r.origin.error || r.destination.error || !r.origin.city || !r.destination.city) {
      console.log(`  [ERROR] Location resolution failed or incomplete for Route #${idx + 1}!`);
      hasLocationError = true;
    }
  });
  console.log('======================================================');

  if (hasLocationError) {
    console.log('\n[VMS ERROR] Cannot proceed: One or more route locations could not be resolved reliably.');
    console.log('Aborting catalog creation to prevent incorrect route creation in VMS.\n');
    return;
  }

  const catalogSpec = {
    name: catalogName,
    startDate,
    endDate,
    routes: normalizedRoutes,
  };

  // Display review
  console.log('\n' + formatCatalogReview(catalogSpec));

  // Confirm execution
  const confirm = await promptQuestion(rl, '\nConfirm resolved locations and approve catalog creation in VMS? [y/N]: ');
  if (!/^(?:y|yes|ya)$/i.test(confirm)) {
    console.log('[CANCELED] Catalog creation aborted. No changes made in VMS.');
    return;
  }

  console.log(`\n[VMS] Launching ${modeLabel} browser to execute catalog creation...`);
  const { browser, context, page } = await getAuthenticatedVmsPage(options);

  try {
    const parentRes = await createParentCatalog(page, catalogSpec, options);
    console.log(`[VMS] Parent Catalog Created: "${parentRes.catalogName}"`);

    if (normalizedRoutes.length > 0 && parentRes.detailUrl) {
      console.log(`[VMS] Adding ${normalizedRoutes.length} route(s) to catalog...`);
      const routeResults = await createCatalogRoutesBatch(page, normalizedRoutes);
      console.log('\n======================================================');
      console.log('            VMS ROUTE SUBMISSION REPORT               ');
      console.log('======================================================');
      routeResults.forEach((r, idx) => {
        console.log(`[#${idx + 1}] ${r.routeName}: ${r.status || 'SUBMITTED'} ${r.error ? `(Error: ${r.error})` : ''}`);
      });
      console.log('======================================================\n');
    } else {
      console.log('[VMS] Catalog created successfully with 0 initial routes.');
    }
  } catch (err) {
    console.error('[VMS ERROR] Catalog execution failed:', err.message);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Flow 2: Manage Existing Catalogs (List catalogs)
 * Always retrieves catalogs headlessly and leverages the metadata cache.
 */
async function handleListCatalogsFlow(rl, options = {}) {
  console.log('\n=== Manage Existing Service Catalogs ===');
  try {
    const res = await getAvailableCatalogs(options);
    const catalogs = res.catalogs;
    if (!catalogs || catalogs.length === 0) {
      console.log('No catalogs found in VMS.');
    } else {
      console.log('\n-------------------------------------------------------------------------------------------------');
      console.log('NAME                                | SERVICES | VALID FROM         | VALID UNTIL        | STATUS');
      console.log('-------------------------------------------------------------------------------------------------');
      catalogs.forEach(c => {
        const namePad = (c.name || '').padEnd(35).slice(0, 35);
        const srvPad = String(c.services || 0).padEnd(8).slice(0, 8);
        const startPad = (c.startDate || '-').padEnd(18).slice(0, 18);
        const endPad = (c.endDate || '-').padEnd(18).slice(0, 18);
        console.log(`${namePad} | ${srvPad} | ${startPad} | ${endPad} | ${c.status || '-'}`);
      });
      console.log('-------------------------------------------------------------------------------------------------\n');
    }
  } catch (err) {
    console.error('[VMS ERROR] Could not fetch catalog list:', err.message);
  }

  await promptQuestion(rl, 'Press Enter to return to VMS menu...');
}

/**
 * Flow 3: Add Routes to an Existing Catalog
 * - Retrieves catalog list headlessly (with TTL caching and inflight deduplication)
 * - Prompts user with numbered catalog list without launching a visible browser
 * - Supports refresh ('r' / 'refresh') to force-refresh catalog metadata
 * - Respects the user's CLI browser mode (headed/headless) ONLY upon route execution
 * - Never creates parent catalog automatically
 * - Directly navigates to verified detail URL if present
 */
async function handleAddRoutesToExistingCatalogFlow(rl, options = {}) {
  console.log('\n=== Add Routes to Existing Catalog ===');

  let catalogs = null;
  let fromCache = false;
  let ageSeconds = 0;

  const fetchCatalogs = async (forceRefresh = false) => {
    const res = await getAvailableCatalogs({ ...options, refresh: forceRefresh });
    catalogs = res.catalogs;
    fromCache = res.fromCache;
    ageSeconds = res.ageSeconds;
  };

  try {
    await fetchCatalogs(false);
  } catch (err) {
    console.error('[VMS ERROR] Could not retrieve catalog list:', err.message);
    return;
  }

  if (!catalogs || catalogs.length === 0) {
    console.log('\n[VMS] No service catalogs found in the VMS table.');
    return;
  }

  const printCatalogTable = () => {
    console.log('\n=================================================================================================');
    console.log('                                  AVAILABLE VMS SERVICE CATALOGS                                 ');
    if (fromCache) {
      console.log(`                             (Loaded from cache - age: ${ageSeconds}s)                              `);
    }
    console.log('=================================================================================================');
    console.log('#   | Catalog Name                                  | Services | Validity Period           | Status');
    console.log('----+-----------------------------------------------+----------+---------------------------+------------');
    catalogs.forEach((c, idx) => {
      const numPad = String(idx + 1).padEnd(3);
      const namePad = (c.name || '').padEnd(45).slice(0, 45);
      const srvPad = String(c.services || 0).padEnd(8);
      const periodPad = `${c.startDate || '-'} to ${c.endDate || '-'}`.padEnd(25).slice(0, 25);
      console.log(`${numPad} | ${namePad} | ${srvPad} | ${periodPad} | ${c.status || '-'}`);
    });
    console.log('=================================================================================================\n');
  };

  printCatalogTable();

  let targetCatalog = null;
  let selectedCliIndex = null;

  while (!targetCatalog) {
    const selectionInput = await promptQuestion(rl, `Select catalog [1-${catalogs.length}], enter name, 'r' to refresh, or 'q' to cancel: `);
    if (!selectionInput || /^(?:q|quit|cancel|exit)$/i.test(selectionInput)) {
      console.log('[CANCELED] Catalog selection canceled.');
      return;
    }

    if (/^(?:r|refresh)$/i.test(selectionInput)) {
      console.log('[VMS] Refreshing catalog list from VMS staging...');
      try {
        await fetchCatalogs(true);
        printCatalogTable();
      } catch (err) {
        console.error('[VMS ERROR] Failed to refresh catalog list:', err.message);
      }
      continue;
    }

    // Number selection
    const num = parseInt(selectionInput, 10);
    if (!isNaN(num) && num >= 1 && num <= catalogs.length) {
      selectedCliIndex = num;
      targetCatalog = catalogs[num - 1];
      break;
    }

    // Exact name match
    const exactMatchIdx = catalogs.findIndex(c => c.name.toLowerCase() === selectionInput.toLowerCase());
    if (exactMatchIdx !== -1) {
      selectedCliIndex = exactMatchIdx + 1;
      targetCatalog = catalogs[exactMatchIdx];
      break;
    }

    // Partial search matches
    const searchMatches = [];
    catalogs.forEach((c, idx) => {
      if (c.name.toLowerCase().includes(selectionInput.toLowerCase())) {
        searchMatches.push({ catalog: c, index: idx + 1 });
      }
    });

    if (searchMatches.length === 1) {
      selectedCliIndex = searchMatches[0].index;
      targetCatalog = searchMatches[0].catalog;
      console.log(`Matched catalog: "${targetCatalog.name}" (#${selectedCliIndex})`);
      break;
    } else if (searchMatches.length > 1) {
      console.log(`\nMultiple catalogs match "${selectionInput}":`);
      searchMatches.forEach(m => {
        console.log(`  [${m.index}] ${m.catalog.name} (${m.catalog.status})`);
      });
      const subChoice = await promptQuestion(rl, `Choose matched catalog [1-${searchMatches.length}]: `);
      const subNum = parseInt(subChoice, 10);
      const chosen = searchMatches.find(m => m.index === subNum);
      if (chosen) {
        selectedCliIndex = chosen.index;
        targetCatalog = chosen.catalog;
        break;
      }
    } else {
      console.log(`\n[LOOKUP FAILED] No catalog found matching "${selectionInput}".`);
      console.log(`Available catalogs in VMS: ${catalogs.map(c => `"${c.name}"`).join(', ')}`);
      console.log('Please select a valid catalog by number or exact name from the list above.\n');
    }
  }

  console.log(`\nTarget Catalog Confirmed: "${targetCatalog.name}" (Status: ${targetCatalog.status || '-'}, Selection: #${selectedCliIndex || 'N/A'})`);

  console.log(`\nEnter natural language route descriptions for "${targetCatalog.name}":`);
  const initialRoute = await promptQuestion(rl, 'Route description: ');
  if (!initialRoute) {
    console.log('[CANCELED] At least one route description is required.');
    return;
  }

  const rawPrompts = splitRoutePrompts(initialRoute);
  while (true) {
    const more = await promptQuestion(rl, 'Add another route description? (Press Enter to finish): ');
    if (!more || /^(?:n|no|selesai|done|tidak)$/i.test(more.trim())) break;
    rawPrompts.push(...splitRoutePrompts(more));
  }

  const normalizedRoutes = rawPrompts.map(p => {
    const parsed = parseRoutePrompt(p);
    return normalizeRouteSpecification(parsed);
  });

  // Verify location resolutions explicitly before execution
  let hasLocationError = false;
  console.log('\n======================================================');
  console.log('         LOCATION RESOLUTION REVIEW');
  console.log('======================================================');
  normalizedRoutes.forEach((r, idx) => {
    const origInfo = r.origin.portName
      ? `${r.origin.portName} (${r.origin.city}, ${r.origin.country}) [PORT]`
      : `${r.origin.district}, ${r.origin.city}, ${r.origin.province} [DOOR] (Match: ${r.origin.confidence || 'NORMAL'})`;
    const destInfo = r.destination.portName
      ? `${r.destination.portName} (${r.destination.city}, ${r.destination.country}) [PORT]`
      : `${r.destination.district}, ${r.destination.city}, ${r.destination.province} [DOOR] (Match: ${r.destination.confidence || 'NORMAL'})`;

    console.log(`[Route #${idx + 1}] Input: "${r.rawPrompt || r.routeName}"`);
    console.log(`  • Resolved Origin:      ${origInfo}`);
    console.log(`  • Resolved Destination: ${destInfo}`);

    if (r.origin.error || r.destination.error || !r.origin.city || !r.destination.city) {
      console.log(`  [ERROR] Location resolution failed or incomplete for Route #${idx + 1}!`);
      hasLocationError = true;
    }
  });
  console.log('======================================================');

  if (hasLocationError) {
    console.log('\n[VMS ERROR] Cannot proceed: One or more route locations could not be resolved reliably.');
    console.log('Aborting route submission to prevent incorrect route creation in VMS.\n');
    return;
  }

  console.log('\n======================================================');
  console.log(`ROUTES TO BE ADDED TO: "${targetCatalog.name}"`);
  console.log('======================================================');
  normalizedRoutes.forEach((r, idx) => {
    console.log(formatRouteReview(r, idx + 1));
  });
  console.log('======================================================\n');

  const confirm = await promptQuestion(rl, 'Confirm resolved locations and approve route submission to VMS? [y/N]: ');
  if (!/^(?:y|yes|ya)$/i.test(confirm)) {
    console.log('[CANCELED] Route submission aborted. No changes made in VMS.');
    return;
  }

  const modeLabel = options.headless ? 'Headless (background)' : 'Headed (visible browser)';
  console.log(`\n[VMS] Launching ${modeLabel} browser to execute route addition...`);
  const { browser, context, page } = await getAuthenticatedVmsPage(options);

  try {
    console.log(`[VMS] Navigating to route details for "${targetCatalog.name}" via UI...`);
    const navRes = await openCatalogDetail(page, targetCatalog, {
      ...options,
      selectedCliIndex,
      catalogName: targetCatalog.name,
    });
    console.log(`[VMS] Successfully reached catalog detail for "${navRes.catalogName}".`);

    const routeResults = await createCatalogRoutesBatch(page, normalizedRoutes, {
      ...options,
      catalogName: targetCatalog.name,
    });
    console.log('\n======================================================');
    console.log('            VMS ROUTE SUBMISSION REPORT               ');
    console.log('======================================================');
    routeResults.forEach((r, idx) => {
      console.log(`[#${idx + 1}] ${r.routeName}: ${r.status || 'SUBMITTED'} ${r.error ? `(Error: ${r.error})` : ''}`);
    });
    console.log('======================================================\n');
  } catch (err) {
    console.error('[VMS ERROR] Route addition failed:', err.message);
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * Flow 2: Create Multiple Service Catalogs in Batch
 * - Accepts multi-catalog natural language input
 * - Parses and normalizes each catalog independently
 * - Displays complete batch review
 * - Allows approval, cancellation, or individual editing
 * - Executes in a single session without sequential/concurrent mode prompting
 * - Summarizes batch results
 */
async function handleCreateMultipleCatalogsFlow(rl, options = {}) {
  const modeLabel = options.headless ? 'Headless (background)' : 'Headed (visible browser)';
  console.log('\n=== Create Multiple Service Catalogs (Batch) ===');
  console.log('Enter multiple catalog specifications in natural language.');
  console.log('Example:');
  console.log('1. Catalog Smart Routing Domestic');
  console.log('   Valid from 1 December 2026 until 31 December 2026');
  console.log('   Domestic Land FTL\n');
  console.log('2. Catalog Smart Routing International');
  console.log('   Valid from 1 December 2026 until 31 December 2026');
  console.log('   International Sea FCL\n');
  console.log('(Enter specifications line by line; submit an empty line or "done" to finish):');

  const inputLines = [];
  while (true) {
    const line = await promptQuestion(rl, '> ');
    if (!line || /^(?:done|selesai|submit)$/i.test(line.trim())) {
      if (inputLines.length > 0) break;
      console.log('Please enter at least one catalog specification or type "cancel" to exit.');
      continue;
    }
    if (/^(?:cancel|batal|q|exit)$/i.test(line.trim())) {
      console.log('[CANCELED] Batch catalog creation canceled.');
      return;
    }
    inputLines.push(line);
  }

  const rawInput = inputLines.join('\n');
  let catalogs = parseBatchCatalogInput(rawInput);

  if (catalogs.length === 0) {
    console.log('[CANCELED] No valid catalog specifications parsed.');
    return;
  }

  // Batch review & edit loop
  while (true) {
    console.log('\n' + formatBatchReview(catalogs));

    console.log('Batch Actions:');
    console.log('  [Y] Approve and execute batch');
    console.log('  [E] Edit an individual catalog before execution');
    console.log('  [N] Cancel batch');

    const action = await promptQuestion(rl, '\nSelect action [y/e/N]: ');

    if (/^(?:y|yes|ya|approve)$/i.test(action)) {
      break;
    } else if (/^(?:e|edit)$/i.test(action)) {
      const idxStr = await promptQuestion(rl, `Enter catalog number to edit [1-${catalogs.length}]: `);
      const catIdx = parseInt(idxStr, 10);
      if (isNaN(catIdx) || catIdx < 1 || catIdx > catalogs.length) {
        console.log('Invalid catalog index.');
        continue;
      }

      const target = catalogs[catIdx - 1];
      console.log(`\nEditing Catalog #${catIdx}: "${target.name}"`);
      const newName = await promptQuestion(rl, `Catalog Name (Current: "${target.name}", press Enter to keep): `);
      if (newName) target.name = newName;

      const newStart = await promptQuestion(rl, `Start Date (Current: "${target.startDate}", press Enter to keep): `);
      if (newStart) target.startDate = newStart;

      const newEnd = await promptQuestion(rl, `End Date (Current: "${target.endDate}", press Enter to keep): `);
      if (newEnd) target.endDate = newEnd;

      console.log(`Catalog #${catIdx} updated.`);
      continue;
    } else {
      console.log('[CANCELED] Batch catalog creation aborted. No changes made in VMS.');
      return;
    }
  }

  console.log(`\n[VMS] Launching ${modeLabel} browser to execute batch catalog creation...`);
  const results = await executeBatchCatalogs(catalogs, options);
  const report = formatBatchSummaryReport(results);
  console.log(report.summaryText);
}

/**
 * VMS Main Interactive Menu
 */
async function handleVmsMenu(rl, options = {}) {
  let inVms = true;
  while (inVms) {
    console.log('\n--- VMS SERVICE CATALOG MENU ---');
    console.log('1. Create Service Catalog');
    console.log('2. Create Multiple Service Catalogs');
    console.log('3. Manage Existing Service Catalogs');
    console.log('4. Add Routes to Existing Catalog');
    console.log('5. Return to Main Menu');

    const choice = await promptQuestion(rl, '\nSelect option [1-5]: ');

    switch (choice) {
      case '1':
        await handleCreateCatalogFlow(rl, options);
        break;
      case '2':
        await handleCreateMultipleCatalogsFlow(rl, options);
        break;
      case '3':
        await handleListCatalogsFlow(rl, options);
        break;
      case '4':
        await handleAddRoutesToExistingCatalogFlow(rl, options);
        break;
      case '5':
      case 'back':
      case 'return':
      case 'q':
        console.log('Returning to POSIND main menu...');
        inVms = false;
        break;
      default:
        console.log('Invalid selection. Please choose an option between 1 and 5.');
        break;
    }
  }
}

module.exports = {
  handleVmsMenu,
  handleCreateCatalogFlow,
  handleCreateMultipleCatalogsFlow,
  handleListCatalogsFlow,
  handleAddRoutesToExistingCatalogFlow,
  promptQuestion,
};
