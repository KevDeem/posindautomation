/**
 * Interactive POSIND Ordering Bot
 * 
 * Standalone CLI application enabling routine order creation and payment
 * simulation through simple natural-language or structured input.
 */

const readline = require('readline/promises');
const { stdin: input, stdout: output } = require('process');
const { loadConfig } = require('./config');
const { parseOrderPrompt } = require('./nl_parser');
const { saveExecutionRecord, listExecutionRecords } = require('./history_manager');
const {
  resolveSpecification,
  formatSpecificationReview,
  DEFAULT_SPECIFICATION,
} = require('../tools/order_specification');
const { executeOrder } = require('../tools/order_executor');
const { executeBatch } = require('../tools/batch_executor');
const { executeOrderPayment, formatRupiah } = require('../tools/payment_executor');
const {
  validateLocationHierarchy,
  normalizeAdminCityName,
} = require('../tools/location_matcher');
const { handleVmsMenu } = require('../vms');

/**
 * Prompt user for input via readline
 */
async function promptQuestion(rl, questionText) {
  const answer = await rl.question(questionText);
  return answer.trim();
}

/**
 * Prompt user for browser execution mode at the beginning of each session.
 * 
 * @param {readline.Interface} rl
 * @returns {Promise<boolean>} headless (false = Headed, true = Headless)
 */
async function promptBrowserMode(rl) {
  console.log('\nBrowser Mode:');
  console.log('1. Headed (visible browser)');
  console.log('2. Headless (background)\n');
  const answer = await promptQuestion(rl, 'Select mode [1-2] (default: 1): ');
  if (answer === '2') {
    return true; // Headless
  }
  return false; // Headed (default: 1)
}

/**
 * Handle interactive missing mandatory fields
 */
async function resolveMissingMandatory(rl, spec, missingList) {
  for (const field of missingList) {
    if (field === 'pickup.city') {
      const ans = await promptQuestion(rl, 'Enter Pickup City (e.g. Jakarta Selatan, Cirebon): ');
      if (ans) {
        spec.pickup = spec.pickup || {};
        spec.pickup.city = ans;
      }
    } else if (field === 'dropoff.city') {
      const ans = await promptQuestion(rl, 'Enter Drop-off City (e.g. Surabaya, Tegal, Singapore): ');
      if (ans) {
        spec.dropoff = spec.dropoff || {};
        spec.dropoff.city = ans;
      }
    } else if (field === 'scheduledDate') {
      const ans = await promptQuestion(rl, 'Enter Pickup Date (YYYY-MM-DD): ');
      if (ans) spec.scheduledDate = ans;
    } else if (field === 'cargo.itemName') {
      const ans = await promptQuestion(rl, 'Enter Item Name: ');
      if (ans) {
        spec.cargo = spec.cargo || {};
        spec.cargo.itemName = ans;
      }
    } else if (field === 'cargo.weightKg') {
      const ans = await promptQuestion(rl, 'Enter Weight in KG: ');
      if (ans) {
        spec.cargo = spec.cargo || {};
        spec.cargo.weightKg = parseInt(ans, 10) || 50;
      }
    }
  }
}

/**
 * Allow user to interactively modify resolved specification
 */
async function promptSpecificationEdits(rl, spec) {
  console.log('\n--- Modify Specification (Press Enter to keep current value) ---');
  const newDate = await promptQuestion(rl, `Pickup Date [${spec.scheduledDate}]: `);
  if (newDate) spec.scheduledDate = newDate;

  const newTime = await promptQuestion(rl, `Pickup Time [${spec.scheduledTime}]: `);
  if (newTime) spec.scheduledTime = newTime;

  const newPickupCity = await promptQuestion(rl, `Pickup City [${spec.pickup.city}]: `);
  if (newPickupCity) {
    const norm = normalizeAdminCityName(newPickupCity);
    if (norm.toLowerCase() !== (spec.pickup.city || '').toLowerCase()) {
      spec.pickup.city = norm;
      spec.pickup.district = '';
      spec.pickup.subdistrict = '';
      spec.pickup.postalCode = '';
    }
  }

  const newDropoffCity = await promptQuestion(rl, `Dropoff City [${spec.dropoff.city}]: `);
  if (newDropoffCity) {
    const norm = normalizeAdminCityName(newDropoffCity);
    if (norm.toLowerCase() !== (spec.dropoff.city || '').toLowerCase()) {
      spec.dropoff.city = norm;
      spec.dropoff.district = '';
      spec.dropoff.subdistrict = '';
      spec.dropoff.postalCode = '';
    }
  }

  const newItemName = await promptQuestion(rl, `Cargo Item Name [${spec.cargo.itemName}]: `);
  if (newItemName) spec.cargo.itemName = newItemName.trim();

  const newWeight = await promptQuestion(rl, `Weight KG [${spec.cargo.weightKg}]: `);
  if (newWeight) spec.cargo.weightKg = parseInt(newWeight, 10);
}

