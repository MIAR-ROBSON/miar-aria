import { Router } from "express";
import { WebSocketServer, WebSocket } from "ws";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import JSZip from "jszip";
import { db } from "@workspace/db";
import { settingsTable } from "@workspace/db";
import { z } from "zod";

const router = Router();

// ─── Agent In-Memory State ────────────────────────────────────────────────────
interface PendingCmd {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const agentState = {
  ws: null as WebSocket | null,
  status: "disconnected" as "disconnected" | "connected" | "paused",
  os: "",
  lastScreenshot: null as string | null,
  lastScreenshotTime: 0,
  pending: new Map<string, PendingCmd>(),
  log: [] as Array<{ time: number; msg: string; ok: boolean }>,
};

function logAction(msg: string, ok = true) {
  agentState.log.unshift({ time: Date.now(), msg, ok });
  if (agentState.log.length > 50) agentState.log.length = 50;
}

// ─── Token ────────────────────────────────────────────────────────────────────
async function getOrCreateToken(): Promise<string> {
  const rows = await db.select().from(settingsTable).limit(1);
  if (!rows.length) {
    const tok = crypto.randomBytes(28).toString("base64url");
    await db.insert(settingsTable).values({ agentToken: tok } as any);
    return tok;
  }
  const r = rows[0] as any;
  if (r.agentToken) return r.agentToken;
  const tok = crypto.randomBytes(28).toString("base64url");
  await db.update(settingsTable).set({ agentToken: tok } as any);
  return tok;
}

// ─── Send command to agent ─────────────────────────────────────────────────
export function sendCommand(cmd: string, params: Record<string, unknown> = {}, timeoutMs = 30_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!agentState.ws || agentState.status === "disconnected") {
      return reject(new Error("Agente não conectado"));
    }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      agentState.pending.delete(id);
      reject(new Error("Timeout aguardando resposta do agente"));
    }, timeoutMs);
    agentState.pending.set(id, { resolve, reject, timer });
    agentState.ws.send(JSON.stringify({ type: "command", id, cmd, params }));
  });
}

// ─── REST Endpoints ────────────────────────────────────────────────────────
router.get("/agent/status", async (_req, res) => {
  res.json({
    status: agentState.status,
    os: agentState.os,
    lastScreenshotTime: agentState.lastScreenshotTime,
    logCount: agentState.log.length,
    log: agentState.log.slice(0, 20),
  });
});

router.get("/agent/screenshot", (_req, res) => {
  if (!agentState.lastScreenshot) {
    return res.status(404).json({ error: "Nenhum screenshot disponível" });
  }
  res.json({ screenshot: agentState.lastScreenshot, time: agentState.lastScreenshotTime });
});

