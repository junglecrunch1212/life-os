// scripts/lib/gate.mjs — Earned Access Gate state machine for PiaB v3
//
// The gate operates at the MIDDLEWARE layer, not the prompt layer.
// A JavaScript if/else cannot be sweet-talked. That's the security model.
//
// State flow:
//   LOCKED_MORNING → TIER_1 → TIER_2 → TIER_3 → FULL_ACCESS → LOCKED_NIGHT
//
// Transitions are one-directional and time-gated.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT, loadYaml } from './yaml-loader.mjs';

const GATE_PATH = path.join(SKILL_ROOT, 'state', 'gate.json');
const CANNED_PATH = path.join(SKILL_ROOT, 'state', 'canned-responses.json');
const BYPASS_LOG = path.join(SKILL_ROOT, 'state', 'metrics', 'bypasses.jsonl');

function loadGateState() {
  if (!fs.existsSync(GATE_PATH)) {
    const initial = {
      status: 'LOCKED_MORNING',
      pillars_completed: [],
      pillars_remaining: ['exercise', 'captain', 'honey_do', 'clean'],
      tier_unlocked_at: null,
      current_deadline: null,
      grace_day_used_this_week: false,
      grace_day_active_today: false,
      baby_mode: false,
      last_reset: new Date().toISOString(),
      social_engineering_attempts: 0,
      last_social_engineering_attempt: null,
      bypass_active: false,
      bypass_expires: null,
      last_bypass: null,
    };
    saveGateState(initial);
    return initial;
  }
  return JSON.parse(fs.readFileSync(GATE_PATH, 'utf-8'));
}

function saveGateState(state) {
  fs.mkdirSync(path.dirname(GATE_PATH), { recursive: true });
  fs.writeFileSync(GATE_PATH, JSON.stringify(state, null, 2));
}

function loadCannedResponses() {
  if (!fs.existsSync(CANNED_PATH)) return {};
  return JSON.parse(fs.readFileSync(CANNED_PATH, 'utf-8'));
}

// Config is loaded synchronously via yaml-loader (already imported at top level)

// ═══════════════════════════════════════
// MIDDLEWARE GATE — runs BEFORE LLM processing
// ═══════════════════════════════════════

/**
 * Determines whether an inbound message should reach the LLM at all,
 * or be intercepted with a canned response.
 *
 * Returns: { allow: boolean, response?: string, reason: string }
 */
export function shouldProcess(message) {
  const state = loadGateState();
  const now = new Date();

  // Check bypass first
  if (state.bypass_active && state.bypass_expires) {
    if (now < new Date(state.bypass_expires)) {
      return { allow: true, reason: 'bypass_active' };
    }
    // Bypass expired — deactivate
    state.bypass_active = false;
    state.bypass_expires = null;
    saveGateState(state);
  }

  // ALWAYS allow pillar completion claims through
  if (isPillarClaim(message)) {
    return { allow: true, reason: 'pillar_claim' };
  }

  // ALWAYS allow emergency bypass
  if (isEmergencyBypass(message)) {
    return handleEmergencyBypass(state, message);
  }

  // In LOCKED states, block everything else
  if (state.status === 'LOCKED_MORNING') {
    return handleLockedAttempt(state, 'LOCKED_MORNING');
  }

  if (state.status === 'LOCKED_NIGHT') {
    return handleLockedAttempt(state, 'LOCKED_NIGHT');
  }

  // In FULL_ACCESS — check protect_after
  if (state.status === 'FULL_ACCESS') {
    const protectAfter = 20 * 60; // 8pm = 1200 minutes
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes >= protectAfter) {
      transitionTo(state, 'LOCKED_NIGHT');
      return handleLockedAttempt(state, 'LOCKED_NIGHT');
    }
    return { allow: true, reason: 'full_access' };
  }

  // In TIER states, allow
  if (state.status.startsWith('TIER_')) {
    return { allow: true, reason: state.status.toLowerCase() };
  }

  return { allow: false, response: getCannedResponse('default'), reason: 'unknown_state' };
}

/**
 * Check if message is a pillar completion claim.
 * Photos or pillar keywords qualify.
 */
export function isPillarClaim(message) {
  const hasPhoto = message.attachments?.some(a =>
    a.type?.startsWith('image/')
  );
  const hasPillarKeyword = /exercise|captain|walk(?:ed)?|dog|honey.?do|clean(?:ed)?|tidy|tidied|sweep|mop|vacuum|dishes|laundry|run|workout|cardio|gym|ran|jog|lift|swim|fix|repair|pillar/i.test(
    message.text || ''
  );
  return hasPhoto || hasPillarKeyword;
}

/**
 * Check if message is the emergency bypass phrase.
 */
export function isEmergencyBypass(message) {
  return /^EMERGENCY BYPASS$/i.test((message.text || '').trim());
}

