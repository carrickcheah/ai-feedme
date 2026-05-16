# docs/

All documentation lives here. The repo root has only `README.md` and `promptfooconfig.yaml` (the eval framework looks for it there).

## Read in this order

1. **[PLAN.md](PLAN.md)** — the master plan; start here. Phase map + repo tour + reuse strategy.
2. **[PHASES.md](PHASES.md)** — per-phase deliverables, deep detail, done-when checklists.
3. **[SCHEMAS.md](SCHEMAS.md)** — SQLite tables, Kafka events, HTTP APIs, MCP tool catalog. The data contracts.
4. **[FLOWS.md](FLOWS.md)** — ASCII sequence diagrams for 6 key flows (anonymous order, VIP, out-of-stock, HITL, dreaming, MemGC profile).
5. **[AGENT_FLOW_KITCHEN_INVENTORY.md](AGENT_FLOW_KITCHEN_INVENTORY.md)** — how the two event-driven agents work, with the [SVG flowchart](agent_flow_kitchen_inventory.svg).

## Demo

- **[DEMO_SCRIPT.md](DEMO_SCRIPT.md)** — 1-page interview walkthrough: boot checklist, 3 wow moments, fallback table.

## Reuse maps (what we lifted from where)

- **[REUSE_OVERVIEW.md](REUSE_OVERVIEW.md)** — synthesis of all three lift maps.
- **[REUSE_AI_AGENTS.md](REUSE_AI_AGENTS.md)** — what to lift from `ai-agents`.
- **[REUSE_AI_CONTACT_BUN.md](REUSE_AI_CONTACT_BUN.md)** — what to lift from `ai-contact-bun` (closest match).
- **[REUSE_MEMGC.md](REUSE_MEMGC.md)** — MemGC public API + integration shape.

## Templates + scenarios

- **[CONTEXT_TEMPLATES.md](CONTEXT_TEMPLATES.md)** — system-prompt scaffolds per agent.
- **[SKILL_TEMPLATES.md](SKILL_TEMPLATES.md)** — domain skills the agents load at runtime.
- **[EVAL_SCENARIOS.md](EVAL_SCENARIOS.md)** — the 30 Promptfoo cases (kept in sync with `evals/golden-set/`).

## Open items

- **[QUESTIONS.md](QUESTIONS.md)** — questions raised during planning that are still open.
- **[PLACEHOLDERS.md](PLACEHOLDERS.md)** — synthetic data items the prototype uses that need real values for production.
