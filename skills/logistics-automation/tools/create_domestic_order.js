const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

async function runStep3ToSummary({ headless = true, submit = false } = {}) {
  const sessionPath = path.resolve(".sessions/staging-oms_kevin_d_imas_gmail_com_session.json");
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ storageState: sessionPath, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("Navigating to Domestic Shipping...");
  await page.goto("https://sr-pos-oms-web.nisims.web.id/domestic-shipping");
  await page.waitForSelector("button.shipment-title", { state: "visible", timeout: 45000 });
  await page.waitForTimeout(3000);

  // Click Tambah Pengiriman
  await page.locator("button.shipment-title").click();
  await page.waitForSelector("#pickup_date", { state: "visible", timeout: 15000 });
  await page.waitForTimeout(1000);

  // 1. Set Pickup Date
  console.log("Filling pickup date...");
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
  console.log("Filling pickup location...");
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
  console.log("Filling drop-off location...");
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

  // 4. Select Mode SEMUA
  await page.getByRole("button", { name: /^SEMUA$/i }).click();
  await page.waitForTimeout(1000);

  // Submit Step 1
  console.log("Submitting Step 1...");
  await page.getByRole("button", { name: /simpan informasi lokasi/i }).click();
  await page.waitForTimeout(3000);

  // 5. Step 2: Karakteristik General Cargo
  console.log("Step 2: Filling cargo characteristics and manifest...");
  const charSelect = page.locator(".ant-select").filter({ hasText: /pilih karakteristik/i }).first();
  await charSelect.click();
  await page.waitForTimeout(500);
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /General Cargo/i }).first().click();
  await page.waitForTimeout(500);

  // Add Item
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

  // Packaging
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

  // Confirm manifest
  await page.getByRole("button", { name: /iya, simpan manifest barang/i }).click();
  await page.waitForTimeout(3000);

  // Dropoff linkage
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

  // Submit Step 2
  console.log("Submitting Step 2...");
  await page.getByRole("button", { name: /simpan informasi muatan/i }).click();
  await page.waitForTimeout(4000);

  console.log("=== STEP 3: PILIH LAYANAN ===");
  // Check service catalog availability
  const pageContent = await page.locator("body").innerText();
  if (pageContent.includes("Inquiry") && !pageContent.includes("LTL") && !pageContent.includes("FUSO BOX")) {
    console.error("FATAL: No applicable Service Catalog found! Stop immediately per policy.");
    await browser.close();
    process.exit(1);
  }

  // Inspect and select service option card if needed
  console.log("Selecting service catalog card...");
  // Look for card or radio button for LTL / FUSO BOX
  const serviceCards = page.locator(".cursor-pointer, .border, [role=\"radio\"], input[type=\"radio\"]");
  const fusoCard = page.locator("div, label").filter({ hasText: /FUSO BOX/i }).first();
  if (await fusoCard.isVisible()) {
    await fusoCard.click();
    console.log("Clicked FUSO BOX option card.");
    await page.waitForTimeout(1000);
  }

  // Take screenshot of Step 3 selection
  await page.screenshot({ path: ".artifacts/inspection/domestic_step3_selected.png", fullPage: true });

  // Advance to Step 4 (Ringkasan Pengiriman)
  console.log("Clicking Simpan Pilihan Layanan to advance to Step 4...");
  const simpanLayananBtn = page.getByRole("button", { name: /simpan pilihan layanan/i });
  await simpanLayananBtn.click();
  await page.waitForTimeout(5000);

  console.log("=== STEP 4: RINGKASAN PENGIRIMAN ===");
  console.log("Current URL:", page.url());
  const summaryText = await page.locator("body").innerText();
  console.log("--- SUMMARY EXTRACT ---");
  console.log(summaryText);

  await page.screenshot({ path: ".artifacts/inspection/domestic_step4_summary.png", fullPage: true });

  if (submit) {
    console.log("Submitting final order...");
    const buatPesananBtn = page.getByRole("button", { name: /buat pesanan|kirim pesanan|selesaikan|submit/i }).last();
    console.log("Buat pesanan button text:", await buatPesananBtn.innerText());
    await buatPesananBtn.click();
    await page.waitForTimeout(5000);
    // Handle modal confirmation if any
    const confirmModalBtn = page.getByRole("button", { name: /iya|lanjutkan|ya, buat pesanan|konfirmasi/i }).first();
    if (await confirmModalBtn.isVisible()) {
      await confirmModalBtn.click();
      await page.waitForTimeout(5000);
    }
    await page.screenshot({ path: ".artifacts/inspection/domestic_order_submitted.png", fullPage: true });
    console.log("Post submission URL:", page.url());
    console.log("Post submission content:", await page.locator("body").innerText());
  }

  await browser.close();
  return summaryText;
}

if (require.main === module) {
  const submit = process.argv.includes("--submit");
  runStep3ToSummary({ headless: true, submit }).catch(err => {
    console.error("Execution failed:", err);
    process.exit(1);
  });
}

module.exports = { runStep3ToSummary };