/**
 * Validate specification before confirmation gate.
 * Returns array of warning/blocking issues.
 */
function validateSpecificationForExecution(resolvedSpec, sources = {}, userPrompt = '') {
  const issues = [];
  const warnings = [];

  // 1. Pickup Point & City
  if (!resolvedSpec.pickup || !resolvedSpec.pickup.city || String(resolvedSpec.pickup.city).trim() === '') {
    issues.push('Pickup City is empty or unresolved.');
  }

  // 2. Dropoff Point & City
  if (!resolvedSpec.dropoff || !resolvedSpec.dropoff.city || String(resolvedSpec.dropoff.city).trim() === '') {
    issues.push('Drop-off City is empty or unresolved.');
  }

  // 3. Administrative Location Hierarchy Validation
  if (resolvedSpec.pickup) {
    const pickupH = validateLocationHierarchy(resolvedSpec.pickup, 'Pickup');
    if (!pickupH.valid) {
      issues.push(pickupH.error);
    }
  }
  if (resolvedSpec.dropoff) {
    const dropoffH = validateLocationHierarchy(resolvedSpec.dropoff, 'Drop-off');
    if (!dropoffH.valid) {
      issues.push(dropoffH.error);
    }
  }

  // 3. Explicit destination provided but unresolved
  if (resolvedSpec.dropoff && resolvedSpec.dropoff.unresolved) {
    issues.push(`Explicit destination was requested ("${resolvedSpec.dropoff.raw || userPrompt}") but could not be resolved.`);
  }
  if (sources.dropoff && sources.dropoff.city === 'unresolved_explicit') {
    issues.push('Explicit destination was requested but remains unresolved.');
  }

  // 4. Warning if user typed destination keywords in prompt, but sources says reused
  const hasDestInPrompt = /(?:\bto\b|\bke\b|\bantar\s+ke\b|\btujuan\b)/i.test(userPrompt);
  if (hasDestInPrompt && sources.dropoff && sources.dropoff.city === 'reused') {
    warnings.push(`Destination keywords detected in prompt, but drop-off was reused from previous baseline (${resolvedSpec.dropoff.city}). Verify carefully.`);
  }

  // 5. Pickup address sanity check
  if (resolvedSpec.pickup && resolvedSpec.pickup.address && /(?:\bto\b|\bke\b|\bantar\b)/i.test(resolvedSpec.pickup.address)) {
    issues.push(`Pickup address contains route fragment: "${resolvedSpec.pickup.address}". Address must not include destination.`);
  }

  // 6. Scheduled date
  if (!resolvedSpec.scheduledDate || String(resolvedSpec.scheduledDate).trim() === '') {
    issues.push('Scheduled date is empty.');
  }

  return {
    issues,
    warnings,
    canSubmit: issues.length === 0,
  };
}

/**
 * Handle single order flow
 */
