/**
 * Execution History Manager for POSIND Ordering Bot
 * 
 * Persists and retrieves execution records in `.execution-history/`.
 * Ensures NO passwords, auth tokens, session cookies, or credentials are saved.
 */

const fs = require('fs');
const path = require('path');
const { HISTORY_DIR } = require('./config');

function ensureHistoryDir() {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

/**
 * Sanitize object to guarantee no credentials or sensitive tokens are stored.
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = Array.isArray(obj) ? [] : {};
  const forbiddenKeys = ['password', 'secret', 'token', 'cookie', 'cookies', 'storageState', 'credentials'];

  for (const [key, value] of Object.entries(obj)) {
    if (forbiddenKeys.includes(key.toLowerCase())) continue;
    if (typeof value === 'object' && value !== null) {
      clean[key] = sanitizeObject(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Save an execution record.
 */
function saveExecutionRecord(data) {
  ensureHistoryDir();
  const id = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const record = {
    id,
    timestamp: new Date().toISOString(),
    request: data.request || '',
    menuOption: data.menuOption || '',
    orderType: data.orderType || 'domestic',
    batchCount: data.batchCount || 1,
    autoPay: data.autoPay || false,
    summary: data.summary || { total: 1, succeeded: 0, failed: 0, totalAmountPaid: 0 },
    orders: (data.orders || []).map(o => ({
      index: o.index,
      label: o.label,
      orderId: o.orderId,
      shipmentId: o.shipmentId,
      amount: o.amount,
      vaNumber: o.vaNumber,
      status: o.status || (o.success ? 'SUCCESS' : 'FAILED'),
      sandboxPayment: o.sandboxPayment,
      omsStatus: o.omsStatus,
      attempts: o.attempts || 1,
      error: o.error,
    })),
    specification: sanitizeObject(data.specification || {}),
  };

  const filePath = path.join(HISTORY_DIR, `${id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
  return record;
}

/**
 * List past execution records sorted by timestamp descending.
 */
function listExecutionRecords(limit = 10) {
  ensureHistoryDir();
  const files = fs.readdirSync(HISTORY_DIR)
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse();

  const records = [];
  for (const f of files.slice(0, limit)) {
    try {
      const content = fs.readFileSync(path.join(HISTORY_DIR, f), 'utf-8');
      records.push(JSON.parse(content));
    } catch (err) {
      console.warn(`[HistoryManager] Failed to read ${f}:`, err.message);
    }
  }
  return records;
}

module.exports = {
  saveExecutionRecord,
  listExecutionRecords,
  sanitizeObject,
};
