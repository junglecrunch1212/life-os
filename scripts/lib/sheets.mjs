// scripts/lib/sheets.mjs — Google Sheets interface for PiaB v3
// Wraps `openclaw tool gog` commands for reading/writing Life OS and Financial OS.

import { execSync } from 'child_process';
import { loadConnections, loadHousehold } from './yaml-loader.mjs';

const conn = loadConnections();
const LIFE_OS = conn.google_sheets.life_os.sheet_id;
const FIN_OS = conn.google_sheets.financial_os.sheet_id;

function gog(command) {
  try {
    const result = execSync(`openclaw tool gog ${command}`, { encoding: 'utf-8', timeout: 30000 });
    return { success: true, data: result.trim() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function gogJSON(command) {
  const result = gog(`${command} --json`);
  if (!result.success) return result;
  try { result.data = JSON.parse(result.data); } catch {}
  return result;
}

function escapeShell(str) {
  return str.replace(/'/g, "'\\''");
}

// ═══════════════════════════════════════
// LIFE OS — _MASTER_LOG (46 columns)
// ═══════════════════════════════════════

// Column index map for _MASTER_LOG
const ML = {
  item_id: 0, item_type: 1, title: 2, description: 3, domain: 4, subdomain: 5,
  owner: 6, status: 7, priority: 8, effort_minutes: 9, energy: 10, context: 11,
  due_date: 12, stagnant_since: 13, commitment_level: 14, commitment_details: 15,
  project_id: 16, blocked_by: 17, waiting_on: 18, waiting_since: 19,
  recurrence_rule: 20, created_at: 21, created_by: 22, updated_at: 23,
  updated_by: 24, completed_at: 25, completion_notes: 26, source_system: 27,
  source_ref: 28, inbox_id: 29, score_now: 30, days_until_due: 31,
  days_since_created: 32, days_since_touched: 33, days_waiting: 34,
  is_overdue: 35, is_stagnant: 36, is_waiting_too_long: 37, needs_escalation: 38,
  urgency_component: 39, priority_component: 40, commitment_bonus: 41,
  stagnation_bonus: 42, waiting_penalty: 43, is_waiting_too_long_7: 44,
  is_waiting_too_long_14: 45
};

export function readMasterLog() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_MASTER_LOG!A1:AT"`);
}

export function parseMasterLog(raw) {
  if (!raw.success || !raw.data?.values) return [];
  const [headers, ...rows] = raw.data.values;
  return rows.filter(r => r[ML.item_id]).map(row => ({
    item_id: row[ML.item_id],
    item_type: row[ML.item_type],
    title: row[ML.title],
    description: row[ML.description],
    domain: row[ML.domain],
    subdomain: row[ML.subdomain],
    owner: row[ML.owner],
    status: row[ML.status],
    priority: parseFloat(row[ML.priority]) || 3,
    effort_minutes: parseFloat(row[ML.effort_minutes]) || 30,
    energy: row[ML.energy],
    context: row[ML.context],
    due_date: row[ML.due_date],
    project_id: row[ML.project_id],
    waiting_on: row[ML.waiting_on],
    score_now: parseFloat(row[ML.score_now]) || 0,
    is_overdue: row[ML.is_overdue] === 'True' || row[ML.is_overdue] === true,
    is_stagnant: row[ML.is_stagnant] === 'True' || row[ML.is_stagnant] === true,
    needs_escalation: row[ML.needs_escalation] === 'True' || row[ML.needs_escalation] === true,
    days_since_touched: parseInt(row[ML.days_since_touched]) || 0,
    completed_at: row[ML.completed_at],
    source_system: row[ML.source_system],
    _raw: row,
  }));
}

export function getActiveItems(person = null) {
  const raw = readMasterLog();
  const items = parseMasterLog(raw);
  const household = loadHousehold();
  const ownerMap = household.household?.owner_map || {};
  const activeStatuses = ['inbox', 'next', 'scheduled', 'waiting'];

  return items.filter(item => {
    if (!activeStatuses.includes(item.status)) return false;
    if (!person) return true;
    const mappedOwner = ownerMap[item.owner] || item.owner?.toLowerCase();
    return mappedOwner === person || mappedOwner === 'shared';
  });
}

export function getTopByScore(person, n = 3) {
  return getActiveItems(person)
    .filter(i => i.status === 'next' || i.status === 'scheduled')
    .sort((a, b) => b.score_now - a.score_now)
    .slice(0, n);
}

export function getTodayCompletions(person) {
  const raw = readMasterLog();
  const items = parseMasterLog(raw);
  const household = loadHousehold();
  const ownerMap = household.household?.owner_map || {};
  const today = new Date().toISOString().split('T')[0];

  return items.filter(item => {
    if (item.status !== 'done' || !item.completed_at) return false;
    if (!item.completed_at.startsWith(today)) return false;
    const mappedOwner = ownerMap[item.owner] || item.owner?.toLowerCase();
    return mappedOwner === person || mappedOwner === 'shared';
  });
}

export function updateItemStatus(itemId, newStatus, notes = '') {
  const raw = readMasterLog();
  if (!raw.success) return raw;
  const rows = raw.data?.values || [];
  const rowIdx = rows.findIndex(r => r[0] === itemId);
  if (rowIdx < 0) return { success: false, error: `Item ${itemId} not found` };

  const rowNum = rowIdx + 1; // 1-indexed
  const now = new Date().toISOString();

  // Update status (col H = col 8)
  gog(`sheets.update --spreadsheetId "${LIFE_OS}" --range "_MASTER_LOG!H${rowNum}" --values '[["${newStatus}"]]'`);
  // Update updated_at (col X = col 24)
  gog(`sheets.update --spreadsheetId "${LIFE_OS}" --range "_MASTER_LOG!X${rowNum}" --values '[["${now}"]]'`);
  // Update updated_by
  gog(`sheets.update --spreadsheetId "${LIFE_OS}" --range "_MASTER_LOG!Y${rowNum}" --values '[["piab"]]'`);

  if (newStatus === 'done') {
    gog(`sheets.update --spreadsheetId "${LIFE_OS}" --range "_MASTER_LOG!Z${rowNum}" --values '[["${now}"]]'`);
    if (notes) {
      gog(`sheets.update --spreadsheetId "${LIFE_OS}" --range "_MASTER_LOG!AA${rowNum}" --values '[["${escapeShell(notes)}"]]'`);
    }
  }

  // Write to _AUDIT
  appendAudit('piab', newStatus === 'done' ? 'complete' : 'update', 'item', itemId, 'status', '', newStatus, 'piab_coaching');

  return { success: true, item_id: itemId, new_status: newStatus };
}

// ═══════════════════════════════════════
// LIFE OS — INBOX
// ═══════════════════════════════════════

export function readInbox() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "INBOX!A2:M"`);
}

export function appendToInbox(row) {
  const values = JSON.stringify([row]);
  const result = gog(`sheets.append --spreadsheetId "${LIFE_OS}" --range "INBOX!A2:M" --values '${escapeShell(values)}'`);

  // Readback verification
  if (result.success) {
    const verify = readInbox();
    if (verify.success) {
      const rows = verify.data?.values || [];
      const lastRow = rows[rows.length - 1];
      if (lastRow && lastRow[0] === row[0]) {
        return { success: true, verified: true, id: row[0] };
      }
    }
    return { success: true, verified: false, warning: 'Write succeeded but readback unverified' };
  }
  return result;
}

export function generateInboxId() {
  const now = new Date();
  const date = now.toISOString().split('T')[0].replace(/-/g, '');
  const seq = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  return `INB-${date}-${seq}`;
}

// ═══════════════════════════════════════
// LIFE OS — LIST_ITEMS
// ═══════════════════════════════════════

export function readListItems(listName = null) {
  const result = gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "LIST_ITEMS!A1:K"`);
  if (!result.success) return result;
  const rows = (result.data?.values || []).slice(1); // skip header
  if (listName) {
    result.data.values = rows.filter(r => r[0] === listName && r[2] !== 'done' && r[2] !== 'removed');
  }
  return result;
}

export function appendListItem(row) {
  const values = JSON.stringify([row]);
  return gog(`sheets.append --spreadsheetId "${LIFE_OS}" --range "LIST_ITEMS!A:K" --values '${escapeShell(values)}'`);
}

// ═══════════════════════════════════════
// LIFE OS — _PROJECTS, _ROUTINES, _ESCALATION
// ═══════════════════════════════════════

export function readProjects() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_PROJECTS!A1:K"`);
}

