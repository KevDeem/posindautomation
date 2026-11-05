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
  const headless = options.headless !== undefined ? options.headless : true;
  const autoPay = options.autoPay !== undefined ? options.autoPay : true;
  const maxRetries = options.maxRetries !== undefined ? options.maxRetries : 2;
  const sessionPath = options.sessionPath || DEFAULT_SESSION_PATH;

  console.log(`\n======================================================`);
  console.log(`[BatchExecutor] Starting batch of ${items.length} order(s) (headless: ${headless}, autoPay: ${autoPay}, maxRetries: ${maxRetries})`);
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
    storageState: sessionPath,
    viewport: { width: 1440, height: 950 },
  });

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
        vaNumber: null,
        sandboxPayment: null,
        omsStatus: null,
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
            transactionLabel: `${orderLabel} (Try ${attempt})`,
          });

          if (!createResult.success) {
            throw new Error(createResult.error || 'Order creation failed');
          }

          orderRecord.orderId = createResult.orderId;
          orderRecord.shipmentId = createResult.shipmentId;
          orderRecord.amount = createResult.amount || 0;
          orderRecord.serviceCatalog = createResult.serviceCatalog;

          // Execute Payment if requested
          if (autoPay && orderRecord.orderId) {
            console.log(`[BatchExecutor] Proceeding to payment for Order ${orderRecord.orderId}...`);
            const payResult = await executeOrderPayment(page, context, {
              orderId: orderRecord.orderId,
              shipmentId: orderRecord.shipmentId,
              amount: orderRecord.amount,
            });

            orderRecord.vaNumber = payResult.vaNumber;
            orderRecord.sandboxPayment = payResult.sandboxResult;
            orderRecord.omsStatus = payResult.omsPaymentStatus;

            if (payResult.amount && (!orderRecord.amount || orderRecord.amount === 0)) {
              orderRecord.amount = payResult.amount;
            }

            if (payResult.sandboxResult !== 'SUCCESS') {
              console.warn(`[BatchExecutor] Payment simulation did not return SUCCESS for Order ${orderRecord.orderId}`);
            }
          }

          orderRecord.success = true;
          orderRecord.error = null;
          await page.close().catch(() => {});
          break; // Succeeded, exit retry loop

        } catch (err) {
          console.error(`[BatchExecutor] ${orderLabel} attempt ${attempt} failed:`, err.message);
          orderRecord.error = err.message;
          if (attempt === maxRetries) {
            console.error(`[BatchExecutor] ${orderLabel} exhausted all ${maxRetries} attempts.`);
          }
        }
      }

      if (orderRecord.success) {
        results.succeeded++;
        results.totalAmountPaid += (orderRecord.amount || 0);
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
  normalizeBatchInput,
};
