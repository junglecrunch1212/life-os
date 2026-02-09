# on-message Hook — PiaB v3 Inbound Message Handler

When a message arrives from a household member, process it through the following pipeline:

## 1. Identify Sender
Map the incoming WhatsApp JID or phone number to a person key (james/laura) using `config/household.yaml`.

## 2. Determine Intent
Parse the message to determine what the user wants:

| Pattern | Intent | Action |
|---------|--------|--------|
| "add [task]", "remind me to [task]", "I need to [task]" | Task capture | `capture.mjs --action=task` |
| "done [item]", "finished [item]", "completed [item]" | Task completion | `capture.mjs --action=complete` |
| "spent $X at Y", "$X at Y" | Budget capture | `capture.mjs --action=budget` |
| "add to grocery list: X", "groceries: X" | Grocery list | `capture.mjs --action=grocery` |
| "honey do: X", "add to honey do: X" | Honey-do list | `capture.mjs --action=honey_do` |
| "what should I do?", "what's next?" | Priority query | Read `state/coach_signals.json`, return top by score |
| "how's the budget?", "money check" | Budget query | Run `budget.getMoneyPulse()` |
| "what's on the calendar?" | Calendar query | Run `calendar.getToday()` |
| "status", "how am I doing?" | Status query | Read signals, show completions/streak/XP |
| "start", "let's go" | Start timer | Acknowledge, set 25-min Pomodoro context |
| Emotional/venting | Support | Validate feelings, don't push tasks |

## 3. Execute and Respond
- Run the appropriate capture/query script
- Format the response using the person's preferred tone (concise for James, warm for Laura)
- Log the interaction to `capture_ledger`

## 4. Safety Rails
- Never process messages during quiet hours (9 PM - 6 AM) unless urgent
- If 5+ messages without response, back off
- If message seems distressed, prioritize emotional support over task management
- Never reveal internal scoring or coaching strategy to users