export function readRoutines() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_ROUTINES!A1:O"`);
}

export function readEscalationQueue() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_ESCALATION_QUEUE!A5:F"`);
}

export function readScores() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_SCORES!A1:D"`);
}

export function readSaturdayThemes() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_SATURDAY_THEMES!A1:E"`);
}

export function readDomains() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_DOMAINS!A1:D"`);
}

export function readAIContext() {
  const result = gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_AI_CONTEXT!A1:B"`);
  if (!result.success) return result;
  const rows = result.data?.values || [];
  const context = {};
  for (const row of rows.slice(1)) { // skip header
    if (row[0]) context[row[0]] = row[1];
  }
  return { success: true, data: context };
}

// ═══════════════════════════════════════
// LIFE OS — GAMIFICATION
// ═══════════════════════════════════════

export function readGamePlayers() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_GAME_PLAYERS!A1:O"`);
}

export function readGameQuests() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_GAME_QUESTS!A1:K"`);
}

export function readGameBosses() {
  return gogJSON(`sheets.get --spreadsheetId "${LIFE_OS}" --range "_GAME_BOSSES!A1:L"`);
}

export function appendGameLog(row) {
  const values = JSON.stringify([row]);
  return gog(`sheets.append --spreadsheetId "${LIFE_OS}" --range "_GAME_LOG!A:J" --values '${escapeShell(values)}'`);
}

