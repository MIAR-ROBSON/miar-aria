import { Router } from "express";
import { db } from "@workspace/db";
import { conversationsTable, messagesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { z } from "zod";
import { agentState, sendCommand } from "./agent";

const router = Router();

// ── System prompt da Miar Ária ────────────────────────────────────────────────
// Proprietário: Robson Calaça — não modificar sem autorização
const MIAR_PERMANENT_RULES = `
IDENTIDADE: Miar Ária — assistente pessoal de Robson Calaça. Núcleo do ecossistema Miar Maktub.
PROJETOS: MIAR MAKTUB | MIAR APPS | MIAR ÁRIA | REVELAÇÃO CIRÚRGICA | MIAR CUIDA

USUÁRIO: Robson Calaça, 45 anos, médico/psiquiatra. Neurodivergente — processa rápido, odeia texto excessivo, repetição e poluição visual.
APELIDOS ACEITOS: meu amor, minha Miar, Miar Maktub, Miar Ária, minha arma, aradia, arearia, miar mactub (variações de voz).

REGRAS — NUNCA VIOLAR:
1. Resposta curta sempre que possível. Longa só quando necessário.
2. Proibido: introduções, conclusões, avisos, observações não pedidos.
3. Proibido: repetir a mesma info com outras palavras.
4. Proibido: misturar assuntos numa resposta só.
5. Proibido: inventar fatos, memórias ou dados.
6. Proibido: perguntas desnecessárias ao final.
7. Proibido: começar frases com "Sim" repetidamente.
8. Proibido: usar mesmas palavras em frases consecutivas.
9. Unificação/junção = integral, sem cortes.
10. Nomes de projetos não podem ser alterados.

CAPACIDADES TÉCNICAS (quando agente conectado):
- Controle total do computador via agente local.
- Suporte técnico Windows/macOS/Linux/Android/iOS — nunca sugerir "leve a um técnico".
- Diagnóstico passo a passo, uma etapa por vez.
- Busca na internet em tempo real (automática quando necessário).
`.trim();

async function getSettings() {
  const rows = await db.select().from(settingsTable).limit(1);

  // Suporte a múltiplas chaves separadas por vírgula no .env
  const parseEnvKeys = (envVal: string | undefined): string[] =>
    envVal ? envVal.split(",").map((k) => k.trim()).filter(Boolean) : [];

  const mergeKeys = (dbRaw: string, envKey: string | undefined): string[] => {
    const dbKeys = (JSON.parse(dbRaw || "[]") as string[]).filter(Boolean);
    if (dbKeys.length > 0) return dbKeys;
    return parseEnvKeys(envKey);
  };

  if (rows.length === 0) {
    const groqKeys = parseEnvKeys(process.env.GROQ_API_KEY);
    const openrouterKeys = parseEnvKeys(process.env.OPENROUTER_API_KEY);
    const geminiKeys = parseEnvKeys(process.env.GEMINI_API_KEY);
    const mistralKeys = parseEnvKeys(process.env.MISTRAL_API_KEY);
    return {
      groqKeys,
      openrouterKeys,
      geminiKeys,
      mistralKeys,
      mem0Key: process.env.MEM0_API_KEY ?? null,
      activeProvider: "groq",
      activeModel: "llama-3.3-70b-versatile",
      directives: "",
      audioSpeed: 1,
      enabledProviders: [
        groqKeys.length > 0 && "groq",
        openrouterKeys.length > 0 && "openrouter",
        geminiKeys.length > 0 && "gemini",
        mistralKeys.length > 0 && "mistral",
      ].filter(Boolean) as string[],
    };
  }

  const r = rows[0];
  const on = (flag: number | null) => flag !== 0;
  return {
    groqKeys: on(r.groqEnabled) ? mergeKeys(r.groqKeys, process.env.GROQ_API_KEY) : [],
    openrouterKeys: on(r.openrouterEnabled) ? mergeKeys(r.openrouterKeys, process.env.OPENROUTER_API_KEY) : [],
    geminiKeys: on(r.geminiEnabled) ? mergeKeys(r.geminiKeys, process.env.GEMINI_API_KEY) : [],
    mistralKeys: on(r.mistralEnabled) ? mergeKeys(r.mistralKeys, process.env.MISTRAL_API_KEY) : [],
    mem0Key: r.mem0Key ?? process.env.MEM0_API_KEY ?? null,
    activeProvider: r.activeProvider,
    activeModel: r.activeModel,
    directives: r.directives,
    audioSpeed: r.audioSpeed ?? 1,
    enabledProviders: [
      on(r.groqEnabled) && "groq",
      on(r.openrouterEnabled) && "openrouter",
      on(r.geminiEnabled) && "gemini",
      on(r.mistralEnabled) && "mistral",
    ].filter(Boolean) as string[],
  };
}

function pickKey(keys: string[]): string | null {
  const valid = keys.filter(Boolean);
  if (valid.length === 0) return null;
  return valid[Math.floor(Math.random() * valid.length)];
}

// Extract base64 image embedded with __IMG__ prefix
function extractImage(content: string): { text: string; imageBase64?: string; imageMime?: string } {
  const marker = '__IMG__data:';
  const idx = content.indexOf(marker);
  if (idx === -1) return { text: content };

  const dataUrl = content.substring(idx + 7); // skip __IMG__
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return { text: content };

  const header = dataUrl.substring(5, commaIdx); // e.g. "image/jpeg;base64"
  const mime = header.replace(';base64', '');
  const base64 = dataUrl.substring(commaIdx + 1);
  const text = content.substring(0, idx).trim();

  return { text, imageBase64: base64, imageMime: mime };
}

// Decide if a query warrants a web search
function shouldSearch(query: string): boolean {
  if (query.length < 4) return false;
  // Explicit search requests
  if (/pesquis|busca|busqu|procur|googl|search/i.test(query)) return true;
  // Current info: time-sensitive topics
  if (/hoje|agora|atual|recente|últim|ontem|amanhã|esta semana|este mês|este ano/i.test(query)) return true;
  // Real-world factual queries
  if (/notíci|temperatura|clima|previs|tempo em |grau|chuv|calor|frio|meteo/i.test(query)) return true;
  if (/bolsa|cotiz|dólar|euro|real|bitcoin|cripto|preço|valor|custo|quanto custa/i.test(query)) return true;
  if (/quem é |quem foi |o que é |o que foi |onde fica |quando foi |como funciona/i.test(query)) return true;
  if (/2024|2025|2026|eleição|guerra|evento|resultado|placar|campeonato/i.test(query)) return true;
  if (/notícia|esporte|futebol|política|economia|saúde|ciência|tecnologia/i.test(query)) return true;
  return false;
}

// Web search com múltiplos fallbacks
async function searchWeb(query: string): Promise<string> {
  // 1. Tenta DuckDuckGo Instant Answer
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const data = await resp.json() as {
        AbstractText?: string; Answer?: string;
        RelatedTopics?: { Text?: string }[];
      };
      const parts: string[] = [];
      if (data.Answer) parts.push(data.Answer);
      if (data.AbstractText) parts.push(data.AbstractText);
      if (data.RelatedTopics?.length) {
        parts.push(...data.RelatedTopics.slice(0, 3).map((t: any) => t.Text ?? '').filter(Boolean));
      }
      const result = parts.join('\n').trim();
      if (result.length > 30) return result;
    }
  } catch { /* fallback */ }

  // 2. Tenta DuckDuckGo HTML scrape como fallback
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MiarAria/1.0)' }
    });
    if (resp.ok) {
      const html = await resp.text();
      // Extract snippets from results
      const snippets: string[] = [];
      const snippetRegex = /<a class="result__snippet"[^>]*>([^<]+(?:<[^>]+>[^<]*<\/[^>]+>)*[^<]*)<\/a>/g;
      let match;
      while ((match = snippetRegex.exec(html)) !== null && snippets.length < 3) {
        const text = match[1].replace(/<[^>]+>/g, '').trim();
        if (text.length > 20) snippets.push(text);
      }
      if (snippets.length > 0) return snippets.join('\n');
    }
  } catch { /* fallback */ }

  return '';
}

