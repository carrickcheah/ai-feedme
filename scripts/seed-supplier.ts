#!/usr/bin/env bun
/**
 * Seed `data/supplier.db` with 4 suppliers + ~20 representative ingredients.
 * Ingredients use the `ing_<id>` convention that matches what record_ingredient_consumption
 * synthesizes from pos.db's menu_item.ingredient_ids_json.
 */
import { getDb, insertSupplier, insertIngredient } from "../mcp-servers/supplier/client";

interface SeedIng {
  id: string;
  name: string;
  unit: string;
  stock_qty: number;
  par_qty: number;
  reorder_qty: number;
  preferred_supplier_id: string;
  cost_per_unit_cents: number;
}

const suppliers = [
  { supplier_id: "sup_dairy", name: "JB Dairy & Frozen Sdn Bhd", contact_phone: "+60 7-555-0101", contact_email: "orders@jbdairy.my", lead_time_hours: 12 },
  { supplier_id: "sup_meat_co", name: "Desaru Halal Poultry", contact_phone: "+60 7-555-0202", contact_email: "sales@desarupoultry.my", lead_time_hours: 24 },
  { supplier_id: "sup_produce", name: "Pasar Tani Fresh", contact_phone: "+60 7-555-0303", contact_email: "wholesale@pasartani.my", lead_time_hours: 12 },
  { supplier_id: "sup_dry_goods", name: "Penang Dry Goods Wholesale", contact_phone: "+60 4-555-0404", contact_email: "orders@pgdrygoods.my", lead_time_hours: 48 },
] as const;

