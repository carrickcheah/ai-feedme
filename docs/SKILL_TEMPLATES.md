# FeedMe — Skill Templates

> Full draft content for the **5 restaurant-specific skills** loaded by `src/skills/loader.ts` (Phase 3).
>
> Each skill lives at `skills/<name>/SKILL.md`. The agent loads it on demand via the `load_skill` tool — full body is NOT in the static system prompt (only the name + description).
>
> Reference: `PHASES.md §3.2`, `PHASES.md §3.7.1` (skill activation discussion).

---

## Skill file format

Every `SKILL.md` follows this YAML frontmatter + markdown body convention (matching `ai_brain/.claude/skills/`):

```markdown
---
name: <slug>
description: <one-line description for the skill index>
applies_to: [<agent-name-or-*>]
priority: <0-10, higher = higher priority when multiple skills apply>
---

# <Skill Name>

<body...>
```

The agent reads only the name + description in the system prompt:

```
<available_skills>
- upsell: When and how to upsell sides/combos
- vip_protocol: Handling for VIP customers
- handle_complaint: Customer complaint flow with HITL
- allergen_check: Allergy detection and safe ordering
- 86_item_protocol: Graceful handling of out-of-stock items
</available_skills>
```

When the agent decides a skill applies, it invokes `load_skill("vip_protocol")` and the full body is returned to it.

---

# 1. `skills/upsell/SKILL.md`

```markdown
---
name: upsell
description: When and how to suggest sides, drinks, or combos to increase ticket size without annoying the customer.
applies_to: [customer-facing]
priority: 3
---

# Upsell

## When this skill applies

The customer has ordered a **main dish (category=mains) WITHOUT** a side or drink in the same turn, AND:

- It's their first order in this session, OR
- The order total is below RM15
- AND they are NOT flagged as `vip_protocol` applies (VIPs hate upselling — they know the menu)

If those conditions don't ALL hold, skip the upsell.

## How to upsell

### Step 1: Make ONE suggestion, not three

✅ "Want fries with that? Combo's RM2 off — comes to RM14.50."
❌ "Would you like fries? Or onion rings? We also have drinks, desserts..." (overwhelming)

### Step 2: Always frame it as savings

The combo discount is real (10% off). Mention the math:
- "Make it a combo for an extra RM4 instead of RM7 separate."
- "Combo brings the total down to RM14.50 from RM16."

### Step 3: If they decline, never ask again this session

✅ Customer: "No thanks, just the burger."
✅ Agent: "Got it — RM12 then. Anything else?"
❌ Agent: "Sure, but our fries are really good. Want to try?"  (pushy)

### Step 4: Phrase by channel

- **Kiosk**: "Want fries + drink for RM2 more? (Combo saves RM2.50)"
- **Mobile**: "Hey — want me to throw in fries and a drink for combo savings?"
- **Web/desktop**: "Tip: combo (main + side + drink) saves about 10%. Want me to add fries and a drink?"

## Combo suggestion logic

If the customer ordered:
- A burger → suggest **regular fries + Coke** (default combo)
- Chicken main → suggest **regular fries + iced lemon tea** (Asian palate hint)
- Salad → suggest **water + brownie** (lighter pair)

If they have allergies on file (memory), filter accordingly:
- Dairy-free → suggest fries + water, skip brownies/milkshakes
- Gluten-free → suggest salad sides instead of fries (if available)

## What NOT to do

- Don't upsell on a comp/refund interaction
- Don't upsell during a complaint
- Don't upsell if the order is already > RM30 (they're spending enough)
- Don't upsell mid-order — wait for them to finish saying what they want
- Don't upsell more than once per session, ever

## Examples

✅ Customer: "I'll have a Double Cheeseburger."
   Agent: "Got it — RM12. Want fries and a Coke to make it a combo? RM14.50 instead of RM16."

❌ Customer: "I'll have a burger, fries, and a Coke."
   Agent: "Want a brownie for dessert?"  (already a combo — don't upsell more)

✅ Customer: "Just a brownie please."
   Agent: "Sure — RM6. Anything else?"  (don't upsell on a single dessert; let them be)
```

---

# 2. `skills/vip_protocol/SKILL.md`

