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
  isAdministrativeOnly,
  generateSyntheticStreetAddress,
  determineDomesticTransportPreference,
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

  // 7. Test Street Address Generation and Administrative-only Detection
  console.log('\n[Test 7] Testing realistic street address generation & administrative-only detection...');
  assert.strictEqual(isAdministrativeOnly('Tebet', 'Jakarta Selatan', 'Tebet', 'DKI Jakarta', 'Indonesia'), true);
  assert.strictEqual(isAdministrativeOnly('Kabupaten Tangerang', 'Kabupaten Tangerang', '', 'Banten', 'Indonesia'), true);
  assert.strictEqual(isAdministrativeOnly('Jl. Logistik Simulasi No. 15, RT 02/RW 04', 'Jakarta Selatan', 'Tebet', 'DKI Jakarta', 'Indonesia'), false);
  assert.strictEqual(isAdministrativeOnly('10 Orchard Road, #05-12, Singapore 238841', 'Singapore', 'Orchard', '', 'Singapore'), false);

  const syntheticId = generateSyntheticStreetAddress({ country: 'Indonesia', city: 'Jakarta Selatan', district: 'Tebet', isPickup: true });
  assert(/(Jl\.|Komplek|Ruko|Kawasan).*No\..*RT.*RW/i.test(syntheticId), 'Synthetic ID address must contain street and RT/RW');

  const syntheticSg = generateSyntheticStreetAddress({ country: 'Singapore', city: 'Singapore', district: 'Orchard', isPickup: false });
  assert(syntheticSg.includes('Orchard Road') || syntheticSg.includes('Singapore'), 'Synthetic SG address must contain realistic street');

  // Verify resolveSpecification upgrades administrative-only input to street address
  const specWithAdmin = resolveSpecification({
    pickup: { country: 'Indonesia', city: 'Jakarta Selatan', district: 'Tebet', address: 'Tebet' },
    dropoff: { country: 'Singapore', city: 'Singapore', district: 'Orchard', address: 'Orchard' },
  }, { previousSpec: DEFAULT_SPECIFICATION });

  assert(/(Jl\.|Komplek|Ruko|Kawasan)/i.test(specWithAdmin.resolvedSpec.pickup.address), 'Pickup address must be upgraded to street address');
  assert(!isAdministrativeOnly(specWithAdmin.resolvedSpec.pickup.address, 'Jakarta Selatan', 'Tebet', 'DKI Jakarta', 'Indonesia'));
  assert(!isAdministrativeOnly(specWithAdmin.resolvedSpec.dropoff.address, 'Singapore', 'Orchard', '', 'Singapore'));
  console.log('  [PASS] Realistic street address generation and administrative address upgrade verified.');

  // 8. Test Domestic Transport Preference Selection Rules
  console.log('\n[Test 8] Testing Domestic transport preference selection rules across all scenarios...');

  // 1. Door -> Door, land only -> DARAT
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Door', city: 'Jakarta Selatan', province: 'DKI Jakarta' },
      dropoff: { locationType: 'Door', city: 'Kota Surabaya', province: 'Jawa Timur' },
      transportInstructions: 'Door to Door land transportation only',
    }),
    'DARAT',
    'Scenario 1: Door -> Door land only must select DARAT'
  );

  // 2. Port -> Port -> LAUT
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Port', city: 'Jakarta Utara', address: 'Tanjung Priok' },
      dropoff: { locationType: 'Port', city: 'Kota Surabaya', address: 'Tanjung Perak' },
    }),
    'LAUT',
    'Scenario 2: Port -> Port must ALWAYS select LAUT'
  );

  // 3. Airport -> Airport -> UDARA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Airport', city: 'Kota Tangerang', address: 'Bandara Soekarno-Hatta' },
      dropoff: { locationType: 'Airport', city: 'Sidoarjo', address: 'Bandara Juanda' },
    }),
    'UDARA',
    'Scenario 3: Airport -> Airport must ALWAYS select UDARA'
  );

  // 4. Door -> Port -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Door', city: 'Jakarta Selatan' },
      dropoff: { locationType: 'Port', city: 'Kota Surabaya', address: 'Pelabuhan Tanjung Perak' },
    }),
    'SEMUA',
    'Scenario 4: Door -> Port must select SEMUA'
  );

  // 5. Port -> Door -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Port', city: 'Jakarta Utara', address: 'Pelabuhan Tanjung Priok' },
      dropoff: { locationType: 'Door', city: 'Kota Surabaya' },
    }),
    'SEMUA',
    'Scenario 5: Port -> Door must select SEMUA'
  );

  // 6. Airport -> Door -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Airport', city: 'Kota Tangerang', address: 'Bandara Soekarno-Hatta' },
      dropoff: { locationType: 'Door', city: 'Kota Bandung' },
    }),
    'SEMUA',
    'Scenario 6: Airport -> Door must select SEMUA'
  );

  // 7. Door -> Airport -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Door', city: 'Jakarta Selatan' },
      dropoff: { locationType: 'Airport', city: 'Sidoarjo', address: 'Bandara Juanda' },
    }),
    'SEMUA',
    'Scenario 7: Door -> Airport must select SEMUA'
  );

  // 8. Port -> Airport -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Port', city: 'Jakarta Utara', address: 'Pelabuhan Tanjung Priok' },
      dropoff: { locationType: 'Airport', city: 'Sidoarjo', address: 'Bandara Juanda' },
    }),
    'SEMUA',
    'Scenario 8: Port -> Airport must select SEMUA'
  );

  // 9. Airport -> Port -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Airport', city: 'Kota Tangerang', address: 'Bandara Soekarno-Hatta' },
      dropoff: { locationType: 'Port', city: 'Kota Surabaya', address: 'Pelabuhan Tanjung Perak' },
    }),
    'SEMUA',
    'Scenario 9: Airport -> Port must select SEMUA'
  );

  // 10. Jakarta -> Bali, Door -> Door, land + sea -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Door', city: 'Jakarta Selatan', province: 'DKI Jakarta' },
      dropoff: { locationType: 'Door', city: 'Denpasar', province: 'Bali' },
      transportInstructions: 'Jakarta to Bali Door to Door land and sea',
    }),
    'SEMUA',
    'Scenario 10: Jakarta -> Bali (cross-island land+sea) must select SEMUA'
  );

  // 11. Jakarta -> Makassar, Door -> Door, land + air -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Door', city: 'Jakarta Selatan', province: 'DKI Jakarta' },
      dropoff: { locationType: 'Door', city: 'Kota Makassar', province: 'Sulawesi Selatan' },
      transportInstructions: 'Jakarta to Makassar Door to Door land and air',
    }),
    'SEMUA',
    'Scenario 11: Jakarta -> Makassar (cross-island land+air) must select SEMUA'
  );

  // 12. International Door -> Door, air freight -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'international',
      pickup: { locationType: 'Door', country: 'Indonesia', city: 'Jakarta' },
      dropoff: { locationType: 'Door', country: 'Singapore', city: 'Singapore' },
      transportationMode: 'Air',
      serviceType: 'Cargo',
    }),
    'SEMUA',
    'Scenario 12: International Door -> Door air freight must select SEMUA'
  );

  // 13. International Door -> Door, sea freight -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'international',
      pickup: { locationType: 'Door', country: 'Indonesia', city: 'Jakarta' },
      dropoff: { locationType: 'Door', country: 'Singapore', city: 'Singapore' },
      transportationMode: 'Sea Freight',
      serviceType: 'FCL',
    }),
    'SEMUA',
    'Scenario 13: International Door -> Door sea freight must select SEMUA'
  );

  // 14. Mixed land, sea, and air shipment -> SEMUA
  assert.strictEqual(
    determineDomesticTransportPreference({
      orderType: 'domestic',
      pickup: { locationType: 'Door', city: 'Jakarta Selatan' },
      dropoff: { locationType: 'Door', city: 'Kota Surabaya' },
      transportInstructions: 'Mixed land, sea, and air shipment',
    }),
    'SEMUA',
    'Scenario 14: Mixed land, sea, and air shipment must select SEMUA'
  );

  // 15. Verify resolveSpecification integrates determineDomesticTransportPreference
  const specResDarat = resolveSpecification({
    orderType: 'domestic',
    pickup: { city: 'Jakarta Selatan', province: 'DKI Jakarta' },
    dropoff: { city: 'Kota Surabaya', province: 'Jawa Timur' },
  }, { previousSpec: DEFAULT_SPECIFICATION });
  assert.strictEqual(specResDarat.resolvedSpec.transportationMode, 'DARAT', 'Domestic Java-to-Java Door-to-Door must resolve to DARAT');

  const specResLaut = resolveSpecification({
    orderType: 'domestic',
    pickup: { locationType: 'Port', city: 'Jakarta Utara', address: 'Tanjung Priok' },
    dropoff: { locationType: 'Port', city: 'Surabaya', address: 'Tanjung Perak' },
  }, { previousSpec: DEFAULT_SPECIFICATION });
  assert.strictEqual(specResLaut.resolvedSpec.transportationMode, 'LAUT', 'Domestic Port-to-Port must resolve to LAUT');

  console.log('  [PASS] All 14 Domestic transport preference scenarios and specification integration verified.');

  // 9. Test International Port Query Sanitization & Transit Duration in Specification
  console.log('\n[Test 9] Testing International Port Query Sanitization & Transit Duration in Specification...');
  const dirtyIntlSpec = {
    orderType: 'international',
    transportationMode: 'Sea Freight',
    serviceType: 'FCL',
    scheduledDate: '2026-12-15',
    scheduledTime: '08:00',
    transitDuration: '15 hours',
    durationHours: 15,
    pickup: {
      locationType: 'Port',
      city: 'Jakarta Utara',
      country: 'Indonesia',
      locality: 'Tanjung Priok, Jakarta 15 Dec 2026 08:00',
      searchQuery: 'Tanjung Priok, Jakarta 15 Dec 2026 08:00',
    },
    dropoff: {
      locationType: 'Port',
      city: 'Singapore',
      country: 'Singapore',
      locality: 'Pasir Panjang, Singapore 15 Dec 2026 08:00, 15 hours',
      searchQuery: 'Pasir Panjang, Singapore 15 Dec 2026 08:00, 15 hours',
    },
  };

  const resIntl = resolveSpecification(dirtyIntlSpec, { previousSpec: DEFAULT_SPECIFICATION });
  assert.strictEqual(resIntl.resolvedSpec.orderType, 'international');
  assert.strictEqual(resIntl.resolvedSpec.transportationMode, 'Sea Freight');
  assert.strictEqual(resIntl.resolvedSpec.transitDuration, '15 hours');
  assert.strictEqual(resIntl.resolvedSpec.durationHours, 15);
  // Verify clean searchQuery and locality without dates, times, or durations
  assert.strictEqual(resIntl.resolvedSpec.pickup.searchQuery, 'Tanjung Priok, Jakarta');
  assert.strictEqual(resIntl.resolvedSpec.dropoff.searchQuery, 'Pasir Panjang, Singapore');
  assert.strictEqual(resIntl.resolvedSpec.dropoff.locality, 'Pasir Panjang, Singapore');

  // Verify formatSpecificationReview renders transit duration
  const intlReview = formatSpecificationReview(resIntl.resolvedSpec, resIntl.sources);
  assert(intlReview.includes('Transit Duration'), 'Review table must include Transit Duration');
  assert(intlReview.includes('15 hours (15 hours)'), 'Review table must display duration values');
  console.log('  [PASS] International specification sanitization and transit duration verified.');

  console.log('\n>>> ALL 9 SPECIFICATION TESTS PASSED SUCCESSFULLY! <<<');
}

if (require.main === module) {
  runTests();
}

module.exports = { runTests };