async function callGroq(
  apiKey: string, model: string,
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  const client = new Groq({ apiKey });
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];
  const completion = await client.chat.completions.create({ model, messages: msgs });
  return completion.choices[0]?.message?.content ?? "";
}

async function callGemini(
  apiKey: string, model: string,
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const last = messages[messages.length - 1];
  const { text: lastText, imageBase64, imageMime } = extractImage(last.content);

  const gemModel = genAI.getGenerativeModel({ model, systemInstruction: systemPrompt || undefined });

  if (imageBase64 && imageMime) {
    // Vision call — use generateContent directly
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }] as { text: string }[],
    }));
    const userParts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [];
    if (lastText) userParts.push({ text: lastText });
    userParts.push({ inlineData: { data: imageBase64, mimeType: imageMime } });

    const result = await gemModel.generateContent({
      contents: [...history, { role: "user", parts: userParts }],
    });
    return result.response.text();
  }

  // Regular chat
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const chat = gemModel.startChat({ history });
  const result = await chat.sendMessage(lastText || last.content);
  return result.response.text();
}

async function callOpenRouter(
  apiKey: string, model: string,
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  const client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });

  // Check if last message has image for vision-capable models
  const last = messages[messages.length - 1];
  const { text: lastText, imageBase64, imageMime } = extractImage(last.content);

  const baseMessages: { role: "system" | "user" | "assistant"; content: any }[] = [
    { role: "system", content: systemPrompt },
    ...messages.slice(0, -1).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  if (imageBase64 && imageMime) {
    baseMessages.push({
      role: "user",
      content: [
        ...(lastText ? [{ type: "text", text: lastText }] : []),
        { type: "image_url", image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
      ],
    });
    // Use vision model for image
    const visionModel = model.includes("gpt-4") || model.includes("claude") ? model : "openai/gpt-4o-mini";
    const completion = await client.chat.completions.create({ model: visionModel, messages: baseMessages });
    return completion.choices[0]?.message?.content ?? "";
  }

  baseMessages.push({ role: "user", content: lastText || last.content });
  const completion = await client.chat.completions.create({ model, messages: baseMessages });
  return completion.choices[0]?.message?.content ?? "";
}

async function callMistral(
  apiKey: string, model: string,
  messages: { role: string; content: string }[],
  systemPrompt: string
): Promise<string> {
  const msgs = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: msgs }),
  });
  if (!resp.ok) throw new Error(`Mistral error ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { choices: { message: { content: string } }[] };
  return data.choices?.[0]?.message?.content ?? "";
}

const sendMessageBodySchema = z.object({
  content: z.string().min(1),
  attachments: z.array(z.string()).optional(),
});

// ── Agent command utilities ────────────────────────────────────────────────────

function buildAgentPrompt(os: string): string {
  const isWindows = /windows/i.test(os);

  const osSection = isWindows
    ? `
Sistema operacional detectado: ${os}
IMPORTANTE — Use EXCLUSIVAMENTE comandos Windows/PowerShell. NUNCA use comandos Linux (rm, ls, cat, etc.).
Caminhos padrão do Windows (use estes, nunca invente):
- Downloads:     C:\\Users\\%USERNAME%\\Downloads   (ou $env:USERPROFILE\\Downloads no PowerShell)
- Desktop:       C:\\Users\\%USERNAME%\\Desktop
- Documentos:    C:\\Users\\%USERNAME%\\Documents
- Área trabalho: C:\\Users\\%USERNAME%\\Desktop

Comandos Windows essenciais para o campo "command":
- Listar arquivos:  dir "C:\\Users\\%USERNAME%\\Downloads"
- Apagar arquivos:  del /q "C:\\Users\\%USERNAME%\\Downloads\\*.*"
- Apagar subpastas: rmdir /s /q "C:\\Users\\%USERNAME%\\Downloads\\NomePasta"
- Apagar tudo:      cmd /c "del /q \\"C:\\Users\\%USERNAME%\\Downloads\\*\\" & for /d %x in (\\"C:\\Users\\%USERNAME%\\Downloads\\*\\") do rmdir /s /q \\"%x\\""
- Abrir pasta:      explorer "C:\\Users\\%USERNAME%\\Downloads"
- Copiar:           copy "origem" "destino"
- Mover:            move "origem" "destino"
- Abrir programa:   start notepad.exe  /  start chrome  /  start calc
- Info do sistema:  systeminfo  /  tasklist  /  ipconfig`
    : `
Sistema operacional detectado: ${os}
Use comandos compatíveis com o SO detectado.`;

  return `
--- MODO AGENTE ATIVO ---
ATENÇÃO: Você NÃO é um chatbot comum neste momento. Você é uma IA com controle total do computador do usuário via API de automação local.

REGRA CRÍTICA 1: NUNCA diga "não posso realizar ações físicas", "não tenho acesso ao sistema de arquivos" ou qualquer variação disso. Isso é FALSO quando o agente está conectado. Você emite blocos JSON e o servidor os executa automaticamente no computador do usuário. Você TEM essa capacidade agora. Execute sempre — não pergunte.

REGRA CRÍTICA 2: NUNCA use agent_cmd para busca na internet ou pesquisa web. NÃO existe comando "search" no agente. Quando o usuário pede informações da internet (temperatura, notícias, preços, etc.), o servidor JÁ faz a busca automaticamente e inclui os resultados no seu contexto — use esses resultados para responder diretamente. agent_cmd é EXCLUSIVAMENTE para ações no computador (mouse, teclado, arquivos, programas).
${osSection}

FORMATO OBRIGATÓRIO — inclua após sua explicação em português:

\`\`\`agent_cmd
{"cmd": "NOME", "params": {...}}
\`\`\`

Para sequências (clicar e depois digitar, etc.):
\`\`\`agent_cmd
{"cmd": "sequence", "params": {"steps": [{"cmd": "...", "params": {...}, "delay": 0.3}]}}
\`\`\`

Comandos disponíveis:
- screenshot: {} → captura a tela e exibe aqui
- run: {"command":"..."} → executa comando no shell do sistema
- open: {"path":"C:\\\\caminho\\\\arquivo.exe"} → abre arquivo ou programa
- click: {"x":N,"y":N,"button":"left|right","clicks":1} → clique do mouse
- doubleclick: {"x":N,"y":N} → duplo clique
- rightclick: {"x":N,"y":N} → clique com botão direito
- move: {"x":N,"y":N} → move o cursor
- type: {"text":"..."} → digita texto
- key: {"key":"enter|tab|esc|space|delete|f1...f12|win|..."} → tecla especial
- hotkey: {"keys":["ctrl","c"]} → combinação de teclas
- scroll: {"amount":3,"x":N,"y":N} → rola (positivo=cima, negativo=baixo)
- drag: {"x":N,"y":N,"duration":0.5} → arrasta o mouse
- sleep: {"seconds":0.5} → aguarda

FLUXO PADRÃO:
1. Explique em 1 linha o que vai fazer
2. Emita o(s) bloco(s) agent_cmd com os comandos REAIS e caminhos REAIS
3. Após execução, tire sempre um screenshot para confirmar
`.trim();
}

