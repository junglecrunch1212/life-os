#!/usr/bin/env node
// scripts/gate/weekly-compute.mjs — Sunday 6 PM: Full weekly scorecard
// Computes all metrics, evaluates stakes, generates reports.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT, loadYaml } from '../lib/yaml-loader.mjs';
import pillars from '../lib/pillars.mjs';
import stakes from '../lib/stakes.mjs';
import social from '../lib/social.mjs';
import reinforcement from '../lib/reinforcement.mjs';
import bodyDouble from '../lib/body-double.mjs';
import ledger from '../lib/ledger.mjs';

const TOP3_LOG = path.join(SKILL_ROOT, 'state', 'metrics', 'top3.jsonl');

async function main() {
  const config = loadYaml('state/config.yaml');

  // ── Pillar data for the week ──
  const pillarHistory = pillars.getPillarHistory(7);
  const pillarRate = pillars.getPillarRate(5);

  // Build day-by-day data
  const byDate = {};
  for (const entry of pillarHistory) {
    const date = entry.timestamp.split('T')[0];
    if (!byDate[date]) byDate[date] = { date, pillars: new Set(), is_weekend: false, is_grace_day: false };
    byDate[date].pillars.add(entry.pillar);
  }

  const weekDays = Object.values(byDate).map(d => {
    const day = new Date(d.date).getDay();
    return {
      date: d.date,
      pillars_completed: d.pillars.size,
      exercise: d.pillars.has('exercise'),
      captain: d.pillars.has('captain'),
      honey_do: d.pillars.has('honey_do'),
      clean: d.pillars.has('clean'),
      is_weekend: day === 0 || day === 6,
      is_grace_day: d.is_grace_day,
    };
  });

  // ── Compute core metrics ──
  const exerciseDays = weekDays.filter(d => d.exercise).length;
  const captainDays = weekDays.filter(d => d.captain).length;
  const honeyDoDays = weekDays.filter(d => d.honey_do && !d.is_weekend).length;
  const pillarDaysFull = weekDays.filter(d => d.pillars_completed >= 4 && !d.is_weekend).length;
  const lockoutNights = weekDays.filter(d => !d.is_weekend && d.pillars_completed < 4).length;

  // ── Big Thing tracking ──
  let bigThingDays = 0;
  if (fs.existsSync(TOP3_LOG)) {
    const lines = fs.readFileSync(TOP3_LOG, 'utf-8').trim().split('\n').filter(Boolean);
    const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
    const recent = lines.map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && e.date >= cutoff.split('T')[0]);
    bigThingDays = recent.filter(d => d.items?.[0]?.completed).length;
  }

  // ── Self-initiation ratio ──
  const initiation = bodyDouble.getSelfInitiationRatio('james', 7);

  // ── Evaluate financial stake ──
  const stakeResult = stakes.evaluateWeeklyStake({ days: weekDays });

  // ── Update weekly streak ──
  const updatedStreaks = reinforcement.updateWeeklyStreak(pillarRate.rate);

  // ── Crash day detection ──
  const crashDays = weekDays.filter(d =>
    !d.is_weekend && d.pillars_completed === 0
  ).length;

  // ── Laura friction ──
  const frictionTrend = social.getFrictionTrend(4);

  // ── Energy pattern ──
  const energyPattern = reinforcement.getEnergyPattern('james', 7);

  // ── Determine escalation level ──
  let escalationLevel = 1;
  if (pillarRate.rate < 0.60 && pillarRate.rate >= 0.40) escalationLevel = 2;
  if (pillarRate.rate < 0.40 && pillarRate.rate >= 0.20) escalationLevel = 3;
  if (pillarRate.rate < 0.20 || lockoutNights >= 3) escalationLevel = 4;

  // ── Build scorecard ──
  const scorecard = {
    computed_at: new Date().toISOString(),
    week_start: weekDays[0]?.date || 'unknown',

    // Core 5 metrics
    pillar_completion_rate: {
      value: pillarRate.rate,
      display: `${pillarRate.full_days}/${pillarRate.total_days} days (${Math.round(pillarRate.rate * 100)}%)`,
      target: '≥60% (3/5 days)',
      met: pillarRate.rate >= 0.60,
    },
    exercise_rate: {
      value: exerciseDays,
      display: `${exerciseDays}/7 days`,
      target: '≥5/7',
      met: exerciseDays >= 5,
    },
    self_initiation_ratio: {
      value: initiation.ratio,
      display: `${Math.round(initiation.ratio * 100)}% (${initiation.self_initiated}/${initiation.total})`,
      target: 'Trending up',
      trend: 'needs_more_data',
    },
    laura_friction: {
      value: frictionTrend.latest,
      display: frictionTrend.latest ? `${frictionTrend.latest}/5` : 'Not collected',
      target: '≤2.5, trending down',
      trend: frictionTrend.trend,
    },

    // Supporting metrics
    full_access_days: pillarDaysFull,
    lockout_nights: lockoutNights,
    big_thing_rate: `${bigThingDays}/5`,
    crash_days: crashDays,
    captain_days: captainDays,
    honey_do_days: honeyDoDays,

    // Streaks
    streaks: {
      daily_exercise: updatedStreaks.daily_exercise,
      four_four: updatedStreaks.four_four,
      weekly_above_threshold: updatedStreaks.weekly_above_threshold,
    },

    // Financial stake
    stake: stakeResult,

    // Escalation level
    escalation_level: escalationLevel,

    // Energy
    energy_pattern: energyPattern,
  };

  // ── Generate James's scorecard message ──
  const jamesMessage = [
    `📊 Week of ${scorecard.week_start}`,
    '',
    `Pillars: ${scorecard.pillar_completion_rate.display} ${scorecard.pillar_completion_rate.met ? '✅' : '⚠️'} target: ≥60%`,
    `Exercise: ${scorecard.exercise_rate.display} ${scorecard.exercise_rate.met ? '✅' : '⚠️'}`,
    `Lockout nights: ${lockoutNights} ${lockoutNights <= 2 ? '✅' : '⚠️'} target: ≤2`,
    '',
    `🎯 Big Things: ${scorecard.big_thing_rate}`,
    `📥 Self-initiation: ${scorecard.self_initiation_ratio.display}`,
    `🐕 Captain: ${captainDays}/7`,
    `💍 Honey-Do: ${honeyDoDays}/5`,
    '',
    `🔥 Streaks: Exercise ${updatedStreaks.daily_exercise} days | 4/4: ${updatedStreaks.four_four} days | Weeks above target: ${updatedStreaks.weekly_above_threshold}`,
    '',
    stakeResult.message || '',
    '',
    "Laura's friction check coming up — I'll ask her shortly.",
  ].filter(l => l !== undefined).join('\n');

  // ── Generate Laura's scorecard ──
  const lauraScorecard = social.generateLauraScorecard({
    pillar_days_full: pillarDaysFull,
    exercise_days: exerciseDays,
    captain_days: captainDays,
    honey_do_days: honeyDoDays,
    big_thing_days: bigThingDays,
  });

  // ── Generate buddy scorecard ──
  const buddyScorecard = social.generateBuddyScorecard({
    pillar_rate: pillarRate.rate,
    weekly_streak: updatedStreaks.weekly_above_threshold,
    exercise_days: exerciseDays,
  });

  // ── Write scorecard to state ──
  const stateDir = path.join(SKILL_ROOT, 'state');
  fs.writeFileSync(path.join(stateDir, 'weekly_scorecard.json'), JSON.stringify(scorecard, null, 2));

  console.log(JSON.stringify({
    status: 'ok',
    scorecard,
    messages: {
      james: jamesMessage,
      laura: lauraScorecard,
      buddy: buddyScorecard,
    },
    escalation_level: escalationLevel,
  }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ status: 'error', error: err.message }));
  process.exit(1);
});
