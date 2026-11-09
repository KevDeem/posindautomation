/**
 * Dynamic Order Specification Engine for Logistics Automation
 * 
 * Responsibilities:
 * 1. Maintains previous specification state in `.sessions/previous_order_spec.json`.
 * 2. Parses incoming natural-language or structured order specifications.
 * 3. Applies granular field-level reuse (never blindly overwriting Pickup or Drop-off).
 * 4. Generates or preserves independent PIC contacts.
 * 5. Tags every resolved field with its origin:
 *    - 'provided': explicitly supplied in the current prompt/request
 *    - 'reused': preserved from the previous valid specification
 *    - 'generated': synthesized via realistic synthetic generator
 *    - 'ui_default': resolved from application default or master data
 * 6. Generates formatted review tables and highlights missing fields.
 */

const fs = require('fs');
const path = require('path');
const {
  generateRealisticPIC,
  validatePIC,
  selectRandomPIC,
  normalizeCountry,
  getPicLibrary,
} = require('./pic_manager');
const {
  extractAdminPrefix,
  normalizeAdminCityName,
  detectLocationType,
  detectLocationCategory,
  getIndonesianIsland,
  normalizeIncoterm,
} = require('./location_matcher');
const { stripScheduleAndMetadata } = require('../bot/nl_parser');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.sessions');
const PREV_SPEC_FILE = path.join(SESSIONS_DIR, 'previous_order_spec.json');

/**
 * Standard baseline profile used when no previous specification exists.
 */
const DEFAULT_SPECIFICATION = {
  orderType: 'domestic', // 'domestic' | 'international'
  orderMode: 'non-contract', // Policy: non-contract only
  transportationMode: 'SEMUA', // 'SEMUA' | 'Land' | 'Air' | 'Sea'
  scheduledDate: '2026-11-19',
  scheduledTime: '10:00',
  pickup: {
    locationType: 'Door',
    province: 'DKI Jakarta',
    city: 'Jakarta Selatan',
    district: 'Tebet',
    subdistrict: 'Manggarai',
    address: 'Jl. Logistik Simulasi No. 15, RT 02/RW 04',
    postalCode: '12850',
    pic: {
      name: 'Kevin',
      company: 'Kevin Co',
      address: 'Jl. Logistik Simulasi No. 15, RT 02/RW 04',
      email: 'kevin@kevinco.com',
      phone: '08755029428339'
    }
  },
  dropoff: {
    locationType: 'Door',
    province: 'Jawa Timur',
    city: 'Kota Surabaya',
    district: 'Gubeng',
    subdistrict: 'Pucang Sewu',
    address: 'Jl. Simulasi Pengiriman Raya No. 28, RT 03/RW 05',
    postalCode: '60283',
    pic: {
      name: 'Aldin',
      company: 'Aldin Co',
      address: 'Jl. Simulasi Pengiriman Raya No. 28, RT 03/RW 05',
      email: 'aldin@aldinco.com',
      phone: '08755910333483'
    }
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
    packagingType: 'Kardus XL'
  },
  serviceCatalogPreference: 'LTL'
};

const REALISTIC_CARGO_ITEMS = [
  'Kardus Pakaian',
  'Peralatan Elektronik',
  'Spare Part',
  'Peralatan Rumah Tangga',
  'Dokumen',
  'Produk Makanan Kemasan',
  'Komponen Mesin',
  'Bahan Tekstil',
  'Aksesoris Komputer',
  'Alat Tulis Kantor',
  'Perlengkapan Medis',
  'Barang Cetakan',
];

let recentCargoItems = [];

/**
 * Generate a realistic Indonesian cargo item name, avoiding recently used items.
 */
function generateCargoItemName(options = {}) {
  const exclude = new Set([...(options.excludeItems || []), ...recentCargoItems]);
  let candidates = REALISTIC_CARGO_ITEMS.filter(item => !exclude.has(item));
  if (candidates.length === 0) {
    recentCargoItems = [];
    candidates = REALISTIC_CARGO_ITEMS.filter(item => !(options.excludeItems || []).includes(item));
    if (candidates.length === 0) candidates = REALISTIC_CARGO_ITEMS;
  }
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];
  recentCargoItems.push(chosen);
  if (recentCargoItems.length > Math.min(6, REALISTIC_CARGO_ITEMS.length - 2)) {
    recentCargoItems.shift();
  }
  return chosen;
}

/**
 * Generate a random integer weight between min and max inclusive (default 50-100 kg).
 */
function generateCargoWeightKg(min = 50, max = 100) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

/**
 * Check whether a string is only an administrative location (e.g. city, district, province)
 * rather than a genuine street address.
 */
