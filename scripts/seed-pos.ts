#!/usr/bin/env bun
/**
 * Seed `data/pos.db` with the 50 IceYoo Desaru menu items.
 * Prices are MY-market PLACEHOLDERS — replace with real prices when available.
 * Idempotent via `INSERT OR REPLACE`.
 */
import { getDb, insertMenuItem } from "../mcp-servers/pos/client";

interface SeedItem {
  code: string; // matches snow-dessert/app.jsx sections
  name: string;
  description?: string;
  price_cents: number;
  category: string;
  station: string;
  prep_time_seconds: number;
  allergens: string[];
  ingredient_ids: string[];
}

const sluggify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);

const items: SeedItem[] = [
  // ───────── YOOYOO SAVER ─────────
  { code: "YS01", name: "Oreo Iceyoo (SE)", description: "Shaved ice with crushed cookie topping", price_cents: 1200, category: "YOOYOO SAVER", station: "cold", prep_time_seconds: 90, allergens: ["dairy", "gluten"], ingredient_ids: ["milk_ice", "cookie_crumb", "syrup_choco"] },
  { code: "YS02", name: "Milo Lava Iceyoo (SE)", description: "Milo-flavored shaved ice with chocolate lava", price_cents: 1290, category: "YOOYOO SAVER", station: "cold", prep_time_seconds: 90, allergens: ["dairy"], ingredient_ids: ["milk_ice", "milo_powder", "choco_lava"] },
  { code: "YS03", name: "Coconut Iceyoo (SE)", description: "Coconut shaved ice", price_cents: 1200, category: "YOOYOO SAVER", station: "cold", prep_time_seconds: 90, allergens: [], ingredient_ids: ["milk_ice", "coconut"] },
  { code: "YS04", name: "Mango Iceyoo (SE)", description: "Mango shaved ice", price_cents: 1290, category: "YOOYOO SAVER", station: "cold", prep_time_seconds: 90, allergens: [], ingredient_ids: ["milk_ice", "mango_syrup", "mango_chunk"] },
  { code: "YS05", name: "Watermelon Iceyoo (SE)", description: "Watermelon shaved ice with strawberry topping", price_cents: 1200, category: "YOOYOO SAVER", station: "cold", prep_time_seconds: 90, allergens: [], ingredient_ids: ["milk_ice", "watermelon_syrup", "strawberry"] },
  { code: "YS06", name: "Thai Tea Iceyoo (SE)", description: "Thai tea flavored shaved ice", price_cents: 1290, category: "YOOYOO SAVER", station: "cold", prep_time_seconds: 90, allergens: ["dairy"], ingredient_ids: ["milk_ice", "thai_tea_syrup"] },
  { code: "YS07", name: "Milo Dinosaur Iceyoo (SE)", description: "Milo + chocolate shaved ice", price_cents: 1390, category: "YOOYOO SAVER", station: "cold", prep_time_seconds: 90, allergens: ["dairy"], ingredient_ids: ["milk_ice", "milo_powder", "choco_chunks"] },
  { code: "YS08", name: "Popcorn Chicken Noodle (S)", description: "Korean noodle box with popcorn chicken", price_cents: 1490, category: "YOOYOO SAVER", station: "fry", prep_time_seconds: 300, allergens: ["gluten", "soy"], ingredient_ids: ["chicken_popcorn", "noodles", "soy_sauce"] },
  { code: "YS09", name: "Korean Chicken Wrap", description: "Korean fried chicken in tortilla wrap", price_cents: 1290, category: "YOOYOO SAVER", station: "fry", prep_time_seconds: 300, allergens: ["gluten", "soy"], ingredient_ids: ["chicken_popcorn", "tortilla", "sauce"] },
  { code: "YS10", name: "Teriyaki Fries (M)", description: "Loaded fries with teriyaki sauce", price_cents: 1090, category: "YOOYOO SAVER", station: "fry", prep_time_seconds: 240, allergens: ["gluten", "soy"], ingredient_ids: ["fries", "teriyaki_sauce"] },
  { code: "YS11", name: "Cheezy Wedges (M)", description: "Potato wedges with cheese sauce", price_cents: 990, category: "YOOYOO SAVER", station: "fry", prep_time_seconds: 240, allergens: ["dairy"], ingredient_ids: ["wedges", "cheese_sauce"] },
  { code: "YS12", name: "Cheezy Fries (M)", description: "Fries with cheese sauce", price_cents: 990, category: "YOOYOO SAVER", station: "fry", prep_time_seconds: 240, allergens: ["dairy"], ingredient_ids: ["fries", "cheese_sauce"] },
  { code: "YS013", name: "Chicken Nuggets (6 pcs)", description: "6 pieces breaded chicken", price_cents: 890, category: "YOOYOO SAVER", station: "fry", prep_time_seconds: 240, allergens: ["gluten"], ingredient_ids: ["chicken_nugget"] },
  { code: "YS14", name: "Classic Honey Waffle w/ Ice Cream (2 pcs)", description: "Waffle with 2 scoops ice cream", price_cents: 1490, category: "YOOYOO SAVER", station: "cold", prep_time_seconds: 240, allergens: ["dairy", "gluten", "egg"], ingredient_ids: ["waffle", "ice_cream", "honey"] },

  // ───────── BINGSU (23 flavors) ─────────
  { code: "CB01", name: "Mango Bingsu", price_cents: 2090, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "mango_syrup", "mango_chunk"] },
  { code: "CB02", name: "Watermelon Bingsu", price_cents: 1890, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "watermelon_syrup"] },
  { code: "CB03", name: "Honeydew Bingsu", price_cents: 1990, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "honeydew_syrup"] },
  { code: "CB04", name: "Coconut Bingsu", price_cents: 1990, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "coconut"] },
  { code: "CB05", name: "Lychee Bingsu", price_cents: 2190, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "lychee_syrup"] },
  { code: "CB06", name: "Musang King Durian Bingsu", description: "Seasonal premium durian", price_cents: 3290, category: "BINGSU", station: "cold", prep_time_seconds: 150, allergens: ["dairy"], ingredient_ids: ["milk_ice", "durian"] },
  { code: "CB07", name: "Chocolate Oreo Bingsu", price_cents: 2190, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy", "gluten"], ingredient_ids: ["milk_ice", "choco_syrup", "cookie_crumb"] },
  { code: "CB08", name: "Milo Lava Bingsu", price_cents: 2090, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "milo_powder", "choco_lava"] },
  { code: "CB09", name: "Mix Fruit Fruity Bingsu", price_cents: 2390, category: "BINGSU", station: "cold", prep_time_seconds: 150, allergens: ["dairy"], ingredient_ids: ["milk_ice", "mango_chunk", "strawberry", "kiwi"] },
  { code: "CB10", name: "Chocolate Fruity Bingsu", description: "Chocolate ice flavour", price_cents: 2190, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "choco_syrup", "strawberry"] },
  { code: "CB11", name: "Tutti Fruity Bingsu", description: "Mango ice flavour", price_cents: 2090, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "mango_syrup", "strawberry"] },
  { code: "CB12", name: "Blue Yogurt KitKat Bingsu", price_cents: 2390, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy", "gluten", "soy"], ingredient_ids: ["milk_ice", "blue_yogurt", "kitkat"] },
  { code: "CB13", name: "Soya Bean Bingsu", price_cents: 1990, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["soy"], ingredient_ids: ["milk_ice", "soy_milk"] },
  { code: "CB14", name: "Matcha Bingsu", price_cents: 2290, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "matcha_powder"] },
  { code: "CB15", name: "Milk Tea Bingsu", price_cents: 2090, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "milk_tea_syrup"] },
  { code: "CB16", name: "Thai Tea Bingsu", price_cents: 2090, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "thai_tea_syrup"] },
  { code: "CB17", name: "Chocolate Caramel Bingsu", price_cents: 2190, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy"], ingredient_ids: ["milk_ice", "choco_syrup", "caramel"] },
  { code: "CB18", name: "Tiramisu Bingsu", price_cents: 2390, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy", "egg"], ingredient_ids: ["milk_ice", "tiramisu_mix"] },
  { code: "CB19", name: "Red Velvet Cake Bingsu", price_cents: 2390, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy", "gluten", "egg"], ingredient_ids: ["milk_ice", "red_velvet_cake"] },
  { code: "CB20", name: "Oreo Cheesecake Bingsu", price_cents: 2490, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy", "gluten", "egg"], ingredient_ids: ["milk_ice", "cheesecake", "cookie_crumb"] },
  { code: "CB21", name: "Strawberry Cheesecake Bingsu", price_cents: 2490, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy", "gluten", "egg"], ingredient_ids: ["milk_ice", "cheesecake", "strawberry"] },
  { code: "CB22", name: "Blueberry Cheesecake Bingsu", price_cents: 2490, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy", "gluten", "egg"], ingredient_ids: ["milk_ice", "cheesecake", "blueberry"] },
  { code: "CB24", name: "Kinder Bueno Bingsu", price_cents: 2490, category: "BINGSU", station: "cold", prep_time_seconds: 120, allergens: ["dairy", "gluten", "nut"], ingredient_ids: ["milk_ice", "kinder_bueno"] },

  // ───────── YOOYOO BOWL ─────────
  { code: "YYB01", name: "YooYoo Bowl", description: "Korean rice bowl with chicken and vegetables", price_cents: 1690, category: "YOOYOO BOWL", station: "cold", prep_time_seconds: 180, allergens: ["soy", "gluten"], ingredient_ids: ["rice", "chicken_popcorn", "lettuce", "sauce"] },

  // ───────── WOORI ICE BLENDED (smoothies) ─────────
  { code: "W01", name: "Summer Frutti Ice Blended", description: "Grapefruit, peach, lychee", price_cents: 1390, category: "WOORI ICE BLENDED", station: "bev", prep_time_seconds: 90, allergens: [], ingredient_ids: ["ice", "grapefruit", "peach", "lychee_syrup"] },
  { code: "W02", name: "Tutti Frutti Ice Blended", description: "Mango, passion fruit, peach", price_cents: 1290, category: "WOORI ICE BLENDED", station: "bev", prep_time_seconds: 90, allergens: [], ingredient_ids: ["ice", "mango_syrup", "passionfruit", "peach"] },
  { code: "W03", name: "Oreo Ice Blended", description: "Oreo milkshake", price_cents: 1390, category: "WOORI ICE BLENDED", station: "bev", prep_time_seconds: 90, allergens: ["dairy", "gluten"], ingredient_ids: ["ice", "milk", "cookie_crumb"] },
  { code: "W05", name: "Coffee Ice Blended", description: "Iced coffee", price_cents: 1290, category: "WOORI ICE BLENDED", station: "bev", prep_time_seconds: 90, allergens: ["dairy"], ingredient_ids: ["ice", "milk", "coffee"] },
  { code: "W06", name: "Local Flavoured Ice Blended", description: "Matcha smoothie", price_cents: 1290, category: "WOORI ICE BLENDED", station: "bev", prep_time_seconds: 90, allergens: ["dairy"], ingredient_ids: ["ice", "milk", "matcha_powder"] },

  // ───────── YOOYOO EAT (Korean fried chicken + noodles) ─────────
  { code: "E01", name: "Korean Chicken Wingette & Drumette (6 pcs)", price_cents: 1690, category: "YOOYOO EAT", station: "fry", prep_time_seconds: 360, allergens: ["gluten", "soy"], ingredient_ids: ["chicken_wing", "korean_sauce"] },
  { code: "E02", name: "Korean Chicken Wingette & Drumette (10 pcs)", price_cents: 2590, category: "YOOYOO EAT", station: "fry", prep_time_seconds: 420, allergens: ["gluten", "soy"], ingredient_ids: ["chicken_wing", "korean_sauce"] },
  { code: "E03", name: "Korean Chicken Wingette & Drumette (16 pcs)", price_cents: 3990, category: "YOOYOO EAT", station: "fry", prep_time_seconds: 540, allergens: ["gluten", "soy"], ingredient_ids: ["chicken_wing", "korean_sauce"] },
  { code: "E04", name: "Korean Popcorn Chicken (Original Fried)", price_cents: 1390, category: "YOOYOO EAT", station: "fry", prep_time_seconds: 300, allergens: ["gluten"], ingredient_ids: ["chicken_popcorn"] },
  { code: "E05", name: "Korean Popcorn Chicken (Korean Sauce)", price_cents: 1490, category: "YOOYOO EAT", station: "fry", prep_time_seconds: 300, allergens: ["gluten", "soy"], ingredient_ids: ["chicken_popcorn", "korean_sauce"] },
  { code: "E06", name: "Korean Popcorn Chicken Noodles", price_cents: 1890, category: "YOOYOO EAT", station: "fry", prep_time_seconds: 360, allergens: ["gluten", "soy"], ingredient_ids: ["chicken_popcorn", "noodles", "soy_sauce"] },
  { code: "E07", name: "Korean Chicken Wing Noodles", price_cents: 1990, category: "YOOYOO EAT", station: "fry", prep_time_seconds: 420, allergens: ["gluten", "soy"], ingredient_ids: ["chicken_wing", "noodles", "soy_sauce"] },
  { code: "E08", name: "Chicken Wing & Popcorn Chicken with Noodles", price_cents: 2290, category: "YOOYOO EAT", station: "fry", prep_time_seconds: 480, allergens: ["gluten", "soy"], ingredient_ids: ["chicken_wing", "chicken_popcorn", "noodles", "soy_sauce"] },
];

// Compute SKU = "<category-prefix>_<slug>" — readable in logs
function skuFor(item: SeedItem): string {
  const prefix = item.code.toLowerCase();
  const slug = sluggify(item.name);
  return `${prefix}_${slug}`;
}

console.log(`[seed-pos] inserting ${items.length} menu items into ./data/pos.db…`);
getDb(); // initializes schema
for (const item of items) {
  insertMenuItem({
    sku: skuFor(item),
    code: item.code,
    name: item.name,
    description: item.description ?? null,
    price_cents: item.price_cents,
    category: item.category,
    station: item.station,
    prep_time_seconds: item.prep_time_seconds,
    allergens: item.allergens,
    ingredient_ids: item.ingredient_ids,
  });
}
console.log(`[seed-pos] done.`);
console.log(`[seed-pos] try:  curl -X POST http://localhost:4001/tools/search_menu -H 'Content-Type: application/json' -d '{"query":"mango"}'`);
