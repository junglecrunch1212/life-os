// scripts/lib/templates.mjs — Message template engine for PiaB v3

import { loadHousehold, loadPlaybook } from './yaml-loader.mjs';

export function renderTemplate(templateStr, vars) {
  let result = templateStr;
  for (const [key, value] of Object.entries(vars)) {
    const pattern = new RegExp(`\\{${key}\\}`, 'g');
    result = result.replace(pattern, value ?? '');
  }
  // Remove unreplaced variables
  result = result.replace(/\{[a-z_]+\}/g, '');
  // Clean up empty lines
  result = result.split('\n').filter(line => line.trim() !== '').join('\n');
  return result.trim();
}

export function formatMorningBriefing(person, signals, context) {
  const household = loadHousehold();
  const playbook = loadPlaybook();
  const profile = household.people[person];
  const personSignals = signals[person];
  const personContext = context.people[person];

  if (!personSignals || !personContext) return null;

  const name = profile?.full_name?.split(' ')[0] || person;
  const top = personSignals.top_3_by_score[0];
  const game = personSignals.gamification || {};

  const isSaturday = new Date().getDay() === 6;
  let saturdayTheme = '';
  if (isSaturday && context.saturday_theme) {
    saturdayTheme = `This Saturday's theme: **${context.saturday_theme}**\n`;
  }

  let overdueSection = '';
  if (personSignals.overdue_routines.length > 0) {
    overdueSection = `\nOverdue routines: ${personSignals.overdue_routines.join(', ')}`;
  }

  let escalationSection = '';
  if (personSignals.escalation_items.length > 0) {
    escalationSection = `\nNeeds attention: ${personSignals.escalation_items[0]}`;
  }

  let moneySection = '';
  if (signals.money_pulse?.status === 'red' || signals.money_pulse?.status === 'yellow') {
    const overCount = signals.money_pulse.over_budget?.length || 0;
    moneySection = `\nMoney pulse: ${signals.money_pulse.status} — ${overCount} categories over budget`;
  }

  const hardThing = top ? top.title : 'Check your task list';
  const microStep = top ? getMicroStep(top) : '';

  return [
    `Good morning ${name}!`,
    saturdayTheme,
    `Your #1 today: **${hardThing}**`,
    microStep ? `First step: ${microStep}` : '',
    '',
    `Streak: ${game.streak_current || 0} days | Level ${game.level || 1} | ${game.xp || 0}/${game.xp_to_next || 1000} XP`,
    overdueSection,
    escalationSection,
    moneySection,
    '',
    'Ready to knock it out? Just say "start" and I\'ll set a 25-min timer.',
  ].filter(line => line !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function formatEveningClose(signals, context) {
  const household = loadHousehold();
  const jamesSignals = signals.james;
  const lauraSignals = signals.laura;

  const jamesCompletions = jamesSignals?.completions_today || 0;
  const lauraCompletions = lauraSignals?.completions_today || 0;

  const jamesGame = jamesSignals?.gamification || {};
  const lauraGame = lauraSignals?.gamification || {};

  const isFriday = new Date().getDay() === 5;
  let weekendPreview = '';
  if (isFriday) {
    weekendPreview = '\nWeekend incoming! Check in tomorrow for your Saturday theme.';
  }

  return [
    'Evening wrap-up, Stice family!',
    '',
    "Today's score:",
    `- James: ${jamesCompletions} tasks | Level ${jamesGame.level || 1}`,
    `- Laura: ${lauraCompletions} tasks | Level ${lauraGame.level || 1}`,
    '',
    "Tomorrow's top priorities:",
    `- James: ${context.people?.james?.priorities?.[0]?.task || 'TBD'}`,
    `- Laura: ${context.people?.laura?.priorities?.[0]?.task || 'TBD'}`,
    weekendPreview,
    '',
    'Rest well!',
  ].join('\n').trim();
}

export function formatNudge(person, signals, type = 'midday') {
  const household = loadHousehold();
  const profile = household.people[person];
  const name = profile?.full_name?.split(' ')[0] || person;
  const personSignals = signals[person];

  if (!personSignals || personSignals.backed_off) return null;

  const top = personSignals.top_3_by_score[0];
  const completions = personSignals.completions_today;

  if (type === 'midday') {
    if (completions > 0) {
      return `Nice, ${name}! ${completions} done already. Next up: **${top?.title || 'check your list'}**`;
    }
    return [
      `Hey ${name} — quick check-in. How's the morning going?`,
      '',
      'Want me to:',
      `- Break down **${top?.title || 'your top task'}** into smaller steps?`,
      '- Swap to something with quick momentum?',
      "- Just hold space — you've got this.",
    ].join('\n');
  }

  if (type === 'afternoon') {
    const easiest = personSignals.top_3_by_score
      .sort((a, b) => (a.effort || 30) - (b.effort || 30))[0];
    return [
      `Afternoon ${name}. You've still got good hours left.`,
      '',
      top ? `Priority: **${top.title}**` : '',
      easiest && easiest !== top ? `Quick win: **${easiest.title}** (~${easiest.effort}min)` : '',
    ].filter(Boolean).join('\n');
  }

  return null;
}

function getMicroStep(task) {
  const effort = task.effort || 30;
  if (effort <= 5) return 'This is a quick one — knock it out!';
  if (effort <= 15) return 'Start with the first 5 minutes. Just open it up.';
  if (effort <= 30) return 'Break it into two 15-minute chunks. Start with chunk one.';
  return 'Big one. Just do the first step — even 5 minutes counts.';
}

export function formatTaskCompletion(person, task, xpEarned, newStreak) {
  const household = loadHousehold();
  const name = household.people[person]?.full_name?.split(' ')[0] || person;
  const style = household.people[person]?.preferences?.acknowledgment_style || 'brief';

  if (style === 'warm') {
    return `Great work, ${name}! **${task.title}** is done. +${xpEarned} XP${newStreak > 1 ? ` | Streak: ${newStreak} days!` : ''}`;
  }
  return `Done: **${task.title}** +${xpEarned} XP${newStreak > 1 ? ` | ${newStreak}-day streak` : ''}`;
}

export default {
  renderTemplate, formatMorningBriefing, formatEveningClose,
  formatNudge, formatTaskCompletion,
};
