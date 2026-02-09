// scripts/lib/stakes.mjs — Financial commitment devices for PiaB v3
//
// Evidence: Loss aversion is ~2x stronger than equivalent gains (Kahneman & Tversky).
// StickK platform research shows mixed (financial + social) settings most effective.
//
// ADHD-specific: Do NOT make stakes daily. Weekly thresholds allow one bad day
// while preserving motivation. Daily penalties create "already lost, why try" spirals.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT, loadYaml } from './yaml-loader.mjs';
import ledger from './ledger.mjs';

const STAKES_LOG = path.join(SKILL_ROOT, 'state', 'metrics', 'stakes.jsonl');

function loadConfig() {
  return loadYaml('state/config.yaml');
}

// ═══════════════════════════════════════
// WEEKLY EVALUATION
// ═══════════════════════════════════════

/**
 * Evaluate whether the financial stake was triggered this week.
 * Called during Sunday weekly review.
 *
 * @param {Object} weekData - { days: [{ date, pillars_completed, is_weekend, is_grace_day }] }
 * @returns {Object} - { triggered, rate, threshold, stake_amount, message }
 */
export function evaluateWeeklyStake(weekData) {
  const config = loadConfig();
  const stakes = config.financial_stakes;

  if (!stakes?.active) {
    return { triggered: false, reason: 'stakes_inactive', message: null };
  }

  if (config.gate?.baby_mode) {
    return { triggered: false, reason: 'baby_mode', message: null };
  }

  // Count weekdays with all 4 pillars
  const eligibleDays = weekData.days.filter(d =>
    !d.is_weekend && !d.is_grace_day
  );
  const fullDays = eligibleDays.filter(d =>
    d.pillars_completed >= 4
  ).length;
  const totalDays = eligibleDays.length;
  const rate = totalDays > 0 ? fullDays / totalDays : 0;

  const threshold = 0.60;
  const triggered = rate < threshold;

  const result = {
    triggered,
    full_days: fullDays,
    total_days: totalDays,
    rate,
    threshold,
    stake_amount: stakes.amount,
    destination: stakes.destination,
  };

  // Log
  fs.mkdirSync(path.dirname(STAKES_LOG), { recursive: true });
  fs.appendFileSync(STAKES_LOG, JSON.stringify({
    ...result,
    timestamp: new Date().toISOString(),
    week_start: weekData.days[0]?.date,
  }) + '\n');

  if (triggered) {
    result.message = `⚠️ Pillar rate this week: ${Math.round(rate * 100)}% (${fullDays}/${totalDays} days). Stake of $${stakes.amount} triggered. Destination: ${stakes.destination}.`;
  } else {
    result.message = `✅ Pillar rate: ${Math.round(rate * 100)}%. Stake of $${stakes.amount} safe.`;
  }

  return result;
}

// ═══════════════════════════════════════
// STAKE MANAGEMENT
// ═══════════════════════════════════════

/**
 * Update the weekly stake amount. Only allowed on Sundays.
 * Increases have a 4-week cooldown.
 */
export function updateStakeAmount(newAmount) {
  const config = loadConfig();
  const stakes = config.financial_stakes;
  const now = new Date();

  // Only allow on Sundays
  if (now.getDay() !== 0) {
    return { success: false, reason: 'Stakes can only be changed on Sundays.' };
  }

  // Check cap
  if (newAmount > (stakes.weekly_cap || 100)) {
    return { success: false, reason: `Amount capped at $${stakes.weekly_cap || 100}.` };
  }

  // Check cooldown on increases
  if (newAmount > stakes.amount) {
    if (stakes.locked_until && new Date(stakes.locked_until) > now) {
      return { success: false, reason: `Increase cooldown active until ${stakes.locked_until}.` };
    }
    // Set new cooldown
    const cooldownWeeks = stakes.cooldown_weeks_on_increase || 4;
    const lockUntil = new Date(now.getTime() + cooldownWeeks * 7 * 86400000);
    stakes.locked_until = lockUntil.toISOString().split('T')[0];
  }

  stakes.amount = newAmount;

  ledger.append('coach_ledger', {
    type: 'stake_change',
    person: 'james',
    old_amount: config.financial_stakes.amount,
    new_amount: newAmount,
  });

  return { success: true, amount: newAmount };
}

/**
 * Setup prompt for Sunday review.
 */
export function getStakeSetupPrompt() {
  const config = loadConfig();
  const stakes = config.financial_stakes;

  if (!stakes?.active) {
    return "Financial stakes are currently disabled. Enable in Phase 2.";
  }

  return `What's the stake this week? Current: $${stakes.amount}.\nOptions: $0 / $25 / $50 / $100\nDestination: ${stakes.destination}`;
}

export default { evaluateWeeklyStake, updateStakeAmount, getStakeSetupPrompt };
