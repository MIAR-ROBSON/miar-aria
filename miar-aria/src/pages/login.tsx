import { useState } from "react";

const BASE_URL = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");

interface Props {
  onLogin: (token: string, role: "owner" | "tester", name: string) => void;
}

export function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const isMobile = window.innerWidth < 768;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const resp = await fetch(`${BASE_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await resp.json() as { token?: string; role?: string; name?: string; error?: string };
      if (!resp.ok || !data.token) {
        setError(data.error ?? "Email ou senha incorretos");
        setLoading(false);
        return;
      }
      localStorage.setItem("miar_token", data.token);
      localStorage.setItem("miar_role", data.role ?? "tester");
      onLogin(data.token, data.role as "owner" | "tester", data.name ?? "");
    } catch {
      setError("Erro de conexão.");
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      minWidth: "100vw",
      backgroundImage: `url(${isMobile ? "/login-mobile.png" : "/login-desktop.png"})`,
      backgroundSize: "cover",
      backgroundPosition: "center top",
      backgroundRepeat: "no-repeat",
      display: "flex",
      alignItems: "center",
      // Desktop: formulário na metade direita (onde está o card na imagem)
      // Mobile: formulário no centro inferior
      justifyContent: isMobile ? "center" : "flex-end",
      padding: isMobile ? "0 24px 80px" : "0 5% 0 0",
      boxSizing: "border-box",
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          width: isMobile ? "100%" : "42%",
          maxWidth: isMobile ? "360px" : "440px",
          // Posiciona no espaço do card da imagem desktop
          marginTop: isMobile ? "0" : "10%",
          display: "flex",
          flexDirection: "column",
          gap: "14px",
        }}
      >
        {/* Email */}
        <div style={{
          background: "rgba(255,255,255,0.07)",
          border: "1.5px solid rgba(0,229,200,0.35)",
          borderRadius: "12px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "0 16px",
        }}>
          <span style={{ color: "#00e5c8" }}>✉</span>
          <input
            type="email"
            placeholder="E-mail"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            style={{
              flex: 1, background: "transparent", border: "none",
              outline: "none", color: "#fff", fontSize: "15px", padding: "14px 0",
            }}
          />
        </div>

        {/* Senha */}
        <div style={{
          background: "rgba(255,255,255,0.07)",
          border: "1.5px solid rgba(0,229,200,0.35)",
          borderRadius: "12px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "0 16px",
        }}>
          <span style={{ color: "#00e5c8" }}>🔒</span>
          <input
            type={showPass ? "text" : "password"}
            placeholder="Senha"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            style={{
              flex: 1, background: "transparent", border: "none",
              outline: "none", color: "#fff", fontSize: "15px", padding: "14px 0",
            }}
          />
          <button type="button" onClick={() => setShowPass(v => !v)}
            style={{ background: "none", border: "none", color: "#888", cursor: "pointer" }}>
            {showPass ? "🙈" : "👁"}
          </button>
        </div>

        {error && <p style={{ color: "#ff4444", fontSize: "13px", textAlign: "center", margin: 0 }}>{error}</p>}

        {/* Botão */}
        <button
          type="submit"
          disabled={loading}
          style={{
            background: "#00e5c8", color: "#000", border: "none",
            borderRadius: "40px", padding: "16px",
            fontSize: "17px", fontWeight: 700,
            cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? "Entrando..." : "Entrar →"}
        </button>
      </form>
    </div>
  );
}
