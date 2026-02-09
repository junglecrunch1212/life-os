#!/usr/bin/env node
// scripts/learn.mjs — Learning engine for PiaB v3
// Analyzes coaching patterns, response rates, and behavioral data to improve over time.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT, loadHousehold } from './lib/yaml-loader.mjs';
import ledger from './lib/ledger.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const household = loadHousehold();
  const people = ['james', 'laura'];
  const learnings = { computed_at: new Date().toISOString(), people: {} };

  for (const person of people) {
    // ── Analyze coaching effectiveness ──
    const coachEvents = ledger.read('coach_ledger', 10000, e => e.person === person);
    const captureEvents = ledger.read('capture_ledger', 10000, e => e.person === person);

    // Response rate: messages sent vs responses received within 2 hours
    const outbound = coachEvents.filter(e => e.type === 'outbound_message');
    const inbound = captureEvents.filter(e => e.type === 'task_capture' || e.type === 'task_complete');

    let responsesWithin2h = 0;
    for (const out of outbound) {
      const outTime = new Date(out.ts).getTime();
      const hasResponse = inbound.some(inp => {
        const inTime = new Date(inp.ts).getTime();
        return inTime > outTime && inTime < outTime + 7200000;
      });
      if (hasResponse) responsesWithin2h++;
    }

    const responseRate = outbound.length > 0 ? responsesWithin2h / outbound.length : 0;

    // ── Completion patterns ──
    const completions = captureEvents.filter(e => e.type === 'task_complete');
    const completionsByHour = {};
    for (const c of completions) {
      const hour = new Date(c.ts).getHours();
      completionsByHour[hour] = (completionsByHour[hour] || 0) + 1;
    }

    // Find peak productivity hours
    const peakHours = Object.entries(completionsByHour)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([h]) => parseInt(h));

    // ── Message type effectiveness ──
    const messageTypes = {};
    for (const out of outbound) {
      const type = out.message_type || 'unknown';
      if (!messageTypes[type]) messageTypes[type] = { sent: 0, responded: 0 };
      messageTypes[type].sent++;

      const outTime = new Date(out.ts).getTime();
      const hasResponse = inbound.some(inp => {
        const inTime = new Date(inp.ts).getTime();
        return inTime > outTime && inTime < outTime + 7200000;
      });
      if (hasResponse) messageTypes[type].responded++;
    }

    // ── Streak analysis ──
    const completionDates = completions.map(c => new Date(c.ts).toISOString().split('T')[0]);
    const uniqueDates = [...new Set(completionDates)].sort();
    let longestStreak = 0;
    let currentStreak = 0;
    for (let i = 0; i < uniqueDates.length; i++) {
      if (i === 0) { currentStreak = 1; continue; }
      const prev = new Date(uniqueDates[i - 1]);
      const curr = new Date(uniqueDates[i]);
      const diffDays = (curr - prev) / 86400000;
      if (diffDays === 1) {
        currentStreak++;
      } else {
        longestStreak = Math.max(longestStreak, currentStreak);
        currentStreak = 1;
      }
    }
    longestStreak = Math.max(longestStreak, currentStreak);

    // ── Domain avoidance detection ──
    const domainCompletions = {};
    for (const c of completions) {
      const domain = c.domain || 'unknown';
      domainCompletions[domain] = (domainCompletions[domain] || 0) + 1;
    }
    const profile = household.people[person]?.adhd_profile;
    const avoidanceDomains = profile?.avoidance_domains || [];
    const avoidanceAnalysis = avoidanceDomains.map(d => ({
      domain: d,
      completions_30d: domainCompletions[d] || 0,
      status: (domainCompletions[d] || 0) < 2 ? 'avoided' : 'engaged',
    }));

    learnings.people[person] = {
      response_rate: Math.round(responseRate * 100),
      total_outbound: outbound.length,
      total_completions: completions.length,
      peak_hours: peakHours,
      message_effectiveness: Object.fromEntries(
        Object.entries(messageTypes).map(([type, data]) => [
          type,
          { sent: data.sent, response_rate: data.sent > 0 ? Math.round((data.responded / data.sent) * 100) : 0 },
        ])
      ),
      longest_streak: longestStreak,
      avoidance_analysis: avoidanceAnalysis,
      recommendations: generateRecommendations(person, {
        responseRate, peakHours, messageTypes, avoidanceAnalysis, profile,
      }),
    };
  }

  // Write learnings
  const stateDir = path.join(SKILL_ROOT, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(stateDir, 'learnings.json'), JSON.stringify(learnings, null, 2));

  console.log(JSON.stringify(learnings, null, 2));
}

function generateRecommendations(person, data) {
  const recs = [];

  if (data.responseRate < 0.3) {
    recs.push({
      type: 'reduce_frequency',
      reason: `${person} response rate is ${Math.round(data.responseRate * 100)}%. Consider fewer, more targeted messages.`,
    });
  }

  if (data.peakHours.length > 0) {
    const bestHour = data.peakHours[0];
    const currentBest = data.profile?.best_hours?.[0];
    if (currentBest && Math.abs(bestHour - currentBest) > 2) {
      recs.push({
        type: 'adjust_timing',
        reason: `Actual peak productivity at ${bestHour}:00, but profile says ${currentBest}:00. Consider adjusting briefing time.`,
      });
    }
  }

  // Find most effective message type
  const bestType = Object.entries(data.messageTypes)
    .filter(([_, d]) => d.sent >= 3)
    .sort((a, b) => (b[1].responded / b[1].sent) - (a[1].responded / a[1].sent))[0];
  if (bestType) {
    recs.push({
      type: 'message_preference',
      reason: `${bestType[0]} messages have the highest response rate. Lean into this style.`,
    });
  }

  for (const av of data.avoidanceAnalysis) {
    if (av.status === 'avoided') {
      recs.push({
        type: 'avoidance_intervention',
        reason: `${av.domain} domain has ${av.completions_30d} completions in 30 days. Needs gentle pairing approach.`,
      });
    }
  }

  return recs;
}

main().catch(err => {
  console.error(JSON.stringify({ status: 'error', error: err.message }));
  process.exit(1);
});
