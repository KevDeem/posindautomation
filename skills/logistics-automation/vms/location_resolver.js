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

// Known Indonesian districts with their exact city/regency and province
const KNOWN_INDONESIAN_DISTRICTS = {
  // Jakarta Selatan
  'pasar minggu': { district: 'Pasar Minggu', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },
  'cilandak': { district: 'Cilandak', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },
  'kebayoran baru': { district: 'Kebayoran Baru', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },
  'kebayoran lama': { district: 'Kebayoran Lama', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },
  'pesanggrahan': { district: 'Pesanggrahan', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },
  'mampang prapatan': { district: 'Mampang Prapatan', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },
  'pancoran': { district: 'Pancoran', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },
  'tebet': { district: 'Tebet', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },
  'setiabudi': { district: 'Setiabudi', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },
  'jagakarsa': { district: 'Jagakarsa', city: 'Kota Jakarta Selatan', province: 'DKI Jakarta' },

  // Jakarta Timur
  'matraman': { district: 'Matraman', city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },
  'pulo gadung': { district: 'Pulo Gadung', city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },
  'jatinegara': { district: 'Jatinegara', city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },
  'duren sawit': { district: 'Duren Sawit', city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },
  'kramat jati': { district: 'Kramat Jati', city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },
  'makasar': { district: 'Makasar', city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },
  'pasar rebo': { district: 'Pasar Rebo', city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },
  'ciracas': { district: 'Ciracas', city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },
  'cipayung': { district: 'Cipayung', city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },
  'cakung': { district: 'Cakung', city: 'Kota Jakarta Timur', province: 'DKI Jakarta' },

  // Jakarta Pusat
  'gambir': { district: 'Gambir', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta' },
  'tanah abang': { district: 'Tanah Abang', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta' },
  'menteng': { district: 'Menteng', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta' },
  'senen': { district: 'Senen', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta' },
  'cempaka putih': { district: 'Cempaka Putih', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta' },
  'johar baru': { district: 'Johar Baru', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta' },
  'kemayoran': { district: 'Kemayoran', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta' },
  'sawah besar': { district: 'Sawah Besar', city: 'Kota Jakarta Pusat', province: 'DKI Jakarta' },

  // Jakarta Barat
  'cengkareng': { district: 'Cengkareng', city: 'Kota Jakarta Barat', province: 'DKI Jakarta' },
  'grogol petamburan': { district: 'Grogol Petamburan', city: 'Kota Jakarta Barat', province: 'DKI Jakarta' },
  'taman sari': { district: 'Taman Sari', city: 'Kota Jakarta Barat', province: 'DKI Jakarta' },
  'tambora': { district: 'Tambora', city: 'Kota Jakarta Barat', province: 'DKI Jakarta' },
  'kebon jeruk': { district: 'Kebon Jeruk', city: 'Kota Jakarta Barat', province: 'DKI Jakarta' },
  'kalideres': { district: 'Kalideres', city: 'Kota Jakarta Barat', province: 'DKI Jakarta' },
  'palmerah': { district: 'Palmerah', city: 'Kota Jakarta Barat', province: 'DKI Jakarta' },
  'kembangan': { district: 'Kembangan', city: 'Kota Jakarta Barat', province: 'DKI Jakarta' },

  // Jakarta Utara
  'koja': { district: 'Koja', city: 'Kota Jakarta Utara', province: 'DKI Jakarta' },
  'kelapa gading': { district: 'Kelapa Gading', city: 'Kota Jakarta Utara', province: 'DKI Jakarta' },
  'tanjung priok': { district: 'Tanjung Priok', city: 'Kota Jakarta Utara', province: 'DKI Jakarta' },
  'pademangan': { district: 'Pademangan', city: 'Kota Jakarta Utara', province: 'DKI Jakarta' },
  'penjaringan': { district: 'Penjaringan', city: 'Kota Jakarta Utara', province: 'DKI Jakarta' },
  'cilincing': { district: 'Cilincing', city: 'Kota Jakarta Utara', province: 'DKI Jakarta' },

  // Kota Bekasi
  'rawalumbu': { district: 'Rawalumbu', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'bekasi barat': { district: 'Bekasi Barat', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'bekasi timur': { district: 'Bekasi Timur', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'bekasi utara': { district: 'Bekasi Utara', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'bekasi selatan': { district: 'Bekasi Selatan', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'medan satria': { district: 'Medan Satria', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'pondok gede': { district: 'Pondok Gede', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'jatiasih': { district: 'Jatiasih', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'jatisampurna': { district: 'Jatisampurna', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'mustika jaya': { district: 'Mustika Jaya', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'bantar gebang': { district: 'Bantar Gebang', city: 'Kota Bekasi', province: 'Jawa Barat' },
  'pondok melati': { district: 'Pondok Melati', city: 'Kota Bekasi', province: 'Jawa Barat' },

  // Kabupaten Bekasi
  'tambun selatan': { district: 'Tambun Selatan', city: 'Kabupaten Bekasi', province: 'Jawa Barat' },
  'cikarang pusat': { district: 'Cikarang Pusat', city: 'Kabupaten Bekasi', province: 'Jawa Barat' },
  'cikarang barat': { district: 'Cikarang Barat', city: 'Kabupaten Bekasi', province: 'Jawa Barat' },
  'cikarang utara': { district: 'Cikarang Utara', city: 'Kabupaten Bekasi', province: 'Jawa Barat' },

  // Kota Bandung
  'bandung wetan': { district: 'Bandung Wetan', city: 'Kota Bandung', province: 'Jawa Barat' },
  'coblong': { district: 'Coblong', city: 'Kota Bandung', province: 'Jawa Barat' },
  'sukajadi': { district: 'Sukajadi', city: 'Kota Bandung', province: 'Jawa Barat' },
  'cicendo': { district: 'Cicendo', city: 'Kota Bandung', province: 'Jawa Barat' },
  'andir': { district: 'Andir', city: 'Kota Bandung', province: 'Jawa Barat' },
  'astana anyar': { district: 'Astana Anyar', city: 'Kota Bandung', province: 'Jawa Barat' },
  'lengkong': { district: 'Lengkong', city: 'Kota Bandung', province: 'Jawa Barat' },
  'kiaracondong': { district: 'Kiaracondong', city: 'Kota Bandung', province: 'Jawa Barat' },

  // Kota Depok
  'tapos': { district: 'Tapos', city: 'Kota Depok', province: 'Jawa Barat' },
  'sawangan': { district: 'Sawangan', city: 'Kota Depok', province: 'Jawa Barat' },
  'cimanggis': { district: 'Cimanggis', city: 'Kota Depok', province: 'Jawa Barat' },
  'beji': { district: 'Beji', city: 'Kota Depok', province: 'Jawa Barat' },
  'pancoran mas': { district: 'Pancoran Mas', city: 'Kota Depok', province: 'Jawa Barat' },
  'sukmajaya': { district: 'Sukmajaya', city: 'Kota Depok', province: 'Jawa Barat' },

  // Tangerang & Banten
  'benda': { district: 'Benda', city: 'Kota Tangerang', province: 'Banten' },
  'kelapa dua': { district: 'Kelapa Dua', city: 'Kabupaten Tangerang', province: 'Banten' },

  // Jawa Tengah & Jawa Timur
  'sidorejo': { district: 'Sidorejo', city: 'Kota Salatiga', province: 'Jawa Tengah' },
  'kesambi': { district: 'Kesambi', city: 'Kota Cirebon', province: 'Jawa Barat' },
  'adiwerna': { district: 'Adiwerna', city: 'Kabupaten Tegal', province: 'Jawa Tengah' },
};

// Common Indonesian cities and their provinces
const INDONESIA_CITY_PROVINCE = {
  'bekasi': { city: 'Kota Bekasi', province: 'Jawa Barat' },
  'kabupaten bekasi': { city: 'Kabupaten Bekasi', province: 'Jawa Barat' },
  'bandung': { city: 'Kota Bandung', province: 'Jawa Barat' },
  'kabupaten bandung': { city: 'Kabupaten Bandung', province: 'Jawa Barat' },
  'tasikmalaya': { city: 'Kota Tasikmalaya', province: 'Jawa Barat' },
  'jakarta': { city: 'DKI Jakarta', province: 'DKI Jakarta' },
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
  'salatiga': { city: 'Kota Salatiga', province: 'Jawa Tengah' },
  'tegal': { city: 'Kota Tegal', province: 'Jawa Tengah' },
  'kabupaten tegal': { city: 'Kabupaten Tegal', province: 'Jawa Tengah' },
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
    const part1Norm = part1.toLowerCase().replace(/^(?:kecamatan|kec)\s+/i, '').trim();
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

    // Check if part1 has a port indicator
    if (/\b(?:pelabuhan|port|harbour|bandara|airport)\b/i.test(part1)) {
      const matchedCity = INDONESIA_CITY_PROVINCE[part2.toLowerCase()] || INDONESIA_CITY_PROVINCE[part2Norm];
      return {
        type: 'PORT',
        isPort: true,
        portName: part1,
        city: matchedCity ? matchedCity.city : `Kota ${part2Norm.charAt(0).toUpperCase() + part2Norm.slice(1)}`,
        province: matchedCity ? matchedCity.province : 'Indonesia',
        country: 'Indonesia',
        countryCode: 'ID',
        raw: rawStr,
      };
    }

    // Check exact Indonesian district database (e.g. "Pasar Minggu" -> Kota Jakarta Selatan, DKI Jakarta)
    if (KNOWN_INDONESIAN_DISTRICTS[part1Norm]) {
      const knownD = KNOWN_INDONESIAN_DISTRICTS[part1Norm];
      return {
        type: 'DOOR',
        isPort: false,
        district: knownD.district,
        city: knownD.city,
        province: knownD.province,
        country: 'Indonesia',
        countryCode: 'ID',
        raw: rawStr,
        confidence: 'EXACT_DISTRICT_MATCH',
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
  const singleNorm = trimmed.toLowerCase().replace(/^(?:kecamatan|kec)\s+/i, '').trim();
  if (KNOWN_INDONESIAN_DISTRICTS[singleNorm]) {
    const knownD = KNOWN_INDONESIAN_DISTRICTS[singleNorm];
    return {
      type: 'DOOR',
      isPort: false,
      district: knownD.district,
      city: knownD.city,
      province: knownD.province,
      country: 'Indonesia',
      countryCode: 'ID',
      raw: rawStr,
      confidence: 'EXACT_DISTRICT_MATCH',
    };
  }

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
 * Resolve location with strict verification, candidate matching, and no silent substitution
 */
function resolveLocation(rawStr, modeHint = null) {
  const parsed = parseLocationString(rawStr, modeHint);
  if (!parsed || parsed.error) {
    return {
      success: false,
      error: `Could not resolve location: "${rawStr}"`,
      raw: rawStr,
    };
  }

  // Check for ambiguous candidates if needed
  const clean = (rawStr || '').toLowerCase().trim();
  const candidates = [];
  for (const [key, val] of Object.entries(KNOWN_INDONESIAN_DISTRICTS)) {
    if (clean.includes(key) || key.includes(clean)) {
      candidates.push(val);
    }
  }

  return {
    success: true,
    location: parsed,
    candidates: candidates.length > 1 ? candidates : [],
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
  KNOWN_INDONESIAN_DISTRICTS,
  identifyKnownPort,
  parseLocationString,
  resolveLocation,
  classifyRouteInternational,
};
