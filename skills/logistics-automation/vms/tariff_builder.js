/**
 * VMS Tariff Builder
 * Builds pricing configurations and tariff structures for:
 * - FTL (RITASE: one fixed trip price)
 * - FCL (FCL: one fixed container price)
 * - LTL (CBM / Volume-based: KG, Tonase, CBM)
 * - LCL (CBM / Volume-based: KG, Tonase, CBM)
 * - Air Cargo (CBM / Volume-based: KG, Tonase, CBM)
 * 
 * Includes configurable synthetic default pricing and marks estimated rates clearly.
 */

const SYNTHETIC_DEFAULTS = {
  // Land
  'DARAT_FTL': { tariffType: 'RITASE', costRitase: 2500000 },
  'DARAT_LTL': { tariffType: 'CBM', costPerKg: 3500, costPerTonase: 3000000, costPerCbm: 600000 },

  // Sea
  'LAUT_FCL': { tariffType: 'FCL', costRitase: 18000000 },
  'LAUT_LCL': { tariffType: 'CBM', costPerKg: 5000, costPerTonase: 5000000, costPerCbm: 1200000 },

  // Air
  'UDARA_CARGO': { tariffType: 'CBM', costPerKg: 25000, costPerTonase: 25000000, costPerCbm: 5000000 },
};

/**
 * Format currency into Rupiah format
 */
function formatRupiah(amount) {
  if (amount === undefined || amount === null || isNaN(amount)) return 'Rp0';
  return `Rp${Math.round(amount).toLocaleString('id-ID')}`;
}

/**
 * Parse raw price string like "Rp2.500.000", "2.5M", "50000" into numeric integer
 */
function parsePriceInput(val) {
  if (typeof val === 'number') return Math.round(val);
  if (!val) return null;

  const str = String(val).trim().toUpperCase();

  // Handle shorthand: 2.5jt / 2.5m
  const jtMatch = str.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(?:JT|JUTA|M)$/);
  if (jtMatch) {
    const num = parseFloat(jtMatch[1].replace(',', '.'));
    return Math.round(num * 1000000);
  }

  // Handle shorthand: 50k / 50rb
  const kMatch = str.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(?:K|RB|RIBU)$/);
  if (kMatch) {
    const num = parseFloat(kMatch[1].replace(',', '.'));
    return Math.round(num * 1000);
  }

  const clean = str.replace(/[^0-9]/g, '');
  return clean ? parseInt(clean, 10) : null;
}

/**
 * Build tariff specification based on Mode, Service Type, and user provided inputs
 */
function buildRouteTariff(mode, serviceType, userTariff = {}) {
  const normMode = (mode || '').toUpperCase();
  const normService = (serviceType || '').toUpperCase();
  const key = `${normMode}_${normService}`;

  const defaults = SYNTHETIC_DEFAULTS[key] || SYNTHETIC_DEFAULTS['DARAT_LTL'];
  const tariff = {
    tariffType: defaults.tariffType,
    isSynthetic: true,
    sources: {},
  };

  if (normService === 'FTL' || normService === 'FCL') {
    const userPrice = parsePriceInput(userTariff.fixedPrice || userTariff.costRitase || userTariff.price);
    if (userPrice !== null && userPrice > 0) {
      tariff.costRitase = userPrice;
      tariff.isSynthetic = false;
      tariff.sources.costRitase = 'provided';
    } else {
      tariff.costRitase = defaults.costRitase;
      tariff.sources.costRitase = 'synthetic_estimated';
    }
  } else {
    // LTL, LCL, CARGO: Requires KG, Tonase, CBM
    const userKg = parsePriceInput(userTariff.costPerKg || userTariff.kg);
    const userTon = parsePriceInput(userTariff.costPerTonase || userTariff.tonase || userTariff.ton);
    const userCbm = parsePriceInput(userTariff.costPerCbm || userTariff.cbm);

    tariff.costPerKg = userKg !== null ? userKg : defaults.costPerKg;
    tariff.costPerTonase = userTon !== null ? userTon : defaults.costPerTonase;
    tariff.costPerCbm = userCbm !== null ? userCbm : defaults.costPerCbm;

    tariff.sources.costPerKg = userKg !== null ? 'provided' : 'synthetic_default';
    tariff.sources.costPerTonase = userTon !== null ? 'provided' : 'synthetic_default';
    tariff.sources.costPerCbm = userCbm !== null ? 'provided' : 'synthetic_default';

    if (userKg !== null && userTon !== null && userCbm !== null) {
      tariff.isSynthetic = false;
    }
  }

  return tariff;
}

module.exports = {
  SYNTHETIC_DEFAULTS,
  formatRupiah,
  parsePriceInput,
  buildRouteTariff,
};
