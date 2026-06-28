import { Layout } from "@/components/layout";
import { Crown, Zap, Star } from "lucide-react";
import { useState } from "react";

export function PlansPage() {
  const [annual, setAnnual] = useState(false);
  const discount = 0.10;

  const plans = [
    {
      name: "Grátis",
      monthly: 0,
      icon: <Star className="w-5 h-5" />,
      color: "#666",
      features: ["20 mensagens por dia", "Chat com voz", "Memória básica"],
      active: true,
      cta: "Plano atual",
      disabled: false,
    },
    {
      name: "Pro",
      monthly: 29,
      icon: <Zap className="w-5 h-5" />,
      color: "#00e5c8",
      features: ["Mensagens ilimitadas", "Memória persistente", "Compartilhamento de tela", "Suporte prioritário"],
      active: false,
      cta: "Em breve",
      disabled: true,
    },
    {
      name: "Premium",
      monthly: 49,
      icon: <Crown className="w-5 h-5" />,
      color: "#f59e0b",
      features: ["Tudo do Pro", "Agente de computador", "Câmera e leitura de documentos", "Acesso antecipado"],
      active: false,
      cta: "Em breve",
      disabled: true,
    },
  ];

  return (
    <Layout>
      <div className="flex flex-col h-full overflow-y-auto bg-background p-6">
        <div className="max-w-3xl mx-auto w-full">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-foreground">Planos</h1>
            <p className="text-muted-foreground mt-1">Escolha o plano ideal para você</p>

            {/* Toggle mensal/anual */}
            <div className="flex items-center justify-center gap-3 mt-4">
              <span className={`text-sm ${!annual ? "text-foreground font-semibold" : "text-muted-foreground"}`}>Mensal</span>
              <button
                onClick={() => setAnnual(a => !a)}
                className={`relative w-12 h-6 rounded-full transition-colors ${annual ? "bg-primary" : "bg-muted"}`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${annual ? "translate-x-7" : "translate-x-1"}`} />
              </button>
              <span className={`text-sm ${annual ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                Anual
                <span className="ml-1 text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">-10%</span>
              </span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            {plans.map(plan => {
              const price = plan.monthly === 0 ? 0 : annual ? Math.round(plan.monthly * (1 - discount)) : plan.monthly;
              return (
                <div
                  key={plan.name}
                  className={`bg-card border rounded-xl p-6 flex flex-col gap-4 ${plan.active ? "border-primary" : "border-border"}`}
                >
                  <div className="flex items-center gap-2" style={{ color: plan.color }}>
                    {plan.icon}
                    <span className="font-semibold">{plan.name}</span>
                    {plan.active && <span className="ml-auto text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Atual</span>}
                  </div>

                  <div>
                    {plan.monthly === 0 ? (
                      <span className="text-3xl font-bold text-foreground">Grátis</span>
                    ) : (
                      <div>
                        <span className="text-3xl font-bold text-foreground">R$ {price}</span>
                        <span className="text-muted-foreground text-sm">/mês</span>
                        {annual && <p className="text-xs text-emerald-500 mt-0.5">R$ {Math.round(price * 12)}/ano</p>}
                      </div>
                    )}
                  </div>

                  <ul className="space-y-2 flex-1">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="text-emerald-500">✓</span>{f}
                      </li>
                    ))}
                  </ul>

                  <button
                    disabled={plan.disabled}
                    className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${
                      plan.active ? "bg-muted text-muted-foreground cursor-default"
                        : plan.disabled ? "bg-muted text-muted-foreground cursor-not-allowed opacity-60"
                        : "bg-primary text-primary-foreground hover:bg-primary/90"
                    }`}
                  >
                    {plan.cta}
                  </button>
                </div>
              );
            })}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Planos Pro e Premium em desenvolvimento. Em breve disponíveis.
          </p>
        </div>
      </div>
    </Layout>
  );
}
