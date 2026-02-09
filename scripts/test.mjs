#!/usr/bin/env node
// scripts/test.mjs — Verification test suite for PiaB v3
// Tests file structure, config parsing, gate system, pillars, streaks, intentions, and ledger.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  FAIL  ${name}: ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('\nPiaB v3 — Test Suite\n');

// ════════════════════════════════
// File structure tests
// ════════════════════════════════
console.log('--- File Structure ---');

const requiredFiles = [
  'package.json',
  'config/connections.yaml',
  'config/household.yaml',
  'config/coach_playbook.yaml',
  'state/config.yaml',
  'state/canned-responses.json',
  'scripts/lib/yaml-loader.mjs',
  'scripts/lib/ledger.mjs',
  'scripts/lib/sheets.mjs',
  'scripts/lib/calendar.mjs',
  'scripts/lib/email.mjs',
  'scripts/lib/budget.mjs',
  'scripts/lib/templates.mjs',
  'scripts/lib/gate.mjs',
  'scripts/lib/pillars.mjs',
  'scripts/lib/stakes.mjs',
  'scripts/lib/social.mjs',
  'scripts/lib/intentions.mjs',
  'scripts/lib/body-double.mjs',
  'scripts/lib/reinforcement.mjs',
  'scripts/observe.mjs',
  'scripts/decide.mjs',
  'scripts/capture.mjs',
  'scripts/learn.mjs',
  'scripts/setup.mjs',
  'scripts/backup.mjs',
  'scripts/gate/gate-reset.mjs',
  'scripts/gate/deadline-check.mjs',
  'scripts/gate/gate-protect.mjs',
  'scripts/gate/grace-check.mjs',
  'scripts/gate/streak-check.mjs',
  'scripts/gate/weekly-compute.mjs',
  'SKILL.md',
  'HEARTBEAT.md',
  'hooks/on-message.md',
];

for (const file of requiredFiles) {
  test(`${file} exists`, () => {
    assert(fs.existsSync(path.join(ROOT, file)), `File not found: ${file}`);
  });
}

// ════════════════════════════════
// Config parsing tests
// ════════════════════════════════
console.log('\n--- Config Parsing ---');

test('package.json is valid JSON', () => {
  const content = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8');
  const pkg = JSON.parse(content);
  assert(pkg.name === 'piab', `Expected name 'piab', got '${pkg.name}'`);
  assert(pkg.version === '3.0.0', `Expected version '3.0.0', got '${pkg.version}'`);
  assert(pkg.type === 'module', `Expected type 'module'`);
});

test('yaml-loader loads connections', async () => {
  const { loadConnections } = await import('./lib/yaml-loader.mjs');
  const conn = loadConnections();
  assert(conn.google_sheets?.life_os?.sheet_id, 'Missing life_os sheet_id');
  assert(conn.google_sheets?.financial_os?.sheet_id, 'Missing financial_os sheet_id');
  assert(conn.google_sheets?.life_os?.tabs?.master_log === '_MASTER_LOG', 'Wrong master_log tab name');
  assert(conn.google_sheets?.life_os?.tabs?.inbox === 'INBOX', 'Wrong inbox tab name');
});

test('yaml-loader loads household', async () => {
  const { loadHousehold } = await import('./lib/yaml-loader.mjs');
  const hh = loadHousehold();
  assert(hh.household?.name === 'The Stice Family', 'Wrong household name');
  assert(hh.household?.timezone === 'America/New_York', 'Wrong timezone');
  assert(hh.people?.james?.role === 'co_head', 'James should be co_head');
  assert(hh.people?.laura?.role === 'co_head', 'Laura should be co_head');
  assert(hh.people?.henry?.role === 'child', 'Henry should be child');
});

test('yaml-loader loads playbook', async () => {
  const { loadPlaybook } = await import('./lib/yaml-loader.mjs');
  const pb = loadPlaybook();
  assert(pb.identity?.name, 'Missing agent name');
  assert(pb.modes?.morning_briefing, 'Missing morning_briefing mode');
  assert(pb.modes?.evening_close, 'Missing evening_close mode');
  assert(pb.failure_modes?.task_paralysis, 'Missing task_paralysis failure mode');
  assert(pb.gamification?.xp_awards, 'Missing gamification XP awards');
});

