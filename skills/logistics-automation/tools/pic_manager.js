/**
 * PIC (Person In Charge) Generator, Library & Selection Manager
 * for POSIND Logistics Automation
 * 
 * Features:
 * 1. Curated, multi-country PIC library with consistent personal & corporate profiles.
 * 2. Randomized PIC selection from existing library for pickup & drop-off.
 * 3. Guarantees distinct pickup and drop-off PICs and consecutive order variety.
 * 4. Location-aware international PIC generation & selection (Indonesia, Singapore, Malaysia, etc.).
 * 5. Automatic synthetic generation fallback when the library is empty or missing country entries.
 * 6. Dynamic library persistence (.sessions/pic_library.json).
 * 7. Reserved example domains (@example.com) for safety.
 */

const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.sessions');
const PIC_LIBRARY_FILE = path.join(SESSIONS_DIR, 'pic_library.json');

// --- Raw Synthetic Building Blocks ---

// Indonesian Data
const ID_FIRST_NAMES = [
  'Ahmad', 'Budi', 'Chandra', 'Dewi', 'Eko', 'Fitri', 'Gita', 'Hendra',
  'Indra', 'Joko', 'Kartika', 'Lestari', 'Mega', 'Nisa', 'Oki', 'Putri',
  'Rian', 'Sari', 'Tri', 'Utami', 'Wahyu', 'Yudi', 'Zahra', 'Aldin', 'Fajar'
];

const ID_LAST_NAMES = [
  'Pratama', 'Saputra', 'Wijaya', 'Kusuma', 'Santoso', 'Hidayat', 'Wibowo',
  'Setiawan', 'Nugroho', 'Siregar', 'Lestari', 'Purnomo', 'Gunawan', 'Hakim',
  'Suryadi', 'Maulana', 'Firmansyah', 'Wardhana', 'Suharto', 'Aditya'
];

const ID_COMPANY_PREFIXES = ['PT', 'CV', 'UD'];
const ID_COMPANY_NAMES = [
  'Mega Jaya Logistik', 'Nusantara Mandiri', 'Sumber Berkat Abadi',
  'Surya Kencana', 'Bintang Timur Sejahtera', 'Harapan Bangsa Express',
  'Sinar Makmur', 'Sentosa Cargo', 'Mitra Usaha Prima', 'Raceway Shop'
];

const ID_STREET_PREFIXES = ['Jl. Raya', 'Jl.', 'Komplek Pergudangan', 'Ruko Sentra', 'Kawasan Industri'];

// Singaporean Data
const SG_FIRST_NAMES = ['Wei Ming', 'Siew Ling', 'Kian Seng', 'Jia Hui', 'Chee Keong', 'Mei Ling', 'Jun Wei', 'Hui Ling', 'Boon Kiat', 'Li Ping'];
const SG_LAST_NAMES = ['Tan', 'Lim', 'Lee', 'Ng', 'Ong', 'Wong', 'Goh', 'Chua', 'Chan', 'Koh', 'Teo', 'Tay'];
const SG_COMPANY_NAMES = [
  'Lion City Freight Pte Ltd', 'Marina Bay Logistics Pte Ltd', 'Singa Cargo Express Pte Ltd',
  'Orchard Supply Chain Pte Ltd', 'Island Global Trade Pte Ltd', 'Merlion Express Cargo Pte Ltd'
];
const SG_STREETS = ['Orchard Road', 'Marina Boulevard', 'Changi South Lane', 'Jurong Port Road', 'Tuas South Ave', 'Raffles Place'];

