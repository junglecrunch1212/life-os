#!/usr/bin/env node
// scripts/observe.mjs — Compute behavioral signals from actual Life OS + Financial OS data
// Now includes gate state, pillar status, streak data, and social accountability signals.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT, loadHousehold, loadYaml } from './lib/yaml-loader.mjs';
import sheets from './lib/sheets.mjs';
import calendar from './lib/calendar.mjs';
import budget from './lib/budget.mjs';
import ledger from './lib/ledger.mjs';
import gate from './lib/gate.mjs';
import pillars from './lib/pillars.mjs';
import reinforcement from './lib/reinforcement.mjs';
import social from './lib/social.mjs';
import bodyDouble from './lib/body-double.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const household = loadHousehold();
  const people = ['james', 'laura']; // active coaching targets
  const signals = {};
  const context = { computed_at: new Date().toISOString(), people: {} };

  // ── Gate state ──
  const gateState = gate.getGateSummary();
  const pillarStatus = pillars.getPillarStatus();
  const pillarRate = pillars.getPillarRate(5);
  const streaks = reinforcement.getCurrentStreaks();
  const frictionTrend = social.getFrictionTrend(4);
  const selfInitiation = bodyDouble.getSelfInitiationRatio('james', 7);

  context.gate = gateState;
  context.pillar_status = pillarStatus;
  context.pillar_rate = pillarRate;
  context.streaks = streaks;
  context.friction = frictionTrend;
  context.self_initiation = selfInitiation;

  // ── Read from actual Life OS ──
  let allItems = [];
  if (!DRY_RUN) {
    allItems = sheets.getActiveItems(); // reads _MASTER_LOG, filters active statuses
  }

  // ── Read projects ──
  let projects = [];
  if (!DRY_RUN) {
    const projRaw = sheets.readProjects();
    if (projRaw.success) {
      const rows = (projRaw.data?.values || []).slice(1);
      projects = rows.filter(r => r[4] === 'active').map(r => ({
        id: r[0], name: r[1], domain: r[2], owner: r[3],
        target_date: r[7], notes: r[10],
      }));
    }
  }

  // ── Read routines ──
  let routines = [];
  if (!DRY_RUN) {
    const routRaw = sheets.readRoutines();
    if (routRaw.success) {
      const rows = (routRaw.data?.values || []).slice(1);
      routines = rows.filter(r => r[13] === 'active').map(r => ({
        id: r[0], title: r[1], domain: r[2], owner: r[4],
        cadence: r[5], last_completed: r[9], next_due: r[10],
      }));
    }
  }

  // ── Read escalation queue ──
  let escalationItems = [];
  if (!DRY_RUN) {
    const escRaw = sheets.readEscalationQueue();
    if (escRaw.success) {
      const rows = (escRaw.data?.values || []).slice(1);
      escalationItems = rows.filter(r => r[0]).map(r => ({
        title: r[0], owner: r[1], priority: r[2],
        commitment: r[3], days_stagnant: parseInt(r[4]) || 0,
      }));
    }
  }

  // ── Read gamification ──
  let gamePlayers = {};
  let gameQuests = [];
  let gameBosses = [];
  if (!DRY_RUN) {
    const gpRaw = sheets.readGamePlayers();
    if (gpRaw.success) {
      const rows = (gpRaw.data?.values || []).slice(1);
      for (const r of rows) {
        gamePlayers[r[1]?.toLowerCase()] = {
          player_id: r[0], level: parseInt(r[3]) || 1,
          total_xp: parseInt(r[4]) || 0, xp_to_next: parseInt(r[5]) || 1000,
          gold: parseInt(r[6]) || 0, streak_current: parseInt(r[8]) || 0,
          streak_best: parseInt(r[9]) || 0, streak_last_date: r[10],
          weekly_xp: parseInt(r[13]) || 0, tasks_completed: parseInt(r[14]) || 0,
        };
      }
    }
    const gqRaw = sheets.readGameQuests();
    if (gqRaw.success) {
      gameQuests = (gqRaw.data?.values || []).slice(1).filter(r => r[9] === 'active');
    }
    const gbRaw = sheets.readGameBosses();
    if (gbRaw.success) {
      gameBosses = (gbRaw.data?.values || []).slice(1).filter(r => r[8] === 'active');
    }
  }

  // ── Money pulse ──
  let moneyPulse = { status: 'unknown' };
  if (!DRY_RUN) {
    moneyPulse = budget.getMoneyPulse();
  }

  // ── Calendar ──
  let todayEvents = [];
  if (!DRY_RUN) {
    const cal = calendar.getToday();
    todayEvents = cal.success ? (cal.data?.items || []) : [];
  }

  const ownerMap = household.household?.owner_map || {};
  const now = Date.now();

  for (const person of people) {
    // Filter items for this person
    const personItems = allItems.filter(item => {
      const mapped = ownerMap[item.owner] || item.owner?.toLowerCase();
      return mapped === person || mapped === 'shared';
    });

    const activeItems = personItems.filter(i => ['next', 'scheduled', 'waiting', 'inbox'].includes(i.status));
    const todayCompletions = DRY_RUN ? [] : sheets.getTodayCompletions(person);
    const staleTasks = personItems.filter(i => i.is_stagnant).map(i => i.item_id);
    const overdueItems = personItems.filter(i => i.is_overdue).map(i => ({ id: i.item_id, title: i.title }));
    const escalation = escalationItems.filter(e => (ownerMap[e.owner] || e.owner?.toLowerCase()) === person);
    const top3 = DRY_RUN ? [] : sheets.getTopByScore(person, 3);

    // Overdue routines
    const today = new Date().toISOString().split('T')[0];
    const overdueRoutines = routines.filter(r => {
      const mapped = ownerMap[r.owner] || r.owner?.toLowerCase();
      return (mapped === person || mapped === 'shared') && r.next_due && r.next_due < today;
    });

    // Project health
    const personProjects = {};
    for (const proj of projects) {
      const mapped = ownerMap[proj.owner] || proj.owner?.toLowerCase();
      if (mapped !== person && mapped !== 'shared') continue;
      const projItems = allItems.filter(i => i.project_id === proj.id);
      const done = projItems.filter(i => i.status === 'done').length;
      const open = projItems.filter(i => i.status !== 'done' && i.status !== 'cancelled').length;
      const health = proj.target_date && new Date(proj.target_date) < new Date(Date.now() + 30 * 86400000) && open > done ? 'at_risk' : 'on_track';
      personProjects[proj.id] = { name: proj.name, tasks_done: done, tasks_open: open, health };
    }

    // Engagement signals
    const lastInbound = ledger.readLast('capture_ledger', 1, e => e.person === person);
    const interventionsToday = ledger.countToday('coach_ledger', e => e.person === person && e.type === 'outbound_message');
    const lastResponseMinutes = lastInbound.length > 0
      ? (now - new Date(lastInbound[0].ts).getTime()) / 60000 : Infinity;

    // Failure mode detection
    const profile = household.people[person]?.adhd_profile;
    const failureModes = {
      initiation_failure: staleTasks.length > 0,
      time_blindness: false,
      task_paralysis: activeItems.length >= (profile?.paralysis_threshold || 5) && todayCompletions.length === 0,
      avoidance: false,
      hyperfocus_trap: false,
    };

    // Time blindness check from calendar
    if (todayEvents.length > 0) {
      const nextStart = todayEvents
        .map(e => new Date(e.start?.dateTime || e.start?.date))
        .filter(d => d > new Date())
        .sort((a, b) => a - b)[0];
      if (nextStart && (nextStart.getTime() - now) < 7200000) {
        failureModes.time_blindness = true;
      }
    }

    // Gamification
    const gp = gamePlayers[person] || { level: 1, total_xp: 0, xp_to_next: 1000, streak_current: 0, streak_best: 0 };

    signals[person] = {
      active_tasks: activeItems.length,
      completions_today: todayCompletions.length,
      streak_days: gp.streak_current,
      stale_tasks: staleTasks,
      overdue_tasks: overdueItems,
      escalation_items: escalation.map(e => e.title),
      top_3_by_score: top3.map(t => ({
        id: t.item_id, title: t.title, score: t.score_now,
        domain: t.domain, effort: t.effort_minutes,
      })),
      last_response_minutes_ago: Math.round(lastResponseMinutes),
      failure_modes: failureModes,
      interventions_today: interventionsToday,
      backed_off: interventionsToday >= 5,
      projects: personProjects,
      overdue_routines: overdueRoutines.map(r => r.title),
      gamification: {
        level: gp.level, xp: gp.total_xp, xp_to_next: gp.xp_to_next,
        streak_current: gp.streak_current, streak_best: gp.streak_best,
        active_quests: gameQuests.map(q => q[2]),
      },
    };

    context.people[person] = {
      priorities: top3.map(t => ({ id: t.item_id, task: t.title, domain: t.domain, est_minutes: t.effort_minutes, score: t.score_now })),
      hard_thing: top3[0]?.title || null,
      calendar_events: todayEvents.map(e => ({ summary: e.summary, start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date })),
      overdue_routines: overdueRoutines.map(r => ({ title: r.title, cadence: r.cadence, next_due: r.next_due })),
      escalation_items: escalation,
      engagement: {
        first_response: lastInbound.length > 0 ? lastInbound[0].ts : null,
        messages_today: ledger.countToday('capture_ledger', e => e.person === person),
        tasks_completed: todayCompletions.length,
      },
    };
  }

  // Assemble final output — includes gate state and behavioral coaching signals
  const signalsOut = {
    ...signals,
    money_pulse: moneyPulse.success ? moneyPulse : { status: 'unknown' },
    gate: gateState,
    pillar_rate: pillarRate,
    streaks,
    self_initiation: selfInitiation,
    laura_friction: frictionTrend,
    computed_at: new Date().toISOString(),
  };
  context.money_pulse = moneyPulse;
  context.saturday_theme = null; // populated by agent on Saturdays

  // ── Crash detection ──
  const crashSignals = {
    james: {
      zero_responses: ledger.countToday('capture_ledger', e => e.person === 'james') === 0,
      zero_pillars: gateState.pillars_done === 0,
      is_crash: false,
    },
  };
  const now_hour = new Date().getHours();
  if (crashSignals.james.zero_responses && crashSignals.james.zero_pillars && now_hour >= 13) {
    crashSignals.james.is_crash = true;
  }
  context.crash_signals = crashSignals;

  // Write state
  const stateDir = path.join(SKILL_ROOT, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'coach_signals.json'), JSON.stringify(signalsOut, null, 2));
  fs.writeFileSync(path.join(stateDir, 'daily_context.json'), JSON.stringify(context, null, 2));

  // Summary for agent
  const summary = {
    status: 'ok',
    computed_at: signalsOut.computed_at,
    gate: gateState,
    pillar_rate: `${pillarRate.full_days}/${pillarRate.total_days} (${Math.round(pillarRate.rate * 100)}%)`,
    streaks: reinforcement.getStreakDisplay(),
    crash_detected: crashSignals.james.is_crash,
    people: Object.fromEntries(people.map(p => [p, {
      active_tasks: signals[p].active_tasks,
      completions_today: signals[p].completions_today,
      streak: signals[p].streak_days,
      failure_modes_active: Object.entries(signals[p].failure_modes).filter(([_, v]) => v).map(([k]) => k),
      top_priorities: signals[p].top_3_by_score.map(t => `${t.title} (score:${t.score})`),
      overdue_routines: signals[p].overdue_routines,
      escalation_items: signals[p].escalation_items,
    }])),
    money_pulse: moneyPulse.success ? `${moneyPulse.status} — FCF: $${moneyPulse.monthly_fcf}/mo, ${moneyPulse.over_budget?.length || 0} categories over budget` : 'unavailable',
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ status: 'error', error: err.message, stack: err.stack }));
  process.exit(1);
});
