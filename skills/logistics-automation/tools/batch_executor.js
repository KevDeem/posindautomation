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

const DEFAULT_SESSION_PATH = path.resolve(__dirname, '../../../.sessions/staging-oms_kevin_d_imas_gmail_com_session.json');

/**
 * Normalize diverse batch inputs into a uniform array of specification items.
 */
function normalizeBatchInput(batchInput) {
  const items = [];

  if (Array.isArray(batchInput)) {
    for (let i = 0; i < batchInput.length; i++) {
      items.push({
        label: `Order #${i + 1}`,
        spec: batchInput[i],
      });
    }
    return items;
  }

  if (batchInput && Array.isArray(batchInput.specifications)) {
    for (let i = 0; i < batchInput.specifications.length; i++) {
      items.push({
        label: `Order #${i + 1}`,
        spec: batchInput.specifications[i],
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
          spec: group.spec || group.specification || {},
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
        spec: baseSpec,
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
  if (msg.includes('No applicable Service Catalog found') || msg.includes('no inquiry fallback') || msg.includes('Service Catalog selection could not be confirmed')) {
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
async function executeBatch(batchInput, options = {}) {
  const items = normalizeBatchInput(batchInput);
  const headless = options.headless === true;
  const autoPay = options.autoPay !== undefined ? options.autoPay : true;
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
  const sessionPath = options.sessionPath || DEFAULT_SESSION_PATH;

  console.log(`\n======================================================`);
  console.log(`[BatchExecutor] Starting batch of ${items.length} order(s) (Browser Mode: ${headless ? 'Headless (background)' : 'Headed (visible browser)'}, autoPay: ${autoPay}, maxRetries: ${maxRetries})`);
  console.log(`======================================================\n`);

  const results = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    totalAmountPaid: 0,
    orders: [],
  };

  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 100 });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 950 },
  });

  // Authenticate once at the beginning of the batch
  console.log('[BatchExecutor] Initializing single batch authentication session...');
  const authPage = await context.newPage();
  try {
    await performFreshLogin(authPage, context, {
      ...options,
      sessionPath,
    });
  } finally {
    await authPage.close().catch(() => {});
  }
  console.log('[BatchExecutor] Batch authentication session established.');

  let authExpiredMidBatch = false;

  try {
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      const orderLabel = item.label || `Order #${index + 1}`;
      console.log(`\n>>> [${index + 1}/${items.length}] Processing ${orderLabel}...`);

      let orderRecord = {
        label: orderLabel,
        index: index + 1,
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

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        orderRecord.attempts = attempt;
        if (attempt > 1) {
          console.warn(`[BatchExecutor] Retrying ${orderLabel} from start (Attempt ${attempt}/${maxRetries})...`);
        }

        try {
          const { result: createResult, page } = await executeOrder(item.spec, {
            headless,
            existingBrowser: browser,
            existingContext: context,
            skipLogin: true, // Reuse authenticated batch session
            transactionLabel: `${orderLabel} (Try ${attempt})`,
          });

          if (!createResult.success) {
            orderRecord.orderStatus = 'ORDER_FAILED';
            throw new Error(createResult.error || 'Order creation failed');
          }

          orderRecord.orderId = createResult.orderId;
          orderRecord.shipmentId = createResult.shipmentId;
          orderRecord.amount = createResult.amount || 0;
          orderRecord.serviceCatalog = createResult.serviceCatalog;
          orderRecord.orderStatus = 'SUCCESS';

          // Execute Payment if requested
          if (autoPay && orderRecord.orderId) {
            console.log(`[BatchExecutor] Proceeding to payment simulation for Order ${orderRecord.orderId}...`);
            const payResult = await executeOrderPayment(page, context, {
              orderId: orderRecord.orderId,
              shipmentId: orderRecord.shipmentId,
              amount: orderRecord.amount,
            }, {
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
              console.warn(`[BatchExecutor] Payment simulation did not verify SUCCESS for Order ${orderRecord.orderId}: ${payResult.paymentStatus}`);
            }
          } else {
            orderRecord.paymentStatus = 'ORDER_CREATED';
            orderRecord.success = true;
            orderRecord.overallStatus = 'SUCCESS';
            orderRecord.error = null;
          }

          await page.close().catch(() => {});
          break; // Order created, exit retry loop (never retry creation)

        } catch (err) {
          const classification = classifyFailure(err);
          console.error(`[BatchExecutor] ${orderLabel} attempt ${attempt} failed [${classification.type}]:`, err.message);
          orderRecord.error = `${classification.type}: ${err.message}`;

          if (classification.type === 'AUTH_EXPIRED') {
            console.error(`[BatchExecutor] Authentication expired mid-batch on ${orderLabel}. Aborting batch safely.`);
            authExpiredMidBatch = true;
            break;
          }

          if (!classification.retryable) {
            console.warn(`[BatchExecutor] Non-retryable condition: ${classification.reason} Stopping retries for ${orderLabel}.`);
            break;
          }

          if (attempt === maxRetries) {
            console.error(`[BatchExecutor] ${orderLabel} exhausted all ${maxRetries} attempts.`);
          }
        }
      }

      if (orderRecord.success) {
        results.succeeded++;
        if (autoPay && orderRecord.paymentStatus === 'PAYMENT_VERIFIED') {
          results.totalAmountPaid += (orderRecord.amount || 0);
        }
      } else {
        results.failed++;
      }

      results.orders.push(orderRecord);

      if (authExpiredMidBatch) {
        console.error(`[BatchExecutor] Stopped batch safely due to expired session on ${orderLabel}.`);
        break;
      }
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
  normalizeBatchInput,
  classifyFailure,
};
