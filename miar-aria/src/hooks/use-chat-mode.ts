import { useState, useCallback } from "react";

export type ChatMode = "normal" | "voice" | "agent" | "reading";

export function useChatMode() {
  const [mode, setMode] = useState<ChatMode>(() => {
    return (localStorage.getItem("miar_chat_mode") as ChatMode) || "normal";
  });

  const changeMode = useCallback((m: ChatMode) => {
    localStorage.setItem("miar_chat_mode", m);
    setMode(m);
  }, []);

  return { mode, changeMode };
}
