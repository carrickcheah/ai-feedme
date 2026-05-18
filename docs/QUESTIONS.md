# FeedMe — Open Questions for Review

> Centralized question list — answer at review time.
> Sister doc to `PLAN.md`, `PHASES.md`, `SCHEMAS.md`. Each question links back to the doc/section that surfaced it.

---

## How to answer

For each question:
1. **Pick an option** (or write your own).
2. If picking the recommended option, just write `→ recommended`.
3. If picking your own, write the choice + 1-line rationale.

Example:

> **Q1.2 Currency**: MYR / SGD / USD / mixed?
> **A**: → recommended (MYR for the demo Malaysian restaurant)

---

## 0. Strategic / scope (gates the whole plan)

### Q0.1 Restaurant persona for the demo

What's the demo restaurant? Drives `IDENTITY.md`, `MENU.md`, `TONE.md`.

| Option | Pros | Cons |
|---|---|---|
| **Burger joint** (recommended — matches earlier sketches) | Familiar, simple menu, easy modifiers | Generic |
| Pasta restaurant | More upsell surface (sauces, pasta types) | More menu complexity |
| Sushi bar | Visual menu (could showcase image_url field) | Edge cases galore (raw fish allergens, fresh-stock timing) |
| Coffee shop | Smallest menu, fastest demo | Less impressive — too simple |