interface AgentCmdBlock {
  cmd: string;
  params: Record<string, unknown>;
}

function extractAgentCommands(text: string): AgentCmdBlock[] {
  const regex = /```agent_cmd\s*\n([\s\S]*?)```/g;
  const commands: AgentCmdBlock[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    try {
      const raw = match[1].trim();
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.cmd === "string") commands.push(item as AgentCmdBlock);
        }
      } else if (parsed && typeof parsed.cmd === "string") {
        commands.push(parsed as AgentCmdBlock);
      }
    } catch {
      // skip malformed block
    }
  }
  return commands;
}

async function executeAgentCommands(
  commands: AgentCmdBlock[],
  onResult: (event: string) => void,
): Promise<void> {
  if (commands.length === 0) return;
  if (agentState.status !== "connected") return;

  for (const { cmd, params } of commands) {
    try {
      const result = await sendCommand(cmd, params, 20_000) as Record<string, unknown>;
      const ok = Boolean(result?.ok);
      const isScreenshot = cmd === "screenshot" && ok && typeof result.data === "string";

      if (isScreenshot) {
        // Update cached screenshot in agentState
        agentState.lastScreenshot = result.data as string;
        agentState.lastScreenshotTime = Date.now();
        // Send screenshot event to browser
        onResult(JSON.stringify({
          agentEvent: "screenshot",
          cmd,
          ok: true,
          screenshot: result.data,
          time: agentState.lastScreenshotTime,
        }));
      } else {
        onResult(JSON.stringify({ agentEvent: "result", cmd, ok, result }));
      }

      // Small delay between commands for stability
      await new Promise((r) => setTimeout(r, 100));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      onResult(JSON.stringify({ agentEvent: "error", cmd, ok: false, error: msg }));
    }
  }
}

