/**
 * VMS Configuration Manager
 * Manages staging environment URLs, credentials, and session paths.
 * Credentials read from environment variables; defaults to staging account.
 * Keeps browser executions strictly headless.
 */

const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const SESSIONS_DIR = path.join(ROOT_DIR, '.sessions');

const DEFAULT_VMS_CONFIG = {
  environment: 'staging-vms',
  vmsUrl: process.env.VMS_URL || 'https://sr-pos-vms-web.nisims.web.id',
  username: process.env.VMS_USERNAME || 'melatijbg@gmail.com',
  password: process.env.VMS_PASSWORD || '@Admin123.',
  headless: false, // Default to headed browser unless configured
  actionTimeoutMs: 15000,
  navigationTimeoutMs: 30000,
  sessionPath: path.join(SESSIONS_DIR, 'staging-vms_melatijbg_session.json'),
};

function loadVmsConfig(overrides = {}) {
  const username = process.env.VMS_USERNAME || overrides.username || DEFAULT_VMS_CONFIG.username;
  const password = process.env.VMS_PASSWORD || overrides.password || DEFAULT_VMS_CONFIG.password;
  const vmsUrl = process.env.VMS_URL || overrides.vmsUrl || DEFAULT_VMS_CONFIG.vmsUrl;
  const sessionPath = overrides.sessionPath || DEFAULT_VMS_CONFIG.sessionPath;

  const headless = overrides.headless !== undefined
    ? Boolean(overrides.headless)
    : (process.env.VMS_HEADLESS !== undefined
      ? process.env.VMS_HEADLESS === 'true'
      : (DEFAULT_VMS_CONFIG.headless ?? false));

  return {
    ...DEFAULT_VMS_CONFIG,
    ...overrides,
    username,
    password,
    vmsUrl,
    sessionPath,
    headless,
  };
}

module.exports = {
  DEFAULT_VMS_CONFIG,
  loadVmsConfig,
};
