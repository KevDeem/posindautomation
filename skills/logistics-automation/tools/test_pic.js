/**
 * Unit Test Suite for PIC Generation, Selection & Library Management
 * Covers:
 * 1. Multi-country PIC Library loading & consistency (ID, SG, MY).
 * 2. Randomized PIC selection from existing library for pickup & drop-off.
 * 3. Pickup vs Drop-off uniqueness assertion.
 * 4. Consecutive order PIC variance.
 * 5. Strict user override preservation (partial & full).
 * 6. Non-inheritance rule for new orders (no blind reuse without explicit reusePic/isEdit).
 * 7. Empty library fallback: automatic synthetic generation, validation & auto-persistence.
 * 8. International location-aware selection (Indonesia -> Singapore +65, Indonesia -> Malaysia +60).
 * 9. Review table badge verification ([Provided], [Reused], [Randomized from Library], [Generated Synthetic]).
 * 10. Batch order PIC variance across items.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  getPicLibrary,
  setPicLibrary,
  resetPicLibrary,
  selectRandomPIC,
  generateRealisticPIC,
  validatePIC,
  normalizeCountry,
  DEFAULT_PIC_LIBRARY,
} = require('./pic_manager');
const {
  resolveSpecification,
  savePreviousSpecification,
  formatSpecificationReview,
} = require('./order_specification');
const { normalizeBatchInput } = require('./batch_executor');

async function runPicTests() {
  console.log('=== Starting PIC Management & Selection Unit Tests ===\\n');

  // Reset library to clean baseline
  resetPicLibrary(false);

  // [Test 1] Library Inspection & Data Integrity
  console.log('[Test 1] Testing PIC library loading, country distribution & field consistency...');
  const library = getPicLibrary();
  assert(Array.isArray(library) && library.length >= 20, 'Library should contain at least 20 pre-seeded profiles');
  
  const idEntries = library.filter(e => e.countryCode === 'ID');
  const sgEntries = library.filter(e => e.countryCode === 'SG');
  const myEntries = library.filter(e => e.countryCode === 'MY');

  assert(idEntries.length >= 10, 'Should have at least 10 Indonesia profiles');
  assert(sgEntries.length >= 5, 'Should have at least 5 Singapore profiles');
  assert(myEntries.length >= 5, 'Should have at least 5 Malaysia profiles');

  for (const entry of library) {
    assert.strictEqual(validatePIC(entry), null, `Entry ${entry.name} must have all mandatory contact fields`);
    assert(entry.email.endsWith('@example.com'), `Email ${entry.email} must use safe reserved domain @example.com`);
    assert(entry.country && entry.countryCode && entry.phoneCountryCode, `Country metadata must be complete for ${entry.name}`);
    if (entry.countryCode === 'ID') {
      assert(entry.phone.startsWith('08') || entry.phone.startsWith('+62'), `ID phone should start with 08 or +62: ${entry.phone}`);
    } else if (entry.countryCode === 'SG') {
      assert(entry.phone.startsWith('+65'), `SG phone must start with +65: ${entry.phone}`);
    } else if (entry.countryCode === 'MY') {
      assert(entry.phone.startsWith('+60'), `MY phone must start with +60: ${entry.phone}`);
    }
  }
  console.log(`  [PASS] PIC library verified with ${library.length} consistent records across ID, SG, and MY.`);

  // [Test 2] Randomized PIC Selection: Pickup != Drop-off & Internal Consistency
  console.log('\\n[Test 2] Testing randomized PIC selection for new order (pickup != drop-off)...');
  const specRes1 = resolveSpecification({
    pickup: { city: 'Jakarta Selatan' },
    dropoff: { city: 'Kota Surabaya' },
  });

  const p1 = specRes1.resolvedSpec.pickup.pic;
  const d1 = specRes1.resolvedSpec.dropoff.pic;
  assert(p1.name, 'Pickup PIC name must be present');
  assert(d1.name, 'Dropoff PIC name must be present');
  assert.notStrictEqual(p1.name, d1.name, 'Pickup PIC and Dropoff PIC must NOT be identical');
  assert.notStrictEqual(p1.phone, d1.phone, 'Pickup phone and Dropoff phone must NOT be identical');
  
  // Verify internal consistency: attributes come from the same library record
  const matchingLibPickup = library.find(e => e.name === p1.name);
  assert(matchingLibPickup, 'Pickup PIC must match a library entry');
  assert.strictEqual(p1.company, matchingLibPickup.company, 'Company must be consistent with library record');
  assert.strictEqual(p1.email, matchingLibPickup.email, 'Email must be consistent with library record');
  assert.strictEqual(p1.phone, matchingLibPickup.phone, 'Phone must be consistent with library record');

  // Verify origin tags
  assert.strictEqual(specRes1.sources.pickup.pic.name, 'library_random');
  assert.strictEqual(specRes1.sources.dropoff.pic.name, 'library_random');
  console.log(`  [PASS] Pickup (${p1.name} / ${p1.company}) != Dropoff (${d1.name} / ${d1.company}) verified.`);

  // [Test 3] Consecutive Order Variance (avoid repeating same PIC repeatedly)
  console.log('\\n[Test 3] Testing consecutive order variety...');
  const pickupNames = [];
  for (let i = 0; i < 5; i++) {
    const res = resolveSpecification({
      pickup: { city: 'Jakarta Selatan' },
      dropoff: { city: 'Kota Surabaya' },
    });
    pickupNames.push(res.resolvedSpec.pickup.pic.name);
  }
  const uniquePickups = new Set(pickupNames);
  console.log('  -> 5 consecutive pickup PICs resolved:', pickupNames.join(', '));
  assert(uniquePickups.size >= 3, `Expected at least 3 distinct PICs across 5 consecutive orders, got ${uniquePickups.size}`);
  console.log('  [PASS] Consecutive order variety verified.');

  // [Test 4] User Overrides: Full & Partial Overrides strictly respected
  console.log('\\n[Test 4] Testing user overrides (partial and full)...');
  const customSpec = resolveSpecification({
    pickup: {
      pic: {
        name: 'Custom User Budi',
        company: 'PT Custom Mandiri',
        phone: '0899999999',
        email: 'custom.budi@example.com',
        address: 'Jl. Custom No. 1',
      }
    },
    dropoff: {
      pic: {
        name: 'Custom Dropoff Siti',
        // Unspecified company, phone, email should be filled from library
      }
    }
  });

  // Pickup was fully provided
  assert.strictEqual(customSpec.resolvedSpec.pickup.pic.name, 'Custom User Budi');
  assert.strictEqual(customSpec.resolvedSpec.pickup.pic.company, 'PT Custom Mandiri');
  assert.strictEqual(customSpec.sources.pickup.pic.name, 'provided');
  assert.strictEqual(customSpec.sources.pickup.pic.company, 'provided');
  assert.strictEqual(customSpec.sources.pickup.pic.phone, 'provided');

  // Dropoff was partially provided (only name provided, other fields from library)
  assert.strictEqual(customSpec.resolvedSpec.dropoff.pic.name, 'Custom Dropoff Siti');
  assert.strictEqual(customSpec.sources.dropoff.pic.name, 'provided');
  assert(customSpec.resolvedSpec.dropoff.pic.company, 'Unspecified dropoff company must be populated from library');
  assert(customSpec.resolvedSpec.dropoff.pic.phone, 'Unspecified dropoff phone must be populated from library');
  assert.strictEqual(customSpec.sources.dropoff.pic.company, 'library_random');
  console.log('  [PASS] User overrides strictly preserved and unspecified fields filled.');

  // [Test 5] Non-Inheritance on New Orders vs Explicit Reuse
  console.log('\\n[Test 5] Testing non-inheritance rule on new orders vs explicit reuse...');
  // Save an order specification to simulate baseline
  savePreviousSpecification({
    pickup: {
      city: 'Jakarta Selatan',
      pic: { name: 'Previous Static PIC', company: 'Previous Co', address: 'Tebet', email: 'prev@example.com', phone: '08123456789' }
    },
    dropoff: {
      city: 'Kota Surabaya',
      pic: { name: 'Previous Dropoff PIC', company: 'Prev Drop Co', address: 'Gubeng', email: 'prevd@example.com', phone: '08987654321' }
    }
  });

  // New order WITHOUT reusePic: MUST NOT inherit 'Previous Static PIC'
  const newOrderSpec = resolveSpecification({
    pickup: { city: 'Jakarta Selatan' },
    dropoff: { city: 'Kota Surabaya' },
  });
  assert.notStrictEqual(newOrderSpec.resolvedSpec.pickup.pic.name, 'Previous Static PIC', 'New order must NOT blindly inherit previous PIC');
  assert.strictEqual(newOrderSpec.sources.pickup.pic.name, 'library_random');

  // Explicit reuse request: MUST reuse previous PIC
  const reusedSpec = resolveSpecification({}, { reusePic: true });
  assert.strictEqual(reusedSpec.resolvedSpec.pickup.pic.name, 'Previous Static PIC', 'Explicit reuse must preserve previous PIC');
  assert.strictEqual(reusedSpec.sources.pickup.pic.name, 'reused');
  console.log('  [PASS] Non-inheritance for new orders and explicit reuse verified.');

  // [Test 6] Automatic Synthetic Fallback & Auto-persistence on Empty Library
  console.log('\\n[Test 6] Testing empty library fallback (synthetic generation + auto-persistence)...');
  // Temporarily set library to empty
  setPicLibrary([], false);
  assert.strictEqual(getPicLibrary().length, 0, 'Library should be empty');

  const fallbackRes = resolveSpecification({
    pickup: { city: 'Jakarta Selatan' },
    dropoff: { city: 'Kota Surabaya' },
  });

  // Should have generated synthetic PICs
  assert(fallbackRes.resolvedSpec.pickup.pic.name, 'Generated pickup PIC name must be present');
  assert.strictEqual(fallbackRes.sources.pickup.pic.name, 'generated');
  assert.strictEqual(fallbackRes.sources.dropoff.pic.name, 'generated');
  assert.strictEqual(validatePIC(fallbackRes.resolvedSpec.pickup.pic), null, 'Generated PIC must be completely valid');

  // Verify auto-persisted into library
  const currentLib = getPicLibrary();
  assert(currentLib.length >= 2, `Generated PICs should be saved to library, got ${currentLib.length}`);
  console.log(`  [PASS] Empty library fallback generated valid PICs and auto-saved to library (${currentLib.length} entries).`);

  // Restore clean default library
  resetPicLibrary(false);

  // [Test 7] International Location-Aware Selection (Singapore & Malaysia)
  console.log('\\n[Test 7] Testing international location-aware selection (SG & MY)...');
  // Singapore Dropoff
  const intlSG = resolveSpecification({
    orderType: 'international',
    pickup: { country: 'Indonesia', city: 'Jakarta Selatan' },
    dropoff: { country: 'Singapore', city: 'Singapore' },
  });
  assert.strictEqual(intlSG.resolvedSpec.pickup.pic.phoneCountryCode, '+62');
  assert.strictEqual(intlSG.resolvedSpec.dropoff.pic.phoneCountryCode, '+65');
  assert(intlSG.resolvedSpec.dropoff.pic.phone.startsWith('+65'), `SG phone must start with +65: ${intlSG.resolvedSpec.dropoff.pic.phone}`);

  // Malaysia Dropoff
  const intlMY = resolveSpecification({
    orderType: 'international',
    pickup: { country: 'Indonesia', city: 'Jakarta Selatan' },
    dropoff: { country: 'Malaysia', city: 'Kuala Lumpur' },
  });
  assert.strictEqual(intlMY.resolvedSpec.pickup.pic.phoneCountryCode, '+62');
  assert.strictEqual(intlMY.resolvedSpec.dropoff.pic.phoneCountryCode, '+60');
  assert(intlMY.resolvedSpec.dropoff.pic.phone.startsWith('+60'), `MY phone must start with +60: ${intlMY.resolvedSpec.dropoff.pic.phone}`);
  console.log('  [PASS] Location-aware international selection verified (SG: +65, MY: +60).');

  // [Test 8] Specification Review Table Badges
  console.log('\\n[Test 8] Testing specification review table badges...');
  const review1 = formatSpecificationReview(newOrderSpec.resolvedSpec, newOrderSpec.sources);
  assert(review1.includes('[Randomized from Library]'), 'Review table must include [Randomized from Library]');

  const review2 = formatSpecificationReview(reusedSpec.resolvedSpec, reusedSpec.sources);
  assert(review2.includes('[Reused]'), 'Review table must include [Reused]');

  const review3 = formatSpecificationReview(customSpec.resolvedSpec, customSpec.sources);
  assert(review3.includes('[Provided]'), 'Review table must include [Provided]');

  const review4 = formatSpecificationReview(fallbackRes.resolvedSpec, fallbackRes.sources);
  assert(review4.includes('[Generated Synthetic]'), 'Review table must include [Generated Synthetic]');
  console.log('  [PASS] All 4 Origin Status badges verified in specification review.');

  // [Test 9] Batch Orders PIC Variance Across Items
  console.log('\\n[Test 9] Testing batch order PIC variance across items...');
  const batchItems = normalizeBatchInput({
    specification: {
      pickup: { city: 'Jakarta Selatan' },
      dropoff: { city: 'Kota Surabaya' },
    },
    count: 4,
  });

  assert.strictEqual(batchItems.length, 4);
  const resolvedBatchPics = [];
  for (const item of batchItems) {
    const r = resolveSpecification(item.spec);
    resolvedBatchPics.push({
      pickup: r.resolvedSpec.pickup.pic.name,
      dropoff: r.resolvedSpec.dropoff.pic.name,
    });
  }

  console.log('  Batch PICs resolved:');
  resolvedBatchPics.forEach((b, idx) => {
    console.log(`    Order #${idx + 1}: Pickup=${b.pickup} | Dropoff=${b.dropoff}`);
    assert.notStrictEqual(b.pickup, b.dropoff, `Order #${idx + 1} pickup and dropoff must be distinct`);
  });

  const batchPickupNames = new Set(resolvedBatchPics.map(b => b.pickup));
  assert(batchPickupNames.size >= 2, 'Batch orders must vary pickup PICs across items');
  console.log('  [PASS] Batch PIC variance across orders verified.');

  console.log('\\n>>> ALL 9 PIC UNIT TESTS PASSED SUCCESSFULLY! <<<');
}

if (require.main === module) {
  runPicTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { runPicTests };
