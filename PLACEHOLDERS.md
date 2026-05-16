# Placeholders & Synthetic Data — to replace before going live

> Things I made up while building Phase 0–2. Most are sensible defaults; flag those that aren't real domain knowledge.

---

## 1. Menu prices (`MENU.md` and `scripts/seed-pos.ts`)

All 51 IceYoo menu items have **MY-market placeholder prices** based on rough Malaysian F&B norms:

| Section | Items | Price range |
|---|---|---|
| YOOYOO SAVER (Iceyoo cups, snacks, waffle) | 14 | RM8.90 – RM14.90 |
| BINGSU (23 flavors) | 23 | RM18.90 – RM32.90 (durian premium) |
| YOOYOO BOWL | 1 | RM16.90 |
| WOORI ICE BLENDED | 5 | RM12.90 – RM13.90 |
| YOOYOO EAT (Korean chicken/noodles) | 8 | RM13.90 – RM39.90 |

**To replace**: open `scripts/seed-pos.ts` (lines 23-66) → change `price_cents` per item → rerun `bun run scripts/seed-pos.ts`.

The promo banner in `snow-dessert/app.jsx` says "1+1 YooYoo Saver RM18.9" — that's the visual menu's price, may or may not match real promo.

---

## 2. Synthetic suppliers (`scripts/seed-supplier.ts`)

4 fictional suppliers I invented:

| supplier_id | Name | Phone | Email | Lead time |
|---|---|---|---|---|
| `sup_dairy` | JB Dairy & Frozen Sdn Bhd | +60 7-555-0101 | orders@jbdairy.my | 12h |
| `sup_meat_co` | Desaru Halal Poultry | +60 7-555-0202 | sales@desarupoultry.my | 24h |
| `sup_produce` | Pasar Tani Fresh | +60 7-555-0303 | wholesale@pasartani.my | 12h |
| `sup_dry_goods` | Penang Dry Goods Wholesale | +60 4-555-0404 | orders@pgdrygoods.my | 48h |

**To replace**: edit `scripts/seed-supplier.ts` lines 25-30 → rerun seed.

---

## 3. Synthetic ingredients (~20 rows)

20 representative ingredients seeded with **made-up stock, par, reorder qty, costs**:

| Ingredient | Stock | Par | Reorder | Cost/unit |
|---|---|---|---|---|
| Milk-Ice base | 50 kg | 10 | 30 | RM8/kg |
| Mango (chunks) | 12 kg | 3 | 10 | RM15/kg |
| Musang King Durian (frozen) | 4 kg | 1 | 3 | RM65/kg |
| Chicken Wings (halal) | 25 kg | 5 | 15 | RM28/kg |
| ... and 16 more | varies | varies | varies | varies |

All quantities, par levels, reorder amounts, and unit costs are **placeholders**. The ratio is roughly realistic for a small dessert shop but not pulled from real IceYoo data.

**To replace**: edit `scripts/seed-supplier.ts` lines 35-56 → rerun seed.

---

## 4. Menu item ingredient lists (`scripts/seed-pos.ts`)

Each menu item has an `ingredient_ids_json` field with 2-4 representative ingredients. Examples:
- `Mango Iceyoo` → `["milk_ice", "mango_syrup", "mango_chunk"]`
- `Musang King Durian Bingsu` → `["milk_ice", "durian"]`
- `Korean Chicken Wings (6 pcs)` → `["chicken_wing", "korean_sauce"]`

These are **simplified guesses** — a real restaurant would have a proper recipe table with quantities per dish. The current model is "1 menu item consumes 1 unit of each listed ingredient per qty ordered".

**To replace**: real recipe lists go in `seed-pos.ts` per-item `ingredients: [...]` array. For a proper recipe model with per-ingredient quantities, the schema would need a `recipe` table — out of scope for prototype.

---

## 5. Restaurant context (`agents/customer-facing/...` not yet written)

Phase 1 used inline system prompts in `src/agents/customer-facing.ts` and `src/agents/kitchen.ts` and `src/agents/inventory.ts`. The CONTEXT_TEMPLATES.md spec calls for filesystem `.md` files but those are not yet on disk — **Phase 3** will create them.

Current placeholder content in system prompts:
- "casual and friendly cashier voice"
- "Korean shaved-ice dessert and chicken shop in Desaru, Malaysia"
- "1+1 YooYoo Saver = RM18.9 combo"

**To replace when Phase 3 lands**: write actual `agents/customer-facing/IDENTITY.md`, `TONE.md`, `OWNER.md`, `MENU.md`, `OPERATIONS.md`, etc.

