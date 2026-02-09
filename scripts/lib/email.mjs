// scripts/lib/email.mjs — Gmail triage interface for PiaB v3

import { execSync } from 'child_process';
import { loadConnections } from './yaml-loader.mjs';

const conn = loadConnections();
const GMAIL_ENABLED = conn.gmail?.enabled ?? false;
const LABELS = conn.gmail?.triage_labels || {};

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

export function scanInbox(maxResults = 20) {
  if (!GMAIL_ENABLED) return { success: false, error: 'Gmail not enabled' };
  return gogJSON(`gmail.messages.list --maxResults ${maxResults} --q "is:unread"`);
}

export function getMessage(messageId) {
  return gogJSON(`gmail.messages.get --id "${messageId}"`);
}

export function getActionNeeded() {
  if (!LABELS.action_needed) return { success: false, error: 'No action_needed label configured' };
  return gogJSON(`gmail.messages.list --q "label:${LABELS.action_needed} is:unread" --maxResults 10`);
}

export function getBills() {
  if (!LABELS.bills) return { success: false, error: 'No bills label configured' };
  return gogJSON(`gmail.messages.list --q "label:${LABELS.bills} is:unread" --maxResults 10`);
}

export function getDeadlines() {
  if (!LABELS.deadlines) return { success: false, error: 'No deadlines label configured' };
  return gogJSON(`gmail.messages.list --q "label:${LABELS.deadlines} is:unread" --maxResults 10`);
}

export function triageEmail(messageId) {
  const msg = getMessage(messageId);
  if (!msg.success) return msg;

  const headers = msg.data?.payload?.headers || [];
  const subject = headers.find(h => h.name === 'Subject')?.value || '';
  const from = headers.find(h => h.name === 'From')?.value || '';
  const snippet = msg.data?.snippet || '';

  // Simple heuristic triage
  const categories = [];
  const lowerSubject = subject.toLowerCase();
  const lowerSnippet = snippet.toLowerCase();

  if (lowerSubject.includes('invoice') || lowerSubject.includes('payment') || lowerSubject.includes('bill')) {
    categories.push('bill');
  }
  if (lowerSubject.includes('deadline') || lowerSubject.includes('due') || lowerSubject.includes('expires')) {
    categories.push('deadline');
  }
  if (lowerSubject.includes('action') || lowerSubject.includes('required') || lowerSubject.includes('please')) {
    categories.push('action_needed');
  }
  if (lowerSubject.includes('school') || lowerSubject.includes('henry') || lowerSnippet.includes('school')) {
    categories.push('school');
  }

  return {
    success: true,
    data: {
      id: messageId,
      subject,
      from,
      snippet,
      categories: categories.length > 0 ? categories : ['informational'],
    },
  };
}

export default { scanInbox, getMessage, getActionNeeded, getBills, getDeadlines, triageEmail };