// 20 most important ingredients across the menu — covers Iceyoo / Bingsu / Korean chicken / Woori
const ingredients: SeedIng[] = [
  // Dairy
  { id: "ing_milk_ice",        name: "Milk-Ice base",       unit: "kg",   stock_qty: 50, par_qty: 10, reorder_qty: 30, preferred_supplier_id: "sup_dairy",    cost_per_unit_cents: 800 },
  { id: "ing_milk",            name: "Fresh Milk",          unit: "liter",stock_qty: 30, par_qty: 5,  reorder_qty: 20, preferred_supplier_id: "sup_dairy",    cost_per_unit_cents: 600 },
  { id: "ing_ice_cream",       name: "Vanilla Ice Cream",   unit: "liter",stock_qty: 10, par_qty: 2,  reorder_qty: 8,  preferred_supplier_id: "sup_dairy",    cost_per_unit_cents: 1500 },
  { id: "ing_cheese_sauce",    name: "Cheese Sauce",        unit: "kg",   stock_qty: 8,  par_qty: 2,  reorder_qty: 6,  preferred_supplier_id: "sup_dairy",    cost_per_unit_cents: 2200 },

  // Meat (chicken — halal, this is MY market)
  { id: "ing_chicken_wing",    name: "Chicken Wings (halal)",unit: "kg",  stock_qty: 25, par_qty: 5,  reorder_qty: 15, preferred_supplier_id: "sup_meat_co",  cost_per_unit_cents: 2800 },
  { id: "ing_chicken_popcorn", name: "Popcorn Chicken",      unit: "kg",  stock_qty: 20, par_qty: 4,  reorder_qty: 12, preferred_supplier_id: "sup_meat_co",  cost_per_unit_cents: 3200 },
  { id: "ing_chicken_nugget",  name: "Breaded Chicken Nuggets", unit: "kg", stock_qty: 15, par_qty: 3, reorder_qty: 10, preferred_supplier_id: "sup_meat_co",cost_per_unit_cents: 2400 },

  // Produce (fruit, fresh)
  { id: "ing_mango_chunk",     name: "Mango (chunks)",      unit: "kg",   stock_qty: 12, par_qty: 3,  reorder_qty: 10, preferred_supplier_id: "sup_produce",  cost_per_unit_cents: 1500 },
  { id: "ing_strawberry",      name: "Strawberries",        unit: "kg",   stock_qty: 6,  par_qty: 2,  reorder_qty: 5,  preferred_supplier_id: "sup_produce",  cost_per_unit_cents: 1800 },
  { id: "ing_durian",          name: "Musang King Durian (frozen)", unit: "kg", stock_qty: 4, par_qty: 1, reorder_qty: 3, preferred_supplier_id: "sup_produce", cost_per_unit_cents: 6500 },
  { id: "ing_coconut",         name: "Coconut (shredded)",  unit: "kg",   stock_qty: 8,  par_qty: 2,  reorder_qty: 6,  preferred_supplier_id: "sup_produce",  cost_per_unit_cents: 1100 },
  { id: "ing_blueberry",       name: "Blueberries",         unit: "kg",   stock_qty: 4,  par_qty: 1,  reorder_qty: 3,  preferred_supplier_id: "sup_produce",  cost_per_unit_cents: 2400 },

  // Dry goods / syrups / packaged
  { id: "ing_mango_syrup",     name: "Mango Syrup",         unit: "liter",stock_qty: 12, par_qty: 3,  reorder_qty: 10, preferred_supplier_id: "sup_dry_goods",cost_per_unit_cents: 900 },
  { id: "ing_thai_tea_syrup",  name: "Thai Tea Syrup",      unit: "liter",stock_qty: 10, par_qty: 2,  reorder_qty: 8,  preferred_supplier_id: "sup_dry_goods",cost_per_unit_cents: 1100 },
  { id: "ing_milo_powder",     name: "Milo Powder",         unit: "kg",   stock_qty: 15, par_qty: 3,  reorder_qty: 10, preferred_supplier_id: "sup_dry_goods",cost_per_unit_cents: 1200 },
  { id: "ing_matcha_powder",   name: "Matcha Powder",       unit: "kg",   stock_qty: 5,  par_qty: 1,  reorder_qty: 3,  preferred_supplier_id: "sup_dry_goods",cost_per_unit_cents: 4500 },
  { id: "ing_cookie_crumb",    name: "Oreo Cookie Crumb",   unit: "kg",   stock_qty: 8,  par_qty: 2,  reorder_qty: 6,  preferred_supplier_id: "sup_dry_goods",cost_per_unit_cents: 1300 },
  { id: "ing_noodles",         name: "Korean Instant Noodles",unit: "kg", stock_qty: 25, par_qty: 5,  reorder_qty: 15, preferred_supplier_id: "sup_dry_goods",cost_per_unit_cents: 800 },
  { id: "ing_korean_sauce",    name: "Korean Hot Sauce",    unit: "liter",stock_qty: 12, par_qty: 3,  reorder_qty: 10, preferred_supplier_id: "sup_dry_goods",cost_per_unit_cents: 1400 },
  { id: "ing_fries",           name: "Frozen Fries",        unit: "kg",   stock_qty: 30, par_qty: 6,  reorder_qty: 20, preferred_supplier_id: "sup_dry_goods",cost_per_unit_cents: 700 },
];

console.log(`[seed-supplier] init db…`);
getDb();

console.log(`[seed-supplier] inserting ${suppliers.length} suppliers…`);
for (const s of suppliers) insertSupplier(s);

console.log(`[seed-supplier] inserting ${ingredients.length} ingredients…`);
for (const i of ingredients) {
  insertIngredient({
    ingredient_id: i.id,
    name: i.name,
    unit: i.unit,
    stock_qty: i.stock_qty,
    par_qty: i.par_qty,
    reorder_qty: i.reorder_qty,
    preferred_supplier_id: i.preferred_supplier_id,
    cost_per_unit_cents: i.cost_per_unit_cents,
  });
}

console.log(`[seed-supplier] done.`);
console.log(`[seed-supplier] try:  curl -X POST http://localhost:4004/tools/get_ingredient_stock -H 'Content-Type: application/json' -d '{}'`);
