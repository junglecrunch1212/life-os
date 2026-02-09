// scripts/lib/body-double.mjs — AI Body Doubling for PiaB v3
//
// Evidence: Adults with ADHD completed 37% more tasks in parallel work settings
// compared to working solo. 80% of ADHD coaching clients reported significantly
// improved task completion with body doubling (ADHD Coaching Association).
//
// OpenClaw can't physically be present but simulates the accountability component.
// Key insight: SILENCE during work IS the mechanism. The user knowing a check-in
// WILL come at 25 minutes creates the social presence effect.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT } from './yaml-loader.mjs';
import ledger from './ledger.mjs';

const SESSIONS_PATH = path.join(SKILL_ROOT, 'state', 'body_double_sessions.json');
const INITIATION_LOG = path.join(SKILL_ROOT, 'state', 'metrics', 'initiation.jsonl');

function loadSessions() {
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_PATH, 'utf-8'));
  } catch { return {}; }
}

function saveSessions(sessions) {
  fs.writeFileSync(SESSIONS_PATH, JSON.stringify(sessions, null, 2));
}

// ═══════════════════════════════════════
// SESSION MANAGEMENT
// ═══════════════════════════════════════

/**
 * Start a body double session.
 * Returns the start message and session ID.
 */
export function startSession(person, task, durationMin = 25) {
  const sessionId = `BD-${person}-${Date.now()}`;
  const now = new Date();
  const checkInAt = new Date(now.getTime() + durationMin * 60000);

  const session = {
    id: sessionId,
    person,
    task,
    duration_min: durationMin,
    started_at: now.toISOString(),
    check_in_at: checkInAt.toISOString(),
    status: 'active',       // active | completed | abandoned | extended
    pomodoro_count: 1,
    responses: [],
  };

  const sessions = loadSessions();
  sessions[sessionId] = session;
  saveSessions(sessions);

  // Log initiation
  fs.mkdirSync(path.dirname(INITIATION_LOG), { recursive: true });
  fs.appendFileSync(INITIATION_LOG, JSON.stringify({
    timestamp: now.toISOString(),
    task,
    person,
    initiated_by: 'self',
    session_id: sessionId,
  }) + '\n');

  ledger.append('capture_ledger', {
    type: 'body_double_start',
    person,
    task,
    session_id: sessionId,
  });

  const startMessage = [
    `Starting: ${task}. I'll check in at ${formatTime(checkInAt)}.`,
    'What specifically will be done when I check?',
  ].join('\n');

  return { sessionId, startMessage, checkInAt: checkInAt.toISOString() };
}

/**
 * Handle response at check-in time.
 * Returns the next message to send.
 */
export function handleCheckInResponse(sessionId, response) {
  const sessions = loadSessions();
  const session = sessions[sessionId];
  if (!session) return { message: null, error: 'Session not found' };

  const responseType = classifyResponse(response);
  session.responses.push({
    at: new Date().toISOString(),
    raw: response,
    type: responseType,
  });

  let message = null;
  let nextCheckIn = null;

  switch (responseType) {
    case 'done':
      session.status = 'completed';
      message = '✓ Nice.';
      ledger.append('capture_ledger', {
        type: 'body_double_complete',
        person: session.person,
        task: session.task,
        session_id: sessionId,
        pomodoros: session.pomodoro_count,
      });
      break;

    case 'working':
      // Extend by 15 minutes
      nextCheckIn = new Date(Date.now() + 15 * 60000).toISOString();
      session.check_in_at = nextCheckIn;
      message = 'Cool, checking back in 15.';
      break;

    case 'stuck':
      message = "What's the smallest possible next step?";
      break;

    default:
      // No clear response — silent log, no follow-up
      session.status = 'abandoned';
      break;
  }

  // Check pomodoro limit
  if (session.pomodoro_count >= 4 && responseType === 'working') {
    message = "That's 2 hours. Take a real break. You've earned it.";
    session.status = 'completed';
    nextCheckIn = null;
  }

  if (responseType === 'working') {
    session.pomodoro_count++;
  }

  sessions[sessionId] = session;
  saveSessions(sessions);

  return { message, nextCheckIn, sessionStatus: session.status };
}