test('owner_map has required mappings', async () => {
  const { loadHousehold } = await import('./lib/yaml-loader.mjs');
  const hh = loadHousehold();
  const map = hh.household?.owner_map || {};
  assert(map['James'] === 'james', 'James mapping missing');
  assert(map['Jimmy Stice'] === 'james', 'Jimmy Stice mapping missing');
  assert(map['Laura'] === 'laura', 'Laura mapping missing');
  assert(map['Laura Holland Stice'] === 'laura', 'Laura Holland Stice mapping missing');
  assert(map['Both'] === 'shared', 'Both mapping missing');
});

test('connections.yaml has all Life OS tab names', async () => {
  const { loadConnections } = await import('./lib/yaml-loader.mjs');
  const conn = loadConnections();
  const tabs = conn.google_sheets?.life_os?.tabs || {};
  const expected = ['inbox', 'master_log', 'projects', 'routines', 'escalation', 'ai_context', 'list_items', 'audit', 'game_players', 'game_log', 'game_quests', 'game_bosses', 'saturday_themes'];
  for (const tab of expected) {
    assert(tabs[tab], `Missing tab mapping for: ${tab}`);
  }
});

test('connections.yaml has all Financial OS tab names', async () => {
  const { loadConnections } = await import('./lib/yaml-loader.mjs');
  const conn = loadConnections();
  const tabs = conn.google_sheets?.financial_os?.tabs || {};
  const expected = ['dashboard', 'budget_vs_actual', 'raw_data', 'config', 'balance_sheet'];
  for (const tab of expected) {
    assert(tabs[tab], `Missing tab mapping for: ${tab}`);
  }
});

test('ADHD profiles have required fields', async () => {
  const { loadHousehold } = await import('./lib/yaml-loader.mjs');
  const hh = loadHousehold();
  for (const person of ['james', 'laura']) {
    const profile = hh.people[person]?.adhd_profile;
    assert(profile, `${person} missing adhd_profile`);
    assert(profile.severity, `${person} missing severity`);
    assert(Array.isArray(profile.best_hours), `${person} missing best_hours`);
    assert(typeof profile.paralysis_threshold === 'number', `${person} missing paralysis_threshold`);
    assert(profile.response_to, `${person} missing response_to`);
  }
});

// ════════════════════════════════
// Gate system config
// ════════════════════════════════
console.log('\n--- Gate System Config ---');

test('state/config.yaml loads and has gate settings', async () => {
  const { loadYaml } = await import('./lib/yaml-loader.mjs');
  const config = loadYaml('state/config.yaml');
  assert(config.gate, 'Missing gate config');
  assert(config.gate.enabled === true, 'Gate should be enabled');
  assert(config.gate.pillars, 'Missing pillars config');
  assert(config.gate.pillars.exercise, 'Missing exercise pillar');
  assert(config.gate.pillars.captain, 'Missing captain pillar');
  assert(config.gate.pillars.honey_do, 'Missing honey_do pillar');
  assert(config.gate.pillars.clean, 'Missing clean pillar');
});

test('state/config.yaml has deadline settings', async () => {
  const { loadYaml } = await import('./lib/yaml-loader.mjs');
  const config = loadYaml('state/config.yaml');
  assert(config.gate.deadlines.tier_2 === '11:30', 'Wrong tier_2 deadline');
  assert(config.gate.deadlines.lockout === '17:00', 'Wrong lockout deadline');
  assert(config.gate.deadlines.protect_after === '20:00', 'Wrong protect_after deadline');
});

test('state/config.yaml has coaching thresholds', async () => {
  const { loadYaml } = await import('./lib/yaml-loader.mjs');
  const config = loadYaml('state/config.yaml');
  assert(config.thresholds, 'Missing thresholds');
  assert(config.thresholds.pillar_rate_target === 0.60, 'Wrong pillar_rate_target');
  assert(config.thresholds.response_rate_low === 0.40, 'Wrong response_rate_low');
  assert(config.thresholds.laura_friction_high === 3.0, 'Wrong laura_friction_high');
});

