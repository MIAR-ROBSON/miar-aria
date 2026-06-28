import { Router } from "express";
import { db } from "@workspace/db";
import { messagesTable, conversationsTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";

const router = Router();

const feedbackSchema = z.object({
  feedback: z.enum(["positive", "negative", "love"]).nullable(),
  conversationId: z.number().optional(),
});

const complaintSchema = z.object({
  conversationId: z.number(),
  complaint: z.string().min(1),
  email: z.string().email().optional(),
});

router.patch("/messages/:id/feedback", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid message id" });

    const { feedback, conversationId } = feedbackSchema.parse(req.body);
    await db.update(messagesTable).set({ feedback }).where(eq(messagesTable.id, id));

    // Contar feedbacks negativos consecutivos na conversa
    let negativeCount = 0;
    if (feedback === "negative" && conversationId) {
      const result = await db
        .select({ count: sql<number>`count(*)` })
        .from(messagesTable)
        .where(
          and(
            eq(messagesTable.conversationId, conversationId),
            eq(messagesTable.feedback, "negative")
          )
        );
      negativeCount = Number(result[0]?.count ?? 0);
    }

    res.json({ 
      ok: true, 
      negativeCount, 
      showComplaint: negativeCount >= 10,
      notifyMessage: feedback === "negative" ? "Recebemos seu feedback negativo. Vamos analisar e fazer o possível para melhorar." : null
    });
  } catch (err) {
    req.log.error(err);
    res.status(400).json({ error: "Invalid feedback data" });
  }
});

// Receber reclamação + garantir renovação gratuita
router.post("/feedback/complaint", async (req, res) => {
  try {
    const { conversationId, complaint, email } = complaintSchema.parse(req.body);
    
    // Salvar reclamação no log (pode ser expandido para banco)
    req.log.info({ conversationId, complaint, email }, "Complaint received");
    
    // Aqui futuramente: enviar email para Robson, registrar no banco, etc.
    
    res.json({ 
      ok: true, 
      message: "Reclamação recebida. Nossa equipe irá avaliar e você receberá uma renovação gratuita em até 24h." 
    });
  } catch (err) {
    res.status(400).json({ error: "Dados inválidos" });
  }
});

export default router;
