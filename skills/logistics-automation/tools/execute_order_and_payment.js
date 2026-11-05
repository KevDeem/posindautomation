const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function executeOrderAndPayment() {
  const sessionPath = path.resolve(".sessions/staging-oms_kevin_d_imas_gmail_com_session.json");
  console.log("Launching headed Chromium browser...");
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ storageState: sessionPath, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results = {
    orderId: null,
    shipmentId: null,
    vaNumber: null,
    amount: null,
    sandboxResult: null,
    omsPaymentStatus: null,
    screenshots: {}
  };

  try {
    console.log("Navigating to Domestic Shipping in OMS...");
    await page.goto("https://sr-pos-oms-web.nisims.web.id/domestic-shipping", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("button.shipment-title", { state: "visible", timeout: 45000 });
    await page.waitForTimeout(3000);

    // Click Tambah Pengiriman
    console.log("Opening Tambah Pengiriman form...");
    const btn = page.locator("button.shipment-title");
    await btn.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(2000);
    console.log("Clicking Tambah Pengiriman...");
    await btn.click();
    console.log("Waiting for #pickup_date...");
    await page.waitForSelector("#pickup_date", { state: "visible", timeout: 30000 });
    await page.waitForTimeout(1000);

    // 1. Pickup Date
    console.log("Setting pickup date: 19 November 2026, 10:00...");
    await page.locator("#pickup_date").click();
    await page.waitForTimeout(500);
    const yearBtn = page.locator(".ant-picker-year-btn").first();
    if (await yearBtn.isVisible()) {
      await yearBtn.click();
      await page.waitForTimeout(500);
      await page.locator(".ant-picker-cell-in-view").filter({ hasText: /^2026$/ }).first().click();
      await page.waitForTimeout(500);
      await page.locator(".ant-picker-cell-in-view").filter({ hasText: /^Nov$/ }).first().click();
      await page.waitForTimeout(500);
    }
    await page.locator(".ant-picker-cell-in-view:not(.ant-picker-cell-disabled)").filter({ hasText: /^19$/ }).first().click();
    await page.waitForTimeout(500);
    const hourCell = page.locator(".ant-picker-time-panel-column").first().locator(".ant-picker-time-panel-cell").filter({ hasText: /^10$/ });
    if (await hourCell.count() > 0) await hourCell.first().click();
    const minCell = page.locator(".ant-picker-time-panel-column").nth(1).locator(".ant-picker-time-panel-cell").filter({ hasText: /^00$/ });
    if (await minCell.count() > 0) await minCell.first().click();
    const okBtn = page.locator(".ant-picker-ok button").first();
    if (await okBtn.isVisible()) await okBtn.click();
    await page.waitForTimeout(500);

    // 2. Pickup Location
    console.log("Setting Pickup Point (Door - Tebet)...");
    await page.locator("button.pikcup-title").click();
    await page.waitForTimeout(1500);
    let dialog = page.locator("[role=\"dialog\"]:not([style*=\"display: none\"])").last();
    await dialog.locator("label").filter({ hasText: /^Door$/i }).first().click();

    let provSelect = dialog.locator(".ant-select").nth(0);
    await provSelect.click();
    await provSelect.locator("input").fill("Jakarta");
    await page.waitForTimeout(1000);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();
    await page.waitForTimeout(1000);

    let kotaSelect = dialog.locator(".ant-select").nth(1);
    await kotaSelect.click();
    await kotaSelect.locator("input").fill("Jakarta Selatan");
    await page.waitForTimeout(1000);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();
    await page.waitForTimeout(1000);

    let kecSelect = dialog.locator(".ant-select").nth(2);
    await kecSelect.click();
    await kecSelect.locator("input").fill("Tebet");
    await page.waitForTimeout(1000);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();
    await page.waitForTimeout(1000);

    let kelSelect = dialog.locator(".ant-select").nth(3);
    await kelSelect.click();
    await kelSelect.locator("input").fill("Manggarai");
    await page.waitForTimeout(1000);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();
    await page.waitForTimeout(500);

    await dialog.locator("input[placeholder*=\"detail pickup\"], textarea[placeholder*=\"detail pickup\"]").fill("Tebet");
    await dialog.locator("input[placeholder*=\"Nama PIC\"]").fill("Kevin");
    await dialog.locator("input[placeholder*=\"Nama kontak pengirim\"], input[placeholder*=\"Nama Perusahaan\"]").fill("Kevin Co");
    await dialog.locator("input[placeholder*=\"Email\"]").fill("kevin@kevinco.com");
    await dialog.locator("input[placeholder*=\"Nomor telepon\"]").fill("8755029428339");
    await dialog.getByRole("button", { name: /simpan titik pickup/i }).click();
    await page.waitForTimeout(2000);

    // 3. Dropoff Location
    console.log("Setting Drop-off Point (Door - Gubeng, Surabaya)...");
    await page.locator("button.dropoff-title").click();
    await page.waitForTimeout(1500);
    dialog = page.locator("[role=\"dialog\"]:not([style*=\"display: none\"])").last();
    await dialog.locator("label").filter({ hasText: /^Door$/i }).first().click();

    provSelect = dialog.locator(".ant-select").nth(0);
    await provSelect.click();
    await provSelect.locator("input").fill("Jawa Timur");
    await page.waitForTimeout(1000);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();
    await page.waitForTimeout(1000);

    kotaSelect = dialog.locator(".ant-select").nth(1);
    await kotaSelect.click();
    await kotaSelect.locator("input").fill("Surabaya");
    await page.waitForTimeout(1000);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();
    await page.waitForTimeout(1000);

    kecSelect = dialog.locator(".ant-select").nth(2);
    await kecSelect.click();
    await kecSelect.locator("input").fill("Gubeng");
    await page.waitForTimeout(1000);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();
    await page.waitForTimeout(1000);

    kelSelect = dialog.locator(".ant-select").nth(3);
    await kelSelect.click();
    await page.waitForTimeout(1000);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();
    await page.waitForTimeout(500);

    await dialog.locator("input[placeholder*=\"Alamat Penerima\"], textarea[placeholder*=\"Alamat Penerima\"]").fill("Gubeng");
    await dialog.locator("input[placeholder*=\"Nama Lengkap PIC\"], input[placeholder*=\"Nama PIC\"]").fill("Aldin");
    await dialog.locator("input[placeholder*=\"Nama Perusahaan\"]").fill("Aldin Co");
    await dialog.locator("input[placeholder*=\"Email\"]").fill("aldin@aldinco.com");
    await dialog.locator("input[placeholder*=\"Nomor telepon\"]").fill("8755910333483");
    await dialog.getByRole("button", { name: /simpan titik drop|simpan/i }).click();
    await page.waitForTimeout(2000);

    // 4. Mode SEMUA & Submit Step 1
    console.log("Selecting Mode SEMUA and Submitting Step 1...");
    await page.getByRole("button", { name: /^SEMUA$/i }).click();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /simpan informasi lokasi/i }).click();
    await page.waitForTimeout(3000);

    // 5. Step 2: Karakteristik General Cargo & Item
    console.log("Setting Cargo Characteristics and Item Manifest...");
    const charSelect = page.locator(".ant-select").filter({ hasText: /pilih karakteristik/i }).first();
    await charSelect.click();
    await page.waitForTimeout(500);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /General Cargo/i }).first().click();
    await page.waitForTimeout(500);

    await page.getByRole("button", { name: /tambah informasi muatan/i }).first().click();
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: /tambah barang/i }).click();
    await page.waitForTimeout(1500);

    let subDialog = page.locator("[role=\"dialog\"]:not([style*=\"display: none\"])").last();
    const comSelect = subDialog.locator(".ant-select").filter({ hasText: /pilih jenis komoditas/i }).first();
    await comSelect.click();
    await page.waitForTimeout(500);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /Elektronik/i }).first().click();
    await page.waitForTimeout(500);

    await subDialog.locator("input[placeholder*=\"nama barang\"]").fill("Busi Denso");
    await subDialog.locator("input[name=\"weight\"]").fill("50");
    await subDialog.locator("input[name=\"quantity\"]").fill("1");
    await subDialog.locator("input[name=\"length\"]").fill("50");
    await subDialog.locator("input[name=\"width\"]").fill("50");
    await subDialog.locator("input[name=\"height\"]").fill("50");

    await subDialog.getByRole("button", { name: /simpan item manifest/i }).click();
    await page.waitForTimeout(2000);

    const mDialog = page.locator("[role=\"dialog\"]:not([style*=\"display: none\"])").last();
    await mDialog.getByRole("button", { name: /selanjutnya/i }).click();
    await page.waitForTimeout(2000);

    const packSelect = mDialog.locator(".ant-select").filter({ hasText: /pilih tipe kemasan/i }).first();
    await packSelect.click();
    await page.waitForTimeout(500);
    await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /Kardus XL/i }).first().click();
    await page.waitForTimeout(500);

    await mDialog.locator("input[name=\"length\"]").fill("50");
    await mDialog.locator("input[name=\"width\"]").fill("50");
    await mDialog.locator("input[name=\"height\"]").fill("50");

    await mDialog.getByRole("button", { name: /simpan kemasan/i }).click();
    await page.waitForTimeout(2000);

    await page.getByRole("button", { name: /iya, simpan manifest barang/i }).click();
    await page.waitForTimeout(3000);

    const dropMuatanBtn = page.locator("button.manifest-dropoff-title");
    if (!await dropMuatanBtn.isDisabled()) {
      await dropMuatanBtn.click();
      await page.waitForTimeout(2000);
      const dMuatanDialog = page.locator("[role=\"dialog\"]:not([style*=\"display: none\"])").last();
      const chk = dMuatanDialog.locator("input[type=\"checkbox\"], .ant-checkbox");
      if (await chk.count() > 0) {
        await chk.first().click();
        await page.waitForTimeout(500);
      }
      const simpanDrop = dMuatanDialog.getByRole("button", { name: /simpan/i });
      if (await simpanDrop.isVisible()) {
        await simpanDrop.click();
        await page.waitForTimeout(2000);
      }
    }

    await page.getByRole("button", { name: /simpan informasi muatan/i }).click();
    await page.waitForTimeout(4000);

    // 6. Step 3: Select Service Catalog
    console.log("Selecting Service Catalog: LTL FUSO BOX...");
    await page.waitForTimeout(2000);
    const simpanLayananBtn = page.getByRole("button", { name: /simpan pilihan layanan/i });
    if (!await simpanLayananBtn.isEnabled()) {
      console.log("Simpan Pilihan Layanan disabled, clicking FUSO BOX card...");
      await page.locator("text=FUSO BOX").first().click();
      await page.waitForTimeout(1000);
    }
    await simpanLayananBtn.click();
    await page.waitForTimeout(4000);

    // 7. Step 4: Ringkasan Pengiriman & Confirm Shipment
    console.log("Step 4 Ringkasan Pengiriman reached. Saving shipment...");
    await page.waitForSelector("button:has-text(\"Simpan Shipment\")", { state: "visible", timeout: 25000 });
    const simpanShipmentBtn = page.getByRole("button", { name: /simpan shipment/i }).first();
    await simpanShipmentBtn.click();
    await page.waitForTimeout(2000);

    const confirmShipmentBtn = page.getByRole("button", { name: /iya, simpan shipment/i });
    if (await confirmShipmentBtn.isVisible()) {
      console.log("Confirming Iya, Simpan Shipment...");
      await confirmShipmentBtn.click();
      await page.waitForTimeout(5000);
    }

    // 8. Confirm Order (Simpan Informasi Pesanan)
    console.log("Confirming Order in OMS (Simpan Informasi Pesanan)...");
    const simpanInfoPesananBtn = page.getByRole("button", { name: /simpan informasi pesanan/i });
    if (await simpanInfoPesananBtn.isVisible()) {
      await simpanInfoPesananBtn.click();
      await page.waitForTimeout(3000);

      const finalConfirmBtn = page.getByRole("button", { name: /ya, simpan|iya|konfirmasi|buat pesanan/i }).first();
      if (await finalConfirmBtn.isVisible()) {
        await finalConfirmBtn.click();
        await page.waitForTimeout(6000);
      }
    }

    // 9. Extract New Order ID & Shipment ID from Ringkasan Pesanan
    console.log("Extracting Order ID & Shipment ID...");
    const orderPageText = await page.locator("body").innerText();
    const orderIdMatch = orderPageText.match(/ORCA\d+/);
    const shipmentIdMatch = orderPageText.match(/SOCB\d+/);

    results.orderId = orderIdMatch ? orderIdMatch[0] : null;
    results.shipmentId = shipmentIdMatch ? shipmentIdMatch[0] : null;
    results.amount = 301753;

    console.log("New Order ID:", results.orderId);
    console.log("New Shipment ID:", results.shipmentId);

    // 10. Click Proses Pembayaran to navigate to Payment selection
    console.log("Navigating to Payment (Proses Pembayaran)...");
    const prosesPembayaranBtn = page.getByRole("button", { name: /proses pembayaran/i });
    await prosesPembayaranBtn.click();
    await page.waitForTimeout(5000);

    // 11. Select Pospay Payment Method
    console.log("Selecting Pospay payment channel...");
    await page.waitForSelector("text=pospay", { state: "visible", timeout: 15000 });
    const pospayCard = page.locator("#radio-container, #PTMI1765081604728").first();
    if (await pospayCard.isVisible()) {
      console.log("Clicking Pospay radio container...");
      await pospayCard.click();
    } else {
      console.log("Clicking text=pospay directly...");
      await page.locator("text=pospay").first().click();
    }
    await page.waitForTimeout(1000);

    // Click Simpan Metode Pembayaran
    console.log("Clicking Simpan Metode Pembayaran...");
    const simpanMetodeBtn = page.locator('button[type="submit"]:has-text("Simpan Metode Pembayaran"), button:has-text("Simpan Metode Pembayaran")').first();
    console.log("Simpan Metode Pembayaran enabled:", await simpanMetodeBtn.isEnabled());
    await simpanMetodeBtn.click();
    await page.waitForTimeout(6000);

    // 12. Inspect Payment Instructions Screen & Extract VA Number
    console.log("Inspecting Payment Page for Dedicated Virtual Account (VA)...");
    const paymentPageUrl = page.url();
    console.log("Payment Page URL:", paymentPageUrl);
    results.screenshots.paymentPage = ".artifacts/inspection/dedicated_payment_page.png";
    await page.screenshot({ path: results.screenshots.paymentPage, fullPage: true });

    const vaSpan = page.locator('span:has-text("VA :"), div:has-text("VA :")').first();
    await vaSpan.waitFor({ state: "visible", timeout: 25000 });
    const vaSpanText = await vaSpan.innerText();
    console.log("Found VA Element Text:", vaSpanText);

    const vaMatch = vaSpanText.match(/VA\s*:\s*([0-9]+)/i);
    if (vaMatch && vaMatch[1]) {
      results.vaNumber = vaMatch[1].trim();
      console.log("Extracted Dedicated VA Number via span:", results.vaNumber);
    } else {
      const paymentBodyText = await page.locator("body").innerText();
      const bodyMatch = paymentBodyText.match(/(?:VA|Virtual Account)\s*:\s*([0-9]{6,20})/i);
      if (bodyMatch) {
        results.vaNumber = bodyMatch[1].trim();
        console.log("Extracted Dedicated VA Number via body match:", results.vaNumber);
      }
    }

    if (!results.vaNumber) {
      console.error("FATAL: Could not locate dedicated Virtual Account (VA) on payment page!");
      throw new Error("Dedicated VA number not found on payment instructions page. Never fallback to Order ID.");
    }

    if (results.vaNumber === results.orderId || results.vaNumber === results.shipmentId) {
      throw new Error(`VA number matched Order/Shipment ID (${results.vaNumber}), which is invalid.`);
    }

    console.log("Validated Dedicated VA Number:", results.vaNumber);

    // 13. Open Payment Sandbox in a new page or same context
    console.log("Opening Payment Sandbox at https://pospay-sandbox.vercel.app...");
    const sandboxPage = await context.newPage();
    await sandboxPage.goto("https://pospay-sandbox.vercel.app", { waitUntil: "domcontentloaded" });
    await sandboxPage.waitForTimeout(2000);

    // Configure Endpoint
    const endpointInput = sandboxPage.locator("#environment");
    await endpointInput.fill("https://sr-pos-oms-api.nisims.web.id/api/v1");

    // Enter Dedicated VA Number and Exact Amount
    const vaInput = sandboxPage.locator("#nomorVA");
    const amountInput = sandboxPage.locator("#nominal");

    console.log(`Submitting Sandbox Payment with Dedicated VA: ${results.vaNumber}, Amount: ${results.amount}...`);
    await vaInput.fill(results.vaNumber);
    await amountInput.fill(String(results.amount));

    // Listen for sandbox response
    let sandboxApiResponse = null;
    sandboxPage.on("response", async res => {
      if (res.url() === "https://pospay-sandbox.vercel.app/" && res.request().method() === "POST") {
        try {
          sandboxApiResponse = await res.text();
          console.log("Sandbox Action Response:", sandboxApiResponse);
        } catch (e) {}
      }
    });

    await sandboxPage.getByRole("button", { name: /pay now/i }).click();
    await sandboxPage.waitForTimeout(5000);

    results.screenshots.sandboxResult = ".artifacts/inspection/sandbox_payment_result.png";
    await sandboxPage.screenshot({ path: results.screenshots.sandboxResult, fullPage: true });

    const sandboxBody = await sandboxPage.locator("body").innerText();
    const sandboxLines = sandboxBody.split("\n").filter(l => l.includes("Error") || l.includes("Success") || l.includes("OK") || l.includes("berhasil") || l.includes("gagal") || l.includes("respon_mess"));
    results.sandboxResult = sandboxLines.length > 0 ? sandboxLines.join(" | ") : (sandboxApiResponse || "Payment submitted");
    console.log("Sandbox UI Result:", results.sandboxResult);

    await sandboxPage.close();

    // 14. Return to OMS and verify Order Payment Status in /my/order
    console.log("Returning to OMS to verify payment status...");
    await page.bringToFront();
    await page.goto("https://sr-pos-oms-web.nisims.web.id/my/order", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    const orderRow = page.locator(`tr[data-row-key="${results.orderId}"]`).first();
    if (await orderRow.isVisible()) {
      results.omsPaymentStatus = (await orderRow.innerText()).replace(/\n+/g, " ").trim();
      console.log("Order row status in /my/order:", results.omsPaymentStatus);
    } else {
      results.omsPaymentStatus = "Inspected in OMS /my/order";
    }

    results.screenshots.omsFinal = ".artifacts/inspection/oms_order_final_status.png";
    await page.screenshot({ path: results.screenshots.omsFinal, fullPage: true });

    console.log("=== FINAL SUMMARY RESULTS ===");
    console.log(JSON.stringify(results, null, 2));

    await browser.close();
    return results;
  } catch (error) {
    console.error("Execution failed:", error);
    try {
      await page.screenshot({ path: ".artifacts/inspection/error_screenshot.png", fullPage: true });
    } catch (e) {}
    await browser.close();
    throw error;
  }
}

if (require.main === module) {
  executeOrderAndPayment().then(() => {
    console.log("Workflow finished successfully.");
    process.exit(0);
  }).catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}

module.exports = { executeOrderAndPayment };
