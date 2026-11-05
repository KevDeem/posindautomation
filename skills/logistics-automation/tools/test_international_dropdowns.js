const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const sessionPath = path.resolve('.sessions/staging-oms_kevin_d_imas_gmail_com_session.json');
  console.log('Testing Step 1 dropdowns and options for Air Cargo...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: sessionPath, viewport: { width: 1440, height: 1200 } });
  const page = await context.newPage();

  await page.goto('https://sr-pos-oms-web.nisims.web.id/international-shipping', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const tambahBtn = page.getByRole('button', { name: /tambah pengiriman/i });
  if (await tambahBtn.count() > 0) {
    await tambahBtn.first().click();
    await page.waitForTimeout(2000);
  }

  // 1. Select Air mode
  console.log('Selecting Air mode...');
  await page.locator('label').filter({ hasText: /^Air$/i }).first().click();
  await page.waitForTimeout(1000);

  // 2. Origin Country
  console.log('Selecting Indonesia for Origin Country...');
  const originCountryContainer = page.locator('.ant-select').filter({ has: page.locator('#origin_country') }).first();
  await originCountryContainer.click();
  await page.waitForTimeout(500);
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /^Indonesia$/i }).first().click();
  await page.waitForTimeout(1000);

  // Check Origin Port / Airport options
  console.log('Checking Origin Port/Airport options...');
  const originPortContainer = page.locator('.ant-select').filter({ has: page.locator('#origin_port') }).first();
  if (await originPortContainer.isVisible()) {
    await originPortContainer.click();
    await page.waitForTimeout(1000);
    const portOptions = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')).map(e => e.innerText.trim());
    });
    console.log('Origin Port/Airport options:', portOptions);
    if (portOptions.length > 0) {
      await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
    }
  }

  // Check Origin City
  console.log('Checking Origin City options...');
  const originCityContainer = page.locator('.ant-select').filter({ has: page.locator('#origin_city') }).first();
  if (await originCityContainer.isVisible()) {
    await originCityContainer.click();
    await page.waitForTimeout(1000);
    const cityOptions = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')).map(e => e.innerText.trim());
    });
    console.log('Origin City options sample:', cityOptions.slice(0, 15));
    // Check if Tangerang or Kota Tangerang is in the list
    const tangerangOptions = cityOptions.filter(c => /tangerang/i.test(c));
    console.log('Tangerang city options found:', tangerangOptions);
    if (tangerangOptions.length > 0) {
      await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /tangerang/i }).first().click();
    }
  }

  // 3. Destination Country
  console.log('Checking Destination Country...');
  const destCountryContainer = page.locator('.ant-select').filter({ has: page.locator('#destination_country') }).first();
  await destCountryContainer.click();
  await page.waitForTimeout(1000);
  const destOptions = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')).map(e => e.innerText.trim());
  });
  console.log('Destination Country options sample:', destOptions.slice(0, 15));
  const sg = destOptions.find(d => /singapore/i.test(d));
  console.log('Singapore found:', sg);
  if (sg) {
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').filter({ hasText: /^Singapore$/i }).first().click();
    await page.waitForTimeout(1000);

    // Destination Port
    const destPortContainer = page.locator('.ant-select').filter({ has: page.locator('#destination_port') }).first();
    if (await destPortContainer.isVisible()) {
      await destPortContainer.click();
      await page.waitForTimeout(1000);
      const destPorts = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')).map(e => e.innerText.trim());
      });
      console.log('Destination Ports in Singapore:', destPorts);
      if (destPorts.length > 0) {
        await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
      }
    }

    // Destination City
    const destCityContainer = page.locator('.ant-select').filter({ has: page.locator('#destination_city') }).first();
    if (await destCityContainer.isVisible()) {
      await destCityContainer.click();
      await page.waitForTimeout(1000);
      const destCities = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')).map(e => e.innerText.trim());
      });
      console.log('Destination Cities in Singapore:', destCities);
      if (destCities.length > 0) {
        await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
      }
    }
  }

  // 4. Incoterms
  const incoContainer = page.locator('.ant-select').filter({ has: page.locator('#incoterm') }).first();
  if (await incoContainer.isVisible()) {
    await incoContainer.click();
    await page.waitForTimeout(1000);
    const incos = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')).map(e => e.innerText.trim());
    });
    console.log('Incoterms available:', incos);
    if (incos.length > 0) {
      await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
    }
  }

  // 5. Product Characteristics
  const prodCharContainer = page.locator('.ant-select').filter({ has: page.locator('#product_characteristic') }).first();
  if (await prodCharContainer.isVisible()) {
    await prodCharContainer.click();
    await page.waitForTimeout(1000);
    const prodChars = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')).map(e => e.innerText.trim());
    });
    console.log('Product Characteristics available:', prodChars);
    if (prodChars.length > 0) {
      await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
    }
  }

  // 6. Container Types
  const containerType = page.locator('.ant-select').filter({ has: page.locator('#containers_0_container_type') }).first();
  if (await containerType.isVisible()) {
    await containerType.click();
    await page.waitForTimeout(1000);
    const cTypes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content')).map(e => e.innerText.trim());
    });
    console.log('Container types available:', cTypes);
    if (cTypes.length > 0) {
      await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first().click();
    }
  }

  await page.screenshot({ path: '.artifacts/inspection/international_form_filled_test.png', fullPage: true });
  await browser.close();
})();