async function handleSingleOrderFlow(rl, config, { defaultType = 'domestic', autoPay = true } = {}) {
  console.log('\n=== Create Order and Simulate Payment ===');
  console.log('You can type your order in natural language, or press Enter to use default baseline.');
  console.log('Example: "Pickup in Tebet Jakarta Selatan to Gubeng Surabaya on 1 Dec 2026 at 08:00"');
  console.log('         "Bandung Wetan, Kota Bandung to Tokyo, Japan air cargo on Dec 1 2026 08:00"');

  const userPrompt = await promptQuestion(rl, '\nOrder description: ');
  const parsed = parseOrderPrompt(userPrompt);

  // Automatically determine orderType from parsed spec or destination country without separate prompt
  if (!parsed.spec.orderType) {
    const isForeign = (parsed.spec.dropoff?.country && parsed.spec.dropoff.country.toLowerCase() !== 'indonesia') ||
                      (parsed.spec.pickup?.country && parsed.spec.pickup.country.toLowerCase() !== 'indonesia');
    parsed.spec.orderType = isForeign ? 'international' : (defaultType || 'domestic');
  }

  // Resolve specification
  let { resolvedSpec, sources, missingMandatory } = resolveSpecification(parsed.spec);

  // Handle missing mandatory fields
  if (missingMandatory && missingMandatory.length > 0) {
    console.log(`\nMissing required fields: ${missingMandatory.join(', ')}`);
    await resolveMissingMandatory(rl, resolvedSpec, missingMandatory);
    const recheck = resolveSpecification(resolvedSpec);
    resolvedSpec = recheck.resolvedSpec;
    sources = recheck.sources;
  }

  // Display review table
  console.log('\n' + formatSpecificationReview(resolvedSpec, sources));

  // Edit option
  const editChoice = await promptQuestion(rl, 'Would you like to modify any field before submitting? (y/N): ');
  if (editChoice.toLowerCase() === 'y' || editChoice.toLowerCase() === 'yes') {
    await promptSpecificationEdits(rl, resolvedSpec);
    const recheck = resolveSpecification(resolvedSpec);
    resolvedSpec = recheck.resolvedSpec;
    sources = recheck.sources;
    console.log('\nUpdated Specification:\n' + formatSpecificationReview(resolvedSpec, sources));
  }

  // Pre-execution validation
  const validation = validateSpecificationForExecution(resolvedSpec, sources, userPrompt);
  if (validation.warnings.length > 0) {
    console.log('\n[WARNINGS DETECTED]');
    validation.warnings.forEach(w => console.warn(`  ! ${w}`));
  }

  if (!validation.canSubmit) {
    console.error('\n[BLOCKER] Order cannot be submitted due to unresolved fields:');
    validation.issues.forEach(iss => console.error(`  x ${iss}`));
    console.log('\n[CANCELED] Submission blocked due to unresolved fields.');
    return;
  }

  // Automatically simulate payment for every successfully created order
  const isPaymentRequested = autoPay !== false;

  // Policy log & direct execution
  console.log('\n[POLICY] All orders submitted strictly as Non-Contract with no automatic inquiry fallback.');

  const modeLabel = config.headless ? 'Headless (background)' : 'Headed (visible browser)';
  console.log(`\nLaunching order execution (Browser Mode: ${modeLabel})...`);
  const batchResult = await executeBatch([resolvedSpec], {
    headless: config.headless,
    autoPay: isPaymentRequested,
    maxRetries: config.maxRetries,
    sessionPath: config.sessionPath,
  });

  // Save execution record
  const savedRecord = saveExecutionRecord({
    request: userPrompt || 'Default single order',
    menuOption: 'Single Order + Payment',
    orderType: resolvedSpec.orderType,
    batchCount: 1,
    autoPay: isPaymentRequested,
    summary: {
      total: batchResult.total,
      succeeded: batchResult.succeeded,
      failed: batchResult.failed,
      totalAmountPaid: batchResult.totalAmountPaid,
    },
    orders: batchResult.orders,
    specification: resolvedSpec,
  });

  // Display structured report
  console.log('\n======================================================');
  console.log('              TRANSACTION EXECUTION REPORT            ');
  console.log('======================================================');
  const o = batchResult.orders[0] || {};
  console.log(`Order ID:               ${o.orderId || '-'}`);
  console.log(`Shipment ID:            ${o.shipmentId || '-'}`);
  console.log(`Service Catalog:        ${o.serviceCatalog || '-'}`);
  if (isPaymentRequested) {
    console.log(`VA Number:              ${o.vaNumber || '-'}`);
    console.log(`Payment Amount:         ${formatRupiah(o.amount)}`);
    console.log(`Sandbox Payment Status: ${o.sandboxPayment === 'SUCCESS' ? 'Payment Successful!' : (o.sandboxPayment || 'FAILED')}`);
    const isSuccess = o.orderStatus === 'SUCCESS' && o.vaNumber && o.sandboxPayment === 'SUCCESS' && o.overallStatus === 'SUCCESS';
    console.log(`Overall Status:         ${isSuccess ? 'SUCCESS' : (o.orderId ? 'ORDER_CREATED_PAYMENT_PENDING' : 'FAILED')}`);
  } else {
    console.log(`Payment Status:         ORDER_CREATED (Not Requested)`);
    console.log(`Overall Status:         ${o.orderStatus === 'SUCCESS' ? 'SUCCESS (Order Created - Payment Not Requested)' : 'FAILED'}`);
  }
  if (o.error) {
    console.log(`Error Blocker:          ${o.error}`);
  }
  console.log(`Saved Record ID:        ${savedRecord.id}`);
  console.log('======================================================\n');
}

