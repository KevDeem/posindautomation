/**
 * PIC (Person In Charge) Generator & Normalizer for Logistics Automation
 * 
 * Generates realistic Indonesian names, plausible company names,
 * realistic addresses, synthetic safe emails (using example.com),
 * and valid Indonesian phone numbers.
 * 
 * Supports independent generation and modification of Pickup PIC and Drop-off PIC.
 */

const FIRST_NAMES = [
  'Ahmad', 'Budi', 'Chandra', 'Dewi', 'Eko', 'Fitri', 'Gita', 'Hendra',
  'Indra', 'Joko', 'Kartika', 'Lestari', 'Mega', 'Nisa', 'Oki', 'Putri',
  'Rian', 'Sari', 'Tri', 'Utami', 'Wahyu', 'Yudi', 'Zahra', 'Aldin', 'Fajar'
];

const LAST_NAMES = [
  'Pratama', 'Saputra', 'Wijaya', 'Kusuma', 'Santoso', 'Hidayat', 'Wibowo',
  'Setiawan', 'Nugroho', 'Siregar', 'Lestari', 'Purnomo', 'Gunawan', 'Hakim',
  'Suryadi', 'Maulana', 'Firmansyah', 'Wardhana', 'Suharto', 'Aditya'
];

const COMPANY_PREFIXES = ['PT', 'CV', 'UD'];
const COMPANY_NAMES = [
  'Mega Jaya Logistik', 'Nusantara Mandiri', 'Sumber Berkat Abadi',
  'Surya Kencana', 'Bintang Timur Sejahtera', 'Harapan Bangsa Express',
  'Sinar Makmur', 'Sentosa Cargo', 'Mitra Usaha Prima', 'Raceway Shop'
];

const STREET_PREFIXES = ['Jl. Raya', 'Jl.', 'Komplek Pergudangan', 'Ruko Sentra', 'Kawasan Industri'];

function getRandomItem(arr) {
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
 * Generate a realistic, synthetic Indonesian PIC contact profile.
 * Uses safe reserved domain @example.com to avoid real individuals or businesses.
 * 
 * @param {Object} options
 * @param {'pickup'|'dropoff'} [options.type='pickup']
 * @param {string} [options.city='Jakarta']
 * @returns {Object} { name, company, address, email, phone, isGenerated: true }
 */
function generateRealisticPIC(options = {}) {
  const type = options.type || 'pickup';
  const city = options.city || (type === 'pickup' ? 'Jakarta Selatan' : 'Surabaya');
  
  const firstName = getRandomItem(FIRST_NAMES);
  const lastName = getRandomItem(LAST_NAMES);
  const fullName = `${firstName} ${lastName}`;
  
  const prefix = getRandomItem(COMPANY_PREFIXES);
  const baseCompany = getRandomItem(COMPANY_NAMES);
  const company = `${prefix} ${baseCompany}`;
  
  const street = getRandomItem(STREET_PREFIXES);
  const address = `${street} ${city} No. ${Math.floor(Math.random() * 88) + 1}`;
  
  // Clean synthetic email
  const cleanFirst = firstName.toLowerCase().replace(/[^a-z]/g, '');
  const cleanLast = lastName.toLowerCase().replace(/[^a-z]/g, '');
  const email = `${cleanFirst}.${cleanLast}${Math.floor(Math.random() * 90 + 10)}@example.com`;
  
  // Indonesian mobile phone format (08XXXXXXXXXX / 8XXXXXXXXXX)
  const phone = `08${Math.floor(Math.random() * 8 + 1)}${getRandomDigits(8)}`;
  
  return {
    name: fullName,
    company,
    address,
    email,
    phone,
    isGenerated: true,
  };
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

module.exports = {
  generateRealisticPIC,
  validatePIC,
};
