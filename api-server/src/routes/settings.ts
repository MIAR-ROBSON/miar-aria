import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

async function getOrCreateSettings() {
  const rows = await db.select().from(settingsTable).limit(1);
  if (rows.length > 0) return rows[0];

  const parseEnvKeys = (envVal: string | undefined): string[] =>
    envVal ? envVal.split(",").map((k) => k.trim()).filter(Boolean) : [];

  const groqEnv = parseEnvKeys(process.env.GROQ_API_KEY);
  const openrouterEnv = parseEnvKeys(process.env.OPENROUTER_API_KEY);
  const geminiEnv = parseEnvKeys(process.env.GEMINI_API_KEY);
  const mistralEnv = parseEnvKeys(process.env.MISTRAL_API_KEY);
  const mem0Env = process.env.MEM0_API_KEY ?? null;

  const inserted = await db.insert(settingsTable).values({
    groqKeys: JSON.stringify(groqEnv),
    openrouterKeys: JSON.stringify(openrouterEnv),
    geminiKeys: JSON.stringify(geminiEnv),
    mistralKeys: JSON.stringify(mistralEnv),
    mem0Key: mem0Env,
    userEmail: "robson@miarmaktub.com",
  }).returning();
  return inserted[0];
}

function rowToSettings(r: typeof settingsTable.$inferSelect) {
  return {
    groqKeys: JSON.parse(r.groqKeys || "[]"),
    openrouterKeys: JSON.parse(r.openrouterKeys || "[]"),
    geminiKeys: JSON.parse(r.geminiKeys || "[]"),
    mistralKeys: JSON.parse(r.mistralKeys || "[]"),
    mem0Key: r.mem0Key ?? null,
    userEmail: r.userEmail,
    directives: r.directives,
    theme: r.theme,
    audioSpeed: r.audioSpeed,
    activeProvider: r.activeProvider,
    activeModel: r.activeModel,
    plan: r.plan ?? "free",
    silentMode: r.silentMode === 1,
    saveToMemory: r.saveToMemory !== 0,
    groqEnabled: r.groqEnabled !== 0,
    openrouterEnabled: r.openrouterEnabled !== 0,
    geminiEnabled: r.geminiEnabled !== 0,
    mistralEnabled: r.mistralEnabled !== 0,
  };
}

router.get("/settings", async (req, res) => {
  try {
    const row = await getOrCreateSettings();
    res.json(rowToSettings(row));
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get settings" });
  }
});

const updateSchema = z.object({
  groqKeys: z.array(z.string()).optional(),
  openrouterKeys: z.array(z.string()).optional(),
  geminiKeys: z.array(z.string()).optional(),
  mistralKeys: z.array(z.string()).optional(),
  mem0Key: z.string().nullable().optional(),
  userEmail: z.string().optional(),
  directives: z.string().optional(),
  theme: z.string().optional(),
  audioSpeed: z.number().optional(),
  activeProvider: z.string().optional(),
  activeModel: z.string().optional(),
  silentMode: z.boolean().optional(),
  saveToMemory: z.boolean().optional(),
  groqEnabled: z.boolean().optional(),
  openrouterEnabled: z.boolean().optional(),
  geminiEnabled: z.boolean().optional(),
  mistralEnabled: z.boolean().optional(),
});