test('state/config.yaml has financial stakes settings', async () => {
  const { loadYaml } = await import('./lib/yaml-loader.mjs');
  const config = loadYaml('state/config.yaml');
  assert(config.financial_stakes, 'Missing financial_stakes');
  assert(config.financial_stakes.active === false, 'Stakes should default to inactive');
  assert(typeof config.financial_stakes.amount === 'number', 'Missing stake amount');
});

test('state/config.yaml has emergency bypass settings', async () => {
  const { loadYaml } = await import('./lib/yaml-loader.mjs');
  const config = loadYaml('state/config.yaml');
  assert(config.emergency_bypass, 'Missing emergency_bypass');
  assert(config.emergency_bypass.duration_hours === 2, 'Wrong bypass duration');
  assert(config.emergency_bypass.cooldown_hours === 72, 'Wrong bypass cooldown');
});

test('canned-responses.json has all required keys', () => {
  const responses = JSON.parse(fs.readFileSync(path.join(ROOT, 'state/canned-responses.json'), 'utf-8'));
  assert(responses.LOCKED_MORNING, 'Missing LOCKED_MORNING response');
  assert(responses.LOCKED_NIGHT, 'Missing LOCKED_NIGHT response');
  assert(responses.social_engineering_1, 'Missing social_engineering_1');
  assert(responses.social_engineering_2, 'Missing social_engineering_2');
  assert(responses.social_engineering_3, 'Missing social_engineering_3');
  assert('social_engineering_4_plus' in responses, 'Missing social_engineering_4_plus');
  assert(responses.grace_day, 'Missing grace_day response');
  assert(responses.bypass_activated, 'Missing bypass_activated response');
});

// ════════════════════════════════
// Gate state machine
// ════════════════════════════════
console.log('\n--- Gate State Machine ---');

test('gate isPillarClaim detects exercise', async () => {
  const { isPillarClaim } = await import('./lib/gate.mjs');
  assert(isPillarClaim({ text: 'Just finished my run', attachments: [] }), 'Should detect run keyword');
  assert(isPillarClaim({ text: 'workout done', attachments: [] }), 'Should detect workout keyword');
  assert(isPillarClaim({ text: 'hello', attachments: [{ type: 'image/jpeg' }] }), 'Should detect photo');
  assert(!isPillarClaim({ text: 'hello there', attachments: [] }), 'Should not detect random text');
});

test('gate isEmergencyBypass detects exact phrase', async () => {
  const { isEmergencyBypass } = await import('./lib/gate.mjs');
  assert(isEmergencyBypass({ text: 'EMERGENCY BYPASS' }), 'Should detect bypass');
  assert(isEmergencyBypass({ text: '  emergency bypass  ' }), 'Should detect case-insensitive');
  assert(!isEmergencyBypass({ text: 'emergency' }), 'Should not match partial');
  assert(!isEmergencyBypass({ text: 'bypass please' }), 'Should not match partial');
});

// ════════════════════════════════
// Pillar detection
// ════════════════════════════════
console.log('\n--- Pillar Detection ---');

test('detectPillar identifies exercise keywords', async () => {
  const { detectPillar } = await import('./lib/pillars.mjs');
  assert(detectPillar('just did my run') === 'exercise', 'Should detect run');
  assert(detectPillar('gym session done') === 'exercise', 'Should detect gym');
  assert(detectPillar('cardio complete') === 'exercise', 'Should detect cardio');
});

test('detectPillar identifies captain keywords', async () => {
  const { detectPillar } = await import('./lib/pillars.mjs');
  assert(detectPillar('walked Captain') === 'captain', 'Should detect Captain');
  assert(detectPillar('dog walk done') === 'captain', 'Should detect dog');
});

test('detectPillar identifies honey_do keywords', async () => {
  const { detectPillar } = await import('./lib/pillars.mjs');
  assert(detectPillar('honey-do done') === 'honey_do', 'Should detect honey-do');
  assert(detectPillar('fixed the shelf') === 'honey_do', 'Should detect fix');
});

test('detectPillar identifies clean keywords', async () => {
  const { detectPillar } = await import('./lib/pillars.mjs');
  assert(detectPillar('cleaned the kitchen') === 'clean', 'Should detect cleaned');
  assert(detectPillar('did the dishes') === 'clean', 'Should detect dishes');
  assert(detectPillar('vacuum done') === 'clean', 'Should detect vacuum');
});

