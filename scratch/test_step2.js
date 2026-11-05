const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const sessionPath = path.resolve(".sessions/staging-oms_kevin_d_imas_gmail_com_session.json");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: sessionPath, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto("https://sr-pos-oms-web.nisims.web.id/international-shipping", { waitUntil: "networkidle" });
  await page.locator("button.shipment-title").click();
  await page.waitForTimeout(2000);

  // 1. Select Air
  await page.locator("label").filter({ hasText: /^Air$/i }).click();
  await page.locator(".ant-segmented-item").filter({ hasText: /^Cargo$/i }).click();
  await page.locator("label").filter({ hasText: /^Door$/i }).first().click();

  // Country: Indonesia
  await page.locator(".ant-select").nth(0).click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /^Indonesia$/i }).first().click();
  await page.waitForTimeout(500);

  // City: Tangerang
  const originCity = page.locator(".ant-select").nth(2);
  await originCity.click();
  await originCity.locator("input").fill("Tangerang");
  await page.waitForTimeout(1000);
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();

  // Postal: 15111
  await page.locator('input[placeholder="Masukkan kode pos"]').first().fill("15111");

  // Destination: Door
  await page.locator("label").filter({ hasText: /^Door$/i }).nth(1).click();

  // Destination Country: Singapore
  await page.locator(".ant-select").nth(3).click();
  await page.locator(".ant-select").nth(3).locator("input").fill("Singapore");
  await page.waitForTimeout(1000);
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /Singapore/i }).first().click();
  await page.waitForTimeout(1000);

  // Destination City: Queenstown
  const destCity = page.locator(".ant-select").nth(5);
  await destCity.click();
  await page.waitForTimeout(1000);
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").first().click();

  // Destination Postal: 118424
  await page.locator('input[placeholder="Masukkan kode pos"]').nth(1).fill("118424");

  // Incoterm: DDP
  const incotermSelect = page.locator(".ant-select").nth(6);
  await incotermSelect.scrollIntoViewIfNeeded();
  await incotermSelect.click();
  await page.waitForTimeout(500);
  const incotermOption = page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /Delivered Duty Paid/i }).first();
  await incotermOption.click();

  // Karakteristik: General Cargo
  const karSelect = page.locator(".ant-select").nth(7);
  await karSelect.scrollIntoViewIfNeeded();
  await karSelect.click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /General Cargo/i }).first().click();

  // Pickup Date
  const pickupInput = page.locator("#pickup_date");
  await pickupInput.scrollIntoViewIfNeeded();
  await pickupInput.click();
  await page.waitForTimeout(500);
  await page.locator(".ant-picker-cell-in-view:not(.ant-picker-cell-disabled)").last().click();
  const okBtn = page.locator(".ant-picker-ok button, button:has-text('Ok')");
  if (await okBtn.isVisible()) await okBtn.click();
  await page.waitForTimeout(500);

  // Tambah Kemasan
  const tambahBtn = page.getByRole("button", { name: /tambah kemasan/i }).first();
  await tambahBtn.scrollIntoViewIfNeeded();
  await tambahBtn.click();
  await page.waitForTimeout(1000);

  await page.locator('input[placeholder="Jumlah item"]').fill("1");
  await page.locator('input[placeholder="Berat"]').fill("50");
  await page.locator('input[placeholder="Length"]').fill("50");
  await page.locator('input[placeholder="Width"]').fill("50");
  await page.locator('input[placeholder="Height"]').fill("50");

  const pkgSelect = page.locator(".ant-select").filter({ hasText: /pilih jenis kemasan/i }).first();
  await pkgSelect.click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /^Tanpa Kemasan$/i }).first().click();

  const comSelect = page.locator(".ant-select").filter({ hasText: /pilih jenis komoditas/i }).first();
  await comSelect.click();
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /Elektronik/i }).first().click();

  const hsSelect = page.locator(".ant-select").filter({ hasText: /pilih kode hs/i }).first();
  await hsSelect.click();
  await hsSelect.locator("input").fill("85359010");
  await page.waitForTimeout(1000);
  await page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: /85359010/i }).first().click();

  await page.getByRole("button", { name: /^simpan$/i }).click();
  await page.waitForTimeout(1000);

  // Submit Step 1
  await page.getByRole("button", { name: /simpan detail pengiriman/i }).click();
  await page.waitForTimeout(3000);

  console.log("On Step 2. Inspecting buttons...");
  const buttons = await page.locator("button").allInnerTexts();
  console.log("Visible buttons:", buttons.filter(b => b.trim().length > 0));

  // Listen to network responses
  page.on("response", async res => {
    if (res.request().method() === "POST" && res.url().includes("/international-shipping")) {
      try {
        console.log("[INQUIRY ACTION RES]:", (await res.text()).slice(0, 300));
      } catch (e) {}
    }
  });

  const inquiryBtn = page.getByRole("button", { name: /ajukan inquiry layanan/i });
  if (await inquiryBtn.isVisible()) {
    console.log("Clicking 'Ajukan Inquiry Layanan'...");
    await inquiryBtn.click();
    await page.waitForTimeout(3000);
    const bodyText = await page.locator("body").innerText();
    console.log("After clicking inquiry, text snippet:\n", bodyText.slice(0, 600));
    await page.screenshot({ path: ".artifacts/inspection/oms_step2_after_inquiry_click.png", fullPage: true });
  }

  await browser.close();
})();
