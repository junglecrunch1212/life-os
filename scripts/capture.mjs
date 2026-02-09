#!/usr/bin/env node
// scripts/capture.mjs — Inbound capture processor for PiaB v3
// Handles task captures, budget captures, list management, and task completions.

import { loadHousehold } from './lib/yaml-loader.mjs';
import sheets from './lib/sheets.mjs';
import budget from './lib/budget.mjs';
import ledger from './lib/ledger.mjs';

const args = process.argv.slice(2);
const ACTION = args.find(a => a.startsWith('--action='))?.split('=')[1] || 'task';
const PERSON = args.find(a => a.startsWith('--person='))?.split('=')[1] || 'james';
const TEXT = args.find(a => a.startsWith('--text='))?.split('=')[1] || '';
const DRY_RUN = args.includes('--dry-run');

async function main() {
  const household = loadHousehold();

  switch (ACTION) {
    case 'task':
      return captureTask(PERSON, TEXT);
    case 'complete':
      return completeTask(PERSON, TEXT);
    case 'budget':
      return captureBudget(PERSON, TEXT);
    case 'list':
      return captureListItem(PERSON, TEXT);
    case 'grocery':
      return captureListItem(PERSON, TEXT, 'Groceries');
    case 'honey_do':
      return captureListItem(PERSON, TEXT, 'HONEY_DO');
    default:
      console.log(JSON.stringify({ status: 'error', error: `Unknown action: ${ACTION}` }));
      process.exit(1);
  }
}

function captureTask(person, text) {
  const id = sheets.generateInboxId();
  const now = new Date();
  const household = loadHousehold();
  const ownerName = household.people[person]?.full_name?.split(' ')[0] || person;

  // INBOX schema: [ID, When, From, Status, Ref, Quick Note, Task Title, Notes, Owner?, Category?, Moved To, Moved On, Ready?]
  const row = [
    id,                                    // A: ID (INB-YYYYMMDD-XXXX)
    now.toISOString(),                     // B: When
    'piab',                                // C: From
    'new',                                 // D: Status
    '',                                    // E: Ref
    '',                                    // F: Quick Note
    text,                                  // G: Task Title
    `Captured via PiaB for ${ownerName}`,  // H: Notes
    ownerName,                             // I: Owner?
    '',                                    // J: Category?
    '',                                    // K: Moved To
    '',                                    // L: Moved On
    'Y',                                   // M: Ready?
  ];

  if (DRY_RUN) {
    console.log(JSON.stringify({ status: 'dry_run', action: 'capture_task', id, row }));
    return;
  }

  const result = sheets.appendToInbox(row);

  ledger.append('capture_ledger', {
    type: 'task_capture',
    person,
    id,
    title: text,
    success: result.success,
    verified: result.verified,
  });

  console.log(JSON.stringify({
    status: result.success ? 'ok' : 'error',
    action: 'capture_task',
    id,
    title: text,
    owner: ownerName,
    verified: result.verified,
    note: 'Written to INBOX. Will be triaged to _MASTER_LOG during next triage cycle.',
  }));
}

