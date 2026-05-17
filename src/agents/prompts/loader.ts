/**
 * Tiny prompt loader. Reads .md files from this directory at module init
 * (synchronous, no I/O at request time) and substitutes {{var}} placeholders.
 *
 * Why a loader vs string-interpolation in code:
 *  - prompts diff cleanly in PRs (.md vs inline TS template literals)
 *  - non-engineers can tweak agent behaviour without touching code
 *  - keeps the agent files focused on flow control, not copy
 *
 * Placeholder syntax: {{name}} — replaced from the `vars` map at load time.
 * Missing vars leave the placeholder in place; that's intentional so misuses
 * surface in logs/traces rather than silently producing "undefined".
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PROMPTS_DIR = dirname(fileURLToPath(import.meta.url));

// Cache raw template contents per file so repeated calls only do string interp.
const cache = new Map<string, string>();

function readPromptFile(name: string): string {
  const cached = cache.get(name);
  if (cached !== undefined) return cached;
  const path = join(PROMPTS_DIR, `${name}.md`);
  const text = readFileSync(path, "utf8").trimEnd();
  cache.set(name, text);
  return text;
}

export function loadPrompt(name: string, vars: Record<string, string | number> = {}): string {
  const template = readPromptFile(name);
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const v = vars[key];
    return v === undefined ? match : String(v);
  });
}
