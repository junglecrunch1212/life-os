#!/usr/bin/env node
// scripts/gate/grace-check.mjs — Noon: Auto-grant grace day if 0 pillars
// Cron: 0 12 * * * (noon ET) — runs before midday check-in

import gate from '../lib/gate.mjs';

const result = gate.checkGraceDay();

console.log(JSON.stringify({
  status: 'ok',
  action: result.activated ? 'grace_day_activated' : 'no_grace_needed',
  reason: result.reason || null,
  message: result.message || null,
  timestamp: new Date().toISOString(),
}));
