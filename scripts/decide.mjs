#!/usr/bin/env node
// scripts/decide.mjs — Coaching decision engine for PiaB v3
// Gate-aware: respects LOCKED states, fires briefing on TIER_1 transition,
// applies crash detection, escalation ladder, and behavioral interventions.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT, loadHousehold, loadPlaybook, loadYaml } from './lib/yaml-loader.mjs';
import ledger from './lib/ledger.mjs';
import templates from './lib/templates.mjs';
import gate from './lib/gate.mjs';
import pillars from './lib/pillars.mjs';
import intentions from './lib/intentions.mjs';
import reinforcement from './lib/reinforcement.mjs';
import social from './lib/social.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const PERSON = process.argv.find(a => a.startsWith('--person='))?.split('=')[1] || null;
const MODE = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'auto';

function readState(filename) {
  const filePath = path.join(SKILL_ROOT, 'state', filename);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function loadConfig() {
  try { return loadYaml('state/config.yaml'); } catch { return {}; }
}

async function main() {
  const signals = readState('coach_signals.json');
  const context = readState('daily_context.json');

  if (!signals) {
    console.log(JSON.stringify({ status: 'error', error: 'No signals found. Run observe.mjs first.' }));
    process.exit(1);
  }

  const household = loadHousehold();
  const playbook = loadPlaybook();
  const config = loadConfig();
  const gateState = gate.getGateStatus();
  const decisions = [];
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat

  // ── Gate-level decisions (James only — Laura doesn't have the gate) ──
  const jamesProfile = household.people.james;

  // ── Check if we're in a crash state ──
  const crashDetected = context?.crash_signals?.james?.is_crash;
  if (crashDetected) {
    // Silence IS the intervention during crash. Do NOT nudge.
    decisions.push({
      person: 'james',
      action: 'silence',
      type: 'crash_detected',
      reason: 'Zero pillars + zero responses past 1pm. Silence is the correct coaching decision.',
    });

    // Check if Laura escalation should fire
    if (social.shouldEscalateToLaura(gateState)) {
      decisions.push({
        person: 'laura',
        action: 'send_message',
        type: 'laura_escalation',
        channel: 'whatsapp',
        message: social.getLauraEscalationMessage(),
      });
    }
  }

  // ── Gate state determines what coaching is possible ──
  const isLocked = gateState.status === 'LOCKED_MORNING' || gateState.status === 'LOCKED_NIGHT';

  // ══════════════════════════════════
  // MORNING BRIEFING — fires on TIER_1 transition, NOT on clock
  // ══════════════════════════════════
  if (MODE === 'morning' || MODE === 'on_tier1') {
    if (!isLocked && !crashDetected) {
      // Get implementation intention readback
      const intentionReadback = intentions.getMorningReadback();
      const remaining = pillars.getRemainingPillars();
      const streakDisplay = reinforcement.getStreakDisplay();
      const sig = signals.james;
      const top = sig?.top_3_by_score?.[0];

      // Should we include a values connection? (~30% of the time)
      let valuesLine = '';
      const valuesFreq = config.coaching?.values_connection_frequency || 0.30;
      if (Math.random() < valuesFreq && top) {
        const pillarConfig = config.gate?.pillars;
        const nextPillar = remaining[0];
        if (nextPillar && pillarConfig?.[nextPillar.key]?.values_connection) {
          valuesLine = pillarConfig[nextPillar.key].values_connection;
        }
      }

      const briefingParts = [
        intentionReadback || '',
        '',
        `🔓 Unlocked. ${gateState.pillars_done > 0 ? 'Good work on ' + pillars.getCompletedPillars().map(p => p.key).join(', ') + '.' : ''}`,
        '',
        top ? `🎯 Big Thing: ${top.title}${top.domain ? ` (${top.domain})` : ''}` : '',
        ...(sig?.top_3_by_score?.slice(1, 3) || []).map(t => `📋 ${t.title}`),
        '',
        remaining.length > 0
          ? remaining.map(p => `${p.key === 'captain' ? '🐕' : p.key === 'clean' ? '🏠' : p.key === 'honey_do' ? '💍' : '🏃'} ${p.description}: not yet`).join(' | ')
          : '✅ All pillars done!',
        '',
        // Henry schedule from calendar
        ...(context?.people?.james?.calendar_events || [])
          .filter(e => /henry|school|pickup/i.test(e.summary || ''))
          .map(e => `👦 ${e.summary}: ${e.start?.split('T')[1]?.slice(0, 5) || e.start}`),
        '',
        `🔥 ${streakDisplay}`,
        valuesLine ? `\n${valuesLine}` : '',
      ].filter(l => l !== undefined);

      decisions.push({
        person: 'james',
        action: 'send_message',
        type: 'morning_briefing',
        channel: jamesProfile?.channels?.primary || 'whatsapp',
        message: briefingParts.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
      });
    }
  }

  // ══════════════════════════════════
  // MIDDAY CHECK-IN (1 PM)
  // ══════════════════════════════════
  if ((MODE === 'midday' || (MODE === 'auto' && hour >= 12 && hour < 14)) && !crashDetected) {
    const sig = signals.james;
    if (sig && !isLocked) {
      const responseRate = ledger.countToday('capture_ledger', e => e.person === 'james');

      // Prerequisites: response rate > 40%, not crash, 3+ hours since morning
      if (responseRate > 0) {
        const top = sig.top_3_by_score?.[0];
        if (sig.completions_today > 0) {
          decisions.push({
            person: 'james',
            action: 'send_message',
            type: 'midday_checkin',
            channel: 'whatsapp',
            message: `Big Thing ${top ? 'status: **' + top.title + '**. ' : ''}${sig.completions_today} done so far. Remaining pillars: ${pillars.getRemainingPillars().map(p => p.key).join(', ') || 'all done!'}.`,
          });
        } else {
          decisions.push({
            person: 'james',
            action: 'send_message',
            type: 'midday_checkin',
            channel: 'whatsapp',
            message: `Big Thing still open${top ? ': **' + top.title + '**' : ''}. Want to break it into a smaller step?`,
          });
        }
      }
      // If responseRate is 0 → silence (crash behavior)
    }
  }

  // ══════════════════════════════════
  // EVENING CLOSE (7:30 PM)
  // ══════════════════════════════════
  if (MODE === 'evening' || (MODE === 'auto' && hour >= 19 && hour < 21)) {
    const sig = signals.james;
    if (sig) {
      const top3Tomorrow = sig.top_3_by_score?.slice(0, 3) || [];

      const eveningParts = [
        'Evening check:',
        '1. Big Thing done? Y / partial / N',
        '2. Real time with Henry today? Y / N',
        '3. Energy right now? 1-5',
        '',
        "Tomorrow's lineup:",
        ...top3Tomorrow.map((t, i) => `${i === 0 ? '🎯' : '📋'} ${t.title}`),
        '',
        intentions.getEveningIntentionPrompt(),
      ];

      decisions.push({
        person: 'james',
        action: 'send_message',
        type: 'evening_close',
        channel: 'whatsapp',
        message: eveningParts.join('\n'),
      });
    }

    // Laura evening close (simpler)
    const lauraSig = signals.laura;
    if (lauraSig) {
      decisions.push({
        person: 'laura',
        action: 'send_message',
        type: 'evening_close',
        channel: household.people.laura?.channels?.primary || 'whatsapp',
        message: templates.formatEveningClose(signals, context || { people: {} }),
      });
    }
  }

  // ══════════════════════════════════
  // SUNDAY WEEKLY REVIEW
  // ══════════════════════════════════
  if (MODE === 'weekly' || (MODE === 'auto' && dayOfWeek === 0 && hour >= 17 && hour < 19)) {
    decisions.push({
      person: 'james',
      action: 'run_script',
      type: 'weekly_review',
      script: 'scripts/gate/weekly-compute.mjs',
    });

    // Ask Laura for friction score
    decisions.push({
      person: 'laura',
      action: 'send_message',
      type: 'laura_friction_prompt',
      channel: 'whatsapp',
      message: "Quick check: How stressed about household logistics this week? 1-5",
    });
  }

  // ══════════════════════════════════
  // BEHAVIORAL INTERVENTIONS (Laura — standard coaching, no gate)
  // ══════════════════════════════════
  const people = PERSON ? [PERSON] : ['laura'];
  for (const person of people) {
    if (person === 'james') continue; // James handled above with gate logic
    const sig = signals[person];
    if (!sig) continue;
    const profile = household.people[person];
    const adhd = profile?.adhd_profile;

    // Quiet hours
    const quietStart = parseInt(playbook.communication?.quiet_hours?.start) || 21;
    const quietEnd = parseInt(playbook.communication?.quiet_hours?.end) || 6;
    if (hour >= quietStart || hour < quietEnd) continue;
    if (sig.backed_off) continue;

    // Standard coaching for Laura (morning, midday, afternoon)
    if (MODE === 'morning' || (MODE === 'auto' && hour >= 6 && hour < 8)) {
      const briefing = templates.formatMorningBriefing(person, signals, context || { people: {} });
      if (briefing) {
        decisions.push({
          person, action: 'send_message', type: 'morning_briefing',
          channel: profile?.channels?.primary || 'whatsapp', message: briefing,
        });
      }
    }

    // Failure mode interventions for Laura
    if (MODE === 'auto' || MODE === 'intervene') {
      const fm = sig.failure_modes;
      if (fm.task_paralysis && sig.interventions_today < 3) {
        const top = sig.top_3_by_score[0];
        const name = profile?.full_name?.split(' ')[0] || person;
        decisions.push({
          person, action: 'send_message', type: 'paralysis_intervention',
          channel: profile?.channels?.primary || 'whatsapp',
          message: `${name}, lots on the plate today. Just one thing: **${top?.title || 'your top task'}**. First micro-step: open it up and spend 5 minutes.`,
        });
      }
    }
  }

  // ── Log decisions ──
  for (const d of decisions) {
    if (d.action === 'send_message' && !DRY_RUN) {
      ledger.append('coach_ledger', {
        type: 'outbound_message',
        person: d.person,
        message_type: d.type,
        channel: d.channel,
        message_length: d.message?.length || 0,
      });
    }
  }

  // Write decisions to state
  const stateDir = path.join(SKILL_ROOT, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'decisions.json'), JSON.stringify(decisions, null, 2));

  console.log(JSON.stringify({
    status: 'ok',
    mode: MODE,
    hour,
    gate_status: gateState.status,
    crash_detected: crashDetected,
    decisions: decisions.map(d => ({
      person: d.person,
      action: d.action,
      type: d.type,
      reason: d.reason,
    })),
  }, null, 2));
}

main().catch(err => {
  console.error(JSON.stringify({ status: 'error', error: err.message }));
  process.exit(1);
});
