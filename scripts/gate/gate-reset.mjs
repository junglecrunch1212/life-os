#!/usr/bin/env node
// scripts/gate/gate-reset.mjs — Midnight: Reset gate state for new day
// Cron: 0 0 * * * (midnight ET)

import gate from '../lib/gate.mjs';
import intentions from '../lib/intentions.mjs';

const state = gate.resetForNewDay();
intentions.clearIntentions();

console.log(JSON.stringify({
  status: 'ok',
  action: 'midnight_reset',
  new_state: state.status,
  grace_day_available: !state.grace_day_used_this_week,
  timestamp: new Date().toISOString(),
}));