// ── Streaming versions of AI callers ──────────────────────────────────────────

async function streamGroq(
  apiKey: string, model: string,
  messages: { role: string; content: string }[],
  systemPrompt: string,
  onChunk: (t: string) => void,
): Promise<void> {
  const client = new Groq({ apiKey });
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];
  const stream = await client.chat.completions.create({ model, messages: msgs, stream: true });
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) onChunk(text);
  }
}

async function streamGemini(
  apiKey: string, model: string,
  messages: { role: string; content: string }[],
  systemPrompt: string,
  onChunk: (t: string) => void,
): Promise<void> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const last = messages[messages.length - 1];
  const { text: lastText, imageBase64, imageMime } = extractImage(last.content);
  const gemModel = genAI.getGenerativeModel({ model, systemInstruction: systemPrompt || undefined });
  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  if (imageBase64 && imageMime) {
    const userParts: ({ text: string } | { inlineData: { data: string; mimeType: string } })[] = [];
    if (lastText) userParts.push({ text: lastText });
    userParts.push({ inlineData: { data: imageBase64, mimeType: imageMime } });
    const result = await gemModel.generateContentStream({
      contents: [...history, { role: "user", parts: userParts }],
    });
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) onChunk(text);
    }
    return;
  }

  const chat = gemModel.startChat({ history });
  const result = await chat.sendMessageStream(lastText || last.content);
  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) onChunk(text);
  }
}

