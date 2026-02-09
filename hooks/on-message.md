# on-message Hook — PiaB v3 Inbound Message Handler
# Gate-aware: messages are intercepted at middleware level before reaching LLM.

## 0. Gate Middleware (BEFORE LLM)

The gate check runs FIRST, in JavaScript, not in the prompt. The LLM never sees
the message if the user is locked.

```
gate.shouldProcess(message)
  → { allow: true }  → proceed to step 1
  → { allow: false, response: "🔒 ..." } → send canned response, STOP
```

If the message is a pillar claim (photo + keyword), it bypasses the gate and
routes directly to `pillars.verifyPillarClaim(message)`.

If the message is "EMERGENCY BYPASS", it routes to `gate.handleEmergencyBypass()`.

## 1. Identify Sender
Map the incoming WhatsApp JID to a person key (james/laura) using `config/household.yaml`.

## 2. Determine Intent (only if gate allows)

| Pattern | Intent | Action |
|---------|--------|--------|
| Photo + pillar keyword | Pillar claim | `pillars.verifyPillarClaim()` → update gate → send briefing if TIER_1 |
| "EMERGENCY BYPASS" | Bypass | `gate.handleEmergencyBypass()` |
| "add [task]", "remind me to [task]" | Task capture | `capture.mjs --action=task` |
| "done [item]", "finished [item]" | Task completion | `capture.mjs --action=complete` |
| "spent $X at Y" | Budget capture | `capture.mjs --action=budget` |
| "groceries: X" | Grocery list | `capture.mjs --action=grocery` |
| "honey do: X" | Honey-do list | `capture.mjs --action=honey_do` |
| "what should I do?" | Priority query | Top by score_now from signals |
| "body double me", "pomodoro" | Body double | `bodyDouble.startSession()` |
| "start [task]" | Task start | `bodyDouble.startSession()` + log initiation |
| Done/Working/Stuck (during session) | Body double response | `bodyDouble.handleCheckInResponse()` |
| "how's the budget?" | Budget query | `budget.getMoneyPulse()` |
| "status" | Status query | Gate state + signals + streaks |
| If [trigger], then [action] | Implementation intention | `intentions.storeIntention()` |
| "energy [1-5]" | Energy log | `reinforcement.logEnergy()` |
| Emotional/venting | Support | Validate feelings, don't push tasks |

## 3. Post-Action: Variable Reinforcement

After any pillar completion or task completion:
- 30% chance: send a reinforcement message (`reinforcement.getReinforcementMessage()`)
- 10% chance: send a data insight (`reinforcement.getDataInsight()`)
- If milestone hit: send milestone message

## 4. Post-Action: Bookend Check-ins

If honey-do pillar completed and `social_accountability.laura_bookend_checkins` is enabled:
- Send Laura: `social.getBookendComplete(taskTitle)`

## 5. Self-Initiation Tracking

Log whether this action was self-initiated or followed a nudge:
- If action occurs within 30 min of an OpenClaw suggestion → `initiated_by: 'nudge'`
- Otherwise → `initiated_by: 'self'`

## 6. Safety Rails
- Gate middleware blocks ALL non-pillar messages during LOCKED states
- Quiet hours (9 PM - 6 AM): gate handles via LOCKED_NIGHT
- Social engineering attempts get progressively less response (see gate.mjs)
- If 5+ messages with no pillar claim during LOCKED, stop responding entirely for 15 min
- Never reveal internal scoring, gate logic, or coaching strategy to users