function completeTask(person, itemId) {
  if (!itemId) {
    console.log(JSON.stringify({ status: 'error', error: 'No item_id provided for completion' }));
    return;
  }

  if (DRY_RUN) {
    console.log(JSON.stringify({ status: 'dry_run', action: 'complete_task', item_id: itemId }));
    return;
  }

  const result = sheets.updateItemStatus(itemId, 'done', `Completed via PiaB by ${person}`);

  if (result.success) {
    // Award XP
    const household = loadHousehold();
    const profile = household.people[person]?.adhd_profile;
    const item = sheets.getActiveItems(person).find(i => i.item_id === itemId);
    let xp = 10; // base XP
    if (item) {
      if (item.effort_minutes >= 60) xp = 25;
      if (profile?.avoidance_domains?.includes(item.domain)) xp = 30;
    }

    // Update gamification
    const gpRaw = sheets.readGamePlayers();
    if (gpRaw.success) {
      const rows = (gpRaw.data?.values || []).slice(1);
      const playerRow = rows.find(r => r[1]?.toLowerCase() === person);
      if (playerRow) {
        const currentXP = parseInt(playerRow[4]) || 0;
        const currentStreak = parseInt(playerRow[8]) || 0;
        const lastDate = playerRow[10];
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        let newStreak = currentStreak;
        if (lastDate === yesterday || lastDate === today) {
          if (lastDate !== today) newStreak = currentStreak + 1;
        } else {
          newStreak = 1; // streak broken, restart
        }

        sheets.updateGamePlayer(playerRow[0], {
          total_xp: currentXP + xp,
          streak_current: newStreak,
          streak_last_date: today,
        });

        // Log to game log
        sheets.appendGameLog([
          `GL-${Date.now()}`, today, person, 'task_complete',
          itemId, xp, 0, '', `Completed: ${item?.title || itemId}`, '',
        ]);
      }
    }

    ledger.append('capture_ledger', {
      type: 'task_complete',
      person,
      item_id: itemId,
      xp_earned: xp,
    });
  }

  console.log(JSON.stringify({
    status: result.success ? 'ok' : 'error',
    action: 'complete_task',
    item_id: itemId,
    ...result,
  }));
}

function captureBudget(person, text) {
  // Parse "spent $X at Y" or "$X at Y for Z"
  const match = text.match(/\$?([\d.]+)\s+(?:at|for)\s+(.+?)(?:\s+(?:for|in|category)\s+(.+))?$/i);
  if (!match) {
    console.log(JSON.stringify({
      status: 'error',
      error: 'Could not parse budget capture. Use format: "$45 at Target" or "$20 at Starbucks for Restaurants"',
    }));
    return;
  }

  const amount = parseFloat(match[1]);
  const merchant = match[2].trim();
  const category = match[3]?.trim() || 'Uncategorized';

  if (DRY_RUN) {
    console.log(JSON.stringify({ status: 'dry_run', action: 'budget_capture', amount, merchant, category, person }));
    return;
  }

  const result = budget.logManualTransaction(merchant, amount, category, person);

  console.log(JSON.stringify({
    status: result.success ? 'ok' : 'error',
    action: 'budget_capture',
    amount,
    merchant,
    category,
    person,
    note: result.success ? 'Transaction logged to Financial OS Raw Data.' : result.error,
  }));
}

function captureListItem(person, text, listName = null) {
  // If no list name, try to detect from text
  if (!listName) {
    const lower = text.toLowerCase();
    if (lower.includes('grocer') || lower.includes('buy food') || lower.includes('pick up')) {
      listName = 'Groceries';
    } else if (lower.includes('honey') || lower.includes('fix') || lower.includes('repair')) {
      listName = 'HONEY_DO';
    } else {
      listName = 'Groceries'; // default
    }
  }

  const household = loadHousehold();
  const ownerName = household.people[person]?.full_name?.split(' ')[0] || person;
  const now = new Date().toISOString();

  // LIST_ITEMS schema: [list_name, item, status, priority, owner, due_date, notes, source, source_id, created_at, updated_at]
  const row = [
    listName,
    text,
    'active',
    '3',           // default priority
    ownerName,
    '',            // no due date
    '',            // notes
    'piab',
    `CAP-${Date.now()}`,
    now,
    now,
  ];

  if (DRY_RUN) {
    console.log(JSON.stringify({ status: 'dry_run', action: 'list_capture', list: listName, item: text }));
    return;
  }

  const result = sheets.appendListItem(row);

  ledger.append('capture_ledger', {
    type: 'list_capture',
    person,
    list: listName,
    item: text,
    success: result.success,
  });

  console.log(JSON.stringify({
    status: result.success ? 'ok' : 'error',
    action: 'list_capture',
    list: listName,
    item: text,
    owner: ownerName,
  }));
}

main().catch(err => {
  console.error(JSON.stringify({ status: 'error', error: err.message }));
  process.exit(1);
});
