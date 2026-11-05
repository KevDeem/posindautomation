/**
 * Natural Language Specification Parser for POSIND Ordering Bot
 * 
 * Extracts route endpoints, dates, times, cargo, PIC preferences, quantities,
 * and order types from natural-language text.
 */

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
 * Parse time string like "08:00", "8:00", "03:30", "10:00"
 */
function parseTimeString(text) {
  if (!text) return null;
  const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (timeMatch) {
    return `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
  }
  return null;
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
  if (lower.includes('international') || lower.includes('internasional') || lower.includes('singapore') || lower.includes('orchard')) {
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

  // 5. Transportation Mode
  if (lower.includes('air cargo') || lower.includes('udara')) {
    spec.transportationMode = 'Air';
    spec.serviceType = 'Cargo';
  } else if (lower.includes('sea freight') || lower.includes('laut')) {
    spec.transportationMode = 'Sea';
  } else if (lower.includes('land') || lower.includes('darat')) {
    spec.transportationMode = 'Land';
  }

  // 6. Schedule Date & Time
  const date = parseDateString(text);
  if (date) spec.scheduledDate = date;

  const time = parseTimeString(text);
  if (time) spec.scheduledTime = time;

  // 7. Route: From ... To ...
  spec.pickup = {};
  spec.dropoff = {};

  // Check if user explicitly mentioned a destination
  const hasDestinationMention = /(?:\bto\b|\bke\b|\bantar\s+ke\b|\btujuan(?:\s+ke)?\b|\bdrop-?off\b|\bdestination\b)/i.test(text);
  if (hasDestinationMention) {
    spec._explicitDestinationProvided = true;
  }

  function cleanLocationText(raw) {
    if (!raw) return { district: '', city: '', province: '', address: '' };
    let clean = raw.replace(/\s+\b(?:on|at|pada|tanggal|jam|scheduled|pickup)\b.*$/i, '').trim();
    clean = clean.replace(/^(?:in|at|di|ke|from|dari|to|tujuan)\s+/i, '');
    clean = clean.replace(/^[,:\s]+|[,:\s]+$/g, '');

    if (/(?:unknown|destin|somewhere|unspecified|atlantis|entah)/i.test(clean)) {
      return {
        city: '',
        unresolved: true,
        raw: clean,
      };
    }

    const knownPairs = [
      { prefix: 'Tebet', city: 'Jakarta Selatan', district: 'Tebet', province: 'DKI Jakarta' },
      { prefix: 'Gubeng', city: 'Kota Surabaya', district: 'Gubeng', province: 'Jawa Timur' },
      { prefix: 'Kesambi', city: 'Kota Cirebon', district: 'Kesambi', province: 'Jawa Barat' },
      { prefix: 'Adiwerna', city: 'Kabupaten Tegal', district: 'Adiwerna', province: 'Jawa Tengah' },
      { prefix: 'Lengkong', city: 'Kota Bandung', district: 'Lengkong', province: 'Jawa Barat' },
      { prefix: 'Bekasi Barat', city: 'Kota Bekasi', district: 'Bekasi Barat', province: 'Jawa Barat' },
    ];

    for (const kp of knownPairs) {
      if (clean.toLowerCase().includes(kp.prefix.toLowerCase())) {
        return {
          district: kp.district,
          city: kp.city,
          province: kp.province,
          address: '',
        };
      }
    }

    if (clean.includes(',')) {
      const parts = clean.split(',').map(s => s.trim()).filter(Boolean);
      return {
        district: parts[0] || '',
        city: parts[1] || parts[0] || '',
        province: parts[2] || '',
        address: '',
      };
    }

    if (/jakarta/i.test(clean)) {
      const dist = /tebet/i.test(clean) ? 'Tebet' : '';
      return { district: dist, city: 'Jakarta Selatan', province: 'DKI Jakarta', address: '' };
    }
    if (/surabaya/i.test(clean)) {
      const dist = /gubeng/i.test(clean) ? 'Gubeng' : '';
      return { district: dist, city: 'Kota Surabaya', province: 'Jawa Timur', address: '' };
    }
    if (/cirebon/i.test(clean)) {
      const dist = /kesambi/i.test(clean) ? 'Kesambi' : '';
      return { district: dist, city: 'Kota Cirebon', province: 'Jawa Barat', address: '' };
    }
    if (/tegal/i.test(clean)) {
      const dist = /adiwerna/i.test(clean) ? 'Adiwerna' : '';
      return { district: dist, city: 'Kabupaten Tegal', province: 'Jawa Tengah', address: '' };
    }
    if (/bandung/i.test(clean)) {
      return { district: '', city: 'Kota Bandung', province: 'Jawa Barat', address: '' };
    }
    if (/tangerang/i.test(clean)) {
      return { district: '', city: 'Kota Tangerang', province: 'Banten', country: 'Indonesia', address: '' };
    }
    if (/singapore|orchard/i.test(clean)) {
      return { district: '', city: 'Orchard', country: 'Singapore', postalCode: '238801', address: '' };
    }

    return {
      city: clean,
      address: '',
    };
  }

  // Primary Route Regex: "pickup in X to Y", "from X to Y", "dari X ke Y"
  const routeMatch = text.match(/(?:from|dari|pickup(?:\s+in|\s+at|\s+di)?)\s+([\s\S]+?)\s+(?:to|ke|antar\s+ke|tujuan\s+ke)\s+([\s\S]+?)(?:\s*,?\s*\b(?:on|at|pada|tanggal|jam|scheduled|pickup)\b|$)/i);

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

  // Specific city cleanups
  if (spec.pickup.city && spec.pickup.city.toLowerCase().includes('jakarta')) {
    spec.pickup.province = 'DKI Jakarta';
    if (!spec.pickup.city.toLowerCase().includes('selatan') && !spec.pickup.city.toLowerCase().includes('pusat')) {
      spec.pickup.city = 'Jakarta Selatan';
    }
  }
  if (spec.dropoff.city && spec.dropoff.city.toLowerCase().includes('surabaya')) {
    spec.dropoff.province = 'Jawa Timur';
    spec.dropoff.city = 'Kota Surabaya';
  }
  if (spec.pickup.city && spec.pickup.city.toLowerCase().includes('cirebon')) {
    spec.pickup.province = 'Jawa Barat';
    spec.pickup.city = 'Kota Cirebon';
    spec.pickup.district = spec.pickup.district || 'Kesambi';
  }
  if (spec.dropoff.city && spec.dropoff.city.toLowerCase().includes('tegal')) {
    spec.dropoff.province = 'Jawa Tengah';
    spec.dropoff.city = 'Kabupaten Tegal';
    spec.dropoff.district = spec.dropoff.district || 'Adiwerna';
  }
  if (spec.pickup.city && spec.pickup.city.toLowerCase().includes('tangerang')) {
    spec.pickup.country = 'Indonesia';
    spec.pickup.city = 'Kota Tangerang';
  }
  if (spec.dropoff.city && (spec.dropoff.city.toLowerCase().includes('singapore') || spec.dropoff.city.toLowerCase().includes('orchard'))) {
    spec.dropoff.country = 'Singapore';
    spec.dropoff.city = 'Orchard';
    spec.dropoff.postalCode = '238801';
  }

  // 8. Cargo details
  spec.cargo = {};
  const weightMatch = text.match(/(\d+)\s*(?:kg|kilogram)/i);
  if (weightMatch) spec.cargo.weightKg = parseInt(weightMatch[1], 10);

  const itemMatch = text.match(/(?:item|barang|commodity|komoditas)\s*[:=]?\s*([^,.\n]+)/i);
  if (itemMatch) spec.cargo.itemName = itemMatch[1].trim();

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
};
