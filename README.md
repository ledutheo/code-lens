# Code Lens

Drop a folder or file. Grok Build (`grok-build-0.1`) analyzes it in seconds.

Real API calls only — no mocks. Beautiful dark developer UI. Instant samples for one-click demos.

## Features

- Drag & drop folders (via `webkitdirectory`) or files + picker fallbacks
- File tree + syntax-highlighted code viewer
- Four configurable tasks: Explain, Fix Bugs, Generate Tests, Suggest Improvements
- Results panels with syntax-highlighted code + copy buttons
- Three built-in samples (JavaScript, Python, TypeScript)
- 100% browser file handling (nothing is stored server-side)
- Strict startup guard: refuses to run without `XAI_API_KEY`

## Requirements

- Node.js 18+
- Valid xAI API key (free to create)

## Run locally (under 60 seconds to first demo)

```bash
# 1. Go to the project
cd ~/github/code-lens

# 2. Export your key (get it at https://console.x.ai)
export XAI_API_KEY="xai-..."

# 3. Install + start
npm install
npm run dev
```

Open http://localhost:3000

### Instant verification
1. Click any sample button (JS / Python / TS)
2. Make sure tasks are enabled
3. Click **Analyze**
4. Watch the real grok-build response render with highlighted fixes/tests

## Scripts

| Command          | Description                              |
|------------------|------------------------------------------|
| `npm run dev`    | Starts with key guard + Next dev server  |
| `npm run build`  | Production build (also checks key)       |
| `npm run start`  | Production server (checks key)           |
| `npm run check-key` | Standalone key presence check         |

If the key is missing you will see a clear message telling you to export it.

## How it works (security)

- All grok-build calls happen in `lib/grok.ts` (server only)
- Browser never sees `XAI_API_KEY`
- API route: `app/api/analyze/route.ts`
- Prompt forces strict JSON. Robust parsing (direct → fence strip → brace slice) with graceful raw fallback.

## Project layout (key files)

```
code-lens/
├── app/
│   ├── api/analyze/route.ts   # receives requests from browser
│   ├── page.tsx               # entire UI
│   └── layout.tsx
├── lib/grok.ts                # real xAI Responses API call + parser
├── scripts/check-xai-key.js   # preflight guard
└── README.md
```

## Troubleshooting

- **"XAI_API_KEY is not set"** — export it and restart `npm run dev`
- **API errors** — the UI will show status + short safe message (no secrets)
- **Parse failures** — raw output is shown with a copy button (model sometimes adds extra text)
- Folder drag not working in your browser? Use the **Choose folder** button (most reliable).

Built for reliable local demos.