export function updateGamePlayer(playerId, updates) {
  const raw = readGamePlayers();
  if (!raw.success) return raw;
  const rows = raw.data?.values || [];
  const rowIdx = rows.findIndex(r => r[0] === playerId);
  if (rowIdx < 0) return { success: false, error: `Player ${playerId} not found` };

  const rowNum = rowIdx + 1;
  // Column map: D=level, E=total_xp, F=xp_to_next, G=gold, H=gems, I=streak_current, J=streak_best, K=streak_last_date, N=weekly_xp, O=tasks_completed
  if (updates.total_xp !== undefined) {
    gog(`sheets.update --spreadsheetId "${LIFE_OS}" --range "_GAME_PLAYERS!E${rowNum}" --values '[[${updates.total_xp}]]'`);
  }
  if (updates.gold !== undefined) {
    gog(`sheets.update --spreadsheetId "${LIFE_OS}" --range "_GAME_PLAYERS!G${rowNum}" --values '[[${updates.gold}]]'`);
  }
  if (updates.streak_current !== undefined) {
    gog(`sheets.update --spreadsheetId "${LIFE_OS}" --range "_GAME_PLAYERS!I${rowNum}" --values '[[${updates.streak_current}]]'`);
  }
  if (updates.streak_last_date !== undefined) {
    gog(`sheets.update --spreadsheetId "${LIFE_OS}" --range "_GAME_PLAYERS!K${rowNum}" --values '[["${updates.streak_last_date}"]]'`);
  }
  return { success: true };
}

// ═══════════════════════════════════════
// LIFE OS — _AUDIT
// ═══════════════════════════════════════

export function appendAudit(actor, action, objectType, objectId, field, oldValue, newValue, source) {
  const now = new Date();
  const auditId = `AUD-${now.toISOString().replace(/[-:T]/g, '').slice(0, 15)}-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`;
  const row = [auditId, now.toISOString(), actor, action, objectType, objectId, field, oldValue, newValue, source];
  const values = JSON.stringify([row]);
  return gog(`sheets.append --spreadsheetId "${LIFE_OS}" --range "_AUDIT!A:J" --values '${escapeShell(values)}'`);
}

// ═══════════════════════════════════════
// FINANCIAL OS
// ═══════════════════════════════════════

export function readBudgetVsActual() {
  return gogJSON(`sheets.get --spreadsheetId "${FIN_OS}" --range "Budget vs Actual!A5:F20"`);
}

export function readMerchantBudgets() {
  return gogJSON(`sheets.get --spreadsheetId "${FIN_OS}" --range "Budget vs Actual!A22:F28"`);
}

export function readFinancialDashboard() {
  return gogJSON(`sheets.get --spreadsheetId "${FIN_OS}" --range "Dashboard!A3:E35"`);
}

export function readBalanceSheet() {
  return gogJSON(`sheets.get --spreadsheetId "${FIN_OS}" --range "Balance Sheet!A1:C40"`);
}

export function readFinConfig() {
  return gogJSON(`sheets.get --spreadsheetId "${FIN_OS}" --range "Config!A1:E60"`);
}

export function readCapExPlanning() {
  return gogJSON(`sheets.get --spreadsheetId "${FIN_OS}" --range "Config!A56:D70"`);
}

export function appendTransaction(date, merchant, category, account, statement, notes, amount, owner, type = '') {
  // Matches Raw Data schema: Date, Merchant, Category, Account, Original Statement, Notes, Amount, Tags, Owner, Type, Split From Row
  const row = [date, merchant, category, account || 'Manual entry', statement || '', notes || '', amount, '', owner, type, ''];
  const values = JSON.stringify([row]);
  return gog(`sheets.append --spreadsheetId "${FIN_OS}" --range "Raw Data!A:K" --values '${escapeShell(values)}'`);
}

// ═══════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════

export default {
  // Life OS - Master Log
  readMasterLog, parseMasterLog, getActiveItems, getTopByScore, getTodayCompletions, updateItemStatus,
  // Life OS - Inbox
  readInbox, appendToInbox, generateInboxId,
  // Life OS - Lists
  readListItems, appendListItem,
  // Life OS - Projects/Routines/Escalation
  readProjects, readRoutines, readEscalationQueue, readScores, readSaturdayThemes, readDomains, readAIContext,
  // Life OS - Gamification
  readGamePlayers, readGameQuests, readGameBosses, appendGameLog, updateGamePlayer,
  // Life OS - Audit
  appendAudit,
  // Financial OS
  readBudgetVsActual, readMerchantBudgets, readFinancialDashboard, readBalanceSheet, readFinConfig, readCapExPlanning, appendTransaction,
};
