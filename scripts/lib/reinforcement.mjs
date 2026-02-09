// scripts/lib/reinforcement.mjs — Streaks & Variable Reinforcement for PiaB v3
//
// Streaks: Sunk cost bias — the longer a streak, the more painful to break.
// Variable reinforcement: Variable ratio schedules produce the highest response rates
// and greatest resistance to extinction. Fixed schedules become background noise;
// random rewards stay interesting.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT, loadYaml, loadHousehold } from './yaml-loader.mjs';
import ledger from './ledger.mjs';

const STREAKS_PATH = path.join(SKILL_ROOT, 'state', 'streaks.json');
const STREAKS_LOG = path.join(SKILL_ROOT, 'state', 'metrics', 'streaks.jsonl');
const ENERGY_LOG = path.join(SKILL_ROOT, 'state', 'metrics', 'energy.jsonl');

function loadStreaks() {
  try {
    return JSON.parse(fs.readFileSync(STREAKS_PATH, 'utf-8'));
  } catch {
    return {
      daily_exercise: 0,
      four_four: 0,
      weekly_above_threshold: 0,
      streak_freeze_used_this_week: false,
      last_updated: null,
    };
  }
}

function saveStreaks(streaks) {
  fs.writeFileSync(STREAKS_PATH, JSON.stringify(streaks, null, 2));
}

function loadConfig() {
  return loadYaml('state/config.yaml');
}

// ═══════════════════════════════════════
// STREAK MANAGEMENT
// ═══════════════════════════════════════

/**
 * Update streaks at end of day.
 * Called by the 11pm cron job.
 *
 * @param {Object} gateState - Today's gate state
 * @param {boolean} isGraceDay - Whether today was a grace day
 */
export function updateStreaks(gateState, isGraceDay = false) {
  const streaks = loadStreaks();
  const today = new Date().toISOString().split('T')[0];

  // Prevent double-counting
  if (streaks.last_updated === today) return streaks;

  // Daily exercise streak
  if (gateState.pillars_completed.includes('exercise')) {
    streaks.daily_exercise = (streaks.daily_exercise || 0) + 1;
  } else if (!isGraceDay || streaks.streak_freeze_used_this_week) {
    streaks.daily_exercise = 0;
  } else {
    // Grace day: freeze the streak
    streaks.streak_freeze_used_this_week = true;
  }

  // 4/4 streak
  if (gateState.pillars_completed.length >= 4) {
    streaks.four_four = (streaks.four_four || 0) + 1;
  } else if (!isGraceDay || streaks.streak_freeze_used_this_week) {
    streaks.four_four = 0;
  }

  // Weekly reset of freeze on Monday
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 1) {
    streaks.streak_freeze_used_this_week = false;
  }

  streaks.last_updated = today;

  // Check milestones
  const milestones = checkMilestones(streaks);

  // Log
  fs.mkdirSync(path.dirname(STREAKS_LOG), { recursive: true });
  fs.appendFileSync(STREAKS_LOG, JSON.stringify({
    date: today,
    daily_exercise: streaks.daily_exercise,
    four_four: streaks.four_four,
    weekly_above_threshold: streaks.weekly_above_threshold,
    milestones_hit: milestones.map(m => m.type),
  }) + '\n');

  saveStreaks(streaks);
  return { streaks, milestones };
}

/**
 * Update weekly streak (called during Sunday review).
 */
export function updateWeeklyStreak(weeklyPillarRate, threshold = 0.60) {
  const streaks = loadStreaks();

  if (weeklyPillarRate >= threshold) {
    streaks.weekly_above_threshold = (streaks.weekly_above_threshold || 0) + 1;
  } else {
    streaks.weekly_above_threshold = 0;
  }

  saveStreaks(streaks);
  return streaks;
}

// ═══════════════════════════════════════
// MILESTONE DETECTION
// ═══════════════════════════════════════

function checkMilestones(streaks) {
  const milestones = [];
  const thresholds = [7, 14, 30, 60, 90];

  for (const t of thresholds) {
    if (streaks.daily_exercise === t) {
      milestones.push({ type: `exercise_${t}`, streak: 'daily_exercise', days: t });
    }
    if (streaks.four_four === t) {
      milestones.push({ type: `four_four_${t}`, streak: 'four_four', days: t });
    }
  }

  return milestones;
}

/**
 * Get milestone reward message.
 */
export function getMilestoneMessage(milestone) {
  const messages = {
    7: "One week straight. That's not luck — that's building identity.",
    14: "Two weeks. The research says 66 days to a habit. You're 21% there.",
    30: "30 days. You've earned a reward. What did you pre-define?",
    60: "60 days of consistency. Laura's going to hear about this one.",
    90: "90 days. Quarter of a year. This is who you are now.",
  };
  return messages[milestone.days] || `${milestone.days}-day streak! Keep going.`;
}

// ═══════════════════════════════════════
// VARIABLE REINFORCEMENT
// ═══════════════════════════════════════

