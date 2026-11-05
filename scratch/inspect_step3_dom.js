const { chromium } = require('playwright');
const path = require('path');
const { performFreshLogin, navigateToShippingPage } = require('../skills/logistics-automation/tools/auth_manager');
const { selectAntLocationOption } = require('../skills/logistics-automation/tools/order_executor');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await context.newPage();

  try {
    console.log('[Step 1] Fresh login...');
    await performFreshLogin(page, context);

    console.log('[Step 2] Navigating to Domestic Shipping...');
    await navigateToShippingPage(page, 'domestic');

    const addBtn = page.locator('button.shipment-title, button:has-text("Tambah Pengiriman")').first();
    await addBtn.click();
    await page.waitForSelector('#pickup_date', { state: 'visible', timeout: 30000 });

    // Fill pickup date
    await page.locator('#pickup_date').click();
    await page.waitForTimeout(500);
    const dateCell = page.locator('.ant-picker-cell-in-view:not(.ant-picker-cell-disabled)').last();
    await dateCell.click();
    const okBtn = page.locator('.ant-picker-ok button, button:has-text("Ok")').first();
    if (await okBtn.isVisible()) await okBtn.click();
    await page.waitForTimeout(500);

    // Pickup Location
    await page.locator('button.loc-pickup-title').click();
    await page.waitForTimeout(1000);
    let dialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
    await selectAntLocationOption(page, dialog, 'province_code', 'Jawa Barat', /jawa barat/i);
    await selectAntLocationOption(page, dialog, 'city_code', 'Kota Cirebon', /cirebon/i);
    await selectAntLocationOption(page, dialog, 'district_code', 'Kesambi', /kesambi/i);
    await selectAntLocationOption(page, dialog, 'subdistrict_code', 'Drajat', /.*/, { fallbackFirst: true });
    await dialog.locator('textarea[placeholder*="Alamat"], input[placeholder*="Alamat"]').first().fill('Jl. Kesambi No. 10');
    await dialog.locator('input[placeholder*="Nama Lengkap PIC"], input[placeholder*="Nama PIC"]').first().fill('Budi');
    await dialog.locator('input[placeholder*="Nama Perusahaan"]').first().fill('PT Sumber Berkat');
    await dialog.locator('input[placeholder*="Email"]').first().fill('budi@example.com');
    await dialog.locator('input[placeholder*="Nomor telepon"]').first().fill('081234567890');
    await dialog.getByRole('button', { name: /simpan titik pickup|simpan/i }).click();
    await page.waitForTimeout(1500);

    // Dropoff Location
    await page.locator('button.loc-dropoff-title').click();
    await page.waitForTimeout(1000);
    dialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
    await selectAntLocationOption(page, dialog, 'province_code', 'Jawa Tengah', /jawa tengah/i);
    await selectAntLocationOption(page, dialog, 'city_code', 'Kabupaten Tegal', /tegal/i);
    await selectAntLocationOption(page, dialog, 'district_code', 'Adiwerna', /adiwerna/i);
    await selectAntLocationOption(page, dialog, 'subdistrict_code', 'Adiwerna', /.*/, { fallbackFirst: true });
    await dialog.locator('textarea[placeholder*="Alamat"], input[placeholder*="Alamat"]').first().fill('Jl. Raya Tegal No. 20');
    await dialog.locator('input[placeholder*="Nama Lengkap PIC"], input[placeholder*="Nama PIC"]').first().fill('Siti');
    await dialog.locator('input[placeholder*="Nama Perusahaan"]').first().fill('CV Makmur');
    await dialog.locator('input[placeholder*="Email"]').first().fill('siti@example.com');
    await dialog.locator('input[placeholder*="Nomor telepon"]').first().fill('089876543210');
    await dialog.getByRole('button', { name: /simpan titik drop|simpan/i }).click();
    await page.waitForTimeout(1500);

    // Mode SEMUA & Submit Step 1
    const semuabtn = page.getByRole('button', { name: /^SEMUA$/i });
    if (await semuabtn.isVisible()) await semuabtn.click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /simpan informasi lokasi/i }).click();
    await page.waitForTimeout(2000);

    // Step 2: Karakteristik General Cargo & Item
    const charSelect = page.locator('.ant-select').filter({ hasText: /pilih karakteristik/i }).first();
    await charSelect.click();
    await page.waitForTimeout(500);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /general cargo/i }).first().click();
    await page.waitForTimeout(500);

    const pickupMuatanBtn = page.locator('button.manifest-pickup-title')
      .or(page.locator('.box-shadow-mod').filter({ hasText: /^Pickup/i }).locator('button:has-text("Tambah Informasi Muatan")'))
      .first();
    await pickupMuatanBtn.click();
    await page.waitForTimeout(1000);

    await page.getByRole('button', { name: /tambah barang/i }).click();
    await page.waitForTimeout(1000);
    let subDialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
    const comSelect = subDialog.locator('.ant-select').filter({ hasText: /pilih jenis komoditas/i }).first();
    await comSelect.click();
    await page.waitForTimeout(500);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();

    await subDialog.locator('input[placeholder*="nama barang"]').fill('Komponen Elektronik');
    await subDialog.locator('input[name="weight"]').fill('25');
    await subDialog.locator('input[name="quantity"]').fill('1');
    await subDialog.locator('input[name="length"]').fill('40');
    await subDialog.locator('input[name="width"]').fill('40');
    await subDialog.locator('input[name="height"]').fill('40');
    await subDialog.getByRole('button', { name: /simpan item manifest/i }).click();
    await page.waitForTimeout(1500);

    const mDialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
    await mDialog.getByRole('button', { name: /selanjutnya/i }).click();
    await page.waitForTimeout(1500);

    const packSelect = mDialog.locator('.ant-select').filter({ hasText: /pilih tipe kemasan/i }).first();
    await packSelect.click();
    await page.waitForTimeout(500);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
    await mDialog.locator('input[name="length"]').fill('40');
    await mDialog.locator('input[name="width"]').fill('40');
    await mDialog.locator('input[name="height"]').fill('40');
    await mDialog.getByRole('button', { name: /simpan kemasan/i }).click();
    await page.waitForTimeout(1500);

    await page.getByRole('button', { name: /iya, simpan manifest barang/i }).click();
    await page.waitForTimeout(2000);

    const dropMuatanBtn = page.locator('button.manifest-dropoff-title')
      .or(page.locator('.box-shadow-mod').filter({ hasText: /^Drop\s*Off/i }).locator('button:has-text("Tambah Informasi Muatan")'))
      .first();
    if (await dropMuatanBtn.isVisible() && !await dropMuatanBtn.isDisabled()) {
      await dropMuatanBtn.click();
      await page.waitForTimeout(1500);
      const dMuatanDialog = page.locator('[role="dialog"]:not([style*="display: none"])').last();
      const chk = dMuatanDialog.locator('input[type="checkbox"], .ant-checkbox');
      if (await chk.count() > 0) {
        await chk.first().click();
        await page.waitForTimeout(500);
      }
      await dMuatanDialog.getByRole('button', { name: /simpan/i }).click();
      await page.waitForTimeout(1500);
    }

    console.log('Saving manifest to proceed to Step 3...');
    await page.getByRole('button', { name: /simpan informasi muatan/i }).click();
    await page.waitForTimeout(4000);

    console.log('--- INSPECTING STEP 3 DOM ---');
    const screenshotPath = path.resolve('.artifacts/inspection/live_step3_inspect.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log('Screenshot saved to:', screenshotPath);

    // Inspect buttons, cards, containers in Step 3
    const step3Info = await page.evaluate(() => {
      const allButtons = Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.innerText.trim(),
        disabled: b.disabled || b.classList.contains('ant-btn-disabled'),
        className: b.className
      }));

      const cards = Array.from(document.querySelectorAll('.ant-card, [class*="card"], [class*="service"], .cursor-pointer, [role="radio"], [role="button"]'))
        .filter(el => {
          const t = el.innerText || '';
          return t.includes('LTL') || t.includes('FTL') || t.includes('BOX') || t.includes('Rp') || t.includes('PENGIRIMAN');
        })
        .map(c => ({
          tag: c.tagName,
          className: c.className,
          text: c.innerText.trim()
        }));

      const bodySnippet = document.body.innerText.slice(0, 3000);

      return { allButtons, cards, bodySnippet };
    });

    console.log('Step 3 Cards found:', JSON.stringify(step3Info.cards, null, 2));
    console.log('Step 3 Buttons:', JSON.stringify(step3Info.allButtons.filter(b => b.text.length > 0), null, 2));
    console.log('Body snippet:\n', step3Info.bodySnippet);

  } finally {
    await browser.close();
  }
})();
