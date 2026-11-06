/**
 * Verification test for dynamic specification parsing, granular reuse,
 * and independent PIC generation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  resolveSpecification,
  savePreviousSpecification,
  loadPreviousSpecification,
  formatSpecificationReview,
  DEFAULT_SPECIFICATION,
  PREV_SPEC_FILE,
} = require('./order_specification');
const { generateRealisticPIC, validatePIC } = require('./pic_manager');

function runTests() {
  console.log('=== Starting Order Specification Engine Unit Tests ===\n');

  // 1. Test PIC generation
  console.log('[Test 1] Testing realistic synthetic PIC generation...');
  const pic1 = generateRealisticPIC({ type: 'pickup', city: 'Bekasi' });
  assert(pic1.name, 'PIC name should be present');
  assert(pic1.company, 'PIC company should be present');
  assert(pic1.email.endsWith('@example.com'), 'PIC email must use example.com');
  assert(pic1.phone.startsWith('08'), 'Indonesian phone should start with 08');
  assert.strictEqual(validatePIC(pic1), null, 'Generated PIC must be completely valid');
  console.log('  -> Generated Sample Pickup PIC:', pic1.name, `(${pic1.company})`, pic1.email, pic1.phone);
  console.log('  [PASS] Realistic PIC generation verified.');

  // 2. Test Baseline Resolution against clean DEFAULT_SPECIFICATION
  console.log('\n[Test 2] Testing baseline specification resolution...');
  const res1 = resolveSpecification({}, { previousSpec: DEFAULT_SPECIFICATION });
  assert.strictEqual(res1.resolvedSpec.pickup.city, 'Jakarta Selatan');
  assert.strictEqual(res1.sources.pickup.city, 'reused');
  assert.strictEqual(res1.missingMandatory.length, 0);
  console.log('  [PASS] Default specification resolution verified.');

  // 3. Test Partial Update: Changing only Pickup city
  console.log('\n[Test 3] Testing partial update: change only Pickup to Bekasi...');
  const res2 = resolveSpecification({
    pickup: {
      city: 'Kota Bekasi',
      province: 'Jawa Barat',
      district: 'Bekasi Barat',
      address: 'Jl. Ahmad Yani No. 12',
    }
  }, { previousSpec: DEFAULT_SPECIFICATION });
  // Pickup should be provided
  assert.strictEqual(res2.resolvedSpec.pickup.city, 'Kota Bekasi');
  assert.strictEqual(res2.sources.pickup.city, 'provided');
  assert.strictEqual(res2.sources.pickup.address, 'provided');
  // Drop-off must remain completely preserved from previous specification
  assert.strictEqual(res2.resolvedSpec.dropoff.city, 'Kota Surabaya');
  assert.strictEqual(res2.sources.dropoff.city, 'reused');
  assert.strictEqual(res2.resolvedSpec.dropoff.pic.name, 'Aldin');
  assert.strictEqual(res2.sources.dropoff.pic.name, 'reused');
  console.log('  [PASS] Changing pickup did not affect drop-off.');

  // 4. Test Partial Update: Changing only Dropoff PIC
  console.log('\n[Test 4] Testing partial update: change only Drop-off PIC...');
  const res3 = resolveSpecification({
    dropoff: {
      pic: {
        name: 'Budi Santoso',
        phone: '081234998877',
      }
    }
  }, { previousSpec: DEFAULT_SPECIFICATION });
  assert.strictEqual(res3.resolvedSpec.dropoff.pic.name, 'Budi Santoso');
  assert.strictEqual(res3.sources.dropoff.pic.name, 'provided');
  assert.strictEqual(res3.sources.dropoff.pic.phone, 'provided');
  // Dropoff city remains reused
  assert.strictEqual(res3.resolvedSpec.dropoff.city, 'Kota Surabaya');
  assert.strictEqual(res3.sources.dropoff.city, 'reused');
  // Pickup PIC remains reused
  assert.strictEqual(res3.resolvedSpec.pickup.pic.name, 'Kevin');
  assert.strictEqual(res3.sources.pickup.pic.name, 'reused');
  console.log('  [PASS] Changing drop-off PIC did not affect pickup PIC.');

  // 5. Test Dynamic PIC Generation request
  console.log('\n[Test 5] Testing synthetic PIC generation request...');
  const res4 = resolveSpecification({}, { generatePickupPic: true, generateDropoffPic: true, previousSpec: DEFAULT_SPECIFICATION });
  assert.strictEqual(res4.sources.pickup.pic.name, 'generated');
  assert.strictEqual(res4.sources.dropoff.pic.name, 'generated');
  assert(res4.resolvedSpec.pickup.pic.name !== 'Kevin', 'Generated name should differ from static default');
  assert(res4.resolvedSpec.dropoff.pic.name !== 'Aldin', 'Generated name should differ from static default');
  assert(res4.resolvedSpec.pickup.pic.email.endsWith('@example.com'));
  console.log('  -> Generated Pickup PIC:', res4.resolvedSpec.pickup.pic.name, res4.resolvedSpec.pickup.pic.phone);
  console.log('  -> Generated Drop-off PIC:', res4.resolvedSpec.dropoff.pic.name, res4.resolvedSpec.dropoff.pic.phone);
  console.log('  [PASS] Synthetic PIC generation option verified.');

  // 6. Test Review Table Formatting
  console.log('\n[Test 6] Testing specification review table rendering...');
  const reviewTable = formatSpecificationReview(res2.resolvedSpec, res2.sources);
  assert(reviewTable.includes('Kota Bekasi'), 'Review table must include updated pickup city');
  assert(reviewTable.includes('[Provided]'), 'Review table must flag provided fields');
  assert(reviewTable.includes('[Reused]'), 'Review table must flag reused fields');
  console.log('  Review table snippet:\n' + reviewTable.split('\n').slice(0, 8).join('\n'));
  console.log('  [PASS] Review formatting verified.');

  console.log('\n>>> ALL 6 SPECIFICATION TESTS PASSED SUCCESSFULLY! <<<');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
