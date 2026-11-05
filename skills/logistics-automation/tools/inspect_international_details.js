const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const sessionPath = path.resolve('.sessions/staging-oms_kevin_d_imas_gmail_com_session.json');
  console.log('Inspecting full international form fields...');
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

  const sections = await page.evaluate(() => {
    const result = [];
    const labels = Array.from(document.querySelectorAll('label, .ant-form-item-label, h2, h3, h4, .form-title'));
    return labels.map(l => l.innerText.trim()).filter(t => t.length > 0 && t.length < 80);
  });
  console.log('Form labels/headings:', sections);

  const formItems = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.ant-form-item')).map(item => {
      const label = item.querySelector('label')?.innerText.trim() || '';
      const input = item.querySelector('input');
      const select = item.querySelector('.ant-select');
      const radio = item.querySelector('.ant-radio-group');
      return {
        label,
        inputId: input?.id || '',
        inputName: input?.name || '',
        placeholder: input?.placeholder || '',
        hasSelect: !!select,
        hasRadio: !!radio,
        isRequired: !!item.querySelector('.ant-form-item-required')
      };
    });
  });
  console.log('Form items:', JSON.stringify(formItems, null, 2));

  await browser.close();
})();
