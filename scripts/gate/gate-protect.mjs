#!/usr/bin/env node
// scripts/gate/gate-protect.mjs — 8 PM: Force LOCKED_NIGHT
// Cron: 0 20 * * * (8pm ET)

import gate from '../lib/gate.mjs';

const result = gate.enforceDeadline('protect');

console.log(JSON.stringify({
  status: 'ok',
  action: result.action,
  message: result.message || 'Already locked',
  timestamp: new Date().toISOString(),
}));
