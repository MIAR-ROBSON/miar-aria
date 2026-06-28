import { Router } from "express";
import crypto from "crypto";

const router = Router();

// ── Credenciais de acesso ─────────────────────────────────────────────────────
// Usuários: { email, passwordHash (sha256), role }
// role "owner" = acesso total incluindo código-fonte e configurações
// role "tester" = acesso normal sem ver código/configurações

function sha256(s: string) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

const USERS = [
  {
    email: process.env.OWNER_EMAIL ?? "robson@ia.miarmaktub.com",
    passwordHash: sha256(process.env.OWNER_PASSWORD ?? "MiarMaktub@2025!"),
    role: "owner" as const,
    name: "Robson",
  },
];

// Testers adicionados via .env: TESTER_EMAILS=email1:senha1,email2:senha2
function getTesters() {
  const raw = process.env.TESTER_EMAILS ?? "";
  if (!raw) return [];
  return raw.split(",").map((pair) => {
    const [email, password] = pair.trim().split(":");
    return { email: email?.trim(), passwordHash: sha256(password?.trim() ?? ""), role: "tester" as const, name: "Tester" };
  }).filter((u) => u.email);
}

function findUser(email: string, password: string) {
  const hash = sha256(password);
  const all = [...USERS, ...getTesters()];
  return all.find((u) => u.email.toLowerCase() === email.toLowerCase() && u.passwordHash === hash) ?? null;
}

// Sessões simples em memória (token → {role, name, expiresAt})
const sessions = new Map<string, { role: "owner" | "tester"; name: string; expiresAt: number }>();

function createSession(role: "owner" | "tester", name: string) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { role, name, expiresAt: Date.now() + 24 * 60 * 60 * 1000 }); // 24h
  return token;
}

// Limpa sessões expiradas
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of sessions) {
    if (v.expiresAt < now) sessions.delete(k);
  }
}, 60 * 60 * 1000);

// ── Middleware de autenticação exportado ──────────────────────────────────────
export function requireAuth(req: any, res: any, next: any) {
  const token = req.headers["x-session-token"] as string | undefined;
  if (!token) return res.status(401).json({ error: "Não autenticado" });
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token ?? "");
    return res.status(401).json({ error: "Sessão expirada" });
  }
  req.session = session;
  next();
}

export function requireOwner(req: any, res: any, next: any) {
  requireAuth(req, res, () => {
    if (req.session?.role !== "owner") {
      return res.status(403).json({ error: "Acesso restrito ao proprietário" });
    }
    next();
  });
}

// ── Rotas ─────────────────────────────────────────────────────────────────────
router.post("/auth/login", (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "Email e senha obrigatórios" });

  const user = findUser(email, password);
  if (!user) return res.status(401).json({ error: "Email ou senha incorretos" });

  const token = createSession(user.role, user.name);
  res.json({ token, role: user.role, name: user.name });
});

router.post("/auth/logout", (req, res) => {
  const token = req.headers["x-session-token"] as string | undefined;
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

router.get("/auth/me", requireAuth, (req: any, res) => {
  res.json({ role: req.session.role, name: req.session.name });
});

export default router;
