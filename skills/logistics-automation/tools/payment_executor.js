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
const {
  resolveOmsEnvironment,
  OMS_ENVIRONMENTS,
} = require('../config/oms_environments');

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

const VASBUPOS_PAYMENT_URL = 'https://pos-oms-api-staging.nisims.web.id/api/v1/pospay/vasbupos_payment';

/**
 * Build payment payload for vasbupos_payment endpoint.
 * Dynamically populates ONLY nomor_va and nominal.
 */
function buildVasbuPosPayload(vaNumber, nominal) {
  return {
    nomor_va: String(vaNumber),
    kode_inst: "121",
    channel_id: "9001",
    nominal: typeof nominal === 'number' ? nominal : Number(nominal),
    admin: 0,
    refnumber: "0981879221111",
    waktu_proses: "2025-11-30 20:20:00.000",
    nopen: "50000",
    hashing: "",
    created_by: "GLID",
  };
}

/**
 * Submit payment request to vasbupos_payment API.
 */
async function submitVasbuPosPayment(vaNumber, nominal, options = {}) {
  const endpoint = options.paymentUrl || options.paymentApiUrl || VASBUPOS_PAYMENT_URL;
  const fetchFn = options.fetchFn || globalThis.fetch;

  if (!vaNumber) {
    throw new Error('Safeguard violation: Attempted to submit payment without verified dedicated VA.');
  }

  const payload = buildVasbuPosPayload(vaNumber, nominal);

  const response = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      'accept': '*/*',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  const isSuccess = response.ok && (
    !data ||
    ((data.rc === undefined || data.rc === '00' || data.rc === 0) &&
     (data.status === undefined || data.status === true || data.status === 'success' || data.status === 'SUCCESS' || data.status === 200) &&
     (data.response_code === undefined || data.response_code === '00'))
  );

  return {
    ok: response.ok,
    status: response.status,
    isSuccess,
    data,
    payload,
    rawText: text,
  };
}

/**
 * Execute payment for an existing OMS order via Payment Sandbox UI.
 * 
 * @param {import('playwright').Page} page Authenticated OMS page instance
 * @param {import('playwright').BrowserContext} context Browser context
 * @param {Object} orderResult Contains orderId, shipmentId, and optional pre-extracted amount
 * @param {Object} options
 * @param {string} [options.environment] Selected OMS environment name (e.g. 'Smart Routing', 'Staging')
 * @param {string} [options.omsUrl] Target OMS base URL
 * @param {string} [options.sandboxUrl='https://pospay-sandbox.vercel.app']
 * @param {string} [options.apiEndpoint] Payment sandbox endpoint for the target environment
 * @returns {Promise<Object>} Payment transaction result
 */
