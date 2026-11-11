/**
 * Generic Batch Order Executor for POSIND Logistics Automation
 * 
 * Responsibilities:
 * 1. Interface: `executeBatch(batchInput, options)`
 * 2. Accepts:
 *    - Array of specifications: `[{ pickup: {...}, dropoff: {...} }, ...]`
 *    - Single specification with quantity N: `{ specification: {...}, count: 5 }`
 *    - Multi-group specifications: `{ groups: [{ spec: {...}, count: 5 }, { spec: {...}, count: 6 }] }`
 * 3. Resolves each specification independently via the specification engine.
 * 4. Invokes the general `executeOrder` interface sequentially for every transaction.
 * 5. Optionally invokes `executeOrderPayment` for each successfully created order.
 * 6. Includes retry logic: configurable `maxRetries` per order (default 2, retries from start).
 * 7. Tracks independent transaction results, errors, amounts, and VAs.
 * 8. Never hardcodes or embeds any specific batch details into source code.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { executeOrder } = require('./order_executor');
const { executeOrderPayment } = require('./payment_executor');
const { resolveSpecification, formatSpecificationReview } = require('./order_specification');
const { performFreshLogin } = require('./auth_manager');
const {
  resolveOmsEnvironment,
  OMS_ENVIRONMENTS,
} = require('../config/oms_environments');

const DEFAULT_SESSION_PATH = path.resolve(__dirname, '../../../.sessions/staging-oms_kevin_d_imas_gmail_com_session.json');

/**
 * Helper to prepare batch item spec, ensuring non-user-supplied PICs
 * are cleared so each batch item gets a fresh randomized library selection.
 */
function prepareBatchSpec(rawSpec) {
  const spec = JSON.parse(JSON.stringify(rawSpec || {}));
  if (spec._sources) {
    if (spec.pickup && spec._sources.pickup?.pic?.name && spec._sources.pickup.pic.name !== 'provided') {
      delete spec.pickup.pic;
    }
    if (spec.dropoff && spec._sources.dropoff?.pic?.name && spec._sources.dropoff.pic.name !== 'provided') {
      delete spec.dropoff.pic;
    }
    if (spec.cargo && spec._sources.cargo?.itemName && spec._sources.cargo.itemName !== 'provided') {
      delete spec.cargo.itemName;
    }
    if (spec.cargo && spec._sources.cargo?.weightKg && spec._sources.cargo.weightKg !== 'provided') {
      delete spec.cargo.weightKg;
    }
    delete spec._sources;
  }
  return spec;
}

/**
 * Normalize diverse batch inputs into a uniform array of specification items.
 */
function normalizeBatchInput(batchInput) {
  const items = [];

  if (Array.isArray(batchInput)) {
    for (let i = 0; i < batchInput.length; i++) {
      items.push({
        label: `Order #${i + 1}`,
        spec: prepareBatchSpec(batchInput[i]),
      });
    }
    return items;
  }

  if (batchInput && Array.isArray(batchInput.specifications)) {
    for (let i = 0; i < batchInput.specifications.length; i++) {
      items.push({
        label: `Order #${i + 1}`,
        spec: prepareBatchSpec(batchInput.specifications[i]),
      });
    }
    return items;
  }

  if (batchInput && Array.isArray(batchInput.groups)) {
    let orderNum = 1;
    for (const group of batchInput.groups) {
      const count = group.count || 1;
      const groupName = group.name || `Group`;
      for (let i = 0; i < count; i++) {
        items.push({
          label: `${groupName} #${i + 1} (Total #${orderNum++})`,
          spec: prepareBatchSpec(group.spec || group.specification || {}),
        });
      }
    }
    return items;
  }

  if (batchInput && (batchInput.specification || batchInput.spec)) {
    const baseSpec = batchInput.specification || batchInput.spec;
    const count = batchInput.count || batchInput.quantity || 1;
    for (let i = 0; i < count; i++) {
      items.push({
        label: `Order #${i + 1} of ${count}`,
        spec: prepareBatchSpec(baseSpec),
      });
    }
    return items;
  }

  throw new Error('Invalid batchInput format. Expected an array of specifications or an object with specifications / groups.');
}

