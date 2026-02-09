#!/usr/bin/env node
// scripts/decide.mjs — Coaching decision engine for PiaB v3
// Reads signals from observe.mjs, determines what coaching actions to take.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT, loadHousehold, loadPlaybook } from './lib/yaml-loader.mjs';
import ledger from './lib/ledger.mjs';
import templates from './lib/templates.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const PERSON = process.argv.find(a => a.startsWith('--person='))?.split('=')[1] || null;
const MODE = process.argv.find(a => a.startsWith('--mode='))?.split('=')[1] || 'auto';

function readState(filename) {
  const filePath = path.join(SKILL_ROOT, 'state', filename);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
  const people = PERSON ? [PERSON] : ['james', 'laura'];
  const decisions = [];
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0=Sun, 6=Sat

  for (const person of people) {
    const sig = signals[person];
    if (!sig) continue;

    const profile = household.people[person];
    const adhd = profile?.adhd_profile;

    // ── Quiet hours check ──
    const quietStart = parseInt(playbook.communication?.quiet_hours?.start) || 21;
    const quietEnd = parseInt(playbook.communication?.quiet_hours?.end) || 6;
    if (hour >= quietStart || hour < quietEnd) {
      decisions.push({ person, action: 'skip', reason: 'quiet_hours' });
      continue;
    }

    // ── Backoff check ──
    if (sig.backed_off) {
      decisions.push({ person, action: 'skip', reason: 'backed_off', interventions: sig.interventions_today });
      continue;
    }

    // ── Mode-specific decisions ──

    if (MODE === 'morning' || (MODE === 'auto' && hour >= 6 && hour < 8)) {
      const briefing = templates.formatMorningBriefing(person, signals, context || { people: {} });
      if (briefing) {
        decisions.push({
          person,
          action: 'send_message',
          type: 'morning_briefing',
          channel: profile?.channels?.primary || 'whatsapp',
          message: briefing,
        });
      }
    }

    if (MODE === 'midday' || (MODE === 'auto' && hour >= 11 && hour < 13)) {
      if (sig.completions_today === 0 && !sig.backed_off) {
        const nudge = templates.formatNudge(person, signals, 'midday');
        if (nudge) {
          decisions.push({
            person,
            action: 'send_message',
            type: 'midday_check',
            channel: profile?.channels?.primary || 'whatsapp',
            message: nudge,
          });
        }
      }
    }

    if (MODE === 'afternoon' || (MODE === 'auto' && hour >= 14 && hour < 16)) {
      if (sig.completions_today < 2 && hour < (adhd?.fade_after || 14) && !sig.backed_off) {
        const nudge = templates.formatNudge(person, signals, 'afternoon');
        if (nudge) {
          decisions.push({
            person,
            action: 'send_message',
            type: 'afternoon_nudge',
            channel: profile?.channels?.primary || 'whatsapp',
            message: nudge,
          });
        }
      }
    }

    if (MODE === 'evening' || (MODE === 'auto' && hour >= 19 && hour < 21)) {
      // Evening close is shared — only generate once
      if (person === people[0]) {
        const close = templates.formatEveningClose(signals, context || { people: {} });
        if (close) {
          decisions.push({
            person: 'shared',
            action: 'send_message',
            type: 'evening_close',
            channel: 'whatsapp',
            message: close,
          });
        }
      }
    }

    // ── Failure mode interventions (any time during active hours) ──
    if (MODE === 'auto' || MODE === 'intervene') {
      const fm = sig.failure_modes;

      // Task paralysis — highest priority intervention
      if (fm.task_paralysis && sig.interventions_today < 3) {
        const top = sig.top_3_by_score[0];
        const name = profile?.full_name?.split(' ')[0] || person;
        decisions.push({
          person,
          action: 'send_message',
          type: 'paralysis_intervention',
          channel: profile?.channels?.primary || 'whatsapp',
          message: `${name}, lots going on. Let's simplify.\n\nJust one thing: **${top?.title || 'your top task'}**\n\nFirst micro-step: open it up and spend 5 minutes. That's it.`,
          priority: 'high',
        });
      }

      // Time blindness — calendar-aware nudge
      if (fm.time_blindness) {
        decisions.push({
          person,
          action: 'check_calendar_proximity',
          type: 'time_blindness_alert',
          note: 'Next event within 2 hours — send reminder',
        });
      }

      // Escalation items — proactive coaching
      if (sig.escalation_items.length > 0 && sig.interventions_today < 2) {
        const alreadyNudged = ledger.countToday('coach_ledger', e =>
          e.person === person && e.type === 'escalation_nudge'
        );
        if (alreadyNudged === 0) {
          const item = sig.escalation_items[0];
          const name = profile?.full_name?.split(' ')[0] || person;
          decisions.push({
            person,
            action: 'send_message',
            type: 'escalation_nudge',
            channel: profile?.channels?.primary || 'whatsapp',
            message: `Hey ${name}, "${item}" has been waiting. What's the blocker?\n\nI can help break it down, schedule time, or we can defer it.`,
          });
        }
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