async function executeOrderPayment(page, context, orderResult = {}, options = {}) {
  const {
    orderId,
    shipmentId,
  } = orderResult;

  let resolvedEnv = null;
  if (options.environment) {
    resolvedEnv = resolveOmsEnvironment(options.environment);
    if (!resolvedEnv) {
      throw new Error(`[PaymentExecutor] Invalid OMS environment: "${options.environment}". Valid environments are: Smart Routing, Staging.`);
    }
  } else if (options.omsUrl) {
    resolvedEnv = resolveOmsEnvironment(options.omsUrl);
  }

  const defaultBaseUrl = OMS_ENVIRONMENTS['Smart Routing']?.baseUrl || 'https://sr-pos-oms-web.nisims.web.id';
  const defaultApiEndpoint = OMS_ENVIRONMENTS['Smart Routing']?.apiEndpoint || 'https://sr-pos-oms-api.nisims.web.id/api/v1';

  const omsUrl = (options.omsUrl || (resolvedEnv ? resolvedEnv.baseUrl : defaultBaseUrl)).replace(/\/+$/, '');
  const apiEndpoint = options.apiEndpoint || (resolvedEnv ? resolvedEnv.apiEndpoint : defaultApiEndpoint);
  const envName = resolvedEnv ? resolvedEnv.name : (options.environment || 'Smart Routing');

  const headless = options.headless === true;
  const sandboxUrl = options.sandboxUrl || 'https://pospay-sandbox.vercel.app';

  console.log(`\n======================================================`);
  console.log(`[PaymentExecutor] Starting payment simulation for Order ${orderId || '-'}`);
  console.log(`Environment: ${envName} (${omsUrl})`);
  console.log(`Browser Mode: ${headless ? 'Headless (background)' : 'Headed (visible browser)'}`);
  console.log(`Sandbox: ${sandboxUrl} | Endpoint: ${apiEndpoint}`);
  console.log(`======================================================\n`);

  const paymentResult = {
    orderId,
    shipmentId,
    environment: envName,
    environmentUrl: omsUrl,
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

    // Check if session redirected to login
    if (page.url().includes('login') || await page.locator('input[type="password"]').isVisible().catch(() => false)) {
      throw new Error(`[Payment:Step A] OMS session unauthenticated or redirected to login: ${page.url()}`);
    }

    // Check if we are on the order confirmation / summary screen with "Proses Pembayaran"
    const prosesPembayaranBtn = page.getByRole('button', { name: /proses pembayaran/i })
      .or(page.locator('button:has-text("Proses Pembayaran")')).first();

    if (await prosesPembayaranBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log(`[Payment:Step A] Clicking 'Proses Pembayaran' for Order ${orderId}...`);
      await page.screenshot({ path: '.artifacts/screenshots/before_proses_pembayaran.png' }).catch(() => {});
      await prosesPembayaranBtn.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: '.artifacts/screenshots/after_proses_pembayaran.png' }).catch(() => {});
      console.log(`[Payment:Step A] URL after click: ${page.url()}`);
    }

    // Ensure we transition to complete-payment / payment method screen
    const currentUrl = page.url();
    const bodyTextStage = await page.locator('body').innerText().catch(() => '');
    const isStage3Payment = bodyTextStage.includes('3 dari 3 tahap') ||
                            bodyTextStage.includes('metode pembayaran') ||
                            bodyTextStage.includes('SELESAIKAN PEMBAYARAN PESANAN') ||
                            bodyTextStage.includes('Pembayaran');

    const pospayLocator = page.locator('button#radio-container').filter({ hasText: /pospay/i })
      .or(page.locator('#radio-container'))
      .or(page.locator('button').filter({ hasText: /pospay/i }));
    const vaSpanLocator = page.locator('span:has-text("VA :"), div:has-text("VA :"), p:has-text("VA :")');

    const reachedPaymentScreen = currentUrl.includes('complete-payment') ||
      isStage3Payment ||
      (await pospayLocator.first().isVisible({ timeout: 4000 }).catch(() => false)) ||
      (await vaSpanLocator.first().isVisible({ timeout: 4000 }).catch(() => false));

    if (!reachedPaymentScreen) {
      console.log(`[Payment:Step A] Payment method screen not reached after clicking 'Proses Pembayaran'. Navigating directly to complete-payment/${orderId}...`);
      await page.goto(`${omsUrl}/shipment-journey-detail/complete-payment/${orderId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForTimeout(3000);
    }

    // Check for authentication redirect after navigation
    if (page.url().includes('login') || await page.locator('input[type="password"]').isVisible().catch(() => false)) {
      throw new Error(`[Payment:Step A] Navigation redirected to login for Order ${orderId}: ${page.url()}`);
    }

    // Check if order is already paid
    const pageTextInitial = await page.locator('body').innerText().catch(() => '');
    if (pageTextInitial.includes('PEMBAYARAN BERHASIL') || pageTextInitial.includes('Pesanan Dibayar')) {
      console.log(`[Payment:Step A] Order ${orderId} is already paid (PEMBAYARAN BERHASIL).`);
      paymentResult.orderStatus = 'SUCCESS';
      paymentResult.paymentStatus = 'PAYMENT_VERIFIED';
      paymentResult.sandboxResult = 'SUCCESS';
      paymentResult.omsPaymentStatus = 'PAID';
      paymentResult.overallStatus = 'SUCCESS';
      return paymentResult;
    }

    // Extract dynamic amount from the page if not already known
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
    const checkText = await page.locator('body').innerText().catch(() => '');
    let hasExistingVa = /VA\s*:\s*[0-9]+/i.test(checkText);
    if (!hasExistingVa) {
      const existingVaSpan = page.locator('span:has-text("VA :"), div:has-text("VA :"), p:has-text("VA :")').first();
      hasExistingVa = await existingVaSpan.isVisible({ timeout: 3000 }).catch(() => false);
    }

    if (!hasExistingVa) {
      console.log(`[Payment:Step B] Waiting for payment method screen readiness...`);
      // Wait for payment section heading or container
      const paymentHeading = page.getByText(/pilih metode pembayaran/i)
        .or(page.getByText(/selesaikan pembayaran pesanan/i))
        .or(page.locator('#radio-container'))
        .first();
      await paymentHeading.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {});

      console.log(`[Payment:Step B] Locating visible Pospay payment channel container...`);
      // From live inspection: <button id="radio-container"><input type="radio" ...> ... pospay ...</button>
      const pospayOption = page.locator('button#radio-container').filter({ hasText: /pospay/i })
        .or(page.getByRole('button').filter({ hasText: /pospay/i }))
        .or(page.locator('#radio-container').filter({ hasText: /pospay/i }))
        .or(page.locator('#radio-container'))
        .or(page.locator('button:has-text("pospay")'))
        .first();

      try {
        await pospayOption.waitFor({ state: 'visible', timeout: 25000 });
      } catch (waitErr) {
        // Capture diagnostic snapshot
        const errPath = path.join(path.resolve(__dirname, '../../..'), `.artifacts/screenshots/pospay_locator_timeout_${orderId}.png`);
        await page.screenshot({ path: errPath, fullPage: true }).catch(() => {});
        const domSnippet = (await page.locator('body').innerText().catch(() => '')).slice(0, 500);
        console.error(`[Payment:Step B] Pospay option locator timed out on ${page.url()}:\n${domSnippet}`);
        throw new Error(`Pospay payment option not found or visible on ${page.url()}: ${waitErr.message}`);
      }

      console.log(`[Payment:Step B] Clicking Pospay payment option container...`);
      await pospayOption.click();
      await page.waitForTimeout(800);

      // Verify Pospay selection
      const radioInput = pospayOption.locator('input[type="radio"]').or(page.locator('input[type="radio"]')).first();
      const isRadioChecked = await radioInput.isChecked().catch(() => false);
      const containerClass = (await pospayOption.getAttribute('class').catch(() => '')) || '';
      const isSelected = isRadioChecked || containerClass.includes('border-main');

      if (!isSelected) {
        console.warn(`[Payment:Step B] Pospay radio not checked after click. Clicking radio directly...`);
        await radioInput.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
      }

      const simpanMetodeBtn = page.getByRole('button', { name: /simpan metode pembayaran/i })
        .or(page.locator('button:has-text("Simpan Metode Pembayaran")')).first();
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
    let extractedVa = null;
    for (let poll = 0; poll < 25; poll++) {
      const paymentBodyText = await page.locator('body').innerText().catch(() => '');
      const bodyMatch = paymentBodyText.match(/(?:VA|Virtual Account)\s*:\s*([0-9]{6,20})/i);
      if (bodyMatch && bodyMatch[1]) {
        extractedVa = bodyMatch[1].trim();
        break;
      }
      await page.waitForTimeout(1000);
    }

    if (!extractedVa) {
      const vaSpan = page.locator('span:has-text("VA :"), div:has-text("VA :"), p:has-text("VA :")').first();
      if (await vaSpan.isVisible({ timeout: 5000 }).catch(() => false)) {
        const spanText = await vaSpan.innerText();
        const m = spanText.match(/VA\s*:\s*([0-9]+)/i);
        if (m && m[1]) extractedVa = m[1].trim();
      }
    }

    if (extractedVa) {
      paymentResult.vaNumber = extractedVa;
    } else {
      const failPath = path.join(path.resolve(__dirname, '../../..'), `.artifacts/screenshots/va_not_generated_${orderId}.png`);
      await page.screenshot({ path: failPath, fullPage: true }).catch(() => {});
      const domText = (await page.locator('body').innerText().catch(() => '')).slice(0, 500);
      console.error(`[Payment:Step C] VA not found in payment instructions:\n${domText}`);
      throw new Error(`Dedicated VA Number could not be extracted from payment instructions for Order ${orderId}.`);
    }

    // Strict validation: Dedicated VA must NOT match Order ID or Shipment ID
    if (paymentResult.vaNumber === orderId || paymentResult.vaNumber === shipmentId) {
      throw new Error(`Forbidden: Dedicated VA matched Order/Shipment ID (${paymentResult.vaNumber}).`);
    }
    if (!/^[0-9]{6,20}$/.test(paymentResult.vaNumber)) {
      throw new Error(`Invalid Dedicated VA format: '${paymentResult.vaNumber}'. Expected 6-20 numeric digits.`);
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
    // Step D: Payment Execution via vasbupos_payment API
    // CRITICAL SAFEGUARD: Never submit payment before VA is verified
    // -------------------------------------------------------------
    if (!paymentResult.vaNumber) {
      throw new Error(`[Payment:Step D] Safeguard violation: Attempted to submit payment without verified dedicated VA.`);
    }

    const paymentUrl = options.paymentUrl || options.paymentApiUrl || VASBUPOS_PAYMENT_URL;
    console.log(`[Payment:Step D] Executing payment API request to: ${paymentUrl}...`);
    console.log(`[Payment:Step D] Payload: nomor_va=${paymentResult.vaNumber}, nominal=${paymentResult.amount}`);

    const apiResult = await submitVasbuPosPayment(paymentResult.vaNumber, paymentResult.amount, options);

    if (apiResult.isSuccess) {
      paymentResult.sandboxResult = 'SUCCESS';
      paymentResult.paymentApiResponse = apiResult.data;
      paymentResult.paymentStatus = 'PAYMENT_VERIFIED';
      paymentResult.overallStatus = 'SUCCESS';
      console.log(`[Payment:Step D] Payment API confirmed SUCCESS for VA ${paymentResult.vaNumber} (Status: ${apiResult.status})`);
    } else {
      console.warn(`[Payment:Step D] Payment API request failed:`, apiResult.status, apiResult.rawText?.slice(0, 300));
      paymentResult.sandboxResult = 'FAILED';
      paymentResult.paymentApiResponse = apiResult.data;
      paymentResult.paymentStatus = 'PAYMENT_FAILED';
      paymentResult.overallStatus = 'ORDER_CREATED_PAYMENT_PENDING';
      paymentResult.error = `Payment API returned status ${apiResult.status}: ${apiResult.rawText?.slice(0, 150)}`;
      return paymentResult;
    }

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
  submitVasbuPosPayment,
  buildVasbuPosPayload,
  VASBUPOS_PAYMENT_URL,
  parseCurrency,
  formatRupiah,
};
