# Agent prompts

System prompts for the three agents, externalized from code so you can edit them without touching TypeScript.

| File | Used by |
|---|---|
| `customer-facing.md` | `src/agents/customer-facing.ts` — `buildSystemPrompt()` |
| `kitchen.md` | `src/agents/kitchen.ts` — `buildKitchenPrompt()` |
| `inventory.md` | `src/agents/inventory.ts` — `buildInventoryPrompt()` |
| `loader.ts` | tiny synchronous reader with `{{var}}` substitution; loaded once per file at module init, cached |

## Placeholder syntax

`{{name}}` placeholders are filled at call time from the `vars` map passed to `loadPrompt(name, vars)`.

| Prompt | Variables it uses |
|---|---|
| customer-facing | `restaurant_name`, `channel`, `session_id`, `customer_id` |
| kitchen | `restaurant_name` |
| inventory | `restaurant_name` |

Unknown placeholders are left in place (e.g. `{{undefined_var}}` stays literal) so misuses show up in traces instead of silently becoming `undefined`.

## Editing workflow

1. Edit the `.md` file.
2. Commit + push.
3. The self-hosted runner on ai-kiss-me rebuilds the image and restarts containers. New prompt is live in ~30s.

For local dev, `bun --watch src/index.ts` does NOT auto-reload on `.md` changes (Bun's watcher tracks imports, not arbitrary reads). Restart `bun run dev` after editing a prompt.

## Why externalize?

- Prompts diff cleanly in PRs (.md vs inline TS template literals)
- Non-engineers can tweak agent behaviour without touching code
- Keeps `src/agents/*.ts` focused on flow control, not copy
