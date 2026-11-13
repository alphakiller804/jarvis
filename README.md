# J.A.R.V.I.S. 2.0 — Fully Autonomous Voice-Controlled Personal AI Assistant

An advanced, intelligent, fully voice-controlled personal AI assistant for Windows 11 — now with **cloud production deployment on Vercel**. Powered by **Gemini Live** bidirectional audio streaming and a **Python Automation Engine**, JARVIS understands natural English and Urdu / Roman Urdu speech and executes real-world actions directly on your PC.

> **🚀 New in this release:** Dual-mode architecture — deploy the full 3D UI to Vercel and connect your Windows PC as a local agent for desktop automation. Voice, chat, YouTube, and AI features work in cloud-only mode too.

---

## 🌐 Deploy to Vercel

For full Vercel deployment instructions see **[DEPLOY.md](./DEPLOY.md)**.

**Quick deploy:**
1. Push to GitHub
2. Import at [vercel.com/new](https://vercel.com/new)
3. Add `GEMINI_API_KEY` environment variable
4. Deploy — done in ~60 seconds

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new)

---

## ⚡ Key Capabilities

### 1. Natural Voice Command System
- **Continuous Voice Streaming**: Hands-free conversation powered by Gemini 3.8 Live.
- **Multilingual & Roman Urdu Fluency**: Understands colloquial English, Urdu, Roman Urdu, and code-switching accents naturally.
- **Instant Speech Interruption (Barge-in)**: Speak at any moment while JARVIS is speaking to interrupt and change direction naturally.
- **Push-to-Talk & Wake Word**: Toggle continuous listening on or off, or use push-to-talk.
- **Audio Feedback**: Spoken confirmations in your preferred language.

### 2. YouTube & Music Automation
- Search and play any song by title or artist (e.g., *"Jarvis, YouTube par Tumse Koi Pyara song chalao"*).
- Direct autoplay resolution via browser automation.
- Play random mixes or playlists based on your preferred genre.
- Global playback controls: **Play**, **Pause**, **Resume**, **Next Track**, **Previous Track**, **Stop**, and **Fullscreen**.
- Precise volume adjustments (e.g., *"Volume 40 percent karo"*).

### 3. Movie & Video Control
- Search movies, trailers, and shows across YouTube.
- Search streaming platforms including **Netflix**, **Amazon Prime Video**, and **Disney+**.
- Fullscreen video control.

### 4. Complete Windows PC Control
- **Application Control**: Launch and close apps (*Chrome, Edge, VS Code, Notepad, File Explorer, Calculator, Spotify, Terminal, Task Manager*).
- **Window Management**: Bring windows to front, minimize, maximize, and list active windows.
- **Audio & Volume Control**: Set exact volume percentage (0–100%), mute/unmute, volume up/down via Windows Core Audio (`pycaw`).
- **Global Media Keys**: Trigger hardware media keys to control background music players.
- **Screenshots**: Capture full-screen screenshots saved automatically to your Pictures directory.
- **Clipboard Management**: Read or copy text to/from the Windows clipboard.
- **Hardware Telemetry**: Real-time CPU load, RAM usage, Battery percentage, and Disk usage via `psutil`.
- **System Power**: Lock workstation instantly. Sleep, Restart, or Shutdown with security confirmation.

### 5. Desktop File Management
- **File Search**: Search user directories (Documents, Downloads, Desktop) by keyword, extension (e.g. `.pdf`), sorted by latest modified.
- **Open Files & Folders**: Launch files in default Windows handlers.
- **Folder Management**: Create folders, rename, move, and copy files.
- **Downloads Organizer**: Automatically sorts messy Downloads folders into categorized subdirectories (*Documents, Images, Videos, Audio, Installers, Archives*).
- **Document Reader**: Extracts and reads text from `.txt`, `.md`, `.json`, `.csv`, `.py`, and `.pdf` documents.

### 6. Multi-Step Autonomous Tasks
- Execute chained instructions in sequence (e.g., *"Jarvis, open Chrome, open YouTube, search for PUBG gameplay and play the first video"*).

### 7. Persistent Neural Memory (SQLite)
- Stores user preferences, favorite artists, preferred music genres, response languages, and action history in SQLite (`jarvis_engine/data/jarvis_memory.db`).
- Visual Memory & Control Matrix modal to view, add, or delete preferences.

### 8. Security & Safety Guardrails
- **Protected Paths**: System directories (`C:\Windows`, `System32`, `Program Files`) cannot be deleted or altered.
- **Confirmation Tokens**: Destructive actions (shutdown, restart, sleep) require verification.
- **Emergency Stop**: Instant halt command (*"Jarvis stop everything"* or UI HALT button) immediately terminates all actions and media.

---

## 🚀 Quick Start Guide

### Prerequisites
1. **Node.js** (v20+ recommended)
2. **Python** (3.10+ with `pyautogui`, `pycaw`, `psutil`, `pypdf`, `pywin32`)
3. A Google Gemini API Key — copy `.env.example` to `.env` and fill in your key:
   ```bash
   cp .env.example .env
   # Edit .env and set GEMINI_API_KEY=your_key_here
   ```

### Running JARVIS
Simply run:
```bash
npm run dev
```
This command starts:
1. The **JARVIS Python Automation Engine** on `http://127.0.0.1:3001`
2. The **JARVIS Live WebSocket & Web Server** on `http://localhost:3000`

Open your browser to:
```
http://localhost:3000
```
Click **Initialize Audio** (or tap anywhere on screen) to unlock the Web Audio microphone link.

