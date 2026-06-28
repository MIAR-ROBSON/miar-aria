import { Router } from "express";
import { db } from "@workspace/db";
import { conversationsTable, messagesTable } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { z } from "zod";

const router = Router();

router.get("/conversations", async (req, res) => {
  try {
    const folderIdParam = req.query.folderId;
    let rows;
    if (folderIdParam !== undefined && folderIdParam !== "") {
      const fid = parseInt(folderIdParam as string, 10);
      rows = await db.select().from(conversationsTable).where(eq(conversationsTable.folderId, fid)).orderBy(conversationsTable.updatedAt);
    } else {
      rows = await db.select().from(conversationsTable).orderBy(conversationsTable.updatedAt);
    }
    res.json(
      rows.map((c) => ({
        ...c,
        folderId: c.folderId ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list conversations" });
  }
});

const createSchema = z.object({
  title: z.string().min(1),
  folderId: z.number().int().nullable().optional(),
});

router.post("/conversations", async (req, res) => {
  try {
    const body = createSchema.parse(req.body);
    const inserted = await db
      .insert(conversationsTable)
      .values({ title: body.title, folderId: body.folderId ?? null })
      .returning();
    const c = inserted[0];
    res.status(201).json({ ...c, folderId: c.folderId ?? null, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Invalid data" });
  }
});

router.get("/conversations/:conversationId", async (req, res) => {
  try {
    const id = parseInt(req.params.conversationId, 10);
    const rows = await db.select().from(conversationsTable).where(eq(conversationsTable.id, id)).limit(1);
    if (!rows.length) return res.status(404).json({ error: "Conversation not found" });
    const c = rows[0];
    const messages = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, id)).orderBy(messagesTable.timestamp);
    res.json({
      ...c,
      folderId: c.folderId ?? null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      messages: messages.map((m) => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
        provider: m.provider ?? null,
        model: m.model ?? null,
      })),
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get conversation" });
  }
});

router.patch("/conversations/:conversationId", async (req, res) => {
  try {
    const id = parseInt(req.params.conversationId, 10);
    const body = z.object({
      title: z.string().min(1).optional(),
      folderId: z.number().int().nullable().optional(),
    }).parse(req.body);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title !== undefined) updates.title = body.title;
    if (body.folderId !== undefined) updates.folderId = body.folderId;
    const updated = await db.update(conversationsTable).set(updates).where(eq(conversationsTable.id, id)).returning();
    if (!updated.length) return res.status(404).json({ error: "Not found" });
    const c = updated[0];
    res.json({ ...c, folderId: c.folderId ?? null, createdAt: c.createdAt.toISOString(), updatedAt: c.updatedAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Invalid data" });
  }
});

router.delete("/conversations/:conversationId", async (req, res) => {
  try {
    const id = parseInt(req.params.conversationId, 10);
    await db.delete(messagesTable).where(eq(messagesTable.conversationId, id));
    await db.delete(conversationsTable).where(eq(conversationsTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete conversation" });
  }
});

router.get("/conversations/:conversationId/messages", async (req, res) => {
  try {
    const id = parseInt(req.params.conversationId, 10);
    const messages = await db.select().from(messagesTable).where(eq(messagesTable.conversationId, id)).orderBy(messagesTable.timestamp);
    res.json(
      messages.map((m) => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
        provider: m.provider ?? null,
        model: m.model ?? null,
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list messages" });
  }
});

export default router;
