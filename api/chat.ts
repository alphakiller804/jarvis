import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";

// --- Simple in-memory rate limiter (max 60 req/min per IP, local exempt) ---
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  if (
    ip === "127.0.0.1" ||
    ip === "localhost" ||
    ip === "::1" ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    ip === "unknown"
  ) {
    return true; // Local/LAN development is exempt
  }
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || now > record.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true; // allowed
  }
  if (record.count >= RATE_LIMIT_MAX) return false; // blocked
  record.count++;
  return true; // allowed
}

// Clean up old entries every 5 minutes to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetAt) rateLimitMap.delete(ip);
  }
}, 5 * 60_000);

export function getCandidateModels(): string[] {
  const primary = process.env.GEMINI_PRIMARY_MODEL || "gemini-flash-lite-latest";
  const configuredFallbacks = process.env.GEMINI_FALLBACK_MODELS
    ? process.env.GEMINI_FALLBACK_MODELS.split(",").map((s) => s.trim()).filter(Boolean)
    : [
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-3.1-flash-lite-preview",
        "gemini-3-flash-preview",
      ];

  return Array.from(new Set([primary, ...configuredFallbacks]));
}

function calculateBackoffDelay(attempt: number, baseMs: number = 300, maxMs: number = 2500): number {
  const expDelay = baseMs * Math.pow(2, attempt - 1);
  const jitter = expDelay * 0.3 * (Math.random() * 2 - 1);
  return Math.min(maxMs, Math.max(100, Math.round(expDelay + jitter)));
}

function isTransientError(err: any): boolean {
  const msg = String(err?.message || "").toLowerCase();
  const status = Number(err?.status || err?.code || 0);
  if (status === 503 || status === 502 || status === 504 || status === 429) return true;
  if (
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("enotfound") ||
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("unavailable")
  ) {
    return true;
  }
  return false;
}

const JARVIS_SYSTEM_INSTRUCTION = `You are JARVIS, an advanced, intelligent, fully voice-controlled personal AI assistant for Windows 11 and web platforms.
You are articulate, calm, composed, respectful, confident, and capable of both natural open conversation and executing real-world actions.

CORE RULES & BEHAVIOR:
1. DISTINGUISH BETWEEN KNOWLEDGE AND ACTIONS:
   - If the user asks a conversational, conceptual, technical, or scientific question, explain it clearly and naturally in 1 to 3 spoken sentences.
   - If the user instructs you to perform an action (e.g., play music, open YouTube, change volume, open an app, search files, manage windows, take a screenshot, lock PC, browse the web), YOU MUST IMMEDIATELY CALL THE APPROPRIATE TOOL.
   - Do NOT just speak instructions or tell the user how to do it manually. Execute the tool directly.

2. MULTILINGUAL & ROMAN URDU COMPREHENSION:
   - Understand natural English, Urdu, and Roman Urdu commands with any accent or colloquial phrasing.
   - Examples of Roman Urdu / Urdu commands:
     * "YouTube par Tumse Koi Pyara song chalao" -> call play_youtube(query="Tumse Koi Pyara", category="music")
     * "Atif Aslam ke gaane chalao" -> call play_youtube(query="Atif Aslam songs", category="music")
     * "Music pause karo" / "gaana roko" -> call media_control(action="pause")
     * "Resume karo" / "chalao" -> call media_control(action="resume")
     * "Agla gaana lagao" / "next song" -> call media_control(action="next")
     * "Volume 40 percent karo" -> call system_control(action="set_volume", value=40)
     * "Aawaz thori kam karo" -> call system_control(action="volume_down", value=15)
     * "VS Code kholo" -> call launch_application(app_name="VS Code")
     * "Chrome open karo" -> call launch_application(app_name="Chrome")
     * "Screenshot lo" -> call system_control(action="screenshot")
     * "Computer lock karo" -> call system_control(action="lock")
     * "Downloads folder organize karo" -> call file_operation(action="organize_downloads")
     * "Meri PDF files dhoondo" -> call file_operation(action="search", extension="pdf")
     * "Jarvis stop everything" -> call emergency_stop()

3. SPOKEN CONFIRMATION:
   - When responding, speak clearly, naturally, and concisely in the user's language without heavy markdown formatting or bullet points.`;