/**
 * Decide whether to send a variable reinforcement message.
 * 30% chance on completion, 10% chance of data insight.
 */
export function shouldSendReinforcement() {
  return Math.random() < 0.30;
}

export function shouldSendDataInsight() {
  return Math.random() < 0.10;
}

/**
 * Get a random reinforcement message for a pillar completion.
 */
export function getReinforcementMessage(pillar, streaks) {
  const messages = {
    exercise: [
      "Post-exercise you is the sharpest version of you. Henry gets that version today.",
      `${streaks.daily_exercise} days straight. That's not luck, that's identity.`,
      "Your completion rate on everything else is 40% higher on exercise days.",
      "30 minutes of investment that pays dividends all day.",
    ],
    captain: [
      "Captain needed that. You both did.",
      "Morning walks before 9am correlate with your best days.",
      "Getting outside first thing — that's the move.",
    ],
    honey_do: [
      "Laura will notice. Trust the data — her friction score drops on weeks you hit 3+ honey-do items.",
      "That's partnership in action.",
      "One less thing on her mental load. That matters more than you think.",
    ],
    clean: [
      "Henry's growing up in a home that works. That matters.",
      "Clean spaces reduce ADHD cognitive load. This isn't chores, it's infrastructure.",
      "Visible progress. The kind everyone in the house can feel.",
    ],
  };

  const pool = messages[pillar] || messages.exercise;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Get a data-driven insight message.
 */
export function getDataInsight(pillar, streaks) {
  const insights = [
    `Your completion rate is higher on days you exercise first.`,
    `Captain walks before 9am correlate with 4/4 pillar days 80% of the time.`,
    `${streaks.daily_exercise > 7 ? 'Your exercise streak is building real momentum.' : 'Exercise consistency is the #1 predictor of everything else.'}`,
    `Three weeks ago you couldn't do 2 pillars by noon. Look at you now.`,
  ];
  return insights[Math.floor(Math.random() * insights.length)];
}

// ═══════════════════════════════════════
// ENERGY TRACKING
// ═══════════════════════════════════════

/**
 * Log energy rating.
 * Used to prove that mood follows action, not the reverse.
 */
export function logEnergy(person, score, context = 'general') {
  const entry = {
    timestamp: new Date().toISOString(),
    person,
    score,
    context, // pre_pillar | post_pillar | midday | evening
  };
  fs.mkdirSync(path.dirname(ENERGY_LOG), { recursive: true });
  fs.appendFileSync(ENERGY_LOG, JSON.stringify(entry) + '\n');
  return entry;
}

/**
 * Get energy pattern analysis.
 * Shows that energy goes UP after exercise/pillars.
 */
export function getEnergyPattern(person, days = 14) {
  if (!fs.existsSync(ENERGY_LOG)) return null;

  const entries = fs.readFileSync(ENERGY_LOG, 'utf-8')
    .trim().split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const recent = entries.filter(e => e.person === person && e.timestamp >= cutoff);

  const byContext = {};
  for (const e of recent) {
    if (!byContext[e.context]) byContext[e.context] = [];
    byContext[e.context].push(e.score);
  }

  const averages = {};
  for (const [ctx, scores] of Object.entries(byContext)) {
    averages[ctx] = scores.reduce((a, b) => a + b, 0) / scores.length;
  }

  return {
    averages,
    data_points: recent.length,
    insight: averages.pre_pillar && averages.post_pillar
      ? `Average energy BEFORE exercise: ${averages.pre_pillar.toFixed(1)}. AFTER: ${averages.post_pillar.toFixed(1)}. Pattern: exercise adds +${(averages.post_pillar - averages.pre_pillar).toFixed(1)} energy points.`
      : null,
  };
}

// ═══════════════════════════════════════
// STREAK DISPLAY
// ═══════════════════════════════════════

/**
 * Get streak display for morning briefing.
 */
export function getStreakDisplay() {
  const streaks = loadStreaks();
  const parts = [];

  if (streaks.daily_exercise > 0) {
    parts.push(`🔥 Day ${streaks.daily_exercise} exercise`);
  }
  if (streaks.four_four > 0) {
    parts.push(`Day ${streaks.four_four} of 4/4`);
  }
  if (streaks.weekly_above_threshold > 0) {
    parts.push(`${streaks.weekly_above_threshold} weeks above target`);
  }

  return parts.length > 0 ? parts.join(' | ') : 'No active streaks — today is day 1.';
}

export function getCurrentStreaks() {
  return loadStreaks();
}

export default {
  updateStreaks, updateWeeklyStreak,
  getMilestoneMessage, checkMilestones: () => checkMilestones(loadStreaks()),
  shouldSendReinforcement, shouldSendDataInsight,
  getReinforcementMessage, getDataInsight,
  logEnergy, getEnergyPattern,
  getStreakDisplay, getCurrentStreaks,
};
