#!/usr/bin/env node
/**
 * Pre-flight startup guard for Code Lens.
 * Exits with non-zero if XAI_API_KEY is missing.
 * Wired into dev/start (and build) in package.json.
 */

const key = process.env.XAI_API_KEY;

if (!key || key.trim() === "") {
  console.error(`
❌ XAI_API_KEY is not set.

Code Lens performs real analyses using the xAI Grok Build API (grok-build-0.1).
It will not start without a valid key.

1. Generate a key at: https://console.x.ai
2. Export it before starting the server:

   export XAI_API_KEY="xai-..."

3. Then retry:
   npm run dev

Do not commit real keys. See .env.example.
`);
  process.exit(1);
}

console.log("✓ XAI_API_KEY detected — starting Code Lens");
