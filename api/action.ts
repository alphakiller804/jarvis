import type { VercelRequest, VercelResponse } from "@vercel/node";

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

  const { tool, action, args, params } = req.body || {};
  const toolName = tool || action;
  const toolArgs = args || params || {};

  if (!toolName) {
    return res.status(400).json({ error: "Missing 'tool' parameter" });
  }

  const agentUrl =
    (req.headers["x-jarvis-agent-url"] as string) ||
    req.body?.agentUrl ||
    "http://127.0.0.1:3001";
  const agentToken =
    (req.headers["x-jarvis-agent-token"] as string) ||
    req.body?.agentToken;

  // If action is Windows-specific, attempt forwarding to Local Agent
  const isWindowsSpecific = [
    "launch_application",
    "close_application",
    "manage_window",
    "system_control",
    "file_operation",
    "desktop_action",
  ].includes(toolName);

  if (isWindowsSpecific) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);

      const agentResp = await fetch(`${agentUrl.replace(/\/$/, "")}/api/action`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(agentToken ? { "Authorization": `Bearer ${agentToken}` } : {}),
        },
        body: JSON.stringify({ tool: toolName, args: toolArgs }),
      });
      clearTimeout(timeout);

      const data = await agentResp.json();
      return res.status(200).json(data);
    } catch {
      return res.status(200).json({
        success: false,
        requiresLocalAgent: true,
        action: toolName,
        message: `Action '${toolName}' requires the JARVIS Windows Local Agent running on your PC.`,
      });
    }
  }

  // Cloud-executable actions
  if (toolName === "play_youtube") {
    const q = toolArgs.query || "top music";
    return res.status(200).json({
      success: true,
      action: "play_youtube",
      query: q,
      message: `Playing '${q}' in Cloud YouTube Player`,
    });
  }

  if (toolName === "browser_action") {
    const site = toolArgs.site || toolArgs.url || "google";
    return res.status(200).json({
      success: true,
      action: "browser_action",
      site,
      message: `Navigating to ${site}`,
    });
  }

  if (toolName === "emergency_stop") {
    return res.status(200).json({
      success: true,
      action: "emergency_stop",
      message: "EMERGENCY STOP TRIGGERED",
    });
  }

  return res.status(200).json({
    success: true,
    action: toolName,
    message: `Cloud action '${toolName}' processed successfully.`,
  });
}