/**
 * Get active sessions for a person.
 */
export function getActiveSessions(person) {
  const sessions = loadSessions();
  return Object.values(sessions).filter(s =>
    s.person === person && s.status === 'active'
  );
}

/**
 * Get sessions due for check-in (past their check_in_at time).
 */
export function getSessionsDueForCheckIn() {
  const sessions = loadSessions();
  const now = new Date().toISOString();
  return Object.values(sessions).filter(s =>
    s.status === 'active' && s.check_in_at && s.check_in_at <= now
  );
}

/**
 * Mark sessions with no response after 10 minutes as abandoned.
 * Called by cron or heartbeat.
 */
export function cleanupStaleSessions() {
  const sessions = loadSessions();
  const cutoff = new Date(Date.now() - 10 * 60000).toISOString();
  let cleaned = 0;

  for (const [id, session] of Object.entries(sessions)) {
    if (session.status === 'active' && session.check_in_at && session.check_in_at < cutoff) {
      // Check-in was 10+ minutes ago with no response
      session.status = 'abandoned';
      cleaned++;
    }
  }

  if (cleaned > 0) saveSessions(sessions);
  return { cleaned };
}

// ═══════════════════════════════════════
// HONEY-DO BODY DOUBLING
// ═══════════════════════════════════════

/**
 * Start a honey-do body double session.
 * Creates dual body-doubling: AI accountability + Laura awareness.
 */
export function startHoneyDoSession(task) {
  const result = startSession('james', task, 25);
  result.notifyLaura = true; // Signal to send bookend to Laura
  return result;
}

// ═══════════════════════════════════════
// SELF-INITIATION TRACKING
// ═══════════════════════════════════════

/**
 * Log whether a task was self-initiated or nudge-initiated.
 * Used by the learning engine to track autonomy growth.
 */
export function logInitiation(person, task, initiatedBy = 'self') {
  fs.mkdirSync(path.dirname(INITIATION_LOG), { recursive: true });
  fs.appendFileSync(INITIATION_LOG, JSON.stringify({
    timestamp: new Date().toISOString(),
    person,
    task,
    initiated_by: initiatedBy, // 'self' | 'nudge' | 'deadline'
  }) + '\n');
}

/**
 * Get self-initiation ratio for a person over N days.
 */
export function getSelfInitiationRatio(person, days = 7) {
  if (!fs.existsSync(INITIATION_LOG)) return { ratio: 0, total: 0 };

  const entries = fs.readFileSync(INITIATION_LOG, 'utf-8')
    .trim().split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const recent = entries.filter(e =>
    e.person === person && e.timestamp >= cutoff
  );

  const selfInitiated = recent.filter(e => e.initiated_by === 'self').length;
  const total = recent.length;

  return {
    ratio: total > 0 ? selfInitiated / total : 0,
    self_initiated: selfInitiated,
    nudge_initiated: recent.filter(e => e.initiated_by === 'nudge').length,
    deadline_initiated: recent.filter(e => e.initiated_by === 'deadline').length,
    total,
  };
}

// ═══════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════

function classifyResponse(text) {
  if (!text) return 'no_response';
  const t = text.toLowerCase();
  if (/done|finished|complete|yes|✓|✅/.test(t)) return 'done';
  if (/working|still|continue|more|going|almost/.test(t)) return 'working';
  if (/stuck|help|can't|cant|blocked|hard|ugh/.test(t)) return 'stuck';
  return 'unclear';
}

function formatTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default {
  startSession, handleCheckInResponse, getActiveSessions,
  getSessionsDueForCheckIn, cleanupStaleSessions,
  startHoneyDoSession,
  logInitiation, getSelfInitiationRatio,
};