function isAdministrativeOnly(addr, city = '', district = '', province = '', country = '') {
  if (!addr || typeof addr !== 'string') return true;
  const trimmed = addr.trim();
  if (trimmed.length === 0) return true;

  const lower = trimmed.toLowerCase();
  const cLower = String(city || '').trim().toLowerCase();
  const dLower = String(district || '').trim().toLowerCase();
  const pLower = String(province || '').trim().toLowerCase();
  const cntryLower = String(country || '').trim().toLowerCase();

  // If address equals administrative names exactly
  if (cLower && lower === cLower) return true;
  if (dLower && lower === dLower) return true;
  if (pLower && lower === pLower) return true;
  if (cntryLower && lower === cntryLower) return true;

  // If address is simply a combination of district/city/province (e.g. "Tebet, Jakarta Selatan", "Benda Kota Tangerang")
  const stripped = lower.replace(/[,.-]/g, ' ').replace(/\s+/g, ' ').trim();
  const adminTokens = [cLower, dLower, pLower, cntryLower].filter(Boolean).map(t => t.replace(/[,.-]/g, ' ').trim());
  let remaining = stripped;
  for (const token of adminTokens) {
    if (token) {
      remaining = remaining.replace(new RegExp(`\\b${token}\\b`, 'g'), '').trim();
    }
  }
  const nonAdminWords = remaining.replace(/\b(kota|kabupaten|kab|provinsi|prov|kecamatan|kec|kelurahan|kel|indonesia|singapore|malaysia)\b/g, '').trim();
  if (!nonAdminWords && !/\d+/.test(trimmed)) {
    return true;
  }

  // Check if it lacks street markers AND digits
  const hasStreetIndicator = /(?:\b(?:jl|jalan|gang|gg|street|st|road|rd|ave|avenue|blvd|boulevard|komplek|ruko|blok|no|rt|rw|gedung|tower|floor|lantai|suite|unit|hub|terminal)\b|\d+)/i.test(trimmed);
  if (!hasStreetIndicator) {
    return true;
  }

  return false;
}

/**
 * Generate a realistic synthetic street address tailored to location and country.
 * Clearly designates simulated/test data and never copies city/district.
 */
