#!/usr/bin/env bun
/**
 * Seed MemGC with a synthetic VIP customer "Sarah" for the demo.
 * Idempotent — MemGC dedupes by SHA-1, so re-running is safe.
 *
 * Usage:
 *   make memgc:up               # ensure memgc-service is running on :8003
 *   bun run scripts/seed-memgc-sarah.ts
 *
 * After seeding, the chat UI can "Login as Sarah" (toggle in chat panel header)
 * which sends customer_id: "cust_sarah_001" — the agent fetches her profile and
 * greets her by name + recalls preferences.
 */
const MEMGC_URL = process.env.MEMGC_URL ?? "http://localhost:8003";

const SARAH_FACTS = [
  { speaker: "Sarah", text: "Customer cust_sarah_001 is a VIP at IceYoo Desaru" },
  { speaker: "Sarah", text: "Sarah is allergic to dairy products" },
  { speaker: "Sarah", text: "Sarah's usual order is Mango Iceyoo (SE) with extra mango" },
  { speaker: "Sarah", text: "Sarah loves Musang King Durian Bingsu when in season" },
  { speaker: "Sarah", text: "Sarah always comes on Saturday afternoons with her daughter" },
  { speaker: "Sarah", text: "Sarah's phone number is +60 12-345-6789" },
  { speaker: "Sarah", text: "Sarah is a regular for the past 8 months" },
  { speaker: "Sarah", text: "Sarah's daughter is named Mia, age 7, loves the chocolate oreo bingsu" },
];

async function main() {
  console.log(`[seed-sarah] target memgc-service: ${MEMGC_URL}`);

  // 1. Ensure MemGC is open
  const openRes = await fetch(`${MEMGC_URL}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!openRes.ok) {
    console.error(`[seed-sarah] /open failed: ${openRes.status} ${await openRes.text()}`);
    process.exit(1);
  }
  console.log("[seed-sarah] memgc-service ready");

  // 2. Extract facts (idempotent — duplicates dropped by SHA-1)
  const t0 = Date.now();
  const res = await fetch(`${MEMGC_URL}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: SARAH_FACTS }),
  });
  if (!res.ok) {
    console.error(`[seed-sarah] /extract failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const result = (await res.json()) as { count: number; new_ids: string[] };
  console.log(
    `[seed-sarah] extracted ${result.count} memories from ${SARAH_FACTS.length} facts ` +
      `(${(Date.now() - t0) / 1000}s)`,
  );

  // 3. Smoke-test retrieval (optional)
  console.log("[seed-sarah] testing retrieval...");
  const t1 = Date.now();
  const ansRes = await fetch(`${MEMGC_URL}/answer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: "Who is Sarah? Summarize her preferences and allergies.",
      n_iterations: 2,
      n_samples: 3,
    }),
  });
  if (!ansRes.ok) {
    console.warn(`[seed-sarah] /answer probe failed: ${ansRes.status} (this is OK — seed succeeded)`);
  } else {
    const ans = (await ansRes.json()) as { text: string; memories: { content: string }[] };
    console.log(`[seed-sarah] retrieval probe (${((Date.now() - t1) / 1000).toFixed(1)}s):`);
    console.log(`            "${ans.text}"`);
    console.log(`            (${ans.memories.length} memories cited)`);
  }
  console.log("[seed-sarah] done. Toggle 'Demo: Sarah' in the chat UI to see VIP recognition.");
}

main().catch((err) => {
  console.error("[seed-sarah] failed:", err);
  process.exit(1);
});
