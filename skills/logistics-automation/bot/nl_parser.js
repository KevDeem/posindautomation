/**
 * Natural Language Specification Parser for POSIND Ordering Bot
 * 
 * Extracts route endpoints, dates, times, cargo, PIC preferences, quantities,
 * and order types from natural-language text.
 */

const {
  extractAdminPrefix,
  normalizeAdminCityName,
  detectLocationType,
  normalizeIncoterm,
  KNOWN_PROVINCES,
  KNOWN_DISTRICT_HIERARCHY,
} = require('../tools/location_matcher');

const MONTH_MAP = {
  jan: '01', januari: '01', january: '01',
  feb: '02', februari: '02', february: '02',
  mar: '03', maret: '03', march: '03',
  apr: '04', april: '04',
  mei: '05', may: '05',
  jun: '06', juni: '06', june: '06',
  jul: '07', juli: '07', july: '07',
  agt: '08', aug: '08', agustus: '08', august: '08',
  sep: '09', september: '09',
  okt: '10', oct: '10', oktober: '10', october: '10',
  nov: '11', november: '11',
  des: '12', dec: '12', desember: '12', december: '12',
};

/**
 * Parse date expressions like "1 December 2026", "2026-12-01", "19 November 2026"
 */
function parseDateString(text) {
  if (!text) return null;

  // Format: YYYY-MM-DD
  const isoMatch = text.match(/\b(202\d)-(0[1-9]|1[0-2])-([0-2]\d|3[01])\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // Format: [1st|1] [December|Dec] [2026]
  const wordDateMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\s+(202\d)\b/i) ||
                        text.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(202\d)\b/i);

  if (wordDateMatch) {
    let day, monthStr, year;
    if (isNaN(wordDateMatch[1])) {
      monthStr = wordDateMatch[1].toLowerCase();
      day = wordDateMatch[2].padStart(2, '0');
      year = wordDateMatch[3];
    } else {
      day = wordDateMatch[1].padStart(2, '0');
      monthStr = wordDateMatch[2].toLowerCase();
      year = wordDateMatch[3];
    }

    const monthNum = MONTH_MAP[monthStr.slice(0, 3)] || MONTH_MAP[monthStr];
    if (monthNum) {
      return `${year}-${monthNum}-${day}`;
    }
  }

  return null;
}

/**
 * Parse time string like "08:00", "8:00", "03:30", "10:00", "8 AM", "8:00 AM", "2 PM", "2:30 PM"
 */
function parseTimeString(text) {
  if (!text) return null;

  // 12-hour AM/PM format: e.g. "8 AM", "08:00 AM", "2:30 PM", "2 PM"
  const ampmMatch = text.match(/\b(0?[1-9]|1[0-2])(?::([0-5]\d))?\s*(am|pm)\b/i);
  if (ampmMatch) {
    let hour = parseInt(ampmMatch[1], 10);
    const minute = ampmMatch[2] ? ampmMatch[2] : '00';
    const meridiem = ampmMatch[3].toLowerCase();
    if (meridiem === 'pm' && hour < 12) {
      hour += 12;
    } else if (meridiem === 'am' && hour === 12) {
      hour = 0;
    }
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }

  // 24-hour format: e.g. "08:00", "14:30", "8:00"
  const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (timeMatch) {
    return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
  }
  return null;
}

/**
 * Parse transit duration expression like "6 hours", "15 hrs", "2 days", "15 jam", "2 hari"
 */
function parseTransitDuration(text) {
  if (!text) return null;
  const daysMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:days?|hari)\b/i);
  if (daysMatch) {
    const days = parseFloat(daysMatch[1]);
    const hours = Math.round(days * 24);
    return {
      text: `${daysMatch[1]} day${daysMatch[1] === '1' ? '' : 's'}`,
      hours,
      days,
    };
  }

  const hoursMatch = text.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|jam)\b/i);
  if (hoursMatch) {
    const hours = parseFloat(hoursMatch[1]);
    return {
      text: `${hoursMatch[1]} hour${hoursMatch[1] === '1' ? '' : 's'}`,
      hours,
    };
  }

  return null;
}

/**
 * Strips date, time, transit duration, and scheduling keywords from location strings.
 * Preserves multi-word port names intact.
 *
 * @param {string} str Raw location string
 * @returns {string} Cleaned location string
 */
