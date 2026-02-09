// scripts/lib/pillars.mjs — Pillar verification for PiaB v3
//
// The four pillars: Exercise, Walk Captain, Honey-Do, Clean House.
// Phase 1 verification: photo + timestamp + claim text.
// Future: Apple Watch HR, GPS tracks, LIST_ITEMS auto-check.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { SKILL_ROOT, loadYaml } from './yaml-loader.mjs';
import gate from './gate.mjs';
import ledger from './ledger.mjs';

const PHOTO_HASHES_PATH = path.join(SKILL_ROOT, 'state', 'photo-hashes.json');
const PILLAR_LOG = path.join(SKILL_ROOT, 'state', 'metrics', 'pillars.jsonl');

function loadConfig() {
  return loadYaml('state/config.yaml');
}

function loadPhotoHashes() {
  try {
    return JSON.parse(fs.readFileSync(PHOTO_HASHES_PATH, 'utf-8'));
  } catch { return []; }
}

function savePhotoHash(hash) {
  const hashes = loadPhotoHashes();
  hashes.push(hash);
  // Keep last 30 days (~120 photos)
  const trimmed = hashes.slice(-120);
  fs.writeFileSync(PHOTO_HASHES_PATH, JSON.stringify(trimmed));
}

// ═══════════════════════════════════════
// PILLAR DETECTION
// ═══════════════════════════════════════

/**
 * Detect which pillar is being claimed from message text.
 * Returns pillar key or null.
 */
export function detectPillar(text) {
  if (!text) return null;
  const t = text.toLowerCase();

  const config = loadConfig();
  const pillars = config.gate?.pillars || {};

  for (const [key, pillar] of Object.entries(pillars)) {
    const keywords = pillar.keywords || [];
    for (const kw of keywords) {
      if (t.includes(kw.toLowerCase())) return key;
    }
  }

  return null;
}

// ═══════════════════════════════════════
// PILLAR VERIFICATION
// ═══════════════════════════════════════

/**
 * Verify a pillar completion claim.
 * Requires: detected pillar + photo attachment.
 * Returns: { accepted, reason, pillar, gate_result }
 */
export function verifyPillarClaim(message) {
  const pillar = detectPillar(message.text);

  if (!pillar) {
    return {
      accepted: false,
      reason: 'Could not determine which pillar. Please specify: exercise, captain, honey-do, or clean.',
    };
  }

  // Check if already completed today
  const gateState = gate.getGateStatus();
  if (gateState.pillars_completed.includes(pillar)) {
    return {
      accepted: false,
      reason: `${pillar} already completed today.`,
      pillar,
    };
  }

  // Check for photo (Phase 1: trust + photo)
  const hasPhoto = message.attachments?.some(a =>
    a.type?.startsWith('image/')
  );

  if (!hasPhoto) {
    return {
      accepted: false,
      reason: 'Send a photo as proof (sweaty selfie, Captain on leash, clean counter, completed task).',
      pillar,
    };
  }

  // Check photo is not a reuse (hash against previous submissions)
  const photoData = message.attachments?.find(a => a.type?.startsWith('image/'))?.data;
  if (photoData) {
    const photoHash = crypto.createHash('sha256').update(photoData).digest('hex');
    const previousHashes = loadPhotoHashes();
    if (previousHashes.includes(photoHash)) {
      return {
        accepted: false,
        reason: 'This photo has been used before. Send a new one.',
        pillar,
      };
    }
    savePhotoHash(photoHash);
  }

  // Accept the pillar — update gate state
  const gateResult = gate.completePillar(pillar);

  if (!gateResult.accepted) {
    return { accepted: false, reason: gateResult.reason, pillar };
  }

  // Log to metrics
  logPillarCompletion(pillar, message);

  return {
    accepted: true,
    pillar,
    new_status: gateResult.new_status,
    pillars_remaining: gateResult.pillars_remaining,
    pillar_count: gateResult.pillar_count,
    gate_result: gateResult,
  };
}

// ═══════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════

function logPillarCompletion(pillar, message) {
  const entry = {
    timestamp: new Date().toISOString(),
    pillar,
    source: 'self_initiated',
    had_photo: true,
  };

  // Write to metrics JSONL
  fs.mkdirSync(path.dirname(PILLAR_LOG), { recursive: true });
  fs.appendFileSync(PILLAR_LOG, JSON.stringify(entry) + '\n');

  // Also write to ledger for unified tracking
  ledger.append('capture_ledger', {
    type: 'pillar_complete',
    person: 'james',
    pillar,
    source: 'self_initiated',
  });
}

// ═══════════════════════════════════════
// PILLAR STATUS HELPERS
// ═══════════════════════════════════════

export function getPillarStatus() {
  const gateState = gate.getGateStatus();
  const config = loadConfig();
  const pillars = config.gate?.pillars || {};

  return Object.keys(pillars).map(key => ({
    key,
    description: pillars[key].description,
    completed: gateState.pillars_completed.includes(key),
    starter_step: pillars[key].starter_step,
    values_connection: pillars[key].values_connection,
  }));
}

export function getRemainingPillars() {
  return getPillarStatus().filter(p => !p.completed);
}

export function getCompletedPillars() {
  return getPillarStatus().filter(p => p.completed);
}

/**
 * Get pillar completion data for a date range.
 * Returns array of daily records.
 */
export function getPillarHistory(days = 7) {
  if (!fs.existsSync(PILLAR_LOG)) return [];

  const entries = fs.readFileSync(PILLAR_LOG, 'utf-8')
    .trim().split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  return entries.filter(e => e.timestamp >= cutoff);
}

/**
 * Compute pillar completion rate for the last N weekdays.
 */
export function getPillarRate(weekdays = 5) {
  const history = getPillarHistory(7);
  const byDate = {};

  for (const entry of history) {
    const date = entry.timestamp.split('T')[0];
    if (!byDate[date]) byDate[date] = new Set();
    byDate[date].add(entry.pillar);
  }

  let fullDays = 0;
  let totalDays = 0;

  for (const [date, pillars] of Object.entries(byDate)) {
    const day = new Date(date).getDay();
    if (day === 0 || day === 6) continue; // skip weekends
    totalDays++;
    if (pillars.size >= 4) fullDays++;
  }

  return {
    full_days: fullDays,
    total_days: Math.min(totalDays, weekdays),
    rate: totalDays > 0 ? fullDays / Math.min(totalDays, weekdays) : 0,
  };
}

export default {
  detectPillar, verifyPillarClaim,
  getPillarStatus, getRemainingPillars, getCompletedPillars,
  getPillarHistory, getPillarRate,
};
