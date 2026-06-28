import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import { Layout } from "@/components/layout";
import { useListMessages, getListMessagesQueryKey, useGetSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Mic, Paperclip, Send, Square, Play, Pause, Volume2, X, AlertCircle,
  Monitor, CheckCircle2, XCircle, Loader2, ThumbsUp, ThumbsDown, Heart,
  Camera, Crown,
} from "lucide-react";
import { useSTT } from "@/hooks/use-stt";
import { useTTS } from "@/hooks/use-tts";
import { useMode } from "@/context/mode-context";
import avatarImage from "@/assets/avatar.png";

interface AgentEvent {
  type: "screenshot" | "result" | "error" | "running";
  cmd: string;
  ok?: boolean;
  screenshot?: string;
  time?: number;
  error?: string;
}

type FeedbackValue = "positive" | "negative" | "love" | null;

const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function processFile(file: File): Promise<{ name: string; content: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    if (file.type.startsWith("image/")) {
      reader.onload = () => {
        const dataUrl = reader.result as string;
        resolve({ name: file.name, content: `__IMG__${dataUrl}` });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    } else {
      reader.onload = () => resolve({ name: file.name, content: reader.result as string });
      reader.onerror = reject;
      reader.readAsText(file, "utf-8");
    }
  });
}

function extractImgSrc(content: string): string {
  const idx = content.indexOf("__IMG__");
  if (idx === -1) return "";
  return content.substring(idx + 7);
}

function displayContent(content: string): string {
  return content.replace(/__IMG__data:[^\s]*/g, "").trim();
}

async function saveFeedbackApi(messageId: number, feedback: FeedbackValue, conversationId?: number) {
  const resp = await fetch(`${BASE}/api/messages/${messageId}/feedback`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedback, conversationId }),
  });
  return resp.json() as Promise<{ ok: boolean; negativeCount?: number; showComplaint?: boolean }>;
}