---

## 6. Auto-generated ingredient rows (Supplier MCP, `recordConsumption`)

When `supplier__record_ingredient_consumption` encounters an ingredient_id not yet in `ingredient` table (because the menu item references one that wasn't seeded), it **auto-creates a stub row**:

```sql
INSERT INTO ingredient (ingredient_id, name, unit, stock_qty, par_qty, reorder_qty)
  VALUES (ing_<id>, '<id without prefix>', 'unit', 100, 10, 50)
```

This is the prototype's resilience against incomplete seeds. **Auto-created rows have default values that may not be realistic.** Check `ingredient` table after a few orders and adjust:

```bash
sqlite3 ./data/supplier.db "SELECT * FROM ingredient WHERE par_qty = 10 AND reorder_qty = 50 AND unit = 'unit';"
```

---

## 7. Owner identity (`.env` `RESTAURANT_NAME` + agent system prompts)

- `RESTAURANT_NAME=IceYoo Desaru` — actual name from the frontend mock (`snow-dessert/`)
- Owner profile (name, phone, email) — **NOT SET YET**. Daily summary cron (Phase 5) will need real contact info.

---

## 8. Demo customer Sarah (Phase 3 placeholder)

The PLAN.md and FLOWS.md reference a "VIP customer Sarah" for the MemGC personalization demo. This is **completely fictional**:
- `customer_id: cust_sarah_001`
- Allergic to onions
- VIP loyalty tier
- Top 5 past orders include Mushroom Swiss combo (which is BURGER menu, not IceYoo — needs adapting to durian/bingsu when Phase 3 wires MemGC)

**To replace for IceYoo demo**: pick a plausible regular customer profile for a Desaru dessert shop. Maybe: "Sarah, allergic to dairy, usual is Mango Iceyoo (SE) extra mango".

---

## 9. Azure GPT-5.5 pricing (cost estimator)

`src/agents/agent-base.ts` and `src/agents/customer-facing.ts` use these estimated rates:

```typescript
// Azure OpenAI GPT-5.5 placeholder rates:
// input ~$1.25/1M tokens, output+reasoning ~$10.00/1M tokens
```

**Verify against your Azure billing portal** — actual rates may differ. The cost numbers in logs/API responses are estimates, not the source of truth.

---

## 10. CORS allowed origins (`.env`)

```
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:8000,file://
```

`file://` is included so opening `snow-dessert/index.html` directly works in dev. For deploy (Phase 5), replace with the real domain (`https://feedme-demo.example.com`).

---

## 11. Internal service secret (`.env`)

`INTERNAL_SERVICE_SECRET=dev-secret-rotate-in-prod`

Used for service-to-service calls (Phase 4 HITL approval API). Rotate before any real deploy.

---

## 12. Stations & cook times (per `seed-pos.ts`)

Every menu item has `station` (`grill`/`fry`/`cold`/`bev`) and `prep_time_seconds`. I assigned these based on what's normal for the item type:

- Iceyoo cups, Bingsu, YooYoo Bowl → `cold`, 90-150s
- Woori smoothies → `bev`, 90s
- Korean chicken, fries, nuggets → `fry`, 240-540s
- Honey waffle → `cold`, 240s

**To replace**: ask a real IceYoo cook for actual prep times.

---

## 13. Kitchen Display stations (`mcp-servers/kitchen-display/schema.sql`)

Default station avg_wait_s on first boot:

| Station | avg_wait_s |
|---|---|
| grill | 240 |
| fry | 240 |
| cold | 90 |
| bev | 60 |

These influence sequencing decisions. **Should match real-world kitchen capacity.**

---

## 14. Comp threshold for HITL (`PLAN.md` mentions RM10)

Locked actions threshold (comp > RM10 needs manager approval) is **a placeholder default** — actual restaurant policy may differ. Not enforced in code yet (Phase 4 wires HITL).

---

## How to update

1. **Prices**: `scripts/seed-pos.ts` → rerun `bun run scripts/seed-pos.ts`
2. **Ingredients/suppliers**: `scripts/seed-supplier.ts` → rerun `bun run scripts/seed-supplier.ts`
3. **Restaurant identity**: `.env` `RESTAURANT_NAME` + (Phase 3) `agents/customer-facing/*.md`
4. **Customer profiles**: (Phase 3) MemGC seed scripts

For now, the system **works end-to-end with placeholders**. The architecture is real; the data is illustrative.
