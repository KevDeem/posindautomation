/**
 * Test Suite for VMS Service Catalog Natural Language Builder & Automation Module
 * 
 * Tests without creating unwanted staging catalogs:
 * 1. Domestic Land route NL parsing, SLA inference, FUSO BOX vehicle assignment.
 * 2. International Sea route NL parsing, arrival calculation across midnight, 40 FT STANDARD container.
 * 3. International Air route NL parsing, arrival calculation, TANPA KEMASAN packaging.
 * 4. Location parsing & hierarchy resolution (DOOR vs Indonesian PORT vs International PORT).
 * 5. International classification & Incoterm DDP + Asuransi Rp0 rules.
 * 6. Additional services rule (Pickup Crane Rp50.000, Destination None).
 * 7. Backhaul rule (Always empty, never populated).
 * 8. Tariff builder (FTL Ritase, FCL, LTL/LCL/Air Cargo KG/Ton/CBM, synthetic defaults).
 * 9. Multi-route catalog specification normalization and human-readable review formatting.
 * 10. Headless configuration enforcement.
 */

const assert = require('assert');
const {
  loadVmsConfig,
  parseLocationString,
  classifyRouteInternational,
  buildRouteTariff,
  formatRupiah,
  parsePriceInput,
  parseDateTime,
  calculateArrival,
  parseRoutePrompt,
  normalizeRouteSpecification,
  formatRouteReview,
  formatCatalogReview,
  setCatalogCacheTtl,
  getCatalogCacheTtl,
  getCachedCatalogs,
  setCatalogCache,
  invalidateCatalogCache,
  getOrFetchCatalogs,
  openCatalogDetail,
  openCatalogDetailByName,
  verifyCatalogDetailPage,
  captureVmsScreenshot,
  openRouteCreationWizard,
  captureDropdownDiagnostics,
} = require('../vms');