---

## 🎙️ Spoken Command Examples

| Category | English Voice Command | Roman Urdu Voice Command | Action Executed |
| :--- | :--- | :--- | :--- |
| **YouTube** | *"Jarvis, play Tumse Koi Pyara on YouTube"* | *"Jarvis, YouTube par Tumse Koi Pyara song chalao"* | Resolves video & plays with autoplay |
| **Artists** | *"Play songs by Atif Aslam"* | *"Atif Aslam ke gaane chalao"* | Plays artist mix playlist |
| **Media Control** | *"Pause the music"* | *"Gaana roko / pause karo"* | Pauses active playback |
| **Media Control** | *"Resume playback"* | *"Wapas chalao / resume karo"* | Resumes playback |
| **Media Control** | *"Next song"* | *"Agla gaana lagao"* | Skips to next track |
| **Volume** | *"Set volume to 40 percent"* | *"Aawaz 40 percent karo"* | Sets system volume to 40% |
| **Volume** | *"Turn volume down"* | *"Aawaz thori kam karo"* | Decreases volume by 15% |
| **Apps** | *"Launch VS Code"* | *"VS Code kholo"* | Opens Visual Studio Code |
| **Apps** | *"Open Google Chrome"* | *"Chrome browser open karo"* | Launches Google Chrome |
| **Apps** | *"Close Notepad"* | *"Notepad band karo"* | Closes Notepad process |
| **Windows** | *"Minimize this window"* | *"Window minimize karo"* | Minimizes active window |
| **System** | *"Take a screenshot"* | *"Screenshot lo"* | Saves screenshot to Pictures |
| **System** | *"Lock my computer"* | *"Computer lock karo"* | Locks Windows workstation |
| **Files** | *"Find my PDF files"* | *"Meri PDF files dhoondo"* | Searches & lists latest PDFs |
| **Files** | *"Organize my downloads folder"* | *"Downloads folder organize karo"* | Categorizes downloads files |
| **Multi-step** | *"Open project folder and launch VS Code"* | *"Project folder kholo aur VS Code chalao"* | Executes multi-step sequence |
| **Emergency** | *"Jarvis stop everything"* | *"Sab kuch roko"* | Instant emergency halt |

---

## 📂 Project Architecture

```
Jarvis-main/
├── api/                            # Vercel Serverless API Routes
│   ├── chat.ts                     # Gemini LLM + function calling + rate limiting
│   ├── youtube.ts                  # YouTube video resolver
│   ├── memory.ts                   # In-memory preferences store
│   ├── action.ts                   # Desktop action proxy → Local Agent
│   ├── status.ts                   # Health check + deployment mode
│   └── tsconfig.json               # CommonJS tsconfig for Vercel runtime
├── jarvis_engine/                  # Python Autonomous Automation Engine (Local Agent)
│   ├── memory_manager.py           # SQLite persistent memory & usage tracking
│   ├── safety_manager.py           # Security checks & emergency stop guard
│   ├── windows_controller.py       # Win32, pycaw volume, process & window management
│   ├── youtube_controller.py       # YouTube search, video resolution & media keys
│   ├── browser_controller.py       # Browser navigation & streaming platforms
│   ├── file_manager.py             # File search, downloads organizer & PDF reader
│   ├── action_executor.py          # Unified action dispatcher & multi-step engine
│   ├── server.py                   # Secure HTTP daemon with Bearer token auth (port 3001)
│   └── tests/                      # Automated test suite
├── src/                            # React 19 Frontend Interface
│   ├── components/
│   │   ├── JarvisCore3D.tsx        # 3D spatial reactive core visualizer
│   │   ├── AudioWaveform.tsx       # Real-time SVG voice waveform
│   │   ├── YouTubePlayerHUD.tsx    # Embedded YouTube IFrame player panel
│   │   ├── TranscriptOverlay.tsx   # Live dual-language voice transcript
│   │   ├── ActionStatusHUD.tsx     # Real-time tool execution status card
│   │   ├── SystemTelemetryBar.tsx  # CPU, RAM, Battery, Volume telemetry
│   │   ├── SettingsMemoryModal.tsx # Memory, voice settings & Windows Agent pairing
│   │   └── CommandHistoryDrawer.tsx# History log of commands & actions
│   ├── hooks/
│   │   └── useJarvisLive.ts        # Dual-mode hook: Gemini Live WS (local) / HTTP+Web Speech (cloud)
│   └── App.tsx                     # Main HUD layout with deployment mode badge
├── server.ts                       # Express + WebSocket + Gemini 3.8 Live bridge (local dev)
├── toolDeclarations.ts             # Function calling declarations for Gemini Live
├── vercel.json                     # Vercel routing & CORS configuration
├── vite.config.ts                  # Vite build with chunk splitting for 3D/React bundles
├── start_agent.bat                 # One-click Windows Local Agent launcher
├── DEPLOY.md                       # Full Vercel deployment guide
├── .env.example                    # Environment variable template
└── package.json
```

---

## 🛡️ Security & Privacy Notice
JARVIS runs locally on your machine. All system controls, volume adjustments, and file operations execute directly within your user environment. Destructive commands (e.g. system shutdown or restart) require verbal or interface approval tokens.

The **Windows Local Agent** uses Bearer token authentication. Tokens are auto-generated per session and printed to the terminal — paste them into the web UI's Settings > Windows Agent tab. The agent only listens on `localhost` and should never be exposed to the public internet.

For cloud deployment security details, see [DEPLOY.md — Security Notes](./DEPLOY.md#security-notes).