// Malaysian Data
const MY_FIRST_NAMES = ['Muhammad Haziq', 'Nurul Aisyah', 'Chong Wei', 'Mei Ling', 'Kumar', 'Siti Khadijah', 'Farid', 'Anis', 'Zul', 'Pravin'];
const MY_LAST_NAMES = ['Abdullah', 'Subramaniam', 'Tan', 'Lee', 'Othman', 'Rahman', 'Ibrahim', 'Kassim'];
const MY_COMPANY_NAMES = [
  'Klang Valley Logistics Sdn Bhd', 'Malaya Freight Forwarding Sdn Bhd', 'Penang Harapan Express Sdn Bhd',
  'Bumi Raya Trans Sdn Bhd', 'Borneo Cargo Services Sdn Bhd', 'Selangor Fast Trans Sdn Bhd'
];
const MY_STREETS = ['Jalan Bukit Bintang', 'Persiaran Kewajipan', 'Jalan Tebrau', 'Jalan Ampang', 'Lebuh Raya Bayan Lepas'];

/**
 * Pre-seeded default PIC library containing complete, consistent records across countries.
 */
const DEFAULT_PIC_LIBRARY = [
  // --- Indonesia ---
  {
    name: 'Budi Santoso',
    company: 'PT Nusantara Mandiri',
    phone: '081234567890',
    email: 'budi.santoso@example.com',
    address: 'Jl. Raya Industri No. 12',
    country: 'Indonesia',
    countryCode: 'ID',
    phoneCountryCode: '+62',
    locale: 'id-ID',
    companyCountry: 'Indonesia',
    nameGenerationLocale: 'id-ID',
  },
  {
    name: 'Siti Rahmawati',
    company: 'CV Mitra Usaha Prima',
    phone: '082198765432',
    email: 'siti.rahmawati@example.com',
    address: 'Jl. Gubeng No. 45',
    country: 'Indonesia',
    countryCode: 'ID',
    phoneCountryCode: '+62',
    locale: 'id-ID',
    companyCountry: 'Indonesia',
    nameGenerationLocale: 'id-ID',
  },
  {
    name: 'Ahmad Pratama',
    company: 'PT Mega Jaya Logistik',
    phone: '085211223344',
    email: 'ahmad.pratama@example.com',
    address: 'Jl. Raya Tebet No. 8',
    country: 'Indonesia',
    countryCode: 'ID',
    phoneCountryCode: '+62',
    locale: 'id-ID',
    companyCountry: 'Indonesia',
    nameGenerationLocale: 'id-ID',
  },
  {
    name: 'Dewi Lestari',
    company: 'PT Surya Kencana',
    phone: '081388776655',
    email: 'dewi.lestari@example.com',
    address: 'Ruko Sentra Adiwerna No. 16',
    country: 'Indonesia',
    countryCode: 'ID',
    phoneCountryCode: '+62',
    locale: 'id-ID',
    companyCountry: 'Indonesia',
    nameGenerationLocale: 'id-ID',
  },
  {
    name: 'Hendra Wijaya',
    company: 'PT Sentosa Cargo',
    phone: '087799881122',
    email: 'hendra.wijaya@example.com',
    address: 'Jl. Kesambi No. 20',
    country: 'Indonesia',
    countryCode: 'ID',
    phoneCountryCode: '+62',
    locale: 'id-ID',
    companyCountry: 'Indonesia',
    nameGenerationLocale: 'id-ID',
  },
  {
    name: 'Fitri Kusuma',
    company: 'CV Bintang Timur Sejahtera',
    phone: '081933445566',
    email: 'fitri.kusuma@example.com',
    address: 'Kawasan Industri Cikarang No. 3',
    country: 'Indonesia',
    countryCode: 'ID',
    phoneCountryCode: '+62',
    locale: 'id-ID',
    companyCountry: 'Indonesia',
    nameGenerationLocale: 'id-ID',
  },
  {
    name: 'Rian Setiawan',
    company: 'PT Harapan Bangsa Express',
    phone: '081122334455',
    email: 'rian.setiawan@example.com',
    address: 'Komplek Pergudangan Soekarno Hatta No. 5',
    country: 'Indonesia',
    countryCode: 'ID',
    phoneCountryCode: '+62',
    locale: 'id-ID',
    companyCountry: 'Indonesia',
    nameGenerationLocale: 'id-ID',
  },
  {
    name: 'Gita Hidayat',
    company: 'UD Sinar Makmur',
    phone: '085677889900',
    email: 'gita.hidayat@example.com',
    address: 'Jl. Daan Mogot No. 88',
    country: 'Indonesia',
    countryCode: 'ID',
    phoneCountryCode: '+62',
    locale: 'id-ID',
    companyCountry: 'Indonesia',
    nameGenerationLocale: 'id-ID',
  },
  {
    name: 'Eko Purnomo',
    company: 'PT Sumber Berkat Abadi',
    phone: '081299001122',
    email: 'eko.purnomo@example.com',
    address: 'Jl. Pemuda No. 10',
    country: 'Indonesia',
    countryCode: 'ID',
    phoneCountryCode: '+62',
    locale: 'id-ID',
    companyCountry: 'Indonesia',
    nameGenerationLocale: 'id-ID',
  },
  {
    name: 'Zahra Siregar',
    company: 'CV Raceway Shop',
    phone: '081855667788',
    email: 'zahra.siregar@example.com',
    address: 'Jl. Asia Afrika No. 15',
    country: 'Indonesia',
    countryCode: 'ID',
    phoneCountryCode: '+62',
    locale: 'id-ID',
    companyCountry: 'Indonesia',
    nameGenerationLocale: 'id-ID',
  },

  // --- Singapore ---
  {
    name: 'Tan Wei Ming',
    company: 'Lion City Freight Pte Ltd',
    phone: '+65 8123 4567',
    email: 'wei.ming.tan@example.com',
    address: '10 Orchard Road #05-12',
    country: 'Singapore',
    countryCode: 'SG',
    phoneCountryCode: '+65',
    locale: 'en-SG',
    companyCountry: 'Singapore',
    nameGenerationLocale: 'en-SG',
  },
  {
    name: 'Lim Siew Ling',
    company: 'Marina Bay Logistics Pte Ltd',
    phone: '+65 9234 5678',
    email: 'siew.ling.lim@example.com',
    address: '12 Marina Boulevard #18-01',
    country: 'Singapore',
    countryCode: 'SG',
    phoneCountryCode: '+65',
    locale: 'en-SG',
    companyCountry: 'Singapore',
    nameGenerationLocale: 'en-SG',
  },
  {
    name: 'Lee Kian Seng',
    company: 'Singa Cargo Express Pte Ltd',
    phone: '+65 8345 6789',
    email: 'kian.seng.lee@example.com',
    address: '5 Changi South Lane',
    country: 'Singapore',
    countryCode: 'SG',
    phoneCountryCode: '+65',
    locale: 'en-SG',
    companyCountry: 'Singapore',
    nameGenerationLocale: 'en-SG',
  },
  {
    name: 'Wong Jia Hui',
    company: 'Orchard Supply Chain Pte Ltd',
    phone: '+65 9456 7890',
    email: 'jia.hui.wong@example.com',
    address: '250 Orchard Rd #03-01',
    country: 'Singapore',
    countryCode: 'SG',
    phoneCountryCode: '+65',
    locale: 'en-SG',
    companyCountry: 'Singapore',
    nameGenerationLocale: 'en-SG',
  },
  {
    name: 'Ng Chee Keong',
    company: 'Island Global Trade Pte Ltd',
    phone: '+65 8567 8901',
    email: 'chee.keong.ng@example.com',
    address: '8 Tuas South Ave 7',
    country: 'Singapore',
    countryCode: 'SG',
    phoneCountryCode: '+65',
    locale: 'en-SG',
    companyCountry: 'Singapore',
    nameGenerationLocale: 'en-SG',
  },

  // --- Malaysia ---
  {
    name: 'Muhammad Haziq',
    company: 'Klang Valley Logistics Sdn Bhd',
    phone: '+60 12 345 6789',
    email: 'haziq.muhammad@example.com',
    address: 'Jalan Bukit Bintang No. 102',
    country: 'Malaysia',
    countryCode: 'MY',
    phoneCountryCode: '+60',
    locale: 'ms-MY',
    companyCountry: 'Malaysia',
    nameGenerationLocale: 'ms-MY',
  },
  {
    name: 'Nurul Aisyah',
    company: 'Malaya Freight Forwarding Sdn Bhd',
    phone: '+60 13 456 7890',
    email: 'nurul.aisyah@example.com',
    address: 'Seksyen 13, Petaling Jaya',
    country: 'Malaysia',
    countryCode: 'MY',
    phoneCountryCode: '+60',
    locale: 'ms-MY',
    companyCountry: 'Malaysia',
    nameGenerationLocale: 'ms-MY',
  },
  {
    name: 'Tan Mei Ling',
    company: 'Penang Harapan Express Sdn Bhd',
    phone: '+60 14 567 8901',
    email: 'mei.ling.tan@example.com',
    address: 'Bayan Lepas Industrial Zone',
    country: 'Malaysia',
    countryCode: 'MY',
    phoneCountryCode: '+60',
    locale: 'ms-MY',
    companyCountry: 'Malaysia',
    nameGenerationLocale: 'ms-MY',
  },
  {
    name: 'Kumar Subramaniam',
    company: 'Bumi Raya Trans Sdn Bhd',
    phone: '+60 16 678 9012',
    email: 'kumar.subramaniam@example.com',
    address: 'Jalan Tebrau No. 55, Johor Bahru',
    country: 'Malaysia',
    countryCode: 'MY',
    phoneCountryCode: '+60',
    locale: 'ms-MY',
    companyCountry: 'Malaysia',
    nameGenerationLocale: 'ms-MY',
  },
  {
    name: 'Siti Khadijah',
    company: 'Borneo Cargo Services Sdn Bhd',
    phone: '+60 17 789 0123',
    email: 'siti.khadijah@example.com',
    address: 'Seksyen 15, Shah Alam',
    country: 'Malaysia',
    countryCode: 'MY',
    phoneCountryCode: '+60',
    locale: 'ms-MY',
    companyCountry: 'Malaysia',
    nameGenerationLocale: 'ms-MY',
  },

  // --- Japan ---
  {
    name: 'Kenji Sato',
    company: 'Tokyo Logistics Co Ltd',
    phone: '+81 3 1234 5678',
    email: 'kenji.sato@example.com',
    address: 'Chiyoda-ku, Tokyo 100-0001',
    country: 'Japan',
    countryCode: 'JP',
    phoneCountryCode: '+81',
    locale: 'ja-JP',
    companyCountry: 'Japan',
    nameGenerationLocale: 'ja-JP',
  },
  {
    name: 'Yuki Tanaka',
    company: 'Nippon Express Freight',
    phone: '+81 3 9876 5432',
    email: 'yuki.tanaka@example.com',
    address: 'Haneda Airport Cargo Terminal, Tokyo',
    country: 'Japan',
    countryCode: 'JP',
    phoneCountryCode: '+81',
    locale: 'ja-JP',
    companyCountry: 'Japan',
    nameGenerationLocale: 'ja-JP',
  },
];

