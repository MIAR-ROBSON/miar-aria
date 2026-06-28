import { useState, useRef, useEffect, useCallback } from "react";
import { MessageCircle, X, Send, Loader2, Bot, Copy, Check, Play, Pause, Square, Volume2, GripHorizontal } from "lucide-react";
import avatarImage from "@/assets/avatar.png";
import { useTTS } from "@/hooks/use-tts";

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function api(path: string, opts?: RequestInit) {
  return fetch(`${BASE}/api${path}`, opts);
}

function formatTime(ts: string) {
  try {
    return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface Conversation {
  id: number;
  title: string;
}

function displayContent(content: string) {
  return content
    .replace(/__IMG__data:[^\s]*/g, "[imagem]")
    .replace(/```agent_cmd[\s\S]*?```/g, "")
    .trim();
}

export function MiniChat() {
  const [open, setOpen] = useState(false);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Draggable position (right/bottom offsets from viewport edge)
  const [pos, setPos] = useState({ right: 24, bottom: 96 });
  const dragging = useRef(false);
  const dragStart = useRef({ mouseX: 0, mouseY: 0, right: 24, bottom: 96 });
  const panelRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const tts = useTTS(1);
  const speakRef = useRef(tts.speak);
  useEffect(() => { speakRef.current = tts.speak; }, [tts.speak]);

  // Drag handlers on the header bar
  const onDragMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    dragStart.current = { mouseX: e.clientX, mouseY: e.clientY, right: pos.right, bottom: pos.bottom };
    e.preventDefault();
  }, [pos]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = dragStart.current.mouseX - e.clientX;
      const dy = dragStart.current.mouseY - e.clientY;
      const newRight = Math.max(0, Math.min(window.innerWidth - 320, dragStart.current.right + dx));
      const newBottom = Math.max(0, Math.min(window.innerHeight - 60, dragStart.current.bottom + dy));
      setPos({ right: newRight, bottom: newBottom });
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const loadMessages = useCallback(async (convId: number) => {
    try {
      const r = await api(`/conversations/${convId}/messages`);
      if (r.ok) {
        const data = await r.json() as Message[];
        setMessages(data.slice(-20));
      }
    } catch { /* ignore */ }
  }, []);

  const initConversation = useCallback(async () => {
    try {
      const r = await api("/conversations");
      if (!r.ok) return;
      const list = await r.json() as Conversation[];
      if (list.length > 0) {
        const latest = list[0];
        setConv(latest);
        await loadMessages(latest.id);
      } else {
        const cr = await api("/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Chat rápido" }),
        });
        if (cr.ok) {
          const nc = await cr.json() as Conversation;
          setConv(nc);
          setMessages([]);
        }
      }
    } catch { /* ignore */ }
  }, [loadMessages]);

  useEffect(() => {
    if (open && !conv) initConversation();
  }, [open, conv, initConversation]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  const copyText = (text: string, id: number) => {
    navigator.clipboard.writeText(displayContent(text));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !conv || loading) return;

    setInput("");
    setLoading(true);
    setStreaming("");
    setAgentRunning(false);

    const tempMsg: Message = { id: Date.now(), role: "user", content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, tempMsg]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const resp = await fetch(`${BASE}/api/conversations/${conv.id}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
        signal: controller.signal,
      });

      if (!resp.ok) throw new Error(`Erro ${resp.status}`);

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6).trim()) as {
              chunk?: string; done?: boolean; error?: string;
              agentEvent?: string; screenshot?: string;
            };
            if (ev.chunk) { accumulated += ev.chunk; setStreaming(accumulated); }
            if (ev.done) {
              setStreaming("");
              setAgentRunning(true);
              await loadMessages(conv.id);
              setAgentRunning(false);
              // Auto-speak the response
              const clean = displayContent(accumulated);
              if (clean) speakRef.current(clean);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === "AbortError")) {
        setMessages(prev => [...prev, {
          id: Date.now(),
          role: "assistant",
          content: "Erro ao enviar mensagem. Tente novamente.",
          timestamp: new Date().toISOString(),
        }]);
      }
    } finally {
      setLoading(false);
      setStreaming("");
      setAgentRunning(false);
      abortRef.current = null;
    }
  }, [input, conv, loading, loadMessages]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // Toggle button floats near the panel
  const btnBottom = pos.bottom - 68;
  const btnRight = pos.right;

  return (
    <>
      {/* Toggle button — floats alongside the panel */}
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        style={{ bottom: btnBottom < 8 ? 8 : btnBottom, right: btnRight }}
        className={`
          fixed z-50 w-14 h-14 rounded-full shadow-lg flex items-center justify-center
          transition-all duration-200
          ${open
            ? "bg-muted text-muted-foreground hover:bg-muted/80"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
          }
        `}
        title={open ? "Fechar chat" : "Abrir chat"}
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>

      {/* Floating Panel */}
      <div
        ref={panelRef}
        style={{ bottom: pos.bottom, right: pos.right }}
        className={`
          fixed z-50 w-80 bg-card border border-border rounded-2xl shadow-2xl
          flex flex-col overflow-hidden
          transition-opacity duration-300
          ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}
        `}
        style={{ bottom: pos.bottom, right: pos.right, height: 460 } as React.CSSProperties}
      >
        {/* Header — drag handle */}
        <div
          onMouseDown={onDragMouseDown}
          className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border bg-card shrink-0 cursor-grab active:cursor-grabbing select-none"
        >
          <GripHorizontal className="w-4 h-4 text-muted-foreground/50 shrink-0" />
          <img src={avatarImage} alt="Miar" className="w-7 h-7 rounded-full object-cover" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground leading-tight">Miar Ária</p>
            {conv && (
              <p className="text-[10px] text-muted-foreground truncate">{conv.title}</p>
            )}
          </div>
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2">
              <Bot className="w-8 h-8 opacity-30" />
              <p className="text-xs">Fale com a Miar Ária</p>
            </div>
          )}

          {messages.map(msg => {
            const isScreenshot = msg.content.startsWith("__SCREENSHOT__");
            if (isScreenshot) {
              const b64 = msg.content.slice(14);
              return (
                <div key={msg.id} className="flex justify-start">
                  <img
                    src={`data:image/jpeg;base64,${b64}`}
                    alt="Screenshot"
                    className="rounded-lg max-w-full border border-border"
                  />
                </div>
              );
            }
            const text = displayContent(msg.content);
            if (!text) return null;
            return (
              <div key={msg.id} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`
                    max-w-[85%] px-3 py-1.5 rounded-2xl text-xs leading-relaxed
                    ${msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-sm"
                      : "bg-muted text-foreground rounded-bl-sm"
                    }
                  `}
                >
                  {text}
                </div>

                {/* Timestamp + actions */}
                <div className={`flex items-center gap-1 mt-0.5 px-1 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                  <span className="font-mono text-[10px] text-muted-foreground">{formatTime(msg.timestamp)}</span>

                  {msg.role === "assistant" && (
                    <>
                      <button
                        title="Copiar"
                        onClick={() => copyText(msg.content, msg.id)}
                        className="p-0.5 hover:text-primary transition-colors rounded"
                      >
                        {copiedId === msg.id
                          ? <Check className="w-3 h-3 text-emerald-500" />
                          : <Copy className="w-3 h-3" />
                        }
                      </button>

                      <button
                        title="Ouvir"
                        onClick={() => tts.speak(text)}
                        className="p-0.5 hover:text-primary transition-colors rounded"
                      >
                        <Play className="w-3 h-3" />
                      </button>

                      {tts.isPlaying && (
                        <>
                          <button title="Pausar" onClick={tts.pause} className="p-0.5 hover:text-amber-500 transition-colors rounded">
                            <Pause className="w-3 h-3" />
                          </button>
                          <button title="Parar" onClick={tts.stop} className="p-0.5 hover:text-destructive transition-colors rounded">
                            <Square className="w-3 h-3" />
                          </button>
                        </>
                      )}

                      {tts.isPaused && (
                        <button title="Retomar" onClick={tts.resume} className="p-0.5 hover:text-primary transition-colors rounded">
                          <Volume2 className="w-3 h-3" />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {streaming && (
            <div className="flex flex-col items-start">
              <div className="max-w-[85%] px-3 py-1.5 rounded-2xl rounded-bl-sm bg-muted text-foreground text-xs leading-relaxed">
                {displayContent(streaming) || <span className="opacity-50">...</span>}
              </div>
            </div>
          )}

          {agentRunning && !streaming && (
            <div className="flex justify-start">
              <div className="px-3 py-1.5 rounded-2xl rounded-bl-sm bg-muted text-muted-foreground text-xs flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                Executando...
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border px-3 py-2 shrink-0 bg-card">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Mensagem para Miar..."
              rows={1}
              className="flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-[34px] max-h-20 overflow-y-auto"
              style={{ lineHeight: "1.4" }}
            />
            <button
              onClick={send}
              disabled={!input.trim() || loading}
              className="w-8 h-8 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-40 shrink-0"
            >
              {loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <Send className="w-3.5 h-3.5" />
              }
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1 text-center">Enter para enviar · Shift+Enter para nova linha</p>
        </div>
      </div>
    </>
  );
}
