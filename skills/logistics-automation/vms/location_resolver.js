/**
 * VMS Location Resolver
 * Handles location parsing, normalization, and master-data hierarchy resolution
 * for DOOR locations (District, City/Regency, Province, Country),
 * Indonesian PORT locations (Airports & Seaports), and International PORT locations.
 */

// Well-known verified Indonesian and International Ports mapping
const KNOWN_PORTS = {
  // Indonesian Seaports
  'tanjung priok': {
    type: 'PORT',
    mode: 'LAUT',
    portName: 'Pelabuhan Tanjung Priok',
    country: 'Indonesia',
    countryCode: 'ID',
    province: 'DKI Jakarta',
    city: 'Kota Jakarta Utara',
    unlocode: 'IDTPR',
  },
  'tanjung perak': {
    type: 'PORT',
    mode: 'LAUT',
    portName: 'Pelabuhan Tanjung Perak',
    country: 'Indonesia',
    countryCode: 'ID',
    province: 'Jawa Timur',
    city: 'Kota Surabaya',
    unlocode: 'IDTPE',
  },
  'belawan': {
    type: 'PORT',
    mode: 'LAUT',
    portName: 'Pelabuhan Belawan',
    country: 'Indonesia',
    countryCode: 'ID',
    province: 'Sumatera Utara',
    city: 'Kota Medan',
    unlocode: 'IDBLW',
  },

  // Indonesian Airports
  'soekarno-hatta': {
    type: 'PORT',
    mode: 'UDARA',
    portName: 'Soekarno-Hatta International Airport',
    country: 'Indonesia',
    countryCode: 'ID',
    province: 'Banten',
    city: 'Kota Tangerang',
    unlocode: 'CGK',
  },
  'juanda': {
    type: 'PORT',
    mode: 'UDARA',
    portName: 'Bandara Internasional Juanda',
    country: 'Indonesia',
    countryCode: 'ID',
    province: 'Jawa Timur',
    city: 'Kabupaten Sidoarjo',
    unlocode: 'SUB',
  },
  'kualanamu': {
    type: 'PORT',
    mode: 'UDARA',
    portName: 'Bandara Internasional Kualanamu',
    country: 'Indonesia',
    countryCode: 'ID',
    province: 'Sumatera Utara',
    city: 'Kabupaten Deli Serdang',
    unlocode: 'KNO',
  },

  // International Seaports
  'pasir panjang': {
    type: 'PORT',
    mode: 'LAUT',
    portName: 'Pasir Panjang Terminal',
    country: 'Singapore',
    countryCode: 'SG',
    province: 'Singapore',
    city: 'Singapore',
    unlocode: 'SGSIN-PP',
  },
  'jurong port': {
    type: 'PORT',
    mode: 'LAUT',
    portName: 'Jurong Port',
    country: 'Singapore',
    countryCode: 'SG',
    province: 'Singapore',
    city: 'Singapore',
    unlocode: 'SGJUR',
  },
  'port klang': {
    type: 'PORT',
    mode: 'LAUT',
    portName: 'Port Klang',
    country: 'Malaysia',
    countryCode: 'MY',
    province: 'Selangor',
    city: 'Klang',
    unlocode: 'MYPKG',
  },
  'tokyo port': {
    type: 'PORT',
    mode: 'LAUT',
    portName: 'Port of Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    province: 'Tokyo',
    city: 'Tokyo',
    unlocode: 'JPTYO',
  },

  // International Airports
  'changi': {
    type: 'PORT',
    mode: 'UDARA',
    portName: 'Changi Airport',
    country: 'Singapore',
    countryCode: 'SG',
    province: 'Singapore',
    city: 'Singapore',
    unlocode: 'SIN',
  },
  'kuala lumpur international airport': {
    type: 'PORT',
    mode: 'UDARA',
    portName: 'Kuala Lumpur International Airport',
    country: 'Malaysia',
    countryCode: 'MY',
    province: 'Selangor',
    city: 'Sepang',
    unlocode: 'KUL',
  },
  'haneda': {
    type: 'PORT',
    mode: 'UDARA',
    portName: 'Tokyo Haneda Airport',
    country: 'Japan',
    countryCode: 'JP',
    province: 'Tokyo',
    city: 'Tokyo',
    unlocode: 'HND',
  },
  'narita': {
    type: 'PORT',
    mode: 'UDARA',
    portName: 'Narita International Airport',
    country: 'Japan',
    countryCode: 'JP',
    province: 'Chiba',
    city: 'Narita',
    unlocode: 'NRT',
  },
};