function stripScheduleAndMetadata(str) {
  if (!str || typeof str !== 'string') return '';
  let clean = str;

  // 1. Strip transit duration patterns: e.g. "15 hours", "6 hrs", "2 days", "15 jam", "2 hari"
  clean = clean.replace(/\b\d+(?:\.\d+)?\s*(?:days?|hari|hours?|hrs?|jam)\b/gi, '');

  // 2. Strip word dates: e.g. "25 Nov 2026", "25 November 2026", "Nov 25 2026", "November 25, 2026"
  clean = clean.replace(/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|mei|may|jun|jul|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*\s+202\d\b/gi, '');
  clean = clean.replace(/\b(?:jan|feb|mar|apr|mei|may|jun|jul|agt|aug|sep|okt|oct|nov|des|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:,)?\s+202\d\b/gi, '');

  // 3. Strip ISO dates: e.g. "2026-11-25"
  clean = clean.replace(/\b202\d-(?:0[1-9]|1[0-2])-(?:[0-2]\d|3[01])\b/g, '');

  // 4. Strip 12-hour AM/PM times: e.g. "8 AM", "08:00 AM", "2:30 PM", "2 PM"
  clean = clean.replace(/\b(?:0?[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:am|pm)\b/gi, '');

  // 5. Strip 24-hour times: e.g. "08:00", "14:30"
  clean = clean.replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g, '');

  // 6. Strip connecting schedule / transit keywords
  clean = clean.replace(/\s+\b(?:scheduled\s+for|scheduled|departure|arrival|pickup|drop-?off)\b.*$/i, '');
  clean = clean.replace(/\s+\b(?:transit\s+duration|duration|durasi)\b.*$/i, '');
  clean = clean.replace(/\s+\b(?:on|at|pada|tanggal|jam)\b.*$/i, '');

  // 7. Strip transport modes/incoterms if appended
  clean = clean.replace(/\s+\b(?:air\s+cargo|air|sea\s+freight\s+(?:fcl|lcl)|sea\s+(?:fcl|lcl)|sea\s+freight|sea|land|darat|laut|udara|ddp|dap|cif|fob)\b.*$/i, '');

  // 8. Clean leading/trailing punctuation and whitespace
  clean = clean.replace(/^(?:in|at|di|ke|from|dari|to|tujuan)\s+/i, '');
  clean = clean.replace(/^[,:\s–—\-]+|[,:\s–—\-]+$/g, '');

  return clean.trim();
}

/**
 * Parse natural language order instruction.
 * 
 * @param {string} prompt Natural language instruction
 * @returns {Object} { spec, count, autoPay, headless }
 */