test('detectPillar returns null for unknown', async () => {
  const { detectPillar } = await import('./lib/pillars.mjs');
  assert(detectPillar('hello world') === null, 'Should return null');
  assert(detectPillar('') === null, 'Should return null for empty');
  assert(detectPillar(null) === null, 'Should return null for null');
});

// ════════════════════════════════
// Intentions
// ════════════════════════════════
console.log('\n--- Implementation Intentions ---');

test('intentions store and retrieve', async () => {
  const int = (await import('./lib/intentions.mjs')).default;
  int.clearIntentions();
  int.storeIntention('exercise', 'If my alarm goes off, then I put on shoes');
  const all = int.getAllIntentions();
  assert(all.exercise, 'Should have exercise intention');
  assert(all.exercise.if_clause === 'my alarm goes off', 'Should parse if clause');
  assert(all.exercise.then_clause.includes('put on shoes'), 'Should parse then clause');
  int.clearIntentions();
});

test('intentions morning readback', async () => {
  const int = (await import('./lib/intentions.mjs')).default;
  int.clearIntentions();
  int.storeIntention('exercise', 'If alarm, then shoes on');
  const readback = int.getMorningReadback();
  assert(readback, 'Should return readback');
  assert(readback.includes('alarm'), 'Readback should contain the plan');
  int.clearIntentions();
});

// ════════════════════════════════
// Reinforcement
// ════════════════════════════════
console.log('\n--- Reinforcement ---');

test('streak display works', async () => {
  const r = (await import('./lib/reinforcement.mjs')).default;
  const display = r.getStreakDisplay();
  assert(typeof display === 'string', 'Should return string');
});

test('variable reinforcement is probabilistic', async () => {
  const r = (await import('./lib/reinforcement.mjs')).default;
  let trueCount = 0;
  for (let i = 0; i < 100; i++) {
    if (r.shouldSendReinforcement()) trueCount++;
  }
  // With 30% probability, expect roughly 15-45 in 100 tries
  assert(trueCount > 5 && trueCount < 65, `Reinforcement probability off: ${trueCount}/100`);
});

test('reinforcement messages exist for all pillars', async () => {
  const r = (await import('./lib/reinforcement.mjs')).default;
  const streaks = { daily_exercise: 5, four_four: 3 };
  for (const pillar of ['exercise', 'captain', 'honey_do', 'clean']) {
    const msg = r.getReinforcementMessage(pillar, streaks);
    assert(typeof msg === 'string' && msg.length > 0, `Missing message for ${pillar}`);
  }
});

// ════════════════════════════════
// Ledger tests
// ════════════════════════════════
console.log('\n--- Ledger ---');

test('ledger append and read', async () => {
  const ledger = (await import('./lib/ledger.mjs')).default;
  const testEntry = { type: 'test', value: Math.random() };
  ledger.append('_test_ledger', testEntry);
  const entries = ledger.read('_test_ledger', 10);
  assert(entries.length > 0, 'No entries read back');
  const last = entries[entries.length - 1];
  assert(last.type === 'test', 'Wrong type');
  assert(last.ts, 'Missing timestamp');
  const ledgerPath = path.join(ROOT, 'data/ledger/_test_ledger.jsonl');
  if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
});

test('ledger countToday', async () => {
  const ledger = (await import('./lib/ledger.mjs')).default;
  ledger.append('_test_count', { type: 'a' });
  ledger.append('_test_count', { type: 'b' });
  const count = ledger.countToday('_test_count');
  assert(count >= 2, `Expected at least 2, got ${count}`);
  const ledgerPath = path.join(ROOT, 'data/ledger/_test_count.jsonl');
  if (fs.existsSync(ledgerPath)) fs.unlinkSync(ledgerPath);
});

// ════════════════════════════════
// Template tests
// ════════════════════════════════
console.log('\n--- Templates ---');

test('renderTemplate replaces variables', async () => {
  const { renderTemplate } = await import('./lib/templates.mjs');
  const result = renderTemplate('Hello {name}, you have {count} tasks.', { name: 'James', count: '5' });
  assert(result.includes('James'), 'Name not replaced');
  assert(result.includes('5'), 'Count not replaced');
});

// ════════════════════════════════
// Summary
// ════════════════════════════════
console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
}
console.log();

process.exit(failed > 0 ? 1 : 0);
