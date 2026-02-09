# HEARTBEAT — PiaB v3 Scheduled Coaching Loop

This document defines the heartbeat schedule for the PiaB coaching system. Each heartbeat triggers an observe-decide-act cycle.

## Schedule

| Time | Action | Details |
|------|--------|---------|
| 06:00 | **Full Observe** | Read all data sources, compute signals |
| 06:30 | **Morning Briefing** | Send individual briefings to James and Laura |
| 09:00 | **Mini Observe** | Check for new escalation items, calendar proximity |
| 12:00 | **Midday Check** | Nudge if no completions yet |
| 15:00 | **Afternoon Nudge** | Nudge if completions < 2 and before fade_after |
| 17:00 | **Mini Observe** | Check escalation queue, routine due dates |
| 20:00 | **Evening Close** | Send shared evening summary |
| 23:00 | **Streak Check** | Verify daily streaks, update gamification |
| 02:00 | **Backup** | Run backup.mjs |

## Heartbeat Execution

Each heartbeat runs:

```bash
# Full observe cycle
node scripts/observe.mjs
node scripts/decide.mjs --mode=auto
# Decisions are written to state/decisions.json
# OpenClaw reads decisions and sends messages via configured channels
```

## Escalation Queue Check

During each observe cycle, check `_ESCALATION_QUEUE` for items needing human decision:
- Items with `days_stagnant > 7` and `commitment_level = "hard"` get escalated
- Items with `days_stagnant > 14` regardless of commitment get flagged
- Each escalation item gets ONE nudge per day maximum

## Routine Overdue Check

Check `_ROUTINES` for overdue items:
- Compare `next_due` column against today's date
- Surface overdue routines in morning briefing
- Don't create duplicate tasks for routine items — just nudge

## Streak Maintenance

At 23:00 daily:
1. Read `_GAME_PLAYERS` for each person
2. Check if `streak_last_date` is today
3. If YES: streak continues (already updated by task completion)
4. If NO: streak breaks — set `streak_current = 0`
5. Log streak status to `_GAME_LOG`

## Saturday Special

On Saturdays:
1. Read `_SATURDAY_THEMES` and pick least-recently-used theme
2. Include theme in morning briefing
3. Update `last_used` and `use_count` in the sheet

## Financial Pulse

Weekly (Mondays at 06:00):
1. Run `budget.getMoneyPulse()`
2. If status is `red` or `yellow`, include in morning briefing
3. If merchant overages detected, surface in coaching

## Cron Configuration (for OpenClaw)

```yaml
cron:
  - schedule: "0 6 * * *"
    command: "node scripts/observe.mjs && node scripts/decide.mjs --mode=morning"
  - schedule: "30 6 * * *"
    command: "node scripts/decide.mjs --mode=morning"
  - schedule: "0 9 * * *"
    command: "node scripts/observe.mjs"
  - schedule: "0 12 * * *"
    command: "node scripts/decide.mjs --mode=midday"
  - schedule: "0 15 * * *"
    command: "node scripts/decide.mjs --mode=afternoon"
  - schedule: "0 17 * * *"
    command: "node scripts/observe.mjs"
  - schedule: "0 20 * * *"
    command: "node scripts/decide.mjs --mode=evening"
  - schedule: "0 23 * * *"
    command: "node scripts/learn.mjs"
  - schedule: "0 2 * * *"
    command: "node scripts/backup.mjs"
```