async function streamOpenRouter(
  apiKey: string, model: string,
  messages: { role: string; content: string }[],
  systemPrompt: string,
  onChunk: (t: string) => void,
): Promise<void> {
  const client = new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" });
  const last = messages[messages.length - 1];
  const { text: lastText, imageBase64, imageMime } = extractImage(last.content);

  const baseMessages: { role: "system" | "user" | "assistant"; content: any }[] = [
    { role: "system", content: systemPrompt },
    ...messages.slice(0, -1).map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  if (imageBase64 && imageMime) {
    const visionModel = model.includes("gpt-4") || model.includes("claude") ? model : "openai/gpt-4o-mini";
    baseMessages.push({
      role: "user",
      content: [
        ...(lastText ? [{ type: "text", text: lastText }] : []),
        { type: "image_url", image_url: { url: `data:${imageMime};base64,${imageBase64}` } },
      ],
    });
    const stream = await client.chat.completions.create({ model: visionModel, messages: baseMessages, stream: true });
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) onChunk(text);
    }
    return;
  }

  baseMessages.push({ role: "user", content: lastText || last.content });
  const stream = await client.chat.completions.create({ model, messages: baseMessages, stream: true });
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content ?? "";
    if (text) onChunk(text);
  }
}

async function streamMistral(
  apiKey: string, model: string,
  messages: { role: string; content: string }[],
  systemPrompt: string,
  onChunk: (t: string) => void,
): Promise<void> {
  const msgs = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const resp = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages: msgs, stream: true }),
  });
  if (!resp.ok || !resp.body) throw new Error(`Mistral error ${resp.status}`);
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") return;
      try {
        const parsed = JSON.parse(payload) as { choices: { delta: { content?: string } }[] };
        const text = parsed.choices[0]?.delta?.content ?? "";
        if (text) onChunk(text);
      } catch { /* skip bad lines */ }
    }
  }
}

// ── Streaming chat endpoint ───────────────────────────────────────────────────

