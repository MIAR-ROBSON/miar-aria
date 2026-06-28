import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ModeProvider } from "@/context/mode-context";
import { AuthProvider, useAuth } from "@/context/auth-context";
import { LoginPage } from "@/pages/login";
import NotFound from "@/pages/not-found";
import { ChatPage } from "@/pages/chat";
import { SettingsPage } from "@/pages/settings";
import { AgentPage } from "@/pages/agent";
import { PlansPage } from "@/pages/plans";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { MiniChat } from "@/components/mini-chat";

const queryClient = new QueryClient();

function Router() {
  const { isAuthenticated, token, setAuth } = useAuth();

  if (token) {
    setAuthTokenGetter(() => null);
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={(t, r, n) => setAuth(t, r, n)} />;
  }

  return (
    <>
      <Switch>
        <Route path="/" component={ChatPage} />
        <Route path="/c/:id" component={ChatPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/agent" component={AgentPage} />
        <Route path="/plans" component={PlansPage} />
        <Route component={NotFound} />
      </Switch>
      <MiniChat />
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <ModeProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <Router />
            </WouterRouter>
          </ModeProvider>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