/**
 * Classify failure to determine if retry is safe and appropriate.
 */
function classifyFailure(err) {
  const msg = err && err.message ? err.message : String(err);

  // 0. Authentication failure or session expiry mid-batch
  if (msg.includes('Authentication expired') || msg.includes('session lost') || msg.includes('[Authentication]')) {
    return {
      type: 'AUTH_EXPIRED',
      retryable: false,
      reason: 'Authentication session expired or failed mid-batch. Halting batch safely.',
    };
  }

  // 1. Deterministic catalog failure: no service catalog exists for route
  if (msg.includes('No applicable Service Catalog') || msg.includes('no inquiry fallback') || msg.includes('Service Catalog selection could not be confirmed') || msg.includes('No selectable Service Catalog')) {
    return {
      type: 'CATALOG_NOT_FOUND',
      retryable: false,
      reason: 'No applicable Non-Contract Service Catalog found for route. Deterministic policy stop; retries aborted.',
    };
  }

  // 2. Uncertain submission: order was submitted or final button clicked
  if (msg.includes('Order ID could not be identified after final submission') || msg.includes('Submitting Final Order') || msg.includes('konfirmasi|buat pesanan')) {
    return {
      type: 'UNCERTAIN_SUBMISSION',
      retryable: false,
      reason: 'Order submission was initiated and may have succeeded in OMS. Retrying is aborted to prevent duplicate transactions.',
    };
  }

  // 3. Payment failures: do not retry order creation if order already placed
  if (msg.includes('Payment') || msg.includes('Sandbox') || msg.includes('sandbox') || msg.includes('payment') || msg.includes('VA Number')) {
    return {
      type: 'PAYMENT_FAILURE',
      retryable: false,
      reason: 'Payment simulation or verification failed; order creation already succeeded. Retrying order creation is forbidden.',
    };
  }

  // 4. Autocomplete / Location resolution failure
  if (msg.includes('Autocomplete search') || msg.includes('No option matching') || msg.includes('No selectable options')) {
    return {
      type: 'AUTOCOMPLETE_FAILURE',
      retryable: false,
      reason: 'Location lookup failed on form autocomplete. Halting order.',
    };
  }

  // 4. Pre-submission UI / transient network / date picker failures
  if (msg.includes('Pickup date selector') || msg.includes('Navigation') || msg.includes('Timeout') || msg.includes('net::')) {
    return {
      type: 'TRANSIENT_UI_FAILURE',
      retryable: true,
      reason: 'Transient UI initialization or network lag before submission.',
    };
  }

  return {
    type: 'GENERAL_ERROR',
    retryable: true,
    reason: 'Unclassified error before submission.',
  };
}

/**
 * Execute a batch of orders sequentially.
 * 
 * @param {Array|Object} batchInput Specifications or groups to execute
 * @param {Object} options Batch execution options
 * @param {boolean} [options.headless=true] Run browser headlessly
 * @param {boolean} [options.autoPay=true] Execute payment simulation after order creation
 * @param {number} [options.maxRetries=2] Max attempts per order if failure occurs
 * @param {string} [options.sessionPath] Path to storageState JSON
 * @returns {Promise<Object>} Batch summary and item results
 */
/**
 * Execute a single batch order item through its full lifecycle:
 * Order Form -> Service Catalog -> PIC & File -> Submission -> Payment Selection -> VA -> Sandbox -> Verification.
 * Each invocation operates inside its own isolated Playwright browser context with an independent fresh login.
 *
 * @param {Object} item Normalized batch item
 * @param {number} index Index in the batch (0-based)
 * @param {number} totalItems Total number of items in the batch
 * @param {import('playwright').Browser} browser Shared browser instance (workers create isolated contexts)
 * @param {Object} options Options passed to batch executor
 * @returns {Promise<Object>} Completed order record
 */
