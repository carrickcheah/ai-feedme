# 004 — Guardrails / Safety

> Harness sub-domain #4. Question it owns: **"What is the agent forbidden to do?"**
> (Renamed Boundaries → Guardrails — common word, no jargon.)
> Demo tenant: Awesome Healthcare (synthetic data).

## What guardrails are

**Guardrails = the things the agent is NOT allowed to do, even if it tries.**

Think of the AI like a **new staff member** at Awesome Healthcare. Smart, but you don't fully
trust them yet — so you set rules they *physically cannot* break:

- 🔒 **Rule 1 — "You can only see YOUR clinic's patients."**
  The AI might try to look up another clinic's patient. The system blocks it automatically —
  the AI doesn't even get to choose which clinic. It's like a keycard that only opens your floor.

- 🔒 **Rule 2 — "You cannot give refunds by yourself."**
  If the AI tries to refund money, the system stops it and says *"a human must approve this first."*
  The AI can ask, but it can't do it alone.

- 🔒 **Rule 3 — "Don't show patients our internal notes."**
  The AI sometimes writes internal tags for itself. The system erases them before the patient
  sees the message.

That's it. Three locks. The AI is talented but **caged** — it can only do safe things.

## Where guardrails belong: CODE, not prompt

- **Code = deterministic** → the refund function blocks **100% of the time**, every time, guaranteed.
- **LLM = probabilistic** → it follows the prompt *most* of the time, but not always. Maybe 98%.
  For safety, 98% is a disaster — that 2% is a leaked patient record or a wrongful refund.

You can't protect money or patient data with "probably." You need a **guarantee**.
Only code gives a guarantee.

```
Guardrail in PROMPT  →  LLM decides     →  probabilistic  →  ~98% (unsafe)
Guardrail in CODE    →  system decides  →  deterministic  →  100% (safe)
```