function parseOrderPrompt(prompt = '') {
  const text = String(prompt).trim();
  const lower = text.toLowerCase();

  const spec = {};
  let count = 1;
  let headless = false;
  let autoPay = false;

  // 1. Quantity / Count
  const countMatch = lower.match(/\b(\d+)\s*(?:domestic|international|orders?|pesanan|pengiriman)\b/i) ||
                     lower.match(/(?:create|buat|pesan)\s*(\d+)\s*/i);
  if (countMatch && parseInt(countMatch[1], 10) > 0) {
    count = parseInt(countMatch[1], 10);
  }

  // 2. Order Type
  if (
    lower.includes('international') ||
    lower.includes('internasional') ||
    lower.includes('singapore') ||
    lower.includes('orchard') ||
    lower.includes('japan') ||
    lower.includes('tokyo') ||
    lower.includes('malaysia')
  ) {
    spec.orderType = 'international';
  } else if (lower.includes('domestic') || lower.includes('domestik')) {
    spec.orderType = 'domestic';
  }

  // 3. Headless Mode
  if (lower.includes('headless')) {
    headless = true;
  }

  // 4. Payment Simulation
  if (lower.includes('pay') || lower.includes('bayar') || lower.includes('pembayaran')) {
    autoPay = true;
  }

  // 5. Transportation Mode & Service Type
  if (lower.includes('air cargo') || (lower.includes('air') && lower.includes('cargo'))) {
    spec.transportationMode = 'Air';
    spec.serviceType = 'Cargo';
  } else if (lower.includes('air') || lower.includes('udara')) {
    spec.transportationMode = 'Air';
    spec.serviceType = 'Cargo';
  } else if (lower.includes('sea freight fcl') || lower.includes('sea fcl') || (lower.includes('sea') && lower.includes('fcl'))) {
    spec.transportationMode = 'Sea Freight';
    spec.serviceType = 'FCL';
  } else if (lower.includes('sea freight lcl') || lower.includes('sea lcl') || (lower.includes('sea') && lower.includes('lcl'))) {
    spec.transportationMode = 'Sea Freight';
    spec.serviceType = 'LCL';
  } else if (lower.includes('sea freight') || lower.includes('sea') || lower.includes('laut')) {
    spec.transportationMode = 'Sea Freight';
  } else if (lower.includes('land') || lower.includes('darat')) {
    spec.transportationMode = 'Land';
  }

  // 5b. Incoterm
  const incotermMatch = lower.match(/\b(ddp|dap|dpu|fas|cip|cpt|cif|cfr|fob|fca|delivered\s+duty\s+paid|delivered\s+at\s+place|cost\s+insurance\s+and\s+freight|free\s+on\s+board)\b/i);
  if (incotermMatch) {
    spec.incoterm = normalizeIncoterm(incotermMatch[1]);
  } else if (spec.orderType === 'international') {
    spec.incoterm = 'Delivered Duty Paid';
  }

  // 6. Schedule Date & Time
  const date = parseDateString(text);
  if (date) spec.scheduledDate = date;

  const time = parseTimeString(text);
  if (time) spec.scheduledTime = time;

  const duration = parseTransitDuration(text);
  if (duration) {
    spec.transitDuration = duration.text;
    spec.durationHours = duration.hours;
  }

  // 7. Route: From ... To ...
  spec.pickup = {};
  spec.dropoff = {};

  // Check if user explicitly mentioned a destination
  const hasDestinationMention = /(?:\bto\b|\bke\b|\bantar\s+ke\b|\btujuan(?:\s+ke)?\b|\bdrop-?off\b|\bdestination\b)/i.test(text);
  if (hasDestinationMention) {
    spec._explicitDestinationProvided = true;
  }

  const FOREIGN_COUNTRIES = {
    'japan': 'Japan',
    'jepang': 'Japan',
    'singapore': 'Singapore',
    'singapura': 'Singapore',
    'malaysia': 'Malaysia',
    'china': 'China',
    'australia': 'Australia',
    'united states': 'United States',
    'usa': 'United States',
  };

  function cleanLocationText(raw) {
    if (!raw) return { district: '', city: '', province: '', address: '', locationType: 'Door' };
    const locType = detectLocationType(raw);
    let clean = stripScheduleAndMetadata(raw);

    if (/(?:unknown|destin|somewhere|unspecified|atlantis|entah)/i.test(clean)) {
      return {
        city: '',
        unresolved: true,
        raw: clean,
        locationType: locType,
      };
    }

    // Specific port / airport shortcuts
    if (/soekarno-?hatta/i.test(clean)) {
      return {
        district: 'Benda',
        locality: 'Soekarno-Hatta',
        city: 'Kota Tangerang',
        province: 'Banten',
        country: 'Indonesia',
        postalCode: '15125',
        locationType: 'Port',
        searchQuery: 'Soekarno-Hatta',
        parentContext: 'Indonesia',
        address: '',
      };
    }
    if (/tanjung\s+priok/i.test(clean)) {
      return {
        district: 'Tanjung Priok',
        locality: 'Tanjung Priok',
        city: 'Jakarta Utara',
        province: 'DKI Jakarta',
        country: 'Indonesia',
        postalCode: '14310',
        locationType: 'Port',
        searchQuery: 'Tanjung Priok',
        parentContext: 'Indonesia',
        address: '',
      };
    }
    if (/tokyo\s+airport|haneda|narita/i.test(clean)) {
      const portName = /narita/i.test(clean) ? 'Narita' : (/haneda/i.test(clean) ? 'Haneda' : 'Tokyo Airport');
      return {
        district: '',
        locality: portName,
        city: 'Tokyo',
        country: 'Japan',
        locationType: 'Port',
        searchQuery: portName,
        parentContext: 'Japan',
        address: '',
      };
    }
    if (/changi/i.test(clean)) {
      return {
        district: '',
        locality: 'Changi Airport',
        city: 'Singapore',
        country: 'Singapore',
        locationType: 'Port',
        searchQuery: 'Changi Airport',
        parentContext: 'Singapore',
        address: '',
      };
    }
    if (/pasir\s+panjang/i.test(clean)) {
      return {
        district: '',
        locality: 'Pasir Panjang',
        city: 'Singapore',
        country: 'Singapore',
        locationType: 'Port',
        searchQuery: 'Pasir Panjang',
        parentContext: 'Singapore',
        address: '',
      };
    }
    if (/jurong/i.test(clean)) {
      return {
        district: '',
        locality: 'Jurong Port',
        city: 'Singapore',
        country: 'Singapore',
        locationType: 'Port',
        searchQuery: 'Jurong Port',
        parentContext: 'Singapore',
        address: '',
      };
    }
    if (/singapore\s+port/i.test(clean)) {
      return {
        district: '',
        locality: 'Singapore Port',
        city: 'Singapore',
        country: 'Singapore',
        locationType: 'Port',
        searchQuery: 'Singapore Port',
        parentContext: 'Singapore',
        address: '',
      };
    }

    // 1. If comma-separated format: e.g. "Tokyo, Japan" or "Benda, Kota Tangerang"
    if (clean.includes(',')) {
      const parts = clean.split(',').map(s => s.trim()).filter(Boolean);
      const firstPart = parts[0] || '';
      const secondPart = parts[1] || '';
      const thirdPart = parts[2] || '';

      const secondLower = secondPart.toLowerCase();

      // Check if second part is a foreign country (e.g. "Tokyo, Japan" or "Orchard, Singapore")
      if (FOREIGN_COUNTRIES[secondLower]) {
        const countryName = FOREIGN_COUNTRIES[secondLower];
        const isSg = countryName === 'Singapore';
        let portLocality = firstPart;
        let pLocType = locType;
        if (/changi/i.test(firstPart)) {
          portLocality = 'Changi Airport';
          pLocType = 'Port';
        } else if (/pasir\s+panjang/i.test(firstPart)) {
          portLocality = 'Pasir Panjang';
          pLocType = 'Port';
        } else if (/jurong/i.test(firstPart)) {
          portLocality = 'Jurong Port';
          pLocType = 'Port';
        } else if (/tokyo\s+airport|haneda|narita/i.test(firstPart)) {
          portLocality = /narita/i.test(firstPart) ? 'Narita' : (/haneda/i.test(firstPart) ? 'Haneda' : 'Tokyo Airport');
          pLocType = 'Port';
        }
        return {
          district: isSg ? '' : firstPart,
          locality: portLocality,
          city: firstPart,
          country: countryName,
          postalCode: isSg ? '238801' : '',
          locationType: pLocType,
          searchQuery: portLocality,
          parentContext: countryName,
          address: '',
        };
      }

      const adminCity = extractAdminPrefix(secondPart);
      let resolvedCity = '';
      let resolvedProv = thirdPart;

      if (adminCity.prefix) {
        resolvedCity = adminCity.fullName;
        if (!resolvedProv && KNOWN_PROVINCES[adminCity.baseName.toLowerCase()]) {
          resolvedProv = KNOWN_PROVINCES[adminCity.baseName.toLowerCase()];
        }
      } else if (secondPart) {
        const baseLower = secondPart.toLowerCase();
        const knownDist = KNOWN_DISTRICT_HIERARCHY[firstPart.toLowerCase()];
        if (knownDist && extractAdminPrefix(knownDist.city).baseName.toLowerCase() === baseLower) {
          resolvedCity = knownDist.city;
          resolvedProv = resolvedProv || knownDist.province;
        } else {
          resolvedCity = normalizeAdminCityName(secondPart);
          if (!resolvedProv && KNOWN_PROVINCES[baseLower]) {
            resolvedProv = KNOWN_PROVINCES[baseLower];
          }
        }
      } else {
        resolvedCity = normalizeAdminCityName(firstPart);
      }

      return {
        district: firstPart,
        locality: firstPart,
        city: resolvedCity,
        province: resolvedProv,
        country: 'Indonesia',
        locationType: locType,
        searchQuery: firstPart,
        parentContext: resolvedCity,
        address: '',
      };
    }

    // Direct foreign country/city check without comma
    if (/singapore|orchard/i.test(clean)) {
      return {
        district: '',
        locality: 'Orchard',
        city: 'Orchard',
        country: 'Singapore',
        postalCode: '238801',
        locationType: locType,
        searchQuery: 'Orchard',
        parentContext: 'Singapore',
        address: '',
      };
    }
    if (/tokyo|japan|jepang/i.test(clean)) {
      return {
        district: '',
        locality: 'Tokyo',
        city: 'Tokyo',
        country: 'Japan',
        locationType: locType,
        searchQuery: 'Tokyo',
        parentContext: 'Japan',
        address: '',
      };
    }

    // 2. No comma: check explicit administrative prefix (e.g. "Kabupaten Tegal", "Kota Tegal", "Kabupaten Bandung", etc.)
    const adminCheck = extractAdminPrefix(clean);
    if (adminCheck.prefix) {
      let matchedDist = '';
      const cleanLower = clean.toLowerCase();
      for (const d of Object.keys(KNOWN_DISTRICT_HIERARCHY)) {
        if (cleanLower.includes(d)) {
          matchedDist = d.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          break;
        }
      }
      return {
        district: matchedDist,
        city: adminCheck.fullName,
        province: KNOWN_PROVINCES[adminCheck.baseName.toLowerCase()] || '',
        address: '',
      };
    }

    // 3. Check if text mentions a known district (e.g. "Adiwerna", "Gubeng", "Kesambi", "Tebet")
    const cleanLower = clean.toLowerCase();
    for (const [distKey, distInfo] of Object.entries(KNOWN_DISTRICT_HIERARCHY)) {
      if (cleanLower.includes(distKey)) {
        const formattedDist = distKey.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        if (/kabupaten|kab\b/i.test(clean)) {
          const parsed = extractAdminPrefix(clean.replace(new RegExp(distKey, 'i'), '').trim());
          if (parsed.prefix) {
            return {
              district: formattedDist,
              locality: formattedDist,
              city: parsed.fullName,
              province: KNOWN_PROVINCES[parsed.baseName.toLowerCase()] || distInfo.province,
              country: 'Indonesia',
              locationType: locType,
              searchQuery: formattedDist,
              parentContext: parsed.fullName,
              address: '',
            };
          }
        }
        if (/kota\b/i.test(clean)) {
          const parsed = extractAdminPrefix(clean.replace(new RegExp(distKey, 'i'), '').trim());
          if (parsed.prefix) {
            return {
              district: formattedDist,
              locality: formattedDist,
              city: parsed.fullName,
              province: KNOWN_PROVINCES[parsed.baseName.toLowerCase()] || distInfo.province,
              country: 'Indonesia',
              locationType: locType,
              searchQuery: formattedDist,
              parentContext: parsed.fullName,
              address: '',
            };
          }
        }

        return {
          district: formattedDist,
          locality: formattedDist,
          city: distInfo.city,
          province: distInfo.province,
          country: 'Indonesia',
          locationType: locType,
          searchQuery: formattedDist,
          parentContext: distInfo.city,
          address: '',
        };
      }
    }

    // 4. Base city pattern matching without explicit prefix
    if (/jakarta/i.test(clean)) {
      return { district: '', locality: 'Jakarta Selatan', city: 'Jakarta Selatan', province: 'DKI Jakarta', country: 'Indonesia', locationType: locType, searchQuery: 'Jakarta', parentContext: 'DKI Jakarta', address: '' };
    }
    if (/surabaya/i.test(clean)) {
      return { district: '', locality: 'Kota Surabaya', city: 'Kota Surabaya', province: 'Jawa Timur', country: 'Indonesia', locationType: locType, searchQuery: 'Surabaya', parentContext: 'Jawa Timur', address: '' };
    }
    if (/cirebon/i.test(clean)) {
      const isKab = /kabupaten|kab\b/i.test(clean);
      const cCity = isKab ? 'Kabupaten Cirebon' : 'Kota Cirebon';
      return { district: '', locality: cCity, city: cCity, province: 'Jawa Barat', country: 'Indonesia', locationType: locType, searchQuery: 'Cirebon', parentContext: 'Jawa Barat', address: '' };
    }
    if (/tegal/i.test(clean)) {
      const isKab = /kabupaten|kab\b/i.test(clean);
      const isKota = /kota\b/i.test(clean);
      const tCity = isKab ? 'Kabupaten Tegal' : (isKota ? 'Kota Tegal' : 'Tegal');
      return { district: '', locality: tCity, city: tCity, province: 'Jawa Tengah', country: 'Indonesia', locationType: locType, searchQuery: 'Tegal', parentContext: 'Jawa Tengah', address: '' };
    }
    if (/bandung/i.test(clean)) {
      const isKab = /kabupaten|kab\b/i.test(clean);
      const bCity = isKab ? 'Kabupaten Bandung' : 'Kota Bandung';
      return { district: '', locality: bCity, city: bCity, province: 'Jawa Barat', country: 'Indonesia', locationType: locType, searchQuery: 'Bandung', parentContext: 'Jawa Barat', address: '' };
    }
    if (/tangerang/i.test(clean)) {
      const isKab = /kabupaten|kab\b/i.test(clean);
      return { district: '', locality: isKab ? 'Kabupaten Tangerang' : 'Kota Tangerang', city: isKab ? 'Kabupaten Tangerang' : 'Kota Tangerang', province: 'Banten', country: 'Indonesia', locationType: locType, searchQuery: 'Tangerang', parentContext: 'Banten', address: '' };
    }

    return {
      city: clean,
      locality: clean,
      country: 'Indonesia',
      locationType: locType,
      searchQuery: clean,
      parentContext: clean,
      address: '',
    };
  }

  // Primary Route Regex: prioritize explicit "from X to Y", "dari X ke Y", "pickup X to Y", or "X - Y"
  let routeMatch = text.match(/(?:from|dari|pickup(?:\s+in|\s+at|\s+di)?)\s+([\s\S]+?)(?:\s+(?:to|ke|antar\s+ke|tujuan(?:\s+ke)?)\s+|\s+[-–—]\s+)([\s\S]+?)$/i);
  if (!routeMatch) {
    routeMatch = text.match(/(?:^|orders?\s+|pengiriman\s+)?([A-Za-z0-9\s,.'()\-]+?)(?:\s+(?:to|ke|antar\s+ke|tujuan(?:\s+ke)?)\s+|\s+[-–—]\s+)([\s\S]+?)$/i);
  }

  if (routeMatch) {
    const fromRaw = routeMatch[1].trim();
    const toRaw = routeMatch[2].trim();

    const fromParsed = cleanLocationText(fromRaw);
    const toParsed = cleanLocationText(toRaw);

    Object.assign(spec.pickup, fromParsed);
    Object.assign(spec.dropoff, toParsed);

    if (!toParsed.city || toParsed.city.trim() === '') {
      spec.dropoff.unresolved = true;
      spec.dropoff.raw = toRaw;
    }
  } else {
    // Check individual pickup / dropoff mentions
    const pickupMatch = text.match(/(?:pickup|jemput|asal|from|dari)(?:\s+(?:in|at|di))?\s*[:\-]?\s*([^,.\n]+?)(?=\s+(?:to|ke|drop-?off|tujuan|antar|on|at|pada|tanggal|jam|scheduled|$))/i);
    if (pickupMatch) {
      Object.assign(spec.pickup, cleanLocationText(pickupMatch[1]));
    }

    const dropoffMatch = text.match(/(?:to|ke|drop-?off|tujuan|antar|destination)(?:\s+(?:in|at|di|ke))?\s*[:\-]?\s*([^,.\n]+?)(?=\s+(?:on|at|pada|tanggal|jam|scheduled|$))/i);
    if (dropoffMatch) {
      const toParsed = cleanLocationText(dropoffMatch[1]);
      Object.assign(spec.dropoff, toParsed);
      if (!toParsed.city || toParsed.city.trim() === '') {
        spec.dropoff.unresolved = true;
        spec.dropoff.raw = dropoffMatch[1].trim();
      }
    } else if (hasDestinationMention) {
      spec.dropoff.unresolved = true;
      spec.dropoff.raw = text;
    }
  }

  // Specific city cleanups - strictly preserve administrative prefixes
  for (const role of ['pickup', 'dropoff']) {
    const loc = spec[role];
    if (!loc || !loc.city) continue;

    const admin = extractAdminPrefix(loc.city);
    const cityLower = admin.baseName.toLowerCase();

    if (cityLower.includes('jakarta')) {
      loc.province = loc.province || 'DKI Jakarta';
      if (!admin.baseName.toLowerCase().includes('selatan') && !admin.baseName.toLowerCase().includes('pusat')) {
        loc.city = 'Jakarta Selatan';
      }
    } else if (cityLower === 'surabaya') {
      loc.province = loc.province || 'Jawa Timur';
      loc.city = admin.prefix ? `${admin.prefix} Surabaya` : 'Kota Surabaya';
    } else if (cityLower === 'cirebon') {
      loc.province = loc.province || 'Jawa Barat';
      if (!admin.prefix) {
        loc.city = 'Kota Cirebon';
      }
    } else if (cityLower === 'tegal') {
      loc.province = loc.province || 'Jawa Tengah';
      if (!admin.prefix) {
        if (loc.district && loc.district.toLowerCase() === 'adiwerna') {
          loc.city = 'Kabupaten Tegal';
        }
      }
    } else if (cityLower === 'bandung') {
      loc.province = loc.province || 'Jawa Barat';
      if (!admin.prefix) {
        loc.city = 'Kota Bandung';
      }
    } else if (cityLower === 'tangerang') {
      loc.province = loc.province || 'Banten';
      loc.country = loc.country || 'Indonesia';
      if (!admin.prefix) {
        loc.city = 'Kota Tangerang';
      }
    } else if (cityLower === 'singapore' || cityLower === 'orchard') {
      loc.country = 'Singapore';
      loc.city = 'Orchard';
      loc.postalCode = loc.postalCode || '238801';
    } else if (cityLower === 'tokyo' || cityLower === 'japan') {
      loc.country = 'Japan';
      loc.city = 'Tokyo';
    }
  }

  // Cross-check international orderType from resolved endpoints
  const isPickupForeign = spec.pickup?.country && spec.pickup.country.toLowerCase() !== 'indonesia';
  const isDropoffForeign = spec.dropoff?.country && spec.dropoff.country.toLowerCase() !== 'indonesia';
  if (isPickupForeign || isDropoffForeign) {
    spec.orderType = 'international';
  }
  if (spec.orderType === 'international' && !spec.incoterm) {
    spec.incoterm = 'Delivered Duty Paid';
  }

  // Infer transportationMode from endpoints if unspecified
  if (!spec.transportationMode) {
    const pLoc = `${spec.pickup?.locality || ''} ${spec.pickup?.raw || ''}`.toLowerCase();
    const dLoc = `${spec.dropoff?.locality || ''} ${spec.dropoff?.raw || ''}`.toLowerCase();
    const isAirport = (loc) => /airport|bandara|changi|soekarno-?hatta|haneda|narita/i.test(loc);
    const isSeaPort = (loc) => /priok|pasir\s+panjang|jurong|pelabuhan|port|tanjung/i.test(loc);

    if (isAirport(pLoc) || isAirport(dLoc)) {
      spec.transportationMode = 'Air';
      spec.serviceType = spec.serviceType || 'Cargo';
    } else if (isSeaPort(pLoc) || isSeaPort(dLoc)) {
      spec.transportationMode = 'Sea Freight';
    }
  }

  // 8. Cargo details
  spec.cargo = {};
  const weightMatch = text.match(/(\d+)\s*(?:kg|kilogram)/i);
  if (weightMatch) spec.cargo.weightKg = parseInt(weightMatch[1], 10);

  const itemMatch = text.match(/(?:cargo\s*item\s*[:=]?|(?:item|barang|commodity|komoditas)\s*[:=]?|cargo\s*[:=])\s*([^,.\n]+)/i);
  if (itemMatch) {
    let cleanItem = itemMatch[1].trim();
    cleanItem = cleanItem.replace(/\s*\d+\s*(?:kg|kilogram).*/i, '').trim();
    if (cleanItem) spec.cargo.itemName = cleanItem;
  }

  // 9. PIC requests
  if (lower.includes('generate realistic pic') || lower.includes('generate pic') || lower.includes('synthetic pic')) {
    spec.generatePickupPic = true;
    spec.generateDropoffPic = true;
  }

  // Clean empty sub-objects
  if (Object.keys(spec.pickup).length === 0) delete spec.pickup;
  if (Object.keys(spec.dropoff).length === 0) delete spec.dropoff;
  if (Object.keys(spec.cargo).length === 0) delete spec.cargo;

  return {
    spec,
    count,
    autoPay,
    headless,
  };
}

module.exports = {
  parseOrderPrompt,
  parseDateString,
  parseTimeString,
  parseTransitDuration,
  stripScheduleAndMetadata,
};