async function executeBatchWorkerItem(item, index, totalItems, browser, options = {}) {
  const headless = options.headless === true;
  const autoPay = options.autoPay !== undefined ? options.autoPay : true;
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
  const orderLabel = item.label || `Order #${index + 1}`;

  console.log(`\n>>> [Worker: ${index + 1}/${totalItems}] Starting ${orderLabel}...`);

  let orderRecord = {
    label: orderLabel,
    index: index + 1,
    environment: options.environment || 'Smart Routing',
    environmentUrl: options.omsUrl || '',
    success: false,
    attempts: 0,
    orderId: null,
    shipmentId: null,
    amount: 0,
    serviceCatalog: null,
    orderStatus: 'FAILED',
    paymentStatus: autoPay ? 'ORDER_CREATED_PAYMENT_PENDING' : 'ORDER_CREATED',
    paymentMethod: autoPay ? 'POSPAY' : null,
    vaNumber: null,
    sandboxPayment: null,
    omsStatus: null,
    overallStatus: 'FAILED',
    error: null,
  };

  // Deep clone and resolve specification once for this batch item to lock generated values
  const specClone = JSON.parse(JSON.stringify(item.spec || {}));
  const resolvedItem = resolveSpecification(specClone);
  const resolvedSpec = resolvedItem.resolvedSpec;

  let orderSubmitted = false;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    orderRecord.attempts = attempt;
    if (attempt > 1) {
      console.warn(`[Worker ${index + 1}] Retrying ${orderLabel} from start (Attempt ${attempt}/${maxRetries})...`);
    }

    // Allocate an isolated context for this worker execution attempt
    let context = null;
    let page = null;

    try {
      context = await browser.newContext({
        viewport: { width: 1440, height: 950 },
      });

      page = await context.newPage();

      // Independent fresh login for this worker context (no shared session or cookies)
      console.log(`[Worker ${index + 1}] Authenticating worker context for ${orderLabel}...`);
      await performFreshLogin(page, context, {
        ...options,
        sessionPath: null, // Do not write to shared sessionPath to prevent race conditions
      });
      console.log(`[Worker ${index + 1}] Worker authenticated successfully.`);

      // Execute order creation
      const { result: createResult } = await executeOrder(resolvedSpec, {
        ...options,
        headless,
        existingBrowser: browser,
        existingContext: context,
        existingPage: page,
        skipLogin: true, // Already logged in with fresh authentication in this context
        transactionLabel: `${orderLabel} (Worker ${index + 1}, Try ${attempt})`,
      });

      if (!createResult.success) {
        orderRecord.orderStatus = 'ORDER_FAILED';
        if (createResult.diagnostic) {
          orderRecord.diagnostic = createResult.diagnostic;
        }
        const err = new Error(createResult.error || 'Order creation failed');
        if (createResult.diagnostic) err.diagnostic = createResult.diagnostic;
        throw err;
      }

      // If an order ID was returned, order submission has definitively succeeded
      if (createResult.orderId) {
        orderSubmitted = true;
      }

      orderRecord.orderId = createResult.orderId;
      orderRecord.shipmentId = createResult.shipmentId;
      orderRecord.amount = createResult.amount || 0;
      orderRecord.serviceCatalog = createResult.serviceCatalog;
      orderRecord.orderStatus = 'SUCCESS';

      // Execute Payment if requested
      if (autoPay && orderRecord.orderId) {
        console.log(`[Worker ${index + 1}] Proceeding to payment simulation for Order ${orderRecord.orderId}...`);
        const payResult = await executeOrderPayment(page, context, {
          orderId: orderRecord.orderId,
          shipmentId: orderRecord.shipmentId,
          amount: orderRecord.amount,
        }, {
          ...options,
          headless,
          sandboxUrl: options.sandboxUrl,
          apiEndpoint: options.apiEndpoint,
        });

        orderRecord.vaNumber = payResult.vaNumber;
        orderRecord.sandboxPayment = payResult.sandboxResult;
        orderRecord.omsStatus = payResult.omsPaymentStatus;
        orderRecord.paymentStatus = payResult.paymentStatus;
        orderRecord.paymentMethod = payResult.paymentMethod || 'POSPAY';

        if (payResult.amount && (!orderRecord.amount || orderRecord.amount === 0)) {
          orderRecord.amount = payResult.amount;
        }

        if (payResult.paymentStatus === 'PAYMENT_VERIFIED' && payResult.overallStatus === 'SUCCESS') {
          orderRecord.success = true;
          orderRecord.overallStatus = 'SUCCESS';
          orderRecord.error = null;
        } else {
          orderRecord.success = false;
          orderRecord.overallStatus = 'ORDER_CREATED_PAYMENT_PENDING';
          orderRecord.error = payResult.error || `Payment incomplete: ${payResult.paymentStatus}`;
          console.warn(`[Worker ${index + 1}] Payment simulation did not verify SUCCESS for Order ${orderRecord.orderId}: ${payResult.paymentStatus}`);
        }
      } else {
        orderRecord.paymentStatus = 'ORDER_CREATED';
        orderRecord.success = true;
        orderRecord.overallStatus = 'SUCCESS';
        orderRecord.error = null;
      }

      // Order completed successfully; exit retry loop
      break;

    } catch (err) {
      if (err.diagnostic && !orderRecord.diagnostic) {
        orderRecord.diagnostic = err.diagnostic;
      }
      const classification = classifyFailure(err);
      console.error(`[Worker ${index + 1}] ${orderLabel} attempt ${attempt} failed [${classification.type}]:`, err.message);
      orderRecord.error = `${classification.type}: ${err.message}`;

      // Prevent accidental duplicate order submissions
      if (orderSubmitted || !classification.retryable) {
        console.warn(`[Worker ${index + 1}] Non-retryable condition (${orderSubmitted ? 'Order already submitted' : classification.reason}). Halting retries for ${orderLabel}.`);
        break;
      }

      if (attempt === maxRetries) {
        console.error(`[Worker ${index + 1}] ${orderLabel} exhausted all ${maxRetries} attempts.`);
      }
    } finally {
      // Clean up isolated context and page for this worker attempt
      if (page) await page.close().catch(() => {});
      if (context) await context.close().catch(() => {});
    }
  }

  return orderRecord;
}