function generateSyntheticStreetAddress(options = {}) {
  const normCountry = normalizeCountry(options.country);
  const isPickup = options.isPickup !== false;
  const num = Math.floor(Math.random() * 88) + 1;
  const rt = String(Math.floor(Math.random() * 9) + 1).padStart(2, '0');
  const rw = String(Math.floor(Math.random() * 9) + 1).padStart(2, '0');

  if (normCountry.code === 'SG') {
    const streets = isPickup
      ? ['10 Orchard Road #05-12, Singapore', '250 Orchard Rd #03-01, Singapore', '12 Marina Boulevard #18-01, Singapore']
      : ['5 Changi South Lane #02-04, Singapore', '10 Collyer Quay #10-01, Singapore', '8 Jurong Port Road #01-05, Singapore'];
    return streets[Math.floor(Math.random() * streets.length)];
  }

  if (normCountry.code === 'MY') {
    return isPickup
      ? `No. ${num}, Jalan Logistik Percobaan, Bukit Bintang`
      : `No. ${num + 10}, Jalan Kargo Simulasi, Seksyen 15`;
  }

  // Indonesian addresses
  const pickupStreets = [
    `Jl. Logistik Simulasi No. ${num}, RT ${rt}/RW ${rw}`,
    `Jl. Percobaan Kargo Raya No. ${num}, RT ${rt}/RW ${rw}`,
    `Jl. Pergudangan Uji Coba No. ${num}, Blok A, RT ${rt}/RW ${rw}`,
    `Komplek Distribusi Simulasi No. ${num}, RT ${rt}/RW ${rw}`,
  ];
  const dropoffStreets = [
    `Jl. Simulasi Pengiriman Raya No. ${num + 5}, RT ${rt}/RW ${rw}`,
    `Jl. Mitra Ekspedisi Percobaan No. ${num + 12}, RT ${rt}/RW ${rw}`,
    `Kawasan Industri Testing No. ${num + 20}, Blok B, RT ${rt}/RW ${rw}`,
    `Ruko Sentra Simulasi No. ${num + 3}, RT ${rt}/RW ${rw}`,
  ];

  const pool = isPickup ? pickupStreets : dropoffStreets;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Determine the Domestic transport preference ('SEMUA', 'DARAT', 'UDARA', 'LAUT')
 * based on pickup/drop-off location types, geography, and transport requirements.
 *
 * Rules:
 * 1. Port -> Port must ALWAYS select LAUT.
 * 2. Airport -> Airport must ALWAYS select UDARA.
 * 3. Door -> Door with exclusive land transport selects DARAT.
 * 4. Multi-modal combinations (Door->Port, Port->Door, Airport->Door, Door->Airport,
 *    Port->Airport, Airport->Port, cross-island, cross-country, or mixed transport) select SEMUA.
 * 5. Explicit user instructions take precedence unless Port->Port (LAUT) or Airport->Airport (UDARA).
 * 6. Fallback is SEMUA when uncertain.
 *
 * @param {Object} spec Order specification or partial spec
 * @returns {'SEMUA'|'DARAT'|'UDARA'|'LAUT'}
 */
function determineDomesticTransportPreference(spec = {}) {
  const pickup = spec.pickup || {};
  const dropoff = spec.dropoff || {};

  // Normalize location types/categories
  const pCat = pickup.locationCategory || detectLocationCategory(pickup.locationType || pickup.locality || pickup.searchQuery || pickup.address || pickup.city);
  const dCat = dropoff.locationCategory || detectLocationCategory(dropoff.locationType || dropoff.locality || dropoff.searchQuery || dropoff.address || dropoff.city);

  // Mandatory override 1: Port -> Port must ALWAYS select LAUT
  if (pCat === 'Port' && dCat === 'Port') {
    return 'LAUT';
  }

  // Mandatory override 2: Airport -> Airport must ALWAYS select UDARA
  if (pCat === 'Airport' && dCat === 'Airport') {
    return 'UDARA';
  }

  // Cross-country shipment requires multi-modal / air / sea -> SEMUA
  const pCountry = String(pickup.country || 'Indonesia').trim().toLowerCase();
  const dCountry = String(dropoff.country || 'Indonesia').trim().toLowerCase();
  const isInternational = spec.orderType === 'international' || (pCountry && dCountry && pCountry !== dCountry);
  if (isInternational) {
    return 'SEMUA';
  }

  // Check explicit transportation mode or instructions if provided
  const rawMode = String(spec.transportationMode || '').trim().toUpperCase();
  const rawInstruct = String(spec.transportInstructions || spec.prompt || '').toLowerCase();

  // If mixed land, sea, air shipment explicitly mentioned -> SEMUA
  if (rawInstruct.includes('mixed') || (rawInstruct.includes('darat') && (rawInstruct.includes('laut') || rawInstruct.includes('udara')))) {
    return 'SEMUA';
  }

  // If explicit mode requested and not conflicting with mandatory overrides
  if (rawMode === 'DARAT' || rawMode === 'LAND') {
    // Only valid for Door -> Door land
    if (pCat === 'Door' && dCat === 'Door') {
      const pIsland = getIndonesianIsland(pickup);
      const dIsland = getIndonesianIsland(dropoff);
      if (!pIsland || !dIsland || pIsland === dIsland) {
        return 'DARAT';
      }
      // Cross-island requires sea or air -> SEMUA
      return 'SEMUA';
    }
    return 'SEMUA';
  }

  if (rawMode === 'UDARA' || rawMode === 'AIR') {
    // If not Airport -> Airport, multi-modal leg involved -> SEMUA
    return 'SEMUA';
  }

  if (rawMode === 'LAUT' || rawMode === 'SEA' || rawMode === 'SEA FREIGHT') {
    // If not Port -> Port, multi-modal leg involved -> SEMUA
    return 'SEMUA';
  }

  // Combinations involving Port or Airport with Door or each other
  // Door -> Port, Port -> Door, Airport -> Door, Door -> Airport, Port -> Airport, Airport -> Port
  if (
    (pCat === 'Door' && dCat === 'Port') ||
    (pCat === 'Port' && dCat === 'Door') ||
    (pCat === 'Airport' && dCat === 'Door') ||
    (pCat === 'Door' && dCat === 'Airport') ||
    (pCat === 'Port' && dCat === 'Airport') ||
    (pCat === 'Airport' && dCat === 'Port')
  ) {
    return 'SEMUA';
  }

  // Check Door -> Door geography
  if (pCat === 'Door' && dCat === 'Door') {
    // Check if route crosses islands (e.g., Jakarta -> Bali, Jakarta -> Makassar)
    const pIsland = getIndonesianIsland(pickup);
    const dIsland = getIndonesianIsland(dropoff);

    if (pIsland && dIsland && pIsland !== dIsland) {
      // Crosses islands: requires sea or air transportation -> SEMUA
      return 'SEMUA';
    }

    // Check if instructions mention sea or air
    if (rawInstruct.includes('sea') || rawInstruct.includes('laut') || rawInstruct.includes('air') || rawInstruct.includes('udara')) {
      return 'SEMUA';
    }

    // Exclusively land route on the same island (e.g. Jakarta -> Surabaya)
    if (pIsland && dIsland && pIsland === dIsland) {
      return 'DARAT';
    }

    // Default Door -> Door within Indonesia when islands cannot be distinguished
    return 'DARAT';
  }

  // Confident determination not possible -> fallback to SEMUA
  return 'SEMUA';
}

/**
 * Reset cargo generator recent history (useful for test isolation).
 */
function resetCargoGenerator() {
  recentCargoItems = [];
}

/**
 * Load the last saved order specification.
 */
function loadPreviousSpecification(filepath = PREV_SPEC_FILE) {
  try {
    if (fs.existsSync(filepath)) {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      return data;
    }
  } catch (err) {
    console.warn('[OrderSpec] Could not read previous specification, using default:', err.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_SPECIFICATION));
}

/**
 * Save an order specification as the new remembered baseline.
 * Transactional identifiers (order IDs, VAs) are explicitly excluded.
 */
function savePreviousSpecification(spec, filepath = PREV_SPEC_FILE) {
  try {
    const targetDir = path.dirname(filepath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    // Clean out transaction-specific state
    const cleanSpec = JSON.parse(JSON.stringify(spec));
    delete cleanSpec.orderId;
    delete cleanSpec.shipmentId;
    delete cleanSpec.vaNumber;
    delete cleanSpec.amount;
    delete cleanSpec.metadata;
    delete cleanSpec._sources;
    
    fs.writeFileSync(filepath, JSON.stringify(cleanSpec, null, 2), 'utf-8');
    console.log('[OrderSpec] Previous specification baseline updated at:', filepath);
  } catch (err) {
    console.error('[OrderSpec] Failed to save previous specification:', err.message);
  }
}

/**
 * Resolve a full order specification by merging an incoming partial specification
 * with previous values and synthetic PIC generators.
 * 
 * Rules:
 * - Explicitly supplied fields always take precedence (tagged 'provided').
 * - Missing fields check previous specification (tagged 'reused').
 * - Pickup changes do NOT affect Drop-off, and vice versa.
 * - When orderType changes (e.g. domestic <-> international), incompatible route specifics are not blindly reused.
 * - When a city/location changes, lower-level child fields (district/subdistrict/postalCode) are not blindly preserved if incompatible.
 * - If PIC generation is requested or missing without previous profile, generate (tagged 'generated').
 * 
 * @param {Object} inputSpec Partial or full specification
 * @param {Object} options
 * @param {boolean} [options.generatePickupPic=false]
 * @param {boolean} [options.generateDropoffPic=false]
 * @param {Object} [options.previousSpec=null] Optional explicit previous specification object
 * @returns {Object} { resolvedSpec, sources, missingMandatory }
 */
function resolveSpecification(inputSpec = {}, options = {}) {
  const prev = options.previousSpec || loadPreviousSpecification();
  const sources = {};
  const resolved = {};

  // 1. Order Type & Mode (Global Non-Contract Policy)
  if (inputSpec.orderType) {
    resolved.orderType = inputSpec.orderType;
    sources.orderType = 'provided';
  } else {
    resolved.orderType = prev.orderType || 'domestic';
    sources.orderType = 'reused';
  }

  const isTypeChanged = prev.orderType && prev.orderType !== resolved.orderType;

  // Global policy: Always Non-Contract. User input or previous specifications cannot override.
  resolved.orderMode = 'non-contract';
  sources.orderMode = 'policy_enforced';

  // 1b. Service Type (e.g., Cargo, Express)
  if (inputSpec.serviceType) {
    resolved.serviceType = inputSpec.serviceType;
    sources.serviceType = 'provided';
  } else if (prev.serviceType && !isTypeChanged) {
    resolved.serviceType = prev.serviceType;
    sources.serviceType = 'reused';
  } else {
    resolved.serviceType = resolved.orderType === 'international' ? 'Cargo' : 'LTL';
    sources.serviceType = 'ui_default';
  }

  // 1c. Incoterm (e.g. DDP)
  if (inputSpec.incoterm) {
    resolved.incoterm = normalizeIncoterm(inputSpec.incoterm);
    sources.incoterm = 'provided';
  } else if (prev.incoterm && resolved.orderType === 'international' && !isTypeChanged) {
    resolved.incoterm = normalizeIncoterm(prev.incoterm);
    sources.incoterm = 'reused';
  } else if (resolved.orderType === 'international') {
    resolved.incoterm = 'Delivered Duty Paid';
    sources.incoterm = 'ui_default';
  }

  // 2. Transportation Mode
  if (inputSpec.transportationMode) {
    resolved.transportationMode = inputSpec.transportationMode;
    sources.transportationMode = 'provided';
  } else if (isTypeChanged && resolved.orderType === 'international') {
    resolved.transportationMode = 'Air';
    sources.transportationMode = 'ui_default';
  } else {
    resolved.transportationMode = prev.transportationMode || 'SEMUA';
    sources.transportationMode = 'reused';
  }

  // 3. Dates & Times
  if (inputSpec.scheduledDate) {
    resolved.scheduledDate = inputSpec.scheduledDate;
    sources.scheduledDate = 'provided';
  } else if (prev.scheduledDate) {
    resolved.scheduledDate = prev.scheduledDate;
    sources.scheduledDate = 'reused';
  } else {
    resolved.scheduledDate = '';
    sources.scheduledDate = 'missing';
  }

  if (inputSpec.scheduledTime) {
    resolved.scheduledTime = inputSpec.scheduledTime;
    sources.scheduledTime = 'provided';
  } else {
    resolved.scheduledTime = prev.scheduledTime || '10:00';
    sources.scheduledTime = 'reused';
  }

  // 3b. Transit Duration & Hours
  if (inputSpec.transitDuration) {
    resolved.transitDuration = inputSpec.transitDuration;
    sources.transitDuration = 'provided';
  } else if (prev.transitDuration && !isTypeChanged) {
    resolved.transitDuration = prev.transitDuration;
    sources.transitDuration = 'reused';
  }

  if (inputSpec.durationHours !== undefined) {
    resolved.durationHours = inputSpec.durationHours;
    sources.durationHours = 'provided';
  } else if (prev.durationHours !== undefined && !isTypeChanged) {
    resolved.durationHours = prev.durationHours;
    sources.durationHours = 'reused';
  }

  // 4. Pickup Location (Independent resolution)
  resolved.pickup = {};
  sources.pickup = {};
  const inputPickup = inputSpec.pickup || {};
  const prevPickup = (!isTypeChanged && prev.pickup) ? prev.pickup : {};

  if (inputPickup.city) {
    inputPickup.city = normalizeAdminCityName(inputPickup.city);
  }

  // Check if pickup city or province was changed
  const isPickupLocationChanged = Boolean(
    (inputPickup.city && prevPickup.city && inputPickup.city.toLowerCase() !== prevPickup.city.toLowerCase()) ||
    (inputPickup.province && prevPickup.province && inputPickup.province.toLowerCase() !== prevPickup.province.toLowerCase()) ||
    (inputPickup.country && prevPickup.country && inputPickup.country.toLowerCase() !== prevPickup.country.toLowerCase())
  );

  // Check if pickup district was changed while city remained
  const isPickupDistrictChanged = Boolean(
    inputPickup.district && prevPickup.district && inputPickup.district.toLowerCase() !== prevPickup.district.toLowerCase()
  );

  const pickupKeys = ['country', 'locationType', 'province', 'city', 'district', 'subdistrict', 'address', 'postalCode', 'locality', 'searchQuery', 'parentContext'];
  for (const k of pickupKeys) {
    if (inputPickup[k] !== undefined && inputPickup[k] !== null && String(inputPickup[k]).trim() !== '') {
      resolved.pickup[k] = inputPickup[k];
      sources.pickup[k] = 'provided';
    } else if (isPickupLocationChanged && ['district', 'subdistrict', 'postalCode'].includes(k)) {
      // Incompatible child fields should not be blindly preserved from previous different city
      resolved.pickup[k] = '';
      sources.pickup[k] = 'reset_on_location_change';
    } else if (isPickupDistrictChanged && ['subdistrict', 'postalCode'].includes(k)) {
      resolved.pickup[k] = '';
      sources.pickup[k] = 'reset_on_district_change';
    } else if (prevPickup[k] !== undefined) {
      resolved.pickup[k] = prevPickup[k];
      sources.pickup[k] = 'reused';
    } else {
      sources.pickup[k] = 'missing';
    }
  }

  // Sanitize searchQuery and locality if they contain schedules/metadata
  if (resolved.pickup.searchQuery) {
    resolved.pickup.searchQuery = stripScheduleAndMetadata(resolved.pickup.searchQuery);
  }
  if (resolved.pickup.locality) {
    resolved.pickup.locality = stripScheduleAndMetadata(resolved.pickup.locality);
  }

  // Ensure pickup address is a genuine street address, not an administrative placeholder
  if (resolved.pickup.address && !isAdministrativeOnly(resolved.pickup.address, resolved.pickup.city, resolved.pickup.district, resolved.pickup.province, resolved.pickup.country)) {
    // Keep explicit street address
  } else {
    resolved.pickup.address = generateSyntheticStreetAddress({
      country: resolved.pickup.country || 'Indonesia',
      city: resolved.pickup.city,
      district: resolved.pickup.district,
      isPickup: true,
    });
    sources.pickup.address = (inputPickup.address && !isAdministrativeOnly(inputPickup.address, resolved.pickup.city, resolved.pickup.district)) ? 'provided' : 'generated';
  }

  // Default locationType
  if (!resolved.pickup.locationType) {
    resolved.pickup.locationType = 'Door';
    sources.pickup.locationType = 'ui_default';
  }

  // Reuse policy: Only reuse previous PIC if explicitly requested or during edit/previous baseline update
  const canReusePic = Boolean(
    options.reusePic ||
    options.isEdit ||
    inputSpec.reusePic ||
    inputSpec.reusePreviousPic ||
    (options.previousSpec && options.reusePic !== false && options.isNewOrder !== true)
  );

  // 5. Pickup PIC (Independent from drop-off PIC)
  resolved.pickup.pic = {};
  sources.pickup.pic = {};
  const inputPickupPic = inputPickup.pic || inputSpec.pickupPic || {};
  const prevPickupPic = (canReusePic && prevPickup.pic) ? prevPickup.pic : {};
  const shouldGenPickupPic = options.generatePickupPic === true || inputSpec.generatePickupPic === true;

  const pickupCountry = resolved.pickup.country || 'Indonesia';
  let pickupSelection;
  if (shouldGenPickupPic) {
    const gen = generateRealisticPIC({ country: pickupCountry, city: resolved.pickup.city, type: 'pickup' });
    pickupSelection = { pic: gen, origin: 'generated' };
  } else {
    pickupSelection = selectRandomPIC({
      country: pickupCountry,
      city: resolved.pickup.city,
      type: 'pickup',
    });
  }

  // If user explicitly provided name matching an entry in library, align baseline profile to it
  if (inputPickupPic.name) {
    const lib = getPicLibrary();
    const matched = lib.find(p => p && String(p.name).trim().toLowerCase() === String(inputPickupPic.name).trim().toLowerCase());
    if (matched) {
      pickupSelection = { pic: JSON.parse(JSON.stringify(matched)), origin: 'library_random' };
    }
  }

  const picFields = ['name', 'company', 'address', 'email', 'phone'];
  for (const k of picFields) {
    const val = inputPickupPic[k] !== undefined ? inputPickupPic[k] : (k === 'phone' ? (inputPickupPic.contact || inputPickup.contact || inputPickup.phone) : (k === 'company' ? inputPickup.company : null));
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      resolved.pickup.pic[k] = String(val).trim();
      sources.pickup.pic[k] = 'provided';
    } else if (!shouldGenPickupPic && canReusePic && prevPickupPic[k] !== undefined && String(prevPickupPic[k]).trim() !== '') {
      resolved.pickup.pic[k] = prevPickupPic[k];
      sources.pickup.pic[k] = 'reused';
    } else {
      resolved.pickup.pic[k] = pickupSelection.pic[k];
      sources.pickup.pic[k] = pickupSelection.origin;
    }
  }
  if (!resolved.pickup.pic.address || isAdministrativeOnly(resolved.pickup.pic.address, resolved.pickup.city, resolved.pickup.district, resolved.pickup.province, resolved.pickup.country)) {
    resolved.pickup.pic.address = resolved.pickup.address;
  }
  resolved.pickup.pic.country = pickupSelection.pic.country || pickupCountry;
  resolved.pickup.pic.countryCode = pickupSelection.pic.countryCode;
  resolved.pickup.pic.phoneCountryCode = pickupSelection.pic.phoneCountryCode;

  // 6. Dropoff Location (Independent resolution, never overwrites Pickup)
  resolved.dropoff = {};
  sources.dropoff = {};
  const inputDropoff = inputSpec.dropoff || {};
  const prevDropoff = (!isTypeChanged && prev.dropoff) ? prev.dropoff : {};

  if (inputDropoff.city) {
    inputDropoff.city = normalizeAdminCityName(inputDropoff.city);
  }

  const isExplicitDropoffRequested = Boolean(
    inputSpec._explicitDestinationProvided ||
    inputDropoff.unresolved ||
    (inputDropoff.raw && String(inputDropoff.raw).trim() !== '')
  );

  // If destination was explicitly requested but unresolved or missing city: do NOT inherit previous destination!
  if (isExplicitDropoffRequested && (!inputDropoff.city || inputDropoff.city.trim() === '' || inputDropoff.unresolved)) {
    resolved.dropoff = {
      country: inputDropoff.country || 'Indonesia',
      locationType: inputDropoff.locationType || 'Door',
      province: inputDropoff.province || '',
      city: '',
      district: '',
      subdistrict: '',
      address: '',
      postalCode: '',
      unresolved: true,
      raw: inputDropoff.raw || '',
    };
    for (const k of ['country', 'locationType', 'province', 'city', 'district', 'subdistrict', 'address', 'postalCode']) {
      sources.dropoff[k] = 'unresolved_explicit';
    }
  } else {
    // Check if dropoff city or province was changed
    const isDropoffLocationChanged = Boolean(
      (inputDropoff.city && prevDropoff.city && inputDropoff.city.toLowerCase() !== prevDropoff.city.toLowerCase()) ||
      (inputDropoff.province && prevDropoff.province && inputDropoff.province.toLowerCase() !== prevDropoff.province.toLowerCase()) ||
      (inputDropoff.country && prevDropoff.country && inputDropoff.country.toLowerCase() !== prevDropoff.country.toLowerCase())
    );

    // Check if dropoff district was changed while city remained
    const isDropoffDistrictChanged = Boolean(
      inputDropoff.district && prevDropoff.district && inputDropoff.district.toLowerCase() !== prevDropoff.district.toLowerCase()
    );

    const dropoffKeys = ['country', 'locationType', 'province', 'city', 'district', 'subdistrict', 'address', 'postalCode', 'locality', 'searchQuery', 'parentContext'];
    for (const k of dropoffKeys) {
      if (inputDropoff[k] !== undefined && inputDropoff[k] !== null && String(inputDropoff[k]).trim() !== '') {
        resolved.dropoff[k] = inputDropoff[k];
        sources.dropoff[k] = 'provided';
      } else if (isDropoffLocationChanged && ['district', 'subdistrict', 'postalCode'].includes(k)) {
        resolved.dropoff[k] = '';
        sources.dropoff[k] = 'reset_on_location_change';
      } else if (isDropoffDistrictChanged && ['subdistrict', 'postalCode'].includes(k)) {
        resolved.dropoff[k] = '';
        sources.dropoff[k] = 'reset_on_district_change';
      } else if (prevDropoff[k] !== undefined) {
        resolved.dropoff[k] = prevDropoff[k];
        sources.dropoff[k] = 'reused';
      } else {
        sources.dropoff[k] = 'missing';
      }
    }
  }

  // Sanitize searchQuery and locality if they contain schedules/metadata
  if (resolved.dropoff.searchQuery) {
    resolved.dropoff.searchQuery = stripScheduleAndMetadata(resolved.dropoff.searchQuery);
  }
  if (resolved.dropoff.locality) {
    resolved.dropoff.locality = stripScheduleAndMetadata(resolved.dropoff.locality);
  }

  // Ensure dropoff address is a genuine street address, not an administrative placeholder, and distinct from pickup
  if (resolved.dropoff.address && !isAdministrativeOnly(resolved.dropoff.address, resolved.dropoff.city, resolved.dropoff.district, resolved.dropoff.province, resolved.dropoff.country)) {
    // Keep explicit street address
  } else {
    resolved.dropoff.address = generateSyntheticStreetAddress({
      country: resolved.dropoff.country || (resolved.orderType === 'international' ? 'Singapore' : 'Indonesia'),
      city: resolved.dropoff.city,
      district: resolved.dropoff.district,
      isPickup: false,
    });
    sources.dropoff.address = (inputDropoff.address && !isAdministrativeOnly(inputDropoff.address, resolved.dropoff.city, resolved.dropoff.district)) ? 'provided' : 'generated';
  }

  if (!resolved.dropoff.locationType) {
    resolved.dropoff.locationType = 'Door';
    sources.dropoff.locationType = 'ui_default';
  }

  // 7. Dropoff PIC (Independent from pickup PIC)
  resolved.dropoff.pic = {};
  sources.dropoff.pic = {};
  const inputDropoffPic = inputDropoff.pic || inputSpec.dropoffPic || {};
  const prevDropoffPic = (canReusePic && prevDropoff.pic) ? prevDropoff.pic : {};
  const shouldGenDropoffPic = options.generateDropoffPic === true || inputSpec.generateDropoffPic === true;

  const dropoffCountry = resolved.dropoff.country || (resolved.orderType === 'international' ? 'Singapore' : 'Indonesia');
  let dropoffSelection;
  if (shouldGenDropoffPic) {
    const gen = generateRealisticPIC({ country: dropoffCountry, city: resolved.dropoff.city, type: 'dropoff' });
    dropoffSelection = { pic: gen, origin: 'generated' };
  } else {
    dropoffSelection = selectRandomPIC({
      country: dropoffCountry,
      city: resolved.dropoff.city,
      type: 'dropoff',
      excludeNames: [resolved.pickup.pic.name],
      excludePhones: [resolved.pickup.pic.phone],
    });
  }

  // If user explicitly provided name matching an entry in library, align baseline profile to it
  if (inputDropoffPic.name) {
    const lib = getPicLibrary();
    const matched = lib.find(p => p && String(p.name).trim().toLowerCase() === String(inputDropoffPic.name).trim().toLowerCase());
    if (matched) {
      dropoffSelection = { pic: JSON.parse(JSON.stringify(matched)), origin: 'library_random' };
    }
  }

  for (const k of picFields) {
    const val = inputDropoffPic[k] !== undefined ? inputDropoffPic[k] : (k === 'phone' ? (inputDropoffPic.contact || inputDropoff.contact || inputDropoff.phone) : (k === 'company' ? inputDropoff.company : null));
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      resolved.dropoff.pic[k] = String(val).trim();
      sources.dropoff.pic[k] = 'provided';
    } else if (!shouldGenDropoffPic && canReusePic && prevDropoffPic[k] !== undefined && String(prevDropoffPic[k]).trim() !== '') {
      resolved.dropoff.pic[k] = prevDropoffPic[k];
      sources.dropoff.pic[k] = 'reused';
    } else {
      resolved.dropoff.pic[k] = dropoffSelection.pic[k];
      sources.dropoff.pic[k] = dropoffSelection.origin;
    }
  }
  if (!resolved.dropoff.pic.address || isAdministrativeOnly(resolved.dropoff.pic.address, resolved.dropoff.city, resolved.dropoff.district, resolved.dropoff.province, resolved.dropoff.country)) {
    resolved.dropoff.pic.address = resolved.dropoff.address;
  }
  resolved.dropoff.pic.country = dropoffSelection.pic.country || dropoffCountry;
  resolved.dropoff.pic.countryCode = dropoffSelection.pic.countryCode;
  resolved.dropoff.pic.phoneCountryCode = dropoffSelection.pic.phoneCountryCode;

  // 8. Cargo & Package Details
  resolved.cargo = {};
  sources.cargo = {};
  const inputCargo = inputSpec.cargo || {};
  const prevCargo = prev.cargo || {};

  // Reuse policy: Only reuse previous cargo if explicitly requested, during edit, or when previousSpec explicitly provided without isNewOrder
  const canReuseCargo = Boolean(
    options.reuseCargo ||
    options.isEdit ||
    inputSpec.reuseCargo ||
    inputSpec.reusePreviousCargo ||
    (options.previousSpec && options.reuseCargo !== false && options.isNewOrder !== true && !options.generateCargo && !inputSpec.generateCargo)
  );

  const cargoKeys = [
    'characteristics', 'commodity', 'itemName', 'weightKg',
    'quantity', 'quantityUnit', 'lengthCm', 'widthCm', 'heightCm', 'packagingType', 'hsCode'
  ];

  for (const k of cargoKeys) {
    if (inputCargo[k] !== undefined && inputCargo[k] !== null && String(inputCargo[k]).trim() !== '') {
      resolved.cargo[k] = k === 'weightKg' ? Number(inputCargo[k]) : inputCargo[k];
      sources.cargo[k] = inputSpec._sources?.cargo?.[k] || 'provided';
    } else if (canReuseCargo && prevCargo[k] !== undefined && String(prevCargo[k]).trim() !== '') {
      resolved.cargo[k] = prevCargo[k];
      sources.cargo[k] = 'reused';
    } else if (k === 'itemName') {
      resolved.cargo.itemName = generateCargoItemName();
      sources.cargo.itemName = 'generated';
    } else if (k === 'weightKg') {
      resolved.cargo.weightKg = generateCargoWeightKg(50, 100);
      sources.cargo.weightKg = 'generated';
    } else if (prevCargo[k] !== undefined) {
      resolved.cargo[k] = prevCargo[k];
      sources.cargo[k] = 'reused';
    } else if (DEFAULT_SPECIFICATION.cargo && DEFAULT_SPECIFICATION.cargo[k] !== undefined) {
      resolved.cargo[k] = DEFAULT_SPECIFICATION.cargo[k];
      sources.cargo[k] = 'ui_default';
    } else {
      sources.cargo[k] = 'missing';
    }
  }

  // 9. Service Catalog Preference
  if (inputSpec.serviceCatalogPreference) {
    resolved.serviceCatalogPreference = inputSpec.serviceCatalogPreference;
    sources.serviceCatalogPreference = 'provided';
  } else if (prev.serviceCatalogPreference) {
    resolved.serviceCatalogPreference = prev.serviceCatalogPreference;
    sources.serviceCatalogPreference = 'reused';
  } else {
    resolved.serviceCatalogPreference = 'auto';
    sources.serviceCatalogPreference = 'ui_default';
  }

  // 9b. Domestic Transport Preference Resolution
  if (resolved.orderType === 'domestic') {
    resolved.transportationMode = determineDomesticTransportPreference({
      ...inputSpec,
      orderType: 'domestic',
      pickup: resolved.pickup,
      dropoff: resolved.dropoff,
      transportationMode: inputSpec.transportationMode,
      transportInstructions: inputSpec.transportInstructions || inputSpec.prompt || '',
    });
    sources.transportationMode = inputSpec.transportationMode ? 'provided' : 'ui_default';
  }

  // 10. Check Missing Mandatory Fields
  const missingMandatory = [];
  if (!resolved.pickup.city) missingMandatory.push('pickup.city');
  if (!resolved.dropoff.city) missingMandatory.push('dropoff.city');
  if (!resolved.scheduledDate) missingMandatory.push('scheduledDate');
  if (!resolved.cargo.itemName) missingMandatory.push('cargo.itemName');
  if (!resolved.cargo.weightKg) missingMandatory.push('cargo.weightKg');

  resolved._sources = sources;
  return {
    resolvedSpec: resolved,
    sources,
    missingMandatory,
  };
}