// In-memory active library
let activePicLibrary = null;

// Track recently selected PIC names to avoid repetition in consecutive orders
const recentlySelectedNames = [];
const MAX_RECENT_TRACKING = 8;

function getRandomItem(arr) {
  if (!arr || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function getRandomDigits(length) {
  let res = '';
  for (let i = 0; i < length; i++) {
    res += Math.floor(Math.random() * 10);
  }
  return res;
}

/**
 * Normalize country input string into canonical country name and code.
 */
function normalizeCountry(raw) {
  if (!raw) return { name: 'Indonesia', code: 'ID', phoneCode: '+62', locale: 'id-ID' };
  const str = String(raw).trim().toLowerCase();

  if (str === 'singapore' || str === 'sg' || str === 'orchard') {
    return { name: 'Singapore', code: 'SG', phoneCode: '+65', locale: 'en-SG' };
  }
  if (str === 'japan' || str === 'jp' || str === 'tokyo' || str === 'jepang') {
    return { name: 'Japan', code: 'JP', phoneCode: '+81', locale: 'ja-JP' };
  }
  if (str === 'malaysia' || str === 'my' || str === 'kuala lumpur' || str === 'penang') {
    return { name: 'Malaysia', code: 'MY', phoneCode: '+60', locale: 'ms-MY' };
  }
  return { name: 'Indonesia', code: 'ID', phoneCode: '+62', locale: 'id-ID' };
}

/**
 * Load PIC library from disk or fallback to DEFAULT_PIC_LIBRARY.
 */
function loadPicLibrary(filepath = PIC_LIBRARY_FILE) {
  try {
    if (fs.existsSync(filepath)) {
      const raw = fs.readFileSync(filepath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        activePicLibrary = parsed;
        return activePicLibrary;
      }
    }
  } catch (err) {
    console.warn('[PICManager] Failed to read PIC library file, using default:', err.message);
  }

  activePicLibrary = JSON.parse(JSON.stringify(DEFAULT_PIC_LIBRARY));
  savePicLibrary(activePicLibrary, filepath);
  return activePicLibrary;
}

/**
 * Save PIC library to disk.
 */
function savePicLibrary(library, filepath = PIC_LIBRARY_FILE) {
  try {
    const dir = path.dirname(filepath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filepath, JSON.stringify(library, null, 2), 'utf-8');
    activePicLibrary = library;
  } catch (err) {
    console.error('[PICManager] Failed to persist PIC library:', err.message);
  }
}

/**
 * Get current in-memory PIC library (loads from file if not loaded yet).
 */
function getPicLibrary() {
  if (!activePicLibrary) {
    loadPicLibrary();
  }
  return activePicLibrary;
}

/**
 * Set active PIC library in-memory (useful for unit testing empty or custom library states).
 */
function setPicLibrary(library, persist = false, filepath = PIC_LIBRARY_FILE) {
  activePicLibrary = Array.isArray(library) ? library : [];
  if (persist) {
    savePicLibrary(activePicLibrary, filepath);
  }
}

/**
 * Reset PIC library to default baseline.
 */
function resetPicLibrary(persist = true, filepath = PIC_LIBRARY_FILE) {
  activePicLibrary = JSON.parse(JSON.stringify(DEFAULT_PIC_LIBRARY));
  recentlySelectedNames.length = 0;
  if (persist) {
    savePicLibrary(activePicLibrary, filepath);
  }
  return activePicLibrary;
}

/**
 * Validate that a PIC object has all mandatory contact fields.
 * Returns null if valid, or array of missing fields.
 */
function validatePIC(pic) {
  if (!pic || typeof pic !== 'object') return ['name', 'company', 'address', 'email', 'phone'];
  const missing = [];
  if (!pic.name || !String(pic.name).trim()) missing.push('name');
  if (!pic.company || !String(pic.company).trim()) missing.push('company');
  if (!pic.address || !String(pic.address).trim()) missing.push('address');
  if (!pic.email || !String(pic.email).trim()) missing.push('email');
  if (!pic.phone || !String(pic.phone).trim()) missing.push('phone');
  return missing.length > 0 ? missing : null;
}

/**
 * Generate a realistic, synthetic PIC contact profile tailored to country/locale.
 * Uses safe reserved domain @example.com to avoid real individuals or businesses.
 * 
 * @param {Object} options
 * @param {'pickup'|'dropoff'} [options.type='pickup']
 * @param {string} [options.city]
 * @param {string} [options.country='Indonesia']
 * @returns {Object} Complete, consistent synthetic PIC record
 */
function generateRealisticPIC(options = {}) {
  const normCountry = normalizeCountry(options.country);
  const type = options.type || 'pickup';
  const city = options.city || (type === 'pickup' ? 'Jakarta Selatan' : 'Surabaya');

  let fullName = '';
  let company = '';
  let address = '';
  let email = '';
  let phone = '';

  if (normCountry.code === 'SG') {
    // Singaporean Profile
    const fName = getRandomItem(SG_FIRST_NAMES);
    const lName = getRandomItem(SG_LAST_NAMES);
    fullName = `${lName} ${fName}`;
    company = getRandomItem(SG_COMPANY_NAMES);
    const street = getRandomItem(SG_STREETS);
    address = `${street} #${Math.floor(Math.random() * 20) + 1}-${Math.floor(Math.random() * 88) + 10}`;
    const cleanFirst = fName.toLowerCase().replace(/[^a-z]/g, '');
    const cleanLast = lName.toLowerCase().replace(/[^a-z]/g, '');
    email = `${cleanFirst}.${cleanLast}${Math.floor(Math.random() * 90 + 10)}@example.com`;
    // Singapore phone: 8-digit starting with 8 or 9
    phone = `+65 ${Math.random() > 0.5 ? '8' : '9'}${getRandomDigits(7)}`;
  } else if (normCountry.code === 'MY') {
    // Malaysian Profile
    const fName = getRandomItem(MY_FIRST_NAMES);
    const lName = getRandomItem(MY_LAST_NAMES);
    fullName = `${fName} ${lName}`;
    company = getRandomItem(MY_COMPANY_NAMES);
    const street = getRandomItem(MY_STREETS);
    address = `${street} No. ${Math.floor(Math.random() * 88) + 1}`;
    const cleanFirst = fName.toLowerCase().replace(/[^a-z]/g, '');
    const cleanLast = lName.toLowerCase().replace(/[^a-z]/g, '');
    email = `${cleanFirst}.${cleanLast}${Math.floor(Math.random() * 90 + 10)}@example.com`;
    // Malaysian mobile phone: +60 1X-XXXXXXX
    phone = `+60 1${Math.floor(Math.random() * 8 + 1)} ${getRandomDigits(7)}`;
  } else {
    // Indonesian Profile (Default)
    const firstName = getRandomItem(ID_FIRST_NAMES);
    const lastName = getRandomItem(ID_LAST_NAMES);
    fullName = `${firstName} ${lastName}`;
    const prefix = getRandomItem(ID_COMPANY_PREFIXES);
    const baseCompany = getRandomItem(ID_COMPANY_NAMES);
    company = `${prefix} ${baseCompany}`;
    const street = getRandomItem(ID_STREET_PREFIXES);
    address = `${street} ${city} No. ${Math.floor(Math.random() * 88) + 1}`;
    const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
    const cleanLast = lastName.toLowerCase().replace(/[^a-z]/g, '');
    email = `${cleanFirst}.${cleanLast}${Math.floor(Math.random() * 90 + 10)}@example.com`;
    phone = `08${Math.floor(Math.random() * 8 + 1)}${getRandomDigits(8)}`;
  }

  return {
    name: fullName,
    company,
    address,
    email,
    phone,
    country: normCountry.name,
    countryCode: normCountry.code,
    phoneCountryCode: normCountry.phoneCode,
    locale: normCountry.locale,
    companyCountry: normCountry.name,
    nameGenerationLocale: normCountry.locale,
    isGenerated: true,
  };
}

/**
 * Select a random, consistent PIC from the active library with country filtering,
 * exclusion support (for pickup vs dropoff, or consecutive orders), and automatic
 * fallback generation if library is empty or lacks country entries.
 * 
 * @param {Object} options
 * @param {string} [options.country='Indonesia'] Target country
 * @param {string[]} [options.excludeNames=[]] Names to avoid (e.g. pickup PIC name)
 * @param {string[]} [options.excludePhones=[]] Phone numbers to avoid
 * @param {boolean} [options.saveGeneratedToLibrary=true] Save generated fallback PIC to library
 * @param {string} [options.city] City for address if generated
 * @param {'pickup'|'dropoff'} [options.type='pickup']
 * @returns {{ pic: Object, origin: 'library_random'|'generated' }}
 */
function selectRandomPIC(options = {}) {
  const normCountry = normalizeCountry(options.country);
  const excludeNames = (options.excludeNames || []).map(n => String(n).trim().toLowerCase());
  const excludePhones = (options.excludePhones || []).map(p => String(p).trim().replace(/[^0-9]/g, ''));
  const saveGenerated = options.saveGeneratedToLibrary !== false;

  const library = getPicLibrary();

  // 1. Filter library by country and validity
  const validForCountry = library.filter(entry => {
    if (!entry) return false;
    const entryCountry = normalizeCountry(entry.country || entry.countryCode);
    if (entryCountry.code !== normCountry.code) return false;
    return validatePIC(entry) === null;
  });

  // 2. Filter out explicit exclusions and recently used names (if alternatives exist)
  let candidates = validForCountry.filter(entry => {
    const entryName = String(entry.name).trim().toLowerCase();
    const entryPhone = String(entry.phone).trim().replace(/[^0-9]/g, '');

    if (excludeNames.includes(entryName)) return false;
    if (excludePhones.includes(entryPhone)) return false;
    return true;
  });

  // If exclusions left no candidates, but country has valid entries, relax exclusions (except primary excludeNames)
  if (candidates.length === 0 && validForCountry.length > 0) {
    candidates = validForCountry.filter(entry => {
      const entryName = String(entry.name).trim().toLowerCase();
      return !excludeNames.includes(entryName);
    });
  }

  // If still 0 candidates (e.g. only 1 entry in library which was excluded by excludeNames)
  if (candidates.length === 0 && validForCountry.length > 0) {
    // If strict exclusion is needed (e.g. pickup vs drop-off must not be identical),
    // and library only has 1 record, generate a synthetic one!
    if (excludeNames.length > 0) {
      const generated = generateRealisticPIC({
        country: normCountry.name,
        city: options.city,
        type: options.type,
      });
      if (saveGenerated) {
        library.push(generated);
        savePicLibrary(library);
      }
      recordRecentName(generated.name);
      return { pic: generated, origin: 'generated' };
    }
    // Otherwise fallback to any valid entry
    candidates = validForCountry;
  }

  // 3. Prefer candidates not recently selected for consecutive order variance
  let preferred = candidates.filter(entry => {
    return !recentlySelectedNames.includes(entry.name.toLowerCase());
  });

  const finalPool = preferred.length > 0 ? preferred : candidates;

  // 4. If a valid pool exists, choose one randomly
  if (finalPool.length > 0) {
    const chosen = getRandomItem(finalPool);
    recordRecentName(chosen.name);
    return {
      pic: JSON.parse(JSON.stringify(chosen)),
      origin: 'library_random',
    };
  }

  // 5. Fallback: Library is empty or has NO usable entries for this country!
  // Section 9 & 10: Automatically generate a new synthetic PIC, validate it,
  // save it to the library, and return with origin 'generated'.
  const generated = generateRealisticPIC({
    country: normCountry.name,
    city: options.city,
    type: options.type,
  });

  if (saveGenerated) {
    library.push(generated);
    savePicLibrary(library);
  }

  recordRecentName(generated.name);
  return {
    pic: generated,
    origin: 'generated',
  };
}

function recordRecentName(name) {
  if (!name) return;
  recentlySelectedNames.push(name.toLowerCase());
  if (recentlySelectedNames.length > MAX_RECENT_TRACKING) {
    recentlySelectedNames.shift();
  }
}

module.exports = {
  DEFAULT_PIC_LIBRARY,
  PIC_LIBRARY_FILE,
  ID_FIRST_NAMES,
  ID_LAST_NAMES,
  ID_COMPANY_NAMES,
  loadPicLibrary,
  savePicLibrary,
  getPicLibrary,
  setPicLibrary,
  resetPicLibrary,
  validatePIC,
  normalizeCountry,
  generateRealisticPIC,
  selectRandomPIC,
};