/**
 * Execute a pool of tasks with configurable concurrency.
 *
 * @param {Array<Function>} taskRunners Array of factory functions returning promises
 * @param {number} concurrency Maximum concurrent workers
 * @returns {Promise<Array>} Results in original order
 */
async function runWithConcurrency(taskRunners, concurrency = 3) {
  const results = new Array(taskRunners.length);
  const workerCount = Math.max(1, Math.min(concurrency, taskRunners.length));
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < taskRunners.length) {
      const currentIndex = nextIndex++;
      try {
        results[currentIndex] = await taskRunners[currentIndex]();
      } catch (fatalErr) {
        console.error(`[ConcurrentRunner] Unexpected worker error at index ${currentIndex}:`, fatalErr);
        results[currentIndex] = {
          index: currentIndex + 1,
          success: false,
          error: `WORKER_FATAL: ${fatalErr.message}`,
          overallStatus: 'FAILED',
        };
      }
    }
  }

  const workers = [];
  for (let w = 0; w < workerCount; w++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

/**
 * Execute a batch of orders with configurable concurrency (default: 3 workers).
 * Each worker operates with an isolated Playwright browser context and fresh login.
 *
 * @param {Array|Object} batchInput Specifications or groups to execute
 * @param {Object} options Batch execution options
 * @param {boolean} [options.headless=true] Run browser headlessly
 * @param {number} [options.concurrency=3] Concurrent workers (1 = sequential)
 * @param {boolean} [options.autoPay=true] Execute payment simulation after order creation
 * @param {number} [options.maxRetries=2] Max attempts per order if failure occurs
 * @returns {Promise<Object>} Batch summary and item results
 */
async function executeBatch(batchInput, options = {}) {
  const items = normalizeBatchInput(batchInput);

  let resolvedEnv = null;
  if (options.environment) {
    resolvedEnv = resolveOmsEnvironment(options.environment);
    if (!resolvedEnv) {
      throw new Error(`[BatchExecutor] Invalid OMS environment: "${options.environment}". Valid environments are: Smart Routing, Staging.`);
    }
  } else if (options.omsUrl) {
    resolvedEnv = resolveOmsEnvironment(options.omsUrl);
  }

  const defaultBaseUrl = OMS_ENVIRONMENTS['Smart Routing']?.baseUrl || 'https://sr-pos-oms-web.nisims.web.id';
  const defaultApiEndpoint = OMS_ENVIRONMENTS['Smart Routing']?.apiEndpoint || 'https://sr-pos-oms-api.nisims.web.id/api/v1';

  const omsUrl = (options.omsUrl || (resolvedEnv ? resolvedEnv.baseUrl : defaultBaseUrl)).replace(/\/+$/, '');
  const apiEndpoint = options.apiEndpoint || (resolvedEnv ? resolvedEnv.apiEndpoint : defaultApiEndpoint);
  const envName = resolvedEnv ? resolvedEnv.name : (options.environment || 'Smart Routing');

  const headless = options.headless !== false; // Keep all workers headless by default
  const autoPay = options.autoPay !== undefined ? options.autoPay : true;
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
  const rawConcurrency = options.concurrency !== undefined
    ? parseInt(options.concurrency, 10)
    : (process.env.BATCH_CONCURRENCY !== undefined ? parseInt(process.env.BATCH_CONCURRENCY, 10) : 3);
  const concurrency = (!Number.isNaN(rawConcurrency) && rawConcurrency > 0) ? rawConcurrency : 3;

  console.log(`\n======================================================`);
  console.log(`[BatchExecutor] Starting batch of ${items.length} order(s)`);
  console.log(`- Environment: ${envName} (${omsUrl})`);
  console.log(`- Browser Mode: ${headless ? 'Headless (background)' : 'Headed (visible browser)'}`);
  console.log(`- Concurrency: ${concurrency} worker(s) (${concurrency > 1 ? 'Concurrent' : 'Sequential'})`);
  console.log(`- Payment Simulation: ${autoPay ? 'YES' : 'NO'}`);
  console.log(`- Max Retries: ${maxRetries}`);
  console.log(`======================================================\n`);

  const results = {
    total: items.length,
    concurrency,
    environment: envName,
    environmentUrl: omsUrl,
    succeeded: 0,
    failed: 0,
    totalAmountPaid: 0,
    orders: [],
  };

  if (items.length === 0) {
    return results;
  }

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 100 });

  try {
    const taskRunners = items.map((item, index) => {
      return () => executeBatchWorkerItem(item, index, items.length, browser, {
        ...options,
        environment: envName,
        omsUrl,
        apiEndpoint,
        headless,
        autoPay,
        maxRetries,
      });
    });

    const completedOrders = await runWithConcurrency(taskRunners, concurrency);

    for (const orderRecord of completedOrders) {
      if (orderRecord.success) {
        results.succeeded++;
        if (autoPay && orderRecord.paymentStatus === 'PAYMENT_VERIFIED') {
          results.totalAmountPaid += (orderRecord.amount || 0);
        }
      } else {
        results.failed++;
      }
      results.orders.push(orderRecord);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`\n======================================================`);
  console.log(`[BatchExecutor] Completed. Succeeded: ${results.succeeded}/${results.total}, Failed: ${results.failed}`);
  console.log(`[BatchExecutor] Total Amount Paid: Rp${results.totalAmountPaid}`);
  console.log(`======================================================\n`);

  return results;
}

module.exports = {
  executeBatch,
  executeBatchWorkerItem,
  runWithConcurrency,
  normalizeBatchInput,
  classifyFailure,
};
