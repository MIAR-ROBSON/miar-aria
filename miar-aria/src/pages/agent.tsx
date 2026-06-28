import { useState, useEffect, useCallback, useRef } from "react";
import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Monitor, Pause, Square, Play, RefreshCw, Copy, Check,
  Download, Wifi, WifiOff, AlertTriangle, Terminal,
  Shield, ChevronDown, ChevronUp, Maximize2, Minimize2, X
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function api(path: string, opts?: RequestInit) {
  return fetch(`${BASE}/api${path}`, opts);
}

type AgentStatus = "disconnected" | "connected" | "paused";

interface LogEntry { time: number; msg: string; ok: boolean }

interface StatusData {
  status: AgentStatus;
  os: string;
  lastScreenshotTime: number;
  log: LogEntry[];
}

function timeAgo(ms: number) {
  if (!ms) return "";
  const diff = Math.floor((Date.now() - ms) / 1000);
  if (diff < 5) return "agora";
  if (diff < 60) return `${diff}s atrás`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m atrás`;
  return `${Math.floor(diff / 3600)}h atrás`;
}

export function AgentPage() {
  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotTime, setScreenshotTime] = useState(0);
  const [token, setToken] = useState("");
  const [tokenCopied, setTokenCopied] = useState(false);
  const [loadingCapture, setLoadingCapture] = useState(false);
  const [loadingAction, setLoadingAction] = useState("");
  const [showSetup, setShowSetup] = useState(false);
  const [serverUrl, setServerUrl] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const status: AgentStatus = statusData?.status ?? "disconnected";
  const isConnected = status === "connected" || status === "paused";

  // Get server URL from window — must be the preview/published domain, not the editor
  useEffect(() => {
    // In Replit dev, window.location.origin is the preview domain
    // If accessed via localhost, use the REPLIT_DEV_DOMAIN env variable hint
    const origin = window.location.origin;
    setServerUrl(origin);
  }, []);

  // Load token
  useEffect(() => {
    api("/agent/token").then(r => r.json()).then(d => setToken(d.token ?? "")).catch(() => {});
  }, []);

  // Poll status + live screenshot every 2s when connected
  const fetchStatus = useCallback(() => {
    api("/agent/status")
      .then(r => r.json())
      .then((d: StatusData) => {
        setStatusData(d);
        if (d.status === "connected" || d.status === "paused") {
          if (d.lastScreenshotTime && d.lastScreenshotTime > 0) {
            api("/agent/screenshot")
              .then(r => r.json())
              .then((s: { screenshot?: string; time?: number }) => {
                if (s.screenshot) {
                  setScreenshot(s.screenshot);
                  setScreenshotTime(s.time ?? Date.now());
                }
              })
              .catch(() => {});
          }
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchStatus]);

  const captureScreen = async () => {
    setLoadingCapture(true);
    try {
      const r = await api("/agent/screenshot/capture", { method: "POST" });
      const d = await r.json();
      if (d.screenshot) { setScreenshot(d.screenshot); setScreenshotTime(d.time); }
    } catch (_) {}
    setLoadingCapture(false);
  };

  const handlePause = async () => {
    setLoadingAction("pause");
    await api("/agent/pause", { method: "POST" }).catch(() => {});
    await fetchStatus();
    setLoadingAction("");
  };

  const handleResume = async () => {
    setLoadingAction("resume");
    await api("/agent/resume", { method: "POST" }).catch(() => {});
    await fetchStatus();
    setLoadingAction("");
  };

  const handleStop = async () => {
    if (!confirm("Desconectar o agente? O computador ficará sem controle da IA.")) return;
    setLoadingAction("stop");
    await api("/agent/stop", { method: "POST" }).catch(() => {});
    setScreenshot(null);
    await fetchStatus();
    setLoadingAction("");
  };

  const copyToken = () => {
    navigator.clipboard.writeText(token);
    setTokenCopied(true);
    setTimeout(() => setTokenCopied(false), 2000);
  };

  const statusColor = {
    disconnected: "bg-gray-400",
    connected: "bg-emerald-500",
    paused: "bg-amber-500",
  }[status];

  const statusLabel = {
    disconnected: "Desconectado",
    connected: "Conectado",
    paused: "Pausado",
  }[status];

  return (
    <Layout>
      <div className="flex flex-col h-full overflow-y-auto bg-background">
        {/* Header */}
        <div className="border-b border-border px-6 py-4 bg-card flex items-center justify-between sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Monitor className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="font-semibold text-foreground">Agente de Computador</h1>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
                <span className="text-xs text-muted-foreground">{statusLabel}</span>
                {statusData?.os && <span className="text-xs text-muted-foreground">· {statusData.os}</span>}
              </div>
            </div>
          </div>

          {/* Control buttons */}
          <div className="flex items-center gap-2">
            {status === "paused" ? (
              <Button
                size="sm"
                variant="outline"
                className="border-emerald-500 text-emerald-600 hover:bg-emerald-50"
                onClick={handleResume}
                disabled={!!loadingAction}
              >
                <Play className="w-4 h-4 mr-1.5" />
                Retomar
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="border-amber-500 text-amber-600 hover:bg-amber-50"
                onClick={handlePause}
                disabled={!isConnected || !!loadingAction}
              >
                <Pause className="w-4 h-4 mr-1.5" />
                Pausar
              </Button>
            )}

            <Button
              size="sm"
              variant="destructive"
              onClick={handleStop}
              disabled={!isConnected || !!loadingAction}
              className="font-semibold"
            >
              <Square className="w-4 h-4 mr-1.5 fill-current" />
              PARAR
            </Button>
          </div>
        </div>

        <div className="flex-1 p-6 space-y-5 max-w-4xl mx-auto w-full">

          {/* Security notice */}
          <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
            <Shield className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-800 dark:text-amber-200">Segurança em primeiro lugar</p>
              <p className="text-amber-700 dark:text-amber-300 mt-0.5">
                Mova o mouse ao <strong>canto superior esquerdo</strong> da tela para parar qualquer ação imediatamente (failsafe). 
                Use os botões <strong>Pausar</strong> e <strong>Parar</strong> acima para controle direto.
              </p>
            </div>
          </div>

          {/* Screen preview */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <Monitor className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Tela do Computador</span>
                {isConnected && screenshotTime > 0 && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                    AO VIVO
                  </span>
                )}
                {screenshotTime > 0 && (
                  <span className="text-xs text-muted-foreground">· {timeAgo(screenshotTime)}</span>
                )}
              </div>
              {!isConnected && (
                <Button
                  size="sm" variant="outline"
                  onClick={captureScreen}
                  disabled={loadingCapture}
                  className="h-8 text-xs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loadingCapture ? "animate-spin" : ""}`} />
                  Capturar Tela
                </Button>
              )}
            </div>

            {screenshot ? (
              <img
                src={`data:image/jpeg;base64,${screenshot}`}
                alt="Tela do agente"
                className="w-full object-contain bg-black max-h-[500px]"
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
                {isConnected ? (
                  <>
                    <Monitor className="w-10 h-10 opacity-30" />
                    <p className="text-sm">Clique em "Capturar Tela" para ver a tela atual</p>
                  </>
                ) : (
                  <>
                    <WifiOff className="w-10 h-10 opacity-30" />
                    <p className="text-sm">Agente desconectado</p>
                    <p className="text-xs opacity-60">Instale e inicie o agente no seu computador</p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Setup section — one click */}
          {!isConnected && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-primary" />
                <p className="text-sm font-semibold">Conectar o Agente</p>
              </div>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Baixe e extraia o pacote</li>
                <li>Clique duas vezes em <strong>Instalar Miar Aria.bat</strong></li>
                <li>Um atalho aparece na Área de Trabalho — clique para conectar</li>
              </ol>
              <a
                href={`${BASE}/api/agent/download-zip`}
                className="flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg px-4 py-3 text-sm font-semibold hover:bg-primary/90 transition-colors w-full"
              >
                <Download className="w-4 h-4" />
                Baixar miar-agente.zip
              </a>
              <p className="text-[11px] text-muted-foreground text-center">
                Instala como app — cria atalho no Desktop. Requer Python 3.8+ e Windows.
              </p>
            </div>
          )}

          {/* Action log */}
          {statusData?.log && statusData.log.length > 0 && (
            <div className="bg-card border border-border rounded-xl">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <Terminal className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium">Log de Ações</span>
                <Badge variant="secondary" className="text-xs">{statusData.log.length}</Badge>
              </div>
              <div className="p-3 space-y-1 max-h-56 overflow-y-auto font-mono">
                {statusData.log.map((entry, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs py-0.5">
                    <span className={`shrink-0 mt-0.5 ${entry.ok ? "text-emerald-500" : "text-destructive"}`}>
                      {entry.ok ? "✓" : "✗"}
                    </span>
                    <span className="text-muted-foreground shrink-0">{timeAgo(entry.time)}</span>
                    <span className={`flex-1 ${entry.ok ? "text-foreground" : "text-destructive"}`}>{entry.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick actions (only when connected) */}
          {isConnected && (
            <div className="bg-card border border-border rounded-xl">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-sm font-medium">Ações Rápidas</p>
                <p className="text-xs text-muted-foreground mt-0.5">Comandos manuais para testar a conexão</p>
              </div>
              <div className="grid grid-cols-3 gap-2 p-3">
                {[
                  { label: "Screenshot", cmd: "screenshot", params: {} },
                  { label: "Tela cheia (F11)", cmd: "key", params: { key: "f11" } },
                  { label: "Copiar (Ctrl+C)", cmd: "hotkey", params: { keys: ["ctrl", "c"] } },
                  { label: "Colar (Ctrl+V)", cmd: "hotkey", params: { keys: ["ctrl", "v"] } },
                  { label: "Desfazer (Ctrl+Z)", cmd: "hotkey", params: { keys: ["ctrl", "z"] } },
                  { label: "Fechar janela (Alt+F4)", cmd: "hotkey", params: { keys: ["alt", "f4"] } },
                ].map((action) => (
                  <button
                    key={action.label}
                    className="text-xs border border-border rounded-lg px-2 py-2 hover:bg-muted transition-colors text-left"
                    onClick={async () => {
                      await api("/agent/command", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ cmd: action.cmd, params: action.params }),
                      });
                      if (action.cmd === "screenshot") captureScreen();
                      else fetchStatus();
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          )}

        </div>
      </div>
    </Layout>
  );
}