**Recommendation**: Burger joint (matches the diagrams and sample data we've already prototyped).

### Q0.2 Restaurant identity name

Pick a fictional name. Examples: "Demo Burger", "Bo's Burgers", "Patty Palace", "FeedMe Cafe".

**Recommendation**: "Demo Burger" — clearly a demo, no brand confusion.

### Q0.3 Restaurant currency

| Option | Notes |
|---|---|
| **MYR** (recommended, ringgit) | Aligns with FeedMe's Malaysian/Singapore market |
| SGD | If demo targets Singapore |
| USD | Generic but loses local flavor |

### Q0.4 Restaurant timezone

For cron schedules (daily owner summary at 9 AM local time).

| Option | Notes |
|---|---|
| **`Asia/Kuala_Lumpur`** (recommended) | Match MYR currency choice |
| `Asia/Singapore` | If demo targets SG |
| (other) | Your call |

### Q0.5 Project hosting target (Phase 5)

| Option | Notes |
|---|---|
| **Fly.io** (recommended) | Easy HTTPS, zero-downtime restart, geographic close to MY/SG |
| Azure VM | Matches `ai-agents` pattern; more setup |
| Render / Railway | Easy but pricier |
| Hetzner / DigitalOcean | Cheap, but manual TLS setup |
| Local-only for now | Skip Phase 5 deploy |

### Q0.6 Does the plan match the SVG architecture?

Each box from `docs/chart_feedme_agent_architecture_v8.svg`:
- Customer touchpoints (Kiosk · Mobile · Web) → Phase 1
- Customer-facing Agent → Phase 1
- Event bus (Kafka) → Phase 2
- Kitchen Agent + Inventory Agent → Phase 2
- 4 MCP servers (POS · KDS · Payment · Supplier) → Phase 1 (POS) + Phase 2 (other 3)
- Redis cache → Phase 0 ✅ + Phase 3 wiring
- MemGC memory layer → Phase 0 ✅ stub + Phase 3 implementation
- Skills repository → Phase 3
- Langfuse → Phase 3
- Promptfoo → Phase 4

**Q**: Is anything missing from the SVG that the plan should add? Anything in the plan beyond the SVG that should be cut?

---

## 1. Architecture / technical decisions

### Q1.1 MemGC bridge approach

Already answered: **Python FastAPI sidecar over HTTP**. ✅

### Q1.2 Event bus

Already answered: **Real Kafka from day 1**. ✅

### Q1.3 DB choice

Already answered: **SQLite everywhere**. ✅

### Q1.4 Frontend approach

Already answered: **One responsive Web App — kiosk + mobile browser + desktop browser**. ✅

### Q1.5 Tenancy

Already answered: **Single tenant prototype**. ✅

### Q1.6 LLM provider order

The Brain module supports multi-provider fallback. What's the priority chain for the customer-facing + kitchen agents (Sonnet-tier)?

| Option | Pros | Cons |
|---|---|---|
| **Anthropic Sonnet (primary) → Azure Sonnet (fallback)** (recommended) | Direct Anthropic API is the fastest; Azure is the rate-limit safety net | Two account vendors to manage |
| Azure Sonnet only | Single billing relationship | If Azure has an issue, total outage |
| Anthropic only | Simplest | No fallback |

### Q1.7 Inventory agent model

| Option | Cost/call | Latency | Notes |
|---|---|---|---|
| **Claude Haiku 4.5** (recommended) | $0.001-0.003 | <2s | Threshold checks + tool calls — Haiku is plenty |
| Claude Sonnet 4.6 | $0.01-0.03 | ~3s | Overkill for the inventory job |
| Local model (Ollama) | $0 | varies | Skip the API entirely for prototype? Risky — model quality matters |

### Q1.8 MemGC embedder choice

| Option | Notes |
|---|---|
| **BGE-M3 local** (recommended — MemGC default) | 1024-d, runs on MPS, no API cost, no rate limits |
| Azure / OpenAI `text-embedding-3-large` | 3072-d, paid API, no local GPU needed |

**Note**: switching dimension later requires re-indexing all memories. Lock this in early.

### Q1.9 Skill activation pattern

| Option | Notes |
|---|---|
| **Agent invokes `load_skill` tool when needed** (recommended — ai-agents pattern) | Token-efficient — only the index is in prompt |
| Eager: always inject full skill body if applicable | Simpler reasoning, more tokens per turn |

---

## 2. UX / restaurant operations

### Q2.1 Combo modeling

| Option | Notes |
|---|---|
| **menu_item with `is_combo + component_skus_json`** (recommended) | One table, simple SKU semantics |
| Explicit `combo` table joined at order time | More queryable, more schema |

### Q2.2 Customer identity

How is a returning customer recognized?

| Option | Pros | Cons |
|---|---|---|
| **Phone number** (recommended for prototype) | Universal, fast — fits MY/SG loyalty norms | PII handling concerns; not anonymous-friendly |
| Email | Standard for online services | Friction at kiosk |
| App login token | Cleanest, future-proof | Requires actual auth system (not in scope) |
| ULID auto-issued, stored in Web App cookie | No PII | Customer loses identity if they switch browser/device |

### Q2.3 Anonymous order flow

When customer doesn't identify, what happens?

| Option | Notes |
|---|---|
| **Allow anonymous (customer_id = null)** (recommended) | Lowest friction; analytics handles nulls |
| Always issue a temp ULID, store in cookie/localStorage | Enables "same session" memory across turns without phone |
| Reject — force identification | Bad UX for walk-in kiosk |

### Q2.4 Tax / SST

Malaysia has 6% SST on F&B. How to handle?

| Option | Notes |
|---|---|
| **Flat % from env (`SST_PERCENT=6`)** (recommended for prototype) | Hard-coded, fast |
| Per-item flag (some items SST-exempt) | More accurate but more complex |
| Restaurant config table | Right answer for multi-tenant, overkill for prototype |

### Q2.5 Comp threshold for HITL

Default: comps above RM10 (1000 cents) need manager approval.

| Option | Notes |
|---|---|
| **RM10** (recommended) | Reasonable for prototype |
| RM5 | More conservative |
| RM20 | More agent autonomy |
| % of order (e.g., >50%) | More nuanced; harder to reason about |

### Q2.6 Refund policy

| Option | Notes |
|---|---|
| **ALL refunds need manager approval (LOCKED)** (recommended) | Safest |
| Refunds <$X auto-approved | Faster but riskier |
| Agent never offers refunds; always escalate | Conservative |

### Q2.7 Upsell aggressiveness

| Option | Notes |
|---|---|
| **Soft suggest once per order** (recommended) | "Want fries with that?" — once, not repeated |
| Aggressive: always upsell, multiple options | More revenue, worse UX |
| Never upsell unless asked | Most respectful, loses revenue |

### Q2.8 VIP discount

When customer has `loyalty_tier = 'vip'`:

| Option | Notes |
|---|---|
| **No automatic discount; agent acknowledges VIP status verbally** (recommended) | Avoids financial commitment in prototype |
| 10% off automatically | Real value but locks pricing logic |
| Premium-only menu items unlocked | Complex |

### Q2.9 Allergen-detection sensitivity

When customer says "I'm allergic to X":

| Option | Notes |
|---|---|
| **Hard-block any menu item containing X; suggest alternatives** (recommended) | Safety-first |
| Warn but allow ("This contains X — are you sure?") | Risky |
| Just log and continue | Negligent |

---

## 3. Data schema decisions (echoes `SCHEMAS.md §7`)

### Q3.1 Modifier data model

| Option | Notes |
|---|---|
| **JSON blob `modifiers_json`** (recommended) | Flexible, fast for prototype |
| Separate `order_line_modifier` table | Queryable for analytics, more schema |

### Q3.2 Order ID format

| Option | Notes |
|---|---|
| **ULID with `ord_` prefix** (recommended — already in plan) | Time-sortable, human-readable |
| UUID v4 | Standard but not sortable |
| Sequential integer | Simple but predictable (potential security issue) |

### Q3.3 Splitting tickets per station

When an order has burgers + fries + drinks, do we:

| Option | Notes |
|---|---|
| **One ticket per station, all linked to same order_id** (recommended) | Each station sees only its work |
| Single ticket, lines tagged by station | One row, but station can't filter |

### Q3.4 Cross-MCP transactions

If POS create_order succeeds but Kafka publish fails, we have a leaked order row.

| Option | Notes |
|---|---|
| **Best-effort + manual reconcile** (recommended for prototype) | Accepts rare inconsistency |
| Outbox pattern (DB row + background pump to Kafka) | Production-grade, more complexity |
| Two-phase commit | Overkill |

### Q3.5 WAL checkpoint cadence

SQLite WAL files can grow. When to truncate?

| Option | Notes |
|---|---|
| **Nightly cron `PRAGMA wal_checkpoint(TRUNCATE)`** (recommended) | Reliable, minimal disruption |
| After every N writes | Tighter but interrupts hot path |
| Never (let SQLite auto-checkpoint) | Risk of unbounded growth |

---

## 4. Per-phase questions

### Phase 1 questions (`PHASES.md §1.7`)

- Q1.7.1 Customer identity primary key (phone vs ULID) — see Q2.2
- Q1.7.2 Combo modeling — see Q2.1
- Q1.7.3 Anonymous order flow — see Q2.3
- Q1.7.4 Tax handling — see Q2.4
- Q1.7.5 Modifier data model — see Q3.1
- Q1.7.6 SKU naming (snake_case recommended)
- Q1.7.7 Currency formatting (cents, format at output) — already decided

### Phase 2 questions (`PHASES.md §2.7`)

- Q2.7.1 `ingredient.consumed` origin (Kitchen Agent — recommended)
- Q2.7.2 86 propagation speed (≤5s acceptable — recommended)
- Q2.7.3 Kafka outbox pattern (skip for prototype — recommended)
- Q2.7.4 Agent process model (single Bun process — recommended)
- Q2.7.5 Kafka idempotency keys (event_id in Redis SET NX — recommended)
- Q2.7.6 Backpressure handling (accept for prototype)
- Q2.7.7 Mid-flow tool failure (eventual consistency — recommended)

### Phase 3 questions (`PHASES.md §3.7`)

- Q3.7.1 Skill activation (load on demand — recommended) — see Q1.9
- Q3.7.2 Profile prefetch timing (first message of session — recommended)
- Q3.7.3 Cache invalidation (TTL-only, no scan — recommended)
- Q3.7.4 PRISM mode override (use `fast` mode for first turn?)

**Q3.7.4 needs answer**: should the first turn of every session bypass the slow PRISM agentic mode? Recommend: NO — let the cache do its job. First call is slow, every subsequent within 5 min is fast.

- Q3.7.5 `consolidate()` schedule (end-of-session — recommended)
- Q3.7.6 Memory write granularity (only on order completion — recommended to save tokens)
- Q3.7.7 Skill priority (concat in priority order — recommended)
- Q3.7.8 Embedder dimension lock — see Q1.8

### Phase 4 questions (`PHASES.md §4.7`)

- Q4.7.1 Comp threshold — see Q2.5
- Q4.7.2 Approval timeout (10 min — recommended)
- Q4.7.3 Manager auth (shared API key for prototype — recommended)
- Q4.7.4 Approval UI surface (same Web App `/manager` route — recommended)
- Q4.7.5 Restart-during-pending behavior (manual recovery — acceptable for prototype)
- Q4.7.6 Eval rubric model (Sonnet 4.6 with temp=0 — recommended)
- Q4.7.7 Eval cost ceiling (~$10/month CI is fine)

### Phase 5 questions (`PHASES.md §5.7`)

- Q5.7.1 Hosting target — see Q0.5
- Q5.7.2 Domain — user provides
- Q5.7.3 TLS (Caddy auto-TLS — recommended)
- Q5.7.4 Daily summary channel:

**Q5.7.4 needs answer**: Email or Slack for owner's daily summary?

| Option | Notes |
|---|---|
| Slack webhook | Easy, real-time |
| Email (SMTP/Resend) | Universal |
| WhatsApp | We dropped Baileys; but the FeedMe app could send WA via Cloud API |

- Q5.7.5 Demo data scale (~15 menu items, 10 ingredients — recommended)
- Q5.7.6 Backup strategy (deferred to v1 — recommended)
- Q5.7.7 Monitoring/alerts (UptimeRobot for /health — recommended)
- Q5.7.8 Cost ceiling ($50/day warning — recommended)
- Q5.7.9 Kafka restart safety (kafkajs handles — verified)
- Q5.7.10 Container user permissions (fix in compose — recommended)

---

## 5. Things the user must provide (domain content)

These are required to make the prototype actually FEEL like a restaurant.

### 5.1 `agents/customer-facing/MENU.md` (Phase 1)

~15 menu items. For each:
- `sku` (snake_case)
- Display name
- Description (1-2 sentences)
- Price (in MYR cents)
- Category (mains / sides / drinks / desserts)
- Station (grill / fry / cold / bev)
- Prep time in seconds
- Allergens list (`["dairy","gluten","soy",...]`)
- Ingredient SKUs needed

**User to provide**: this list.

### 5.2 `agents/customer-facing/IDENTITY.md` + `TONE.md` + `OWNER.md`

- IDENTITY: "I am the FeedMe agent for {restaurant_name}. I help customers order, answer menu questions, handle special requests."
- TONE: 5-10 lines describing voice (e.g., "casual but professional, never sarcastic, brief responses").
- OWNER: name + Slack handle / email for the daily summary.

**User to provide**: these 3 files (~70 lines total).

### 5.3 `agents/kitchen/STATION_MAP.md` (Phase 2)

How menu items route to stations:
- Grill — burgers, grilled items
- Fry — fries, fried sides
- Cold — salads, cold drinks
- Bev — hot drinks

**User to provide**: confirm or adjust mapping.

### 5.4 `agents/inventory/INVENTORY.md` (Phase 2)

For each ingredient:
- ID (`ing_beef_patty`)
- Display name
- Unit (kg / g / unit / liter)
- Par level (reorder threshold)
- Reorder quantity
- Preferred supplier
- Cost per unit

**User to provide**: ~10 ingredients with these fields.

### 5.5 `skills/{upsell,vip_protocol,handle_complaint,allergen_check,86_item_protocol}/SKILL.md` (Phase 3)

5 procedural playbooks. Each ~30-50 lines defining when + how to apply the rule.

**User to provide**: domain rules — these are RESTAURANT operating rules. Sample structure given in `PHASES.md §3.2`.

### 5.6 30 Promptfoo eval scenarios (Phase 4)

- 10 happy paths: typical orders this restaurant gets
- 10 edge cases: out-of-stock, allergen, comp, refund, VIP, complaint, ESL customer, modifications
- 5 red team: prompt injection, PII extraction, indirect injection
- 5 multi-turn: modify, cancel, change-mind, upsell, escalate

**User to provide**: the test bank — describe what should happen for each scenario.

### 5.7 MemGC seed data for Sarah demo (Phase 3)

5-10 facts about "Sarah" (demo VIP customer) to pre-load, so we can demo "agent remembers her":
- "Sarah is a VIP customer"
- "Sarah is allergic to onions"
- "Sarah's phone is +60..."
- "Sarah ordered Mushroom Swiss on 2026-05-10"
- "Sarah always asks for extra crispy fries"

**User to provide**: the 5-10 seed facts.

---

## 6. Risks & policy decisions

### Q6.1 What does "prototype" mean for production data?

When the prototype eventually has REAL customers (vs synthetic test data):

| Question | Recommended answer |
|---|---|
| Can demo data persist past V1 rewrite? | No — V1 starts from a clean DB |
| GDPR / data retention? | Out of scope for prototype; document in V1 |
| Backup strategy? | Skip in prototype; manual SQLite copy if needed |

### Q6.2 What if the customer says something abusive / harmful?

| Option | Notes |
|---|---|
| **Agent refuses, escalates to human** (recommended) | Safety-first |
| Agent terminates session | More aggressive |
| Agent ignores and continues | Worst — appears tone-deaf |

The `escalate_human` skill should handle this.

### Q6.3 What about non-English customers?

FeedMe operates in MY/SG. Customers may speak Bahasa, Mandarin, English mixed.

| Option | Notes |
|---|---|
| **Reply in customer's language; LLM auto-detects** (recommended) | Sonnet handles multilingual well |
| English only for prototype | Limiting for MY/SG market |
| Specific language whitelist | Overcomplicated |

Promptfoo `multi-language` eval suite (mentioned in `ai_brain`) tests this.

### Q6.4 What if MemGC `answer()` times out (>80s)?

| Option | Notes |
|---|---|
| **Return synthesized fallback ("Welcome, how can I help today?") + log** (recommended) | Graceful degradation |
| Block the response | Bad UX |
| Retry once | Doubles latency |

### Q6.5 What if Kafka is unreachable for >5 min?

| Option | Notes |
|---|---|
| **POS continues, events lost; manual reconcile** (acceptable for prototype) | Eventually-consistent |
| Block order creation until Kafka recovers | Bad UX |
| Buffer in-memory + flush when Kafka returns | Complex; outbox pattern |

---

## 7. Out-of-scope (deferred to V1)

These are explicitly NOT in the prototype plan. The user can ask to add any back in.

- Multi-tenancy (per-restaurant data isolation)
- Restaurant signup / onboarding flow
- Per-restaurant billing
- Native mobile apps (iOS / Android)
- WhatsApp / Telegram / WeChat channels
- Voice channel (speech-to-text kiosk)
- POS integration with real systems (Toast, Square)
- Real payment processor (Stripe production)
- Postgres backend
- Multi-language UI (just multi-language responses)
- Manager mobile app (use the existing Web App `/manager` route)
- Customer accounts (no signup flow)
- Loyalty points accrual logic
- Restaurant photos / media uploads
- Multi-location chain support (e.g., "Sarah at Outlet A also at Outlet B")
- Real-time dashboard for kitchen staff (just the KDS data via API)

**Q**: Are any of these blockers for the prototype demo? If so, escalate to in-scope.

---

## 8. Open questions for me (Claude)

These are questions where I'd like clarification from the user even if I have a default:

1. **What's the demo scenario you'll show off?** E.g., "VIP Sarah orders, agent recognizes her, suggests her favorite, places order, Mushroom Swiss runs out, agent recommends Bacon Swiss" — or different? This drives which features get most attention.
2. **Is REMY (the existing FeedMe BI agent) integrated in the prototype, or just mentioned in the architecture diagram?** I see it in the SVG as "shared with REMY (BI agent)" — for the prototype, do we actually wire MemGC to REMY's data, or just make the *architectural claim* that they share memory?
3. **Who's the audience for this prototype?** Demo to FeedMe team / leadership / external prospects? Affects polish bar.
4. **What's the deadline?** Plan estimates 38 days total (Phase 1+2+3+4+5 = 8+10+10+5+5). Aggressive parallelization could compress to 5-6 weeks with 1 senior eng. Need to know target ship date.
5. **Is there a real FeedMe dev team that will continue this?** If yes, the code conventions + observability tooling matter more (handoff). If no, you can be more YOLO.
6. **What's the LLM API budget?** Daily cost projection: ~$1.50-$3.50/day for 100 orders. Acceptable? Cap?
7. **Any branding / visual style for the Web App frontend?** Out of scope here (this plan is backend-focused) but should be flagged if needed.

---

## 9. How to use this doc at review

1. Walk through §0 (strategic) — get the 6 big choices locked
2. Skim §1 (already-decided architecture) — confirm or correct
3. Walk through §2 (UX) — these shape product feel
4. Skim §3 (schema) — most have safe recommended defaults
5. Walk through §4 (per-phase) — answer the (recommended) defaults or push back
6. Critical: confirm §5 (domain content) — what will the user actually contribute?
7. Skim §6 (risks)
8. Confirm §7 (out-of-scope)
9. Answer §8 (questions to me) — these unblock the most

Total review time estimate: **30-45 min** if you skim recommendations.

Once answered, I'll lock the answers into PLAN.md and we proceed to Phase 1 implementation.
