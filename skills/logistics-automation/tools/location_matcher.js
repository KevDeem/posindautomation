/**
 * Location Matcher & Administrative Hierarchy Module
 * 
 * Enforces Kota vs Kabupaten administrative distinction and location hierarchy:
 *   Province -> Kota/Kabupaten -> Kecamatan -> Kelurahan
 * 
 * Rules:
 * 1. Preserves explicit administrative prefixes (Kota, Kabupaten / Kab).
 * 2. Matches exact administrative names against actual Ant Design dropdown options.
 * 3. Rejects incorrect administrative matches even when base city names are identical
 *    (e.g., requesting Kabupaten Tegal must reject Kota Tegal).
 * 4. Validates that requested Kecamatan belongs to the selected parent Kota/Kabupaten.
 * 5. Rejects incompatible child locations without silent fallback to another region.
 */

/**
 * Known administrative provinces for Indonesian cities
 */
const KNOWN_PROVINCES = {
  'tegal': 'Jawa Tengah',
  'surabaya': 'Jawa Timur',
  'cirebon': 'Jawa Barat',
  'bandung': 'Jawa Barat',
  'tangerang': 'Banten',
  'bekasi': 'Jawa Barat',
  'bogor': 'Jawa Barat',
  'semarang': 'Jawa Tengah',
  'jakarta selatan': 'DKI Jakarta',
  'jakarta pusat': 'DKI Jakarta',
  'jakarta barat': 'DKI Jakarta',
  'jakarta timur': 'DKI Jakarta',
  'jakarta utara': 'DKI Jakarta',
};

/**
 * Known kecamatan-to-city hierarchy mappings for validation & auto-resolution
 */
const KNOWN_DISTRICT_HIERARCHY = {
  'adiwerna': { city: 'Kabupaten Tegal', province: 'Jawa Tengah' },
  'slawi': { city: 'Kabupaten Tegal', province: 'Jawa Tengah' },
  'dukuhturi': { city: 'Kabupaten Tegal', province: 'Jawa Tengah' },
  'kramat': { city: 'Kabupaten Tegal', province: 'Jawa Tengah' },
  'talang': { city: 'Kabupaten Tegal', province: 'Jawa Tengah' },
  'tegal barat': { city: 'Kota Tegal', province: 'Jawa Tengah' },
  'tegal timur': { city: 'Kota Tegal', province: 'Jawa Tengah' },
  'tegal selatan': { city: 'Kota Tegal', province: 'Jawa Tengah' },
  'margadana': { city: 'Kota Tegal', province: 'Jawa Tengah' },
  'gubeng': { city: 'Kota Surabaya', province: 'Jawa Timur' },
  'tegalsari': { city: 'Kota Surabaya', province: 'Jawa Timur' },
  'wonokromo': { city: 'Kota Surabaya', province: 'Jawa Timur' },
  'rungkut': { city: 'Kota Surabaya', province: 'Jawa Timur' },
  'kesambi': { city: 'Kota Cirebon', province: 'Jawa Barat' },
  'kejaksan': { city: 'Kota Cirebon', province: 'Jawa Barat' },
  'harjamukti': { city: 'Kota Cirebon', province: 'Jawa Barat' },
  'lemahwungkuk': { city: 'Kota Cirebon', province: 'Jawa Barat' },
  'pekalipan': { city: 'Kota Cirebon', province: 'Jawa Barat' },
  'sumber': { city: 'Kabupaten Cirebon', province: 'Jawa Barat' },
  'tebet': { city: 'Jakarta Selatan', province: 'DKI Jakarta' },
  'kebayoran baru': { city: 'Jakarta Selatan', province: 'DKI Jakarta' },
  'benda': { city: 'Kota Tangerang', province: 'Banten' },
  'bandung wetan': { city: 'Kota Bandung', province: 'Jawa Barat' },
  'lengkong': { city: 'Kota Bandung', province: 'Jawa Barat' },
  'coblong': { city: 'Kota Bandung', province: 'Jawa Barat' },
  'sukajadi': { city: 'Kota Bandung', province: 'Jawa Barat' },
  'soreang': { city: 'Kabupaten Bandung', province: 'Jawa Barat' },
  'baleendah': { city: 'Kabupaten Bandung', province: 'Jawa Barat' },
  'banjaran': { city: 'Kabupaten Bandung', province: 'Jawa Barat' },
  'cileunyi': { city: 'Kabupaten Bandung', province: 'Jawa Barat' },
  'dayeuhkolot': { city: 'Kabupaten Bandung', province: 'Jawa Barat' },
  'cipondoh': { city: 'Kota Tangerang', province: 'Banten' },
  'ciledug': { city: 'Kota Tangerang', province: 'Banten' },
  'karawaci': { city: 'Kota Tangerang', province: 'Banten' },
  'balaraja': { city: 'Kabupaten Tangerang', province: 'Banten' },
  'cikupa': { city: 'Kabupaten Tangerang', province: 'Banten' },
  'tigaraksa': { city: 'Kabupaten Tangerang', province: 'Banten' },
  'curug': { city: 'Kabupaten Tangerang', province: 'Banten' },
  'bekasi barat': { city: 'Kota Bekasi', province: 'Jawa Barat' },
  'bekasi timur': { city: 'Kota Bekasi', province: 'Jawa Barat' },
  'cikarang pusat': { city: 'Kabupaten Bekasi', province: 'Jawa Barat' },
};