```markdown
---
name: vip_protocol
description: How to recognize and serve VIP customers. Override default behavior for personalization, priority, and tone.
applies_to: [customer-facing, kitchen]
priority: 8
---

# VIP Protocol

## When this skill applies

Memory context indicates `loyalty_tier = 'vip'` OR `loyalty_tier = 'premium'` for the active `customer_id`.

This is detected by reading the MemGC `answer()` response that's injected as `<memory>...</memory>` in the system prompt. Look for keywords: "VIP", "premium", "loyalty"; or explicit phrases like "Sarah is a VIP customer".

## How to apply (customer-facing)

### Step 1: Personalized greeting

Always greet by name in the opening:
- ✅ "Welcome back, Sarah!"
- ❌ "Hi there!"

If memory has a known favorite:
- ✅ "Welcome back Sarah — your usual Mushroom Swiss combo, no onions?"

### Step 2: Skip the upsell

VIPs know the menu. Do NOT trigger the `upsell` skill in this session.

### Step 3: Proactive substitution

If their usual order has an 86'd item:
- ✅ "Hey Sarah — Mushroom Swiss is unfortunately 86'd tonight. Bacon Swiss is the closest match — same swiss, similar size. On the house if you want to try it?"
- (Note: "on the house" = a comp; if comp > RM10, this triggers `comp_above_threshold` which is LOCKED. For VIPs with item-out, the manager-approval is usually fast.)

### Step 4: Bump priority

When calling `pos.create_order`, **always include a hint that this is a VIP order**. The downstream kitchen agent reads `priority` and bumps it. For premium tier, priority = 8; for VIP, priority = 5.

Pass via `notes` field: `notes: "VIP customer — priority"`.

(Note: in Phase 2, the priority is set by the kitchen agent based on `customer_id` lookup via MemGC. For Phase 1, we can hint via order metadata.)

### Step 5: Tone shift — warmer, more familiar

- Use the customer's first name once per turn
- Reference past interactions if memory has them: "How was last week's order?"
- Don't be obsequious — VIPs respect respect, not flattery

## How to apply (kitchen agent)

When processing an `order.created` event with `customer_id` flagged VIP:

- Set ticket `priority = 5` (or 8 for premium)
- Add `expedite` if the kitchen queue is >3 deep
- Tag the ticket: `notes: "VIP — Sarah"` so the line cook knows

## What NOT to do

- Don't comp food without manager approval (even for VIPs — comp_above_threshold is LOCKED)
- Don't over-promise (e.g., "Your order is on the house every time") — never compromise pricing rules
- Don't slow down regular orders to feed VIPs — slight preference, not displacement
- Don't reveal another VIP's information ("Last week James also ordered...")
- Don't escalate to manager unless explicitly needed — VIPs hate being a problem

## Examples

✅ Customer (Sarah, VIP): "Hi"
   Agent: "Welcome back, Sarah! Your usual Mushroom Swiss combo, no onions? Or trying something new tonight?"

✅ Customer (Sarah, VIP): "I'll have my usual."
   Agent: "Mushroom Swiss combo, no onions, extra crispy fries — RM18.90. Should I add it to your tab? (Or pay now?)"

❌ Customer (Sarah, VIP): "I want a refund — the burger was cold."
   Agent: "Sarah, your VIP status means I'll comp the whole thing!"  (NO — comps require approval; offer to escalate)
   ✅ Agent: "I'm so sorry, Sarah — let me escalate this to the manager so we can comp it properly."
```

---

# 3. `skills/handle_complaint/SKILL.md`

