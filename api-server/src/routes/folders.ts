import { Router } from "express";
import { db } from "@workspace/db";
import { foldersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router = Router();

router.get("/folders", async (req, res) => {
  try {
    const folders = await db.select().from(foldersTable).orderBy(foldersTable.createdAt);
    res.json(
      folders.map((f) => ({
        ...f,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      }))
    );
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to list folders" });
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  isShared: z.boolean().optional(),
});

router.post("/folders", async (req, res) => {
  try {
    const body = createSchema.parse(req.body);
    const inserted = await db
      .insert(foldersTable)
      .values({ name: body.name, isShared: body.isShared ?? false })
      .returning();
    const f = inserted[0];
    res.status(201).json({ ...f, createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Invalid folder data" });
  }
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  isShared: z.boolean().optional(),
});

router.patch("/folders/:folderId", async (req, res) => {
  try {
    const id = parseInt(req.params.folderId, 10);
    const body = updateSchema.parse(req.body);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) updates.name = body.name;
    if (body.isShared !== undefined) updates.isShared = body.isShared;
    const updated = await db.update(foldersTable).set(updates).where(eq(foldersTable.id, id)).returning();
    if (!updated.length) return res.status(404).json({ error: "Folder not found" });
    const f = updated[0];
    res.json({ ...f, createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString() });
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Invalid data" });
  }
});

router.delete("/folders/:folderId", async (req, res) => {
  try {
    const id = parseInt(req.params.folderId, 10);
    await db.delete(foldersTable).where(eq(foldersTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to delete folder" });
  }
});

export default router;
