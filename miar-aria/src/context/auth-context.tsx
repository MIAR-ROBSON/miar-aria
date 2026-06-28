import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type UserRole = "owner" | "tester" | null;

interface AuthState {
  token: string | null;
  role: UserRole;
  name: string;
  isOwner: boolean;
  isAuthenticated: boolean;
  logout: () => void;
  setAuth: (token: string, role: UserRole, name: string) => void;
}

const AuthContext = createContext<AuthState>({
  token: null, role: null, name: "", isOwner: false, isAuthenticated: false,
  logout: () => {}, setAuth: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("miar_token"));
  const [role, setRole] = useState<UserRole>(() => (localStorage.getItem("miar_role") as UserRole) ?? null);
  const [name, setName] = useState(() => localStorage.getItem("miar_name") ?? "");

  // Valida sessão ao carregar
  useEffect(() => {
    if (!token) return;
    const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${BASE}/api/auth/me`, { headers: { "x-session-token": token } })
      .then(r => { if (!r.ok) logout(); })
      .catch(() => logout());
  }, []);

  const setAuth = (t: string, r: UserRole, n: string) => {
    setToken(t); setRole(r); setName(n);
  };

  const logout = () => {
    const BASE = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    if (token) {
      fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { "x-session-token": token } }).catch(() => {});
    }
    localStorage.removeItem("miar_token");
    localStorage.removeItem("miar_role");
    localStorage.removeItem("miar_name");
    setToken(null); setRole(null); setName("");
  };

  return (
    <AuthContext.Provider value={{
      token, role, name,
      isOwner: role === "owner",
      isAuthenticated: !!token,
      logout, setAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
