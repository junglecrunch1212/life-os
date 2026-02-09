#!/usr/bin/env node
// scripts/backup.mjs — Daily backup for PiaB v3
// Backs up state, ledger data, and config to local storage.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { SKILL_ROOT, loadConnections } from './lib/yaml-loader.mjs';

const conn = loadConnections();
const BACKUP_PATH = conn.backup?.local_path || '/data/backups/piab/';
const RETENTION_DAYS = conn.backup?.retention_days || 30;

async function main() {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const backupDir = path.join(BACKUP_PATH, dateStr);

  console.log(`Starting backup to ${backupDir}...`);

  // Create backup directory
  fs.mkdirSync(backupDir, { recursive: true });

  // Backup state files
  const stateDir = path.join(SKILL_ROOT, 'state');
  if (fs.existsSync(stateDir)) {
    const destState = path.join(backupDir, 'state');
    fs.mkdirSync(destState, { recursive: true });
    for (const file of fs.readdirSync(stateDir)) {
      fs.copyFileSync(path.join(stateDir, file), path.join(destState, file));
    }
    console.log(`  Backed up state/ (${fs.readdirSync(stateDir).length} files)`);
  }

  // Backup ledger files
  const ledgerDir = path.join(SKILL_ROOT, 'data/ledger');
  if (fs.existsSync(ledgerDir)) {
    const destLedger = path.join(backupDir, 'ledger');
    fs.mkdirSync(destLedger, { recursive: true });
    for (const file of fs.readdirSync(ledgerDir)) {
      fs.copyFileSync(path.join(ledgerDir, file), path.join(destLedger, file));
    }
    console.log(`  Backed up ledger/ (${fs.readdirSync(ledgerDir).length} files)`);
  }

  // Backup config files
  const configDir = path.join(SKILL_ROOT, 'config');
  if (fs.existsSync(configDir)) {
    const destConfig = path.join(backupDir, 'config');
    fs.mkdirSync(destConfig, { recursive: true });
    for (const file of fs.readdirSync(configDir)) {
      fs.copyFileSync(path.join(configDir, file), path.join(destConfig, file));
    }
    console.log(`  Backed up config/ (${fs.readdirSync(configDir).length} files)`);
  }

  // Backup checkpoints
  const checkpointDir = path.join(SKILL_ROOT, 'piab-build/checkpoints');
  if (fs.existsSync(checkpointDir)) {
    const destCheck = path.join(backupDir, 'checkpoints');
    fs.mkdirSync(destCheck, { recursive: true });
    for (const file of fs.readdirSync(checkpointDir)) {
      fs.copyFileSync(path.join(checkpointDir, file), path.join(destCheck, file));
    }
    console.log(`  Backed up checkpoints/`);
  }

  // Write backup manifest
  const manifest = {
    date: dateStr,
    created_at: now.toISOString(),
    contents: fs.readdirSync(backupDir).filter(f => f !== 'manifest.json'),
    piab_version: '3.0.0',
  };
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  // ── Cleanup old backups ──
  if (fs.existsSync(BACKUP_PATH)) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000);
    const dirs = fs.readdirSync(BACKUP_PATH).filter(d => {
      const dirPath = path.join(BACKUP_PATH, d);
      return fs.statSync(dirPath).isDirectory() && d.match(/^\d{4}-\d{2}-\d{2}$/);
    });

    let removed = 0;
    for (const dir of dirs) {
      const dirDate = new Date(dir);
      if (dirDate < cutoff) {
        fs.rmSync(path.join(BACKUP_PATH, dir), { recursive: true, force: true });
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`  Cleaned up ${removed} backups older than ${RETENTION_DAYS} days`);
    }
  }

  console.log(JSON.stringify({
    status: 'ok',
    backup_path: backupDir,
    date: dateStr,
    retention_days: RETENTION_DAYS,
  }));
}

main().catch(err => {
  console.error(JSON.stringify({ status: 'error', error: err.message }));
  process.exit(1);
});