/**
 * Split raw batch instruction string into distinct specification items
 */
function splitBatchPrompt(prompt = '') {
  const text = String(prompt).trim();
  if (!text) return [];

  // 1. Explicit delimiters: semicolon, newline, pipe
  if (/[;\n|]/.test(text)) {
    return text.split(/[;\n|]+/).map(s => s.trim()).filter(Boolean);
  }

  // 2. Conjunctions between distinct orders (e.g., "... on 1 Dec 2026 and 2 international orders ...")
  const conjunctionRegex = /\s+(?:and|\balso\b|\bdan\b)\s+(?=(?:create|buat|\d+\s*(?:domestic|international|orders?|pesanan|pengiriman)|international|domestic|from|pickup|jemput|kirim)\b)/i;
  if (conjunctionRegex.test(text)) {
    return text.split(conjunctionRegex).map(s => s.trim()).filter(Boolean);
  }

  return [text];
}

/**
 * Prompt user to select batch execution mode (Sequential vs Bulk / Concurrent).
 * Explains differences clearly and requires valid user selection before proceeding.
 */
async function promptBatchExecutionMode(rl, defaultConcurrency = 3) {
  console.log('\n--- Choose Execution Mode ---');
  console.log('1. Sequential        – Process orders one at a time. Complete order creation and payment for each order before starting the next.');
  console.log(`2. Bulk / Concurrent – Process multiple orders simultaneously using independent workers (default ${defaultConcurrency} concurrent workers).`);

  while (true) {
    const choice = await promptQuestion(rl, '\nSelect execution mode [1-2]: ');
    const trimmed = (choice || '').trim().toLowerCase();

    if (trimmed === '1' || trimmed === 'sequential' || trimmed === 'seq') {
      console.log('-> Execution Mode: Sequential (1 order at a time)');
      return { mode: 'sequential', concurrency: 1, label: 'Sequential (1 order at a time)' };
    }
    if (trimmed === '2' || trimmed === 'bulk' || trimmed === 'concurrent' || trimmed === 'bulk / concurrent' || trimmed === 'bulk/concurrent') {
      console.log(`-> Execution Mode: Bulk / Concurrent (${defaultConcurrency} concurrent workers)`);
      return { mode: 'concurrent', concurrency: defaultConcurrency, label: `Bulk / Concurrent (${defaultConcurrency} concurrent workers)` };
    }

    console.log('Invalid selection. Please choose 1 for Sequential or 2 for Bulk / Concurrent.');
  }
}

/**
 * Handle batch orders flow (supporting mixed Domestic & International orders)
 */