/**
 * Extract administrative prefix ("Kota" or "Kabupaten") and base city name.
 * 
 * @param {string} str Raw location string
 * @returns {{ prefix: 'Kota'|'Kabupaten'|null, baseName: string, fullName: string }}
 */
function extractAdminPrefix(str) {
  if (!str) return { prefix: null, baseName: '', fullName: '' };
  const trimmed = String(str).trim();

  // Strip leading Jakarta abbreviations if needed
  const kabMatch = trimmed.match(/^(?:Kabupaten|Kab\.?)\s+(.+)$/i);
  if (kabMatch) {
    const base = kabMatch[1].trim();
    return {
      prefix: 'Kabupaten',
      baseName: base,
      fullName: `Kabupaten ${base}`,
    };
  }

  const kotaMatch = trimmed.match(/^(?:Kota)\s+(.+)$/i);
  if (kotaMatch) {
    const base = kotaMatch[1].trim();
    return {
      prefix: 'Kota',
      baseName: base,
      fullName: `Kota ${base}`,
    };
  }

  return {
    prefix: null,
    baseName: trimmed,
    fullName: trimmed,
  };
}

/**
 * Normalize administrative city name to proper casing
 */
function normalizeAdminCityName(raw) {
  if (!raw) return '';
  const parsed = extractAdminPrefix(raw);
  const words = parsed.baseName.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  const capBase = words.join(' ');
  if (parsed.prefix) {
    return `${parsed.prefix} ${capBase}`;
  }
  return capBase;
}

/**
 * Match a requested location against actual Ant Design dropdown options.
 * 
 * Strict Matching Rules:
 * 1. Exact case-insensitive match on full administrative name.
 * 2. If requestedLocation specifies an administrative prefix (Kota or Kabupaten):
 *    - MUST match an option with the same prefix.
 *    - MUST REJECT options with a conflicting prefix (e.g., requesting Kabupaten Tegal
 *      rejects Kota Tegal even though "Tegal" matches).
 * 3. If requestedLocation does not specify a prefix:
 *    - Matches an option whose base name matches.
 *    - If multiple options match (e.g., Kota Tegal & Kabupaten Tegal exist),
 *      rejects ambiguity and requires user to specify prefix.
 * 
 * @param {string[]} availableOptions Array of options from Ant Design dropdown
 * @param {string} requestedLocation Location name requested by user
 * @returns {{ matchedOption: string|null, error: string|null }}
 */