const TOOLS_CONFIG = [
  {
    functionDeclarations: [
      {
        name: "play_youtube",
        description: "Plays music, songs, artists, playlists, or videos on YouTube.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: { type: Type.STRING, description: "Song, artist, playlist, or video query" },
            category: { type: Type.STRING, description: "Category: 'music' or 'video' or 'movie'" },
          },
          required: ["query"],
        },
      },
      {
        name: "media_control",
        description: "Controls active media playback (pause, resume, stop, next, previous, fullscreen, volume_set, mute, unmute).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, description: "Action: pause, resume, stop, next, previous, fullscreen, volume_set, volume_up, volume_down, mute, unmute" },
            value: { type: Type.NUMBER, description: "Optional volume level (0-100) or step amount" },
          },
          required: ["action"],
        },
      },
      {
        name: "search_movie",
        description: "Searches for movies, shows, or trailers across YouTube or streaming platforms.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, description: "Movie title or query" },
            platform: { type: Type.STRING, description: "Platform: 'youtube', 'netflix', 'prime', 'disney'" },
          },
          required: ["title"],
        },
      },
      {
        name: "launch_application",
        description: "Launches a Windows application by name (e.g. Chrome, Edge, VS Code, Notepad, File Explorer, Calculator, Spotify).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            app_name: { type: Type.STRING, description: "Application name" },
            args: { type: Type.STRING, description: "Optional arguments" },
          },
          required: ["app_name"],
        },
      },
      {
        name: "close_application",
        description: "Closes a running application.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            app_name: { type: Type.STRING, description: "Application name to close" },
          },
          required: ["app_name"],
        },
      },
      {
        name: "manage_window",
        description: "Manages Windows desktop application windows (focus, minimize, maximize, list).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, description: "Action: focus, minimize, maximize, list" },
            window_title: { type: Type.STRING, description: "Title of target window" },
          },
          required: ["action"],
        },
      },
      {
        name: "system_control",
        description: "Performs Windows system control: set_volume, mute, unmute, screenshot, get_status, lock, sleep, shutdown.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, description: "Action: set_volume, mute, unmute, screenshot, get_status, lock, sleep, shutdown, restart, cancel_shutdown" },
            value: { type: Type.NUMBER, description: "Optional volume value" },
            confirm_token: { type: Type.STRING, description: "Confirmation token for destructive actions" },
            confirmed: { type: Type.BOOLEAN, description: "Whether the user explicitly confirmed the destructive action" },
          },
          required: ["action"],
        },
      },
      {
        name: "file_operation",
        description: "Searches, opens, creates, renames, moves, copies, or reads files and documents (.pdf, .txt, .md).",
        parameters: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, description: "Action: search, open, create_folder, rename, move, copy, organize_downloads, read_file" },
            query: { type: Type.STRING, description: "Search query or filename" },
            extension: { type: Type.STRING, description: "File extension filter" },
            target: { type: Type.STRING, description: "Target path to open or read" },
          },
          required: ["action"],
        },
      },
      {
        name: "browser_action",
        description: "Opens specific websites (Google, GitHub, YouTube, ChatGPT), URLs, or performs web searches.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, description: "Action: open_site, open_url, search" },
            site: { type: Type.STRING, description: "Website name" },
            url: { type: Type.STRING, description: "URL to open" },
            query: { type: Type.STRING, description: "Search query" },
          },
          required: ["action"],
        },
      },
      {
        name: "memory_operation",
        description: "Manages persistent preferences and memory.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            action: { type: Type.STRING, description: "Action: get, set, delete, list" },
            key: { type: Type.STRING, description: "Preference key" },
            value: { type: Type.STRING, description: "Preference value" },
            category: { type: Type.STRING, description: "Category" },
          },
          required: ["action"],
        },
      },
      {
        name: "emergency_stop",
        description: "Immediately stops all active operations and media.",
        parameters: {
          type: Type.OBJECT,
          properties: {},
        },
      },
    ],
  },
];

async function resolveYouTubeVideoId(query: string): Promise<string | null> {
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const resp = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const html = await resp.text();
    const matches = Array.from(html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g));
    for (const match of matches) {
      const vid = match[1];
      if (vid && vid.length === 11 && vid !== "dQw4w9WgXcQ") {
        return vid;
      }
    }
  } catch {}
  return null;
}

interface PendingPowerOp {
  action: "shutdown" | "restart" | "sleep";
  timestamp: number;
}
let activePendingPowerOp: PendingPowerOp | null = null;