export function ChatPage() {
  const params = useParams();
  const [, setLocation] = useLocation();
  const conversationId = params.id ? parseInt(params.id, 10) : undefined;
  const queryClient = useQueryClient();
  const { mode } = useMode();

  const [input, setInput] = useState("");
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [feedbacks, setFeedbacks] = useState<Record<number, FeedbackValue>>({});
  const [showComplaintModal, setShowComplaintModal] = useState(false);
  const [feedbackNotification, setFeedbackNotification] = useState<string | null>(null);
  const [complaintText, setComplaintText] = useState("");
  const [complaintSent, setComplaintSent] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [msgCountToday, setMsgCountToday] = useState(0);
  const [plan, setPlan] = useState("free");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastPlayedIdRef = useRef<number | null>(null);
  const initDoneRef = useRef<Set<number>>(new Set());
  const silentModeRef = useRef(false);
  const modeRef = useRef("chat");
  const pendingSelRef = useRef("");

  const { data: settings } = useGetSettings({ query: { queryKey: getGetSettingsQueryKey() } });
  const audioSpeed = settings?.audioSpeed ?? 1;
  const silentMode = (settings as any)?.silentMode ?? false;

  const { data: messages } = useListMessages(conversationId as number, {
    query: {
      enabled: !!conversationId,
      queryKey: getListMessagesQueryKey(conversationId as number),
    },
  });

  const tts = useTTS(audioSpeed);
  const speakRef = useRef(tts.speak);
  useEffect(() => { speakRef.current = tts.speak; }, [tts.speak]);

  // Fetch plan status
  useEffect(() => {
    fetch(`${BASE}/api/plan`).then(r => r.json()).then((d: any) => {
      setPlan(d.plan ?? "free");
      setMsgCountToday(d.msgCountToday ?? 0);
      setLimitReached(d.limitReached ?? false);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  // Auto-speak on new assistant messages (unless silentMode)
  useEffect(() => {
    if (!messages?.length || !conversationId) return;
    const last = messages[messages.length - 1];
    if (!initDoneRef.current.has(conversationId)) {
      initDoneRef.current.add(conversationId);
      lastPlayedIdRef.current = last.id;
      return;
    }
    if (last.role === "assistant" && last.id !== lastPlayedIdRef.current) {
      lastPlayedIdRef.current = last.id;
      if (!silentMode || mode === "voice") {
        speakRef.current(last.content);
      }
    }
  }, [messages, conversationId, silentMode, mode]);

  // Voice mode: auto-start mic after speech ends
  useEffect(() => {
    if (mode !== "voice") return;
    if (!tts.isPlaying && !tts.isPaused && !isGenerating) {
      // Small delay to avoid immediate restart
      const t = setTimeout(() => {
        if (!isGenerating) stt.start();
      }, 800);
      return () => clearTimeout(t);
    }
  }, [tts.isPlaying, tts.isPaused, isGenerating, mode]);

  useEffect(() => {
    const handler = () => tts.speakSelection();
    document.addEventListener("dblclick", handler);
    return () => document.removeEventListener("dblclick", handler);
  }, [tts.speakSelection]);

  const stopGeneration = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsGenerating(false);
    setStreamingText("");
  }, []);

  const handleSend = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed && !attachedFile) return;
      if (!conversationId) return;

      if (limitReached) {
        setSendError("Limite diário de 20 mensagens atingido. Assine um plano para continuar.");
        return;
      }

      let content = trimmed;
      if (attachedFile) {
        content = trimmed
          ? `${trimmed}\n\n[Arquivo: ${attachedFile.name}]\n${attachedFile.content}`
          : `[Arquivo: ${attachedFile.name}]\n${attachedFile.content}`;
      }

      setInput("");
      setAttachedFile(null);
      setSendError(null);
      setIsGenerating(true);
      setStreamingText("");
      setAgentEvents([]);
      setAgentRunning(false);

      // Optimistic count update
      if (plan === "free") {
        const newCount = msgCountToday + 1;
        setMsgCountToday(newCount);
        if (newCount >= 20) setLimitReached(true);
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch(`${BASE}/api/conversations/${conversationId}/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content }),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({})) as Record<string, string>;
          if (resp.status === 403) {
            setLimitReached(true);
            throw new Error(errData.error || "Limite diário atingido.");
          }
          throw new Error(errData.error || `Erro ${resp.status}`);
        }

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
            const payload = line.slice(6).trim();
            try {
              const ev = JSON.parse(payload) as {
                chunk?: string; done?: boolean; error?: string;
                agentEvent?: string; cmd?: string; ok?: boolean;
                screenshot?: string; time?: number;
              };
              if (ev.chunk) { accumulated += ev.chunk; setStreamingText(accumulated); }
              if (ev.done) {
                setStreamingText("");
                setAgentRunning(true);
                queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(conversationId) });
              }
              if (ev.agentEvent === "screenshot" && ev.screenshot) {
                setAgentRunning(false);
                setAgentEvents(prev => [...prev, { type: "screenshot", cmd: ev.cmd ?? "screenshot", ok: true, screenshot: ev.screenshot, time: ev.time }]);
              } else if (ev.agentEvent === "result") {
                setAgentRunning(false);
                setAgentEvents(prev => [...prev, { type: "result", cmd: ev.cmd ?? "", ok: ev.ok }]);
              } else if (ev.agentEvent === "error") {
                setAgentRunning(false);
                setAgentEvents(prev => [...prev, { type: "error", cmd: ev.cmd ?? "", ok: false, error: (ev as any).error }]);
              }
              if (ev.error) throw new Error(ev.error);
            } catch { /* skip malformed */ }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === "AbortError") {
          // User stopped
        } else {
          setSendError(err instanceof Error ? err.message : "Falha ao enviar mensagem");
        }
      } finally {
        setIsGenerating(false);
        setStreamingText("");
        setAgentRunning(false);
        abortRef.current = null;
      }
    },
    [conversationId, attachedFile, queryClient, limitReached, plan, msgCountToday],
  );

  const stt = useSTT((text) => handleSend(text));

  const handleManualSend = useCallback(() => {
    if (stt.isRecording) {
      const captured = stt.stop();
      const combined = (input + " " + captured).trim();
      if (combined) handleSend(combined);
    } else {
      handleSend(input);
    }
  }, [stt, input, handleSend]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const processed = await processFile(file);
      setAttachedFile(processed);
    } catch {
      setSendError("Não foi possível ler o arquivo.");
    }
    e.target.value = "";
  };

  const handleFeedback = useCallback(async (msgId: number, value: FeedbackValue) => {
    const current = feedbacks[msgId];
    const newValue = current === value ? null : value;
    setFeedbacks(prev => ({ ...prev, [msgId]: newValue }));
    const result = await saveFeedbackApi(msgId, newValue, conversationId);
    if (result.notifyMessage) {
      setFeedbackNotification(result.notifyMessage);
      setTimeout(() => setFeedbackNotification(null), 4000);
    }
    if (result.showComplaint) setShowComplaintModal(true);
  }, [feedbacks, conversationId]);

  const submitComplaint = async () => {
    if (!complaintText.trim()) return;
    await fetch(`${BASE}/api/feedback/complaint`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: conversationId ?? 0, complaint: complaintText }),
    });
    setComplaintSent(true);
    setTimeout(() => { setShowComplaintModal(false); setComplaintSent(false); setComplaintText(""); }, 3000);
  };

  const displayText = stt.isRecording ? input + stt.transcript : input;
  const canSend = (displayText.trim() || !!attachedFile) && !isGenerating;

  // Voice mode: big centered mic UI
  if (mode === "voice" && !conversationId) {
    return (
      <Layout>
        <div className="h-full flex flex-col items-center justify-center gap-6 bg-background">
          <img src={avatarImage} alt="Miar" className="w-24 h-24 rounded-full border-4 border-primary/30" />
          <p className="text-muted-foreground text-sm">Modo Voz — selecione uma conversa</p>
        </div>
      </Layout>
    );
  }

  if (!conversationId) {
    return (
      <Layout>
        <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-background">
          <div className="w-28 h-28 rounded-full overflow-hidden border-4 border-primary/20 mb-6 shadow-xl shadow-primary/10">
            <img src={avatarImage} alt="Miar Ária" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-3xl font-serif font-medium text-foreground mb-3">Olá, sou a Miar Ária</h2>
          <p className="text-muted-foreground max-w-md text-base">
            Sua assistente pessoal de IA. Estou aqui para ajudá-lo a se organizar, focar e avançar com clareza.
          </p>
          <p className="text-muted-foreground/60 text-sm mt-3">Crie uma nova conversa para começar.</p>
          {plan === "free" && (
            <p className="text-xs text-muted-foreground/50 mt-2">{msgCountToday}/20 mensagens hoje</p>
          )}
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="flex flex-col h-full bg-background">
        <div className="flex-1 overflow-y-auto p-4 space-y-5 pb-52">
          {messages?.map((msg) => {
            const imgSrc = msg.role === "user" ? extractImgSrc(msg.content) : "";
            const textPart = msg.role === "user" ? displayContent(msg.content) : msg.content;
            const msgFeedback = feedbacks[msg.id] ?? (msg as any).feedback ?? null;

            return (
              <div
                key={msg.id}
                className={`flex gap-3 max-w-3xl mx-auto ${msg.role === "user" ? "flex-row-reverse" : ""}`}
              >
                {msg.role === "assistant" && (
                  <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 mt-1 border border-primary/20">
                    <img src={avatarImage} alt="Miar" className="w-full h-full object-cover" />
                  </div>
                )}
                <div className={`flex flex-col gap-1 max-w-[82%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  <div
                    className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap select-text ${
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : "bg-card border border-border shadow-sm text-card-foreground rounded-tl-sm"
                    }`}
                  >
                    {imgSrc && (
                      <div className="mb-2 flex items-center gap-2 text-xs opacity-80">
                        <Paperclip className="w-3 h-3" />
                        <span>{msg.content.replace(/^.*?\[Arquivo: ([^\]]+)\].*$/s, "$1") || "imagem"}</span>
                      </div>
                    )}
                    {textPart || (!imgSrc ? msg.content : "")}
                  </div>

                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground px-1">
                    <span className="font-mono">{formatTime(msg.timestamp)}</span>

                    {msg.role === "assistant" && (
                      <>
                        <button
                          title="Ouvir (selecione texto para ouvir só ele)"
                          onClick={() => {
                            const sel = window.getSelection()?.toString().trim();
                            tts.speak(sel || msg.content);
                          }}
                          className="p-1 hover:text-primary transition-colors rounded hover:bg-primary/10"
                        >
                          <Play className="w-3 h-3" />
                        </button>
                        {tts.isPlaying && (
                          <>
                            <button title="Pausar" onClick={tts.pause} className="p-1 hover:text-amber-500 transition-colors rounded">
                              <Pause className="w-3 h-3" />
                            </button>
                            <button title="Parar" onClick={tts.stop} className="p-1 hover:text-destructive transition-colors rounded">
                              <Square className="w-3 h-3" />
                            </button>
                          </>
                        )}
                        {tts.isPaused && (
                          <button title="Retomar" onClick={tts.resume} className="p-1 hover:text-primary transition-colors rounded">
                            <Volume2 className="w-3 h-3" />
                          </button>
                        )}

                        {/* Feedback buttons */}
                        <span className="mx-0.5 text-border">|</span>
                        <button
                          title="Boa resposta"
                          onClick={() => handleFeedback(msg.id, "positive")}
                          className={`p-1 rounded transition-colors ${msgFeedback === "positive" ? "text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30" : "hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"}`}
                        >
                          <ThumbsUp className="w-3 h-3" />
                        </button>
                        <button
                          title="Resposta ruim"
                          onClick={() => handleFeedback(msg.id, "negative")}
                          className={`p-1 rounded transition-colors ${msgFeedback === "negative" ? "text-destructive bg-destructive/10" : "hover:text-destructive hover:bg-destructive/10"}`}
                        >
                          <ThumbsDown className="w-3 h-3" />
                        </button>
                        <button
                          title="Adorei!"
                          onClick={() => handleFeedback(msg.id, "love")}
                          className={`p-1 rounded transition-colors ${msgFeedback === "love" ? "text-green-500 bg-green-50 dark:bg-green-950/30" : "hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-950/30"}`}
                        >
                          <Heart className={`w-3 h-3 ${msgFeedback === "love" ? "fill-current" : ""}`} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {/* Streaming bubble */}
          {isGenerating && (
            <div className="flex gap-3 max-w-3xl mx-auto">
              <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 mt-1 border border-primary/20">
                <img src={avatarImage} alt="Miar" className="w-full h-full object-cover" />
              </div>
              <div className="bg-card border border-border shadow-sm rounded-2xl rounded-tl-sm px-4 py-3 max-w-[82%] space-y-3">
                {streamingText ? (
                  <p className="text-sm leading-relaxed whitespace-pre-wrap select-text text-card-foreground">
                    {streamingText}
                    <span className="inline-block w-0.5 h-4 bg-primary/60 ml-0.5 animate-pulse align-text-bottom" />
                  </p>
                ) : agentRunning ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span>Executando no computador...</span>
                  </div>
                ) : (
                  <div className="flex gap-1 items-center h-5">
                    <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                )}
                {agentEvents.length > 0 && (
                  <div className="space-y-2 border-t border-border pt-2">
                    {agentEvents.map((ev, i) => (
                      <div key={i}>
                        {ev.type === "screenshot" && ev.screenshot ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Monitor className="w-3.5 h-3.5 text-primary" />
                              <span className="text-primary font-medium">Tela capturada</span>
                            </div>
                            <img src={`data:image/jpeg;base64,${ev.screenshot}`} alt="Tela"
                              className="w-full rounded-lg object-contain bg-black border border-border max-h-72" />
                          </div>
                        ) : ev.type === "result" ? (
                          <div className="flex items-center gap-1.5 text-xs">
                            {ev.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />}
                            <span className={`font-mono ${ev.ok ? "text-emerald-600" : "text-destructive"}`}>{ev.cmd} — {ev.ok ? "✓ ok" : "✗ falhou"}</span>
                          </div>
                        ) : ev.type === "error" ? (
                          <div className="flex items-start gap-1.5 text-xs text-destructive">
                            <XCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span className="font-mono">{ev.cmd}: {ev.error}</span>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-background via-background/95 to-transparent pt-8">
          {/* Free plan limit warning */}
          {plan === "free" && msgCountToday >= 15 && !limitReached && (
            <div className="max-w-3xl mx-auto mb-2 flex items-center gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              <Crown className="w-3.5 h-3.5 shrink-0" />
              <span>{20 - msgCountToday} mensagens restantes hoje.</span>
              <button onClick={() => setLocation("/plans")} className="underline font-medium ml-auto shrink-0">Ver planos</button>
            </div>
          )}

          {limitReached && (
            <div className="max-w-3xl mx-auto mb-2 flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 text-sm text-destructive">
              <Crown className="w-4 h-4 shrink-0" />
              <span className="flex-1">Limite de 20 mensagens/dia atingido.</span>
              <button onClick={() => setLocation("/plans")} className="underline font-medium shrink-0">Assinar →</button>
            </div>
          )}

          {sendError && (
            <div className="max-w-3xl mx-auto mb-2 flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 text-sm text-destructive">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span className="flex-1">{sendError}</span>
              <button onClick={() => setSendError(null)} className="shrink-0 hover:opacity-70"><X className="w-4 h-4" /></button>
            </div>
          )}

          {attachedFile && (
            <div className="max-w-3xl mx-auto mb-2 flex items-center gap-2 bg-primary/10 border border-primary/20 rounded-lg px-3 py-2 text-sm text-primary">
              <Paperclip className="w-4 h-4 shrink-0" />
              <span className="truncate flex-1">{attachedFile.name}</span>
              <button onClick={() => setAttachedFile(null)} className="shrink-0 hover:text-destructive"><X className="w-4 h-4" /></button>
            </div>
          )}

          {/* Voice mode: big mic button */}
          {mode === "voice" ? (
            <div className="max-w-3xl mx-auto flex flex-col items-center gap-3">
              <button
                onClick={() => {
                  if (stt.isRecording) {
                    const captured = stt.stop();
                    if (captured.trim()) handleSend(captured);
                  } else {
                    tts.stop();
                    stt.start();
                  }
                }}
                disabled={isGenerating}
                className={`w-20 h-20 rounded-full flex items-center justify-center transition-all shadow-lg ${
                  stt.isRecording
                    ? "bg-destructive text-white animate-pulse scale-110"
                    : isGenerating
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:scale-105"
                }`}
              >
                <Mic className="w-8 h-8" />
              </button>
              <p className="text-xs text-muted-foreground">
                {stt.isRecording ? `Gravando... (para em ${stt.countdown}s de silêncio)` : isGenerating ? "Gerando resposta..." : "Toque para falar"}
              </p>
              {isGenerating && (
                <Button variant="destructive" size="sm" onClick={stopGeneration}>
                  <Square className="w-4 h-4 mr-1.5 fill-current" /> Parar
                </Button>
              )}
            </div>
          ) : (
            <div className="max-w-3xl mx-auto flex items-end gap-2 bg-card border border-border rounded-xl p-2 shadow-lg">
              <input ref={fileInputRef} type="file" className="hidden" accept="*/*" onChange={handleFileChange} />
              <input ref={cameraInputRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={handleFileChange} />

              <Button variant="ghost" size="icon" onClick={() => fileInputRef.current?.click()}
                className="shrink-0 text-muted-foreground hover:text-primary rounded-lg h-10 w-10" title="Anexar arquivo">
                <Paperclip className="w-5 h-5" />
              </Button>

              {/* Camera button in reading mode */}
              {mode === "reading" && (
                <Button variant="ghost" size="icon" onClick={() => cameraInputRef.current?.click()}
                  className="shrink-0 text-muted-foreground hover:text-primary rounded-lg h-10 w-10" title="Câmera">
                  <Camera className="w-5 h-5" />
                </Button>
              )}

              <Textarea
                value={displayText}
                onChange={(e) => { if (!stt.isRecording) setInput(e.target.value); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleManualSend(); } }}
                placeholder={
                  mode === "reading"
                    ? "Anexe um arquivo, foto ou escreva sua dúvida..."
                    : "Mensagem para Miar Ária... (duplo-clique em texto para ouvir)"
                }
                className="min-h-[40px] resize-none border-0 focus-visible:ring-0 shadow-none px-2 py-3 bg-transparent text-sm"
                style={{ maxHeight: "none", overflow: "auto" }}
                rows={1}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = el.scrollHeight + "px";
                }}
              />

              <div className="flex items-center gap-1 shrink-0">
                {stt.isRecording && stt.countdown !== null && stt.countdown > 0 && (
                  <span className="text-xs text-destructive font-bold animate-pulse min-w-[28px] text-center">{stt.countdown}s</span>
                )}

                {stt.supported && (
                  <Button variant="ghost" size="icon"
                    onClick={() => {
                      if (stt.isRecording) {
                        const captured = stt.stop();
                        const combined = (input + " " + captured).trim();
                        if (combined) handleSend(combined);
                      } else { stt.start(); }
                    }}
                    className={`rounded-lg h-10 w-10 ${stt.isRecording ? "text-destructive bg-destructive/10 hover:bg-destructive/20" : "text-muted-foreground hover:text-primary"}`}
                    title={stt.isRecording ? `Parar e enviar (auto em ${stt.countdown}s)` : "Falar em pt-BR"}
                  >
                    <Mic className={`w-5 h-5 ${stt.isRecording ? "animate-pulse" : ""}`} />
                  </Button>
                )}

                {isGenerating ? (
                  <Button variant="destructive" size="icon" onClick={stopGeneration} className="rounded-lg h-10 w-10">
                    <Square className="w-4 h-4 fill-current" />
                  </Button>
                ) : (
                  <Button variant="default" size="icon" onClick={handleManualSend}
                    disabled={!canSend || limitReached} className="rounded-lg h-10 w-10 shadow-sm">
                    <Send className="w-4 h-4" />
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {feedbackNotification && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-amber-500/90 text-white text-sm px-4 py-2 rounded-lg shadow-lg max-w-sm text-center">
          {feedbackNotification}
        </div>
      )}

      {/* Modal de Reclamação */}}
      {showComplaintModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-2xl">
            {complaintSent ? (
              <div className="text-center py-4">
                <div className="text-4xl mb-3">✅</div>
                <p className="text-foreground font-semibold">Reclamação enviada!</p>
                <p className="text-muted-foreground text-sm mt-1">Nossa equipe irá avaliar. Você receberá uma renovação gratuita em até 24h.</p>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-semibold text-foreground mb-1">Nos ajude a melhorar</h3>
                <p className="text-muted-foreground text-sm mb-4">Parece que você não está satisfeito. Conte o que aconteceu — vamos avaliar e, se necessário, renovar seu plano gratuitamente.</p>
                <textarea
                  className="w-full bg-background border border-border rounded-lg p-3 text-foreground text-sm resize-none min-h-[100px] outline-none focus:border-primary"
                  placeholder="Descreva sua insatisfação..."
                  value={complaintText}
                  onChange={e => setComplaintText(e.target.value)}
                />
                <div className="flex gap-3 mt-4">
                  <button
                    onClick={() => setShowComplaintModal(false)}
                    className="flex-1 py-2 rounded-lg border border-border text-muted-foreground text-sm hover:bg-muted transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={submitComplaint}
                    disabled={!complaintText.trim()}
                    className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    Enviar
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Layout>
  );
}
