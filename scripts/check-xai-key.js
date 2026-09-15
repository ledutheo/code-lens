#!/usr/bin/env node
/**
 * Pre-flight startup guard for Code Lens.
 * Exits with non-zero if XAI_API_KEY is missing.
 * Wired into dev/start (and build) in package.json.
 *
 * Also tries to load from .env.local or .env in the project dir (useful if you put the key there).
 */

const fs = require('fs');
const path = require('path');

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath, 'utf8');
  const match = content.match(/^XAI_API_KEY=(.+)$/m);
  if (match) {
    let val = match[1].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    return val;
  }
  return null;
}

let key = process.env.XAI_API_KEY;

if (!key || key.trim() === "") {
  // Try .env.local then .env in cwd (the code-lens dir when running npm)
  const cwd = process.cwd();
  key = loadEnvFile(path.join(cwd, '.env.local')) || loadEnvFile(path.join(cwd, '.env'));
}

if (!key || key.trim() === "") {
  console.error(`
❌ XAI_API_KEY is not set.

Code Lens performs real analyses using the xAI Grok Build API (grok-build-0.1).
It will not start without a valid key.

Options:
1. Export in your shell (same terminal):
   export XAI_API_KEY="xai-..."

2. Create .env.local (or .env) in the code-lens folder:
   XAI_API_KEY=xai-...

3. Prefix the command:
   XAI_API_KEY="xai-..." npm run dev

Generate a key at: https://console.x.ai
Template: copy .env.example to .env.local

Do not commit real keys.
`);
  process.exit(1);
}

if (key.trim() === "xai-test-dummy-123") {
  console.log("⚠ Dummy key — canned sample results, no xAI API call");
} else {
  console.log("✓ XAI_API_KEY detected — starting Code Lens");
}
