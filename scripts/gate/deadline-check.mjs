#!/usr/bin/env node
// scripts/gate/deadline-check.mjs — Enforce time-gated deadlines
// Cron: runs at 11:30, 15:00, 17:00
// Usage: node scripts/gate/deadline-check.mjs --deadline tier2|tier3|lockout

import gate from '../lib/gate.mjs';

const args = process.argv.slice(2);
const deadline = args.find(a => a.startsWith('--deadline='))?.split('=')[1];

if (!deadline) {
  console.error('Usage: node deadline-check.mjs --deadline=tier2|tier3|lockout');
  process.exit(1);
}

const result = gate.enforceDeadline(deadline);

console.log(JSON.stringify({
  status: 'ok',
  deadline,
  action: result.action,
  message: result.message || null,
  reason: result.reason || null,
  timestamp: new Date().toISOString(),
}));

// If action is 'warn' or 'lock', the message should be sent via WhatsApp
// The calling cron job or OpenClaw heartbeat reads this output and routes it
