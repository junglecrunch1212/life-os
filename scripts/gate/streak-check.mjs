#!/usr/bin/env node
// scripts/gate/streak-check.mjs — 11 PM: Update streaks, check milestones
// Cron: 0 23 * * *

import gate from '../lib/gate.mjs';
import reinforcement from '../lib/reinforcement.mjs';

const gateState = gate.getGateStatus();
const isGraceDay = gateState.grace_day_active_today;

const result = reinforcement.updateStreaks(gateState, isGraceDay);

console.log(JSON.stringify({
  status: 'ok',
  streaks: result.streaks,
  milestones: result.milestones?.map(m => ({
    type: m.type,
    days: m.days,
    message: reinforcement.getMilestoneMessage(m),
  })) || [],
  timestamp: new Date().toISOString(),
}));
