const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { resolveSpecification, formatSpecificationReview, savePreviousSpecification } = require('./order_specification');

async function executeInternationalShipping({ headless = true } = {}) {
  const sessionPath = path.resolve('.sessions/staging-oms_kevin_d_imas_gmail_com_session.json');
  if (!fs.existsSync(sessionPath)) {
    throw new Error(`Session file not found at ${sessionPath}`);
  }

  // 1. Resolve specification
  const inputSpec = {
    orderType: 'international',
    orderMode: 'non-contract',
    transportationMode: 'Air',
    serviceType: 'Cargo',
    scheduledDate: '2026-11-25',
    scheduledTime: '03:30',
    pickup: {
      locationType: 'Door',
      country: 'Indonesia',
      city: 'Kota Tangerang',
      district: 'Tangerang',
      address: 'Jl Tangerang Raya',
      postalCode: '15111',
      pic: {
        name: 'Nisa',
        company: 'Mega Jaya',
        address: 'Jl Tangerang Raya',
        email: 'nisa@megajaya.com',
        phone: '81234567890'
      }
    },
    dropoff: {
      locationType: 'Door',
      country: 'Singapore',
      city: 'Orchard',
      district: 'Singapore',
      address: 'Harbour Dr No 33',
      postalCode: '238801',
      pic: {
        name: 'Aldin',
        company: 'Raceway Shop',
        address: 'Harbour Dr No 33',
        email: 'aldin@racewayshop.com',
        phone: '91234567'
      }
    },
    cargo: {
      characteristics: 'General Cargo',
      commodity: 'Elektronik',
      itemName: 'Bushing Assembly',
      weightKg: 50,
      quantity: 1,
      quantityUnit: 'PCS',
      lengthCm: 50,
      widthCm: 50,
      heightCm: 50,
      packagingType: 'Tanpa Kemasan',
      hsCode: '85359010'
    },
    incoterm: 'Delivered Duty Paid (DDP)'
  };

  const { resolvedSpec, sources, missingMandatory } = resolveSpecification(inputSpec);
  console.log('[Spec] Resolved Specification:');
  console.log(formatSpecificationReview(resolvedSpec, sources));

  console.log(`[Browser] Launching Chromium (headless: ${headless})...`);
  const browser = await chromium.launch({ headless, slowMo: headless ? 0 : 100 });
  const context = await browser.newContext({
    storageState: sessionPath,
    viewport: { width: 1440, height: 950 }
  });
  const page = await context.newPage();

  try {
    console.log('[Nav] Navigating to https://sr-pos-oms-web.nisims.web.id/international-shipping...');
    await page.goto('https://sr-pos-oms-web.nisims.web.id/international-shipping', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    // Verify non-contract policy: ensure we do not touch contract select
    console.log('[Policy] Non-Contract mode enforced: clicking Tambah Pengiriman directly...');
    const tambahBtn = page.locator('button.shipment-title, button:has-text("Tambah Pengiriman")').first();
    await tambahBtn.waitFor({ state: 'visible', timeout: 20000 });
    await tambahBtn.click();
    await page.waitForTimeout(2000);

    // Step 1: Detail Pengiriman
    console.log('[Step 1] Selecting Transportation Mode: Air...');
    await page.locator('label').filter({ hasText: /^Air$/i }).click();
    await page.waitForTimeout(1000);

    console.log('[Step 1] Selecting Service Type: Cargo...');
    const cargoSegment = page.locator('.ant-segmented-item').filter({ hasText: /^Cargo$/i });
    await cargoSegment.waitFor({ state: 'visible', timeout: 5000 });
    await cargoSegment.click();
    await page.waitForTimeout(500);

    // Origin
    console.log('[Step 1] Origin: Door...');
    await page.locator('label').filter({ hasText: /^Door$/i }).first().click();
    await page.waitForTimeout(300);

    console.log('[Step 1] Origin Country: Indonesia...');
    const originCountryContainer = page.locator('.ant-select').filter({ has: page.locator('#origin_country') }).first();
    await originCountryContainer.click();
    await page.waitForTimeout(500);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /^Indonesia$/i }).first().click();
    await page.waitForTimeout(1000);

    console.log('[Step 1] Origin City: Tangerang...');
    const originCityContainer = page.locator('.ant-select').filter({ has: page.locator('#origin_city') }).first();
    await originCityContainer.click();
    await originCityContainer.locator('input').fill('Tangerang');
    await page.waitForTimeout(1000);
    const originOpt = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first();
    await originOpt.click();
    await page.waitForTimeout(500);

    console.log('[Step 1] Origin Postal Code: 15111...');
    await page.locator('input[placeholder="Masukkan kode pos"]').first().fill('15111');

    // Destination
    console.log('[Step 1] Destination: Door...');
    await page.locator('label').filter({ hasText: /^Door$/i }).nth(1).click();
    await page.waitForTimeout(300);

    console.log('[Step 1] Destination Country: Singapore...');
    const destCountryContainer = page.locator('.ant-select').filter({ has: page.locator('#destination_country') }).first();
    await destCountryContainer.click();
    await page.waitForTimeout(500);
    await destCountryContainer.locator('input').fill('Singapore');
    await page.waitForTimeout(1000);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /^Singapore$/i }).first().click();
    await page.waitForTimeout(1000);

    console.log('[Step 1] Destination City: Orchard...');
    const destCityContainer = page.locator('.ant-select').filter({ has: page.locator('#destination_city') }).first();
    await destCityContainer.click();
    await page.waitForTimeout(1000);
    const destOpt = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /Orchard/i }).first();
    if (await destOpt.count() > 0) {
      await destOpt.click();
    } else {
      await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
    }
    await page.waitForTimeout(500);

    console.log('[Step 1] Destination Postal Code: 238801...');
    await page.locator('input[placeholder="Masukkan kode pos"]').nth(1).fill('238801');

    // Incoterm
    console.log('[Step 1] Incoterm: Delivered Duty Paid (DDP)...');
    const incotermContainer = page.locator('.ant-select').filter({ has: page.locator('#incoterm') }).first();
    await incotermContainer.click();
    await page.waitForTimeout(500);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /Delivered Duty Paid/i }).first().click();
    await page.waitForTimeout(500);

    // Karakteristik
    console.log('[Step 1] Karakteristik: General Cargo...');
    const prodCharContainer = page.locator('.ant-select').filter({ has: page.locator('#product_characteristic') }).first();
    await prodCharContainer.click();
    await page.waitForTimeout(500);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /General Cargo/i }).first().click();
    await page.waitForTimeout(500);

    // Description
    console.log('[Step 1] Filling Description...');
    await page.locator('#description').fill('Sparepart Kendaraan - Bushing Assembly');
    await page.waitForTimeout(300);

    // Pickup Date
    console.log('[Step 1] Setting Pickup Date: 2026-11-25...');
    const dateInput = page.locator('#pickup_date');
    await dateInput.click();
    await page.waitForTimeout(500);
    const yearBtn = page.locator('.ant-picker-year-btn').first();
    if (await yearBtn.isVisible()) {
      await yearBtn.click();
      await page.waitForTimeout(300);
      await page.locator('.ant-picker-cell-in-view').filter({ hasText: /^2026$/ }).first().click();
      await page.waitForTimeout(300);
      await page.locator('.ant-picker-cell-in-view').filter({ hasText: /^Nov$/ }).first().click();
      await page.waitForTimeout(300);
    }
    await page.locator('.ant-picker-cell-in-view:not(.ant-picker-cell-disabled)').filter({ hasText: /^25$/ }).first().click();
    await page.waitForTimeout(500);
    const okBtn = page.locator('.ant-picker-ok button').first();
    if (await okBtn.isVisible()) {
      await okBtn.click();
      await page.waitForTimeout(500);
    }

    // Packaging / Muatan
    console.log('[Step 1] Adding Kemasan...');
    await page.getByRole('button', { name: /tambah kemasan/i }).first().click();
    await page.waitForTimeout(1500);

    await page.locator('input[placeholder="Jumlah item"]').fill('1');
    await page.locator('input[placeholder="Berat"]').fill('50');
    await page.locator('input[placeholder="Length"]').fill('50');
    await page.locator('input[placeholder="Width"]').fill('50');
    await page.locator('input[placeholder="Height"]').fill('50');

    const pkgSelect = page.locator('.ant-select').filter({ hasText: /pilih jenis kemasan/i }).first();
    await pkgSelect.click();
    await page.waitForTimeout(500);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /^Tanpa Kemasan$/i }).first().click();
    await page.waitForTimeout(500);

    const comSelect = page.locator('.ant-select').filter({ hasText: /pilih jenis komoditas/i }).first();
    await comSelect.click();
    await page.waitForTimeout(500);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /Elektronik/i }).first().click();
    await page.waitForTimeout(500);

    const hsSelect = page.locator('.ant-select').filter({ hasText: /pilih kode hs/i }).first();
    await hsSelect.click();
    await hsSelect.locator('input').fill('85359010');
    await page.waitForTimeout(1000);
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /85359010/i }).first().click();
    await page.waitForTimeout(500);

    await page.getByRole('button', { name: /^simpan$/i }).click();
    await page.waitForTimeout(1500);

    // Check errors
    const step1Errors = await page.evaluate(() => Array.from(document.querySelectorAll('.ant-form-item-explain-error')).map(e => e.innerText.trim()));
    console.log('[Step 1] Errors remaining before submit:', step1Errors);

    // Submit Step 1
    console.log('[Step 1] Submitting Detail Pengiriman...');
    await page.getByRole('button', { name: /simpan detail pengiriman/i }).click();
    await page.waitForTimeout(5000);

    // Inspect Step 2
    console.log('[Step 2] Current URL:', page.url());
    const step2Body = await page.evaluate(() => document.body.innerText);
    const screenshotDir = path.resolve('.artifacts/inspection');
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
    const step2Shot = path.join(screenshotDir, 'international_non_contract_step2.png');
    await page.screenshot({ path: step2Shot, fullPage: true });
    console.log('[Step 2] Screenshot captured at:', step2Shot);

    const step2Lines = step2Body.split('\n').map(l => l.trim()).filter(Boolean);
    console.log('[Step 2] Visible text lines:', step2Lines.slice(0, 30));

    // Service catalog check
    const hasInquiry = step2Body.includes('Ajukan Inquiry Layanan') || step2Body.includes('Kami akan mengolah harga');
    const catalogCards = await page.locator('.catalog-card, .service-card, [data-testid="catalog-item"]').count();

    console.log('[Step 2] Has Inquiry prompt:', hasInquiry);
    console.log('[Step 2] Catalog card count:', catalogCards);

    if (hasInquiry || catalogCards === 0) {
      console.log('----------------------------------------------------');
      console.log('BLOCKER DETECTED: No applicable Service Catalog available for Non-Contract International Shipping on this route (Tangerang -> Singapore, Air Cargo).');
      console.log('Application offers only "Ajukan Inquiry Layanan" or "Hubungi Kami".');
      console.log('Per policy: HALTING immediately. No fallback to Inquiry or silent redirection.');
      console.log('----------------------------------------------------');
      return {
        success: false,
        blocker: 'SERVICE_CATALOG_UNAVAILABLE',
        reason: 'No applicable Service Catalog found for Non-Contract International Air Cargo (Tangerang -> Singapore). Staging OMS displays: "Kami akan mengolah harga yang sesuai untuk anda" and prompts "Ajukan Inquiry Layanan".',
        step2Screenshot: step2Shot,
        resolvedSpec
      };
    }

    return {
      success: true,
      resolvedSpec,
      step2Screenshot: step2Shot
    };
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  executeInternationalShipping({ headless: true })
    .then(res => {
      console.log('[Result]', JSON.stringify(res, null, 2));
      process.exit(res.success ? 0 : 2);
    })
    .catch(err => {
      console.error('[Error]', err);
      process.exit(1);
    });
}

module.exports = { executeInternationalShipping };
