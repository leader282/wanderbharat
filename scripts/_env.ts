import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Shared env loader for seed scripts. Loads `.env.local` first (same
 * convention as Next.js), then falls back to `.env`.
 */
const candidates = [".env.local", ".env"]
  .map((p) => resolve(process.cwd(), p))
  .filter((p) => existsSync(p));

for (const path of candidates) {
  config({ path, override: false });
}

if (candidates.length === 0) {
  console.warn(
    "[seed] No .env.local or .env found — relying on process env only.",
  );
}