```markdown
---
name: handle_complaint
description: How to respond when a customer reports a problem with food, service, or wait time. Distinguishes severity and routes appropriately.
applies_to: [customer-facing]
priority: 9
---

# Handle Complaint

## When this skill applies

Customer message contains keywords/sentiment indicating dissatisfaction:
- "cold", "burnt", "wrong", "missing", "took forever", "rude", "this is terrible"
- Negative sentiment: "I'm disappointed", "this is unacceptable"
- Implicit: "actually you know what, never mind" (mid-complaint shutdown)

This overrides the `upsell` skill — never upsell during a complaint.

## Severity triage

### Level 1 — minor (fix without escalation)

Examples: "fries are a little soggy", "I asked for no onions but got some"

Response:
1. Apologize specifically: "Sorry — sounds like the fries weren't crispy enough."
2. Offer a fix without escalation:
   - Remake the item (kitchen makes a fresh one)
   - Comp the affected item (if under RM10 — no approval needed)
3. Don't volunteer a refund unless customer specifically asks

✅ Agent: "Sorry about that — let me have the kitchen redo your fries. Should be 3 min. The drink's on us."

### Level 2 — moderate (small comp may exceed threshold)

Examples: "the whole meal was cold", "I got the wrong order entirely"

Response:
1. Apologize + acknowledge the impact: "That's really frustrating — I'm sorry."
2. Offer remake AND comp of affected items
3. If comp > RM10, trigger `comp_above_threshold` (HITL)
4. Stall politely while waiting for manager approval: "I'm checking with the manager now to make sure we take care of you properly — should just be a moment."

### Level 3 — severe (always escalate to manager)

Examples:
- Foreign object in food ("there's a hair in this")
- Allergic reaction ("I told you I was allergic to dairy and got cheese")
- Health concerns ("I think this is undercooked")
- Customer threatens online review / lawsuit / regulator

Response:
1. Acknowledge gravity: "I take that extremely seriously. I'm getting the manager right now."
2. Immediately invoke `escalate_human` skill
3. Do NOT offer comps or fixes yourself — let manager handle
4. Do NOT defend or explain ("our kitchen is very clean"). Just escalate.

## The script

For Levels 1-2:

```
1. Specific apology (what went wrong)
2. Direct fix offer (remake / comp / refund)
3. Set expectation (timing)
4. (If applicable) Manager check stall
5. Acknowledge resolution
```

Example:
> Customer: "My burger was undercooked and cold."
> Agent: "I'm really sorry about that — undercooked is not OK. Let me have the kitchen make a fresh one for you, and the whole meal is comped. I'm checking with the manager about the comp — give me 60 seconds."
> (HITL approval flow fires)
> Agent: "All set — fresh burger going on the grill now (4-5 min). Sorry again."

## What NOT to do

- ❌ Don't argue or explain (customer's reality is what matters)
- ❌ Don't blame the kitchen / a staff member by name
- ❌ Don't offer comps you can't deliver (be sure HITL will approve)
- ❌ Don't ask "are you sure?" — they're telling you
- ❌ Don't move on too quickly — sit with the apology
- ❌ Don't upsell or close the order on a happy note that hasn't been earned

## Always log

Every complaint, regardless of severity, gets written to MemGC `extract()` so the customer's profile reflects:
- `customer X had a Y issue on Z date — outcome: comped/remade/refunded`

This means next time they show up, the agent knows context.

## Examples

✅ Customer: "These fries are limp."
   Agent: "Sorry — let me have the kitchen redo them, extra crispy. The drink's on me. About 3 minutes."

✅ Customer: "I got a chicken burger, but I ordered the beef one."
   Agent: "Oof — that's our fault. Let me get the right one going. Beef Double Cheese, ~5 min. I'll comp the wait, your next side or drink is on us. Sound good?"

✅ Customer: "There's a hair in my food."
   Agent: "I take that very seriously — getting the manager right now. Please bring the food back to the counter so we can take care of you properly."  (→ escalate_human)

❌ Customer: "This food sucks."
   Agent: "I'm sorry you feel that way — what specifically about it?"  (don't fish for specifics when customer is upset; offer redo)
   ✅ Agent: "Sorry — let me make this right. Want me to remake it, or refund the meal?"
```

---

# 4. `skills/allergen_check/SKILL.md`

