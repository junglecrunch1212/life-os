#!/usr/bin/env node
// scripts/test.mjs — Verification test suite for PiaB v3
// Validates file structure, config parsing, and (optionally) live sheet schemas.

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
  'scripts/lib/yaml-loader.mjs',
  'scripts/lib/ledger.mjs',
  'scripts/lib/sheets.mjs',
  'scripts/lib/calendar.mjs',
  'scripts/lib/email.mjs',
  'scripts/lib/budget.mjs',
  'scripts/lib/templates.mjs',
  'scripts/observe.mjs',
  'scripts/decide.mjs',
  'scripts/capture.mjs',
  'scripts/learn.mjs',
  'scripts/setup.mjs',
  'scripts/backup.mjs',
  'SKILL.md',
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

  // Cleanup
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
