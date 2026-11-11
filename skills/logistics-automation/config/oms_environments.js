/**
 * Centralized OMS Environment Configuration & Resolver
 * 
 * Configures the supported OMS environments:
 * 1. Smart Routing: https://sr-pos-oms-web.nisims.web.id
 * 2. Staging:       https://pos-oms-staging-web.nisims.web.id/sr
 * 
 * Strict separation:
 * - Credentials are kept strictly separate from environment definitions.
 * - URLs are centralized here and never scattered across the codebase.
 * - VMS workflows and configurations are completely independent and unmodified.
 */

const OMS_ENVIRONMENTS = Object.freeze({
  'Smart Routing': Object.freeze({
    name: 'Smart Routing',
    key: 'smart-routing',
    baseUrl: 'https://sr-pos-oms-web.nisims.web.id',
    apiEndpoint: 'https://sr-pos-oms-api.nisims.web.id/api/v1',
    description: 'Smart Routing OMS Environment',
    sessionFilePrefix: 'smart-routing',
  }),
  'Staging': Object.freeze({
    name: 'Staging',
    key: 'staging',
    baseUrl: 'https://pos-oms-staging-web.nisims.web.id/sr',
    apiEndpoint: 'https://pos-oms-staging-api.nisims.web.id/api/v1',
    description: 'POSIND OMS Staging Environment',
    sessionFilePrefix: 'staging-oms',
  }),
});

/**
 * Get configured credentials for a specific OMS environment.
 * Allows environment variables to take precedence:
 * - Environment-specific: OMS_STAGING_USERNAME / OMS_STAGING_PASSWORD, OMS_SMARTROUTING_USERNAME / OMS_SMARTROUTING_PASSWORD
 * - Generic: OMS_USERNAME / OMS_PASSWORD
 * 
 * Credentials must be provided via environment variables.
 * Missing credentials fail safely by throwing a descriptive configuration error.
 * 
 * @param {string|Object} envInput Environment name, key, or resolved object
 * @returns {{username: string, password: string}} Credentials for the environment
 */
function getOmsCredentials(envInput) {
  const resolved = resolveOmsEnvironment(envInput) || OMS_ENVIRONMENTS['Smart Routing'];
  const isStaging = resolved.key === 'staging';

  let username;
  let password;

  if (isStaging) {
    username = process.env.OMS_STAGING_USERNAME || process.env.OMS_USERNAME;
    password = process.env.OMS_STAGING_PASSWORD || process.env.OMS_PASSWORD;
  } else {
    username = process.env.OMS_SMARTROUTING_USERNAME || process.env.OMS_USERNAME;
    password = process.env.OMS_SMARTROUTING_PASSWORD || process.env.OMS_PASSWORD;
  }

  if (!username || !password) {
    const missing = [];
    if (!username) {
      missing.push(isStaging ? 'OMS_STAGING_USERNAME or OMS_USERNAME' : 'OMS_SMARTROUTING_USERNAME or OMS_USERNAME');
    }
    if (!password) {
      missing.push(isStaging ? 'OMS_STAGING_PASSWORD or OMS_PASSWORD' : 'OMS_SMARTROUTING_PASSWORD or OMS_PASSWORD');
    }
    throw new Error(
      `[OMS Configuration Error] Missing required credentials for environment "${resolved.name}". ` +
      `Please define: ${missing.join(', ')} in your environment or .env file.`
    );
  }

  return { username, password };
}

/**
 * Get all configured OMS environments
 */
function getOmsEnvironments() {
  return OMS_ENVIRONMENTS;
}

/**
 * Get ordered array of environments for CLI display
 */
function getOmsEnvironmentList() {
  return [
    OMS_ENVIRONMENTS['Smart Routing'],
    OMS_ENVIRONMENTS['Staging'],
  ];
}

/**
 * Resolve an environment string, selection number, or object into a verified environment definition.
 * Returns null if invalid or unrecognized.
 * 
 * NEVER silently falls back to a default environment.
 * 
 * @param {string|number|Object} input
 * @returns {Object|null} Verified environment configuration or null
 */
function resolveOmsEnvironment(input) {
  if (!input) return null;

  if (typeof input === 'object') {
    if (input.name && OMS_ENVIRONMENTS[input.name]) {
      return OMS_ENVIRONMENTS[input.name];
    }
    if (input.key) {
      const match = Object.values(OMS_ENVIRONMENTS).find(e => e.key === input.key);
      if (match) return match;
    }
    if (input.baseUrl) {
      const match = Object.values(OMS_ENVIRONMENTS).find(
        e => e.baseUrl.replace(/\/+$/, '') === String(input.baseUrl).replace(/\/+$/, '')
      );
      if (match) return match;
    }
    return null;
  }

  const str = String(input).trim();
  const lower = str.toLowerCase();

  // Selection by index
  if (str === '1' || lower === 'smart routing' || lower === 'smart-routing' || lower === 'smartrouting' || lower === 'staging-oms') {
    return OMS_ENVIRONMENTS['Smart Routing'];
  }
  if (str === '2' || lower === 'staging' || lower === 'pos-oms-staging') {
    return OMS_ENVIRONMENTS['Staging'];
  }

  // Exact URL match
  const urlMatch = Object.values(OMS_ENVIRONMENTS).find(
    e => e.baseUrl.replace(/\/+$/, '') === str.replace(/\/+$/, '')
  );
  if (urlMatch) return urlMatch;

  return null;
}

/**
 * Format the standard CLI environment selection banner
 */
function formatEnvironmentSelectionMenu() {
  const envList = getOmsEnvironmentList();
  const lines = [
    '========================================',
    'Select OMS Environment',
    '========================================',
  ];
  envList.forEach((env, idx) => {
    lines.push(`${idx + 1}. ${env.name}`);
  });
  lines.push('========================================');
  return lines.join('\n');
}

/**
 * Interactively prompt user to select an OMS environment.
 * Requires explicit valid user input; never falls back automatically.
 * 
 * @param {Object} rl Readline interface instance
 * @returns {Promise<Object>} Verified environment configuration
 */
async function promptOmsEnvironment(rl) {
  console.log('\n' + formatEnvironmentSelectionMenu());

  while (true) {
    const rawAnswer = await rl.question('Select environment: ');
    const trimmed = (rawAnswer || '').trim();

    const resolved = resolveOmsEnvironment(trimmed);
    if (resolved) {
      console.log(`[OMS Environment] Selected: ${resolved.name} (${resolved.baseUrl})\n`);
      return resolved;
    }

    console.log('Invalid environment selection. Please enter 1 for Smart Routing or 2 for Staging.');
  }
}

module.exports = {
  OMS_ENVIRONMENTS,
  getOmsEnvironments,
  getOmsEnvironmentList,
  resolveOmsEnvironment,
  formatEnvironmentSelectionMenu,
  promptOmsEnvironment,
  getOmsCredentials,
};
