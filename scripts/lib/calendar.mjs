// scripts/lib/calendar.mjs — Google Calendar interface for PiaB v3

import { execSync } from 'child_process';
import { loadConnections } from './yaml-loader.mjs';

const conn = loadConnections();
const FAMILY_CAL = conn.google_calendar.family_ssot.calendar_id;
const HOLDS_CAL = conn.google_calendar.holds?.calendar_id;

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

export function getToday() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  return gogJSON(`calendar.events.list --calendarId "${FAMILY_CAL}" --timeMin "${start}" --timeMax "${end}" --singleEvents true --orderBy startTime`);
}

export function getTomorrow() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2).toISOString();
  return gogJSON(`calendar.events.list --calendarId "${FAMILY_CAL}" --timeMin "${start}" --timeMax "${end}" --singleEvents true --orderBy startTime`);
}

export function getWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();
  return gogJSON(`calendar.events.list --calendarId "${FAMILY_CAL}" --timeMin "${start}" --timeMax "${end}" --singleEvents true --orderBy startTime`);
}

export function createEvent(summary, startDateTime, endDateTime, description = '', attendees = []) {
  // Dedup: check if similar event already exists
  const existing = getToday();
  if (existing.success && existing.data?.items) {
    const dupe = existing.data.items.find(e =>
      e.summary === summary &&
      e.start?.dateTime === startDateTime
    );
    if (dupe) {
      return { success: true, data: dupe, deduplicated: true };
    }
  }

  let cmd = `calendar.events.insert --calendarId "${FAMILY_CAL}" --summary "${summary}" --start.dateTime "${startDateTime}" --end.dateTime "${endDateTime}"`;
  if (description) {
    cmd += ` --description "${description.replace(/"/g, '\\"')}"`;
  }
  return gogJSON(cmd);
}

export function createHold(summary, startDateTime, endDateTime, description = '') {
  if (!HOLDS_CAL) {
    return createEvent(`[HOLD] ${summary}`, startDateTime, endDateTime, description);
  }
  let cmd = `calendar.events.insert --calendarId "${HOLDS_CAL}" --summary "${summary}" --start.dateTime "${startDateTime}" --end.dateTime "${endDateTime}"`;
  if (description) {
    cmd += ` --description "${description.replace(/"/g, '\\"')}"`;
  }
  return gogJSON(cmd);
}

export function getNextEvent() {
  const result = getToday();
  if (!result.success) return result;
  const now = new Date();
  const upcoming = (result.data?.items || []).filter(e => {
    const start = new Date(e.start?.dateTime || e.start?.date);
    return start > now;
  }).sort((a, b) => {
    const aStart = new Date(a.start?.dateTime || a.start?.date);
    const bStart = new Date(b.start?.dateTime || b.start?.date);
    return aStart - bStart;
  });
  return { success: true, data: upcoming[0] || null };
}

export default { getToday, getTomorrow, getWeek, createEvent, createHold, getNextEvent };
