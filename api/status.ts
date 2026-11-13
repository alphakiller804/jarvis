import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const key = process.env.GEMINI_API_KEY;
  const configured = Boolean(key && key.trim() !== "" && key !== "MY_GEMINI_API_KEY");

  return res.status(200).json({
    status: "ONLINE",
    configured,
    environment: "vercel-serverless",
    service: "JARVIS Autonomous Cloud Service",
    timestamp: new Date().toISOString(),
    message: configured
      ? "JARVIS Cloud Core neural link online."
      : "GEMINI_API_KEY is missing. Configure GEMINI_API_KEY in Vercel Project Settings > Environment Variables.",
  });
}