/**
 * Format a human-readable review table with field values and origins.
 */
function formatSpecificationReview(resolvedSpec, sources) {
  function badge(src) {
    switch (src) {
      case 'provided': return '[Provided]';
      case 'reused': return '[Reused]';
      case 'library_random':
      case 'randomized_library': return '[Randomized from Library]';
      case 'generated': return '[Generated Synthetic]';
      case 'ui_default': return '[UI Default]';
      case 'policy_enforced': return '[Policy Enforced]';
      case 'reset_on_location_change': return '[Reset - Location Changed]';
      case 'unresolved_explicit': return '**[EXPLICIT UNRESOLVED]**';
      case 'missing': return '**[MISSING]**';
      default: return `[${src}]`;
    }
  }

  const pickupPoint = [resolvedSpec.pickup.district || resolvedSpec.pickup.locality, resolvedSpec.pickup.city, resolvedSpec.pickup.province].filter(Boolean).join(', ');
  const dropoffPoint = [resolvedSpec.dropoff.district || resolvedSpec.dropoff.locality, resolvedSpec.dropoff.city, resolvedSpec.dropoff.province].filter(Boolean).join(', ');

  const lines = [
    '### Order Specification Review Before Submission',
    '',
    '| Field | Resolved Value | Origin Status |',
    '| :--- | :--- | :--- |',
    `| **Order Type** | ${resolvedSpec.orderType} | ${badge(sources.orderType)} |`,
    `| **Order Mode** | NON-CONTRACT (Policy Enforced) | ${badge(sources.orderMode)} |`,
    `| **Transportation Mode** | ${resolvedSpec.transportationMode} | ${badge(sources.transportationMode)} |`,
    `| **Service Type** | ${resolvedSpec.serviceType || 'Standard'} | ${badge(sources.serviceType || 'ui_default')} |`,
    `| **Pickup Date & Time** | ${resolvedSpec.scheduledDate} ${resolvedSpec.scheduledTime} | ${badge(sources.scheduledDate)} |`,
    resolvedSpec.transitDuration ? `| **Transit Duration** | ${resolvedSpec.transitDuration} (${resolvedSpec.durationHours || 0} hours) | ${badge(sources.transitDuration || 'provided')} |` : null,
    `| **Pickup Country** | ${resolvedSpec.pickup.country || 'Indonesia'} | ${badge(sources.pickup.country || 'ui_default')} |`,
    `| **Pickup Point** | ${pickupPoint} (${resolvedSpec.pickup.postalCode || '-'}) | ${badge(sources.pickup.city)} |`,
    `| **Pickup Location Type** | ${resolvedSpec.pickup.locationType || 'Door'} | ${badge(sources.pickup.locationType || 'ui_default')} |`,
    `| **Pickup Address** | ${resolvedSpec.pickup.address || '-'} | ${badge(sources.pickup.address)} |`,
    `| **Pickup PIC** | ${resolvedSpec.pickup.pic.name} (${resolvedSpec.pickup.pic.company}) | ${badge(sources.pickup.pic.name)} |`,
    `| **Pickup Contact** | ${resolvedSpec.pickup.pic.phone} / ${resolvedSpec.pickup.pic.email} | ${badge(sources.pickup.pic.phone)} |`,
    `| **Drop-off Country** | ${resolvedSpec.dropoff.country || (resolvedSpec.orderType === 'international' ? 'Singapore' : 'Indonesia')} | ${badge(sources.dropoff.country || 'ui_default')} |`,
    `| **Drop-off Point** | ${dropoffPoint} (${resolvedSpec.dropoff.postalCode || '-'}) | ${badge(sources.dropoff.city)} |`,
    `| **Drop-off Location Type** | ${resolvedSpec.dropoff.locationType || 'Door'} | ${badge(sources.dropoff.locationType || 'ui_default')} |`,
    `| **Drop-off Address** | ${resolvedSpec.dropoff.address || '-'} | ${badge(sources.dropoff.address)} |`,
    `| **Drop-off PIC** | ${resolvedSpec.dropoff.pic.name} (${resolvedSpec.dropoff.pic.company}) | ${badge(sources.dropoff.pic.name)} |`,
    `| **Drop-off Contact** | ${resolvedSpec.dropoff.pic.phone} / ${resolvedSpec.dropoff.pic.email} | ${badge(sources.dropoff.pic.phone)} |`,
    resolvedSpec.incoterm ? `| **Incoterm** | ${resolvedSpec.incoterm} | ${badge(sources.incoterm)} |` : null,
    `| **Cargo Characteristic** | ${resolvedSpec.cargo.characteristics} | ${badge(sources.cargo.characteristics)} |`,
    `| **Commodity & Item** | ${resolvedSpec.cargo.commodity} — ${resolvedSpec.cargo.itemName} | ${badge(sources.cargo.itemName)} |`,
    `| **Weight & Dimensions** | ${resolvedSpec.cargo.weightKg} KG, ${resolvedSpec.cargo.lengthCm}x${resolvedSpec.cargo.widthCm}x${resolvedSpec.cargo.heightCm} CM (${resolvedSpec.cargo.packagingType}) | ${badge(sources.cargo.weightKg)} |`,
    `| **Service Catalog Preference** | ${resolvedSpec.serviceCatalogPreference} | ${badge(sources.serviceCatalogPreference)} |`,
    ''
  ].filter(Boolean);

  return lines.join(String.fromCharCode(10));
}

module.exports = {
  loadPreviousSpecification,
  savePreviousSpecification,
  resolveSpecification,
  formatSpecificationReview,
  DEFAULT_SPECIFICATION,
  PREV_SPEC_FILE,
  REALISTIC_CARGO_ITEMS,
  generateCargoItemName,
  generateCargoWeightKg,
  resetCargoGenerator,
  generateSyntheticStreetAddress,
  isAdministrativeOnly,
  determineDomesticTransportPreference,
};

