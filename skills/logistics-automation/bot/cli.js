#!/usr/bin/env node

/**
 * Entry point for standalone POSIND Ordering Bot CLI
 * 
 * Launch via:
 *   npm run order
 *   node skills/logistics-automation/bot/cli.js
 */

const { startOrderingBot } = require('./order_bot');

startOrderingBot().catch(err => {
  console.error('\n[FATAL BOT ERROR]:', err);
  process.exit(1);
});