function handleLockedAttempt(state, lockType) {
  state.social_engineering_attempts++;
  state.last_social_engineering_attempt = new Date().toISOString();
  saveGateState(state);

  const attempts = state.social_engineering_attempts;
  let response;

  if (attempts === 1) {
    response = getCannedResponse('social_engineering_1');
  } else if (attempts === 2) {
    response = getCannedResponse('social_engineering_2');
  } else if (attempts === 3) {
    response = getCannedResponse('social_engineering_3');
  } else {
    response = getCannedResponse('social_engineering_4_plus');
    // Empty string = no response at all for 15 minutes
  }

  // Fall back to lock-type response on first real attempt
  if (attempts <= 1) {
    response = getCannedResponse(lockType);
  }

  return { allow: false, response, reason: `locked_attempt_${attempts}` };
}

function handleEmergencyBypass(state, message) {
  const now = new Date();

  // Check cooldown
  if (state.last_bypass) {
    const hoursSince = (now.getTime() - new Date(state.last_bypass).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 72) {
      const remaining = Math.ceil(72 - hoursSince);
      const response = getCannedResponse('bypass_cooldown')
        .replace('{hours_remaining}', String(remaining));
      return { allow: false, response, reason: 'bypass_cooldown' };
    }
  }

  // Activate bypass
  const durationHours = 2;
  state.bypass_active = true;
  state.bypass_expires = new Date(now.getTime() + durationHours * 3600000).toISOString();
  state.last_bypass = now.toISOString();
  saveGateState(state);

  // Log bypass
  fs.mkdirSync(path.dirname(BYPASS_LOG), { recursive: true });
  fs.appendFileSync(BYPASS_LOG, JSON.stringify({
    timestamp: now.toISOString(),
    reason: 'user_requested',
    duration_hours: durationHours,
  }) + '\n');

  const response = getCannedResponse('bypass_activated')
    .replace('{duration}', String(durationHours));
  return { allow: true, response, reason: 'bypass_activated' };
}

// ═══════════════════════════════════════
// STATE TRANSITIONS
// ═══════════════════════════════════════

export function transitionTo(state, newStatus) {
  state.status = newStatus;
  if (newStatus !== 'LOCKED_MORNING' && newStatus !== 'LOCKED_NIGHT') {
    state.tier_unlocked_at = new Date().toISOString();
  }

  // Set deadlines
  const deadlines = {
    'TIER_1': '11:30',
    'TIER_2': '15:00',
    'TIER_3': '17:00',
    'FULL_ACCESS': '20:00',
  };
  state.current_deadline = deadlines[newStatus] || null;

  saveGateState(state);
  return state;
}

/**
 * Record a pillar completion and transition gate state.
 * Returns the new gate state.
 */
export function completePillar(pillar) {
  const state = loadGateState();

  if (state.pillars_completed.includes(pillar)) {
    return { accepted: false, reason: `${pillar} already completed today.`, state };
  }

  state.pillars_completed.push(pillar);
  state.pillars_remaining = state.pillars_remaining.filter(p => p !== pillar);

  // Reset social engineering counter on valid pillar
  state.social_engineering_attempts = 0;

  const count = state.pillars_completed.length;
  const isGraceDay = state.grace_day_active_today;

  // Transition based on pillar count
  // Grace day: 2 pillars = FULL_ACCESS
  if (isGraceDay) {
    if (count >= 2) {
      transitionTo(state, 'FULL_ACCESS');
    } else if (count === 1 && state.status === 'LOCKED_MORNING') {
      transitionTo(state, 'TIER_1');
    }
  } else {
    const transitions = { 1: 'TIER_1', 2: 'TIER_2', 3: 'TIER_3', 4: 'FULL_ACCESS' };
    if (transitions[count]) {
      transitionTo(state, transitions[count]);
    }
  }

  saveGateState(state);

  return {
    accepted: true,
    pillar,
    new_status: state.status,
    pillars_completed: state.pillars_completed,
    pillars_remaining: state.pillars_remaining,
    pillar_count: count,
    state,
  };
}

// ═══════════════════════════════════════
// GRACE DAY
// ═══════════════════════════════════════

/**
 * Automatically activate grace day if conditions met.
 * Called at noon check: 0 pillars by noon, and grace not yet used this week.
 */
export function checkGraceDay() {
  const state = loadGateState();
  if (state.grace_day_active_today) return { activated: false, reason: 'already_active' };
  if (state.grace_day_used_this_week) return { activated: false, reason: 'used_this_week' };
  if (state.pillars_completed.length > 0) return { activated: false, reason: 'has_completions' };

  state.grace_day_active_today = true;
  state.grace_day_used_this_week = true;
  saveGateState(state);

  return { activated: true, message: getCannedResponse('grace_day') };
}

