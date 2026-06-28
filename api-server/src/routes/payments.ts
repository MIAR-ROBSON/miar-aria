import { Router } from "express";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

const PLANS = {
  pro: { title: "Miar Ária Pro — Mensal", unit_price: 29, currency_id: "BRL" },
  premium: { title: "Miar Ária Premium — Mensal", unit_price: 49, currency_id: "BRL" },
} as const;

const FREE_DAILY_LIMIT = 20;

// GET /api/plan — retorna plano atual e contagem de mensagens hoje
router.get("/plan", async (req, res) => {
  try {
    const rows = await db.select().from(settingsTable).limit(1);
    if (!rows.length) return res.json({ plan: "free", msgCountToday: 0, limitReached: false });

    const r = rows[0];
    const today = new Date().toISOString().slice(0, 10);

    // Reset se for novo dia
    if (r.msgCountDate !== today) {
      await db.update(settingsTable)
        .set({ msgCountToday: 0, msgCountDate: today })
        .where(eq(settingsTable.id, r.id));
      return res.json({ plan: r.plan, msgCountToday: 0, limitReached: false });
    }

    const limitReached = r.plan === "free" && r.msgCountToday >= FREE_DAILY_LIMIT;
    res.json({ plan: r.plan, msgCountToday: r.msgCountToday, limitReached });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Failed to get plan" });
  }
});

// POST /api/checkout — cria preferência no Mercado Pago e retorna URL de checkout
router.post("/checkout", async (req, res) => {
  try {
    const { plan } = req.body as { plan: string };
    const planData = PLANS[plan as keyof typeof PLANS];
    if (!planData) return res.status(400).json({ error: "Plano inválido. Use: pro ou premium" });

    const token = process.env.MP_ACCESS_TOKEN;
    if (!token) {
      return res.status(503).json({ error: "Mercado Pago não configurado. Adicione MP_ACCESS_TOKEN nas variáveis de ambiente." });
    }

    const origin = `${req.protocol}://${req.get("host")}`;
    const preference = {
      items: [{
        title: planData.title,
        quantity: 1,
        unit_price: planData.unit_price,
        currency_id: planData.currency_id,
      }],
      back_urls: {
        success: `${origin}/plans?status=success&plan=${plan}`,
        failure: `${origin}/plans?status=failure`,
        pending: `${origin}/plans?status=pending`,
      },
      auto_return: "approved",
      notification_url: `${origin}/api/payments/webhook`,
      statement_descriptor: "MIAR ARIA",
      metadata: { plan },
    };

    const resp = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(preference),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      req.log.error({ status: resp.status, body: errText }, "MP error");
      return res.status(502).json({ error: "Erro ao criar preferência no Mercado Pago" });
    }

    const data = await resp.json() as { init_point: string; sandbox_init_point: string };
    res.json({ checkoutUrl: data.init_point, sandboxUrl: data.sandbox_init_point });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Falha ao processar pagamento" });
  }
});

// POST /api/payments/webhook — recebe notificação do Mercado Pago
router.post("/payments/webhook", async (req, res) => {
  try {
    const { type, data } = req.body as { type: string; data?: { id?: string } };

    if (type === "payment" && data?.id) {
      const token = process.env.MP_ACCESS_TOKEN;
      if (!token) return res.status(200).json({ ok: true });

      const payResp = await fetch(`https://api.mercadopago.com/v1/payments/${data.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payment = await payResp.json() as {
        status: string;
        metadata?: { plan?: string };
        status_detail: string;
      };

      if (payment.status === "approved") {
        const plan = payment.metadata?.plan as string | undefined;
        if (plan && (plan === "pro" || plan === "premium")) {
          await db.update(settingsTable).set({ plan }).where(eq(settingsTable.id, 2));
          req.log.info({ plan }, "Plano atualizado via webhook MP");
        }
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    req.log.error(err);
    res.status(200).json({ ok: true }); // sempre 200 para MP não retentar
  }
});

export default router;
