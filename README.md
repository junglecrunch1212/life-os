# PiaB v3 — Personal AI in a Box

Autonomous Chief of Staff & Executive Life Coach for the Stice family ADHD household, running on OpenClaw.

## What This Is

PiaB is a proactive behavioral intervention system grounded in clinical ADHD coaching psychology. It observes, decides, acts, and learns — running 24/7 as an OpenClaw skill.

**This is not a task app.** It's external executive function.

## Architecture

```
observe → decide → act → learn
  ↑                        ↓
  └────────────────────────┘
```

- **Observe**: Read Google Sheets (Life OS + Financial OS), Calendar, Gmail. Compute behavioral signals.
- **Decide**: Apply ADHD coaching playbook. Determine interventions based on failure mode detection.
- **Act**: Send coaching messages via WhatsApp. Capture tasks to INBOX. Update completions. Award XP.
- **Learn**: Analyze response rates, peak hours, message effectiveness. Refine coaching over time.

## Data Sources

| Source | Purpose |
|--------|---------|
| Household Life OS v1.4 (24 tabs) | Tasks, projects, routines, gamification, escalation |
| Stice Financial Planner (11 tabs) | Budget tracking, transactions, balance sheet |
| Google Calendar | Schedule awareness, time blindness prevention |
| Gmail | Bill detection, deadline flagging |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run setup verification
node scripts/setup.mjs --dry-run

# 3. Run tests
node scripts/test.mjs

# 4. First observation (requires OpenClaw + gog auth)
node scripts/observe.mjs

# 5. Install as OpenClaw skill
openclaw skill install piab
```

## Configuration

All config lives in `config/`:
- `connections.yaml` — Sheet IDs, calendar IDs, Gmail settings
- `household.yaml` — People, ADHD profiles, channel preferences
- `coach_playbook.yaml` — Coaching modes, failure interventions, gamification rules

## Build Phases

See `SKILL.md` for the complete 8-phase build process. Checkpoints stored in `~/piab-build/checkpoints/`.

## License

Private. Stice family use only.
