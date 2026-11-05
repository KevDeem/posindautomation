/**
 * Standalone POSIND Ordering Bot Configuration Manager
 */

const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const CONFIG_FILE = path.join(__dirname, 'bot_config.json');
const HISTORY_DIR = path.join(ROOT_DIR, '.execution-history');

const DEFAULT_CONFIG = {
  environment: 'staging-oms',
  omsUrl: 'https://sr-pos-oms-web.nisims.web.id',
  apiEndpoint: 'https://sr-pos-oms-api.nisims.web.id/api/v1',
  paymentSandboxUrl: 'https://pospay-sandbox.vercel.app',
  headless: false,
  maxRetries: 2,
  navigationTimeoutMs: 45000,
  actionTimeoutMs: 15000,
  paymentCooldownMs: 2000,
  username: process.env.OMS_USERNAME || 'kevin.d.imas@gmail.com',
  password: process.env.OMS_PASSWORD || '@Admin123.',
  sessionPath: path.join(ROOT_DIR, '.sessions/staging-oms_kevin_d_imas_gmail_com_session.json'),
};

function loadConfig() {
  let fileConfig = {};
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (err) {
      console.warn('[BotConfig] Could not parse bot_config.json:', err.message);
    }
  }

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    headless: process.env.HEADLESS !== undefined
      ? process.env.HEADLESS === 'true'
      : (fileConfig.headless !== undefined ? fileConfig.headless : DEFAULT_CONFIG.headless),
    historyDir: HISTORY_DIR,
    rootDir: ROOT_DIR,
  };
}

module.exports = {
  loadConfig,
  DEFAULT_CONFIG,
  HISTORY_DIR,
};
