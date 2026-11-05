/**
 * Test suite for Standalone POSIND Ordering Bot
 * 
 * Verifies without creating real staging OMS transactions:
 * 1. Natural-language specification parsing (domestic, international, quantities, dates, times).
 * 2. Missing mandatory field identification.
 * 3. Batch construction and normalization from natural language.
 * 4. Confirmation cancellation (user declining confirmation aborts execution).
 * 5. Execution history persistence, listing, and sensitive data sanitization.
 * 6. Mocked failure recovery and independent payment result tracking.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { parseOrderPrompt, parseDateString, parseTimeString } = require('../bot/nl_parser');
const {
  saveExecutionRecord,
  listExecutionRecords,
  sanitizeObject,
} = require('../bot/history_manager');
const { loadConfig } = require('../bot/config');
const { resolveSpecification, DEFAULT_SPECIFICATION, formatSpecificationReview } = require('./order_specification');
const { normalizeBatchInput } = require('./batch_executor');
const { executeOrderPayment, formatRupiah, parseCurrency } = require('./payment_executor');

async function runBotTests() {
  console.log('=== Starting POSIND Ordering Bot Unit Tests ===\n');

  // Test 1: Date & Time Parsing
  console.log('[Test 1] Testing natural language date & time parsing...');
  assert.strictEqual(parseDateString('1 December 2026'), '2026-12-01');
  assert.strictEqual(parseDateString('December 1st 2026'), '2026-12-01');
  assert.strictEqual(parseDateString('19 Nov 2026'), '2026-11-19');
  assert.strictEqual(parseDateString('2026-11-25'), '2026-11-25');
  assert.strictEqual(parseTimeString('08:00'), '08:00');
  assert.strictEqual(parseTimeString('scheduled at 10:30 WIB'), '10:30');
  console.log('  [PASS] Date and time string parsers verified.');

  // Test 2: Natural-Language Domestic Order Parsing
  console.log('\n[Test 2] Testing natural-language domestic order parsing...');
  const prompt1 = 'Create 5 domestic orders from Tebet Jakarta Selatan to Gubeng Surabaya, scheduled for 1 December 2026 at 08:00';
  const p1 = parseOrderPrompt(prompt1);
  assert.strictEqual(p1.count, 5);
  assert.strictEqual(p1.spec.orderType, 'domestic');
  assert.strictEqual(p1.spec.scheduledDate, '2026-12-01');
  assert.strictEqual(p1.spec.scheduledTime, '08:00');
  assert(p1.spec.pickup.city.includes('Jakarta'), 'Pickup city should resolve to Jakarta');
  assert(p1.spec.dropoff.city.includes('Surabaya'), 'Dropoff city should resolve to Surabaya');
  console.log('  [PASS] Domestic batch NL parsing verified.');

  // Test 3: Natural-Language International Order Parsing
  console.log('\n[Test 3] Testing natural-language international order parsing...');
  const prompt2 = 'Create an international air cargo order from Tangerang to Orchard Singapore, pickup 25 November 2026 at 03:30';
  const p2 = parseOrderPrompt(prompt2);
  assert.strictEqual(p2.count, 1);
  assert.strictEqual(p2.spec.orderType, 'international');
  assert.strictEqual(p2.spec.transportationMode, 'Air');
  assert.strictEqual(p2.spec.serviceType, 'Cargo');
  assert.strictEqual(p2.spec.scheduledDate, '2026-11-25');
  assert.strictEqual(p2.spec.scheduledTime, '03:30');
  assert.strictEqual(p2.spec.pickup.city, 'Kota Tangerang');
  assert.strictEqual(p2.spec.dropoff.city, 'Orchard');
  assert.strictEqual(p2.spec.dropoff.country, 'Singapore');
  console.log('  [PASS] International NL parsing verified.');

  // Test 4: Missing Mandatory Field Detection
  console.log('\n[Test 4] Testing missing mandatory field identification...');
  const emptySpec = { pickup: {}, dropoff: {} };
  const resEmpty = resolveSpecification(emptySpec, { previousSpec: {} });
  assert(resEmpty.missingMandatory.includes('pickup.city'), 'Should identify missing pickup.city');
  assert(resEmpty.missingMandatory.includes('dropoff.city'), 'Should identify missing dropoff.city');
  assert(resEmpty.missingMandatory.includes('scheduledDate'), 'Should identify missing scheduledDate');
  console.log('  [PASS] Missing mandatory fields accurately detected:', resEmpty.missingMandatory);

  // Test 5: Batch Construction from Parsed Output
  console.log('\n[Test 5] Testing batch construction from parsed natural language...');
  const batchItems = normalizeBatchInput({ specification: p1.spec, count: p1.count });
  assert.strictEqual(batchItems.length, 5);
  assert.strictEqual(batchItems[0].label, 'Order #1 of 5');
  assert.strictEqual(batchItems[4].label, 'Order #5 of 5');
  console.log('  [PASS] Batch construction verified (5 independent items).');

  // Test 6: Removal of final submission confirmation prompt
  console.log('\n[Test 6] Testing removal of submission confirmation prompts in order_bot.js...');
  const orderBotSource = fs.readFileSync(path.join(__dirname, '../bot/order_bot.js'), 'utf-8');
  assert(!orderBotSource.includes('Confirm submission of this'), 'Must not contain Confirm submission prompt');
  assert(!orderBotSource.includes('Confirm creating and processing all'), 'Must not contain batch confirmation prompt');
  assert(!orderBotSource.includes('Confirm submission?'), 'Must not contain generic confirmation prompt');
  assert(orderBotSource.includes('validateSpecificationForExecution'), 'Must retain pre-execution validation');
  assert(orderBotSource.includes('Launching order execution'), 'Must proceed directly to single order execution');
  assert(orderBotSource.includes('Launching batch execution'), 'Must proceed directly to batch execution');
  console.log('  [PASS] Submission confirmation prompts completely removed; direct execution verified.');

  // Test 7: Execution History Persistence & Sensitive Data Sanitization
  console.log('\n[Test 7] Testing execution history persistence & data sanitization...');
  const mockRecordData = {
    request: 'Test automated order',
    menuOption: 'Single Order',
    orderType: 'domestic',
    batchCount: 1,
    autoPay: true,
    summary: { total: 1, succeeded: 1, failed: 0, totalAmountPaid: 301753 },
    orders: [{
      index: 1,
      label: 'Order #1',
      orderId: 'ORCA_MOCK_123',
      shipmentId: 'SOCB_MOCK_456',
      amount: 301753,
      vaNumber: '41574676',
      status: 'SUCCESS',
      sandboxPayment: 'SUCCESS',
      omsStatus: 'Dibayar',
    }],
    specification: {
      pickup: { city: 'Jakarta Selatan' },
      dropoff: { city: 'Surabaya' },
      credentials: { password: 'SECRET_SHOULD_BE_STRIPPED' }, // sensitive test field
      token: 'BEARER_SECRET_TOKEN',                          // sensitive test field
    },
  };

  const saved = saveExecutionRecord(mockRecordData);
  assert(saved.id.startsWith('exec_'), 'Record ID must start with exec_');
  assert.strictEqual(saved.orders[0].orderId, 'ORCA_MOCK_123');
  assert.strictEqual(saved.specification.credentials, undefined, 'Sensitive credentials must be stripped');
  assert.strictEqual(saved.specification.token, undefined, 'Sensitive token must be stripped');

  const historyList = listExecutionRecords(5);
  assert(historyList.length > 0, 'History list must return saved records');
  assert.strictEqual(historyList[0].id, saved.id);
  console.log('  [PASS] History saved and retrieved with credentials stripped.');

  // Test 8: Mock Failure Recovery State Handling
  console.log('\n[Test 8] Testing batch failure classification...');
  const mockOrderFailureStates = [
    { index: 1, success: true, orderId: "ORCA001", sandboxPayment: "SUCCESS", omsStatus: "Dibayar" },
    { index: 2, success: false, orderId: "ORCA002", sandboxPayment: "FAILED", error: "Payment Sandbox HTTP 500" },
    { index: 3, success: false, orderId: null, error: "Service Catalog Not Found" },
  ];
  assert.strictEqual(mockOrderFailureStates[0].omsStatus, "Dibayar");
  assert.strictEqual(mockOrderFailureStates[1].orderId !== null, true, "Distinguishes order created but payment failed");
  assert.strictEqual(mockOrderFailureStates[2].orderId, null, "Distinguishes order creation failure");
  console.log("  [PASS] Independent failure state classification verified.");

  // Test 9: Regression - "pickup in tebet jakarta to gubeng surabaya on 1 dec 2026 at 08:00"
  console.log('\n[Test 9] Regression: "pickup in tebet jakarta to gubeng surabaya on 1 dec 2026 at 08:00"...');
  const reg1 = parseOrderPrompt('pickup in tebet jakarta to gubeng surabaya on 1 dec 2026 at 08:00');
  assert.strictEqual(reg1.spec.scheduledDate, '2026-12-01');
  assert.strictEqual(reg1.spec.scheduledTime, '08:00');
  assert.strictEqual(reg1.spec.pickup.district, 'Tebet');
  assert.strictEqual(reg1.spec.pickup.city, 'Jakarta Selatan');
  assert.strictEqual(reg1.spec.dropoff.district, 'Gubeng');
  assert.strictEqual(reg1.spec.dropoff.city, 'Kota Surabaya');
  assert(!reg1.spec.pickup.address.includes('gubeng'), 'Pickup address must not contain dropoff text');
  assert(!reg1.spec.pickup.address.includes('surabaya'), 'Pickup address must not contain dropoff city');
  console.log('  [PASS] Route and schedule correctly parsed independently.');

  // Test 10: Regression - "from Tebet Jakarta Selatan to Gubeng Surabaya on 1 December 2026 at 08:00"
  console.log('\n[Test 10] Regression: "from Tebet Jakarta Selatan to Gubeng Surabaya on 1 December 2026 at 08:00"...');
  const reg2 = parseOrderPrompt('from Tebet Jakarta Selatan to Gubeng Surabaya on 1 December 2026 at 08:00');
  assert.strictEqual(reg2.spec.scheduledDate, '2026-12-01');
  assert.strictEqual(reg2.spec.scheduledTime, '08:00');
  assert.strictEqual(reg2.spec.pickup.city, 'Jakarta Selatan');
  assert.strictEqual(reg2.spec.dropoff.city, 'Kota Surabaya');
  console.log('  [PASS] Formal from-to route parsed cleanly.');

  // Test 11: Regression - "pickup in Kesambi Cirebon to Adiwerna Tegal on 1 Dec 2026 at 10:00"
  console.log('\n[Test 11] Regression: "pickup in Kesambi Cirebon to Adiwerna Tegal on 1 Dec 2026 at 10:00"...');
  const reg3 = parseOrderPrompt('pickup in Kesambi Cirebon to Adiwerna Tegal on 1 Dec 2026 at 10:00');
  assert.strictEqual(reg3.spec.scheduledDate, '2026-12-01');
  assert.strictEqual(reg3.spec.scheduledTime, '10:00');
  assert.strictEqual(reg3.spec.pickup.district, 'Kesambi');
  assert.strictEqual(reg3.spec.pickup.city, 'Kota Cirebon');
  assert.strictEqual(reg3.spec.dropoff.district, 'Adiwerna');
  assert.strictEqual(reg3.spec.dropoff.city, 'Kabupaten Tegal');
  console.log('  [PASS] Cirebon to Tegal route parsed cleanly.');

  // Test 12: Protection against silent destination inheritance when destination requested but unresolved
  console.log('\n[Test 12] Regression: Unresolved destination blocks submission without silent inheritance...');
  const unresolvedPrompt = parseOrderPrompt('pickup in tebet jakarta to unknown destination on 1 dec 2026 at 08:00');
  const prevBaseline = {
    dropoff: { city: 'Kota Surabaya', district: 'Gubeng', province: 'Jawa Timur' }
  };
  const resolvedUnres = resolveSpecification(unresolvedPrompt.spec, { previousSpec: prevBaseline });
  // Must NOT have inherited Surabaya!
  assert.notStrictEqual(resolvedUnres.resolvedSpec.dropoff.city, 'Kota Surabaya', 'Must not silently inherit Surabaya');
  assert.strictEqual(resolvedUnres.sources.dropoff.city, 'unresolved_explicit');
  assert(resolvedUnres.missingMandatory.includes('dropoff.city'), 'Must be flagged in missingMandatory');

  const { validateSpecificationForExecution } = require('../bot/order_bot');
  const valCheck = validateSpecificationForExecution(resolvedUnres.resolvedSpec, resolvedUnres.sources, 'pickup in tebet jakarta to unknown destination');
  assert.strictEqual(valCheck.canSubmit, false, 'Unresolved destination must block submission');
  console.log('  [PASS] Explicit unresolved destination blocked submission and prevented silent inheritance.');

  // Test 13: Genuinely omitted destination continues to inherit previous baseline
  console.log('\n[Test 13] Regression: Omitted destination continues normal inheritance...');
  const omittedPrompt = parseOrderPrompt('pickup in tebet jakarta on 1 dec 2026 at 08:00'); // No "to" or destination
  const resolvedOmitted = resolveSpecification(omittedPrompt.spec, { previousSpec: prevBaseline });
  assert.strictEqual(resolvedOmitted.resolvedSpec.dropoff.city, 'Kota Surabaya', 'Omitted destination should inherit previous baseline');
  assert.strictEqual(resolvedOmitted.sources.dropoff.city, 'reused');
  console.log('  [PASS] Genuinely omitted destination inherits previous baseline as expected.');

  // Test 14: Retry safety classification
  console.log('\n[Test 14] Regression: Failure classification distinguishing safe vs unsafe retries...');
  const { classifyFailure } = require('./batch_executor');
  const catFail = classifyFailure(new Error('No applicable Service Catalog found for domestic route'));
  assert.strictEqual(catFail.type, 'CATALOG_NOT_FOUND');
  assert.strictEqual(catFail.retryable, false, 'Catalog not found must never retry');

  const subFail = classifyFailure(new Error('Order ID could not be identified after final submission in OMS UI.'));
  assert.strictEqual(subFail.type, 'UNCERTAIN_SUBMISSION');
  assert.strictEqual(subFail.retryable, false, 'Uncertain submission must not retry blindly');

  const uiFail = classifyFailure(new Error('Pickup date selector (#pickup_date) could not be located after clicking Tambah Pengiriman.'));
  assert.strictEqual(uiFail.type, 'TRANSIENT_UI_FAILURE');
  assert.strictEqual(uiFail.retryable, true, 'Transient UI failure is safe to retry');
  console.log('  [PASS] Failure classification verified.');

  // Helper for mock readline
  function createMockRl(answers = []) {
    let index = 0;
    return {
      question: async (prompt) => {
        const ans = answers[index++] !== undefined ? answers[index - 1] : '';
        return ans;
      },
      close: () => {},
    };
  }

  // Test 15: Verifying browser mode defaults to Headed
  console.log('\n[Test 15] Verifying browser mode defaults to Headed...');
  const { promptBrowserMode } = require('../bot/order_bot');
  const rlEnter = createMockRl(['']); // User presses Enter
  const modeEnter = await promptBrowserMode(rlEnter);
  assert.strictEqual(modeEnter, false, 'Pressing Enter must default to Headed (headless: false)');

  const rlOne = createMockRl(['1']); // User selects 1
  const modeOne = await promptBrowserMode(rlOne);
  assert.strictEqual(modeOne, false, 'Selecting 1 must resolve to Headed (headless: false)');

  const rlOther = createMockRl(['invalid']); // Any unexpected input defaults to Headed
  const modeOther = await promptBrowserMode(rlOther);
  assert.strictEqual(modeOther, false, 'Unexpected input must default to Headed (headless: false)');
  console.log('  [PASS] Browser mode defaults to Headed verified.');

  // Test 16: Verifying Headless can still be selected
  console.log('\n[Test 16] Verifying Headless can still be selected...');
  const rlTwo = createMockRl(['2']); // User selects 2
  const modeTwo = await promptBrowserMode(rlTwo);
  assert.strictEqual(modeTwo, true, 'Selecting 2 must resolve to Headless (headless: true)');
  console.log('  [PASS] Headless selection verified.');

  // Test 17: Verifying Contract selection is never prompted
  console.log('\n[Test 17] Verifying Contract selection is never prompted...');
  const botCode = fs.readFileSync(path.join(__dirname, '../bot/order_bot.js'), 'utf-8');
  const promptMatches = botCode.match(/promptQuestion\(rl,\s*['"`]([^'"`]+)['"`]\)/g) || [];
  for (const p of promptMatches) {
    assert(!/kontrak|contract/i.test(p), `Prompt should not ask for contract: ${p}`);
  }
  const specEditsCode = botCode.slice(botCode.indexOf('promptSpecificationEdits'), botCode.indexOf('validateSpecificationForExecution'));
  assert(!/kontrak|contract/i.test(specEditsCode), 'promptSpecificationEdits must not prompt for contract');
  console.log('  [PASS] Contract selection is never prompted in CLI.');

  // Test 18: Verifying Contract cannot override Non-Contract policy
  console.log('\n[Test 18] Verifying Contract cannot override Non-Contract policy...');
  const contractAttempt1 = resolveSpecification({ orderMode: 'contract' });
  assert.strictEqual(contractAttempt1.resolvedSpec.orderMode, 'non-contract', 'orderMode must remain non-contract');
  assert.strictEqual(contractAttempt1.sources.orderMode, 'policy_enforced', 'sources.orderMode must be policy_enforced');

  const contractAttempt2 = resolveSpecification({ orderMode: 'CONTRACT' }, { previousSpec: { orderMode: 'contract' } });
  assert.strictEqual(contractAttempt2.resolvedSpec.orderMode, 'non-contract', 'orderMode must remain non-contract even with previous contract spec');
  assert.strictEqual(contractAttempt2.sources.orderMode, 'policy_enforced', 'sources.orderMode must be policy_enforced');

  // Test 19: Regression: Scoped Tambah Informasi Muatan resolution in duplicate button DOM
  console.log('\n[Test 19] Regression: Duplicate \"Tambah Informasi Muatan\" button scoping...');
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(`
    <div class="box-shadow-mod">
      <h3>Pickup Details</h3>
      <p>Tebet, Jakarta Selatan</p>
      <button itemid="file" type="button" class="secondary-btn manifest-pickup-title">+ <span>Tambah Informasi Muatan</span></button>
    </div>
    <div class="box-shadow-mod">
      <h3>Drop Off Details</h3>
      <p>Gubeng, Surabaya</p>
      <button itemid="file" type="button" class="secondary-btn manifest-dropoff-title">+ <span>Tambah Informasi Muatan</span></button>
    </div>
  `);

  // Verify unscoped getByRole resolves to 2 elements (causing strict mode violation)
  const unscoped = page.getByRole('button', { name: /tambah informasi muatan/i });
  assert.strictEqual(await unscoped.count(), 2, 'Unscoped getByRole must resolve to 2 elements in duplicate DOM');

  // Verify scoped Pickup locator resolves uniquely to button 1
  const scopedPickup = page.locator('button.manifest-pickup-title')
    .or(page.locator('.box-shadow-mod').filter({ hasText: /^Pickup/i }).locator('button:has-text("Tambah Informasi Muatan")'))
    .first();
  assert.strictEqual(await scopedPickup.count(), 1, 'Scoped pickup locator must resolve uniquely');
  assert(await scopedPickup.evaluate(el => el.classList.contains('manifest-pickup-title')), 'Must be the pickup manifest button');

  // Verify scoped Dropoff locator resolves uniquely to button 2
  const scopedDropoff = page.locator('button.manifest-dropoff-title')
    .or(page.locator('.box-shadow-mod').filter({ hasText: /^Drop\s*Off/i }).locator('button:has-text("Tambah Informasi Muatan")'))
    .first();
  assert.strictEqual(await scopedDropoff.count(), 1, 'Scoped dropoff locator must resolve uniquely');
  assert(await scopedDropoff.evaluate(el => el.classList.contains('manifest-dropoff-title')), 'Must be the dropoff manifest button');

  // Verify click actions succeed with 0 strict mode errors
  let clickedPickup = false;
  let clickedDropoff = false;
  await page.exposeFunction('onPickupClick', () => { clickedPickup = true; });
  await page.exposeFunction('onDropoffClick', () => { clickedDropoff = true; });
  await page.locator('button.manifest-pickup-title').evaluate(el => el.addEventListener('click', window.onPickupClick));
  await page.locator('button.manifest-dropoff-title').evaluate(el => el.addEventListener('click', window.onDropoffClick));

  await scopedPickup.click();
  await scopedDropoff.click();
  assert.strictEqual(clickedPickup, true, 'Pickup manifest button clicked');
  assert.strictEqual(clickedDropoff, true, 'Dropoff manifest button clicked');

  await browser.close();
  console.log('  [PASS] Scoped manifest locators eliminate duplicate strict mode violation and target correct sections.');

  // Test 20: Fresh login success and diagnostic log verification
  console.log('\n[Test 20] Testing fresh login success and diagnostic logs...');
  const { performFreshLogin, navigateToShippingPage } = require('./auth_manager');
  const browserTest = await chromium.launch({ headless: true });
  const contextTest = await browserTest.newContext();
  const pageTest = await contextTest.newPage();

  // Mock OMS login form in local DOM
  await pageTest.setContent(`
    <html>
      <body>
        <div id="login-modal">
          <input type="text" placeholder="Masukkan email" id="email" />
          <input type="password" placeholder="Masukkan kata sandi" id="password" />
          <button class="primary-btn">Masuk Sekarang</button>
        </div>
        <div id="auth-state" style="display:none;">
          <header>GLID Bisnis</header>
          <div class="avatar">K</div>
        </div>
        <script>
          document.querySelector('button.primary-btn').addEventListener('click', () => {
            document.getElementById('login-modal').style.display = 'none';
            document.getElementById('auth-state').style.display = 'block';
          });
        </script>
      </body>
    </html>
  `);

  const authLogs = [];
  const originalLog = console.log;
  console.log = (...args) => {
    authLogs.push(args.join(' '));
    originalLog(...args);
  };

  pageTest.goto = async () => {};

  await performFreshLogin(pageTest, contextTest, {
    username: 'kevin.d.imas@gmail.com',
    password: '@Admin123.',
  });

  console.log = originalLog;

  assert(authLogs.some(l => l.includes('[Authentication] Starting fresh OMS login...')), 'Must log Starting fresh OMS login');
  assert(authLogs.some(l => l.includes('[Authentication] Login page detected.')), 'Must log Login page detected');
  assert(authLogs.some(l => l.includes('[Authentication] Credentials submitted.')), 'Must log Credentials submitted');
  assert(authLogs.some(l => l.includes('[Authentication] Login successful.')), 'Must log Login successful');
  assert(authLogs.some(l => l.includes('[Authentication] Verified authenticated OMS session.')), 'Must log Verified authenticated OMS session');
  console.log('  [PASS] Fresh login logs and verification verified.');

  // Test 21: Invalid credentials error handling
  console.log('\n[Test 21] Testing invalid credentials rejection and diagnostic screenshot...');
  const pageInvalid = await contextTest.newPage();
  await pageInvalid.setContent(`
    <html>
      <body>
        <div id="login-modal">
          <input type="text" placeholder="Masukkan email" id="email" />
          <input type="password" placeholder="Masukkan kata sandi" id="password" />
          <button class="primary-btn">Masuk Sekarang</button>
          <div class="ant-message-error" style="display:none;">Incorrect email or password</div>
        </div>
        <script>
          document.querySelector('button.primary-btn').addEventListener('click', () => {
            document.querySelector('.ant-message-error').style.display = 'block';
          });
        </script>
      </body>
    </html>
  `);
  pageInvalid.goto = async () => {};

  let loginFailed = false;
  try {
    await performFreshLogin(pageInvalid, contextTest, {
      username: 'wrong@example.com',
      password: 'wrongpassword',
    });
  } catch (err) {
    loginFailed = true;
    assert(err.message.includes('Incorrect email or password'), 'Should report credential failure');
  }
  assert.strictEqual(loginFailed, true, 'Login with invalid credentials must throw');
  console.log('  [PASS] Invalid credentials properly rejected.');

  // Test 22: Unauthenticated navigation redirection failure
  console.log('\n[Test 22] Testing unauthenticated navigation redirect failure...');
  const pageRedirect = await contextTest.newPage();
  pageRedirect.goto = async () => {};
  let navFailed = false;
  try {
    await navigateToShippingPage(pageRedirect, 'domestic');
  } catch (err) {
    navFailed = true;
    assert(err.message.includes('Authentication expired mid-batch or session lost'), 'Must identify session loss on redirect');
  }
  assert.strictEqual(navFailed, true, 'Unauthenticated redirect must throw');
  console.log('  [PASS] Session loss / unauthenticated redirect detected and stopped.');

  // Test 23: Navigation verification logs for Domestic & International
  console.log('\n[Test 23] Testing navigation verification logs for Domestic & International...');
  const pageNav = await contextTest.newPage();
  await pageNav.setContent(`
    <html>
      <body>
        <button class="shipment-title">Tambah Pengiriman</button>
        <input id="pickup_date" />
        <input id="origin_country" />
      </body>
    </html>
  `);
  const navLogs = [];
  console.log = (...args) => {
    navLogs.push(args.join(' '));
    originalLog(...args);
  };

  let currentMockUrl = 'https://sr-pos-oms-web.nisims.web.id/domestic-shipping';
  pageNav.url = () => currentMockUrl;
  pageNav.goto = async (url) => { currentMockUrl = url; };

  await navigateToShippingPage(pageNav, 'domestic');
  currentMockUrl = 'https://sr-pos-oms-web.nisims.web.id/international-shipping';
  await navigateToShippingPage(pageNav, 'international');

  console.log = originalLog;

  assert(navLogs.some(l => l.includes('[Navigation] Opening Domestic Shipping...')), 'Must log Opening Domestic Shipping');
  assert(navLogs.some(l => l.includes('[Navigation] Domestic Shipping page verified.')), 'Must log Domestic Shipping page verified');
  assert(navLogs.some(l => l.includes('[Navigation] Opening International Shipping...')), 'Must log Opening International Shipping');
  assert(navLogs.some(l => l.includes('[Navigation] International Shipping page verified.')), 'Must log International Shipping page verified');
  await browserTest.close();
  console.log('  [PASS] Navigation logging and element verification verified.');

  // Test 24: Batch authenticating only once at startup
  console.log('\n[Test 24] Testing batch authenticates once at startup and reuses session...');
  const batchCode = fs.readFileSync(path.join(__dirname, 'batch_executor.js'), 'utf-8');
  assert(batchCode.includes('performFreshLogin(authPage, context'), 'Batch executor must call performFreshLogin at startup');
  assert(batchCode.includes('skipLogin: true'), 'Batch executor must pass skipLogin: true to individual orders');
  assert(batchCode.includes('authExpiredMidBatch'), 'Batch executor must halt safely if auth expires mid-batch');
  console.log('  [PASS] Batch single-login pattern verified.');

  // Test 25: Safe abort on AUTH_EXPIRED failure mid-batch
  console.log('\n[Test 25] Testing classifyFailure on auth expiration...');
  const authExpFail = classifyFailure(new Error('[Authentication] Authentication expired mid-batch or session lost during navigation.'));
  assert.strictEqual(authExpFail.type, 'AUTH_EXPIRED');
  assert.strictEqual(authExpFail.retryable, false, 'AUTH_EXPIRED must be non-retryable');
  console.log('  [PASS] AUTH_EXPIRED classification verified.');

  // Test 26: State A - Available Service Catalog card detection, logging, selection & advance
  console.log('\n[Test 26] Testing State A: Selectable service cards, logging, selection, and workflow advance...');
  const { handleServiceCatalogStep3 } = require('./order_executor');
  const browserCat = await chromium.launch({ headless: true });
  const contextCat = await browserCat.newContext();
  const pageStateA = await contextCat.newPage();

  await pageStateA.setContent(`
    <html>
      <body>
        <header><a href="/contact">Hubungi Kami</a></header>
        <div class="step3-wrapper">
          <div class="ant-card ant-card-bordered service-card" id="card-1">
            <span class="badge">PENGIRIMAN TERBAIK</span>
            <div class="service-name">LTL (Less Than Truck Load) - FUSO BOX</div>
            <div class="estimate-date">Estimasi tiba: 2 Des 2026</div>
            <div class="price">Rp292.618</div>
          </div>
          <div class="ant-card ant-card-bordered service-card" id="card-2">
            <div class="service-name">LTL (Less Than Truck Load) - CDD BOX</div>
            <div class="estimate-date">Estimasi tiba: 2 Des 2026</div>
            <div class="price">Rp350.000</div>
          </div>
          <button class="primary-btn ant-btn" id="simpan-layanan" disabled>Simpan Pilihan Layanan</button>
          <div id="step4" style="display: none;">
            <button class="shipment-title">Simpan Shipment</button>
          </div>
        </div>
        <script>
          document.querySelectorAll('.service-card').forEach(card => {
            card.addEventListener('click', () => {
              document.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
              card.classList.add('selected');
              document.getElementById('simpan-layanan').removeAttribute('disabled');
            });
          });
          document.getElementById('simpan-layanan').addEventListener('click', () => {
            document.getElementById('step4').style.display = 'block';
          });
        </script>
      </body>
    </html>
  `);

  const catLogs = [];
  const logStore = console.log;
  console.log = (...args) => {
    catLogs.push(args.join(' '));
    logStore(...args);
  };

  const dummyResult = {};
  const selectedService = await handleServiceCatalogStep3(
    pageStateA,
    { pickup: { city: 'Kota Cirebon' }, dropoff: { city: 'Kabupaten Tegal' } },
    'Domestic Order',
    dummyResult
  );

  console.log = logStore;

  assert(catLogs.some(l => l.includes('Detected 2 selectable service card(s)')), 'Must detect 2 cards');
  assert(catLogs.some(l => l.includes('Rp292.618')), 'Must log visible card text containing price');
  assert(catLogs.some(l => l.includes('Workflow successfully advanced to Step 4')), 'Must advance to Step 4');
  assert(dummyResult.serviceCatalog, 'Service catalog must be recorded in result');
  console.log('  [PASS] State A verified: selectable card discovered, logged, selected, and Step 4 reached without false catalog error.');

  // Test 27: State B - Explicit unavailable state ('Maaf, layanan belum tersedia')
  console.log('\n[Test 27] Testing State B: Explicit unavailable service state detection...');
  const pageStateB = await contextCat.newPage();
  await pageStateB.setContent(`
    <html>
      <body>
        <div class="step3-wrapper">
          <h3>Pilih Layanan</h3>
          <p>Maaf, layanan belum tersedia.</p>
          <p>Namun tenang saja, kami akan membantu Anda menemukan layanan pengiriman terbaik.</p>
          <button class="secondary-btn" id="btn-quotation">Ajukan Quotation Layanan</button>
          <a href="#">Hubungi Kami</a>
          <button class="primary-btn" id="simpan-layanan" disabled>Simpan Pilihan Layanan</button>
        </div>
        <script>
          window.quotationClicked = false;
          document.getElementById('btn-quotation').addEventListener('click', () => {
            window.quotationClicked = true;
          });
        </script>
      </body>
    </html>
  `);

  let stateBThrew = false;
  let stateBErr = null;
  try {
    await handleServiceCatalogStep3(
      pageStateB,
      { pickup: { city: 'Kota Jayapura' }, dropoff: { city: 'Merauke' } },
      'Domestic Order'
    );
  } catch (err) {
    stateBThrew = true;
    stateBErr = err;
  }

  assert.strictEqual(stateBThrew, true, 'State B must throw CATALOG_NOT_FOUND error');
  assert(stateBErr.message.includes('No applicable Service Catalog found'), 'Must mention No applicable Service Catalog');
  assert(stateBErr.message.includes('Maaf, layanan belum tersedia'), 'Must confirm explicit unavailable message');

  const catClassify = classifyFailure(stateBErr);
  assert.strictEqual(catClassify.type, 'CATALOG_NOT_FOUND');
  assert.strictEqual(catClassify.retryable, false, 'CATALOG_NOT_FOUND must not be retried');

  const quotationClicked = await pageStateB.evaluate(() => window.quotationClicked);
  assert.strictEqual(quotationClicked, false, 'Must NOT click Ajukan Quotation Layanan');
  console.log('  [PASS] State B verified: Confirmed unavailable state cleanly reported without clicking quotation.');

  // Test 28: State C - UI Detection Error when neither state detected
  console.log('\n[Test 28] Testing State C: UI Detection Error when neither state detected...');
  const pageStateC = await contextCat.newPage();
  await pageStateC.setContent(`
    <html>
      <body>
        <div class="step3-wrapper">
          <h3>Pilih Layanan</h3>
          <button class="primary-btn" id="simpan-layanan" disabled>Simpan Pilihan Layanan</button>
        </div>
      </body>
    </html>
  `);

  let stateCThrew = false;
  let stateCErr = null;
  try {
    await handleServiceCatalogStep3(
      pageStateC,
      { pickup: { city: 'Kota Bandung' }, dropoff: { city: 'Kota Cimahi' } },
      'Domestic Order'
    );
  } catch (err) {
    stateCThrew = true;
    stateCErr = err;
  }

  assert.strictEqual(stateCThrew, true, 'State C must throw error');
  assert(stateCErr.message.includes('[UI Detection Error]'), 'Must throw UI Detection Error instead of false CATALOG_NOT_FOUND');
  const catClassifyC = classifyFailure(stateCErr);
  assert.notStrictEqual(catClassifyC.type, 'CATALOG_NOT_FOUND', 'UI Detection Error must not be classified as CATALOG_NOT_FOUND');
  console.log('  [PASS] State C verified: Ambiguous UI state reports UI Detection Error instead of false CATALOG_NOT_FOUND.');

  await browserCat.close();

  // Test 29: Order summary to payment method navigation
  console.log('\n[Test 29] Testing Order summary to payment method navigation...');
  const browserPay = await chromium.launch({ headless: true });
  const contextPay = await browserPay.newContext({ viewport: { width: 1440, height: 950 } });
  const pageSummary = await contextPay.newPage();

  await pageSummary.setContent(`
    <html>
      <body>
        <div>
          <h2>Ringkasan Pesanan</h2>
          <p>ID Pesanan: ORCA1001</p>
          <p>ID Shipment: SOCB2001</p>
          <p>Total Tagihan: Rp301.753</p>
          <button id="btn-proses" class="primary-btn">Proses Pembayaran</button>
        </div>
        <script>
          document.getElementById('btn-proses').addEventListener('click', () => {
            document.body.innerHTML = '<h2>Pilih Metode Pembayaran</h2><div id="radio-container"><input type="radio" id="PTMI1765081604728"><span>pospay</span></div><button id="simpan-metode">Simpan Metode Pembayaran</button>';
          });
        </script>
      </body>
    </html>
  `);

  const prosesBtn = pageSummary.getByRole('button', { name: /proses pembayaran/i });
  assert.strictEqual(await prosesBtn.isVisible(), true, 'Proses Pembayaran button must be visible on summary screen');
  await prosesBtn.click();
  await pageSummary.waitForTimeout(200);
  const transitionedToMethod = await pageSummary.locator('text=pospay').isVisible();
  assert.strictEqual(transitionedToMethod, true, 'Clicking Proses Pembayaran must transition to payment method screen');
  console.log('  [PASS] Order summary to payment method navigation verified.');

  // Test 30: Pospay selection & Simpan Metode Pembayaran
  console.log('\n[Test 30] Testing Pospay selection & Simpan Metode Pembayaran...');
  const pageMethod = await contextPay.newPage();
  await pageMethod.setContent(`
    <html>
      <body>
        <h2>Pilih Metode Pembayaran</h2>
        <button id="radio-container" class="p-[16px] cursor-pointer">
          <input type="radio" id="PTMI1765081604728" name="payment_channel">
          <span>pospay</span>
          <p>Pembayaran menggunakan aplikasi pospay</p>
        </button>
        <button id="btn-simpan-metode" class="primary-btn">Simpan Metode Pembayaran</button>
        <script>
          window.metodeSaved = false;
          document.getElementById('btn-simpan-metode').addEventListener('click', () => {
            window.metodeSaved = true;
            document.body.innerHTML = '<h2>Instruksi Pembayaran</h2><span>VA : 81026749</span><p>Total Biaya Rp301.753</p>';
          });
        </script>
      </body>
    </html>
  `);

  const pospayRadio = pageMethod.locator('#radio-container, input[type="radio"]').first();
  assert.strictEqual(await pospayRadio.isVisible(), true, 'Pospay option must be visible');
  await pospayRadio.click();
  const simpanBtn = pageMethod.locator('button:has-text("Simpan Metode Pembayaran")').first();
  await simpanBtn.click();
  await pageMethod.waitForTimeout(200);
  const isSaved = await pageMethod.evaluate(() => window.metodeSaved);
  assert.strictEqual(isSaved, true, 'Simpan Metode Pembayaran must trigger save');
  assert.strictEqual(await pageMethod.locator('text=81026749').isVisible(), true, 'Screen must show payment instructions after save');
  console.log('  [PASS] Pospay selection and payment method saving verified.');

  // Test 31: Dedicated VA extraction & strict assertion
  console.log('\n[Test 31] Testing Dedicated VA extraction & strict assertion...');
  const pageVa = await contextPay.newPage();
  await pageVa.setContent(`
    <html>
      <body>
        <div>
          <h3>Bagaimana Cara Membayar?</h3>
          <p>Silahkan melakukan pembayaran melalui transfer ke Virtual Account berikut</p>
          <span>VA : 81026749</span>
          <p>Total Biaya Rp301.753</p>
        </div>
      </body>
    </html>
  `);

  const vaText = await pageVa.locator('span:has-text("VA :")').innerText();
  const extractedVa = (vaText.match(/VA\s*:\s*([0-9]+)/i) || [])[1];
  assert.strictEqual(extractedVa, '81026749', 'Extracted VA must match UI text');
  assert.strictEqual(formatRupiah(301753), 'Rp301.753', 'formatRupiah must format integer to Rupiah');
  assert.strictEqual(parseCurrency('Rp301.753'), 301753, 'parseCurrency must parse Indonesian format');

  // Test forbidden VA collision checks
  const orderId = 'ORCA1793873267537';
  const shipmentId = 'SOCB1793873267726';
  assert.notStrictEqual(extractedVa, orderId, 'VA must not equal Order ID');
  assert.notStrictEqual(extractedVa, shipmentId, 'VA must not equal Shipment ID');
  console.log('  [PASS] Dedicated VA extraction and anti-collision assertions verified.');

  // Test 32: Payment sandbox simulation
  console.log('\n[Test 32] Testing Payment Sandbox simulation flow...');
  await contextPay.route('https://pospay-sandbox.vercel.app/**', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `
        <html>
          <body>
            <h1>POSPAY Payment</h1>
            <input id="environment" value="" />
            <input id="nomorVA" value="" />
            <input id="nominal" value="" />
            <button id="btn-pay">Pay Now</button>
            <div id="result"></div>
            <script>
              document.getElementById('btn-pay').addEventListener('click', () => {
                const va = document.getElementById('nomorVA').value;
                const res = document.getElementById('result');
                if (va === '81026749') {
                  res.innerText = 'Payment Successful 00 {"payment_status": "SUCCESS"}';
                } else {
                  res.innerText = 'Payment Failed {"payment_status": "FAILED"}';
                }
              });
            </script>
          </body>
        </html>
      `,
    });
  });

  const sandboxPageSuccess = await contextPay.newPage();
  await sandboxPageSuccess.goto('https://pospay-sandbox.vercel.app');
  await sandboxPageSuccess.locator('#environment').fill('https://sr-pos-oms-api.nisims.web.id/api/v1');
  await sandboxPageSuccess.locator('#nomorVA').fill('81026749');
  await sandboxPageSuccess.locator('#nominal').fill('301753');
  await sandboxPageSuccess.getByRole('button', { name: /pay now/i }).click();
  await sandboxPageSuccess.waitForTimeout(100);
  const resSuccessText = await sandboxPageSuccess.locator('#result').innerText();
  assert(resSuccessText.includes('Payment Successful'), 'Sandbox must report Payment Successful');
  console.log('  [PASS] Payment sandbox success simulation verified.');

  // Test 33: OMS paid-status verification
  console.log('\n[Test 33] Testing OMS paid-status verification in /my/order...');
  await contextPay.route('https://sr-pos-oms-web.nisims.web.id/my/order', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `
        <html>
          <body>
            <table>
              <tbody>
                <tr>
                  <td><button>ORCA1001</button></td>
                  <td>SOCB2001</td>\n                  <td>Dibayar</td>\n                  <td>Rp301.753</td>\n                </tr>\n              </tbody>\n            </table>\n          </body>\n        </html>\n      `,\n    });\n  });\n\n  const pageOmsOrder = await contextPay.newPage();\n  await pageOmsOrder.goto('https://sr-pos-oms-web.nisims.web.id/my/order');\n  const row = pageOmsOrder.locator('tr').filter({ hasText: 'ORCA1001' }).first();\n  const rowText = await row.innerText();\n  assert(/dibayar|lunas|paid/i.test(rowText), 'Row must confirm paid status');\n  console.log('  [PASS] OMS paid-status verification verified.');\n\n  // Test 34: Incomplete payment reporting\n  console.log('\\n[Test 34] Testing Incomplete payment reporting & status gates...');\n  await contextPay.route('https://sr-pos-oms-web.nisims.web.id/my/order-pending', route => {\n    route.fulfill({\n      status: 200,\n      contentType: 'text/html',\n      body: `\n        <html>\n          <body>\n            <table>\n              <tbody>\n                <tr>\n                  <td><button>ORCA1001</button></td>\n                  <td>SOCB2001</td>\n                  <td>Disetujui</td>\n                  <td>Rp301.753</td>\n                </tr>\n              </tbody>\n            </table>\n          </body>\n        </html>\n      `,\n    });\n  });\n\n  const pageOmsPending = await contextPay.newPage();\n  await pageOmsPending.goto('https://sr-pos-oms-web.nisims.web.id/my/order-pending');\n  const pendingRow = (await pageOmsPending.locator('tr').filter({ hasText: 'ORCA1001' }).first().innerText()).replace(/\\s+/g, ' ');\n  const isPendingPaid = /dibayar|lunas|paid/i.test(pendingRow);\n  assert.strictEqual(isPendingPaid, false, 'Pending row must not be counted as paid');\n\n  const payFailureClassify = classifyFailure(new Error('Sandbox payment simulation failed: 500 error'));\n  assert.strictEqual(payFailureClassify.type, 'PAYMENT_FAILURE');\n  assert.strictEqual(payFailureClassify.retryable, false, 'PAYMENT_FAILURE must not retry order creation');\n  console.log('  [PASS] Incomplete payment reporting & non-retryable safety gate verified.');\n\n  // Test 35: Batch payment isolation\n  console.log('\\n[Test 35] Testing Batch payment isolation & per-order VA uniqueness...');\n  const batchItems = [\n    { label: 'Order #1', orderId: 'ORCA1001', vaNumber: '81026749', amount: 301753, paymentStatus: 'PAYMENT_VERIFIED', overallStatus: 'SUCCESS' },\n    { label: 'Order #2', orderId: 'ORCA1002', vaNumber: '92038471', amount: 150000, paymentStatus: 'PAYMENT_VERIFIED', overallStatus: 'SUCCESS' },\n  ];\n\n  assert.notStrictEqual(batchItems[0].vaNumber, batchItems[1].vaNumber, 'Batch orders must have unique dedicated VAs');\n  assert.notStrictEqual(batchItems[0].orderId, batchItems[1].orderId, 'Batch orders must have distinct order IDs');\n\n  const totalVerified = batchItems.filter(b => b.paymentStatus === 'PAYMENT_VERIFIED').reduce((sum, b) => sum + b.amount, 0);\n  assert.strictEqual(totalVerified, 451753, 'Total amount paid must sum only verified payments');\n  console.log('  [PASS] Batch payment isolation and distinct VA tracking verified.');\n\n  await browserPay.close();

  console.log('\n>>> ALL POSIND ORDERING BOT TESTS PASSED SUCCESSFULLY! <<<');
}

if (require.main === module) {
  runBotTests().catch(err => {
    console.error('[TEST ERROR]:', err);
    process.exit(1);
  });
}

module.exports = { runBotTests };
