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
const { generateRealisticPIC, validatePIC } = require('./pic_manager');

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
    address: 'Tebet',
    postalCode: '12850',
    pic: {
      name: 'Kevin',
      company: 'Kevin Co',
      address: 'Tebet',
      email: 'kevin@kevinco.com',
      phone: '08755029428339'
    }
  },
  dropoff: {
    locationType: 'Door',
    province: 'Jawa Timur',
    city: 'Surabaya',
    district: 'Gubeng',
    subdistrict: 'Pucang Sewu',
    address: 'Gubeng',
    postalCode: '60283',
    pic: {
      name: 'Aldin',
      company: 'Aldin Co',
      address: 'Gubeng',
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
    resolved.incoterm = inputSpec.incoterm;
    sources.incoterm = 'provided';
  } else if (prev.incoterm && resolved.orderType === 'international' && !isTypeChanged) {
    resolved.incoterm = prev.incoterm;
    sources.incoterm = 'reused';
  } else if (resolved.orderType === 'international') {
    resolved.incoterm = 'Delivered Duty Paid (DDP)';
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

  // 4. Pickup Location (Independent resolution)
  resolved.pickup = {};
  sources.pickup = {};
  const inputPickup = inputSpec.pickup || {};
  const prevPickup = (!isTypeChanged && prev.pickup) ? prev.pickup : {};

  // Check if pickup city or province was changed
  const isPickupLocationChanged = Boolean(
    (inputPickup.city && prevPickup.city && inputPickup.city !== prevPickup.city) ||
    (inputPickup.province && prevPickup.province && inputPickup.province !== prevPickup.province) ||
    (inputPickup.country && prevPickup.country && inputPickup.country !== prevPickup.country)
  );

  const pickupKeys = ['country', 'locationType', 'province', 'city', 'district', 'subdistrict', 'address', 'postalCode'];
  for (const k of pickupKeys) {
    if (inputPickup[k] !== undefined && inputPickup[k] !== null && String(inputPickup[k]).trim() !== '') {
      resolved.pickup[k] = inputPickup[k];
      sources.pickup[k] = 'provided';
    } else if (isPickupLocationChanged && ['district', 'subdistrict', 'postalCode'].includes(k)) {
      // Incompatible child fields should not be blindly preserved from previous different city
      resolved.pickup[k] = '';
      sources.pickup[k] = 'reset_on_location_change';
    } else if (prevPickup[k] !== undefined) {
      resolved.pickup[k] = prevPickup[k];
      sources.pickup[k] = 'reused';
    } else {
      sources.pickup[k] = 'missing';
    }
  }

  // Default locationType
  if (!resolved.pickup.locationType) {
    resolved.pickup.locationType = 'Door';
    sources.pickup.locationType = 'ui_default';
  }

  // 5. Pickup PIC (Independent from drop-off PIC)
  resolved.pickup.pic = {};
  sources.pickup.pic = {};
  const inputPickupPic = inputPickup.pic || {};
  const prevPickupPic = prevPickup.pic || {};
  const shouldGenPickupPic = options.generatePickupPic === true || inputSpec.generatePickupPic === true;

  if (shouldGenPickupPic) {
    resolved.pickup.pic = generateRealisticPIC({ type: 'pickup', city: resolved.pickup.city });
    for (const k of ['name', 'company', 'address', 'email', 'phone']) {
      sources.pickup.pic[k] = 'generated';
    }
  } else {
    for (const k of ['name', 'company', 'address', 'email', 'phone']) {
      if (inputPickupPic[k]) {
        resolved.pickup.pic[k] = inputPickupPic[k];
        sources.pickup.pic[k] = 'provided';
      } else if (prevPickupPic[k]) {
        resolved.pickup.pic[k] = prevPickupPic[k];
        sources.pickup.pic[k] = 'reused';
      } else {
        const gen = generateRealisticPIC({ type: 'pickup', city: resolved.pickup.city });
        resolved.pickup.pic[k] = gen[k];
        sources.pickup.pic[k] = 'generated';
      }
    }
  }

  // 6. Dropoff Location (Independent resolution, never overwrites Pickup)
  resolved.dropoff = {};
  sources.dropoff = {};
  const inputDropoff = inputSpec.dropoff || {};
  const prevDropoff = (!isTypeChanged && prev.dropoff) ? prev.dropoff : {};

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
      (inputDropoff.city && prevDropoff.city && inputDropoff.city !== prevDropoff.city) ||
      (inputDropoff.province && prevDropoff.province && inputDropoff.province !== prevDropoff.province) ||
      (inputDropoff.country && prevDropoff.country && inputDropoff.country !== prevDropoff.country)
    );

    const dropoffKeys = ['country', 'locationType', 'province', 'city', 'district', 'subdistrict', 'address', 'postalCode'];
    for (const k of dropoffKeys) {
      if (inputDropoff[k] !== undefined && inputDropoff[k] !== null && String(inputDropoff[k]).trim() !== '') {
        resolved.dropoff[k] = inputDropoff[k];
        sources.dropoff[k] = 'provided';
      } else if (isDropoffLocationChanged && ['district', 'subdistrict', 'postalCode'].includes(k)) {
        resolved.dropoff[k] = '';
        sources.dropoff[k] = 'reset_on_location_change';
      } else if (prevDropoff[k] !== undefined) {
        resolved.dropoff[k] = prevDropoff[k];
        sources.dropoff[k] = 'reused';
      } else {
        sources.dropoff[k] = 'missing';
      }
    }
  }

  if (!resolved.dropoff.locationType) {
    resolved.dropoff.locationType = 'Door';
    sources.dropoff.locationType = 'ui_default';
  }

  // 7. Dropoff PIC (Independent from pickup PIC)
  resolved.dropoff.pic = {};
  sources.dropoff.pic = {};
  const inputDropoffPic = inputDropoff.pic || {};
  const prevDropoffPic = prevDropoff.pic || {};
  const shouldGenDropoffPic = options.generateDropoffPic === true || inputSpec.generateDropoffPic === true;

  if (shouldGenDropoffPic) {
    resolved.dropoff.pic = generateRealisticPIC({ type: 'dropoff', city: resolved.dropoff.city });
    for (const k of ['name', 'company', 'address', 'email', 'phone']) {
      sources.dropoff.pic[k] = 'generated';
    }
  } else {
    for (const k of ['name', 'company', 'address', 'email', 'phone']) {
      if (inputDropoffPic[k]) {
        resolved.dropoff.pic[k] = inputDropoffPic[k];
        sources.dropoff.pic[k] = 'provided';
      } else if (prevDropoffPic[k]) {
        resolved.dropoff.pic[k] = prevDropoffPic[k];
        sources.dropoff.pic[k] = 'reused';
      } else {
        const gen = generateRealisticPIC({ type: 'dropoff', city: resolved.dropoff.city });
        resolved.dropoff.pic[k] = gen[k];
        sources.dropoff.pic[k] = 'generated';
      }
    }
  }

  // 8. Cargo & Package Details
  resolved.cargo = {};
  sources.cargo = {};
  const inputCargo = inputSpec.cargo || {};
  const prevCargo = prev.cargo || {};

  const cargoKeys = [
    'characteristics', 'commodity', 'itemName', 'weightKg',
    'quantity', 'quantityUnit', 'lengthCm', 'widthCm', 'heightCm', 'packagingType', 'hsCode'
  ];

  for (const k of cargoKeys) {
    if (inputCargo[k] !== undefined && inputCargo[k] !== null && String(inputCargo[k]).trim() !== '') {
      resolved.cargo[k] = inputCargo[k];
      sources.cargo[k] = 'provided';
    } else if (prevCargo[k] !== undefined) {
      resolved.cargo[k] = prevCargo[k];
      sources.cargo[k] = 'reused';
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
      case 'generated': return '[Generated Synthetic]';
      case 'ui_default': return '[UI Default]';
      case 'policy_enforced': return '[Policy Enforced]';
      case 'reset_on_location_change': return '[Reset - Location Changed]';
      case 'unresolved_explicit': return '**[EXPLICIT UNRESOLVED]**';
      case 'missing': return '**[MISSING]**';
      default: return `[${src}]`;
    }
  }

  const lines = [
    '### Order Specification Review Before Submission',
    '',
    '| Field | Resolved Value | Origin Status |',
    '| :--- | :--- | :--- |',
    `| **Order Type** | ${resolvedSpec.orderType} | ${badge(sources.orderType)} |`,
    `| **Order Mode** | NON-CONTRACT (Policy Enforced) | ${badge(sources.orderMode)} |`,
    `| **Transportation Mode** | ${resolvedSpec.transportationMode} ${resolvedSpec.serviceType ? `(${resolvedSpec.serviceType})` : ''} | ${badge(sources.transportationMode)} |`,
    `| **Pickup Date & Time** | ${resolvedSpec.scheduledDate} ${resolvedSpec.scheduledTime} | ${badge(sources.scheduledDate)} |`,
    `| **Pickup Point** | ${[resolvedSpec.pickup.district, resolvedSpec.pickup.city, resolvedSpec.pickup.province, resolvedSpec.pickup.country].filter(Boolean).join(', ')} (${resolvedSpec.pickup.postalCode || '-'}) | ${badge(sources.pickup.city)} |`,
    `| **Pickup Address** | ${resolvedSpec.pickup.address || '-'} | ${badge(sources.pickup.address)} |`,
    `| **Pickup PIC** | ${resolvedSpec.pickup.pic.name} (${resolvedSpec.pickup.pic.company}) | ${badge(sources.pickup.pic.name)} |`,
    `| **Pickup Contact** | ${resolvedSpec.pickup.pic.phone} / ${resolvedSpec.pickup.pic.email} | ${badge(sources.pickup.pic.phone)} |`,
    `| **Drop-off Point** | ${[resolvedSpec.dropoff.district, resolvedSpec.dropoff.city, resolvedSpec.dropoff.province, resolvedSpec.dropoff.country].filter(Boolean).join(', ')} (${resolvedSpec.dropoff.postalCode || '-'}) | ${badge(sources.dropoff.city)} |`,
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
};

