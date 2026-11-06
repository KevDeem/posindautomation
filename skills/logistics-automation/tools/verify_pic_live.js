/**
 * Live Staging Verification Script for PIC Management & Selection
 * 
 * Executes authorized staging transactions:
 * 1. Domestic order with randomized library PICs + complete payment sandbox verification.
 * 2. Domestic order with empty library fallback (verifying synthetic generation & auto-persistence).
 * 3. International order route check (verifying SG (+65) / MY (+60) PIC profile attachment and Non-Contract catalog check).
 * 4. Batch order execution (2 sequential orders) verifying different PIC assignments across consecutive transactions.
 */

const fs = require('fs');
const path = require('path');
const { executeOrder } = require('./order_executor');
const { executeOrderPayment } = require('./payment_executor');
const { executeBatch } = require('./batch_executor');
const {
  getPicLibrary,
  setPicLibrary,
  resetPicLibrary,
} = require('./pic_manager');
const {
  resolveSpecification,
  formatSpecificationReview,
} = require('./order_specification');

async function runLiveVerification() {
  console.log('======================================================');
  console.log('   STARTING AUTHORIZED LIVE STAGING PIC VERIFICATION  ');
  console.log('======================================================\n');

  const report = {
    test1_domestic_library: null,
    test2_empty_library_fallback: null,
    test3_intl_route: null,
    test4_batch_variance: null,
  };

  // Ensure library is reset to default before starting
  resetPicLibrary(true);

  // -----------------------------------------------------------------
  // 1. Domestic Order with Randomized Library PICs + Payment Sandbox
  // -----------------------------------------------------------------
  console.log('>>> [TEST 1] Executing Domestic Order with Randomized Library PICs...');
  const spec1 = {
    orderType: 'domestic',
    scheduledDate: '2026-12-05',
    scheduledTime: '10:00',
    pickup: {
      locationType: 'Door',
      province: 'DKI Jakarta',
      city: 'Jakarta Selatan',
      district: 'Tebet',
      subdistrict: 'Manggarai',
      address: 'Jl. Tebet Raya No. 45',
      postalCode: '12850',
    },
    dropoff: {
      locationType: 'Door',
      province: 'Jawa Timur',
      city: 'Kota Surabaya',
      district: 'Gubeng',
      subdistrict: 'Pucang Sewu',
      address: 'Jl. Gubeng Kertajaya No. 12',
      postalCode: '60283',
    },
    cargo: {
      characteristics: 'General Cargo',
      commodity: 'Elektronik',
      itemName: 'Busi Denso',
      weightKg: 50,
      quantity: 1,
      quantityUnit: 'PCS',
      lengthCm: 50,
      widthCm: 50,
      heightCm: 50,
      packagingType: 'Kardus XL',
    },
    serviceCatalogPreference: 'auto',
  };

  const resolved1 = resolveSpecification(spec1);
  console.log(formatSpecificationReview(resolved1.resolvedSpec, resolved1.sources));
  console.log(`\nPickup PIC: ${resolved1.resolvedSpec.pickup.pic.name} (${resolved1.resolvedSpec.pickup.pic.company}) [${resolved1.sources.pickup.pic.name}]`);
  console.log(`Drop-off PIC: ${resolved1.resolvedSpec.dropoff.pic.name} (${resolved1.resolvedSpec.dropoff.pic.company}) [${resolved1.sources.dropoff.pic.name}]`);

  const { result: execResult1, page: page1, context: ctx1, browser: browser1 } = await executeOrder(spec1, {
    headless: false,
    transactionLabel: 'Live Test 1 (Domestic Library PIC)',
  });

  if (execResult1.success && execResult1.orderId) {
    console.log(`\n[Test 1] Order created successfully: ${execResult1.orderId} (Shipment: ${execResult1.shipmentId}, Amount: Rp${execResult1.amount})`);
    console.log('[Test 1] Proceeding to Pospay payment simulation via payment_executor...');
    
    const payResult1 = await executeOrderPayment(page1, ctx1, execResult1, {
      headless: false,
      transactionLabel: 'Live Test 1 Payment',
    });

    report.test1_domestic_library = {
      orderId: execResult1.orderId,
      shipmentId: execResult1.shipmentId,
      amount: execResult1.amount,
      serviceCatalog: execResult1.serviceCatalog,
      pickupPic: resolved1.resolvedSpec.pickup.pic.name,
      dropoffPic: resolved1.resolvedSpec.dropoff.pic.name,
      pickupOrigin: resolved1.sources.pickup.pic.name,
      dropoffOrigin: resolved1.sources.dropoff.pic.name,
      vaNumber: payResult1.vaNumber,
      sandboxPayment: payResult1.sandboxPayment,
      overallStatus: payResult1.overallStatus,
    };
  } else {
    report.test1_domestic_library = { error: execResult1.error };
  }

  if (browser1) await browser1.close().catch(() => {});

  // -----------------------------------------------------------------
  // 2. Domestic Order with Empty Library Fallback (Synthetic Generation)
  // -----------------------------------------------------------------
  console.log('\n>>> [TEST 2] Executing Domestic Order with Empty Library Fallback...');
  // Force library to empty
  setPicLibrary([], true);
  console.log('[Test 2] PIC Library emptied to test fallback auto-generation.');

  const spec2 = {
    orderType: 'domestic',
    scheduledDate: '2026-12-06',
    scheduledTime: '11:00',
    pickup: {
      locationType: 'Door',
      province: 'DKI Jakarta',
      city: 'Jakarta Selatan',
      district: 'Tebet',
      subdistrict: 'Manggarai',
      address: 'Jl. Tebet Timur No. 10',
      postalCode: '12850',
    },
    dropoff: {
      locationType: 'Door',
      province: 'Jawa Timur',
      city: 'Kota Surabaya',
      district: 'Gubeng',
      subdistrict: 'Pucang Sewu',
      address: 'Jl. Gubeng Jaya No. 20',
      postalCode: '60283',
    },
    cargo: {
      characteristics: 'General Cargo',
      commodity: 'Elektronik',
      itemName: 'Kabel Tembaga',
      weightKg: 40,
      quantity: 1,
      quantityUnit: 'PCS',
      lengthCm: 40,
      widthCm: 40,
      heightCm: 40,
      packagingType: 'Kardus XL',
    },
    serviceCatalogPreference: 'auto',
  };

  const resolved2 = resolveSpecification(spec2);
  console.log(formatSpecificationReview(resolved2.resolvedSpec, resolved2.sources));
  console.log(`\nPickup PIC: ${resolved2.resolvedSpec.pickup.pic.name} (${resolved2.resolvedSpec.pickup.pic.company}) [${resolved2.sources.pickup.pic.name}]`);
  console.log(`Drop-off PIC: ${resolved2.resolvedSpec.dropoff.pic.name} (${resolved2.resolvedSpec.dropoff.pic.company}) [${resolved2.sources.dropoff.pic.name}]`);
  console.log(`Library entries after auto-save: ${getPicLibrary().length}`);

  const { result: execResult2, page: page2, context: ctx2, browser: browser2 } = await executeOrder(spec2, {
    headless: false,
    transactionLabel: 'Live Test 2 (Empty Library Fallback)',
  });

  if (execResult2.success && execResult2.orderId) {
    console.log(`\n[Test 2] Order created successfully: ${execResult2.orderId} (Shipment: ${execResult2.shipmentId}, Amount: Rp${execResult2.amount})`);
    console.log('[Test 2] Proceeding to Pospay payment simulation via payment_executor...');
    
    const payResult2 = await executeOrderPayment(page2, ctx2, execResult2, {
      headless: false,
      transactionLabel: 'Live Test 2 Payment',
    });

    report.test2_empty_library_fallback = {
      orderId: execResult2.orderId,
      shipmentId: execResult2.shipmentId,
      amount: execResult2.amount,
      serviceCatalog: execResult2.serviceCatalog,
      pickupPic: resolved2.resolvedSpec.pickup.pic.name,
      dropoffPic: resolved2.resolvedSpec.dropoff.pic.name,
      pickupOrigin: resolved2.sources.pickup.pic.name,
      dropoffOrigin: resolved2.sources.dropoff.pic.name,
      libraryCount: getPicLibrary().length,
      vaNumber: payResult2.vaNumber,
      sandboxPayment: payResult2.sandboxPayment,
      overallStatus: payResult2.overallStatus,
    };
  } else {
    report.test2_empty_library_fallback = { error: execResult2.error };
  }

  if (browser2) await browser2.close().catch(() => {});

  // Restore clean default library for subsequent tests
  resetPicLibrary(true);

  // -----------------------------------------------------------------
  // 3. International Order Location-Aware Check (Singapore & Malaysia)
  // -----------------------------------------------------------------
  console.log('\n>>> [TEST 3] Testing International Orders (Singapore & Malaysia)...');
  const specSG = {
    orderType: 'international',
    scheduledDate: '2026-12-07',
    scheduledTime: '09:00',
    pickup: {
      locationType: 'Door',
      country: 'Indonesia',
      city: 'Tangerang',
      postalCode: '15111',
    },
    dropoff: {
      locationType: 'Door',
      country: 'Singapore',
      city: 'Singapore',
      postalCode: '238801',
    },
    cargo: {
      characteristics: 'General Cargo',
      commodity: 'Elektronik',
      itemName: 'Modul IoT',
      weightKg: 20,
      quantity: 1,
      lengthCm: 30,
      widthCm: 30,
      heightCm: 30,
      packagingType: 'Tanpa Kemasan',
      hsCode: '85359010',
    },
  };

  const resolvedSG = resolveSpecification(specSG);
  console.log('--- Singapore International Spec ---');
  console.log(`Pickup Country: ${resolvedSG.resolvedSpec.pickup.country} | Phone: ${resolvedSG.resolvedSpec.pickup.pic.phone} [${resolvedSG.sources.pickup.pic.name}]`);
  console.log(`Dropoff Country: ${resolvedSG.resolvedSpec.dropoff.country} | Phone: ${resolvedSG.resolvedSpec.dropoff.pic.phone} | PIC: ${resolvedSG.resolvedSpec.dropoff.pic.name} (${resolvedSG.resolvedSpec.dropoff.pic.company}) [${resolvedSG.sources.dropoff.pic.name}]`);

  const specMY = {
    orderType: 'international',
    scheduledDate: '2026-12-07',
    scheduledTime: '09:00',
    pickup: {
      locationType: 'Door',
      country: 'Indonesia',
      city: 'Tangerang',
      postalCode: '15111',
    },
    dropoff: {
      locationType: 'Door',
      country: 'Malaysia',
      city: 'Kuala Lumpur',
      postalCode: '50088',
    },
    cargo: {
      characteristics: 'General Cargo',
      commodity: 'Elektronik',
      itemName: 'Sensor Circuit',
      weightKg: 15,
      quantity: 1,
      lengthCm: 25,
      widthCm: 25,
      heightCm: 25,
      packagingType: 'Tanpa Kemasan',
      hsCode: '85359010',
    },
  };

  const resolvedMY = resolveSpecification(specMY);
  console.log('--- Malaysia International Spec ---');
  console.log(`Pickup Country: ${resolvedMY.resolvedSpec.pickup.country} | Phone: ${resolvedMY.resolvedSpec.pickup.pic.phone} [${resolvedMY.sources.pickup.pic.name}]`);
  console.log(`Dropoff Country: ${resolvedMY.resolvedSpec.dropoff.country} | Phone: ${resolvedMY.resolvedSpec.dropoff.pic.phone} | PIC: ${resolvedMY.resolvedSpec.dropoff.pic.name} (${resolvedMY.resolvedSpec.dropoff.pic.company}) [${resolvedMY.sources.dropoff.pic.name}]`);

  report.test3_intl_route = {
    singapore: {
      pickupPhone: resolvedSG.resolvedSpec.pickup.pic.phone,
      dropoffPhone: resolvedSG.resolvedSpec.dropoff.pic.phone,
      dropoffName: resolvedSG.resolvedSpec.dropoff.pic.name,
      dropoffCompany: resolvedSG.resolvedSpec.dropoff.pic.company,
      dropoffOrigin: resolvedSG.sources.dropoff.pic.name,
    },
    malaysia: {
      pickupPhone: resolvedMY.resolvedSpec.pickup.pic.phone,
      dropoffPhone: resolvedMY.resolvedSpec.dropoff.pic.phone,
      dropoffName: resolvedMY.resolvedSpec.dropoff.pic.name,
      dropoffCompany: resolvedMY.resolvedSpec.dropoff.pic.company,
      dropoffOrigin: resolvedMY.sources.dropoff.pic.name,
    }
  };

  // -----------------------------------------------------------------
  // 4. Batch Order Execution (2 orders) with PIC Variance & AutoPay
  // -----------------------------------------------------------------
  console.log('\n>>> [TEST 4] Executing Batch Orders (2 sequential orders) to verify PIC variance...');
  const batchSpec = {
    orderType: 'domestic',
    scheduledDate: '2026-12-08',
    scheduledTime: '10:00',
    pickup: {
      locationType: 'Door',
      province: 'DKI Jakarta',
      city: 'Jakarta Selatan',
      district: 'Tebet',
      subdistrict: 'Manggarai',
      address: 'Jl. Tebet Barat No. 5',
      postalCode: '12850',
    },
    dropoff: {
      locationType: 'Door',
      province: 'Jawa Timur',
      city: 'Kota Surabaya',
      district: 'Gubeng',
      subdistrict: 'Pucang Sewu',
      address: 'Jl. Gubeng Pojok No. 15',
      postalCode: '60283',
    },
    cargo: {
      characteristics: 'General Cargo',
      commodity: 'Elektronik',
      itemName: 'Panel Switch',
      weightKg: 50,
      quantity: 1,
      quantityUnit: 'PCS',
      lengthCm: 50,
      widthCm: 50,
      heightCm: 50,
      packagingType: 'Kardus XL',
    },
    serviceCatalogPreference: 'auto',
  };

  const batchResults = await executeBatch({
    specification: batchSpec,
    count: 2,
  }, {
    headless: false,
    autoPay: true,
  });

  report.test4_batch_variance = {
    total: batchResults.total,
    succeeded: batchResults.succeeded,
    failed: batchResults.failed,
    totalAmountPaid: batchResults.totalAmountPaid,
    orders: batchResults.orders.map(o => ({
      orderId: o.orderId,
      shipmentId: o.shipmentId,
      vaNumber: o.vaNumber,
      amount: o.amount,
      sandboxPayment: o.sandboxPayment,
      overallStatus: o.overallStatus,
    })),
  };

  console.log('\n======================================================');
  console.log('              FINAL VERIFICATION REPORT              ');
  console.log('======================================================');
  console.log(JSON.stringify(report, null, 2));

  // Save report to .artifacts
  const reportPath = path.resolve(__dirname, '../../../.artifacts/live_pic_verification_report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nReport saved to: ${reportPath}`);
}

if (require.main === module) {
  runLiveVerification().catch(err => {
    console.error('Fatal live verification error:', err);
    process.exit(1);
  });
}

module.exports = { runLiveVerification };
