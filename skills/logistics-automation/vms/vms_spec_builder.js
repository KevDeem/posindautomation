/**
 * VMS Natural Language Specification Builder
 * Parses conversational route descriptions, applies hardcoded business rules,
 * computes arrival timestamps across midnight/month/year boundaries,
 * populates International & Additional Services rules, leaves Backhaul empty,
 * and formats reviewable specifications before submission.
 */

const { parseLocationString, classifyRouteInternational } = require('./location_resolver');
const { buildRouteTariff, formatRupiah } = require('./tariff_builder');

// Month mapping for date parsing
const MONTH_NAMES = {
  jan: 0, januari: 0, january: 0,
  feb: 1, februari: 1, february: 1,
  mar: 2, maret: 2, march: 2,
  apr: 3, april: 3,
  may: 4, mei: 4,
  jun: 5, juni: 5, june: 5,
  jul: 6, juli: 6, july: 6,
  aug: 7, agustus: 7, august: 7,
  sep: 8, september: 8,
  oct: 9, oktober: 9, october: 9,
  nov: 10, november: 10,
  dec: 11, desember: 11, december: 11,
};

/**
 * Parse date time string like "15 Dec 2026 08:00" or "2026-12-15 08:00"
 */
function parseDateTime(str) {
  if (!str) return null;
  const trimmed = str.trim();

  // Pattern 1: ISO/standard YYYY-MM-DD HH:mm
  const isoMatch = trimmed.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s](\d{1,2}):(\d{2}))?/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const hour = isoMatch[4] ? parseInt(isoMatch[4], 10) : 8;
    const minute = isoMatch[5] ? parseInt(isoMatch[5], 10) : 0;
    return new Date(Date.UTC(year, month, day, hour, minute));
  }

  // Pattern 2: DD Month YYYY HH:mm (e.g. "15 Dec 2026 08:00")
  const ddMonMatch = trimmed.match(/(\d{1,2})\s+([a-zA-Z]+)\s+(\d{4})(?:[,\s]+(\d{1,2})[:.](\d{2}))?/);
  if (ddMonMatch) {
    const day = parseInt(ddMonMatch[1], 10);
    const monthKey = ddMonMatch[2].toLowerCase();
    const month = MONTH_NAMES[monthKey];
    const year = parseInt(ddMonMatch[3], 10);
    const hour = ddMonMatch[4] ? parseInt(ddMonMatch[4], 10) : 8;
    const minute = ddMonMatch[5] ? parseInt(ddMonMatch[5], 10) : 0;
    if (month !== undefined) {
      return new Date(Date.UTC(year, month, day, hour, minute));
    }
  }

  return null;
}

/**
 * Format UTC Date to "DD MMMM YYYY, HH:mm" or ISO
 */
function formatDateTimeString(date) {
  if (!date || isNaN(date.getTime())) return '-';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = date.getUTCDate();
  const m = months[date.getUTCMonth()];
  const y = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mm = String(date.getUTCMinutes()).padStart(2, '0');
  return `${d} ${m} ${y}, ${hh}:${mm}`;
}

/**
 * Calculate arrival timestamp by adding transit duration in hours
 */
function calculateArrival(departureDate, durationHours) {
  if (!departureDate) return null;
  const arrival = new Date(departureDate.getTime() + (durationHours * 60 * 60 * 1000));
  return arrival;
}

/**
 * Parse a single natural-language route string
 * Examples:
 * - "Rawalumbu, Bekasi - Bandung Wetan, Bandung, 5 hours, FTL"
 * - "Tanjung Priok, Jakarta - Pasir Panjang, Singapore FCL 15 Dec 2026 08:00, 15 hours"
 * - "Soekarno-Hatta, Tangerang - Changi, Singapore Cargo 15 Dec 2026 08:00, 6 hours"
 */
function parseRoutePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') {
    return { error: 'Empty route prompt' };
  }

  const result = {
    rawPrompt: prompt,
    mode: null,
    serviceType: null,
    origin: null,
    destination: null,
    durationHours: null,
    departureDate: null,
    arrivalDate: null,
    userTariff: {},
    sources: {},
  };

  // 1. Detect service type
  if (/\bFTL\b/i.test(prompt)) {
    result.serviceType = 'FTL';
    result.mode = 'DARAT';
  } else if (/\bLTL\b/i.test(prompt)) {
    result.serviceType = 'LTL';
    result.mode = 'DARAT';
  } else if (/\bFCL\b/i.test(prompt)) {
    result.serviceType = 'FCL';
    result.mode = 'LAUT';
  } else if (/\bLCL\b/i.test(prompt)) {
    result.serviceType = 'LCL';
    result.mode = 'LAUT';
  } else if (/\bCargo\b/i.test(prompt) || /\bAir Cargo\b/i.test(prompt)) {
    result.serviceType = 'Cargo';
    result.mode = 'UDARA';
  }

  // 2. Detect duration in hours
  const hoursMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:hours|hour|jam|j)\b/i);
  if (hoursMatch) {
    result.durationHours = parseFloat(hoursMatch[1]);
  }

  // 3. Detect date/time for departure
  const dateMatch = prompt.match(/\b(?:\d{1,2}\s+[a-zA-Z]+\s+\d{4}|\d{4}-\d{1,2}-\d{1,2})(?:\s+\d{1,2}[:.]\d{2})?/i);
  if (dateMatch) {
    result.departureDate = parseDateTime(dateMatch[0]);
  }

  // 4. Split endpoints around hyphen or "to" / "ke"
  // Clean out parsed duration, date, and service type tokens from endpoint extraction
  let cleanedForEndpoints = prompt
    .replace(/(\d+(?:\.\d+)?)\s*(?:hours|hour|jam|j)\b/gi, '')
    .replace(/\b(?:FTL|LTL|FCL|LCL|Air Cargo|Cargo)\b/gi, '')
    .replace(/\b(?:\d{1,2}\s+[a-zA-Z]+\s+\d{4}|\d{4}-\d{1,2}-\d{1,2})(?:\s+\d{1,2}[:.]\d{2})?/gi, '')
    .trim();

  let originStr = '';
  let destStr = '';

  if (cleanedForEndpoints.includes(' - ')) {
    const parts = cleanedForEndpoints.split(' - ');
    originStr = parts[0].trim();
    destStr = parts.slice(1).join(' - ').trim();
  } else if (cleanedForEndpoints.includes(' – ')) {
    const parts = cleanedForEndpoints.split(' – ');
    originStr = parts[0].trim();
    destStr = parts.slice(1).join(' – ').trim();
  } else if (/\b(?:to|ke|menuju)\b/i.test(cleanedForEndpoints)) {
    const parts = cleanedForEndpoints.split(/\b(?:to|ke|menuju)\b/i);
    originStr = parts[0].replace(/^(?:from|dari)\s+/i, '').trim();
    destStr = parts[1].trim();
  } else {
    // Fallback: split by comma if 4 segments (District, City, District, City)
    const segments = cleanedForEndpoints.split(',').map(s => s.trim()).filter(Boolean);
    if (segments.length >= 4) {
      originStr = `${segments[0]}, ${segments[1]}`;
      destStr = `${segments[2]}, ${segments[3]}`;
    } else {
      originStr = cleanedForEndpoints;
    }
  }

  // Clean trailing commas
  originStr = originStr.replace(/^[,\s]+|[,\s]+$/g, '');
  destStr = destStr.replace(/^[,\s]+|[,\s]+$/g, '');

  result.origin = parseLocationString(originStr, result.mode);
  result.destination = parseLocationString(destStr, result.mode);

  // 5. If mode wasn't explicitly determined by service type, infer from endpoints
  if (!result.mode) {
    if (result.origin.mode === 'UDARA' || result.destination.mode === 'UDARA') {
      result.mode = 'UDARA';
      result.serviceType = 'Cargo';
    } else if (result.origin.mode === 'LAUT' || result.destination.mode === 'LAUT') {
      result.mode = 'LAUT';
      result.serviceType = 'FCL';
    } else {
      result.mode = 'DARAT';
      result.serviceType = 'FTL';
    }
  }

  return result;
}

/**
 * Normalize and apply all hardcoded business rules to produce a finalized route specification
 */
function normalizeRouteSpecification(rawRoute) {
  const mode = (rawRoute.mode || 'DARAT').toUpperCase();
  const serviceType = rawRoute.serviceType || (mode === 'DARAT' ? 'FTL' : (mode === 'LAUT' ? 'FCL' : 'Cargo'));
  const origin = rawRoute.origin || { district: 'Rawalumbu', city: 'Kota Bekasi', countryCode: 'ID' };
  const destination = rawRoute.destination || { district: 'Bandung Wetan', city: 'Kota Bandung', countryCode: 'ID' };

  // Calculate Arrival Date for Sea/Air
  let departureDate = rawRoute.departureDate;
  let durationHours = rawRoute.durationHours || 5;
  let arrivalDate = rawRoute.arrivalDate;

  if (mode === 'LAUT' || mode === 'UDARA') {
    if (!departureDate) {
      // Default to 7 days ahead at 08:00 UTC if unspecified
      const now = new Date();
      departureDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7, 8, 0));
    }
    arrivalDate = calculateArrival(departureDate, durationHours);
  }

  // Hardcoded Mode Rules
  let vehicleType = null;
  let containerType = null;
  let packageType = null;

  if (mode === 'DARAT') {
    vehicleType = 'FUSO BOX';
  } else if (mode === 'LAUT') {
    containerType = '40 FT STANDARD';
  } else if (mode === 'UDARA') {
    packageType = 'TANPA KEMASAN';
  }

  // International Classification & Incoterms
  const isInternational = classifyRouteInternational(origin, destination, mode);
  const incoterm = isInternational ? {
    code: 'DDP',
    name: 'DELIVERY DUTY PAID (DDP)',
    component: 'ASURANSI',
    componentAmount: 0,
  } : null;

  // Additional Services (Pickup Crane Rp50.000, Destination None)
  const additionalServices = {
    pickup: {
      serviceName: 'CRANE',
      serviceFee: 50000,
    },
    destination: null,
  };

  // Backhaul: ALWAYS EMPTY
  const backhaul = null;

  // Build Tariff
  const tariff = buildRouteTariff(mode, serviceType, rawRoute.userTariff || {});

  // Route Name
  const originLabel = origin.portName || `${origin.district ? origin.district + ', ' : ''}${origin.city}`;
  const destLabel = destination.portName || `${destination.district ? destination.district + ', ' : ''}${destination.city}`;
  const routeName = `${originLabel} - ${destLabel} (${mode} ${serviceType})`;

  return {
    routeName,
    mode,
    serviceType,
    vehicleType,
    containerType,
    packageType,
    origin,
    destination,
    isInternational,
    incoterm,
    durationHours,
    departureDate,
    arrivalDate,
    tariff,
    additionalServices,
    backhaul,
    status: 'READY_FOR_REVIEW',
  };
}