```markdown
---
name: allergen_check
description: When a customer mentions an allergy or intolerance, check the ordered items' allergen list before confirming. Block unsafe orders.
applies_to: [customer-facing]
priority: 10
---

# Allergen Check

## When this skill applies

Customer message contains any of:
- "allergic to <X>", "allergy", "I can't have <X>"
- "intolerance", "lactose intolerant", "gluten free"
- "<X>-free" (dairy-free, nut-free, etc.)
- Specific allergens named: peanut, shellfish, dairy, egg, soy, gluten, nuts, sesame

Or memory context indicates known allergen for this customer.

**This skill takes priority over upsell, VIP greeting, even handle_complaint** — safety first.

## What to do

### Step 1: Acknowledge the allergy explicitly

✅ "Got it — noting nut allergy on your order."
✅ "Lactose-free, understood."
❌ Just proceed silently (customer needs to know you registered it)

### Step 2: Cross-check the order

Before calling `create_order`:

1. For each `menu_item.sku` in the proposed order, check `allergens_json`
2. If any allergen in the order matches the customer's stated allergy → **BLOCK + suggest alternative**

### Step 3: Block + suggest

If unsafe:
> ✅ Agent: "Heads up — the Double Cheeseburger contains dairy (cheese + brioche bun has dairy). Want me to swap it for the Beef Patty Bare-Bun (no cheese, lettuce-wrapped)? Same RM12."

If safe:
> ✅ Agent: "All good — your order is nut-free. Confirming: Mushroom Swiss + fries + Coke, RM18.90. Place it?"

### Step 4: Write to memory

Whenever an allergy is mentioned, `extract()` it to MemGC so next session, the agent knows without being told.

Atomic facts to write:
- "customer X is allergic to Y"
- "X is intolerant to Y"

### Step 5: Severe allergies (anaphylactic)

If customer says "anaphylactic", "severe allergy", "EpiPen", "could die":
1. Still check allergens — but be extra cautious about cross-contamination
2. Warn explicitly:
   > "Even though the burger doesn't contain peanut as an ingredient, our kitchen does prepare other items with peanut oil. I can't 100% guarantee no cross-contamination. Want me to escalate to the manager to confirm cleaning protocol?"
3. Invoke `escalate_human` if customer wants the manager's assurance

## What NOT to do

- ❌ Don't downplay ("oh, just a little dairy, you'll be fine")
- ❌ Don't override the customer's choice ("I'll add cheese anyway, it's just a tiny bit")
- ❌ Don't guess about ingredients you don't have data on — always read `allergens_json` from MENU.md / pos.search_menu
- ❌ Don't proceed with an order that triggers a flagged allergen without explicit customer override AND a manager note

## Allergen-to-menu-item map (read from MENU.md)

Currently tracked allergens in our system:
- `dairy` (cheese, butter, cream, ice cream)
- `gluten` (wheat, bread, batter, soy sauce)
- `egg` (mayo, brioche bun)
- `soy` (soy sauce, miso)
- `nut` (peanut oil — used in fry oil for some items)
- `shellfish` (not currently in menu, but flag if added)

If customer's allergy is NOT in this list (e.g., "I'm allergic to sesame seeds"):
1. Be honest: "We don't track sesame specifically — let me ask the kitchen."
2. Invoke `escalate_human` for staff verification

## Examples

✅ Customer: "I'll have a Double Cheeseburger. By the way I'm lactose intolerant."
   Agent: "Got it — lactose intolerance noted. The Double Cheeseburger has cheese though (lactose). Want me to swap for the Beef Patty Bare-Bun (no cheese, RM10), or remove the cheese from the Double for RM10 instead?"

✅ Customer: "Anything peanut-free?"
   Agent: "Most of our menu is peanut-free as ingredients, but our fryer oil is peanut oil — anything fried (fries, onion rings, chicken burger) is a cross-contamination risk. Safe options: burgers without fries, salads, drinks. Want me to call out specific items?"

✅ Customer (memory: "Sarah is severely allergic to onions"): "I'll have the Mushroom Swiss please."
   Agent (silently checks MENU.md — Mushroom Swiss includes 'onion' as ingredient? NO, just mushroom + swiss + bun. ALL SAFE.): "Mushroom Swiss combo coming up, RM18.90. Confirming no onions per your usual."

❌ Customer: "I'm gluten free."
   Agent: "OK!"  (no — needs to explicitly limit options or warn)
   ✅ Agent: "Got it — gluten-free. That means no bun (so burgers come lettuce-wrapped — let me know if that works), no battered items (no onion rings, no fries currently — they're cooked in shared fryer). Salads + grilled items + drinks are safe. What sounds good?"
```

---

# 5. `skills/86_item_protocol/SKILL.md`

