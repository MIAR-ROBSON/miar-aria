import { Router } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import archiver from "archiver";

const router = Router();

// Gera e baixa o instalador completo para Windows
router.get("/agent/download-installer", async (req, res) => {
  try {
    // Pegar token do banco
    const rows = await db.select().from(settingsTable).limit(1);
    const token = rows[0]?.agentToken ?? "TOKEN_NAO_CONFIGURADO";
    const serverUrl = `${req.protocol}://${req.get("host")}`;

    // Script Python do agente (embutido no instalador)
    const agentPy = `
import websocket, json, pyautogui, base64, threading, time, sys
from io import BytesIO
from PIL import Image

SERVER_URL = "${serverUrl}"
TOKEN = "${token}"
WS_URL = f"{SERVER_URL.replace('http', 'ws')}/api/agent/ws?token={TOKEN}"

def on_message(ws, message):
    try:
        cmd = json.loads(message)
        action = cmd.get("action")
        if action == "screenshot":
            img = pyautogui.screenshot()
            buf = BytesIO()
            img.save(buf, format="JPEG", quality=60)
            b64 = base64.b64encode(buf.getvalue()).decode()
            ws.send(json.dumps({"type": "screenshot", "data": b64}))
        elif action == "click":
            pyautogui.click(cmd["x"], cmd["y"])
            ws.send(json.dumps({"type": "ok", "action": "click"}))
        elif action == "type":
            pyautogui.typewrite(cmd["text"], interval=0.05)
            ws.send(json.dumps({"type": "ok", "action": "type"}))
        elif action == "key":
            pyautogui.press(cmd["key"])
            ws.send(json.dumps({"type": "ok", "action": "key"}))
    except Exception as e:
        ws.send(json.dumps({"type": "error", "message": str(e)}))

def on_open(ws):
    ws.send(json.dumps({"type": "auth", "token": TOKEN}))

def on_error(ws, error):
    print(f"Erro: {error}")

def on_close(ws, *args):
    print("Desconectado. Reconectando em 5s...")
    time.sleep(5)
    connect()

def connect():
    ws = websocket.WebSocketApp(WS_URL, on_open=on_open, on_message=on_message, on_error=on_error, on_close=on_close)
    ws.run_forever()

if __name__ == "__main__":
    print("Miar Aria - Agente conectando...")
    connect()
`.trim();

    // Instalador .bat que instala Python silenciosamente se não tiver
    const installerBat = `@echo off
chcp 65001 >nul
title Miar Aria - Agente
echo.
echo  Iniciando Miar Aria...
echo.

:: Verifica Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
  echo  Instalando Python automaticamente...
  powershell -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe' -OutFile '%TEMP%\\python_setup.exe'"
  %TEMP%\\python_setup.exe /quiet InstallAllUsers=0 PrependPath=1 Include_pip=1
  del %TEMP%\\python_setup.exe
  echo  Python instalado!
)

:: Instala dependencias
pip install websocket-client pyautogui pillow --quiet --disable-pip-version-check >nul 2>&1

:: Inicia o agente
python "%~dp0agent.py"
pause
`;

    // VBS para abrir sem janela preta (opcional)
    const iniciarVbs = `
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c """ & Chr(34) & WScript.ScriptFullName & Chr(34) & """", 0, False
`.trim();

    // Gerar ZIP
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", 'attachment; filename="miar-agente.zip"');

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);
    archive.append(agentPy, { name: "agent.py" });
    archive.append(installerBat, { name: "Iniciar Miar Aria.bat" });
    archive.finalize();
  } catch (err) {
    res.status(500).json({ error: "Erro ao gerar instalador" });
  }
});

export default router;