// Common Indonesian cities and their provinces
const INDONESIA_CITY_PROVINCE = {
  'bekasi': { city: 'Kota Bekasi', province: 'Jawa Barat' },
  'kabupaten bekasi': { city: 'Kabupaten Bekasi', province: 'Jawa Barat' },
  'bandung': { city: 'Kota Bandung', province: 'Jawa Barat' },
  'kabupaten bandung': { city: 'Kabupaten Bandung', province: 'Jawa Barat' },
  'tasikmalaya': { city: 'Kota Tasikmalaya', province: 'Jawa Barat' },
  'jakarta': { city: 'Kota Jakarta Pusat', province: 'DKI Jakarta' },
  'jakarta pusat': { city: 'Kota Jakarta Pusat', province: 'DKI Jakarta' },
  'jakarta selatan': { city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },
  'jakarta barat': { city: 'Kota Jakarta Barat', province: 'DKI Jakarta' },
  'jakarta timur': { city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },
  'jakarta utara': { city: 'Kota Jakarta Utara', province: 'DKI Jakarta' },
  'tangerang': { city: 'Kota Tangerang', province: 'Banten' },
  'kabupaten tangerang': { city: 'Kabupaten Tangerang', province: 'Banten' },
  'tangerang selatan': { city: 'Kota Tangerang Selatan', province: 'Banten' },
  'surabaya': { city: 'Kota Surabaya', province: 'Jawa Timur' },
  'sidoarjo': { city: 'Kabupaten Sidoarjo', province: 'Jawa Timur' },
  'semarang': { city: 'Kota Semarang', province: 'Jawa Tengah' },
  'medan': { city: 'Kota Medan', province: 'Sumatera Utara' },
  'cirebon': { city: 'Kota Cirebon', province: 'Jawa Barat' },
  'kabupaten cirebon': { city: 'Kabupaten Cirebon', province: 'Jawa Barat' },
};

/**
 * Identify if an endpoint string is a known port
 */
function identifyKnownPort(str) {
  if (!str) return null;
  const clean = str.toLowerCase().trim();

  for (const [key, port] of Object.entries(KNOWN_PORTS)) {
    if (clean.includes(key)) {
      return { ...port };
    }
  }

  // Check generic port terms
  if (/\b(?:pelabuhan|port|harbour|terminal|bandara|airport)\b/i.test(clean)) {
    return {
      type: 'PORT',
      rawText: str,
      isUnresolvedPort: true,
    };
  }

  return null;
}

/**
 * Parse a raw location string like "Rawalumbu, Bekasi" or "Tanjung Priok, Jakarta"
 * or "Pasir Panjang, Singapore"
 */