async function handleBatchOrderFlow(rl, config, { autoPay = true, executionMode = null, concurrency: customConcurrency = null } = {}) {
  console.log('\n=== Create Multiple Orders and Simulate Payment ===');

  const defaultConcurrency = (config && config.batchConcurrency !== undefined && config.batchConcurrency > 0)
    ? config.batchConcurrency
    : 3;

  let selectedMode;
  if (executionMode) {
    const isSeq = executionMode === 'sequential' || executionMode === '1';
    const c = isSeq ? 1 : (customConcurrency || defaultConcurrency);
    selectedMode = {
      mode: isSeq ? 'sequential' : 'concurrent',
      concurrency: c,
      label: isSeq ? 'Sequential (1 order at a time)' : `Bulk / Concurrent (${c} concurrent workers)`,
    };
  } else if (rl) {
    selectedMode = await promptBatchExecutionMode(rl, defaultConcurrency);
  } else {
    selectedMode = {
      mode: 'concurrent',
      concurrency: defaultConcurrency,
      label: `Bulk / Concurrent (${defaultConcurrency} concurrent workers)`,
    };
  }

  console.log('\nYou can specify single or mixed Domestic & International orders, counts, and routes.');
  console.log('Example: "Create 5 domestic orders from Tebet to Gubeng at 08:00 on 1 Dec 2026"');
  console.log('         "2 domestic orders from Tebet to Gubeng; 2 international orders from Bandung to Tokyo"');

  const userPrompt = await promptQuestion(rl, '\nBatch description: ');
  const promptParts = splitBatchPrompt(userPrompt);

  const rawEntries = [];

  if (promptParts.length > 1) {
    for (const part of promptParts) {
      const parsed = parseOrderPrompt(part);
      if (!parsed.spec.orderType) {
        const isForeign = (parsed.spec.dropoff?.country && parsed.spec.dropoff.country.toLowerCase() !== 'indonesia') ||
                          (parsed.spec.pickup?.country && parsed.spec.pickup.country.toLowerCase() !== 'indonesia');
        parsed.spec.orderType = isForeign ? 'international' : 'domestic';
      }
      rawEntries.push({
        rawPrompt: part,
        spec: parsed.spec,
        count: parsed.count || 1,
      });
    }
  } else {
    const singleText = promptParts[0] || '';
    const parsed = parseOrderPrompt(singleText);
    if (!parsed.spec.orderType) {
      const isForeign = (parsed.spec.dropoff?.country && parsed.spec.dropoff.country.toLowerCase() !== 'indonesia') ||
                        (parsed.spec.pickup?.country && parsed.spec.pickup.country.toLowerCase() !== 'indonesia');
      parsed.spec.orderType = isForeign ? 'international' : 'domestic';
    }

    let count = parsed.count || 1;
    if (count <= 1) {
      const countAns = await promptQuestion(rl, 'How many identical orders to create in this batch? (default: 5): ');
      count = parseInt(countAns, 10) || 5;
    }

    rawEntries.push({
      rawPrompt: singleText,
      spec: parsed.spec,
      count,
    });

    // Optionally allow adding another specification interactively
    while (true) {
      const anotherPrompt = await promptQuestion(rl, 'Add another order specification to this batch? (Press Enter to finish): ');
      if (!anotherPrompt || /^(?:n|no|selesai|done|tidak)$/i.test(anotherPrompt.trim())) {
        break;
      }
      const parsedAnother = parseOrderPrompt(anotherPrompt);
      if (!parsedAnother.spec.orderType) {
        const isForeign = (parsedAnother.spec.dropoff?.country && parsedAnother.spec.dropoff.country.toLowerCase() !== 'indonesia') ||
                          (parsedAnother.spec.pickup?.country && parsedAnother.spec.pickup.country.toLowerCase() !== 'indonesia');
        parsedAnother.spec.orderType = isForeign ? 'international' : 'domestic';
      }
      let anotherCount = parsedAnother.count || 1;
      if (anotherCount <= 1) {
        const cAns = await promptQuestion(rl, 'How many identical orders for this route? (default: 1): ');
        anotherCount = parseInt(cAns, 10) || 1;
      }
      rawEntries.push({
        rawPrompt: anotherPrompt,
        spec: parsedAnother.spec,
        count: anotherCount,
      });
    }
  }

  // Resolve and validate each specification entry
  const resolvedGroups = [];
  for (let i = 0; i < rawEntries.length; i++) {
    const entry = rawEntries[i];
    if (rawEntries.length > 1) {
      console.log(`\n--- Specification #${i + 1} (${entry.spec.orderType || 'domestic'}) ---`);
    }
    let { resolvedSpec, sources, missingMandatory } = resolveSpecification(entry.spec);
    if (missingMandatory && missingMandatory.length > 0) {
      console.log(`\nMissing required fields: ${missingMandatory.join(', ')}`);
      await resolveMissingMandatory(rl, resolvedSpec, missingMandatory);
      const recheck = resolveSpecification(resolvedSpec);
      resolvedSpec = recheck.resolvedSpec;
      sources = recheck.sources;
    }

    console.log('\n' + formatSpecificationReview(resolvedSpec, sources));

    const validation = validateSpecificationForExecution(resolvedSpec, sources, entry.rawPrompt);
    if (validation.warnings.length > 0) {
      console.log('\n[WARNINGS DETECTED]');
      validation.warnings.forEach(w => console.warn(`  ! ${w}`));
    }

    if (!validation.canSubmit) {
      console.error(`\n[BLOCKER] Batch specification #${i + 1} cannot be submitted due to unresolved fields:`);
      validation.issues.forEach(iss => console.error(`  x ${iss}`));
      console.log('\n[CANCELED] Batch submission blocked.');
      return;
    }

    resolvedGroups.push({
      spec: resolvedSpec,
      count: entry.count,
    });
  }

  // Expand into batchItems
  const batchItems = [];
  for (const group of resolvedGroups) {
    for (let c = 0; c < group.count; c++) {
      batchItems.push(JSON.parse(JSON.stringify(group.spec)));
    }
  }

  const domesticCount = batchItems.filter(s => s.orderType !== 'international').length;
  const intlCount = batchItems.filter(s => s.orderType === 'international').length;
  const concurrency = selectedMode.concurrency;

  console.log(`\n[Batch Summary]`);
  console.log(`- Total Orders to create: ${batchItems.length} (${domesticCount} Domestic, ${intlCount} International)`);
  console.log(`- Execution Mode: ${selectedMode.label} (${config.maxRetries} max retries per order)`);
  console.log(`- Payment Simulation: YES (Pospay VA + Sandbox)`);
  console.log(`- Browser Mode: Headless (background)`);

  const isPaymentRequested = autoPay !== false;

  console.log(`\nLaunching batch execution for ${batchItems.length} orders (Browser Mode: Headless (background), Execution Mode: ${selectedMode.label})...`);
  const batchResult = await executeBatch(batchItems, {
    headless: true, // Batch executions must strictly run headlessly per requirements
    concurrency,
    autoPay: isPaymentRequested,
    maxRetries: config.maxRetries,
    sessionPath: config.sessionPath,
  });

  const isMixed = domesticCount > 0 && intlCount > 0;
  const orderTypeSummary = isMixed ? 'mixed' : (intlCount > 0 ? 'international' : 'domestic');

  const savedRecord = saveExecutionRecord({
    request: userPrompt || `Batch ${batchItems.length} orders`,
    menuOption: 'Multiple Orders + Payment',
    orderType: orderTypeSummary,
    batchCount: batchItems.length,
    executionMode: selectedMode.mode,
    concurrency: selectedMode.concurrency,
    autoPay: isPaymentRequested,
    summary: {
      total: batchResult.total,
      succeeded: batchResult.succeeded,
      failed: batchResult.failed,
      totalAmountPaid: batchResult.totalAmountPaid,
    },
    orders: batchResult.orders,
    specification: batchItems[0],
  });

  console.log('\n======================================================');
  console.log('                 BATCH EXECUTION REPORT               ');
  console.log('======================================================');
  console.log(`Mode: ${selectedMode.label}`);
  console.log(`Total: ${batchResult.total} | Succeeded: ${batchResult.succeeded} | Failed: ${batchResult.failed}`);
  console.log(`Total Amount Paid: ${formatRupiah(batchResult.totalAmountPaid)}`);
  console.log('------------------------------------------------------');
  batchResult.orders.forEach(o => {
    if (isPaymentRequested) {
      const isSuccess = o.orderStatus === 'SUCCESS' && o.vaNumber && o.sandboxPayment === 'SUCCESS' && o.overallStatus === 'SUCCESS';
      const statusText = isSuccess ? 'SUCCESS' : (o.orderId ? 'ORDER_CREATED_PAYMENT_PENDING' : 'FAILED');
      console.log(`[#${o.index}] ${o.label}: ${statusText} | Order: ${o.orderId || '-'} | Shipment: ${o.shipmentId || '-'} | VA: ${o.vaNumber || '-'} | Amount: ${formatRupiah(o.amount)} | Sandbox: ${o.sandboxPayment === 'SUCCESS' ? 'Payment Successful!' : (o.sandboxPayment || 'FAILED')}`);
      if (o.error) {
        console.log(`    Error: ${o.error}`);
      }
    } else {
      console.log(`[#${o.index}] ${o.label}: ${o.orderStatus === 'SUCCESS' ? 'SUCCESS' : 'FAILED'} | Order: ${o.orderId || '-'} | Shipment: ${o.shipmentId || '-'} | Status: ORDER_CREATED (Payment Not Requested)`);
      if (o.error) {
        console.log(`    Error: ${o.error}`);
      }
    }
  });
  console.log(`Saved Record ID: ${savedRecord.id}`);
  console.log('======================================================\n');
}