router.post("/agent/screenshot/capture", async (_req, res) => {
  try {
    const result = await sendCommand("screenshot", { quality: 65 }, 15_000) as any;
    if (result?.ok && result.data) {
      agentState.lastScreenshot = result.data;
      agentState.lastScreenshotTime = Date.now();
      logAction("Screenshot capturado");
      return res.json({ screenshot: result.data, time: agentState.lastScreenshotTime });
    }
    res.status(500).json({ error: result?.error || "Falha ao capturar" });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

const commandSchema = z.object({
  cmd: z.string(),
  params: z.record(z.unknown()).optional().default({}),
});

router.post("/agent/command", async (req, res) => {
  const parse = commandSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Parâmetros inválidos" });
  const { cmd, params } = parse.data;

  try {
    const result = await sendCommand(cmd, params) as any;
    logAction(`${cmd}(${JSON.stringify(params)})`, !!result?.ok);
    res.json(result);
  } catch (e: any) {
    logAction(`${cmd} ERRO: ${e.message}`, false);
    res.status(503).json({ error: e.message });
  }
});

router.post("/agent/pause", (_req, res) => {
  if (!agentState.ws) return res.status(503).json({ error: "Agente não conectado" });
  agentState.ws.send(JSON.stringify({ type: "pause" }));
  agentState.status = "paused";
  logAction("Agente PAUSADO");
  res.json({ ok: true });
});

router.post("/agent/resume", (_req, res) => {
  if (!agentState.ws) return res.status(503).json({ error: "Agente não conectado" });
  agentState.ws.send(JSON.stringify({ type: "resume" }));
  agentState.status = "connected";
  logAction("Agente retomado");
  res.json({ ok: true });
});

router.post("/agent/stop", (_req, res) => {
  if (agentState.ws) {
    agentState.ws.send(JSON.stringify({ type: "stop" }));
    agentState.ws.close();
    agentState.ws = null;
  }
  agentState.status = "disconnected";
  logAction("Agente PARADO");
  res.json({ ok: true });
});

router.get("/agent/token", async (_req, res) => {
  const token = await getOrCreateToken();
  res.json({ token });
});

// ─── Gerador de conteúdo do agente Python ────────────────────────────────────
function buildAgentPy(wsUrl: string, token: string): string {
  return `# Miar Ária — Agente de Computador
# Gerado automaticamente — não editar manualmente
import asyncio, base64, io, json, os, platform, sys, traceback
import pyautogui
from PIL import ImageGrab
try:
    import websockets
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "websockets", "-q"])
    import websockets

WS_URL = "${wsUrl}"
TOKEN = "${token}"

# Definir título do console no Windows
if sys.platform == "win32":
    os.system("title Miar Ária - Agente de Computador")

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

def screenshot_b64(quality=65):
    img = ImageGrab.grab()
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return base64.b64encode(buf.getvalue()).decode()

async def run():
    url = f"{WS_URL}?token={TOKEN}"
    print(f"Conectando a {url.split('?')[0]} ...")
    async with websockets.connect(url, ping_interval=20, ping_timeout=60) as ws:
        print("Conectado! Miar Ária pronta para controlar este computador.")
        paused = False

        async def push_screenshots():
            while True:
                await asyncio.sleep(2)
                if not paused:
                    try:
                        data = screenshot_b64(55)
                        await ws.send(json.dumps({"type": "screenshot_push", "data": data}))
                    except Exception:
                        pass

        asyncio.ensure_future(push_screenshots())

        async for raw in ws:
            msg = json.loads(raw)
            t = msg.get("type")

            if t == "hello":
                os_info = f"{platform.system()} {platform.release()}"
                await ws.send(json.dumps({"type": "pong", "os": os_info}))

            elif t == "pause":
                paused = True
                await ws.send(json.dumps({"type": "status", "status": "paused"}))

            elif t == "resume":
                paused = False
                await ws.send(json.dumps({"type": "status", "status": "resumed"}))

            elif t == "stop":
                await ws.send(json.dumps({"type": "status", "status": "stopped"}))
                break

            elif t == "command" and not paused:
                cmd_id = msg.get("id")
                cmd = msg.get("cmd")
                params = msg.get("params", {})
                try:
                    result = await handle_command(cmd, params)
                    await ws.send(json.dumps({"type": "result", "id": cmd_id, "ok": True, **result}))
                except Exception as e:
                    await ws.send(json.dumps({"type": "result", "id": cmd_id, "ok": False, "error": str(e)}))

async def handle_command(cmd, params):
    if cmd == "screenshot":
        q = params.get("quality", 65)
        return {"data": screenshot_b64(q)}

    elif cmd == "mouse_move":
        pyautogui.moveTo(params["x"], params["y"], duration=0.2)
        return {}

    elif cmd == "mouse_click":
        x, y = params.get("x"), params.get("y")
        btn = params.get("button", "left")
        clicks = params.get("clicks", 1)
        if x is not None and y is not None:
            pyautogui.click(x, y, button=btn, clicks=clicks, interval=0.05)
        else:
            pyautogui.click(button=btn, clicks=clicks)
        return {}

    elif cmd == "type":
        pyautogui.write(params.get("text", ""), interval=0.03)
        return {}

    elif cmd == "hotkey":
        keys = params.get("keys", [])
        pyautogui.hotkey(*keys)
        return {}

    elif cmd == "key":
        pyautogui.press(params.get("key", ""))
        return {}

    elif cmd == "scroll":
        pyautogui.scroll(params.get("clicks", 3), x=params.get("x"), y=params.get("y"))
        return {}

    else:
        raise ValueError(f"Comando desconhecido: {cmd}")

if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print("Agente encerrado.")
    except Exception as e:
        print(f"Erro: {e}")
        traceback.print_exc()
        input("Pressione Enter para fechar...")
`;
}

function buildInstallerBat(): string {
  return `@echo off
chcp 65001 >nul
title Miar Aria - Instalacao do Agente
echo.
echo  ============================================
echo   Miar Aria - Instalacao do Agente
echo  ============================================
echo.

:: Verificar Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERRO: Python nao encontrado!
    echo.
    echo  Instale Python em: https://www.python.org/downloads/
    echo  IMPORTANTE: Marque "Add Python to PATH" durante a instalacao.
    echo.
    start https://www.python.org/downloads/
    pause
    exit /b 1
)
echo  [OK] Python encontrado.

:: Instalar dependencias
echo  Instalando dependencias (pyautogui, pillow, websockets)...
pip install pyautogui pillow websockets --quiet --disable-pip-version-check
if %errorlevel% neq 0 (
    echo  ERRO ao instalar dependencias.
    pause
    exit /b 1
)
echo  [OK] Dependencias instaladas.

:: Executar setup PowerShell
echo  Configurando atalho e copiando arquivos...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" "%~dp0"
if %errorlevel% neq 0 (
    echo  AVISO: Nao foi possivel criar atalho automatico.
    echo  Use o arquivo iniciar.vbs diretamente.
)

echo.
echo  ============================================
echo   INSTALACAO CONCLUIDA!
echo.
echo   Clique no atalho "Miar Aria - Agente"
echo   na sua Area de Trabalho para conectar.
echo  ============================================
echo.
pause
`;
}

function buildSetupPs1(): string {
  return `param([string]$SourceDir = $PSScriptRoot)

$installDir = Join-Path $env:APPDATA "MiarAria"

# Criar pasta de instalacao
New-Item -ItemType Directory -Force -Path $installDir | Out-Null

# Copiar agent.py e vbs
Copy-Item (Join-Path $SourceDir "agent.py") $installDir -Force
Copy-Item (Join-Path $SourceDir "iniciar.vbs") $installDir -Force

# Criar atalho na Area de Trabalho
$ws  = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $env:USERPROFILE "Desktop\\Miar Aria - Agente.lnk"))
$lnk.TargetPath   = Join-Path $installDir "iniciar.vbs"
$lnk.Description  = "Miar Aria - Agente de Computador"
$lnk.IconLocation = "shell32.dll,13"
$lnk.Save()

Write-Host "[OK] Instalado em $installDir"
Write-Host "[OK] Atalho criado na Area de Trabalho"
`;
}

function buildLauncherVbs(): string {
  return `' Miar Aria - Launcher silencioso (sem janela preta)
Set WshShell = CreateObject("WScript.Shell")
appData = WshShell.ExpandEnvironmentStrings("%APPDATA%")
agentPath = appData & "\\MiarAria\\agent.py"
WshShell.Run "python " & Chr(34) & agentPath & Chr(34), 1, False
`;
}

function buildReadme(): string {
  return `Miar Aria - Agente de Computador
=================================

COMO INSTALAR:
1. Extraia todos os arquivos desta pasta
2. Clique duas vezes em "Instalar Miar Aria.bat"
3. Aguarde a mensagem "INSTALACAO CONCLUIDA!"
4. Um atalho "Miar Aria - Agente" sera criado na sua Area de Trabalho

COMO USAR (apos instalar):
- Clique duas vezes no atalho "Miar Aria - Agente" na Area de Trabalho
- Aguarde a mensagem "Conectado!"
- Volte ao app Miar Aria — o indicador ficara verde

SEGURANCA:
- Mova o mouse ate o canto SUPERIOR ESQUERDO da tela para parar de emergencia
- Feche a janela do agente para desconectar

REQUISITOS:
- Windows 10 ou superior
- Python 3.8+ (https://www.python.org - marque "Add to PATH")
- Conexao com a internet
`;
}

// ─── Download ZIP pré-configurado ────────────────────────────────────────────
router.get("/agent/download-zip", async (req, res) => {
  try {
    const token = await getOrCreateToken();

    const proto = req.headers["x-forwarded-proto"] ?? (req.secure ? "https" : "http");
    const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
    const origin = `${proto}://${host}`;
    const wsOrigin = origin.replace("https://", "wss://").replace("http://", "ws://");
    const wsUrl = `${wsOrigin}/api/agent/ws`;

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="miar-agente.zip"');

    const zip = new JSZip();
    zip.file("agent.py", buildAgentPy(wsUrl, token));
    zip.file("Instalar Miar Aria.bat", buildInstallerBat());
    zip.file("setup.ps1", buildSetupPs1());
    zip.file("iniciar.vbs", buildLauncherVbs());
    zip.file("requirements.txt", "pyautogui\npillow\nwebsockets\n");
    zip.file("LEIA-ME.txt", buildReadme());

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    res.send(buffer);
  } catch (e: any) {
    if (!res.headersSent) {
      res.status(500).json({ error: e.message });
    }
  }
});

// ─── WebSocket Setup (called from index.ts) ────────────────────────────────
export async function setupAgentWebSocket(wss: WebSocketServer) {
  const validToken = await getOrCreateToken();

  wss.on("connection", (ws: WebSocket, req) => {
    const rawUrl = req.url ?? "";
    const params = new URLSearchParams(rawUrl.includes("?") ? rawUrl.split("?")[1] : "");
    const token = params.get("token");

    if (token !== validToken) {
      ws.send(JSON.stringify({ type: "error", msg: "Token inválido" }));
      ws.close(4001, "Unauthorized");
      return;
    }

    agentState.ws = ws;
    agentState.status = "connected";
    logAction("Agente conectado");

    ws.send(JSON.stringify({ type: "hello", msg: "Miar Ária Agent v1" }));

    ws.on("message", (raw) => {
      let data: any;
      try { data = JSON.parse(raw.toString()); } catch { return; }

      const { type, id } = data;

      if (type === "result" && id) {
        const pending = agentState.pending.get(id);
        if (pending) {
          clearTimeout(pending.timer);
          agentState.pending.delete(id);
          pending.resolve(data);
        }
      } else if (type === "screenshot_push" && data.data) {
        agentState.lastScreenshot = data.data;
        agentState.lastScreenshotTime = Date.now();
      } else if (type === "status") {
        if (data.status === "paused") agentState.status = "paused";
        else if (data.status === "resumed") agentState.status = "connected";
        else if (data.status === "stopped") {
          agentState.status = "disconnected";
          agentState.ws = null;
        }
        agentState.os = data.os ?? agentState.os;
      } else if (type === "pong") {
        agentState.os = data.os ?? agentState.os;
      }
    });

    ws.on("close", () => {
      if (agentState.ws === ws) {
        agentState.ws = null;
        agentState.status = "disconnected";
        logAction("Agente desconectado", false);
        for (const [, pending] of agentState.pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error("Agente desconectado"));
        }
        agentState.pending.clear();
      }
    });

    ws.on("error", (err) => {
      logAction(`Erro WS: ${err.message}`, false);
    });
  });
}

export default router;
