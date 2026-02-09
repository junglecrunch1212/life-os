# HEARTBEAT — PiaB v3 Gate-Aware Coaching Loop

## Schedule

| Time | Script | Details |
|------|--------|---------|
| 00:00 | `gate/gate-reset.mjs` | Reset gate to LOCKED_MORNING, clear intentions |
| 06:00 | `observe.mjs` | Full data read (sheets, calendar, budget) |
| *on pillar* | `decide.mjs --mode=on_tier1` | Morning briefing fires on TIER_1 transition |
| 11:30 | `gate/deadline-check.mjs --deadline=tier2` | Warn if not at TIER_2 |
| 12:00 | `gate/grace-check.mjs` | Auto-grant grace day if 0 pillars |
| 13:00 | `decide.mjs --mode=midday` | Midday check-in (silenced on crash) |
| 15:00 | `gate/deadline-check.mjs --deadline=tier3` | Warn if not at TIER_3 |
| 17:00 | `gate/deadline-check.mjs --deadline=lockout` | Lock if not FULL_ACCESS |
| 17:00 | `observe.mjs` | Refresh signals |
| 19:30 | `decide.mjs --mode=evening` | Evening close + intention collection |
| 20:00 | `gate/gate-protect.mjs` | Force LOCKED_NIGHT |
| 23:00 | `gate/streak-check.mjs` | Update streaks, check milestones |
| Sun 18:00 | `gate/weekly-compute.mjs` | Full weekly scorecard |
| Sun 18:00 | `decide.mjs --mode=weekly` | Laura friction prompt, buddy scorecard |
| 02:00 | `backup.mjs` | Daily backup |

## Cron Configuration

```yaml
cron:
  # Gate management
  - schedule: "0 0 * * *"
    command: "node scripts/gate/gate-reset.mjs"
  - schedule: "30 11 * * 1-5"
    command: "node scripts/gate/deadline-check.mjs --deadline=tier2"
  - schedule: "0 12 * * 1-5"
    command: "node scripts/gate/grace-check.mjs"
  - schedule: "0 15 * * 1-5"
    command: "node scripts/gate/deadline-check.mjs --deadline=tier3"
  - schedule: "0 17 * * 1-5"
    command: "node scripts/gate/deadline-check.mjs --deadline=lockout"
  - schedule: "0 20 * * *"
    command: "node scripts/gate/gate-protect.mjs"
  - schedule: "0 23 * * *"
    command: "node scripts/gate/streak-check.mjs"

  # Coaching loop
  - schedule: "0 6 * * *"
    command: "node scripts/observe.mjs"
  - schedule: "0 13 * * 1-5"
    command: "node scripts/observe.mjs && node scripts/decide.mjs --mode=midday"
  - schedule: "0 17 * * *"
    command: "node scripts/observe.mjs"
  - schedule: "30 19 * * *"
    command: "node scripts/observe.mjs && node scripts/decide.mjs --mode=evening"

  # Weekly
  - schedule: "0 18 * * 0"
    command: "node scripts/gate/weekly-compute.mjs && node scripts/decide.mjs --mode=weekly"

  # Maintenance
  - schedule: "0 2 * * *"
    command: "node scripts/backup.mjs"
  - schedule: "0 3 * * 0"
    command: "node scripts/learn.mjs"
```

## Key Behavioral Rules

1. **Morning briefing fires on TIER_1 transition, not on a clock.** When James sends his first pillar photo, the gate transitions and triggers the briefing.

2. **Crash detection = silence.** If 0 pillars + 0 responses by 1 PM, do NOT send the midday check-in. Silence is the coaching decision.

3. **Grace day is automatic.** If 0 pillars by noon and grace not used this week, it auto-activates. User never has to ask (asking = admitting failure = shame).

4. **Evening close collects implementation intentions.** The if-then plan for tomorrow is read back in the morning briefing.

5. **Streaks are checked at 11 PM.** If no pillar completion today and no grace day, streaks reset.

6. **Sunday is review day.** Full scorecard, Laura friction score, financial stake evaluation, accountability buddy update.