function parseLocationString(rawStr, modeHint = null) {
  if (!rawStr || typeof rawStr !== 'string') {
    return { error: 'Location string is required' };
  }

  const trimmed = rawStr.trim();
  const parts = trimmed.split(',').map(s => s.trim()).filter(Boolean);

  // 1. Check known ports first
  const knownPort = identifyKnownPort(trimmed);
  if (knownPort && !knownPort.isUnresolvedPort) {
    return {
      type: 'PORT',
      isPort: true,
      portName: knownPort.portName,
      country: knownPort.country,
      countryCode: knownPort.countryCode,
      province: knownPort.province,
      city: knownPort.city,
      unlocode: knownPort.unlocode,
      mode: knownPort.mode || modeHint,
      raw: rawStr,
    };
  }

  // If 2 parts: "District, City" or "Port, City/Country"
  if (parts.length >= 2) {
    const part1 = parts[0];
    const part2 = parts[1];
    const part2Norm = part2.toLowerCase().replace(/^(?:kota|kabupaten|kab)\s+/i, '').trim();

    // Check if part2 is a foreign country
    const isForeignCountry = /^(?:singapore|malaysia|japan|thailand|vietnam|china|australia)$/i.test(part2Norm);
    if (isForeignCountry) {
      return {
        type: 'PORT',
        isPort: true,
        portName: part1,
        country: part2.charAt(0).toUpperCase() + part2.slice(1).toLowerCase(),
        countryCode: part2Norm === 'singapore' ? 'SG' : (part2Norm === 'malaysia' ? 'MY' : (part2Norm === 'japan' ? 'JP' : 'INTL')),
        province: part2,
        city: part2,
        raw: rawStr,
      };
    }

    // Check if part2 is an Indonesian city
    const hasKabupaten = /\b(?:kabupaten|kab)\b/i.test(part2);
    const hasKota = /\bkota\b/i.test(part2);

    let matchedCity = INDONESIA_CITY_PROVINCE[part2.toLowerCase()] || (hasKabupaten ? INDONESIA_CITY_PROVINCE[`kabupaten ${part2Norm}`] : INDONESIA_CITY_PROVINCE[part2Norm]);
    
    let resolvedCity;
    if (hasKabupaten) {
      resolvedCity = `Kabupaten ${part2Norm.charAt(0).toUpperCase() + part2Norm.slice(1)}`;
    } else if (hasKota) {
      resolvedCity = `Kota ${part2Norm.charAt(0).toUpperCase() + part2Norm.slice(1)}`;
    } else if (matchedCity) {
      resolvedCity = matchedCity.city;
    } else {
      resolvedCity = `Kota ${part2Norm.charAt(0).toUpperCase() + part2Norm.slice(1)}`;
    }

    const resolvedProvince = matchedCity ? matchedCity.province : 'Indonesia';

    // Check if part1 has a port indicator
    if (/\b(?:pelabuhan|port|harbour|bandara|airport)\b/i.test(part1)) {
      return {
        type: 'PORT',
        isPort: true,
        portName: part1,
        city: resolvedCity,
        province: resolvedProvince,
        country: 'Indonesia',
        countryCode: 'ID',
        raw: rawStr,
      };
    }

    // Default to DOOR (District, City)
    return {
      type: 'DOOR',
      isPort: false,
      district: part1,
      city: resolvedCity,
      province: resolvedProvince,
      country: 'Indonesia',
      countryCode: 'ID',
      raw: rawStr,
    };
  }

  // Single token location
  const singleNorm = trimmed.toLowerCase();
  const matchedCity = INDONESIA_CITY_PROVINCE[singleNorm];
  if (matchedCity) {
    return {
      type: 'DOOR',
      isPort: false,
      district: '',
      city: matchedCity.city,
      province: matchedCity.province,
      country: 'Indonesia',
      countryCode: 'ID',
      raw: rawStr,
    };
  }

  return {
    type: 'DOOR',
    isPort: false,
    district: trimmed,
    city: trimmed,
    country: 'Indonesia',
    countryCode: 'ID',
    raw: rawStr,
  };
}

/**
 * Determine if route is International
 */
function classifyRouteInternational(origin, destination, mode) {
  const originIsForeign = origin?.countryCode && origin.countryCode !== 'ID';
  const destIsForeign = destination?.countryCode && destination.countryCode !== 'ID';

  if (mode === 'DARAT') {
    // Land is international exclusively when outside Indonesia (e.g. SG -> SG, MY -> MY)
    return originIsForeign && destIsForeign;
  }

  // Sea / Air: international if either endpoint is foreign
  return originIsForeign || destIsForeign;
}

module.exports = {
  KNOWN_PORTS,
  INDONESIA_CITY_PROVINCE,
  identifyKnownPort,
  parseLocationString,
  classifyRouteInternational,
};