function detectLocalWindowsIntent(text: string): {
  tool: string;
  args: any;
  spokenText: string;
  requiresConfirmation?: boolean;
} | null {
  // Normalize punctuation and extra spaces
  const norm = text
    .trim()
    .toLowerCase()
    .replace(/[.,!?;:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 1. Cancel shutdown / abort
  if (
    norm.includes("cancel shutdown") ||
    norm.includes("abort shutdown") ||
    norm.includes("shutdown cancel") ||
    norm.includes("shutdown roko") ||
    norm.includes("band mat karo") ||
    (norm === "cancel" && activePendingPowerOp) ||
    (norm === "mat karo" && activePendingPowerOp)
  ) {
    activePendingPowerOp = null;
    return {
      tool: "system_control",
      args: { action: "cancel_shutdown" },
      spokenText: "Pending Windows shutdown has been cancelled, Sir.",
    };
  }

  // 2. Confirmation of active pending power operation
  const isConfirmWord =
    norm === "confirm" ||
    norm === "confirm shutdown" ||
    norm === "yes" ||
    norm === "yes shutdown" ||
    norm === "haan" ||
    norm === "haan band kar do" ||
    norm === "haan band kardo" ||
    norm === "theek hai band kardo" ||
    norm === "theek hai band kar do" ||
    norm === "proceed";

  if (activePendingPowerOp && Date.now() - activePendingPowerOp.timestamp < 60000) {
    if (isConfirmWord) {
      const op = activePendingPowerOp.action;
      activePendingPowerOp = null;
      return {
        tool: "system_control",
        args: { action: op, confirmed: true, delay: 0 },
        spokenText:
          op === "shutdown"
            ? "Shutting down the computer now, Sir. Goodbye."
            : `${op.charAt(0).toUpperCase() + op.slice(1)} initiated, Sir.`,
      };
    }
  }

  // 3. Initial Shutdown request (English & Roman Urdu)
  const isShutdownPhrase =
    norm.includes("computer band kar do") ||
    norm.includes("computer band kardo") ||
    norm.includes("pc band kar do") ||
    norm.includes("pc band kardo") ||
    norm.includes("system band kar do") ||
    norm.includes("laptop band kar do") ||
    norm.includes("band kar do computer") ||
    norm === "shutdown" ||
    norm === "shut down" ||
    norm === "shut down computer" ||
    norm === "shutdown computer" ||
    norm === "turn off computer" ||
    norm === "turn off pc" ||
    norm === "power off";

  if (isShutdownPhrase) {
    activePendingPowerOp = { action: "shutdown", timestamp: Date.now() };
    return {
      tool: "system_control",
      args: { action: "shutdown" },
      requiresConfirmation: true,
      spokenText:
        "Are you sure you want to shut down the computer, Sir? Please say 'confirm shutdown' to proceed, or 'cancel'.",
    };
  }

  // 4. Initial Restart request
  const isRestartPhrase =
    norm.includes("computer restart kar do") ||
    norm.includes("computer restart kardo") ||
    norm.includes("pc restart karo") ||
    norm === "restart" ||
    norm === "reboot" ||
    norm === "restart computer" ||
    norm === "restart pc";

  if (isRestartPhrase) {
    activePendingPowerOp = { action: "restart", timestamp: Date.now() };
    return {
      tool: "system_control",
      args: { action: "restart" },
      requiresConfirmation: true,
      spokenText:
        "Are you sure you want to restart the computer, Sir? Please say 'confirm' to proceed, or 'cancel'.",
    };
  }

  // 5. Lock computer
  if (
    norm === "lock" ||
    norm === "lock pc" ||
    norm === "lock computer" ||
    norm.includes("computer lock karo") ||
    norm.includes("pc lock karo")
  ) {
    return {
      tool: "system_control",
      args: { action: "lock" },
      spokenText: "Computer locked, Sir.",
    };
  }

  // 6. Volume controls (e.g. "volume 50 percent karo", "volume 50%", "aawaz 40 karo")
  const volMatch = norm.match(/(?:volume|aawaz|awaaz)\s*(\d{1,3})\s*(?:percent|%|karo)?/);
  if (volMatch && volMatch[1]) {
    const val = Math.min(100, Math.max(0, parseInt(volMatch[1], 10)));
    return {
      tool: "system_control",
      args: { action: "set_volume", value: val },
      spokenText: `Volume set to ${val} percent, Sir.`,
    };
  }

  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, x-jarvis-agent-url, x-jarvis-agent-token");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  // Rate limiting
  const clientIp =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      error: "Too many requests. Please slow down — maximum 20 requests per minute.",
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return res.status(500).json({
      error: "GEMINI_API_KEY is not configured in Vercel environment variables.",
    });
  }

  const { message, history = [], agentUrl, agentToken, reqId: clientReqId } = req.body || {};
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ error: "Missing required parameter 'message'" });
  }

  const reqId = clientReqId || `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  console.log(`[BACKEND] Request received [${reqId}] from ${clientIp}: "${message.trim().slice(0, 60)}"`);

  // --- Fast Verified Local Windows Intent Processing ---
  const localIntent = detectLocalWindowsIntent(message.trim());
  if (localIntent) {
    console.log(`[LOCAL INTENT] Detected: ${localIntent.tool} (${JSON.stringify(localIntent.args)}) requires_conf: ${Boolean(localIntent.requiresConfirmation)}`);
    if (localIntent.requiresConfirmation) {
      return res.status(200).json({
        success: true,
        reqId,
        response: localIntent.spokenText,
        action: {
          tool: localIntent.tool,
          args: localIntent.args,
          status: "pending_confirmation",
          requires_confirmation: true,
        },
        model: "local-command-engine",
      });
    }

    // Direct execution on Windows Local Agent
    const targetUrl = (typeof agentUrl === "string" && agentUrl.trim()) ? agentUrl : "http://127.0.0.1:3001";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const agentResp = await fetch(`${targetUrl.replace(/\/$/, "")}/api/action`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(agentToken ? { "Authorization": `Bearer ${agentToken}` } : {}),
        },
        body: JSON.stringify({ tool: localIntent.tool, args: localIntent.args }),
      });
      clearTimeout(timeout);
      const agentData = (await agentResp.json().catch(() => ({}))) as any;
      const finalReply = agentData.message || localIntent.spokenText;
      return res.status(200).json({
        success: true,
        reqId,
        response: finalReply,
        action: {
          tool: localIntent.tool,
          args: localIntent.args,
          status: agentData.success !== false ? "completed" : "failed",
          result: agentData,
        },
        model: "local-command-engine",
      });
    } catch {
      return res.status(200).json({
        success: true,
        reqId,
        response: localIntent.spokenText,
        action: {
          tool: localIntent.tool,
          args: localIntent.args,
          status: "pending_agent",
          requiresLocalAgent: true,
        },
        model: "local-command-engine",
      });
    }
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  // Format conversational context
  const contents: any[] = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-8)) {
      if (h.role && h.text) {
        contents.push({
          role: h.role === "user" ? "user" : "model",
          parts: [{ text: h.text }],
        });
      }
    }
  }
  contents.push({
    role: "user",
    parts: [{ text: message.trim() }],
  });

  let lastError: any = null;
  const candidateModels = getCandidateModels();

  for (const modelName of candidateModels) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const startTime = Date.now();
        console.log(`[GEMINI] Request started [${reqId}] model: ${modelName} (attempt ${attempt}/3)`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents,
          config: {
            systemInstruction: JARVIS_SYSTEM_INSTRUCTION,
            tools: TOOLS_CONFIG as any,
            temperature: 0.7,
          },
        });
        const durationMs = Date.now() - startTime;
        console.log(`[GEMINI] Response received [${reqId}] model: ${modelName} in ${durationMs}ms`);

        const functionCalls = response.functionCalls;
        let actionPayload: any = null;
        let mediaPayload: any = null;
        let spokenText = response.text || "";

        if (functionCalls && functionCalls.length > 0) {
          const call = functionCalls[0];
          const toolName = call.name;
          const toolArgs = call.args || {};

          console.log(`[CLOUD AGENT TOOL CALLED] ${toolName}:`, toolArgs);

          if (toolName === "play_youtube") {
            const songQuery = String(toolArgs.query || message).replace(/song|video/gi, "").trim();
            const videoId = await resolveYouTubeVideoId(songQuery);

            mediaPayload = {
              type: "youtube",
              query: songQuery,
              videoId,
              embedUrl: videoId ? `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&enablejsapi=1` : null,
            };

            actionPayload = {
              tool: "play_youtube",
              args: toolArgs,
              status: "completed",
              result: {
                success: true,
                query: songQuery,
                videoId,
                message: `Playing '${songQuery}' on YouTube`,
              },
            };

            if (!spokenText) {
              spokenText = `Playing ${songQuery} on YouTube, Sir.`;
            }
          } else if (toolName === "media_control") {
            actionPayload = {
              tool: "media_control",
              args: toolArgs,
              status: "completed",
              result: {
                success: true,
                action: toolArgs.action,
                value: toolArgs.value,
                message: `Media ${toolArgs.action} command executed.`,
              },
            };
            if (!spokenText) {
              spokenText = `Media ${toolArgs.action} applied, Sir.`;
            }
          } else if (
            toolName === "launch_application" ||
            toolName === "close_application" ||
            toolName === "manage_window" ||
            toolName === "system_control" ||
            toolName === "file_operation" ||
            toolName === "browser_action" ||
            toolName === "search_movie"
          ) {
            // Forward desktop action to Windows Local Agent (defaulting to local port 3001)
            const targetUrl = (typeof agentUrl === "string" && agentUrl.trim()) ? agentUrl : "http://127.0.0.1:3001";
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 4000);
              const agentResp = await fetch(`${targetUrl.replace(/\/$/, "")}/api/action`, {
                method: "POST",
                signal: controller.signal,
                headers: {
                  "Content-Type": "application/json",
                  ...(agentToken ? { "Authorization": `Bearer ${agentToken}` } : {}),
                },
                body: JSON.stringify({ tool: toolName, args: toolArgs }),
              });
              clearTimeout(timeout);
              if (agentResp.ok) {
                const agentData = (await agentResp.json()) as {
                  success?: boolean;
                  message?: string;
                  requires_confirmation?: boolean;
                  [key: string]: any;
                };
                if (agentData.requires_confirmation) {
                  activePendingPowerOp = {
                    action: (toolArgs.action as any) || "shutdown",
                    timestamp: Date.now(),
                  };
                  actionPayload = {
                    tool: toolName,
                    args: toolArgs,
                    status: "pending_confirmation",
                    requires_confirmation: true,
                    result: agentData,
                  };
                  spokenText =
                    agentData.message ||
                    "Are you sure you want to proceed, Sir? Please say 'confirm shutdown' or 'cancel'.";
                } else {
                  actionPayload = {
                    tool: toolName,
                    args: toolArgs,
                    status: agentData.success !== false ? "completed" : "failed",
                    result: agentData,
                  };
                  if (!spokenText) {
                    spokenText = agentData.message || `${toolName.replace(/_/g, " ")} executed, Sir.`;
                  }
                }
              } else {
                throw new Error(`Agent status ${agentResp.status}`);
              }
            } catch (agentErr: any) {
              actionPayload = {
                tool: toolName,
                args: toolArgs,
                status: "pending_agent",
                requiresLocalAgent: true,
                result: {
                  success: false,
                  requiresLocalAgent: true,
                  message: `Desktop control for '${toolName}' requires the JARVIS Windows Local Agent running on your PC.`,
                },
              };
              if (!spokenText) {
                spokenText = `Sir, controlling local Windows applications requires your JARVIS Local Agent.`;
              }
            }
          } else if (toolName === "emergency_stop") {
            actionPayload = {
              tool: "emergency_stop",
              args: {},
              status: "completed",
              result: { success: true, message: "EMERGENCY STOP TRIGGERED" },
            };
            spokenText = "Emergency stop activated. All operations halted, Sir.";
          } else {
            actionPayload = {
              tool: toolName,
              args: toolArgs,
              status: "completed",
              result: { success: true, message: `Executed ${toolName}` },
            };
          }
        }

        console.log(`[AI] Response generated [${reqId}] length: ${spokenText.length} chars, tool: ${actionPayload?.tool || "none"}`);

        return res.status(200).json({
          success: true,
          reqId,
          response: spokenText || "I am online and ready, Sir.",
          action: actionPayload,
          media: mediaPayload,
          model: modelName,
        });
      } catch (err: any) {
        lastError = err;
        const transient = isTransientError(err);
        console.warn(`[GEMINI API] Model ${modelName} (attempt ${attempt}/3) error:`, err?.status || err?.message);
        if (attempt < 3 && transient) {
          const delay = calculateBackoffDelay(attempt);
          console.log(`[GEMINI API] Retrying ${modelName} in ${delay}ms with exponential backoff + jitter...`);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        break; // break retry loop to try next model
      }
    }
  }

  return res.status(503).json({
    success: false,
    error: lastError?.message || "All AI models are currently experiencing high demand. Please try again.",
  });
}

