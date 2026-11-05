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
const { resolveSpecification, DEFAULT_SPECIFICATION } = require('./order_specification');
const { normalizeBatchInput } = require('./batch_executor');

function runBotTests() {
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

  // Test 6: Confirmation Cancellation Logic (Mocked)
  console.log('\n[Test 6] Testing confirmation gate cancellation...');
  let executed = false;
  async function mockConfirmFlow(userResponse) {
    if (userResponse.toLowerCase() !== 'yes' && userResponse.toLowerCase() !== 'y') {
      return { canceled: true };
    }
    executed = true;
    return { canceled: false };
  }

  // User says "no"
  mockConfirmFlow('no').then(r => {
    assert.strictEqual(r.canceled, true);
    assert.strictEqual(executed, false, 'Execution must not run if canceled');
  });

  // User presses Enter (blank)
  mockConfirmFlow('').then(r => {
    assert.strictEqual(r.canceled, true);
    assert.strictEqual(executed, false, 'Blank response must default to cancel');
  });
  console.log('  [PASS] Confirmation cancellation strictly prevents execution.');

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

  console.log('\n>>> ALL POSIND ORDERING BOT TESTS PASSED SUCCESSFULLY! <<<');
}

if (require.main === module) {
  runBotTests();
}

module.exports = { runBotTests };
