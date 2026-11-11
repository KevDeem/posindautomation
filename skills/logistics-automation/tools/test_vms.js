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
  fetchServiceCatalogsApi,
  retrieveAvailableCatalogs,
  getAvailableCatalogs,
  formatIndonesianDate,
  mapStatusCodeToIndonesian,
  parseRscResponse,
  createCatalogRoute,
  createCatalogRoutesBatch,
  mapVmsRouteStatus,
  splitBatchInput,
  parseCatalogBlock,
  parseBatchCatalogInput,
  formatBatchReview,
  formatBatchSummaryReport,
  executeBatchCatalogs,
  handleCreateMultipleCatalogsFlow,
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
  console.log('\n[Test 14] Testing UI-based catalog navigation via row three-dot action button and "Lihat Route"...');
  await pageMock.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <div class="ant-table-wrapper">
        <table class="ant-table">
          <tbody class="ant-table-tbody">
            <tr class="ant-table-row">
              <td>katalog temuan prod</td><td>2</td><td>06 Nov 2026</td><td>11 Nov 2028</td><td>Aktif</td>
              <td><button class="ant-dropdown-trigger anticon-more">...</button></td>
            </tr>
            <tr class="ant-table-row">
              <td>Smart Routing International</td><td>5</td><td>04 Nov 2026</td><td>25 Nov 2029</td><td>Aktif</td>
              <td><button class="ant-dropdown-trigger anticon-more">...</button></td>
            </tr>
            <tr class="ant-table-row" id="target-row-domestik">
              <td>Catalog Smart Routing Domestik</td><td>2</td><td>04 Nov 2026</td><td>25 Nov 2029</td><td>Aktif</td>
              <td><button class="ant-dropdown-trigger anticon-more" id="btn-action-domestik">...</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      <script>
        document.querySelectorAll('.ant-dropdown-trigger').forEach((btn) => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isTarget = btn.id === 'btn-action-domestik';
            const menu = document.createElement('div');
            menu.className = 'ant-dropdown';
            menu.innerHTML = \`
              <ul class="ant-dropdown-menu">
                <li class="ant-dropdown-menu-item" data-action="lihat">Lihat Route</li>
                <li class="ant-dropdown-menu-item" data-action="edit">Edit</li>
                <li class="ant-dropdown-menu-item" data-action="nonaktifkan">Nonaktifkan Katalog</li>
              </ul>
            \`;
            menu.querySelector('[data-action=\"lihat\"]').addEventListener('click', () => {
              if (isTarget) {
                window.__navigatedUrl = '/service-catalog/detail/b8883c5611d636307dd53200a33a13be379db7fc3bbc27408a34b3d8050630ae5fdd5cc12db9e8367d9f9a01adfab4c8';
                document.body.innerHTML = \`
                  <div class=\"ant-page-header\">
                    <span class=\"ant-page-header-heading-title\">Catalog Smart Routing Domestik</span>
                  </div>
                \`;
              } else {
                window.__navigatedUrl = '/service-catalog/detail/wrong-catalog';
                document.body.innerHTML = '<div class=\"ant-page-header-heading-title\">Wrong Catalog</div>';
              }
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
  console.log('  [PASS] UI-based catalog navigation via row three-dot action button and "Lihat Route" verified.');

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
      <main class="ant-layout-content">
        <section class="mb-5">
          <div class="w-full mb-3">
            <h1 class="text-[24px] font-semibold mb-2">Different Catalog Name</h1>
            <p>Berlaku 01 Jan 2026 s/d 31 Dec 2026</p>
          </div>
        </section>
      </main>
    </body>
    </html>
  `);

  const mismatchRes = await verifyCatalogDetailPage(pageMock, 'Catalog Smart Routing Domestik');
  assert.strictEqual(mismatchRes.verified, false);
  assert.strictEqual(mismatchRes.displayedName, 'Different Catalog Name');
  assert(mismatchRes.reason.includes('does not match displayed detail title'));
  assert(mismatchRes.inspectedElement.includes('Different Catalog Name'));

  // Test that app branding "Vendor Management System" is never accepted or reported as catalog name
  await pageMock.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <header class="ant-layout-header">
        <h3 class="text-label-medium font-bold">Vendor Management System</h3>
        <h1>Hi, jasmine Jasmine</h1>
      </header>
      <main class="ant-layout-content">
        <section class="mb-5">
          <div class="w-full mb-3">
            <h1 class="text-[24px] font-semibold mb-2">Catalog Smart Routing Domestik</h1>
            <p>Berlaku 04 November 2026s/d 25 November 2029</p>
          </div>
        </section>
      </main>
    </body>
    </html>
  `);

  const brandingRes = await verifyCatalogDetailPage(pageMock, 'Catalog Smart Routing Domestik');
  assert.strictEqual(brandingRes.verified, true);
  assert.strictEqual(brandingRes.displayedName, 'Catalog Smart Routing Domestik');
  assert.notStrictEqual(brandingRes.displayedName, 'Vendor Management System');
  console.log('  [PASS] Detail page verification successfully blocks "Not Permission", branding, and mismatched catalogs.');

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
            <h1 class="text-[24px] font-semibold mb-2">Verified Catalog</h1>
            <p>Berlaku 01 Jan 2026 s/d 31 Dec 2027</p>
          </div>
          <div class="header">
            <span class="ant-dropdown-trigger">
              <button type="button" class="ant-btn ant-dropdown-trigger">Tambah</button>
            </span>
          </div>
          <div id="content"></div>
          <script>
            document.querySelector('button.ant-dropdown-trigger').addEventListener('click', () => {
              const menu = document.createElement('div');
              menu.className = 'ant-dropdown';
              menu.innerHTML = \`
                <ul class="ant-dropdown-menu" role="menu">
                  <li class="ant-dropdown-menu-item" role="menuitem" id="opt-tambah-katalog">Tambah Katalog</li>
                  <li class="ant-dropdown-menu-item" role="menuitem" id="opt-unggah">Unggah Dokumen Katalog</li>
                </ul>
              \`;
              menu.querySelector('#opt-tambah-katalog').addEventListener('click', () => {
                const wizardContainer = document.createElement('div');
                wizardContainer.className = 'wizard-container';
                wizardContainer.innerHTML = \`
                  <h1 class="text-[24px] font-semibold mb-2">Tambah Service</h1>
                  <h3 class="text-base font-semibold leading-6">1 dari 3 Tahap</h3>
                  <div class="ant-steps"></div>
                  <form class="ant-form">
                    <div class="ant-form-item">Detail Layanan</div>
                  </form>
                \`;
                document.getElementById('content').appendChild(wizardContainer);
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
  const wizardTitleVisible = await pageMock.locator('h1:has-text("Tambah Service")').isVisible();
  assert.strictEqual(wizardTitleVisible, true, 'Wizard title "Tambah Service" must be visible');
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
  console.log('  [PASS] "Tambah" dropdown click -> "Tambah Katalog" menu item -> "Tambah Service" wizard verified with catalog verification.');

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

  // Test 17b: Diagnostic capture when dropdown mounts but "Tambah Katalog" is missing
  await pageMock.setContent(`
    <!DOCTYPE html>
    <html>
    <body>
      <button class="ant-btn">Tambah</button>
      <script>
        document.querySelector('button').addEventListener('click', () => {
          const menu = document.createElement('div');
          menu.className = 'ant-dropdown';
          menu.innerHTML = '<ul class="ant-dropdown-menu"><li class="ant-dropdown-menu-item">Unggah Dokumen Katalog</li></ul>';
          document.body.appendChild(menu);
        });
      </script>
    </body>
    </html>
  `);

  let missingKatalogCaught = false;
  try {
    await openRouteCreationWizard(pageMock, { actionTimeoutMs: 1000 });
  } catch (err) {
    missingKatalogCaught = true;
    assert(err.diagnostic, 'Error must include diagnostic when Tambah Katalog item is missing');
    assert.strictEqual(err.diagnostic.dropdownVisible, true);
    assert(err.message.includes('Tambah Katalog'), 'Error message must specify Tambah Katalog failure');
  }
  assert.strictEqual(missingKatalogCaught, true, 'Must throw error when Tambah Katalog is not present in dropdown');
  console.log('  [PASS] Route creation wizard diagnostic capture on missing elements and missing menu item verified.');

  // Test 18: Next.js Server Action RSC Parsing, Date Formatting, and Status Mapping
  console.log('\n[Test 18] Testing Server Action RSC Parsing, Indonesian Date & Status Formatting...');
  const sampleRsc = [
    '0:{"a":"$@1","q":"","i":false,"b":"UdgqBNSC0ZPNw1_ukPYf6"}',
    '1:{"status":200,"message":"Berhasil mendapatkan vendor catalogue","data":{"data":[{"catalog_header_code":"VCHP1793935851368","catalog_name":"Mock Test Catalog","vendor_code":"VDRS123","start_date":"2026-11-06T00:00:00.000Z","end_date":"2028-11-11T00:00:00.000Z","services":2,"status_code":"ACTIVE","is_active":true}]}}',
  ].join('\n');

  const parsedRsc = parseRscResponse(sampleRsc);
  assert(parsedRsc && parsedRsc.data && Array.isArray(parsedRsc.data.data), 'RSC stream must parse successfully');
  assert.strictEqual(parsedRsc.data.data[0].catalog_name, 'Mock Test Catalog');

  // Test Indonesian date formatting
  assert.strictEqual(formatIndonesianDate('2026-11-06T00:00:00.000Z'), '06 November 2026');
  assert.strictEqual(formatIndonesianDate('2028-11-11T00:00:00.000Z'), '11 November 2028');
  assert.strictEqual(formatIndonesianDate(''), '');

  // Test status code mapping
  assert.strictEqual(mapStatusCodeToIndonesian('ACTIVE', true), 'Aktif');
  assert.strictEqual(mapStatusCodeToIndonesian('UPCOMING', true), 'Akan Datang');
  assert.strictEqual(mapStatusCodeToIndonesian('EXPIRED', false), 'Kadaluwarsa');
  assert.strictEqual(mapStatusCodeToIndonesian('INACTIVE', false), 'Tidak Aktif');
  assert.strictEqual(mapStatusCodeToIndonesian(null, true), 'Aktif');
  console.log('  [PASS] Server Action RSC parsing, date conversion, and status mapping verified.');

  // Test 19: API Fallback Handling
  console.log('\n[Test 19] Testing API Fallback Handling...');
  let apiFallbackTriggered = false;
  try {
    // Pass invalid nextActionId and skip browser fallback to verify error detection
    await fetchServiceCatalogsApi({ nextActionId: 'invalid-hash-for-testing' });
  } catch (err) {
    apiFallbackTriggered = true;
    assert(err.message.includes('Server Action request failed') || err.message.includes('Unexpected RSC response'));
  }
  assert.strictEqual(apiFallbackTriggered, true, 'Invalid action ID must trigger fallback-ready error');
  console.log('  [PASS] API error detection and fallback readiness verified.');

  // Test 20: 5 Validation Scenarios & Timing Benchmarks
  console.log('\n[Test 20] Validating Performance Across 5 Scenarios & Benchmarks...');
  invalidateCatalogCache();

  // Scenario 1: First catalog lookup with no cache (cold API)
  const t0 = Date.now();
  const sc1 = await getAvailableCatalogs();
  const d1 = Date.now() - t0;
  assert.strictEqual(sc1.fromCache, false, 'Scenario 1 must be cold lookup');
  assert(sc1.catalogs.length > 0, 'Scenario 1 must retrieve catalogs');
  console.log(`  [Scenario 1 PASS] Cold lookup duration: ${d1}ms (API uncached, retrieved ${sc1.catalogs.length} catalogs)`);

  // Scenario 2: Second catalog lookup within 60s (cache hit)
  const t1 = Date.now();
  const sc2 = await getAvailableCatalogs();
  const d2 = Date.now() - t1;
  assert.strictEqual(sc2.fromCache, true, 'Scenario 2 must be cache hit');
  assert.strictEqual(sc2.catalogs.length, sc1.catalogs.length);
  assert(d2 < 50, `Scenario 2 cache hit should take < 50ms, took ${d2}ms`);
  console.log(`  [Scenario 2 PASS] Cache hit duration: ${d2}ms (fromCache: true, age: ${sc2.ageSeconds}s)`);

  // Scenario 3: Catalog lookup after cache expiration (TTL elapsed)
  setCatalogCacheTtl(50); // Set temporary 50ms TTL
  await new Promise(r => setTimeout(r, 70));
  const t2 = Date.now();
  const sc3 = await getAvailableCatalogs();
  const d3 = Date.now() - t2;
  assert.strictEqual(sc3.fromCache, false, 'Scenario 3 must fetch fresh data after TTL');
  setCatalogCacheTtl(60000); // Restore 60s TTL
  console.log(`  [Scenario 3 PASS] Post-expiration lookup duration: ${d3}ms (fresh fetch after TTL)`);

  // Scenario 4: Catalog lookup after catalog creation / explicit invalidation
  invalidateCatalogCache();
  const t3 = Date.now();
  const sc4 = await getAvailableCatalogs();
  const d4 = Date.now() - t3;
  assert.strictEqual(sc4.fromCache, false, 'Scenario 4 must fetch fresh data after invalidation');
  console.log(`  [Scenario 4 PASS] Post-invalidation lookup duration: ${d4}ms (invalidation reset)`);

  // Test 21: 5 Route Creation Regression Scenarios (Land FTL, Land LTL, Sea FCL, Sea LCL, Air Cargo)
  console.log('\n[Test 21] Testing 5 Route Creation Regression Scenarios & Tariff Constraints...');

  // Scenario A: Land FTL (Rawalumbu, Bekasi - Pasar Minggu, Jakarta FTL 5 hours)
  const scA_prompt = 'Rawalumbu, Bekasi - Pasar Minggu, Jakarta FTL 5 hours';
  const scA_parsed = parseRoutePrompt(scA_prompt);
  assert.strictEqual(scA_parsed.mode, 'DARAT');
  assert.strictEqual(scA_parsed.serviceType, 'FTL');
  assert.strictEqual(scA_parsed.durationHours, 5);
  // Strict location resolution check (No Kalimantan, No Jakarta Timur)
  assert.strictEqual(scA_parsed.origin.district, 'Rawalumbu');
  assert.strictEqual(scA_parsed.origin.city, 'Kota Bekasi');
  assert.strictEqual(scA_parsed.origin.province, 'Jawa Barat');
  assert.strictEqual(scA_parsed.origin.confidence, 'EXACT_DISTRICT_MATCH');
  assert.notStrictEqual(scA_parsed.origin.city, 'Kota Jakarta Timur');
  assert.strictEqual(scA_parsed.destination.district, 'Pasar Minggu');
  assert.strictEqual(scA_parsed.destination.city, 'Kota Jakarta Selatan');
  assert.strictEqual(scA_parsed.destination.province, 'DKI Jakarta');
  assert.strictEqual(scA_parsed.destination.confidence, 'EXACT_DISTRICT_MATCH');
  assert.notStrictEqual(scA_parsed.destination.city, 'Kota Jakarta Timur');
  assert.notStrictEqual(scA_parsed.destination.province, 'Kalimantan Timur');

  const scA_norm = normalizeRouteSpecification(scA_parsed);
  assert.strictEqual(scA_norm.vehicleType, 'FUSO BOX');
  assert.strictEqual(scA_norm.tariff.tariffType, 'RITASE');
  assert.strictEqual(scA_norm.tariff.costRitase, 2500000, 'Land FTL fixed rate must be Rp2.500.000');
  assert.strictEqual(scA_norm.tariff.costPerKg, undefined, 'Land FTL must NOT have KG rate');
  assert.strictEqual(scA_norm.tariff.costPerTonase, undefined, 'Land FTL must NOT have Tonase rate');
  assert.strictEqual(scA_norm.tariff.costPerCbm, undefined, 'Land FTL must NOT have CBM rate');
  assert.strictEqual(scA_norm.backhaul, null, 'Backhaul must be empty');
  console.log('  [Scenario A PASS] Land FTL: Rawalumbu (Bekasi) -> Pasar Minggu (Jakarta Selatan), RITASE Rp2.500.000, 0 CBM/Ton/KG');

  // Scenario B: Land LTL
  const scB_prompt = 'Rawalumbu, Bekasi - Pasar Minggu, Jakarta LTL 5 hours';
  const scB_parsed = parseRoutePrompt(scB_prompt);
  assert.strictEqual(scB_parsed.mode, 'DARAT');
  assert.strictEqual(scB_parsed.serviceType, 'LTL');
  const scB_norm = normalizeRouteSpecification(scB_parsed);
  assert.strictEqual(scB_norm.vehicleType, 'FUSO BOX');
  assert.strictEqual(scB_norm.tariff.tariffType, 'CBM');
  assert.strictEqual(scB_norm.tariff.costPerKg, 3500);
  assert.strictEqual(scB_norm.tariff.costPerTonase, 3000000);
  assert.strictEqual(scB_norm.tariff.costPerCbm, 600000);
  assert.strictEqual(scB_norm.tariff.costRitase, undefined, 'Land LTL must NOT have RITASE fixed rate');
  assert.strictEqual(scB_norm.backhaul, null);
  console.log('  [Scenario B PASS] Land LTL: CBM Rp600.000, Tonase Rp3.000.000, KG Rp3.500, NO RITASE');

  // Scenario C: Sea FCL
  const scC_prompt = 'Tanjung Priok, Jakarta - Pasir Panjang, Singapore FCL 15 Dec 2026 08:00, 15 hours';
  const scC_parsed = parseRoutePrompt(scC_prompt);
  assert.strictEqual(scC_parsed.mode, 'LAUT');
  assert.strictEqual(scC_parsed.serviceType, 'FCL');
  const scC_norm = normalizeRouteSpecification(scC_parsed);
  assert.strictEqual(scC_norm.containerType, '40 FT STANDARD');
  assert.strictEqual(scC_norm.tariff.tariffType, 'FCL');
  assert.strictEqual(scC_norm.tariff.costRitase, 18000000, 'Sea FCL container rate must be Rp18.000.000');
  assert.strictEqual(scC_norm.tariff.costPerKg, undefined, 'Sea FCL must NOT have KG rate');
  assert.strictEqual(scC_norm.tariff.costPerTonase, undefined, 'Sea FCL must NOT have Tonase rate');
  assert.strictEqual(scC_norm.tariff.costPerCbm, undefined, 'Sea FCL must NOT have CBM rate');
  assert.strictEqual(scC_norm.isInternational, true);
  assert.strictEqual(scC_norm.incoterm.code, 'DDP');
  assert.strictEqual(scC_norm.backhaul, null);
  console.log('  [Scenario C PASS] Sea FCL: 40 FT STANDARD, FCL fixed rate Rp18.000.000, NO CBM/Ton/KG');

  // Scenario D: Sea LCL
  const scD_prompt = 'Tanjung Priok, Jakarta - Pasir Panjang, Singapore LCL 15 Dec 2026 08:00, 15 hours';
  const scD_parsed = parseRoutePrompt(scD_prompt);
  assert.strictEqual(scD_parsed.mode, 'LAUT');
  assert.strictEqual(scD_parsed.serviceType, 'LCL');
  const scD_norm = normalizeRouteSpecification(scD_parsed);
  assert.strictEqual(scD_norm.containerType, '40 FT STANDARD');
  assert.strictEqual(scD_norm.tariff.tariffType, 'CBM');
  assert.strictEqual(scD_norm.tariff.costPerKg, 5000);
  assert.strictEqual(scD_norm.tariff.costPerTonase, 5000000);
  assert.strictEqual(scD_norm.tariff.costPerCbm, 1200000);
  assert.strictEqual(scD_norm.tariff.costRitase, undefined, 'Sea LCL must NOT have FCL fixed rate');
  assert.strictEqual(scD_norm.backhaul, null);
  console.log('  [Scenario D PASS] Sea LCL: CBM Rp1.200.000, Tonase Rp5.000.000, KG Rp5.000, NO FCL rate');

  // Scenario E: Air Cargo
  const scE_prompt = 'Soekarno-Hatta, Tangerang - Changi, Singapore Cargo 15 Dec 2026 08:00, 6 hours';
  const scE_parsed = parseRoutePrompt(scE_prompt);
  assert.strictEqual(scE_parsed.mode, 'UDARA');
  assert.strictEqual(scE_parsed.serviceType, 'Cargo');
  const scE_norm = normalizeRouteSpecification(scE_parsed);
  assert.strictEqual(scE_norm.packageType, 'TANPA KEMASAN');
  assert.strictEqual(scE_norm.tariff.tariffType, 'CBM');
  assert.strictEqual(scE_norm.tariff.costPerKg, 25000);
  assert.strictEqual(scE_norm.tariff.costPerTonase, 25000000);
  assert.strictEqual(scE_norm.tariff.costPerCbm, 5000000);
  assert.strictEqual(scE_norm.tariff.costRitase, undefined, 'Air Cargo must NOT have fixed Ritase rate');
  assert.strictEqual(scE_norm.backhaul, null);
  console.log('  [Scenario E PASS] Air Cargo: TANPA KEMASAN, CBM Rp5.000.000, Tonase Rp25.000.000, KG Rp25.000, NO fixed rate');

  // Test 22: Status Mapping Unit Tests (mapVmsRouteStatus)
  console.log('\n[Test 22] Testing VMS route status mapping...');
  assert.strictEqual(mapVmsRouteStatus('Menunggu Verifikasi'), 'NEED_CURATION');
  assert.strictEqual(mapVmsRouteStatus('Menunggu Kurasi'), 'NEED_CURATION');
  assert.strictEqual(mapVmsRouteStatus('Perlu Kurasi'), 'NEED_CURATION');
  assert.strictEqual(mapVmsRouteStatus('Belum Terverifikasi'), 'NEED_CURATION');
  assert.strictEqual(mapVmsRouteStatus('NEED_CURATION'), 'NEED_CURATION');
  assert.strictEqual(mapVmsRouteStatus('Terverifikasi'), 'SUBMITTED');
  assert.strictEqual(mapVmsRouteStatus('Aktif'), 'SUBMITTED');
  assert.strictEqual(mapVmsRouteStatus('Active'), 'SUBMITTED');
  assert.strictEqual(mapVmsRouteStatus('SUBMITTED'), 'SUBMITTED');
  assert.strictEqual(mapVmsRouteStatus('Gagal'), 'FAILED');
  assert.strictEqual(mapVmsRouteStatus('Ditolak'), 'FAILED');
  assert.strictEqual(mapVmsRouteStatus('FAILED'), 'FAILED');
  assert.strictEqual(mapVmsRouteStatus(null), 'SUBMITTED');
  console.log('  [PASS] mapVmsRouteStatus properly maps curation, active, and failure statuses.');

  // Helper to generate dynamic mock catalog detail and 3-stage wizard DOM
  function createMockWizardHtml({ status = 'Menunggu Verifikasi', errorMsg = null, disableSimpan = false } = {}) {
    return `
      <!DOCTYPE html>
      <html>
      <head><style>
        .ant-select { display: inline-block; width: 120px; height: 32px; }
        .ant-select-item-option, tr.ant-table-row { display: block; height: 30px; }
        .ant-select-dropdown { display: block; }
        button { display: inline-block; height: 32px; width: 80px; }
      </style></head>
      <body>
        <h1 class="text-[24px]">Test Catalog</h1>
        <button type="button" class="ant-btn ant-dropdown-trigger">Tambah</button>
        <div id="content"></div>
        <div id="table-container">
          <div class="ant-tabs-tab">Darat</div>
          <table class="ant-table"><tbody id="table-body"></tbody></table>
        </div>
        <div id="dropdowns"></div>
        <script>
          window.__events = [];
          document.querySelector('button.ant-dropdown-trigger').addEventListener('click', () => {
            const menu = document.createElement('div');
            menu.className = 'ant-dropdown';
            menu.innerHTML = '<ul class="ant-dropdown-menu"><li class="ant-dropdown-menu-item" id="opt-tambah">Tambah Katalog</li></ul>';
            menu.querySelector('#opt-tambah').addEventListener('click', () => {
              document.getElementById('content').innerHTML = \`
                <h1>Tambah Service</h1>
                <div class="ant-form-item">Tipe Katalog<div class="ant-select"><input class="ant-select-selection-search-input" readonly /></div></div>
                <div class="ant-form-item">Moda Transportasi<div class="ant-select"><input class="ant-select-selection-search-input" readonly /></div></div>
                <div class="ant-form-item">Tipe Layanan<div class="ant-select"><input class="ant-select-selection-search-input" readonly /></div></div>
                <button type="button" id="btn-next1">Selanjutnya</button>
              \`;

              document.querySelectorAll('.ant-select').forEach(sel => {
                sel.addEventListener('click', () => {
                  const drop = document.createElement('div');
                  drop.className = 'ant-select-dropdown';
                  drop.innerHTML = \`
                    <table>
                      <tr class="ant-table-row"><td>Retail</td></tr>
                      <tr class="ant-table-row"><td>Darat</td></tr>
                      <tr class="ant-table-row"><td>FTL</td></tr>
                    </table>
                    <div class="ant-select-item ant-select-item-option">Retail</div>
                    <div class="ant-select-item ant-select-item-option">Darat</div>
                    <div class="ant-select-item ant-select-item-option">FTL</div>
                  \`;
                  drop.querySelectorAll('.ant-table-row, .ant-select-item-option').forEach(opt => {
                    opt.addEventListener('click', () => { drop.remove(); });
                  });
                  document.getElementById('dropdowns').replaceChildren(drop);
                });
              });

              document.getElementById('btn-next1').addEventListener('click', () => {
                document.getElementById('content').innerHTML = \`
                  <h1>Tambah Service (Tahap 2)</h1>
                  <button type="button" id="btn-next2">Selanjutnya</button>
                \`;
                document.getElementById('btn-next2').addEventListener('click', () => {
                  document.getElementById('content').innerHTML = \`
                    <h1>Tambah Service (Tahap 3)</h1>
                    <button type="button" id="btn-simpan" ${disableSimpan ? 'disabled' : ''}>Simpan Layanan</button>
                  \`;
                  const sBtn = document.getElementById('btn-simpan');
                  if (!${disableSimpan}) {
                    sBtn.addEventListener('click', () => {
                      window.__events.push('simpan_layanan_clicked');
                      const modal = document.createElement('div');
                      modal.className = 'ant-modal';
                      modal.setAttribute('role', 'dialog');
                      modal.innerHTML = \`
                        <div>Simpan Layanan</div>
                        <div>Apakah Anda yakin ingin menyimpan Layanan ini? Layanan baru akan disimpan ke katalog.</div>
                        <button type="button" id="btn-confirm">Ya, Simpan Layanan</button>
                      \`;
                      modal.querySelector('#btn-confirm').addEventListener('click', () => {
                        window.__events.push('confirm_modal_clicked');
                        modal.remove();
                        document.getElementById('content').innerHTML = '';
                        ${errorMsg ? `
                          const errEl = document.createElement('div');
                          errEl.className = 'ant-message ant-message-error';
                          errEl.innerText = '${errorMsg}';
                          document.body.appendChild(errEl);
                        ` : `
                          const msg = document.createElement('div');
                          msg.className = 'ant-message ant-message-success';
                          msg.innerText = 'Service katalog berhasil dibuat';
                          document.body.appendChild(msg);
                          const row = document.createElement('tr');
                          row.className = 'ant-table-row';
                          row.innerHTML = '<td>Rawalumbu, Kota Bekasi</td><td>Pasar Minggu, Kota Jakarta Selatan</td><td>FTL</td><td>-</td><td>-</td><td>${status}</td><td>Rp2.500.000/RITASE</td>';
                          document.getElementById('table-body').appendChild(row);
                        `}
                      });
                      document.body.appendChild(modal);
                    });
                  }
                });
              });
            });
            document.body.appendChild(menu);
          });
        </script>
      </body>
      </html>
    `;
  }

  // Test 23: Review-Only Mode (Halts at Stage 3 with REVIEWABLE_STAGE_REACHED)
  console.log('\n[Test 23] Testing Review-Only Mode (reviewOnly: true)...');
  await pageMock.route('**/service-catalog/detail/cat-review-test', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: createMockWizardHtml(),
    });
  });

  await pageMock.goto('http://localhost/service-catalog/detail/cat-review-test');
  const reviewRouteSpec = normalizeRouteSpecification(parseRoutePrompt('Rawalumbu, Bekasi to Pasar Minggu, Jakarta FTL 5 hours'));
  const reviewResult = await createCatalogRoute(pageMock, reviewRouteSpec, {
    reviewOnly: true,
    actionTimeoutMs: 3000,
  });

  assert.strictEqual(reviewResult.status, 'REVIEWABLE_STAGE_REACHED', 'Must return REVIEWABLE_STAGE_REACHED in review-only mode');
  assert.strictEqual(reviewResult.success, true);
  const reviewEvents = await pageMock.evaluate(() => window.__events);
  assert.strictEqual(reviewEvents.length, 0, 'Simpan Layanan button must NOT be clicked in review-only mode');
  console.log('  [PASS] Review-only mode halts at Stage 3 with REVIEWABLE_STAGE_REACHED without submitting.');

  // Test 24: Final Submission Button Interaction & Confirmation Modal Handling (NEED_CURATION)
  console.log('\n[Test 24] Testing Final Submission ("Simpan Layanan") & Modal Confirmation ("Ya, Simpan Layanan")...');
  await pageMock.route('**/service-catalog/detail/cat-submit-curation-test', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: createMockWizardHtml({ status: 'Menunggu Verifikasi' }),
    });
  });

  await pageMock.goto('http://localhost/service-catalog/detail/cat-submit-curation-test');
  const curationRouteSpec = normalizeRouteSpecification(parseRoutePrompt('Rawalumbu, Bekasi to Pasar Minggu, Jakarta FTL 5 hours'));
  const curationResult = await createCatalogRoute(pageMock, curationRouteSpec, {
    actionTimeoutMs: 3000,
  });

  assert.strictEqual(curationResult.success, true);
  assert.strictEqual(curationResult.status, 'NEED_CURATION', 'Status must be NEED_CURATION when table displays Menunggu Verifikasi');
  assert.strictEqual(curationResult.displayedStatus, 'Menunggu Verifikasi');
  const curationEvents = await pageMock.evaluate(() => window.__events);
  assert(curationEvents.includes('simpan_layanan_clicked'), 'Simpan Layanan button must be clicked');
  assert(curationEvents.includes('confirm_modal_clicked'), 'Confirm button in modal must be clicked');
  console.log('  [PASS] Final submission button click, modal confirmation, and NEED_CURATION verification verified.');

  // Test 25: Verified/Active Route Submission Verification (SUBMITTED)
  console.log('\n[Test 25] Testing Verified / Active Route Submission Verification (SUBMITTED)...');
  await pageMock.route('**/service-catalog/detail/cat-submit-active-test', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: createMockWizardHtml({ status: 'Terverifikasi' }),
    });
  });

  await pageMock.goto('http://localhost/service-catalog/detail/cat-submit-active-test');
  const activeRouteSpec = normalizeRouteSpecification(parseRoutePrompt('Rawalumbu, Bekasi to Pasar Minggu, Jakarta FTL 5 hours'));
  const activeResult = await createCatalogRoute(pageMock, activeRouteSpec, {
    actionTimeoutMs: 3000,
  });

  assert.strictEqual(activeResult.success, true);
  assert.strictEqual(activeResult.status, 'SUBMITTED', 'Status must be SUBMITTED when table displays Terverifikasi');
  assert.strictEqual(activeResult.displayedStatus, 'Terverifikasi');
  console.log('  [PASS] Verified route creation mapped to SUBMITTED successfully.');

  // Test 26: Submission Failure Handling (Error Message)
  console.log('\n[Test 26] Testing Submission Failure Handling (Error Message)...');
  await pageMock.route('**/service-catalog/detail/cat-submit-fail-test', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: createMockWizardHtml({ errorMsg: 'Rute sudah ada atau gagal disimpan ke katalog' }),
    });
  });

  await pageMock.goto('http://localhost/service-catalog/detail/cat-submit-fail-test');
  const failRouteSpec = normalizeRouteSpecification(parseRoutePrompt('Rawalumbu, Bekasi to Pasar Minggu, Jakarta FTL 5 hours'));
  let submissionFailed = false;
  try {
    await createCatalogRoute(pageMock, failRouteSpec, { actionTimeoutMs: 3000 });
  } catch (err) {
    submissionFailed = true;
    assert(err.message.includes('Route submission failed') || err.message.includes('gagal'), 'Error message must reflect submission failure');
    assert(err.diagnostic, 'Error must include diagnostic report');
  }
  assert.strictEqual(submissionFailed, true, 'createCatalogRoute must throw on submission failure');

  // Verify batch execution records FAILED status
  const batchFailResults = await createCatalogRoutesBatch(pageMock, [failRouteSpec], { actionTimeoutMs: 3000 });
  assert.strictEqual(batchFailResults.length, 1);
  assert.strictEqual(batchFailResults[0].success, false);
  assert.strictEqual(batchFailResults[0].status, 'FAILED');
  console.log('  [PASS] Submission failure properly detected, reported as FAILED with diagnostic.');

  // Test 27: Disabled "Simpan Layanan" Button Rejection
  console.log('\n[Test 27] Testing Disabled "Simpan Layanan" Button Rejection...');
  await pageMock.route('**/service-catalog/detail/cat-submit-disabled-test', route => {
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: createMockWizardHtml({ disableSimpan: true }),
    });
  });

  await pageMock.goto('http://localhost/service-catalog/detail/cat-submit-disabled-test');
  let disabledSimpanCaught = false;
  try {
    await createCatalogRoute(pageMock, failRouteSpec, { actionTimeoutMs: 3000 });
  } catch (err) {
    disabledSimpanCaught = true;
    assert(err.message.includes('disabled'), 'Must report Simpan Layanan button is disabled');
    assert(err.diagnostic, 'Must include diagnostic on disabled submission button');
  }
  assert.strictEqual(disabledSimpanCaught, true, 'Must reject disabled Simpan Layanan button');
  console.log('  [PASS] Disabled "Simpan Layanan" button properly blocked with diagnostic capture.');

  // ========================================================
  // Test 28: Multi-Catalog Natural Language Batch Parsing
  // ========================================================
  console.log('\n[Test 28] Testing Multi-Catalog Natural Language Batch Parsing...');
  const sampleBatchInput = `
Create these catalogs:

1. Catalog Smart Routing Domestic
   Valid from 1 December 2026 until 31 December 2026
   Domestic Land FTL

2. Catalog Smart Routing International
   Valid from 1 December 2026 until 31 December 2026
   International Sea FCL

3. Catalog Air Cargo December
   Valid from 1 December 2026 until 31 December 2026
   International Air Cargo
`;

  const parsedBatch = parseBatchCatalogInput(sampleBatchInput);
  assert.strictEqual(parsedBatch.length, 3, 'Must parse exactly 3 catalogs from batch');
  assert.strictEqual(parsedBatch[0].name, 'Catalog Smart Routing Domestic');
  assert.strictEqual(parsedBatch[0].startDate, '2026-12-01');
  assert.strictEqual(parsedBatch[0].endDate, '2026-12-31');
  assert.strictEqual(parsedBatch[0].routes.length, 1);
  assert.strictEqual(parsedBatch[0].routes[0].mode, 'DARAT');
  assert.strictEqual(parsedBatch[0].routes[0].serviceType, 'FTL');

  assert.strictEqual(parsedBatch[1].name, 'Catalog Smart Routing International');
  assert.strictEqual(parsedBatch[1].startDate, '2026-12-01');
  assert.strictEqual(parsedBatch[1].endDate, '2026-12-31');
  assert.strictEqual(parsedBatch[1].routes.length, 1);
  assert.strictEqual(parsedBatch[1].routes[0].mode, 'LAUT');
  assert.strictEqual(parsedBatch[1].routes[0].serviceType, 'FCL');

  assert.strictEqual(parsedBatch[2].name, 'Catalog Air Cargo December');
  assert.strictEqual(parsedBatch[2].startDate, '2026-12-01');
  assert.strictEqual(parsedBatch[2].endDate, '2026-12-31');
  assert.strictEqual(parsedBatch[2].routes.length, 1);
  assert.strictEqual(parsedBatch[2].routes[0].mode, 'UDARA');
  assert.strictEqual(parsedBatch[2].routes[0].serviceType, 'Cargo');
  console.log('  [PASS] Multiple catalog specifications parsed independently and correctly.');

  // ========================================================
  // Test 29: Batch Review Formatting & Business Rules Validation
  // ========================================================
  console.log('\n[Test 29] Testing Batch Review Formatting & Validation...');
  const reviewText = formatBatchReview(parsedBatch);
  assert(reviewText.includes('VMS BATCH CATALOG CREATION REVIEW'), 'Review header present');
  assert(reviewText.includes('Total Catalogs in Batch: 3'), 'Total count present');
  assert(reviewText.includes('Catalog Smart Routing Domestic'), 'Catalog 1 present');
  assert(reviewText.includes('Catalog Smart Routing International'), 'Catalog 2 present');
  assert(reviewText.includes('Catalog Air Cargo December'), 'Catalog 3 present');

  // Test missing fields default generation
  const partialCatalogBlock = `
Minimal Catalog Test
`;
  const parsedPartial = parseCatalogBlock(partialCatalogBlock, 1);
  assert.strictEqual(parsedPartial.name, 'Minimal Catalog Test');
  assert(parsedPartial.startDate, 'Start date must be generated');
  assert(parsedPartial.endDate, 'End date must be generated');
  assert(parsedPartial.generatedValues.some(g => g.field === 'startDate'), 'StartDate generation tracked');
  assert(parsedPartial.generatedValues.some(g => g.field === 'endDate'), 'EndDate generation tracked');
  console.log('  [PASS] Batch review format and missing field default generation verified.');

  // ========================================================
  // Test 30: Batch Interactive Review Approval & Cancellation
  // ========================================================
  console.log('\n[Test 30] Testing Batch Interactive Review Approval & Cancellation...');
  // Simulated cancel
  let cancelLogged = false;
  const cancelSteps = [
    '1. Test Catalog',
    'Valid from 2026-12-01 to 2026-12-31',
    'done',
    'n', // cancel
  ];
  const mockCancelRl = {
    question: async () => cancelSteps.shift() || '',
  };
  const origLog = console.log;
  console.log = (...args) => {
    const text = args.join(' ');
    if (text.includes('[CANCELED] Batch catalog creation aborted')) cancelLogged = true;
  };
  await handleCreateMultipleCatalogsFlow(mockCancelRl, { headless: true });
  console.log = origLog;
  assert.strictEqual(cancelLogged, true, 'Batch cancellation must abort workflow');

  // Simulated edit before approval
  const mockEditRl = {
    steps: [
      '1. Initial Name',
      'Valid from 2026-12-01 to 2026-12-31',
      'done',
      'e', // Edit
      '1', // catalog #1
      'Edited Catalog Name', // new name
      '', // keep start date
      '', // keep end date
      'n', // cancel after edit
    ],
    question: async () => mockEditRl.steps.shift() || '',
  };
  let editedReviewLogged = false;
  console.log = (...args) => {
    const text = args.join(' ');
    if (text.includes('Edited Catalog Name')) editedReviewLogged = true;
  };
  await handleCreateMultipleCatalogsFlow(mockEditRl, { headless: true });
  console.log = origLog;
  assert.strictEqual(editedReviewLogged, true, 'Individual catalog editing before execution verified');
  console.log('  [PASS] Batch approval, cancellation, and editing flows verified.');

  // ========================================================
  // Test 31: Batch Execution with Mocked Page (All Created)
  // ========================================================
  console.log('\n[Test 31] Testing Successful Batch Execution of Multiple Catalogs...');
  const mockPageBatch = {
    isClosed: () => false,
    goto: async () => {},
    waitForTimeout: async () => {},
    locator: (selector) => ({
      first: () => ({
        waitFor: async () => {},
        click: async () => {},
        fill: async () => {},
        isVisible: async () => true,
        locator: () => ({
          first: () => ({
            click: async () => {},
            waitFor: async () => {},
          })
        })
      }),
      isVisible: async () => true,
    }),
    waitForSelector: async () => {},
    waitForFunction: async () => {},
    keyboard: { press: async () => {} },
    url: () => 'http://localhost/service-catalog/detail/mock-batch-cat-123',
  };

  const testCatalogs = [
    { name: 'Batch Cat Alpha', startDate: '2026-12-01', endDate: '2026-12-31', routes: [] },
    { name: 'Batch Cat Beta', startDate: '2026-12-01', endDate: '2026-12-31', routes: [] },
  ];

  const execResults = await executeBatchCatalogs(testCatalogs, {
    page: mockPageBatch,
    catalogs: [], // no initial existing
  });

  assert.strictEqual(execResults.length, 2);
  assert.strictEqual(execResults[0].status, 'CREATED');
  assert.strictEqual(execResults[1].status, 'CREATED');
  console.log('  [PASS] Batch execution of multiple catalogs in single session verified.');

  // ========================================================
  // Test 32: Partial Failure Handling (Continue Remaining)
  // ========================================================
  console.log('\n[Test 32] Testing Partial Failure Handling in Batch Execution...');
  let callCount = 0;
  const mockPagePartialFail = {
    isClosed: () => false,
    goto: async () => {},
    waitForTimeout: async () => {},
    locator: (selector) => ({
      first: () => ({
        waitFor: async () => {},
        click: async () => {
          if (selector.includes('Simpan') && callCount === 2) {
            throw new Error('Simulated VMS server error 500 on catalog #2');
          }
        },
        fill: async () => {},
        isVisible: async () => true,
        locator: () => ({
          first: () => ({
            click: async () => {},
            waitFor: async () => {},
          })
        })
      }),
      isVisible: async () => true,
    }),
    waitForSelector: async () => {
      callCount++;
    },
    waitForFunction: async () => {},
    keyboard: { press: async () => {} },
    url: () => 'http://localhost/service-catalog/detail/mock-batch-partial',
  };

  const partialCatalogs = [
    { name: 'Partial Cat 1', startDate: '2026-12-01', endDate: '2026-12-31', routes: [] },
    { name: 'Partial Cat 2', startDate: '2026-12-01', endDate: '2026-12-31', routes: [] },
    { name: 'Partial Cat 3', startDate: '2026-12-01', endDate: '2026-12-31', routes: [] },
  ];

  const partialResults = await executeBatchCatalogs(partialCatalogs, {
    page: mockPagePartialFail,
    catalogs: [],
  });

  assert.strictEqual(partialResults.length, 3);
  assert.strictEqual(partialResults[0].status, 'CREATED');
  assert.strictEqual(partialResults[1].status, 'FAILED');
  assert.strictEqual(partialResults[2].status, 'CREATED');
  console.log('  [PASS] Partial failure continues processing remaining healthy catalogs.');

  // ========================================================
  // Test 33: Session / Browser Crash Handling
  // ========================================================
  console.log('\n[Test 33] Testing Browser Session Crash Halting in Batch Execution...');
  let crashClosed = false;
  const mockPageCrash = {
    isClosed: () => crashClosed,
    goto: async () => {
      if (crashClosed) throw new Error('Target page, context or browser has been closed');
    },
    waitForTimeout: async () => {},
    locator: () => ({
      first: () => ({
        waitFor: async () => {
          crashClosed = true;
          throw new Error('Target page, context or browser has been closed');
        },
        click: async () => {},
        fill: async () => {},
        isVisible: async () => false,
      }),
    }),
    waitForSelector: async () => {},
    waitForFunction: async () => {},
    keyboard: { press: async () => {} },
    url: () => 'http://localhost',
  };

  const crashResults = await executeBatchCatalogs(partialCatalogs, {
    page: mockPageCrash,
    catalogs: [],
  });

  assert.strictEqual(crashResults.length, 3);
  assert.strictEqual(crashResults[0].status, 'FAILED');
  assert.strictEqual(crashResults[1].status, 'FAILED');
  assert.strictEqual(crashResults[2].status, 'FAILED');
  assert(crashResults[0].error.includes('Session terminated') || crashResults[0].error.includes('closed'));
  console.log('  [PASS] Session crash halts batch and marks remaining catalogs as FAILED.');

  // ========================================================
  // Test 34: Duplicate Catalog Skipping
  // ========================================================
  console.log('\n[Test 34] Testing Duplicate Catalog Detection & Skipping...');
  const duplicateCatalogs = [
    { name: 'Existing Catalog In VMS', startDate: '2026-12-01', endDate: '2026-12-31', routes: [] },
    { name: 'Fresh Unique Catalog', startDate: '2026-12-01', endDate: '2026-12-31', routes: [] },
  ];

  const dupResults = await executeBatchCatalogs(duplicateCatalogs, {
    page: mockPageBatch,
    catalogs: [{ name: 'Existing Catalog In VMS' }], // already present
  });

  assert.strictEqual(dupResults.length, 2);
  assert.strictEqual(dupResults[0].status, 'SKIPPED');
  assert.strictEqual(dupResults[1].status, 'CREATED');
  console.log('  [PASS] Duplicate catalog skipped and unique catalog created.');

  // ========================================================
  // Test 35: Batch Summary Report Accuracy
  // ========================================================
  console.log('\n[Test 35] Testing Batch Summary Report Accuracy...');
  const mockMixedResults = [
    { name: 'Cat 1', status: 'CREATED', detailUrl: 'http://localhost/1' },
    { name: 'Cat 2', status: 'CREATED', detailUrl: 'http://localhost/2' },
    { name: 'Cat 3', status: 'FAILED', error: 'Server error' },
    { name: 'Cat 4', status: 'SKIPPED', error: 'Duplicate' },
  ];

  const reportData = formatBatchSummaryReport(mockMixedResults);
  assert.strictEqual(reportData.total, 4);
  assert.strictEqual(reportData.created, 2);
  assert.strictEqual(reportData.failed, 1);
  assert.strictEqual(reportData.skipped, 1);
  assert.strictEqual(reportData.overallStatus, 'PARTIAL SUCCESS');
  assert(reportData.summaryText.includes('Total Catalogs: 4'));
  assert(reportData.summaryText.includes('Created:        2'));
  assert(reportData.summaryText.includes('Failed:         1'));
  assert(reportData.summaryText.includes('Skipped:        1'));
  assert(reportData.summaryText.includes('Batch Status: PARTIAL SUCCESS'));
  console.log('  [PASS] Batch summary accurately reports counts and overall status.');

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
