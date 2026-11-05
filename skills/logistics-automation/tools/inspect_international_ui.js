const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const sessionPath = path.resolve('.sessions/staging-oms_kevin_d_imas_gmail_com_session.json');
  console.log('Launching headed Chromium to inspect International Shipping...');
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ storageState: sessionPath, viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto('https://sr-pos-oms-web.nisims.web.id/international-shipping', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  console.log('Page title:', await page.title());
  console.log('Page url:', page.url());

  const tambahBtn = page.getByRole('button', { name: /tambah pengiriman/i });
  console.log('Tambah pengiriman button count:', await tambahBtn.count());
  if (await tambahBtn.count() > 0) {
    await tambahBtn.first().click();
    await page.waitForTimeout(3000);
  }

  // Inspect visible form elements
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean);
  });
  console.log('Visible buttons:', buttons);

  const inputs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('input')).map(i => ({ id: i.id, placeholder: i.placeholder, name: i.name, type: i.type }));
  });
  console.log('Visible inputs:', inputs);

  const textSnippets = await page.locator('body').innerText();
  console.log('Body snippet:\n', textSnippets.slice(0, 1000));

  await page.screenshot({ path: '.artifacts/inspection/international_shipping_step1_inspect.png', fullPage: true });

  await page.waitForTimeout(3000);
  await browser.close();
})();