/**
 * Format complete human-readable review for terminal CLI / UI before submission
 */
function formatRouteReview(route, index = 1) {
  const originStr = route.origin.portName
    ? `${route.origin.portName} (${route.origin.city}, ${route.origin.country}) [PORT]`
    : `${route.origin.district}, ${route.origin.city}, ${route.origin.province} [DOOR]`;

  const destStr = route.destination.portName
    ? `${route.destination.portName} (${route.destination.city}, ${route.destination.country}) [PORT]`
    : `${route.destination.district}, ${route.destination.city}, ${route.destination.province} [DOOR]`;

  let timelineStr = '';
  if (route.mode === 'DARAT') {
    timelineStr = `SLA: ${route.durationHours} Hours`;
  } else {
    timelineStr = `Departure: ${formatDateTimeString(route.departureDate)} | Transit: ${route.durationHours} Hours | Arrival: ${formatDateTimeString(route.arrivalDate)}`;
  }

  let equipmentStr = '';
  if (route.vehicleType) equipmentStr = `Vehicle Type: ${route.vehicleType}`;
  if (route.containerType) equipmentStr = `Container Type: ${route.containerType}`;
  if (route.packageType) equipmentStr = `Packaging: ${route.packageType}`;

  let priceStr = '';
  if (route.tariff.tariffType === 'RITASE' || route.tariff.tariffType === 'FCL') {
    priceStr = `Fixed Rate: ${formatRupiah(route.tariff.costRitase)} [${route.tariff.sources.costRitase}]`;
  } else {
    priceStr = `KG: ${formatRupiah(route.tariff.costPerKg)} | Ton: ${formatRupiah(route.tariff.costPerTonase)} | CBM: ${formatRupiah(route.tariff.costPerCbm)} [${route.tariff.sources.costPerKg}]`;
  }

  const intlStr = route.isInternational
    ? `YES (Incoterm: ${route.incoterm.name}, Component: ${route.incoterm.component} @ ${formatRupiah(route.incoterm.componentAmount)})`
    : `NO (Domestic)`;

  const addStr = route.additionalServices?.pickup
    ? `Pickup: ${route.additionalServices.pickup.serviceName} (${formatRupiah(route.additionalServices.pickup.serviceFee)}) | Destination: None`
    : `None`;

  return `------------------------------------------------------
[Route #${index}] ${route.routeName}
- Transport Mode:   ${route.mode} (${route.serviceType})
- Origin:           ${originStr}
- Destination:      ${destStr}
- Classification:   ${intlStr}
- Equipment:        ${equipmentStr}
- Schedule / SLA:   ${timelineStr}
- Tariff (${route.tariff.tariffType}): ${priceStr}
- Addl. Services:   ${addStr}
- Backhaul:         EMPTY (Never Selected)`;
}

/**
 * Format full Catalog review with parent header and all routes
 */
function formatCatalogReview(catalogSpec) {
  const lines = [];
  lines.push('======================================================');
  lines.push('            VMS SERVICE CATALOG REVIEW               ');
  lines.push('======================================================');
  lines.push(`Catalog Name:   ${catalogSpec.name}`);
  lines.push(`Validity Dates: ${catalogSpec.startDate} s/d ${catalogSpec.endDate}`);
  lines.push(`Total Routes:   ${catalogSpec.routes.length}`);
  lines.push('');

  catalogSpec.routes.forEach((r, idx) => {
    lines.push(formatRouteReview(r, idx + 1));
  });

  lines.push('======================================================');
  return lines.join('\n');
}

module.exports = {
  parseDateTime,
  formatDateTimeString,
  calculateArrival,
  parseRoutePrompt,
  normalizeRouteSpecification,
  formatRouteReview,
  formatCatalogReview,
};