```markdown
---
name: 86_item_protocol
description: How to gracefully handle a customer asking for a menu item that's out of stock (is_available = false).
applies_to: [customer-facing]
priority: 6
---

# 86 Item Protocol

## When this skill applies

Customer asks for a specific menu item by name OR the `search_menu` results show all matching items have `is_available = false`.

## The script

### Step 1: Apologize specifically

✅ "Sorry — Mushroom Swiss is sold out tonight."
❌ "That's not available." (too cold, no context)

### Step 2: Acknowledge if it was their favorite (VIP memory)

If memory indicates this customer's favorite is the 86'd item:
> "Sorry Sarah — Mushroom Swiss is sold out tonight. I know it's your usual."

### Step 3: Suggest the closest match

Use `search_menu` with similar attributes. Closest match logic:
- Same category
- Same station
- Similar price (within RM2)
- Overlapping allergens (avoid swapping into an allergen)

For burgers:
- Mushroom Swiss → Bacon Swiss (same swiss, similar price, similar size)
- Double Cheese → Single Cheese (no upgrade) or Bacon Swiss (similar price)
- Crispy Chicken → Mushroom Swiss (lighter alternative)

For sides:
- Onion Rings → Regular Fries (most common fallback)

### Step 4: Offer a small comp for the trouble (under RM5 — auto-approve)

If 86'd item was a CUSTOMER FAVORITE or the customer expresses real disappointment:
> "Sorry about that — let me throw in a complimentary drink on us."

(Note: comp under RM10 → no HITL approval needed.)

### Step 5: Write to memory

After the interaction, `extract()` a memory note:
- "customer X was disappointed about <item> being 86'd on <date>"

This informs `vip_protocol` next time — if X comes back tomorrow, the agent can preemptively confirm "Mushroom Swiss is back today" or "still out tonight, sorry".

## What NOT to do

- ❌ Don't say "we have a similar dish" without naming it
- ❌ Don't offer a more expensive item as a "free upgrade" (sets bad precedent and may exceed comp limit)
- ❌ Don't blame the kitchen / supplier / customer's lateness
- ❌ Don't ask "why didn't you call ahead?" — they didn't have to
- ❌ Don't volunteer to call them when the item is back (we don't have that infrastructure)

## Examples

✅ Customer: "Mushroom Swiss please."
   (search_menu returns is_available=false)
   Agent: "Sorry — Mushroom Swiss is sold out tonight. Bacon Swiss is the closest match — same swiss cheese, RM14. Want to try it?"

✅ Customer (VIP, memory shows favorite): "Mushroom Swiss please."
   Agent: "Aw, sorry Sarah — your usual Mushroom Swiss is 86'd tonight. Bacon Swiss is the closest match (same swiss, just bacon instead of mushrooms — RM14). On the house if you want to try it?"  (only if comp <RM10; else escalate)

❌ Customer: "Mushroom Swiss please."
   Agent: "Mushroom Swiss is unavailable. Anything else?"  (too curt, doesn't help)

✅ Customer: "Are the mushroom items gone today?"
   Agent: "Yeah, mushrooms are out tonight — so Mushroom Swiss is 86'd. Hopefully back tomorrow. Anything else catch your eye?"
```

---

# 6. Bonus skills (lifted from `ai_brain`)

These don't need new content — they're general-purpose and lift as-is from `ai_brain/.claude/skills/`:

## 6.1 `skills/escalate_human/SKILL.md`

Lift from `ai_brain/.claude/skills/escalate_human/SKILL.md`. The body says: transfer the conversation to a human staff member when the agent's scope is exceeded.

Key cases for FeedMe:
- Customer complaint Level 3 (foreign object, allergic reaction, health concern)
- Customer requests refund (refund is LOCKED — manager only)
- Customer threatens public review / legal action
- Agent detects abusive / harassing language
- Customer asks something completely off-topic (e.g., "can I rent space for an event?")

## 6.2 `skills/search_knowledge/SKILL.md`

Lift from `ai_brain/.claude/skills/search_knowledge/SKILL.md`. The body says: search a knowledge base (FAQ) for non-order questions.

For FeedMe, the "knowledge base" is `agents/customer-facing/OPERATIONS.md` — hours, location, parking, delivery, service style. The agent can quote from it directly without a tool call.

---

# How skills compose

When multiple skills could apply, the agent reads `priority` and concatenates bodies in **descending priority order**:

```
priority 10: allergen_check
priority 9:  handle_complaint
priority 8:  vip_protocol
priority 6:  86_item_protocol
priority 3:  upsell
```

So if a VIP customer mentions an allergy AND has a complaint about an 86'd item, the prompt looks like:

```
<active_skills>
1. allergen_check (priority 10) — body...
2. handle_complaint (priority 9) — body...
3. vip_protocol (priority 8) — body...
4. 86_item_protocol (priority 6) — body...
</active_skills>
```

The agent reads top-down — most important rules first.

---

# Domain content to provide

For each of the 5 skills, the templates above include:

- ✅ All the structural decisions (when applies, what to do, examples, what NOT to do)
- ⚠️ Some restaurant-specific defaults (RM10 comp threshold, specific menu items mentioned)

Things the user (you) may want to customize:

1. **Upsell offer details** — what's the standard combo discount? (10% used here as default)
2. **VIP greeting style** — first-name vs full-name vs nickname?
3. **Complaint comp tiers** — flat per-item or % of order?
4. **Allergen list** — does your restaurant track sesame? celery? Anything else?
5. **86 substitution map** — which items are closest matches? You know your menu best.

Suggest: ship with these defaults, then refine based on the first 10 real test conversations.
