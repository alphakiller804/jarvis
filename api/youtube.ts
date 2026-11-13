import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const query = (req.query.q as string) || (req.body?.query as string) || "";
  if (!query.trim()) {
    return res.status(400).json({ error: "Missing query parameter 'q'" });
  }

  const cleanQuery = query.trim();
  const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanQuery)}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    const resp = await fetch(searchUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      return res.status(200).json({
        success: true,
        query: cleanQuery,
        url: searchUrl,
        videoId: null,
      });
    }

    const html = await resp.text();
    const matches = Array.from(html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g));

    let foundId: string | null = null;
    for (const match of matches) {
      const vid = match[1];
      if (vid && vid.length === 11 && vid !== "dQw4w9WgXcQ") {
        foundId = vid;
        break;
      }
    }

    return res.status(200).json({
      success: true,
      query: cleanQuery,
      videoId: foundId,
      url: foundId ? `https://www.youtube.com/watch?v=${foundId}` : searchUrl,
      embedUrl: foundId ? `https://www.youtube-nocookie.com/embed/${foundId}?autoplay=1&enablejsapi=1` : null,
      message: foundId ? `Found video for '${cleanQuery}'` : `Opened YouTube search for '${cleanQuery}'`,
    });
  } catch (err: any) {
    return res.status(200).json({
      success: true,
      query: cleanQuery,
      videoId: null,
      url: searchUrl,
      error: err?.message,
    });
  }
}

