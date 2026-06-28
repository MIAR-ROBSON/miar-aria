import { createContext, useContext, ReactNode } from "react";
import { ChatMode, useChatMode } from "@/hooks/use-chat-mode";

interface ModeContextValue {
  mode: ChatMode;
  changeMode: (m: ChatMode) => void;
}

const ModeContext = createContext<ModeContextValue>({
  mode: "normal",
  changeMode: () => {},
});

export function ModeProvider({ children }: { children: ReactNode }) {
  const { mode, changeMode } = useChatMode();
  return <ModeContext.Provider value={{ mode, changeMode }}>{children}</ModeContext.Provider>;
}

export function useMode() {
  return useContext(ModeContext);
}
