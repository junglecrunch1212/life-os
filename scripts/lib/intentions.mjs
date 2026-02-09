// scripts/lib/intentions.mjs — Implementation Intentions (If-Then Plans) for PiaB v3
//
// Evidence: Gollwitzer & Sheeran meta-analysis across 642 independent tests:
// effect sizes of .27 to .66. Implementation intentions improve response inhibition
// in ADHD specifically by shifting from top-down to bottom-up information processing,
// bypassing the exact executive function deficit.
//
// Key findings: Effect sizes are larger when plans have a contingent if-then format,
// participants are highly motivated, and plans are rehearsed at least once.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT } from './yaml-loader.mjs';
import ledger from './ledger.mjs';

const INTENTIONS_PATH = path.join(SKILL_ROOT, 'state', 'daily_intentions.json');
const INTENTIONS_LOG = path.join(SKILL_ROOT, 'state', 'metrics', 'intentions.jsonl');

function loadIntentions() {
  try {
    return JSON.parse(fs.readFileSync(INTENTIONS_PATH, 'utf-8'));
  } catch { return {}; }
}

function saveIntentions(intentions) {
  fs.writeFileSync(INTENTIONS_PATH, JSON.stringify(intentions, null, 2));
}

// ═══════════════════════════════════════
// EVENING PROTOCOL: Collect if-then plans
// ═══════════════════════════════════════

/**
 * Generate the evening prompt to collect tomorrow's implementation intention.
 */
export function getEveningIntentionPrompt() {
  return [
    "Which pillar are you starting with tomorrow?",
    "",
    'What\'s your if-then plan?',
    'Format: "If [trigger], then I will [first physical action]."',
    'Example: "If my alarm goes off at 6:15, then I put on running shoes before checking my phone."',
  ].join('\n');
}

/**
 * Store an implementation intention for tomorrow.
 *
 * @param {string} pillar - Which pillar (exercise, captain, honey_do, clean)
 * @param {string} raw - The user's raw if-then statement
 */
export function storeIntention(pillar, raw) {
  const intentions = loadIntentions();

  const parsed = parseIfThen(raw);

  intentions[pillar] = {
    raw,
    if_clause: parsed.if_clause,
    then_clause: parsed.then_clause,
    created_at: new Date().toISOString(),
    rehearsed: false,
  };

  saveIntentions(intentions);

  // Log to metrics
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  fs.mkdirSync(path.dirname(INTENTIONS_LOG), { recursive: true });
  fs.appendFileSync(INTENTIONS_LOG, JSON.stringify({
    date: tomorrow,
    pillar,
    if_clause: parsed.if_clause,
    then_clause: parsed.then_clause,
    rehearsed: false,
    created_at: new Date().toISOString(),
  }) + '\n');

  return { stored: true, pillar, parsed };
}

/**
 * Mark an intention as rehearsed (read back at night or morning).
 */
export function markRehearsed(pillar) {
  const intentions = loadIntentions();
  if (intentions[pillar]) {
    intentions[pillar].rehearsed = true;
    saveIntentions(intentions);
  }
}

// ═══════════════════════════════════════
// MORNING PROTOCOL: Read back the if-then plan
// ═══════════════════════════════════════

/**
 * Get the morning readback message.
 * Opens the morning briefing with the user's OWN words, not PiaB's.
 */
export function getMorningReadback() {
  const intentions = loadIntentions();
  const entries = Object.entries(intentions);

  if (entries.length === 0) return null;

  // Find the first (priority) intention
  const [pillar, intention] = entries[0];

  if (!intention.raw) return null;

  // Mark as rehearsed (morning readback)
  markRehearsed(pillar);

  return `Your plan: "${intention.raw}" Ready?`;
}

/**
 * Get all stored intentions for display.
 */
export function getAllIntentions() {
  return loadIntentions();
}

// ═══════════════════════════════════════
// PARSING
// ═══════════════════════════════════════

/**
 * Parse an if-then statement into clauses.
 */
function parseIfThen(raw) {
  const match = raw.match(/if\s+(.+?),?\s+then\s+(?:I\s+(?:will\s+)?)?(.+)/i);
  if (match) {
    return { if_clause: match[1].trim(), then_clause: match[2].trim() };
  }

  // Fallback: try to split on common patterns
  const arrowMatch = raw.match(/(.+?)\s*[→→->]+\s*(.+)/);
  if (arrowMatch) {
    return { if_clause: arrowMatch[1].trim(), then_clause: arrowMatch[2].trim() };
  }

  // Can't parse — store raw
  return { if_clause: raw, then_clause: '' };
}

// ═══════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════

/**
 * Correlate intention patterns with pillar completion.
 * Used by learning engine.
 */
export function getIntentionEffectiveness(days = 30) {
  if (!fs.existsSync(INTENTIONS_LOG)) return { data_points: 0 };

  const entries = fs.readFileSync(INTENTIONS_LOG, 'utf-8')
    .trim().split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);

  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  const recent = entries.filter(e => e.created_at >= cutoff);

  // TODO: Cross-reference with pillar completion data
  // For now, return raw data for the learning engine
  return {
    data_points: recent.length,
    rehearsed_count: recent.filter(e => e.rehearsed).length,
    by_pillar: recent.reduce((acc, e) => {
      acc[e.pillar] = (acc[e.pillar] || 0) + 1;
      return acc;
    }, {}),
  };
}

/**
 * Clear daily intentions (called during morning after readback or during reset).
 */
export function clearIntentions() {
  saveIntentions({});
}

export default {
  getEveningIntentionPrompt, storeIntention, markRehearsed,
  getMorningReadback, getAllIntentions, clearIntentions,
  getIntentionEffectiveness,
};
