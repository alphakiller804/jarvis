import type { VercelRequest, VercelResponse } from "@vercel/node";

// In-memory fallback for serverless execution
const inMemoryStore: Record<string, { value: string; category: string; updated_at: string }> = {
  user_title: { value: "Sir", category: "general", updated_at: new Date().toISOString() },
  preferred_language: { value: "English and Urdu", category: "language", updated_at: new Date().toISOString() },
  preferred_music_genre: { value: "Romantic / Pop", category: "music", updated_at: new Date().toISOString() },
  response_style: { value: "Concise, respectful, composed", category: "persona", updated_at: new Date().toISOString() },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    const category = req.query.category as string;
    const list = Object.entries(inMemoryStore)
      .filter(([_, item]) => !category || item.category === category)
      .map(([key, item]) => ({
        key,
        value: item.value,
        category: item.category,
        updated_at: item.updated_at,
      }));

    return res.status(200).json({ success: true, preferences: list });
  }

  if (req.method === "POST") {
    const { key, value, category = "general" } = req.body || {};
    if (!key || value === undefined) {
      return res.status(400).json({ error: "Missing 'key' or 'value'" });
    }

    inMemoryStore[key] = {
      value: String(value),
      category: String(category),
      updated_at: new Date().toISOString(),
    };

    return res.status(200).json({
      success: true,
      key,
      value,
      category,
      message: `Saved preference '${key}'`,
    });
  }

  if (req.method === "DELETE") {
    const key = (req.query.key as string) || (req.body?.key as string);
    if (!key) {
      return res.status(400).json({ error: "Missing 'key' query parameter" });
    }

    const existed = key in inMemoryStore;
    delete inMemoryStore[key];

    return res.status(200).json({ success: existed, key });
  }

  return res.status(405).json({ error: "Method not allowed" });
}

