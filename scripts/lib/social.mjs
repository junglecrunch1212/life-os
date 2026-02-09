// scripts/lib/social.mjs — Social accountability escalation for PiaB v3
//
// Critical warning: This is the most powerful lever AND the most dangerous.
// Used wrong, it turns PiaB into a snitch system and makes Laura feel like a parent.
// Used right, it creates shared visibility that reduces her cognitive load.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT, loadYaml, loadHousehold } from './yaml-loader.mjs';
import ledger from './ledger.mjs';

const LAURA_LOG = path.join(SKILL_ROOT, 'state', 'metrics', 'laura.jsonl');

function loadConfig() {
  return loadYaml('state/config.yaml');
}

// ═══════════════════════════════════════
// TIER 1: PASSIVE VISIBILITY (Weekly Scorecard to Laura)
// ═══════════════════════════════════════

/**
 * Generate weekly scorecard for Laura.
 * Simple, visual, no judgment.
 */
export function generateLauraScorecard(weekData) {
  const config = loadConfig();
  if (!config.social_accountability?.laura_weekly_scorecard) return null;

  const pillarBar = weekData.pillar_days_full >= 5 ? '█████' :
    '█'.repeat(weekData.pillar_days_full) + '░'.repeat(5 - weekData.pillar_days_full);

  return [
    "James's week:",
    ` Pillars: ${pillarBar} (${weekData.pillar_days_full}/5 days complete)`,
    ` Exercise: ${weekData.exercise_days}/7 ✓`,
    ` Captain: ${weekData.captain_days}/7 ✓`,
    ` Honey-Do: ${weekData.honey_do_days}/5 ✓`,
    ` Big Thing: ${weekData.big_thing_days}/5 ✓`,
  ].join('\n');
}

// ═══════════════════════════════════════
// TIER 2: BOOKEND CHECK-INS (Honey-Do)
// ═══════════════════════════════════════

/**
 * Generate bookend messages for Laura when James starts/finishes a honey-do.
 */
export function getBookendStart(taskTitle) {
  const config = loadConfig();
  if (!config.social_accountability?.laura_bookend_checkins) return null;
  return `James is starting ${taskTitle} now.`;
}

export function getBookendComplete(taskTitle) {
  const config = loadConfig();
  if (!config.social_accountability?.laura_bookend_checkins) return null;
  return `${taskTitle} done. ✓`;
}

// ═══════════════════════════════════════
// TIER 3: ESCALATION TEXT (Pre-Authorized)
// ═══════════════════════════════════════

/**
 * Check if escalation text to Laura should fire.
 * ONLY fires if James pre-authorized this week AND 0 pillars by 2pm.
 */
export function shouldEscalateToLaura(gateState) {
  const config = loadConfig();
  if (!config.social_accountability?.laura_escalation_enabled) return false;
  if (!config.social_accountability?.laura_escalation_opted_in_this_week) return false;

  // Check Laura's friction score — auto-disable if > 3
  const frictionScore = getLatestFrictionScore();
  if (frictionScore && frictionScore > 3.0) return false;

  const now = new Date();
  const hour = now.getHours();
  if (hour < 14) return false; // not 2pm yet

  // Check if 0 pillars
  if (gateState.pillars_completed.length > 0) return false;

  // Check if already sent today
  const sentToday = ledger.countToday('coach_ledger', e =>
    e.type === 'laura_escalation'
  );
  if (sentToday > 0) return false;

  // Check weekly limit (max 2)
  const sentThisWeek = ledger.read('coach_ledger', 100, e =>
    e.type === 'laura_escalation'
  ).filter(e => {
    const entryDate = new Date(e.ts);
    const weekAgo = new Date(Date.now() - 7 * 86400000);
    return entryDate > weekAgo;
  }).length;

  if (sentThisWeek >= 2) return false;

  return true;
}

/**
 * Get the escalation message for Laura.
 * Tone: invitation for support, never a report card.
 */
export function getLauraEscalationMessage() {
  return "Hey — James asked me to let you know he's having a rough start today. A quick encouraging text might help.";
}

/**
 * Log that escalation was sent.
 */
export function logLauraEscalation() {
  ledger.append('coach_ledger', {
    type: 'laura_escalation',
    person: 'james',
    sent_to: 'laura',
  });
}

// ═══════════════════════════════════════
// TIER 4: ACCOUNTABILITY BUDDY
// ═══════════════════════════════════════

/**
 * Generate abbreviated scorecard for accountability buddy.
 */
export function generateBuddyScorecard(weekData) {
  const config = loadConfig();
  if (!config.social_accountability?.accountability_buddy?.enabled) return null;

  return `James's pillar rate: ${Math.round(weekData.pillar_rate * 100)}%. Streak: ${weekData.weekly_streak} weeks. Exercise: ${weekData.exercise_days}/7.`;
}

// ═══════════════════════════════════════
// LAURA FRICTION SCORE
// ═══════════════════════════════════════

/**
 * Log Laura's weekly friction score.
 */
export function logFrictionScore(score, notes = '') {
  const entry = {
    date: new Date().toISOString().split('T')[0],
    friction_score: score,
    notes,
  };
  fs.mkdirSync(path.dirname(LAURA_LOG), { recursive: true });
  fs.appendFileSync(LAURA_LOG, JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * Get the latest friction score.
 */
export function getLatestFrictionScore() {
  if (!fs.existsSync(LAURA_LOG)) return null;
  const lines = fs.readFileSync(LAURA_LOG, 'utf-8').trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  try {
    const last = JSON.parse(lines[lines.length - 1]);
    return last.friction_score;
  } catch { return null; }
}

/**
 * Get friction score trend.
 */
export function getFrictionTrend(weeks = 4) {
  if (!fs.existsSync(LAURA_LOG)) return { trend: 'unknown', scores: [] };
  const lines = fs.readFileSync(LAURA_LOG, 'utf-8').trim().split('\n').filter(Boolean);
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const recent = entries.slice(-weeks);
  const scores = recent.map(e => e.friction_score);

  if (scores.length < 2) return { trend: 'insufficient_data', scores };

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
  const secondHalf = scores.slice(Math.floor(scores.length / 2));
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

  let trend = 'stable';
  if (secondAvg < firstAvg - 0.3) trend = 'improving';
  if (secondAvg > firstAvg + 0.3) trend = 'worsening';

  return { trend, average: avg, scores, latest: scores[scores.length - 1] };
}

export default {
  generateLauraScorecard,
  getBookendStart, getBookendComplete,
  shouldEscalateToLaura, getLauraEscalationMessage, logLauraEscalation,
  generateBuddyScorecard,
  logFrictionScore, getLatestFrictionScore, getFrictionTrend,
};