async function runVmsTests() {
  console.log('=== Starting VMS Service Catalog Unit Tests ===\n');

  // Test 1: Domestic Land Natural Language Route Parsing
  console.log('[Test 1] Testing Domestic Land route natural language parsing...');
  const promptLand = 'Rawalumbu, Bekasi - Bandung Wetan, Bandung, 5 hours, FTL';
  const parsedLand = parseRoutePrompt(promptLand);
  assert.strictEqual(parsedLand.mode, 'DARAT');
  assert.strictEqual(parsedLand.serviceType, 'FTL');
  assert.strictEqual(parsedLand.durationHours, 5);
  assert.strictEqual(parsedLand.origin.district, 'Rawalumbu');
  assert.strictEqual(parsedLand.origin.city, 'Kota Bekasi');
  assert.strictEqual(parsedLand.origin.type, 'DOOR');
  assert.strictEqual(parsedLand.destination.district, 'Bandung Wetan');
  assert.strictEqual(parsedLand.destination.city, 'Kota Bandung');
  assert.strictEqual(parsedLand.destination.type, 'DOOR');

  const normLand = normalizeRouteSpecification(parsedLand);
  assert.strictEqual(normLand.vehicleType, 'FUSO BOX', 'Land vehicle must be FUSO BOX');
  assert.strictEqual(normLand.isInternational, false, 'Domestic route must be false');
  assert.strictEqual(normLand.incoterm, null, 'Domestic route must not have incoterm');
  assert.strictEqual(normLand.tariff.tariffType, 'RITASE');
  assert.strictEqual(normLand.tariff.costRitase, 2500000);
  assert.strictEqual(normLand.additionalServices.pickup.serviceName, 'CRANE');
  assert.strictEqual(normLand.additionalServices.pickup.serviceFee, 50000);
  assert.strictEqual(normLand.additionalServices.destination, null);
  assert.strictEqual(normLand.backhaul, null, 'Backhaul must be empty');
  console.log('  [PASS] Domestic Land route parsed and normalized according to hardcoded rules.');

  // Test 2: International Sea Route Natural Language Parsing & Midnight Crossing
  console.log('\n[Test 2] Testing International Sea route parsing & arrival time calculation across midnight...');
  const promptSea = 'Tanjung Priok, Jakarta - Pasir Panjang, Singapore FCL 15 Dec 2026 08:00, 15 hours';
  const parsedSea = parseRoutePrompt(promptSea);
  assert.strictEqual(parsedSea.mode, 'LAUT');
  assert.strictEqual(parsedSea.serviceType, 'FCL');
  assert.strictEqual(parsedSea.durationHours, 15);
  assert(parsedSea.origin.isPort, 'Origin Tanjung Priok must be recognized as PORT');
  assert.strictEqual(parsedSea.origin.country, 'Indonesia');
  assert(parsedSea.destination.isPort, 'Destination Pasir Panjang must be recognized as PORT');
  assert.strictEqual(parsedSea.destination.country, 'Singapore');

  const normSea = normalizeRouteSpecification(parsedSea);
  assert.strictEqual(normSea.containerType, '40 FT STANDARD', 'Sea container must be 40 FT STANDARD');
  assert.strictEqual(normSea.isInternational, true, 'ID -> SG must be classified as International');
  assert.strictEqual(normSea.incoterm.code, 'DDP');
  assert.strictEqual(normSea.incoterm.component, 'ASURANSI');
  assert.strictEqual(normSea.incoterm.componentAmount, 0);

  // Check arrival timestamp: 15 Dec 2026 08:00 UTC + 15 hours = 15 Dec 2026 23:00 UTC
  assert.strictEqual(normSea.arrivalDate.getUTCDate(), 15);
  assert.strictEqual(normSea.arrivalDate.getUTCHours(), 23);

  // Test midnight boundary crossing (20 hours from 08:00 -> next day 04:00)
  const midnightArrival = calculateArrival(parsedSea.departureDate, 20);
  assert.strictEqual(midnightArrival.getUTCDate(), 16, 'Arrival must cross into next day');
  assert.strictEqual(midnightArrival.getUTCHours(), 4);

  // Test year boundary crossing (31 Dec 2026 20:00 + 6 hours -> 1 Jan 2027 02:00)
  const newYearDep = new Date(Date.UTC(2026, 11, 31, 20, 0));
  const newYearArr = calculateArrival(newYearDep, 6);
  assert.strictEqual(newYearArr.getUTCFullYear(), 2027, 'Arrival must cross into new year');
  assert.strictEqual(newYearArr.getUTCMonth(), 0);
  assert.strictEqual(newYearArr.getUTCDate(), 1);
  assert.strictEqual(newYearArr.getUTCHours(), 2);
  console.log('  [PASS] International Sea route, container type, DDP incoterm, and midnight/year crossing verified.');

  // Test 3: International Air Route Natural Language Parsing
  console.log('\n[Test 3] Testing International Air route parsing, arrival calculation & TANPA KEMASAN...');
  const promptAir = 'Soekarno-Hatta, Tangerang - Changi, Singapore Cargo 15 Dec 2026 08:00, 6 hours';
  const parsedAir = parseRoutePrompt(promptAir);
  assert.strictEqual(parsedAir.mode, 'UDARA');
  assert.strictEqual(parsedAir.serviceType, 'Cargo');
  assert.strictEqual(parsedAir.durationHours, 6);
  assert(parsedAir.origin.isPort, 'Soekarno-Hatta must be recognized as PORT');
  assert(parsedAir.destination.isPort, 'Changi must be recognized as PORT');

  const normAir = normalizeRouteSpecification(parsedAir);
  assert.strictEqual(normAir.packageType, 'TANPA KEMASAN', 'Air cargo packaging must be TANPA KEMASAN');
  assert.strictEqual(normAir.isInternational, true);
  assert.strictEqual(normAir.tariff.tariffType, 'CBM');
  assert.strictEqual(normAir.tariff.costPerKg, 25000);
  assert.strictEqual(normAir.tariff.costPerTonase, 25000000);
  assert.strictEqual(normAir.tariff.costPerCbm, 5000000);
  // 15 Dec 2026 08:00 + 6 hours = 14:00
  assert.strictEqual(normAir.arrivalDate.getUTCHours(), 14);
  console.log('  [PASS] International Air route and TANPA KEMASAN verified.');

  // Test 4: Location Resolver (DOOR, Indonesian PORT, International PORT, Kota vs Kabupaten)
  console.log('\n[Test 4] Testing location parsing (DOOR vs ID Port vs International Port & Kota vs Kabupaten)...');
  const door1 = parseLocationString('Cihideung, Tasikmalaya');
  assert.strictEqual(door1.type, 'DOOR');
  assert.strictEqual(door1.district, 'Cihideung');
  assert.strictEqual(door1.city, 'Kota Tasikmalaya');
  assert.strictEqual(door1.province, 'Jawa Barat');

  const doorKab = parseLocationString('Tambun Selatan, Kabupaten Bekasi');
  assert.strictEqual(doorKab.city, 'Kabupaten Bekasi', 'Must preserve Kabupaten designation');

  const portId = parseLocationString('Tanjung Priok, Jakarta');
  assert.strictEqual(portId.type, 'PORT');
  assert.strictEqual(portId.countryCode, 'ID');
  assert.strictEqual(portId.city, 'Kota Jakarta Utara');
  assert.strictEqual(portId.province, 'DKI Jakarta');

  const portIntl = parseLocationString('Pasir Panjang, Singapore');
  assert.strictEqual(portIntl.type, 'PORT');
  assert.strictEqual(portIntl.countryCode, 'SG');
  assert.strictEqual(portIntl.country, 'Singapore');
  console.log('  [PASS] Location hierarchy resolution and type determination verified.');

  // Test 5: Tariff Builder & Synthetic Default Pricing
  console.log('\n[Test 5] Testing tariff builder and synthetic pricing rules...');
  // Land LTL
  const tariffLtl = buildRouteTariff('DARAT', 'LTL');
  assert.strictEqual(tariffLtl.tariffType, 'CBM');
  assert.strictEqual(tariffLtl.costPerKg, 3500);
  assert.strictEqual(tariffLtl.costPerTonase, 3000000);
  assert.strictEqual(tariffLtl.costPerCbm, 600000);
  assert.strictEqual(tariffLtl.isSynthetic, true);

  // Sea LCL
  const tariffLcl = buildRouteTariff('LAUT', 'LCL');
  assert.strictEqual(tariffLcl.costPerKg, 5000);
  assert.strictEqual(tariffLcl.costPerTonase, 5000000);
  assert.strictEqual(tariffLcl.costPerCbm, 1200000);

  // User price override
  const customTariff = buildRouteTariff('DARAT', 'FTL', { fixedPrice: 'Rp3.200.000' });
  assert.strictEqual(customTariff.costRitase, 3200000);
  assert.strictEqual(customTariff.isSynthetic, false);
  assert.strictEqual(customTariff.sources.costRitase, 'provided');
  console.log('  [PASS] Tariff builder and synthetic default pricing verified.');

  // Test 6: Multi-Route Catalog Review Formatting
  console.log('\n[Test 6] Testing multi-route catalog specification review formatting...');
  const catalogSpec = {
    name: 'Smart Routing Test Catalog',
    startDate: '2026-12-01',
    endDate: '2028-12-01',
    routes: [normLand, normSea, normAir],
  };

  const reviewOutput = formatCatalogReview(catalogSpec);
  assert(reviewOutput.includes('Smart Routing Test Catalog'), 'Review must include catalog name');
  assert(reviewOutput.includes('FUSO BOX'), 'Review must include FUSO BOX');
  assert(reviewOutput.includes('40 FT STANDARD'), 'Review must include 40 FT STANDARD');
  assert(reviewOutput.includes('TANPA KEMASAN'), 'Review must include TANPA KEMASAN');
  assert(reviewOutput.includes('CRANE'), 'Review must include Crane pickup service');
  assert(reviewOutput.includes('EMPTY (Never Selected)'), 'Review must display Backhaul empty rule');
  assert(reviewOutput.includes('DELIVERY DUTY PAID (DDP)'), 'Review must display DDP Incoterm');
  console.log('  [PASS] Multi-route catalog review formatting verified.');

  // Test 7: Browser Mode Propagation & Headed/Headless Configuration
  console.log('\n[Test 7] Testing VMS configuration browser mode propagation (Headed vs Headless)...');
  const cfgHeaded = loadVmsConfig({ headless: false });
  assert.strictEqual(cfgHeaded.headless, false, 'VMS config must preserve headless: false for Headed mode');
  assert(cfgHeaded.vmsUrl.includes('sr-pos-vms-web.nisims.web.id'));

  const cfgHeadless = loadVmsConfig({ headless: true });
  assert.strictEqual(cfgHeadless.headless, true, 'VMS config must preserve headless: true for Headless mode');
  console.log('  [PASS] Headed and Headless browser configuration propagation verified.');

  // Test 8: Catalog Table Loading & Multi-Page Listing
  console.log('\n[Test 8] Testing Catalog Table DOM Loading and Multi-Page Extraction...');
  const { chromium } = require('playwright');
  const browserTest = await chromium.launch({ headless: true });
  const pageMock = await browserTest.newPage();

  await pageMock.setContent(`
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body>
      <div class="ant-layout-header">
        <div>Hi, jasmine Jasmine</div>
      </div>
      <div class="ant-table-wrapper">
        <table class="ant-table">
          <thead class="ant-table-thead">
            <tr><th>Nama Catalog</th><th>Jumlah Service</th><th>Tanggal Berlaku</th><th>Tanggal Kedaluwarsa</th><th>Status</th><th>-</th></tr>
          </thead>
          <tbody class="ant-table-tbody">
            <tr class="ant-table-row">
              <td>katalog temuan prod</td><td>2</td><td>06 November 2026</td><td>11 November 2028</td><td>Aktif</td>
              <td><button class="ant-dropdown-trigger">...</button></td>
            </tr>
            <tr class="ant-table-row">
              <td>Smart Routing International</td><td>5</td><td>04 November 2026</td><td>25 November 2029</td><td>Aktif</td>
              <td><button class="ant-dropdown-trigger">...</button></td>
            </tr>
            <tr class="ant-table-row">
              <td>Catalog Smart Routing Domestik</td><td>2</td><td>04 November 2026</td><td>25 November 2029</td><td>Aktif</td>
              <td><button class="ant-dropdown-trigger">...</button></td>
            </tr>
          </tbody>
        </table>
        <ul class="ant-pagination">
          <li class="ant-pagination-item ant-pagination-item-1 ant-pagination-item-active"><a>1</a></li>
          <li class="ant-pagination-item ant-pagination-item-2"><a>2</a></li>
        </ul>
      </div>
    </body>
    </html>
  `);

  const {
    waitForCatalogTableLoaded,
    extractVisibleCatalogRows,
    captureCatalogLookupDiagnostics,
    openCatalogDetailByName,
  } = require('../vms');

  await waitForCatalogTableLoaded(pageMock);
  const rows = await extractVisibleCatalogRows(pageMock);
  assert.strictEqual(rows.length, 3, 'Must extract 3 catalog rows');
  assert.strictEqual(rows[0].name, 'katalog temuan prod');
  assert.strictEqual(rows[1].name, 'Smart Routing International');
  assert.strictEqual(rows[2].name, 'Catalog Smart Routing Domestik');
  assert.strictEqual(rows[2].status, 'Aktif');
  console.log('  [PASS] Catalog table DOM loading and visible row extraction verified.');

  // Test 9: Catalog Lookup Failure Diagnostic Capture
  console.log('\n[Test 9] Testing Catalog Lookup Failure Diagnostic Capture...');
  let lookupCaught = false;
  try {
    await openCatalogDetailByName(pageMock, 'Nonexistent Catalog XYZ');
  } catch (err) {
    lookupCaught = true;
    assert(err.message.includes('not found in VMS Service Catalog table'), 'Error message must state catalog not found');
    assert(err.diagnostic, 'Error must contain diagnostic metadata');
    assert.strictEqual(err.diagnostic.targetCatalogName, 'Nonexistent Catalog XYZ');
    assert.strictEqual(err.diagnostic.tableLoaded, true);
    assert(err.diagnostic.visibleCatalogsCount >= 3, 'Must record all inspected catalogs');
    assert(err.diagnostic.catalogNamesRetrieved.length >= 3);
    assert(err.diagnostic.catalogNamesRetrieved.includes('Catalog Smart Routing Domestik'));
    assert(err.diagnostic.vendorAccount.includes('jasmine Jasmine'));
    assert.strictEqual(err.diagnostic.paginationAttempted, true);
  }
  assert.strictEqual(lookupCaught, true, 'Must throw error on missing catalog');
  console.log('  [PASS] Catalog lookup failure diagnostic capture and error metadata verified.');

  // Test 10: Successful Catalog Lookup & Dropdown Navigation
  console.log('\n[Test 10] Testing Successful Catalog Lookup & "Lihat Route" Navigation...');
  // Add dropdown menu DOM that mounts on action click
  await pageMock.evaluate(() => {
    document.querySelectorAll('.ant-dropdown-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        let menu = document.querySelector('.ant-dropdown');
        if (!menu) {
          menu = document.createElement('div');
          menu.className = 'ant-dropdown';
          menu.innerHTML = '<div class="ant-dropdown-menu-item">Lihat Route</div>';
          menu.querySelector('.ant-dropdown-menu-item').addEventListener('click', () => {
            window.__navigatedUrl = '/service-catalog/detail/b8883c5611d636307dd53200a33a13be379db7fc3bbc27408a34b3d8050630ae';
            const h = document.createElement('h1');
            h.className = 'ant-page-header-heading-title';
            h.innerText = 'katalog temuan prod';
            document.body.appendChild(h);
          });
          document.body.appendChild(menu);
        } else {
          menu.classList.remove('ant-dropdown-hidden');
        }
      });
    });
  });

  const detailNav = await openCatalogDetailByName(pageMock, 'katalog temuan prod');
  assert.strictEqual(detailNav.success, true);
  assert.strictEqual(detailNav.catalogName, 'katalog temuan prod');
  assert(detailNav.detailUrl.includes('/service-catalog/detail/b8883c5611d63630'));
  assert.strictEqual(detailNav.catalogId, 'b8883c5611d636307dd53200a33a13be379db7fc3bbc27408a34b3d8050630ae');
  console.log('  [PASS] Successful catalog lookup and route detail navigation verified.');

  // Test 11: Catalog Metadata Cache TTL, Expiry, Invalidation & Deduplication
  console.log('\n[Test 11] Testing Catalog Metadata Cache (TTL, expiry, invalidation, deduplication)...');
  invalidateCatalogCache();
  assert.strictEqual(getCachedCatalogs(), null, 'Cache must be empty initially');

  const sampleCatalogs = [
    { name: 'Cat A', services: '3', startDate: '2026-01-01', endDate: '2027-01-01', status: 'Aktif', catalogId: 'id-a-1234567890ab', detailUrl: 'http://vms/service-catalog/detail/id-a-1234567890ab' },
    { name: 'Cat B', services: '1', startDate: '2026-02-01', endDate: '2027-02-01', status: 'Aktif', catalogId: 'id-b-1234567890cd', detailUrl: 'http://vms/service-catalog/detail/id-b-1234567890cd' },
  ];

  setCatalogCache(sampleCatalogs);
  const cachedHit = getCachedCatalogs();
  assert(cachedHit !== null, 'Cache hit expected');
  assert.strictEqual(cachedHit.catalogs.length, 2);
  assert.strictEqual(cachedHit.catalogs[0].name, 'Cat A');
  assert.strictEqual(cachedHit.catalogs[0].detailUrl, 'http://vms/service-catalog/detail/id-a-1234567890ab');

  // Test TTL expiry
  setCatalogCacheTtl(50); // 50ms TTL
  await new Promise(r => setTimeout(r, 70));
  assert.strictEqual(getCachedCatalogs(), null, 'Cache must expire after TTL');
  setCatalogCacheTtl(60000); // Reset to 60s

  // Test explicit invalidation
  setCatalogCache(sampleCatalogs);
  assert(getCachedCatalogs() !== null);
  invalidateCatalogCache();
  assert.strictEqual(getCachedCatalogs(), null, 'Cache must be null after invalidation');

  // Test concurrent fetch deduplication (inflight promise sharing)
  let fetchCallCount = 0;
  const mockFetch = async () => {
    fetchCallCount++;
    await new Promise(r => setTimeout(r, 100));
    return sampleCatalogs;
  };

  const [res1, res2] = await Promise.all([
    getOrFetchCatalogs(mockFetch),
    getOrFetchCatalogs(mockFetch),
  ]);

  assert.strictEqual(fetchCallCount, 1, 'Concurrent fetches must be deduplicated to a single execution');
  assert.strictEqual(res1.catalogs.length, 2);
  assert.strictEqual(res2.catalogs.length, 2);
  assert.strictEqual(res1.fromCache, false);
  console.log('  [PASS] Catalog metadata caching, TTL, invalidation, and concurrent deduplication verified.');

  // Test 12: CLI Selection Index is NOT used as Catalog ID & Actual Identity Preserved
  console.log('\n[Test 12] Testing CLI selection index is NOT used as catalog ID and identity is preserved...');
  await pageMock.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <table class="ant-table">
        <tbody class="ant-table-tbody">
          <tr class="ant-table-row" data-row-key="0">
            <td>katalog temuan prod</td><td>2</td><td>06 Nov 2026</td><td>11 Nov 2028</td><td>Aktif</td>
          </tr>
          <tr class="ant-table-row" data-row-key="1">
            <td>Smart Routing International</td><td>5</td><td>04 Nov 2026</td><td>25 Nov 2029</td><td>Aktif</td>
          </tr>
          <tr class="ant-table-row" data-row-key="2">
            <td>Catalog Smart Routing Domestik</td><td>2</td><td>04 Nov 2026</td><td>25 Nov 2029</td><td>Aktif</td>
          </tr>
          <tr class="ant-table-row" data-row-key="b8883c5611d636307dd53200a33a13be379db7fc3bbc27408a34b3d8050630ae5fdd5cc12db9e8367d9f9a01adfab4c8">
            <td>Catalog With Authentic Hash</td><td>1</td><td>01 Jan 2027</td><td>01 Jan 2029</td><td>Aktif</td>
          </tr>
        </tbody>
      </table>
    </body>
    </html>
  `);

  const extracted = await extractVisibleCatalogRows(pageMock);
  assert.strictEqual(extracted.length, 4);
  // Numeric row keys must NOT be treated as catalog IDs or produce /service-catalog/detail/<index>
  assert.strictEqual(extracted[2].name, 'Catalog Smart Routing Domestik');
  assert.strictEqual(extracted[2].catalogId, null, 'Numeric data-row-key "2" must NOT be used as catalogId');
  assert.strictEqual(extracted[2].detailUrl, null, 'detailUrl must NOT be constructed with numeric row key /service-catalog/detail/2');

  // Authentic hash must be preserved
  assert.strictEqual(extracted[3].name, 'Catalog With Authentic Hash');
  assert.strictEqual(extracted[3].catalogId, 'b8883c5611d636307dd53200a33a13be379db7fc3bbc27408a34b3d8050630ae5fdd5cc12db9e8367d9f9a01adfab4c8');
  assert(extracted[3].detailUrl.includes('/service-catalog/detail/b8883c5611d636307dd53200a33a13be379db7fc3bbc27408a34b3d8050630ae5fdd5cc12db9e8367d9f9a01adfab4c8'));
  console.log('  [PASS] CLI selection index and numeric table row key are NEVER used as catalog ID.');

  // Test 13: Selection by Number vs Selection by Exact Name
  console.log('\n[Test 13] Testing selection by number vs selection by exact name...');
  const availableList = [
    { name: 'katalog temuan prod', services: '2', status: 'Aktif' },
    { name: 'Smart Routing International', services: '5', status: 'Aktif' },
    { name: 'Catalog Smart Routing Domestik', services: '2', status: 'Aktif' },
  ];

  // Selection by number "3"
  const selectNum = parseInt('3', 10);
  const selectedByNum = availableList[selectNum - 1];
  assert.strictEqual(selectedByNum.name, 'Catalog Smart Routing Domestik');
  assert.strictEqual(selectNum, 3, 'CLI index is 3');

  // Selection by exact name "Catalog Smart Routing Domestik"
  const selectedByName = availableList.find(c => c.name.toLowerCase() === 'catalog smart routing domestik');
  assert.strictEqual(selectedByName.name, 'Catalog Smart Routing Domestik');
  console.log('  [PASS] Selection by number and selection by exact name both resolve the correct catalog.');

  // Test 14: UI-Based Catalog Navigation & Detail Verification
  console.log('\n[Test 14] Testing UI-based catalog navigation via table dropdown and detail verification...');
  await pageMock.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <div class="ant-table-wrapper">
        <table class="ant-table">
          <tbody class="ant-table-tbody">
            <tr class="ant-table-row">
              <td>katalog temuan prod</td><td>2</td><td>06 Nov 2026</td><td>11 Nov 2028</td><td>Aktif</td>
              <td><button class="ant-dropdown-trigger">...</button></td>
            </tr>
            <tr class="ant-table-row">
              <td>Smart Routing International</td><td>5</td><td>04 Nov 2026</td><td>25 Nov 2029</td><td>Aktif</td>
              <td><button class="ant-dropdown-trigger">...</button></td>
            </tr>
            <tr class="ant-table-row">
              <td>Catalog Smart Routing Domestik</td><td>2</td><td>04 Nov 2026</td><td>25 Nov 2029</td><td>Aktif</td>
              <td><button class="ant-dropdown-trigger">...</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <script>
        document.querySelectorAll('.ant-dropdown-trigger').forEach((btn, idx) => {
          btn.addEventListener('click', () => {
            const menu = document.createElement('div');
            menu.className = 'ant-dropdown';
            menu.innerHTML = '<div class="ant-dropdown-menu-item">Lihat Route</div>';
            menu.querySelector('.ant-dropdown-menu-item').addEventListener('click', () => {
              window.__navigatedUrl = '/service-catalog/detail/b8883c5611d636307dd53200a33a13be379db7fc3bbc27408a34b3d8050630ae5fdd5cc12db9e8367d9f9a01adfab4c8';
              document.body.innerHTML = \`
                <div class="ant-page-header">
                  <span class="ant-page-header-heading-title">Catalog Smart Routing Domestik</span>
                </div>
              \`;
            });
            document.body.appendChild(menu);
          });
        });
      </script>
    </body>
    </html>
  `);

  const uiNavResult = await openCatalogDetail(pageMock, { name: 'Catalog Smart Routing Domestik' }, { selectedCliIndex: 3 });
  assert.strictEqual(uiNavResult.success, true);
  assert.strictEqual(uiNavResult.selectedCliIndex, 3);
  assert.strictEqual(uiNavResult.catalogName, 'Catalog Smart Routing Domestik');
  assert.strictEqual(uiNavResult.catalogId, 'b8883c5611d636307dd53200a33a13be379db7fc3bbc27408a34b3d8050630ae5fdd5cc12db9e8367d9f9a01adfab4c8');
  assert.strictEqual(uiNavResult.displayedCatalogName, 'Catalog Smart Routing Domestik');
  assert.notStrictEqual(uiNavResult.catalogId, '2', 'Must never use row index as catalog ID');
  assert.notStrictEqual(uiNavResult.catalogId, '3', 'Must never use selection number as catalog ID');
  console.log('  [PASS] UI-based catalog navigation and detail verification verified.');

  // Test 15: Detail Page Name Verification Rejects "Not Permission", 403, and Mismatches
  console.log('\n[Test 15] Testing detail page verification rejects "Not Permission", 403, and mismatches...');
  await pageMock.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <div class="error-banner">Not Permission</div>
    </body>
    </html>
  `);

  const permRes = await verifyCatalogDetailPage(pageMock, 'Catalog Smart Routing Domestik');
  assert.strictEqual(permRes.verified, false);
  assert.strictEqual(permRes.displayedName, 'Not Permission');
  assert(permRes.reason.includes('Not Permission'));

  // Test name mismatch
  await pageMock.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <h1 class="ant-page-header-heading-title">Different Catalog Name</h1>
    </body>
    </html>
  `);

  const mismatchRes = await verifyCatalogDetailPage(pageMock, 'Catalog Smart Routing Domestik');
  assert.strictEqual(mismatchRes.verified, false);
  assert.strictEqual(mismatchRes.displayedName, 'Different Catalog Name');
  assert(mismatchRes.reason.includes('not found on detail page'));
  console.log('  [PASS] Detail page verification successfully blocks "Not Permission" and mismatched catalogs.');

  // Test 16: "Tambah" Dropdown Interaction & Route Creation Wizard Verification
  console.log('\n[Test 16] Testing "Tambah" Dropdown Trigger & Route Creation Wizard Verification...');
  await pageMock.route('**/service-catalog/detail/cat-wizard-test', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body>
          <div class="ant-page-header">
            <span class="ant-page-header-heading-title">Verified Catalog</span>
          </div>
          <div class="header">
            <button class="ant-btn ant-dropdown-trigger">Tambah</button>
          </div>
          <div id="content"></div>
          <script>
            document.querySelector('button.ant-dropdown-trigger').addEventListener('click', () => {
              const menu = document.createElement('div');
              menu.className = 'ant-dropdown';
              menu.innerHTML = \`
                <ul class="ant-dropdown-menu">
                  <li class="ant-dropdown-menu-item">Tambah Katalog</li>
                  <li class="ant-dropdown-menu-item">Unggah Dokumen Katalog</li>
                </ul>
              \`;
              menu.querySelectorAll('.ant-dropdown-menu-item')[0].addEventListener('click', () => {
                const form = document.createElement('div');
                form.className = 'ant-steps';
                form.innerHTML = '<form class="ant-form"><div class="ant-form-item">Stage 1 Form</div></form>';
                document.getElementById('content').appendChild(form);
              });
              document.body.appendChild(menu);
            });
          </script>
        </body>
        </html>
      `,
    });
  });
  await pageMock.goto('http://localhost/service-catalog/detail/cat-wizard-test');

  const wizardOpened = await openRouteCreationWizard(pageMock, { actionTimeoutMs: 3000, catalogName: 'Verified Catalog' });
  assert.strictEqual(wizardOpened, true, 'Wizard must open successfully');
  const hasForm = await pageMock.locator('.ant-form-item').isVisible();
  assert.strictEqual(hasForm, true, 'Form item must be visible in route creation wizard');

  // Verify that an unverified catalog name stops wizard execution
  let mismatchHalted = false;
  try {
    await openRouteCreationWizard(pageMock, { actionTimeoutMs: 1000, catalogName: 'Nonexistent Name' });
  } catch (err) {
    mismatchHalted = true;
    assert(err.message.includes('not verified'));
  }
  assert.strictEqual(mismatchHalted, true, 'Must halt wizard opening if catalog identity is not verified');
  console.log('  [PASS] "Tambah" dropdown click -> "Tambah Katalog" menu item -> wizard verified with catalog verification.');

  // Test 17: Route Creation Wizard Diagnostic Capture on Failure
  console.log('\n[Test 17] Testing Route Creation Wizard Diagnostic Capture on Missing Elements...');
  await pageMock.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <div>Empty Page Without Tambah Button</div>
    </body>
    </html>
  `);

  let wizardFailureCaught = false;
  try {
    await openRouteCreationWizard(pageMock, { actionTimeoutMs: 1000 });
  } catch (err) {
    wizardFailureCaught = true;
    assert(err.diagnostic, 'Wizard error must contain diagnostic report');
    assert.strictEqual(err.diagnostic.dropdownVisible, false);
    assert(err.message.includes('Tambah'), 'Error message must specify Tambah failure');
  }
  assert.strictEqual(wizardFailureCaught, true, 'Must throw error when dropdown trigger fails');
  console.log('  [PASS] Route creation wizard diagnostic capture on failure verified.');

  await pageMock.close();
  await browserTest.close();

  console.log('\n>>> ALL VMS SERVICE CATALOG UNIT TESTS PASSED SUCCESSFULLY! <<<');
}

if (require.main === module) {
  runVmsTests().catch(err => {
    console.error('[VMS TEST ERROR]:', err);
    process.exit(1);
  });
}

module.exports = { runVmsTests };