function matchLocationOption(availableOptions, requestedLocation) {
  if (!availableOptions || availableOptions.length === 0) {
    return { matchedOption: null, error: `Dropdown options list is empty for "${requestedLocation}".` };
  }
  if (!requestedLocation || String(requestedLocation).trim() === '') {
    return { matchedOption: null, error: 'Requested location is empty.' };
  }

  const req = extractAdminPrefix(requestedLocation);
  const reqFullLower = req.fullName.toLowerCase();
  const reqBaseLower = req.baseName.toLowerCase();

  // 1. Exact match on full string (case-insensitive)
  for (const opt of availableOptions) {
    const optTrim = opt.trim();
    if (optTrim.toLowerCase() === reqFullLower) {
      return { matchedOption: optTrim, error: null };
    }
  }

  // 2. Explicit administrative prefix requested (Kota or Kabupaten)
  if (req.prefix) {
    const matchingPrefixOptions = [];
    const conflictingPrefixOptions = [];

    for (const opt of availableOptions) {
      const optTrim = opt.trim();
      const optParsed = extractAdminPrefix(optTrim);

      // Compare base names (e.g. "tegal" === "tegal")
      if (optParsed.baseName.toLowerCase() === reqBaseLower) {
        if (optParsed.prefix && optParsed.prefix.toLowerCase() === req.prefix.toLowerCase()) {
          matchingPrefixOptions.push(optTrim);
        } else if (optParsed.prefix) {
          conflictingPrefixOptions.push(optTrim);
        }
      }
    }

    if (matchingPrefixOptions.length > 0) {
      return { matchedOption: matchingPrefixOptions[0], error: null };
    }

    // Explicit rejection: opposite administrative prefix exists
    if (conflictingPrefixOptions.length > 0) {
      return {
        matchedOption: null,
        error: `Administrative prefix mismatch: Requested "${req.fullName}", but found conflicting administrative option(s) [${conflictingPrefixOptions.join(', ')}]. Incorrect administrative matches are strictly rejected.`,
      };
    }

    return {
      matchedOption: null,
      error: `No option matching requested "${req.fullName}" found in dropdown. Available options: [${availableOptions.slice(0, 10).join(', ')}].`,
    };
  }

  // 3. No administrative prefix specified in requested location (e.g. "Tegal" or "Surabaya")
  const baseMatches = [];
  for (const opt of availableOptions) {
    const optTrim = opt.trim();
    const optParsed = extractAdminPrefix(optTrim);
    if (optParsed.baseName.toLowerCase() === reqBaseLower || optTrim.toLowerCase() === reqBaseLower) {
      baseMatches.push(optTrim);
    }
  }

  if (baseMatches.length === 1) {
    return { matchedOption: baseMatches[0], error: null };
  }

  if (baseMatches.length > 1) {
    return {
      matchedOption: null,
      error: `Ambiguous city name "${requestedLocation}". Multiple administrative regions exist: [${baseMatches.join(', ')}]. Please specify "Kota" or "Kabupaten".`,
    };
  }

  // 4. Substring fallback if single unique option matches
  const subMatches = availableOptions.filter(opt => opt.toLowerCase().includes(reqBaseLower));
  if (subMatches.length === 1) {
    return { matchedOption: subMatches[0].trim(), error: null };
  }

  return {
    matchedOption: null,
    error: `No option matching "${requestedLocation}" found in dropdown. Available options: [${availableOptions.slice(0, 10).join(', ')}].`,
  };
}

/**
 * Validate that a requested Kecamatan belongs to the selected parent Kota/Kabupaten.
 * 
 * Rules:
 * 1. Checks dropdown options under the selected parent city.
 * 2. If kecamatan is unavailable under selected city:
 *    - Reports the administrative mismatch clearly.
 *    - Does NOT silently select another region.
 *    - Rejects continuing with the wrong parent region.
 * 
 * @param {string[]} availableDistricts Dropdown options under currently selected city
 * @param {string} requestedDistrict Requested kecamatan name
 * @param {string} parentCityName Currently selected Kota/Kabupaten name
 * @returns {{ matchedDistrict: string|null, error: string|null }}
 */
function validateAndMatchDistrict(availableDistricts, requestedDistrict, parentCityName) {
  if (!availableDistricts || availableDistricts.length === 0) {
    return {
      matchedDistrict: null,
      error: `No districts found in dropdown under "${parentCityName}".`,
    };
  }
  if (!requestedDistrict || String(requestedDistrict).trim() === '') {
    return { matchedDistrict: null, error: 'Requested district is empty.' };
  }

  const reqLower = String(requestedDistrict).trim().toLowerCase();

  // 1. Exact match (case-insensitive)
  for (const dist of availableDistricts) {
    if (dist.trim().toLowerCase() === reqLower) {
      return { matchedDistrict: dist.trim(), error: null };
    }
  }

  // 2. Substring match
  const subMatches = availableDistricts.filter(d => d.trim().toLowerCase().includes(reqLower));
  if (subMatches.length === 1) {
    return { matchedDistrict: subMatches[0].trim(), error: null };
  }

  // 3. Known administrative hierarchy cross-check for descriptive error message
  const known = KNOWN_DISTRICT_HIERARCHY[reqLower];
  if (known && parentCityName && known.city.toLowerCase() !== parentCityName.toLowerCase()) {
    return {
      matchedDistrict: null,
      error: `Administrative mismatch: Kecamatan "${requestedDistrict}" belongs to ${known.city}, not ${parentCityName}. Child location does not belong to selected parent.`,
    };
  }

  return {
    matchedDistrict: null,
    error: `Administrative mismatch: Kecamatan "${requestedDistrict}" is not available under ${parentCityName}. Available under ${parentCityName}: [${availableDistricts.slice(0, 10).join(', ')}].`,
  };
}

