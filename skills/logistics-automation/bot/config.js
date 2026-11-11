/**
 * Standalone POSIND Ordering Bot Configuration Manager
 * Centralizes configuration and references OMS environment definitions.
 */

const path = require('path');
const fs = require('fs');
const {
  OMS_ENVIRONMENTS,
  getOmsEnvironments,
  getOmsEnvironmentList,
  resolveOmsEnvironment,
  getOmsCredentials,
} = require('../config/oms_environments');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');
const HISTORY_DIR = path.join(ROOT_DIR, '.execution-history');

const DEFAULT_CONFIG = {
  // Centralized environment defaults (can be overridden per execution context)
  environment: 'Smart Routing',
  omsUrl: OMS_ENVIRONMENTS['Smart Routing'].baseUrl,
  apiEndpoint: OMS_ENVIRONMENTS['Smart Routing'].apiEndpoint,
  paymentSandboxUrl: 'https://pospay-sandbox.vercel.app',
  headless: false,
  batchConcurrency: 3,
  maxRetries: 2,
  navigationTimeoutMs: 45000,
  actionTimeoutMs: 15000,
  paymentCooldownMs: 2000,
  username: process.env.OMS_USERNAME || 'kevin.d.imas@gmail.com',
  password: process.env.OMS_PASSWORD || '@Admin123.',
  sessionPath: path.join(ROOT_DIR, '.sessions/smart-routing_kevin_d_imas_gmail_com_session.json'),
};

/**
 * Build an isolated, immutable execution context for a specific environment.
 * Ensures concurrent executions and batch workers never share or mutate global environment state.
 * 
 * @param {string|Object} envInput 'Smart Routing', 'Staging', or environment config object
 * @param {Object} [overrides={}] Additional config overrides
 * @returns {Object} Execution context with verified URLs and session paths
 */
function createExecutionContext(envInput, overrides = {}) {
  const resolvedEnv = resolveOmsEnvironment(envInput);
  if (!resolvedEnv) {
    throw new Error(`[BotConfig] Invalid OMS environment: "${JSON.stringify(envInput)}". Must be 'Smart Routing' or 'Staging'.`);
  }

  const base = loadConfig();
  const sessionFileName = `${resolvedEnv.sessionFilePrefix}_kevin_d_imas_gmail_com_session.json`;
  const envCreds = getOmsCredentials(resolvedEnv);

  return {
    ...base,
    username: overrides.username || envCreds.username,
    password: overrides.password || envCreds.password,
    ...overrides,
    environment: resolvedEnv.name,
    environmentKey: resolvedEnv.key,
    omsUrl: resolvedEnv.baseUrl,
    apiEndpoint: resolvedEnv.apiEndpoint,
    sessionPath: path.join(ROOT_DIR, '.sessions', sessionFileName),
  };
}

function loadConfig(options = {}) {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (err) {
      console.warn('[BotConfig] Could not parse bot_config.json:', err.message);
    }
  }

  const rawConcurrency = process.env.BATCH_CONCURRENCY !== undefined
    ? parseInt(process.env.BATCH_CONCURRENCY, 10)
    : (fileConfig.batchConcurrency !== undefined ? parseInt(fileConfig.batchConcurrency, 10) : DEFAULT_CONFIG.batchConcurrency);
  const batchConcurrency = (!Number.isNaN(rawConcurrency) && rawConcurrency > 0) ? rawConcurrency : DEFAULT_CONFIG.batchConcurrency;

  let resolvedEnv = null;
  const envTarget = options.environment || process.env.OMS_ENV || fileConfig.environment;
  if (envTarget) {
    resolvedEnv = resolveOmsEnvironment(envTarget);
  }

  const environment = resolvedEnv ? resolvedEnv.name : DEFAULT_CONFIG.environment;
  const omsUrl = resolvedEnv ? resolvedEnv.baseUrl : DEFAULT_CONFIG.omsUrl;
  const apiEndpoint = resolvedEnv ? resolvedEnv.apiEndpoint : DEFAULT_CONFIG.apiEndpoint;
  const sessionPath = resolvedEnv
    ? path.join(ROOT_DIR, '.sessions', `${resolvedEnv.sessionFilePrefix}_kevin_d_imas_gmail_com_session.json`)
    : DEFAULT_CONFIG.sessionPath;

  const envCreds = getOmsCredentials(resolvedEnv || environment);
  const username = options.username || fileConfig.username || envCreds.username;
  const password = options.password || fileConfig.password || envCreds.password;

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...options,
    username,
    password,
    environment,
    omsUrl,
    apiEndpoint,
    sessionPath,
    batchConcurrency,
    headless: process.env.HEADLESS !== undefined
      ? process.env.HEADLESS === 'true'
      : (options.headless !== undefined
        ? Boolean(options.headless)
        : (fileConfig.headless !== undefined ? fileConfig.headless : DEFAULT_CONFIG.headless)),
    historyDir: HISTORY_DIR,
    rootDir: ROOT_DIR,
  };
}

module.exports = {
  loadConfig,
  createExecutionContext,
  DEFAULT_CONFIG,
  HISTORY_DIR,
  OMS_ENVIRONMENTS,
  getOmsEnvironments,
  getOmsEnvironmentList,
  resolveOmsEnvironment,
};