/**
 * Handle view previous history
 */
async function handleViewHistory(rl) {
  console.log('\n=== Recent Execution History (.execution-history/) ===');
  const records = listExecutionRecords(10);
  if (records.length === 0) {
    console.log('No previous execution records found.\n');
    return;
  }

  records.forEach((r, idx) => {
    console.log(`\n[${idx + 1}] ID: ${r.id} (${r.timestamp})`);
    console.log(`    Request:  "${r.request}"`);
    console.log(`    Mode:     ${r.menuOption} | Orders: ${r.summary.succeeded}/${r.summary.total} succeeded`);
    console.log(`    Total Rp: Rp${r.summary.totalAmountPaid}`);
    if (r.orders && r.orders.length > 0) {
      r.orders.forEach(o => {
        console.log(`    -> Order: ${o.orderId || 'N/A'} (VA: ${o.vaNumber || 'N/A'}, Status: ${o.status})`);
      });
    }
  });

  await promptQuestion(rl, '\nPress Enter to return to main menu...');
}

/**
 * Main interactive loop
 */
async function startOrderingBot(options = {}) {
  const config = loadConfig();
  const rl = options.rl || readline.createInterface({ input, output });

  console.log('\n==========================================================');
  console.log('            POSIND STANDALONE ORDERING BOT                ');
  console.log('  Specification-driven Logistics Automation for POSIND    ');
  console.log('==========================================================');

  // Select browser mode once per execution session
  if (options.headless !== undefined) {
    config.headless = Boolean(options.headless);
  } else {
    config.headless = await promptBrowserMode(rl);
  }

  const modeLabel = config.headless ? 'Headless (background)' : 'Headed (visible browser)';
  console.log(`\n[Browser Mode] Selected: ${modeLabel}`);
  console.log(`Environment: ${config.environment} | Browser Mode: ${modeLabel}`);

  let running = true;
  while (running) {
    console.log('\n--- MAIN MENU ---');
    console.log('1. Create Order and Simulate Payment');
    console.log('2. Create Multiple Orders and Simulate Payment');
    console.log('3. View Previous Execution Results');
    console.log('4. Manage VMS Service Catalog');
    console.log('5. Exit');

    const choice = await promptQuestion(rl, '\nSelect option [1-5]: ');

    switch (choice) {
      case '1':
        await handleSingleOrderFlow(rl, config, { autoPay: true });
        break;
      case '2':
        await handleBatchOrderFlow(rl, config, { autoPay: true });
        break;
      case '3':
        await handleViewHistory(rl);
        break;
      case '4':
        await handleVmsMenu(rl, { headless: config.headless });
        break;
      case '5':
      case 'exit':
      case 'q':
        console.log('\nExiting POSIND Ordering Bot. Goodbye!\n');
        running = false;
        break;
      default:
        console.log('Invalid selection. Please choose an option between 1 and 5.');
        break;
    }
  }

  rl.close();
}

module.exports = {
  startOrderingBot,
  handleSingleOrderFlow,
  handleBatchOrderFlow,
  handleViewHistory,
  validateSpecificationForExecution,
  promptQuestion,
  promptBrowserMode,
  promptBatchExecutionMode,
  promptSpecificationEdits,
  splitBatchPrompt,
};
