#!/usr/bin/env node
// scripts/setup.mjs — Setup verification for PiaB v3
// Validates all connections, sheets, and configs are properly configured.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT, loadConnections, loadHousehold, loadPlaybook } from './lib/yaml-loader.mjs';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const results = { checks: [], passed: 0, failed: 0, warnings: 0 };

  function check(name, fn) {
    try {
      const result = fn();
      if (result.ok) {
        results.checks.push({ name, status: 'pass', detail: result.detail });
        results.passed++;
      } else if (result.warn) {
        results.checks.push({ name, status: 'warn', detail: result.detail });
        results.warnings++;
      } else {
        results.checks.push({ name, status: 'fail', detail: result.detail });
        results.failed++;
      }
    } catch (err) {
      results.checks.push({ name, status: 'fail', detail: err.message });
      results.failed++;
    }
  }

  // ── Config files ──
  check('connections.yaml exists', () => {
    const exists = fs.existsSync(path.join(SKILL_ROOT, 'config/connections.yaml'));
    return { ok: exists, detail: exists ? 'Found' : 'Missing' };
  });

  check('household.yaml exists', () => {
    const exists = fs.existsSync(path.join(SKILL_ROOT, 'config/household.yaml'));
    return { ok: exists, detail: exists ? 'Found' : 'Missing' };
  });

  check('coach_playbook.yaml exists', () => {
    const exists = fs.existsSync(path.join(SKILL_ROOT, 'config/coach_playbook.yaml'));
    return { ok: exists, detail: exists ? 'Found' : 'Missing' };
  });

  // ── Config values ──
  check('Life OS sheet ID configured', () => {
    const conn = loadConnections();
    const id = conn.google_sheets?.life_os?.sheet_id;
    const isPlaceholder = !id || id.includes('PLACEHOLDER');
    return { ok: !isPlaceholder, warn: isPlaceholder, detail: isPlaceholder ? 'Still has placeholder — run Phase 1' : `ID: ${id.slice(0, 12)}...` };
  });

  check('Financial OS sheet ID configured', () => {
    const conn = loadConnections();
    const id = conn.google_sheets?.financial_os?.sheet_id;
    const isPlaceholder = !id || id.includes('PLACEHOLDER');
    return { ok: !isPlaceholder, warn: isPlaceholder, detail: isPlaceholder ? 'Still has placeholder — run Phase 1' : `ID: ${id.slice(0, 12)}...` };
  });

  check('Calendar ID configured', () => {
    const conn = loadConnections();
    const id = conn.google_calendar?.family_ssot?.calendar_id;
    const isPlaceholder = !id || id.includes('PLACEHOLDER');
    return { ok: !isPlaceholder, warn: isPlaceholder, detail: isPlaceholder ? 'Still has placeholder — run Phase 1' : `ID: ${id.slice(0, 20)}...` };
  });

  check('Household people configured', () => {
    const hh = loadHousehold();
    const people = Object.keys(hh.people || {});
    return { ok: people.length >= 2, detail: `People: ${people.join(', ')}` };
  });

  check('Owner map configured', () => {
    const hh = loadHousehold();
    const map = hh.household?.owner_map || {};
    const keys = Object.keys(map);
    return { ok: keys.length >= 4, detail: `${keys.length} mappings: ${keys.join(', ')}` };
  });

  check('ADHD profiles configured', () => {
    const hh = loadHousehold();
    const james = hh.people?.james?.adhd_profile;
    const laura = hh.people?.laura?.adhd_profile;
    return { ok: !!james && !!laura, detail: james && laura ? 'Both profiles present' : 'Missing profiles' };
  });

  check('Playbook loaded', () => {
    const pb = loadPlaybook();
    const modes = Object.keys(pb.modes || {});
    return { ok: modes.length >= 3, detail: `${modes.length} coaching modes: ${modes.join(', ')}` };
  });

  // ── Directory structure ──
  check('State directory writable', () => {
    const stateDir = path.join(SKILL_ROOT, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const testFile = path.join(stateDir, '.write_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return { ok: true, detail: stateDir };
  });

  check('Ledger directory writable', () => {
    const ledgerDir = path.join(SKILL_ROOT, 'data/ledger');
    fs.mkdirSync(ledgerDir, { recursive: true });
    const testFile = path.join(ledgerDir, '.write_test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    return { ok: true, detail: ledgerDir };
  });

  // ── Scripts exist ──
  const scripts = ['observe.mjs', 'decide.mjs', 'capture.mjs', 'learn.mjs', 'setup.mjs', 'test.mjs', 'backup.mjs'];
  for (const script of scripts) {
    check(`scripts/${script} exists`, () => {
      const exists = fs.existsSync(path.join(SKILL_ROOT, 'scripts', script));
      return { ok: exists, detail: exists ? 'Found' : 'Missing' };
    });
  }

  // ── Lib modules exist ──
  const libs = ['yaml-loader.mjs', 'ledger.mjs', 'sheets.mjs', 'calendar.mjs', 'email.mjs', 'budget.mjs', 'templates.mjs'];
  for (const lib of libs) {
    check(`scripts/lib/${lib} exists`, () => {
      const exists = fs.existsSync(path.join(SKILL_ROOT, 'scripts/lib', lib));
      return { ok: exists, detail: exists ? 'Found' : 'Missing' };
    });
  }

  // ── Google Sheets access (skip in dry run) ──
  if (!DRY_RUN) {
    const { execSync } = await import('child_process');
    check('OpenClaw gog tool available', () => {
      try {
        execSync('openclaw tool gog --help', { timeout: 5000, encoding: 'utf-8' });
        return { ok: true, detail: 'gog tool responding' };
      } catch {
        return { ok: false, detail: 'openclaw tool gog not available — install OpenClaw and gog skill' };
      }
    });

    const conn = loadConnections();
    const lifeOsId = conn.google_sheets?.life_os?.sheet_id;
    if (lifeOsId && !lifeOsId.includes('PLACEHOLDER')) {
      check('Life OS sheet readable', () => {
        try {
          const result = execSync(`openclaw tool gog sheets.metadata --spreadsheetId "${lifeOsId}" --json`, { timeout: 15000, encoding: 'utf-8' });
          const data = JSON.parse(result);
          const tabs = data.sheets?.map(s => s.properties?.title) || [];
          return { ok: tabs.length >= 20, detail: `${tabs.length} tabs found` };
        } catch (err) {
          return { ok: false, detail: err.message };
        }
      });

      check('_MASTER_LOG has 46 columns', () => {
        try {
          const result = execSync(`openclaw tool gog sheets.get --spreadsheetId "${lifeOsId}" --range "_MASTER_LOG!1:1" --json`, { timeout: 15000, encoding: 'utf-8' });
          const data = JSON.parse(result);
          const cols = data.values?.[0]?.length || 0;
          return { ok: cols >= 46, detail: `${cols} columns found` };
        } catch (err) {
          return { ok: false, detail: err.message };
        }
      });
    }
  }

  // ── Summary ──
  console.log(JSON.stringify({
    status: results.failed === 0 ? 'ok' : 'issues_found',
    passed: results.passed,
    failed: results.failed,
    warnings: results.warnings,
    checks: results.checks,
  }, null, 2));

  if (results.failed > 0) process.exit(1);
}

main().catch(err => {
  console.error(JSON.stringify({ status: 'error', error: err.message }));
  process.exit(1);
});
