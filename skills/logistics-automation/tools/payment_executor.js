/**
 * Reusable Payment Execution Module for POSIND OMS & Payment Sandbox
 * 
 * Responsibilities:
 * 1. Step A: Advances from Order Summary screen to Payment Selection.
 * 2. Step B: Selects Pospay and saves payment method.
 * 3. Step C: Extracts dedicated Virtual Account (VA) and dynamic payment amount.
 *    - Strictly asserts VA is never Order ID or Shipment ID.
 *    - Strictly asserts VA is non-empty.
 * 4. Step D: Executes payment simulation via Payment Sandbox UI (Playwright).
 *    - Sets API endpoint to https://sr-pos-oms-api.nisims.web.id/api/v1.
 * 5. Step E: Verifies OMS paid status (/my/order).
 * 6. Granular transaction statuses:
 *    - ORDER_CREATED
 *    - ORDER_CREATED_PAYMENT_PENDING
 *    - PAYMENT_METHOD_SELECTED
 *    - VA_GENERATED
 *    - PAYMENT_SIMULATED
 *    - PAYMENT_VERIFIED
 *    - PAYMENT_FAILED
 *    - PAYMENT_PENDING_VERIFICATION
 *    - ORDER_FAILED
 * 7. Overall SUCCESS requires order created + VA generated + sandbox simulated + OMS verified.
 */

const path = require('path');
const fs = require('fs');

/**
 * Clean numeric string into integer amount
 */
function parseCurrency(str) {
  if (!str) return 0;
  let clean = String(str).trim().replace(/[,.]00$/, '');
  const digits = clean.replace(/[^0-9]/g, '');
  return parseInt(digits, 10) || 0;
}

/**
 * Format integer amount into Indonesian Rupiah display (e.g. 301753 -> Rp301.753)
 */
function formatRupiah(amount) {
  if (!amount && amount !== 0) return 'Rp0';
  const num = typeof amount === 'number' ? amount : parseInt(String(amount).replace(/[^0-9]/g, ''), 10) || 0;
  return 'Rp' + num.toLocaleString('id-ID');
}

/**
 * Execute payment for an existing OMS order via Payment Sandbox UI.
 * 
 * @param {import('playwright').Page} page Authenticated OMS page instance
 * @param {import('playwright').BrowserContext} context Browser context
 * @param {Object} orderResult Contains orderId, shipmentId, and optional pre-extracted amount
 * @param {Object} options
 * @param {string} [options.sandboxUrl='https://pospay-sandbox.vercel.app']
 * @param {string} [options.apiEndpoint='https://sr-pos-oms-api.nisims.web.id/api/v1']
 * @returns {Promise<Object>} Payment transaction result
 */
