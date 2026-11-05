/**
 * Reusable Payment Execution Module for POSIND OMS & Payment Sandbox
 * 
 * Responsibilities:
 * 1. Navigates to OMS payment selection and selects Pospay.
 * 2. Extracts the dynamically generated dedicated Virtual Account (VA) from the UI.
 * 3. Extracts the exact order payment amount from the UI.
 * 4. Strictly validates that the VA is never the Order ID or Shipment ID.
 * 5. Executes payment simulation exclusively through the Payment Sandbox web UI (Playwright).
 * 6. Verifies updated payment status in OMS (`/my/order`).
 * 7. Never uses hardcoded payment amounts or VA numbers.
 */

const path = require('path');
const fs = require('fs');

/**
 * Clean numeric string into integer amount
 */
function parseCurrency(str) {
  if (!str) return 0;
  // Remove Indonesian cents/decimals like ,00 or .00 at the end if present
  let clean = String(str).trim().replace(/[,.]00$/, '');
  const digits = clean.replace(/[^0-9]/g, '');
  return parseInt(digits, 10) || 0;
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

  const sandboxUrl = options.sandboxUrl || 'https://pospay-sandbox.vercel.app';
  const apiEndpoint = options.apiEndpoint || 'https://sr-pos-oms-api.nisims.web.id/api/v1';

  const paymentResult = {
    orderId,
    shipmentId,
    vaNumber: null,
    amount: null,
    sandboxResult: 'FAILED',
    omsPaymentStatus: 'UNPAID',
    error: null,
  };

  try {
    // 1. Advance to Payment Selection if on Order Confirmation screen
    const prosesPembayaranBtn = page.getByRole('button', { name: /proses pembayaran/i });
    if (await prosesPembayaranBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log(`[Payment] Clicking 'Proses Pembayaran' for Order ${orderId}...`);
      await prosesPembayaranBtn.click();
      await page.waitForTimeout(4000);
    }

    // 2. Select Pospay Payment Method
    console.log(`[Payment] Selecting Pospay payment channel...`);
    await page.waitForSelector('text=pospay', { state: 'visible', timeout: 20000 });
    const pospayCard = page.locator('#radio-container, #PTMI1765081604728').first();
    if (await pospayCard.isVisible().catch(() => false)) {
      await pospayCard.click();
    } else {
      await page.locator('text=pospay').first().click();
    }
    await page.waitForTimeout(1000);

    // Save payment method
    const simpanMetodeBtn = page.locator('button[type="submit"]:has-text("Simpan Metode Pembayaran"), button:has-text("Simpan Metode Pembayaran")').first();
    await simpanMetodeBtn.click();
    await page.waitForTimeout(5000);

    // 3. Extract Dedicated VA Number
    console.log(`[Payment] Extracting dedicated VA number from payment instructions...`);
    const vaSpan = page.locator('span:has-text("VA :"), div:has-text("VA :")').first();
    await vaSpan.waitFor({ state: 'visible', timeout: 25000 });
    const vaSpanText = await vaSpan.innerText();
    const vaMatch = vaSpanText.match(/VA\s*:\s*([0-9]+)/i);

    if (vaMatch && vaMatch[1]) {
      paymentResult.vaNumber = vaMatch[1].trim();
    } else {
      const paymentBodyText = await page.locator('body').innerText();
      const bodyMatch = paymentBodyText.match(/(?:VA|Virtual Account)\s*:\s*([0-9]{6,20})/i);
      if (bodyMatch) paymentResult.vaNumber = bodyMatch[1].trim();
    }

    if (!paymentResult.vaNumber) {
      throw new Error(`Dedicated VA Number not found on payment instructions page for Order ${orderId}.`);
    }

    // Strict validation: VA must NOT match Order ID or Shipment ID
    if (paymentResult.vaNumber === orderId || paymentResult.vaNumber === shipmentId) {
      throw new Error(`Dedicated VA matched Order/Shipment ID (${paymentResult.vaNumber}), which is forbidden.`);
    }

    // 4. Extract Payment Amount dynamically from UI
    let dynamicAmount = orderResult.amount;
    const bodyText = await page.locator('body').innerText();
    const amountMatch = bodyText.match(/Total\s*(?:Tagihan|Biaya|Pembayaran)?\s*:?\s*Rp\s*([0-9.,]+)/i) ||
                        bodyText.match(/Rp\s*([0-9]{1,3}(?:\.[0-9]{3})+)/i);
    if (amountMatch && amountMatch[1]) {
      dynamicAmount = parseCurrency(amountMatch[1]);
    }

    if (!dynamicAmount || dynamicAmount <= 0) {
      if (orderResult.amount && orderResult.amount > 0) {
        dynamicAmount = orderResult.amount;
      } else {
        throw new Error(`Could not determine dynamic payment amount from payment page for Order ${orderId}.`);
      }
    }
    paymentResult.amount = dynamicAmount;
    console.log(`[Payment] Dedicated VA: ${paymentResult.vaNumber}, Dynamic Amount: Rp${paymentResult.amount}`);

    // 5. Execute Payment in Payment Sandbox Web UI
    console.log(`[Payment] Executing payment simulation via Sandbox UI (${sandboxUrl})...`);
    const sandboxPage = await context.newPage();
    await sandboxPage.goto(sandboxUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sandboxPage.waitForTimeout(2000);

    // Configure Sandbox Endpoint
    const envInput = sandboxPage.locator('input[placeholder*="https://"], #environment, input[name="endpoint"]').first();
    if (await envInput.isVisible().catch(() => false)) {
      await envInput.fill('');
      await envInput.fill(apiEndpoint);
    }

    // Fill VA & Amount
    const vaInput = sandboxPage.locator('#nomorVA, input[name="nomorVA"], input[placeholder*="VA"]').first();
    await vaInput.fill(paymentResult.vaNumber);

    const nominalInput = sandboxPage.locator('#nominal, input[name="nominal"], input[placeholder*="Nominal"]').first();
    await nominalInput.fill(String(paymentResult.amount));

    await sandboxPage.waitForTimeout(500);
    const payBtn = sandboxPage.getByRole('button', { name: /pay now/i });
    await payBtn.click();
    await sandboxPage.waitForTimeout(4000);

    const sandboxResponseText = await sandboxPage.locator('body').innerText();
    if (
      sandboxResponseText.includes('Payment Successful') ||
      sandboxResponseText.includes('00') ||
      sandboxResponseText.includes('PEMBAYARAN BERHASIL') ||
      sandboxResponseText.includes('"payment_status": "SUCCESS"')
    ) {
      paymentResult.sandboxResult = 'SUCCESS';
      console.log(`[Payment] Sandbox payment confirmed SUCCESS for VA ${paymentResult.vaNumber}`);
    } else {
      console.warn(`[Payment] Sandbox payment inconclusive or error:`, sandboxResponseText.slice(0, 300));
      paymentResult.sandboxResult = 'FAILED';
      paymentResult.error = `Sandbox error: ${sandboxResponseText.slice(0, 150)}`;
    }
    await sandboxPage.close();

    // 6. Verify in OMS (/my/order)
    console.log(`[Payment] Verifying order status in OMS /my/order...`);
    await page.goto('https://sr-pos-oms-web.nisims.web.id/my/order', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3000);

    const orderRow = page.locator(`tr:has-text("${orderId}")`);
    if (await orderRow.count() > 0) {
      const rowText = await orderRow.first().innerText();
      console.log(`[Payment] OMS Order row status text:`, rowText);
      if (rowText.includes('Dibayar') || rowText.includes('Lunas') || rowText.includes('Paid')) {
        paymentResult.omsPaymentStatus = 'Dibayar';
      } else {
        paymentResult.omsPaymentStatus = 'Belum Dibayar / In Progress';
      }
    } else {
      paymentResult.omsPaymentStatus = 'Order Row Not Found';
    }

  } catch (err) {
    console.error(`[Payment] Error executing payment for Order ${orderId}:`, err.message);
    paymentResult.error = err.message;
  }

  return paymentResult;
}

module.exports = {
  executeOrderPayment,
  parseCurrency,
};