router.put("/settings", async (req, res) => {
  try {
    const body = updateSchema.parse(req.body);
    const row = await getOrCreateSettings();

    const updates: Record<string, unknown> = {};
    if (body.groqKeys !== undefined) updates.groqKeys = JSON.stringify(body.groqKeys);
    if (body.openrouterKeys !== undefined) updates.openrouterKeys = JSON.stringify(body.openrouterKeys);
    if (body.geminiKeys !== undefined) updates.geminiKeys = JSON.stringify(body.geminiKeys);
    if (body.mistralKeys !== undefined) updates.mistralKeys = JSON.stringify(body.mistralKeys);
    if (body.mem0Key !== undefined) updates.mem0Key = body.mem0Key;
    if (body.userEmail !== undefined) updates.userEmail = body.userEmail;
    if (body.directives !== undefined) updates.directives = body.directives;
    if (body.theme !== undefined) updates.theme = body.theme;
    if (body.audioSpeed !== undefined) updates.audioSpeed = body.audioSpeed;
    if (body.activeProvider !== undefined) updates.activeProvider = body.activeProvider;
    if (body.activeModel !== undefined) updates.activeModel = body.activeModel;
    if (body.silentMode !== undefined) updates.silentMode = body.silentMode ? 1 : 0;
    if (body.saveToMemory !== undefined) updates.saveToMemory = body.saveToMemory ? 1 : 0;
    if (body.groqEnabled !== undefined) updates.groqEnabled = body.groqEnabled ? 1 : 0;
    if (body.openrouterEnabled !== undefined) updates.openrouterEnabled = body.openrouterEnabled ? 1 : 0;
    if (body.geminiEnabled !== undefined) updates.geminiEnabled = body.geminiEnabled ? 1 : 0;
    if (body.mistralEnabled !== undefined) updates.mistralEnabled = body.mistralEnabled ? 1 : 0;

    const updated = await db
      .update(settingsTable)
      .set(updates)
      .where(eq(settingsTable.id, row.id))
      .returning();

    res.json(rowToSettings(updated[0]));
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Invalid settings data" });
  }
});

router.get("/settings/token-usage", async (req, res) => {
  try {
    const row = await getOrCreateSettings();

    const mergeKeys = (dbRaw: string, envKey: string | undefined): string[] => {
      const dbKeys = (JSON.parse(dbRaw || "[]") as string[]).filter(Boolean);
      if (dbKeys.length > 0) return dbKeys;
      return envKey ? [envKey] : [];
    };

    const groqKeys = mergeKeys(row.groqKeys, process.env.GROQ_API_KEY);
    const openrouterKeys = mergeKeys(row.openrouterKeys, process.env.OPENROUTER_API_KEY);
    const geminiKeys = mergeKeys(row.geminiKeys, process.env.GEMINI_API_KEY);
    const mistralKeys = mergeKeys(row.mistralKeys, process.env.MISTRAL_API_KEY);

    const DAILY_LIMIT_PER_KEY = 500_000;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { messagesTable } = await import("@workspace/db");
    const { gte } = await import("drizzle-orm");
    const todayMsgs = await db.select().from(messagesTable).where(gte(messagesTable.timestamp, today));
    const tokensByProvider: Record<string, number> = {};
    for (const m of todayMsgs) {
      const p = m.provider || "groq";
      tokensByProvider[p] = (tokensByProvider[p] || 0) + Math.ceil(m.content.length / 4);
    }

    const providers = [
      { provider: "groq", keys: groqKeys, enabled: row.groqEnabled !== 0 },
      { provider: "openrouter", keys: openrouterKeys, enabled: row.openrouterEnabled !== 0 },
      { provider: "gemini", keys: geminiKeys, enabled: row.geminiEnabled !== 0 },
      { provider: "mistral", keys: mistralKeys, enabled: row.mistralEnabled !== 0 },
    ].map(({ provider, keys, enabled }) => {
      const limit = enabled ? keys.length * DAILY_LIMIT_PER_KEY : 0;
      const used = tokensByProvider[provider] || 0;
      const remaining = Math.max(0, limit - used);
      const percentRemaining = limit > 0 ? Math.round((remaining / limit) * 100) : 0;
      return { provider, percentRemaining, tokensUsed: used, tokensLimit: limit };
    });

    const configured = providers.filter((p) => p.tokensLimit > 0);
    const overall =
      configured.length > 0
        ? Math.round(configured.reduce((sum, p) => sum + p.percentRemaining, 0) / configured.length)
        : 0;

    res.json({ overall, providers: providers.filter(p => p.tokensLimit > 0) });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get token usage" });
  }
});

export default router;