// ═══════════════════════════════════════
// DAILY RESET
// ═══════════════════════════════════════

export function resetForNewDay() {
  const state = loadGateState();

  // Check if this is a new week (Monday) — reset weekly grace
  const now = new Date();
  if (now.getDay() === 1) {
    state.grace_day_used_this_week = false;
  }

  state.status = 'LOCKED_MORNING';
  state.pillars_completed = [];
  state.pillars_remaining = ['exercise', 'captain', 'honey_do', 'clean'];
  state.tier_unlocked_at = null;
  state.current_deadline = null;
  state.grace_day_active_today = false;
  state.social_engineering_attempts = 0;
  state.last_social_engineering_attempt = null;
  state.bypass_active = false;
  state.bypass_expires = null;
  state.last_reset = now.toISOString();

  saveGateState(state);
  return state;
}

// ═══════════════════════════════════════
// DEADLINE ENFORCEMENT
// ═══════════════════════════════════════

/**
 * Check if a deadline has been missed and enforce consequences.
 * Called by cron jobs at 11:30, 15:00, 17:00, 20:00.
 */
export function enforceDeadline(deadlineType) {
  const state = loadGateState();

  if (state.baby_mode) return { action: 'none', reason: 'baby_mode' };

  switch (deadlineType) {
    case 'tier2': {
      // 11:30 — if not at TIER_2+, issue warning (don't lock)
      const atLeastTier2 = ['TIER_2', 'TIER_3', 'FULL_ACCESS'].includes(state.status);
      if (!atLeastTier2 && state.status !== 'LOCKED_MORNING' && state.status !== 'LOCKED_NIGHT') {
        return { action: 'warn', message: '⏰ 11:30 — 2nd pillar deadline. You\'re still at TIER 1. Which pillar next?' };
      }
      return { action: 'none' };
    }

    case 'tier3': {
      // 15:00 — if not at TIER_3+, issue warning
      const atLeastTier3 = ['TIER_3', 'FULL_ACCESS'].includes(state.status);
      if (!atLeastTier3 && !['LOCKED_MORNING', 'LOCKED_NIGHT'].includes(state.status)) {
        return { action: 'warn', message: '⏰ 3 PM — 3rd pillar deadline. Two hours until lockout.' };
      }
      return { action: 'none' };
    }

    case 'lockout': {
      // 17:00 — if not FULL_ACCESS, transition to LOCKED_NIGHT
      if (state.status !== 'FULL_ACCESS' && state.status !== 'LOCKED_NIGHT') {
        transitionTo(state, 'LOCKED_NIGHT');
        return { action: 'lock', message: '🔒 5 PM lockout. See you tomorrow morning.' };
      }
      return { action: 'none' };
    }

    case 'protect': {
      // 20:00 — force LOCKED_NIGHT regardless
      if (state.status !== 'LOCKED_NIGHT') {
        transitionTo(state, 'LOCKED_NIGHT');
        return { action: 'lock', message: '🔒 8 PM — protect time. Locked until tomorrow.' };
      }
      return { action: 'none' };
    }

    default:
      return { action: 'none', reason: 'unknown_deadline' };
  }
}

// ═══════════════════════════════════════
// BABY MODE
// ═══════════════════════════════════════

export function enableBabyMode() {
  const state = loadGateState();
  state.baby_mode = true;
  saveGateState(state);
  return state;
}

export function disableBabyMode() {
  const state = loadGateState();
  state.baby_mode = false;
  saveGateState(state);
  return state;
}

/**
 * In baby mode, the gate is much softer:
 * - 1 pillar = morning unlock
 * - 2 pillars = full access
 * - No time deadlines
 * - No lockout night
 */
export function shouldProcessBabyMode(message) {
  // Baby mode: always allow through, the gate is advisory only
  return { allow: true, reason: 'baby_mode' };
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function getCannedResponse(key) {
  const responses = loadCannedResponses();
  return responses[key] || responses['default'] || '🔒';
}

export function getGateStatus() {
  return loadGateState();
}

export function getGateSummary() {
  const state = loadGateState();
  return {
    status: state.status,
    pillars_done: state.pillars_completed.length,
    pillars_remaining: state.pillars_remaining,
    deadline: state.current_deadline,
    grace_day: state.grace_day_active_today,
    baby_mode: state.baby_mode,
    bypass_active: state.bypass_active,
  };
}

export default {
  shouldProcess, isPillarClaim, isEmergencyBypass,
  transitionTo, completePillar, checkGraceDay,
  resetForNewDay, enforceDeadline,
  enableBabyMode, disableBabyMode, shouldProcessBabyMode,
  getGateStatus, getGateSummary,
  loadGateState: () => loadGateState(),
  saveGateState: (s) => saveGateState(s),
};
