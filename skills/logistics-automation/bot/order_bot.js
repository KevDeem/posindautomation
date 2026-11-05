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
  if (newPickupCity) spec.pickup.city = newPickupCity;

  const newDropoffCity = await promptQuestion(rl, `Dropoff City [${spec.dropoff.city}]: `);
  if (newDropoffCity) spec.dropoff.city = newDropoffCity;

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
async function handleSingleOrderFlow(rl, config, { defaultType = 'domestic', autoPay = false } = {}) {
  console.log(`\n=== Create ${defaultType === 'international' ? 'International' : 'Domestic'} Order ===`);
  console.log('You can type your order in natural language, or press Enter to use default baseline.');
  console.log('Example: "Pickup in Tebet Jakarta Selatan to Gubeng Surabaya on 1 Dec 2026 at 08:00"');

  const userPrompt = await promptQuestion(rl, '\nOrder description: ');
  const parsed = parseOrderPrompt(userPrompt);
  if (!parsed.spec.orderType) parsed.spec.orderType = defaultType;

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

  // Check if payment was requested either via menu option or natural language
  const isPaymentRequested = autoPay || parsed.autoPay === true;

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
    menuOption: isPaymentRequested ? 'Single Order + Payment' : 'Single Order',
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
 * Handle batch orders flow
 */
async function handleBatchOrderFlow(rl, config, { autoPay = false } = {}) {
  console.log('\n=== Create Multiple Orders (Batch Execution) ===');
  console.log('You can specify count and route in natural language, or enter quantity.');
  console.log('Example: "Create 5 domestic orders from Tebet to Gubeng at 08:00 on 1 Dec 2026"');

  const userPrompt = await promptQuestion(rl, '\nBatch description: ');
  const parsed = parseOrderPrompt(userPrompt);
  const isPaymentRequested = autoPay || parsed.autoPay === true;

  let count = parsed.count || 1;
  if (count <= 1) {
    const countAns = await promptQuestion(rl, 'How many identical orders to create in this batch? (default: 5): ');
    count = parseInt(countAns, 10) || 5;
  }

  // Resolve specification
  const { resolvedSpec, sources, missingMandatory } = resolveSpecification(parsed.spec);
  if (missingMandatory && missingMandatory.length > 0) {
    console.log(`\nMissing required fields: ${missingMandatory.join(', ')}`);
    await resolveMissingMandatory(rl, resolvedSpec, missingMandatory);
  }

  console.log('\n' + formatSpecificationReview(resolvedSpec, sources));
  const modeLabel = config.headless ? 'Headless (background)' : 'Headed (visible browser)';
  console.log(`\n[Batch Summary]`);
  console.log(`- Total Orders to create: ${count}`);
  console.log(`- Execution Mode: Sequential (${config.maxRetries} max retries per order)`);
  console.log(`- Payment Simulation: ${isPaymentRequested ? 'YES (Pospay VA + Sandbox)' : 'NO'}`);
  console.log(`- Browser Mode: ${modeLabel}`);

  // Pre-execution validation
  const validation = validateSpecificationForExecution(resolvedSpec, sources, userPrompt);
  if (validation.warnings.length > 0) {
    console.log('\n[WARNINGS DETECTED]');
    validation.warnings.forEach(w => console.warn(`  ! ${w}`));
  }

  if (!validation.canSubmit) {
    console.error('\n[BLOCKER] Batch orders cannot be submitted due to unresolved fields:');
    validation.issues.forEach(iss => console.error(`  x ${iss}`));
    console.log('\n[CANCELED] Batch submission blocked.');
    return;
  }

  console.log(`\nLaunching batch execution for ${count} orders (Browser Mode: ${modeLabel})...`);
  const batchResult = await executeBatch({ specification: resolvedSpec, count }, {
    headless: config.headless,
    autoPay: isPaymentRequested,
    maxRetries: config.maxRetries,
    sessionPath: config.sessionPath,
  });

  const savedRecord = saveExecutionRecord({
    request: userPrompt || `Batch ${count} orders`,
    menuOption: isPaymentRequested ? 'Multiple Orders + Payment' : 'Multiple Orders',
    orderType: resolvedSpec.orderType,
    batchCount: count,
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

  console.log('\n======================================================');
  console.log('                 BATCH EXECUTION REPORT               ');
  console.log('======================================================');
  console.log(`Total: ${batchResult.total} | Succeeded: ${batchResult.succeeded} | Failed: ${batchResult.failed}`);
  console.log(`Total Amount Paid: ${formatRupiah(batchResult.totalAmountPaid)}`);
  console.log('------------------------------------------------------');
  batchResult.orders.forEach(o => {
    if (isPaymentRequested) {
      const isSuccess = o.orderStatus === 'SUCCESS' && o.vaNumber && o.sandboxPayment === 'SUCCESS' && o.overallStatus === 'SUCCESS';
      const statusText = isSuccess ? 'SUCCESS' : (o.orderId ? 'ORDER_CREATED_PAYMENT_PENDING' : 'FAILED');
      console.log(`[#${o.index}] ${o.label}: ${statusText} | Order: ${o.orderId || '-'} | Shipment: ${o.shipmentId || '-'} | VA: ${o.vaNumber || '-'} | Amount: ${formatRupiah(o.amount)} | Sandbox: ${o.sandboxPayment === 'SUCCESS' ? 'Payment Successful!' : (o.sandboxPayment || 'FAILED')}`);
    } else {
      console.log(`[#${o.index}] ${o.label}: ${o.orderStatus === 'SUCCESS' ? 'SUCCESS' : 'FAILED'} | Order: ${o.orderId || '-'} | Shipment: ${o.shipmentId || '-'} | Status: ORDER_CREATED (Payment Not Requested)`);
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
    console.log('1. Create Domestic Order');
    console.log('2. Create International Order');
    console.log('3. Create Multiple Orders (Batch)');
    console.log('4. Create Order and Simulate Payment');
    console.log('5. Create Multiple Orders and Simulate Payment');
    console.log('6. View Previous Execution Results');
    console.log('7. Exit');

    const choice = await promptQuestion(rl, '\nSelect option [1-7]: ');

    switch (choice) {
      case '1':
        await handleSingleOrderFlow(rl, config, { defaultType: 'domestic', autoPay: false });
        break;
      case '2':
        await handleSingleOrderFlow(rl, config, { defaultType: 'international', autoPay: false });
        break;
      case '3':
        await handleBatchOrderFlow(rl, config, { autoPay: false });
        break;
      case '4':
        await handleSingleOrderFlow(rl, config, { defaultType: 'domestic', autoPay: true });
        break;
      case '5':
        await handleBatchOrderFlow(rl, config, { autoPay: true });
        break;
      case '6':
        await handleViewHistory(rl);
        break;
      case '7':
      case 'exit':
      case 'q':
        console.log('\nExiting POSIND Ordering Bot. Goodbye!\n');
        running = false;
        break;
      default:
        console.log('Invalid selection. Please choose an option between 1 and 7.');
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
};