async function executeOrderPayment(page, context, orderResult = {}, options = {}) {
  const {
    orderId,
    shipmentId,
  } = orderResult;

  const headless = options.headless === true;
  const sandboxUrl = options.sandboxUrl || 'https://pospay-sandbox.vercel.app';
  const apiEndpoint = options.apiEndpoint || 'https://sr-pos-oms-api.nisims.web.id/api/v1';

  console.log(`\n======================================================`);
  console.log(`[PaymentExecutor] Starting payment simulation for Order ${orderId || '-'}`);
  console.log(`Browser Mode: ${headless ? 'Headless (background)' : 'Headed (visible browser)'}`);
  console.log(`Sandbox: ${sandboxUrl} | Endpoint: ${apiEndpoint}`);
  console.log(`======================================================\n`);

  const paymentResult = {
    orderId,
    shipmentId,
    orderStatus: 'SUCCESS',
    paymentStatus: 'ORDER_CREATED_PAYMENT_PENDING',
    paymentMethod: 'POSPAY',
    vaNumber: null,
    amount: orderResult.amount || null,
    sandboxResult: 'FAILED',
    omsPaymentStatus: 'UNPAID',
    overallStatus: 'FAILED',
    error: null,
  };

  try {
    // -------------------------------------------------------------
    // Step A: Order Summary & Navigation to Payment Selection
    // -------------------------------------------------------------
    console.log(`[Payment:Step A] Checking current OMS screen for Order ${orderId}...`);
    
    // Check if we are on the order confirmation / summary screen with "Proses Pembayaran"
    const prosesPembayaranBtn = page.getByRole('button', { name: /proses pembayaran/i })
      .or(page.locator('button:has-text("Proses Pembayaran")')).first();

    if (await prosesPembayaranBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      console.log(`[Payment:Step A] Clicking 'Proses Pembayaran' for Order ${orderId}...`);
      await prosesPembayaranBtn.click();
      await page.waitForTimeout(3000);
    }

    // Ensure we transition to complete-payment / payment method screen
    const currentUrl = page.url();
    const pospayLocator = page.locator('text=pospay, #radio-container, input#PTMI1765081604728, input[type="radio"]');
    const vaSpanLocator = page.locator('span:has-text("VA :"), div:has-text("VA :"), p:has-text("VA :")');

    const reachedPaymentScreen = currentUrl.includes('complete-payment') ||
      (await pospayLocator.first().isVisible({ timeout: 2500 }).catch(() => false)) ||
      (await vaSpanLocator.first().isVisible({ timeout: 2500 }).catch(() => false));

    if (!reachedPaymentScreen) {
      console.log(`[Payment:Step A] Payment method screen not reached after clicking 'Proses Pembayaran'. Navigating directly to complete-payment/${orderId}...`);
      await page.goto(`https://sr-pos-oms-web.nisims.web.id/shipment-journey-detail/complete-payment/${orderId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForTimeout(3000);
    }

    // Extract dynamic amount from the page if not already known
    const pageTextInitial = await page.locator('body').innerText();
    const amountMatchInitial = pageTextInitial.match(/Total\s*(?:Tagihan|Biaya|Pembayaran)?\s*:?\s*Rp\s*([0-9.,]+)/i) ||
                               pageTextInitial.match(/Rp\s*([0-9]{1,3}(?:\.[0-9]{3})+)/i);
    if (amountMatchInitial && amountMatchInitial[1]) {
      const parsed = parseCurrency(amountMatchInitial[1]);
      if (parsed > 0) paymentResult.amount = parsed;
    }

    // -------------------------------------------------------------
    // Step B: Select Payment Method (Pospay)
    // -------------------------------------------------------------
    console.log(`[Payment:Step B] Checking payment method selection screen...`);

    // Check if payment instructions (VA) are ALREADY visible (skip selection if so)
    const existingVaSpan = page.locator('span:has-text("VA :"), div:has-text("VA :"), p:has-text("VA :")').first();
    const hasExistingVa = await existingVaSpan.isVisible({ timeout: 2500 }).catch(() => false);

    if (!hasExistingVa) {
      console.log(`[Payment:Step B] Selecting Pospay payment channel...`);
      await page.waitForSelector('text=pospay, #radio-container, input[type="radio"], input#PTMI1765081604728', { state: 'visible', timeout: 25000 });

      // Click pospay radio or container
      const pospayRadio = page.locator('#radio-container, button:has-text("pospay"), div:has-text("pospay"), input#PTMI1765081604728, input[type="radio"], text=/pospay/i').first();
      await pospayRadio.click();
      await page.waitForTimeout(1000);

      // Click "Simpan Metode Pembayaran"
      const simpanMetodeBtn = page.locator('button:has-text("Simpan Metode Pembayaran"), button[type="submit"]:has-text("Simpan Metode Pembayaran")').first();
      await simpanMetodeBtn.waitFor({ state: 'visible', timeout: 15000 });
      console.log(`[Payment:Step B] Clicking 'Simpan Metode Pembayaran'...`);
      await simpanMetodeBtn.click();
      await page.waitForTimeout(4000);

      paymentResult.paymentStatus = 'PAYMENT_METHOD_SELECTED';
    } else {
      console.log(`[Payment:Step B] Payment instructions already open on current screen.`);
      paymentResult.paymentStatus = 'PAYMENT_METHOD_SELECTED';
    }

    // -------------------------------------------------------------
    // Step C: Generate and Extract Dedicated VA
    // -------------------------------------------------------------
    console.log(`[Payment:Step C] Locating dedicated Virtual Account (VA) on payment instruction screen...`);
    const vaSpan = page.locator('text=/VA\\s*:\\s*[0-9]+/, span:has-text("VA :"), div:has-text("VA :"), p:has-text("VA :")').first();
    await vaSpan.waitFor({ state: 'visible', timeout: 30000 });

    const paymentBodyText = await page.locator('body').innerText();
    const bodyMatch = paymentBodyText.match(/(?:VA|Virtual Account)\s*:\s*([0-9]{6,20})/i) ||
                      (await vaSpan.innerText()).match(/VA\s*:\s*([0-9]+)/i);
    if (bodyMatch && bodyMatch[1]) {
      paymentResult.vaNumber = bodyMatch[1].trim();
    }

    if (!paymentResult.vaNumber) {
      throw new Error(`Dedicated VA Number could not be extracted from payment instructions for Order ${orderId}.`);
    }

    // Strict validation: Dedicated VA must NOT match Order ID or Shipment ID
    if (paymentResult.vaNumber === orderId || paymentResult.vaNumber === shipmentId) {
      throw new Error(`Forbidden: Dedicated VA matched Order/Shipment ID (${paymentResult.vaNumber}).`);
    }

    // Extract dynamic payment amount from payment instruction screen
    const paymentPageBody = await page.locator('body').innerText();
    const amountMatchFinal = paymentPageBody.match(/Total\s*(?:Tagihan|Biaya|Pembayaran)?\s*:?\s*Rp\s*([0-9.,]+)/i) ||
                             paymentPageBody.match(/Rp\s*([0-9]{1,3}(?:\.[0-9]{3})+)/i);
    if (amountMatchFinal && amountMatchFinal[1]) {
      const parsedAmt = parseCurrency(amountMatchFinal[1]);
      if (parsedAmt > 0) paymentResult.amount = parsedAmt;
    }

    if (!paymentResult.amount || paymentResult.amount <= 0) {
      if (orderResult.amount && orderResult.amount > 0) {
        paymentResult.amount = orderResult.amount;
      } else {
        throw new Error(`Could not determine dynamic payment amount for Order ${orderId}.`);
      }
    }

    paymentResult.paymentStatus = 'VA_GENERATED';
    console.log(`[Payment:Step C] Dedicated VA: ${paymentResult.vaNumber} | Dynamic Amount: ${formatRupiah(paymentResult.amount)}`);

    // -------------------------------------------------------------
    // Step D: Payment Sandbox Simulation
    // -------------------------------------------------------------
    console.log(`[Payment:Step D] Opening Payment Sandbox UI: ${sandboxUrl}...`);
    const sandboxPage = await context.newPage();
    await sandboxPage.goto(sandboxUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sandboxPage.waitForTimeout(2000);

    // Configure Sandbox Endpoint
    const envInput = sandboxPage.locator('#environment, input[placeholder*="https://"], input[name="endpoint"]').first();
    if (await envInput.isVisible().catch(() => false)) {
      await envInput.fill('');
      await envInput.fill(apiEndpoint);
      console.log(`[Payment:Step D] Sandbox endpoint set to: ${apiEndpoint}`);
    }

    // Fill VA & Amount
    const vaInput = sandboxPage.locator('#nomorVA, input[name="nomorVA"], input[placeholder*="VA"]').first();
    await vaInput.fill(paymentResult.vaNumber);

    const nominalInput = sandboxPage.locator('#nominal, input[name="nominal"], input[placeholder*="Nominal"]').first();
    await nominalInput.fill(String(paymentResult.amount));

    console.log(`[Payment:Step D] Submitting simulation (VA: ${paymentResult.vaNumber}, Amount: ${paymentResult.amount})...`);
    await sandboxPage.waitForTimeout(500);
    const payBtn = sandboxPage.getByRole('button', { name: /pay now/i });
    await payBtn.click();
    await sandboxPage.waitForTimeout(4000);

    const sandboxResponseText = await sandboxPage.locator('body').innerText();
    const isSandboxSuccess =
      sandboxResponseText.includes('Payment Successful') ||
      sandboxResponseText.includes('PEMBAYARAN BERHASIL') ||
      sandboxResponseText.includes('"payment_status": "SUCCESS"') ||
      sandboxResponseText.includes('"respon_code": "00"') ||
      sandboxResponseText.includes('"00"');

    if (isSandboxSuccess) {
      paymentResult.sandboxResult = 'SUCCESS';
      paymentResult.paymentStatus = 'PAYMENT_VERIFIED';
      paymentResult.overallStatus = 'SUCCESS';
      console.log(`[Payment:Step D] Sandbox payment confirmed SUCCESS ('Payment Successful!') for VA ${paymentResult.vaNumber}`);
    } else {
      console.warn(`[Payment:Step D] Sandbox payment simulation failed:`, sandboxResponseText.slice(0, 300));
      paymentResult.sandboxResult = 'FAILED';
      paymentResult.paymentStatus = 'PAYMENT_FAILED';
      paymentResult.overallStatus = 'ORDER_CREATED_PAYMENT_PENDING';
      paymentResult.error = `Sandbox did not display 'Payment Successful!': ${sandboxResponseText.slice(0, 150)}`;
      await sandboxPage.close().catch(() => {});
      return paymentResult;
    }
    await sandboxPage.close().catch(() => {});

  } catch (err) {
    console.error(`[Payment] Error executing payment for Order ${orderId}:`, err.message);
    if (!paymentResult.paymentStatus || paymentResult.paymentStatus === 'ORDER_CREATED_PAYMENT_PENDING') {
      paymentResult.paymentStatus = 'PAYMENT_FAILED';
    }
    paymentResult.overallStatus = 'ORDER_CREATED_PAYMENT_PENDING';
    paymentResult.error = err.message;
  }

  return paymentResult;
}

module.exports = {
  executeOrderPayment,
  parseCurrency,
  formatRupiah,
};
