# Code Lens

Drop a folder or file. Grok Build (`grok-build-0.1`) analyzes it in seconds.

Local demo web app — not a daily coding assistant. Files stay in the browser; the API key never leaves the server.

## Features

- Drag & drop folders (via `webkitdirectory`) or files + picker fallbacks
- File tree + syntax-highlighted code viewer
- Four configurable tasks: Explain, Fix Bugs, Generate Tests, Suggest Improvements
- Results panels with syntax-highlighted code + copy buttons
- Three built-in samples (JavaScript, Python, TypeScript)
- 100% browser file handling (nothing is stored server-side)
- Startup guard: refuses to run without `XAI_API_KEY`

## Requirements

- Node.js 18+
- An xAI API key (free to create), **or** the dummy key below for UI-only tests

## Run locally (under 60 seconds to first demo)

```bash
cd ~/github/code-lens
cp .env.example .env.local
# put your key in .env.local (never commit that file)
npm install
npm run dev
```

Open http://localhost:3000

You can also export the key in the same shell (`export XAI_API_KEY="xai-..."`) instead of using `.env.local`.

### Dummy key (UI only, no API)

```bash
XAI_API_KEY=xai-test-dummy-123 npm run dev
```

Returns canned results for the three built-in samples. No call to xAI. Use a real key for actual grok-build analysis.

### Instant verification

1. Click any sample button (JS / Python / TS)
2. Make sure tasks are enabled
3. Click **Analyze**
4. Watch the grok-build response render with highlighted fixes/tests

## Scripts

| Command             | Description                             |
|---------------------|-----------------------------------------|
| `npm run dev`       | Key guard + Next dev server             |
| `npm run build`     | Production build (also checks key)      |
| `npm run start`     | Production server (checks key)          |
| `npm run check-key` | Standalone key presence check           |

If the key is missing you will see a clear message telling you to set it (shell export or `.env.local`).

## How it works (security)

- All grok-build calls happen in `lib/grok.ts` (server only)
- Browser never sees `XAI_API_KEY`
- API route: `app/api/analyze/route.ts`
- Prompt forces strict JSON. Robust parsing (direct → fence strip → brace slice) with graceful raw fallback
- Model stays `grok-build-0.1` on purpose (coding model, not the general Grok lineup)

## Project layout (key files)

```
code-lens/
├── app/
│   ├── api/analyze/route.ts   # receives requests from browser
│   ├── page.tsx               # entire UI
│   └── layout.tsx
├── lib/grok.ts                # xAI Responses API call + parser (+ dummy fallback)
├── scripts/check-xai-key.js   # preflight guard (.env.local / .env / shell)
├── .env.example               # key template
└── README.md
```

## Troubleshooting

- **"XAI_API_KEY is not set"** — add it to `.env.local` or export it, then restart `npm run dev`
- **Dummy key** — canned sample output only; swap in a real key from https://console.x.ai for live analysis
- **API errors** — the UI will show status + short safe message (no secrets)
- **Parse failures** — raw output is shown with a copy button (model sometimes adds extra text)
- Folder drag not working in your browser? Use the **Choose folder** button (most reliable).

Built for reliable local demos.