/**
 * Pre-validate location hierarchy before submitting to OMS
 * 
 * @param {Object} locationSpec { province, city, district }
 * @param {string} locationRole 'pickup' or 'dropoff'
 * @returns {{ valid: boolean, error: string|null }}
 */
function validateLocationHierarchy(locationSpec = {}, locationRole = 'location') {
  const city = locationSpec.city ? String(locationSpec.city).trim() : '';
  const district = locationSpec.district ? String(locationSpec.district).trim().toLowerCase() : '';

  if (district && city) {
    const known = KNOWN_DISTRICT_HIERARCHY[district];
    if (known) {
      const cityParsed = extractAdminPrefix(city);
      const knownParsed = extractAdminPrefix(known.city);

      // Check for administrative mismatch
      if (cityParsed.prefix && knownParsed.prefix && cityParsed.prefix.toLowerCase() !== knownParsed.prefix.toLowerCase()) {
        if (cityParsed.baseName.toLowerCase() === knownParsed.baseName.toLowerCase()) {
          return {
            valid: false,
            error: `Administrative mismatch for ${locationRole}: Kecamatan "${locationSpec.district}" belongs to ${known.city}, but ${city} was specified. Child location does not belong to selected parent.`,
          };
        }
      }
    }
  }

  return { valid: true, error: null };
}

/**
 * Detect location type (Door vs Port) from location string
 * 
 * Rules:
 * - If string explicitly mentions 'door', returns 'Door'.
 * - If string explicitly mentions 'port', 'pelabuhan', 'airport', 'bandara', or known ports/airports, returns 'Port'.
 * - Default: 'Door'.
 * 
 * @param {string} text Raw location string
 * @returns {'Door'|'Port'}
 */
function detectLocationType(text) {
  if (!text) return 'Door';
  const str = String(text).toLowerCase();
  // Prioritize explicit 'door'
  if (/\bdoor\b/i.test(str)) {
    return 'Door';
  }
  // Check port / airport indicators
  if (/\b(?:port|pelabuhan|airport|bandara|bandar\s+udara|tanjung\s+priok|soekarno-?hatta|tokyo\s+airport|singapore\s+port|haneda|narita|changi|juanda)\b/i.test(str)) {
    return 'Port';
  }
  return 'Door';
}

const INCOTERM_MAP = {
  'ddp': 'Delivered Duty Paid',
  'delivered duty paid': 'Delivered Duty Paid',
  'delivered duty paid (ddp)': 'Delivered Duty Paid',
  'dap': 'Delivered at Place',
  'delivered at place': 'Delivered at Place',
  'dpu': 'Delivered at Place Unloaded',
  'delivered at place unloaded': 'Delivered at Place Unloaded',
  'fas': 'Free Alongside Ship',
  'free alongside ship': 'Free Alongside Ship',
  'cip': 'Carriage and Insurance Paid To',
  'carriage and insurance paid to': 'Carriage and Insurance Paid To',
  'cpt': 'Carriage Paid To',
  'carriage paid to': 'Carriage Paid To',
  'cif': 'Cost, Insurance and Freight',
  'cost, insurance and freight': 'Cost, Insurance and Freight',
  'cfr': 'Cost and Freight',
  'cost and freight': 'Cost and Freight',
  'fob': 'Free On Board',
  'free on board': 'Free On Board',
  'fca': 'Free Carrier',
  'free carrier': 'Free Carrier',
};

/**
 * Normalize incoterm strings to actual Ant Design dropdown option text
 * 
 * @param {string} raw Raw incoterm
 * @returns {string}
 */
function normalizeIncoterm(raw) {
  if (!raw) return 'Delivered Duty Paid';
  const clean = String(raw).trim().toLowerCase();
  if (INCOTERM_MAP[clean]) return INCOTERM_MAP[clean];
  for (const [k, v] of Object.entries(INCOTERM_MAP)) {
    if (clean.includes(k)) return v;
  }
  return String(raw).trim();
}

module.exports = {
  extractAdminPrefix,
  normalizeAdminCityName,
  matchLocationOption,
  validateAndMatchDistrict,
  validateLocationHierarchy,
  detectLocationType,
  normalizeIncoterm,
  INCOTERM_MAP,
  KNOWN_PROVINCES,
  KNOWN_DISTRICT_HIERARCHY,
};
