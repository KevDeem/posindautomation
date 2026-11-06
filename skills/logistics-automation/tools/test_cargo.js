/**
 * Unit Test Suite for Cargo Field Handling & Automatic Generation
 * 
 * Verifies:
 * 1. Automatic generation of cargo.itemName and cargo.weightKg when omitted
 * 2. Generated weight boundary: integer between 50 and 100 kg inclusive
 * 3. Generated item name variety: realistic Indonesian cargo items
 * 4. User-provided explicit cargo values are preserved (never overwritten)
 * 5. Specification review table display with appropriate origin badges
 * 6. Persistence and non-rerandomization during retries / re-resolution
 * 7. Batch order independence: distinct cargo details across batch items
 * 8. Missing mandatory fields exclusion: cargo is not reported as missing
 */

const assert = require('assert');
const {
  resolveSpecification,
  formatSpecificationReview,
  REALISTIC_CARGO_ITEMS,
  generateCargoItemName,
  generateCargoWeightKg,
  resetCargoGenerator,
  DEFAULT_SPECIFICATION,
} = require('./order_specification');
const { normalizeBatchInput } = require('./batch_executor');
const { parseOrderPrompt } = require('../bot/nl_parser');

async function runCargoTests() {
  console.log('=== Starting Cargo Generation & Specification Tests ===\n');

  // [Test 1] Missing Cargo Details Automatically Generated
  console.log('[Test 1] Testing automatic cargo generation when omitted from input...');
  resetCargoGenerator();
  const specNoCargo = {
    pickup: { city: 'Kota Bandung' },
    dropoff: { city: 'Kota Surabaya' },
    scheduledDate: '2026-12-01',
    scheduledTime: '10:00',
  };

  const res1 = resolveSpecification(specNoCargo);
  assert(res1.resolvedSpec.cargo, 'cargo object must exist');
  assert(res1.resolvedSpec.cargo.itemName, 'cargo.itemName must be generated');
  assert(REALISTIC_CARGO_ITEMS.includes(res1.resolvedSpec.cargo.itemName), `cargo.itemName must be a realistic item (${res1.resolvedSpec.cargo.itemName})`);
  assert(typeof res1.resolvedSpec.cargo.weightKg === 'number', 'cargo.weightKg must be numeric');
  assert(Number.isInteger(res1.resolvedSpec.cargo.weightKg), 'cargo.weightKg must be integer');
  assert(res1.resolvedSpec.cargo.weightKg >= 50 && res1.resolvedSpec.cargo.weightKg <= 100, `cargo.weightKg must be between 50 and 100 (got ${res1.resolvedSpec.cargo.weightKg})`);
  assert.strictEqual(res1.sources.cargo.itemName, 'generated', 'cargo.itemName source must be generated');
  assert.strictEqual(res1.sources.cargo.weightKg, 'generated', 'cargo.weightKg source must be generated');
  assert(!res1.missingMandatory.includes('cargo.itemName'), 'cargo.itemName must NOT be reported as missing');
  assert(!res1.missingMandatory.includes('cargo.weightKg'), 'cargo.weightKg must NOT be reported as missing');
  console.log(`  [PASS] Auto-generated: "${res1.resolvedSpec.cargo.itemName}", ${res1.resolvedSpec.cargo.weightKg} KG`);

  // [Test 2] Weight Boundaries (50-100 kg inclusive) & Integer Verification
  console.log('\n[Test 2] Testing weight random generation boundaries across 100 iterations...');
  let minObserved = 1000;
  let maxObserved = -1;
  const weightsSet = new Set();

  for (let i = 0; i < 100; i++) {
    const w = generateCargoWeightKg(50, 100);
    assert(Number.isInteger(w), `Weight must be integer (got ${w})`);
    assert(w >= 50, `Weight must be >= 50 (got ${w})`);
    assert(w <= 100, `Weight must be <= 100 (got ${w})`);
    if (w < minObserved) minObserved = w;
    if (w > maxObserved) maxObserved = w;
    weightsSet.add(w);
  }
  assert(minObserved >= 50 && minObserved <= 60, `Minimum observed weight should be near 50 (got ${minObserved})`);
  assert(maxObserved >= 90 && maxObserved <= 100, `Maximum observed weight should be near 100 (got ${maxObserved})`);
  assert(weightsSet.size >= 15, `Should observe varied weights across 100 iterations (got ${weightsSet.size} unique values)`);
  console.log(`  [PASS] Weight range verified: [${minObserved}, ${maxObserved}], ${weightsSet.size} distinct values generated`);

  // [Test 3] Cargo Item Name Variety & No Immediate Repetition
  console.log('\n[Test 3] Testing cargo item name variety across consecutive generations...');
  resetCargoGenerator();
  const generatedItems = [];
  for (let i = 0; i < 10; i++) {
    const item = generateCargoItemName();
    assert(REALISTIC_CARGO_ITEMS.includes(item), `Item "${item}" must be in REALISTIC_CARGO_ITEMS`);
    if (generatedItems.length > 0) {
      assert.notStrictEqual(item, generatedItems[generatedItems.length - 1], `Item "${item}" should not repeat consecutively`);
    }
    generatedItems.push(item);
  }
  const uniqueItems = new Set(generatedItems);
  assert(uniqueItems.size >= 5, `Expected at least 5 unique items across 10 generations (got ${uniqueItems.size})`);
  console.log(`  [PASS] Item names varied (${uniqueItems.size} unique across 10): ${generatedItems.slice(0, 5).join(', ')}...`);

  // [Test 4] Explicit User-Specified Cargo Values Are Respected
  console.log('\n[Test 4] Testing explicit user cargo values are preserved and never overwritten...');
  // 4a. Explicit weight, omitted item
  const specWeightOnly = {
    pickup: { city: 'Jakarta Selatan' },
    dropoff: { city: 'Kota Surabaya' },
    cargo: { weightKg: 85 },
  };
  const resWeight = resolveSpecification(specWeightOnly);
  assert.strictEqual(resWeight.resolvedSpec.cargo.weightKg, 85, 'Explicit weight must be preserved');
  assert.strictEqual(resWeight.sources.cargo.weightKg, 'provided', 'Explicit weight source must be provided');
  assert(resWeight.resolvedSpec.cargo.itemName, 'Omitted item must be generated');
  assert.strictEqual(resWeight.sources.cargo.itemName, 'generated', 'Omitted item source must be generated');

  // 4b. Explicit item, omitted weight
  const specItemOnly = {
    pickup: { city: 'Jakarta Selatan' },
    dropoff: { city: 'Kota Surabaya' },
    cargo: { itemName: 'Spare Part Traktor' },
  };
  const resItem = resolveSpecification(specItemOnly);
  assert.strictEqual(resItem.resolvedSpec.cargo.itemName, 'Spare Part Traktor', 'Explicit item name must be preserved');
  assert.strictEqual(resItem.sources.cargo.itemName, 'provided', 'Explicit item source must be provided');
  assert(resItem.resolvedSpec.cargo.weightKg >= 50 && resItem.resolvedSpec.cargo.weightKg <= 100, 'Omitted weight must be generated in [50, 100]');
  assert.strictEqual(resItem.sources.cargo.weightKg, 'generated', 'Omitted weight source must be generated');

  // 4c. Both explicit
  const specBoth = {
    pickup: { city: 'Jakarta Selatan' },
    dropoff: { city: 'Kota Surabaya' },
    cargo: { itemName: 'Panel Listrik', weightKg: 62 },
  };
  const resBoth = resolveSpecification(specBoth);
  assert.strictEqual(resBoth.resolvedSpec.cargo.itemName, 'Panel Listrik');
  assert.strictEqual(resBoth.resolvedSpec.cargo.weightKg, 62);
  assert.strictEqual(resBoth.sources.cargo.itemName, 'provided');
  assert.strictEqual(resBoth.sources.cargo.weightKg, 'provided');
  console.log('  [PASS] Explicit values preserved for partial and complete cargo specifications');

  // [Test 5] Specification Review Table Formatting
  console.log('\n[Test 5] Testing specification review table displays generated vs provided badges...');
  const reviewGen = formatSpecificationReview(res1.resolvedSpec, res1.sources);
  assert(reviewGen.includes(`Commodity & Item`), 'Review table must include Commodity & Item');
  assert(reviewGen.includes(res1.resolvedSpec.cargo.itemName), 'Review table must display generated item name');
  assert(reviewGen.includes(`${res1.resolvedSpec.cargo.weightKg} KG`), 'Review table must display generated weight');
  assert(reviewGen.includes('[Generated Synthetic]'), 'Review table must badge auto-generated fields with [Generated Synthetic]');

  const reviewProv = formatSpecificationReview(resBoth.resolvedSpec, resBoth.sources);
  assert(reviewProv.includes('Panel Listrik'), 'Review table must display user-provided item name');
  assert(reviewProv.includes('62 KG'), 'Review table must display user-provided weight');
  assert(reviewProv.includes('[Provided]'), 'Review table must badge user-provided fields with [Provided]');
  console.log('  [PASS] Specification review accurately renders [Generated Synthetic] and [Provided] badges');

  // [Test 6] Persistence and Non-Rerandomization During Retries / Edits
  console.log('\n[Test 6] Testing persistence and stability across retries and re-resolutions...');
  const initialResolved = resolveSpecification({
    pickup: { city: 'Jakarta Selatan' },
    dropoff: { city: 'Kota Surabaya' },
  });
  const lockedItem = initialResolved.resolvedSpec.cargo.itemName;
  const lockedWeight = initialResolved.resolvedSpec.cargo.weightKg;

  // Re-resolve simulated retry
  const retryResolved = resolveSpecification(initialResolved.resolvedSpec);
  assert.strictEqual(retryResolved.resolvedSpec.cargo.itemName, lockedItem, 'Item name must NOT rerandomize during retries');
  assert.strictEqual(retryResolved.resolvedSpec.cargo.weightKg, lockedWeight, 'Weight must NOT rerandomize during retries');
  assert.strictEqual(retryResolved.sources.cargo.itemName, 'generated', 'Origin badge must be preserved across re-resolutions');
  assert.strictEqual(retryResolved.sources.cargo.weightKg, 'generated', 'Origin badge must be preserved across re-resolutions');
  console.log(`  [PASS] Cargo details remained locked across re-resolution: "${lockedItem}", ${lockedWeight} KG`);

  // [Test 7] Batch Orders Independence
  console.log('\n[Test 7] Testing independent cargo generation across batch orders...');
  const batchOrders = normalizeBatchInput({
    specification: {
      pickup: { city: 'Jakarta Selatan' },
      dropoff: { city: 'Kota Surabaya' },
    },
    count: 5,
  });

  assert.strictEqual(batchOrders.length, 5, 'Batch must contain 5 items');
  const batchCargoDetails = [];
  for (const item of batchOrders) {
    const r = resolveSpecification(item.spec);
    batchCargoDetails.push({
      item: r.resolvedSpec.cargo.itemName,
      weight: r.resolvedSpec.cargo.weightKg,
    });
  }

  console.log('  Batch Cargo items resolved:');
  batchCargoDetails.forEach((b, idx) => {
    console.log(`    Order #${idx + 1}: Item="${b.item}" | Weight=${b.weight} KG`);
    assert(b.weight >= 50 && b.weight <= 100, `Order #${idx + 1} weight ${b.weight} must be within 50-100 KG`);
  });

  const batchItemNames = new Set(batchCargoDetails.map(b => b.item));
  const batchWeights = new Set(batchCargoDetails.map(b => b.weight));
  assert(batchItemNames.size >= 3, `Batch orders must vary cargo item names (got ${batchItemNames.size} distinct items)`);
  assert(batchWeights.size >= 2, `Batch orders should vary cargo weights (got ${batchWeights.size} distinct weights)`);
  console.log('  [PASS] Batch cargo items and weights generated independently across orders');

  // [Test 8] Natural Language Prompt Parsing with and without Cargo
  console.log('\n[Test 8] Testing natural language parsing with omitted vs explicit cargo...');
  // 8a. Omitted cargo
  const pOmitted = parseOrderPrompt('Pickup in Tebet Jakarta Selatan to Gubeng Surabaya on 1 Dec 2026 at 08:00');
  const rOmitted = resolveSpecification(pOmitted.spec);
  assert(rOmitted.resolvedSpec.cargo.itemName, 'Must auto-generate itemName for omitted prompt');
  assert(rOmitted.resolvedSpec.cargo.weightKg >= 50, 'Must auto-generate weightKg for omitted prompt');
  assert.strictEqual(rOmitted.sources.cargo.itemName, 'generated');
  assert.strictEqual(rOmitted.sources.cargo.weightKg, 'generated');

  // 8b. Explicit item and weight
  const pExplicit = parseOrderPrompt('Pickup in Tebet to Gubeng on 1 Dec 2026 at 08:00 cargo item: Spare Part Mesin 75 kg');
  const rExplicit = resolveSpecification(pExplicit.spec);
  assert.strictEqual(rExplicit.resolvedSpec.cargo.itemName, 'Spare Part Mesin');
  assert.strictEqual(rExplicit.resolvedSpec.cargo.weightKg, 75);
  assert.strictEqual(rExplicit.sources.cargo.itemName, 'provided');
  assert.strictEqual(rExplicit.sources.cargo.weightKg, 'provided');
  console.log('  [PASS] Natural language prompt integration verified for omitted and explicit cargo');

  console.log('\n>>> ALL 8 CARGO UNIT TESTS PASSED SUCCESSFULLY! <<<');
}

if (require.main === module) {
  runCargoTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { runCargoTests };
