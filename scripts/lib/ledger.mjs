// scripts/lib/ledger.mjs — Append-only local ledger for PiaB v3
// Stores coaching events, captures, and learning data locally.

import fs from 'fs';
import path from 'path';
import { SKILL_ROOT } from './yaml-loader.mjs';

const LEDGER_DIR = path.join(SKILL_ROOT, 'data', 'ledger');

function ensureDir() {
  fs.mkdirSync(LEDGER_DIR, { recursive: true });
}

function ledgerPath(name) {
  return path.join(LEDGER_DIR, `${name}.jsonl`);
}

export function append(ledgerName, entry) {
  ensureDir();
  const record = {
    ts: new Date().toISOString(),
    ...entry,
  };
  fs.appendFileSync(ledgerPath(ledgerName), JSON.stringify(record) + '\n');
  return record;
}

export function read(ledgerName, limit = 100, filterFn = null) {
  const filePath = ledgerPath(ledgerName);
  if (!fs.existsSync(filePath)) return [];

  const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
  let entries = lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  if (filterFn) {
    entries = entries.filter(filterFn);
  }

  return entries.slice(-limit);
}

export function readLast(ledgerName, n = 1, filterFn = null) {
  const entries = read(ledgerName, 1000, filterFn);
  return entries.slice(-n);
}

export function countToday(ledgerName, filterFn = null) {
  const today = new Date().toISOString().split('T')[0];
  const entries = read(ledgerName, 10000, (entry) => {
    if (!entry.ts || !entry.ts.startsWith(today)) return false;
    if (filterFn) return filterFn(entry);
    return true;
  });
  return entries.length;
}

export function readAll(ledgerName) {
  return read(ledgerName, Infinity);
}

export default { append, read, readLast, countToday, readAll };
