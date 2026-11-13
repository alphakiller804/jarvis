# JARVIS AI — Vercel Deployment Guide

> **Full-stack production deployment** — React 3D frontend on Vercel CDN + Serverless API routes + optional Windows Local Agent for desktop automation.

---

## Architecture Overview

```
Browser (React 3D UI)
  │  Web Speech API (voice in)
  │  SpeechSynthesis (voice out)
  │  YouTube IFrame API (media player)
  │
  ├──► Vercel CDN — dist/ (static frontend)
  │
  ├──► Vercel Serverless Functions (api/)
  │       /api/status    — health check
  │       /api/chat      — Gemini LLM + function calling
  │       /api/youtube   — YouTube video resolver
  │       /api/memory    — in-memory preferences
  │       /api/action    — desktop action proxy → Local Agent
  │
  └──► Windows Local Agent (optional, runs on your PC)
          jarvis_engine/server.py — Python HTTP daemon
          Provides: app launch, volume, files, mouse/keyboard, screenshots
```

---

## Prerequisites

- [Node.js 20+](https://nodejs.org/) and npm
- [Vercel account](https://vercel.com/signup) (free tier works)
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- Google Gemini API key — [get one here](https://aistudio.google.com/app/apikey)
- Python 3.10+ (only needed for Local Agent / desktop automation)

---

## Step 1 — Get a Gemini API Key

1. Visit [https://aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click **Create API key**
3. Copy the key — you will need it in Step 3

---

## Step 2 — Push Code to GitHub

```bash
git init
git add .
git commit -m "JARVIS AI production build"
git remote add origin https://github.com/YOUR_USERNAME/jarvis-ai.git
git push -u origin main
```

> Make sure `.env` is in `.gitignore` (it already is) — **never** commit real API keys.

---

## Step 3 — Deploy to Vercel

### Option A — Vercel Dashboard (Recommended)

1. Go to [https://vercel.com/new](https://vercel.com/new)
2. Click **Import Git Repository** → select your `jarvis-ai` repo
3. Framework Preset: **Vite**
4. Build Command: `npm run vercel-build` *(or leave as `vite build` — both work)*
5. Output Directory: `dist`
6. Click **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | `your_key_from_step_1` |

7. Click **Deploy**
8. Wait ~60 seconds — your site is live at `https://your-project.vercel.app`

### Option B — Vercel CLI

```bash
npm i -g vercel
vercel login
vercel --prod
# Follow prompts: set GEMINI_API_KEY when asked about env vars
```

---

## Step 4 — Verify Deployment

After deploy, open your Vercel URL and test these endpoints:

```bash
# Health check
curl https://your-project.vercel.app/api/status

# Chat (replace YOUR_URL)
curl -X POST https://your-project.vercel.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello Jarvis"}'

# YouTube resolver
curl -X POST https://your-project.vercel.app/api/youtube \
  -H "Content-Type: application/json" \
  -d '{"query":"Tumse Koi Pyara"}'
```

Expected: all three return JSON with `success: true`.

---

## Step 5 — Windows Local Agent (Desktop Automation)

The Local Agent enables JARVIS to control your Windows PC — apps, volume, files, screenshots.  
**Without it, all cloud features (chat, voice, YouTube) still work normally.**

### Setup

1. Install Python dependencies:
   ```bash
   pip install -r jarvis_engine/requirements.txt
   ```

2. Launch the agent:
   ```bash
   start_agent.bat
   ```
   The terminal will print a **Bearer Token** like:
   ```
   ════════════════════════════════════════════
   JARVIS LOCAL AGENT TOKEN: abc123...xyz789
   ════════════════════════════════════════════
   ```
   Copy this token.

3. In the web UI, open **Settings** (gear icon) → **WINDOWS AGENT** tab:
   - Set Agent URL: `http://127.0.0.1:3001`
   - Paste the token
   - Click **Test Connection** — should show "Connected"

4. The status pill in the top-right corner turns **green** when connected.

### Environment Variable (optional)

Set a fixed token so you don't need to copy it each time:
```
JARVIS_AGENT_TOKEN=my-fixed-secret-token
```

---

## Local Development

```bash
# 1. Copy and fill in environment variables
cp .env.example .env
# Edit .env — add your GEMINI_API_KEY

# 2. Install dependencies
npm install

# 3. Run dev server (Express + Vite HMR + Python engine auto-starts)
npm run dev
# Open http://localhost:3000

# 4. (Optional) Run tests
node test_vercel_apis.mjs          # API endpoint tests
python -m pytest jarvis_engine/tests/  # Python engine tests
```

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ Yes | Google Gemini API key for all LLM calls |
| `JARVIS_AGENT_TOKEN` | No | Fixed bearer token for Local Agent (auto-generated if omitted) |
| `JARVIS_AGENT_PORT` | No | Local Agent port (default: `3001`) |

---

## Feature Availability Matrix

| Feature | Cloud (Vercel only) | Cloud + Local Agent |
|---|---|---|
| Voice input (Web Speech API) | ✅ | ✅ |
| AI conversation (Gemini) | ✅ | ✅ |
| YouTube music/video playback | ✅ | ✅ |
| Memory / preferences | ✅ in-memory | ✅ persistent SQLite |
| Conversation history | ✅ session | ✅ persistent |
| Open applications (Chrome, VS Code…) | ❌ requires agent | ✅ |
| System volume control | ❌ requires agent | ✅ |
| Screenshots | ❌ requires agent | ✅ |
| File management | ❌ requires agent | ✅ |
| Mouse/keyboard automation | ❌ requires agent | ✅ |
| Lock / Sleep PC | ❌ requires agent | ✅ |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `GEMINI_API_KEY is not configured` | Add the env var in Vercel Dashboard → Settings → Environment Variables |
| YouTube player doesn't load | Allow third-party cookies in browser; some corporate networks block `youtube.com` iframes |
| Voice not working | Use Chrome or Edge (Firefox has limited SpeechRecognition support); allow microphone permission |
| Local Agent "Connection failed" | Ensure `start_agent.bat` is running; check Windows Firewall isn't blocking port 3001 |
| `503 All AI models are unavailable` | Gemini API is under high load; wait 30s and retry |
| Build fails on Vercel | Check Node.js version is 20+; set in Vercel Project Settings → General → Node.js Version |

---

## Security Notes

- The Local Agent uses Bearer token authentication — tokens are auto-generated per session
- HTTPS is enforced on Vercel automatically — the agent communicates over localhost only
- Never expose the Local Agent port publicly — it should only be accessed from `localhost`
- Rate limiting: `/api/chat` allows max 20 requests/minute per IP to prevent abuse
- Sensitive data: conversation history is session-only in cloud mode (not persisted to Vercel)

