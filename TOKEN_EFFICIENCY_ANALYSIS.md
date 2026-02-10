# PiaB v3 — Token Efficiency Analysis

> How to reduce OpenClaw token consumption 40–60% without compromising coaching quality.

## Token Consumption Surfaces

PiaB has five distinct surfaces where tokens are consumed. Each has specific optimizations.

---

## 1. SKILL.md Injection (~4,700 tokens/turn)

**Problem:** OpenClaw injects the full `SKILL.md` (197 lines) into every system prompt. Column schemas, build phases, and gamification tables are sent on every WhatsApp message — even for "done dishes".

**Fix:** Split into slim runtime prompt + reference file.

**Slim SKILL.md should contain only:**
- Identity (5 lines)
- Core principles (7 lines)
- Script table (7 lines)
- Communication rules (10 lines)
- Intent routing summary (compressed on-message table)

**Move to REFERENCE.md:**
- Column-by-column schemas (_MASTER_LOG 46 cols, INBOX 13 cols, etc.)
- Financial OS tab layouts
- Gamification XP/gold tables
- Build phases
- State file documentation

**Savings: 2,500–3,500 tokens/turn**

---

## 2. Workspace File Duplication

**Problem:** `SOUL.md`, `AGENTS.md`, `TOOLS.md` are injected into every system prompt alongside SKILL.md. If coaching identity, communication rules, or failure modes appear in multiple files, they're double-injected.

**Fix:**
- Canonicalize: each piece of information in exactly one place
- `SOUL.md` → personality/voice only (James=concise, Laura=warm, never-say list)
- `AGENTS.md` → empty or remove (single agent, no routing needed)
- `coach_playbook.yaml` → runtime config consumed by scripts, NOT injected into prompt

**Savings: 500–2,000 tokens/turn**

---

## 3. Conversation History & Tool Results

**Problem:** Tool results from Google Sheets reads (hundreds of rows) accumulate in context over a session.

**Fix:**

### A. Enable context pruning
```yaml
# openclaw.json or gateway config
agents:
  defaults:
    contextPruning:
      mode: adaptive
      softTrimRatio: 0.6
      hardClearRatio: 0.8
      minPrunableToolChars: 500
```

### B. Pre-computed state reads
Ensure on-message handler reads `state/daily_context.json` (few hundred tokens) instead of calling `openclaw tool gog sheets.get` on raw sheets (thousands of tokens).

### C. Cap tool result sizes
Scripts should return only actionable data:
- Top 5 items by `score_now` (not full _MASTER_LOG)
- Only columns needed: title, owner, score, status, micro-step

### D. Strategic compaction
Add `/compact` before data-heavy sessions (e.g., Sunday weekly review).

**Savings: 3,000–15,000 tokens/session**

---

## 4. Expand Gate Middleware (JS-Only Intents)

**Problem:** Several deterministic intents currently route to the LLM when they could be handled entirely in JavaScript — eliminating the entire agent turn.

**Zero-LLM candidates:**
| Intent | Pattern | JS Handler |
|--------|---------|------------|
| Energy log | `energy [1-5]` | regex → `reinforcement.logEnergy()` → canned response |
| Budget capture | `spent $X at Y` | regex → `capture.mjs --action=budget` → canned confirmation |
| Task completion | `done [item]` | fuzzy match → `capture.mjs --action=complete` → canned celebration |
| Grocery add | `groceries: X` | parse → list append → canned confirmation |
| Honey-do add | `honey do: X` | parse → list append → canned confirmation |
| Status query | `status` | read gate.json + streaks.json → formatted response |

Each intent handled in JS saves the full agent turn: ~5,000–8,000 tokens.

**Savings: 5,000–8,000 tokens/message (for JS-handled intents)**

---

## 5. Schema Bloat in Prompt

**Problem:** Full column schemas (~80 lines) are injected every turn but only needed for Sheets writes.

**Fix:**
- Move schemas to `SCHEMAS.md` — agent reads on demand
- Encode column indices in `sheets.mjs` (already done)
- Agent calls `capture.mjs` with semantic args; script handles column placement
- SKILL.md only needs: "column AE = score_now" for priority queries

**Savings: 1,500–2,500 tokens/turn**

---

## Summary

| Optimization | Savings | Quality Impact |
|---|---|---|
| Slim SKILL.md | 2,500–3,500/turn | None |
| Deduplicate workspace files | 500–2,000/turn | None |
| Context pruning (adaptive) | 3,000–15,000/session | None |
| Pre-computed state reads | 2,000–5,000/turn | None |
| JS-only deterministic intents | 5,000–8,000/message | None |
| Schemas to reference file | 1,500–2,500/turn | None |

**Conservative total: 40–60% reduction per reactive message.**

## Implementation Priority

1. **Expand gate middleware** — Highest ROI, eliminates entire LLM turns
2. **Split SKILL.md** — Reduces every single turn
3. **Enable adaptive context pruning** — Quick config change
4. **Pre-computed state reads** — Prevents huge tool results in context
5. **Deduplicate workspace files** — Audit pass