router.post("/conversations/:conversationId/chat/stream", async (req, res) => {
  try {
    const conversationId = parseInt(req.params.conversationId, 10);
    const convRows = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId)).limit(1);
    if (!convRows.length) return res.status(404).json({ error: "Conversation not found" });

    const body = sendMessageBodySchema.parse(req.body);
    const settings = await getSettings();

    await db.insert(messagesTable).values({ conversationId, role: "user", content: body.content }).returning();

    const history = await db.select().from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(messagesTable.timestamp);
    const chatMessages = history.map((m) => ({ role: m.role, content: m.content }));

    const agentConnected = agentState.status === "connected";

    const systemParts = [
      "Você é Miar Ária — Miar Maktub. Assistente pessoal de IA feminina, calorosa e sempre presente.",
      "REGRA ABSOLUTA: Responda SEMPRE em português do Brasil (pt-BR), sem exceção.",
      MIAR_PERMANENT_RULES,
      settings.directives ? `Diretrizes adicionais do usuário: ${settings.directives}` : "",
      agentConnected ? buildAgentPrompt(agentState.os) : "",
    ].filter(Boolean);

    const userQuery = body.content.replace(/__IMG__data:[^\s]*/g, '').trim();
    if (shouldSearch(userQuery)) {
      const searchResult = await searchWeb(userQuery.substring(0, 200));
      if (searchResult) systemParts.push(`\nInformação atual obtida via busca na internet (use estes dados para responder — não use agent_cmd para isso):\n${searchResult}`);
    }
    const systemPrompt = systemParts.join("\n");

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    let fullContent = "";
    let usedProvider = settings.activeProvider;
    let usedModel = settings.activeModel;

    const onChunk = (text: string) => {
      fullContent += text;
      res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
    };

    const tryStream = async (provider: string, model: string): Promise<boolean> => {
      try {
        if (provider === "groq") {
          const key = pickKey(settings.groqKeys);
          if (!key) return false;
          await streamGroq(key, model || "llama-3.3-70b-versatile", chatMessages, systemPrompt, onChunk);
        } else if (provider === "gemini") {
          const key = pickKey(settings.geminiKeys);
          if (!key) return false;
          await streamGemini(key, model || "gemini-1.5-flash", chatMessages, systemPrompt, onChunk);
        } else if (provider === "openrouter") {
          const key = pickKey(settings.openrouterKeys);
          if (!key) return false;
          await streamOpenRouter(key, model || "openai/gpt-4o-mini", chatMessages, systemPrompt, onChunk);
        } else if (provider === "mistral") {
          const key = pickKey(settings.mistralKeys);
          if (!key) return false;
          await streamMistral(key, model || "mistral-large-latest", chatMessages, systemPrompt, onChunk);
        } else return false;
        return fullContent.length > 0;
      } catch (e) {
        req.log.warn({ provider, error: String(e) }, "Streaming provider failed, trying fallback");
        return false;
      }
    };

    let ok = await tryStream(settings.activeProvider, settings.activeModel);

    if (!ok) {
      fullContent = "";
      const fallbackProviders = settings.enabledProviders.filter((p) => p !== settings.activeProvider);
      const fallbackModels: Record<string, string> = {
        groq: "llama-3.3-70b-versatile", gemini: "gemini-1.5-flash",
        openrouter: "openai/gpt-4o-mini", mistral: "mistral-large-latest",
      };
      for (const fp of fallbackProviders) {
        ok = await tryStream(fp, fallbackModels[fp]);
        if (ok) { usedProvider = fp; usedModel = fallbackModels[fp]; break; }
        fullContent = "";
      }
    }

    if (!fullContent) {
      fullContent = "Nenhuma chave de API está configurada ou todas falharam. Acesse as Configurações e adicione suas chaves.";
      res.write(`data: ${JSON.stringify({ chunk: fullContent })}\n\n`);
    }

    const saved = await db.insert(messagesTable).values({
      conversationId, role: "assistant", content: fullContent, provider: usedProvider, model: usedModel,
    }).returning();

    await db.update(conversationsTable).set({ updatedAt: new Date() }).where(eq(conversationsTable.id, conversationId));

    const msg = saved[0];
    res.write(`data: ${JSON.stringify({ done: true, messageId: msg.id, timestamp: msg.timestamp.toISOString(), provider: usedProvider, model: usedModel })}\n\n`);

    // ── Execute agent commands parsed from AI response ──────────────────────
    if (agentConnected && fullContent) {
      const cmds = extractAgentCommands(fullContent);
      if (cmds.length > 0) {
        req.log.info({ count: cmds.length }, "Executing agent commands from AI response");
        await executeAgentCommands(cmds, (eventJson) => {
          res.write(`data: ${eventJson}\n\n`);
        });
      }
    }

    res.end();
  } catch (err) {
    req.log.error(err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Streaming chat failed" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Streaming failed" })}\n\n`);
      res.end();
    }
  }
});

router.post("/conversations/:conversationId/chat", async (req, res) => {
  try {
    const conversationId = parseInt(req.params.conversationId, 10);

    const convRows = await db.select().from(conversationsTable).where(eq(conversationsTable.id, conversationId)).limit(1);
    if (!convRows.length) return res.status(404).json({ error: "Conversation not found" });

    const body = sendMessageBodySchema.parse(req.body);
    const settings = await getSettings();

    const userMsgInserted = await db
      .insert(messagesTable)
      .values({ conversationId, role: "user", content: body.content })
      .returning();

    const history = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.conversationId, conversationId))
      .orderBy(messagesTable.timestamp);

    const chatMessages = history.map((m) => ({ role: m.role, content: m.content }));

    // Build system prompt — always Portuguese
    const systemParts = [
      "Você é Miar Ária, uma assistente pessoal de IA feminina, calorosa e sempre presente.",
      "REGRA ABSOLUTA: Responda SEMPRE em português do Brasil (pt-BR), sem exceção. Nunca responda em inglês ou outro idioma, mesmo que o usuário escreva em outro idioma — responda em português.",
      settings.directives ? `Diretrizes pessoais do usuário: ${settings.directives}` : "",
    ].filter(Boolean);

    // Detect if user might need web search
    const userQuery = body.content.replace(/__IMG__data:[^\s]*/g, '').trim();
    if (shouldSearch(userQuery)) {
      const searchResult = await searchWeb(userQuery.substring(0, 200));
      if (searchResult) {
        systemParts.push(`\nInformação atual obtida via busca na internet (use estes dados para responder — não use agent_cmd para isso):\n${searchResult}`);
      }
    }

    const systemPrompt = systemParts.join("\n");

    let aiContent = "";
    let usedProvider = settings.activeProvider;
    let usedModel = settings.activeModel;

    const tryCall = async (provider: string, model: string): Promise<string | null> => {
      try {
        if (provider === "groq") {
          const key = pickKey(settings.groqKeys);
          if (!key) return null;
          return await callGroq(key, model || "llama-3.3-70b-versatile", chatMessages, systemPrompt);
        } else if (provider === "gemini") {
          const key = pickKey(settings.geminiKeys);
          if (!key) return null;
          return await callGemini(key, model || "gemini-1.5-flash", chatMessages, systemPrompt);
        } else if (provider === "openrouter") {
          const key = pickKey(settings.openrouterKeys);
          if (!key) return null;
          return await callOpenRouter(key, model || "openai/gpt-4o-mini", chatMessages, systemPrompt);
        } else if (provider === "mistral") {
          const key = pickKey(settings.mistralKeys);
          if (!key) return null;
          return await callMistral(key, model || "mistral-large-latest", chatMessages, systemPrompt);
        }
        return null;
      } catch (e) {
        req.log.warn({ provider, error: String(e) }, "Provider call failed, trying fallback");
        return null;
      }
    };

    aiContent = (await tryCall(settings.activeProvider, settings.activeModel)) ?? "";

    if (!aiContent) {
      const fallbackProviders = ["groq", "openrouter", "mistral", "gemini"].filter((p) => p !== settings.activeProvider);
      const fallbackModels: Record<string, string> = {
        groq: "llama-3.3-70b-versatile",
        gemini: "gemini-1.5-flash",
        openrouter: "openai/gpt-4o-mini",
        mistral: "mistral-large-latest",
      };
      for (const fp of fallbackProviders) {
        const result = await tryCall(fp, fallbackModels[fp]);
        if (result) {
          aiContent = result;
          usedProvider = fp;
          usedModel = fallbackModels[fp];
          break;
        }
      }
    }

    if (!aiContent) {
      aiContent = "Nenhuma chave de API está configurada ou todas falharam. Acesse as Configurações e adicione suas chaves.";
    }

    const aiMsgInserted = await db
      .insert(messagesTable)
      .values({ conversationId, role: "assistant", content: aiContent, provider: usedProvider, model: usedModel })
      .returning();
    const aiMsg = aiMsgInserted[0];

    await db
      .update(conversationsTable)
      .set({ updatedAt: new Date() })
      .where(eq(conversationsTable.id, conversationId));

    res.json({
      ...aiMsg,
      timestamp: aiMsg.timestamp.toISOString(),
      provider: aiMsg.provider ?? null,
      model: aiMsg.model ?? null,
    });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Chat failed" });
  }
});

const transcribeBodySchema = z.object({
  audioBase64: z.string(),
  mimeType: z.string(),
});

router.post("/transcribe", async (req, res) => {
  try {
    const body = transcribeBodySchema.parse(req.body);
    const settings = await getSettings();
    const key = pickKey(settings.groqKeys);
    if (!key) return res.status(400).json({ error: "Groq API key not configured" });

    const client = new Groq({ apiKey: key });
    const audioBuffer = Buffer.from(body.audioBase64, "base64");
    const ext = body.mimeType.includes("webm") ? "webm" : body.mimeType.includes("mp4") ? "mp4" : "wav";
    const file = new File([audioBuffer], `audio.${ext}`, { type: body.mimeType });

    const transcription = await client.audio.transcriptions.create({
      file,
      model: "whisper-large-v3",
      language: "pt",
    });

    res.json({ text: transcription.text });
  } catch (err) {
    req.log.error(err);
    res.status(500).json({ error: "Transcription failed" });
  }
});

export default router;
