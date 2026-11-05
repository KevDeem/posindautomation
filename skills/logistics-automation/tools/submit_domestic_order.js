const { chromium } = require("playwright");
const path = require("path");

async function submitDomesticOrder() {
  const sessionPath = path.resolve(".sessions/staging-oms_kevin_d_imas_gmail_com_session.json");
  const browser = await chromium.launch({ headless: true });
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

  // 1. Pickup Date
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
  await page.getByRole("button", { name: /simpan informasi lokasi/i }).click();
  await page.waitForTimeout(3000);

  // 5. Step 2
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

  // 6. Step 3
  const fusoCard = page.locator("div, label").filter({ hasText: /FUSO BOX/i }).first();
  if (await fusoCard.isVisible()) {
    await fusoCard.click();
    await page.waitForTimeout(1000);
  }

  const simpanLayananBtn = page.getByRole("button", { name: /simpan pilihan layanan/i });
  await simpanLayananBtn.click();
  await page.waitForTimeout(4000);

  // 7. Step 4: Simpan Shipment
  console.log("Step 4 reached. Clicking 'Simpan Shipment'...");
  const simpanShipmentBtn = page.getByRole("button", { name: /simpan shipment/i }).first();
  await simpanShipmentBtn.click();
  await page.waitForTimeout(2000);

  // Click confirmation modal: "Iya, Simpan Shipment"
  const confirmShipmentBtn = page.getByRole("button", { name: /iya, simpan shipment/i });
  if (await confirmShipmentBtn.isVisible()) {
    console.log("Clicking 'Iya, Simpan Shipment' in confirmation modal...");
    await confirmShipmentBtn.click();
    await page.waitForTimeout(5000);
  }

  console.log("After Simpan Shipment, URL:", page.url());
  await page.screenshot({ path: ".artifacts/inspection/after_simpan_shipment.png", fullPage: true });

  // Now back on Buat Pesanan overview with "Simpan Informasi Pesanan"
  const simpanInfoPesananBtn = page.getByRole("button", { name: /simpan informasi pesanan/i });
  console.log("Simpan Informasi Pesanan visible:", await simpanInfoPesananBtn.isVisible());
  if (await simpanInfoPesananBtn.isVisible()) {
    console.log("Clicking 'Simpan Informasi Pesanan' to complete order...");
    await simpanInfoPesananBtn.click();
    await page.waitForTimeout(3000);

    // Check for final order confirmation modal
    const finalConfirmBtn = page.getByRole("button", { name: /ya, simpan|iya|konfirmasi|buat pesanan/i }).first();
    if (await finalConfirmBtn.isVisible()) {
      console.log("Clicking confirmation button in final modal...");
      await finalConfirmBtn.click();
      await page.waitForTimeout(6000);
    }
  }

  await page.screenshot({ path: ".artifacts/inspection/domestic_order_final_result.png", fullPage: true });
  console.log("Final URL:", page.url());
  const finalBody = await page.locator("body").innerText();
  console.log("Final Page Text Snippet:\n", finalBody.slice(0, 1500));

  await browser.close();
  return finalBody;
}

if (require.main === module) {
  submitDomesticOrder().catch(err => {
    console.error("Submission failed:", err);
    process.exit(1);
  });
}

module.exports = { submitDomesticOrder };
