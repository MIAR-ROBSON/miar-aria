import { ReactNode, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  Plus, Settings, MessageSquare, Folder as FolderIcon, Edit2, Trash2,
  Sun, Moon, Menu, X, ChevronRight, ChevronDown, Check, Monitor,
  Mic, BookOpen, MessageCircle, Crown,
} from "lucide-react";
import { TokenCounter } from "./token-counter";
import { useTheme } from "@/hooks/use-theme";
import { useMode } from "@/context/mode-context";
import {
  useListFolders, useListConversations, useCreateConversation,
  useCreateFolder, useDeleteFolder, useUpdateFolder,
  useDeleteConversation,
  getListConversationsQueryKey, getListFoldersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import avatarImage from "@/assets/avatar.png";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function apiPatch(path: string, body: object) {
  return fetch(`${BASE}/api${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CHAT_MODES = [
  { id: "normal" as const, label: "Chat", icon: MessageCircle, title: "Chat normal" },
  { id: "voice" as const, label: "Voz", icon: Mic, title: "Modo voz — fale com a Miar" },
  { id: "agent" as const, label: "Agente", icon: Monitor, title: "Agente de computador" },
  { id: "reading" as const, label: "Leitura", icon: BookOpen, title: "Modo leitura — arquivos e câmera" },
];

export function Layout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { mode, changeMode } = useMode();
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState("free");

  const { data: folders } = useListFolders();
  const { data: conversations } = useListConversations();
  const createConversation = useCreateConversation();
  const createFolder = useCreateFolder();
  const deleteFolder = useDeleteFolder();
  const patchFolder = useUpdateFolder();
  const deleteConversation = useDeleteConversation();

  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set());
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [editingFolder, setEditingFolder] = useState<{ id: number; name: string } | null>(null);
  const [editingConv, setEditingConv] = useState<{ id: number; title: string } | null>(null);

  useEffect(() => { setSidebarOpen(false); }, [location]);

  useEffect(() => {
    fetch(`${BASE}/api/plan`).then(r => r.json()).then((d: any) => setPlan(d.plan ?? "free")).catch(() => {});
  }, []);

  const handleNewChat = () => {
    createConversation.mutate(
      { data: { title: "Nova conversa" } },
      {
        onSuccess: (conv) => {
          queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
          setLocation(`/c/${conv.id}`);
        }
      }
    );
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    createFolder.mutate(
      { data: { name: newFolderName.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() });
          setNewFolderName("");
          setNewFolderMode(false);
        }
      }
    );
  };

  const handleDeleteFolder = (id: number) => {
    if (!confirm("Apagar pasta e todas as conversas dentro?")) return;
    deleteFolder.mutate({ folderId: id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() })
    });
  };

  const handleRenameFolder = (id: number, name: string) => {
    patchFolder.mutate({ folderId: id, data: { name } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListFoldersQueryKey() });
        setEditingFolder(null);
      }
    });
  };

  const handleDeleteConv = (id: number) => {
    if (!confirm("Apagar esta conversa?")) return;
    deleteConversation.mutate({ conversationId: id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
        if (location === `/c/${id}`) setLocation('/');
      }
    });
  };

  const handleRenameConv = async (id: number, title: string) => {
    await apiPatch(`/conversations/${id}`, { title });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
    setEditingConv(null);
  };

  const handleMoveConv = async (convId: number, folderId: number | null) => {
    await apiPatch(`/conversations/${convId}`, { folderId });
    queryClient.invalidateQueries({ queryKey: getListConversationsQueryKey() });
  };

  const toggleFolder = (id: number) =>
    setExpandedFolders(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const handleModeChange = (m: typeof CHAT_MODES[number]["id"]) => {
    if (m === "agent") {
      setLocation("/agent");
      return;
    }
    changeMode(m);
    if (location === "/agent" || location === "/settings" || location === "/plans") {
      setLocation("/");
    }
  };

  const ConvItem = ({ conv, depth = 0 }: { conv: any; depth?: number }) => {
    const isActive = location === `/c/${conv.id}`;
    const isEditing = editingConv?.id === conv.id;
    return (
      <div className={`group relative flex items-center gap-1 px-2 py-1.5 rounded-md text-sm cursor-pointer ${isActive ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/50'}`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}>
        <MessageSquare className="w-3.5 h-3.5 opacity-60 shrink-0" />
        {isEditing && editingConv ? (
          <Input autoFocus className="h-6 text-xs py-0 px-1 flex-1"
            value={editingConv.title}
            onChange={e => setEditingConv({ id: editingConv.id, title: e.target.value })}
            onBlur={() => handleRenameConv(conv.id, editingConv.title)}
            onKeyDown={e => { if (e.key === 'Enter') handleRenameConv(conv.id, editingConv.title); if (e.key === 'Escape') setEditingConv(null); }}
          />
        ) : (
          <span className="truncate flex-1 text-xs" onClick={() => setLocation(`/c/${conv.id}`)}>{conv.title}</span>
        )}
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button onClick={() => setEditingConv({ id: conv.id, title: conv.title })} className="p-0.5 hover:text-primary rounded"><Edit2 className="w-3 h-3" /></button>
          <button onClick={() => handleDeleteConv(conv.id)} className="p-0.5 hover:text-destructive rounded"><Trash2 className="w-3 h-3" /></button>
          {folders && folders.length > 0 && (
            <select className="text-[10px] bg-transparent border border-border rounded px-0.5 cursor-pointer max-w-[60px]"
              defaultValue="" onChange={e => { if (e.target.value !== '') handleMoveConv(conv.id, e.target.value === 'root' ? null : parseInt(e.target.value)); }}
              title="Mover para pasta">
              <option value="">📁</option>
              <option value="root">— Sem pasta</option>
              {folders.map(f => <option key={f.id} value={f.id}>📂 {f.name}</option>)}
            </select>
          )}
        </div>
      </div>
    );
  };

  const rootConvs = conversations?.filter(c => !c.folderId) ?? [];

  return (
    <div className="flex h-[100dvh] w-full bg-background overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/20 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <div className={`fixed md:static inset-y-0 left-0 w-64 bg-sidebar border-r border-sidebar-border z-50 flex flex-col transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        {/* Logo */}
        <div className="p-4 border-b border-sidebar-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-primary">
              <img src={avatarImage} alt="Miar Ária" className="w-full h-full object-cover" />
            </div>
            <span className="font-semibold text-sidebar-foreground">Miar Ária</span>
          </div>
          <Button variant="ghost" size="icon" className="md:hidden h-8 w-8" onClick={() => setSidebarOpen(false)}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Mode selector */}
        <div className="px-3 pt-2 pb-1">
          <div className="grid grid-cols-4 gap-1 bg-sidebar-accent/30 rounded-lg p-1">
            {CHAT_MODES.map((m) => {
              const Icon = m.icon;
              const isActive = m.id === "agent"
                ? location === "/agent"
                : mode === m.id && location !== "/agent";
              return (
                <button
                  key={m.id}
                  onClick={() => handleModeChange(m.id)}
                  title={m.title}
                  className={`flex flex-col items-center gap-0.5 px-1 py-1.5 rounded-md text-[9px] font-medium transition-all ${
                    isActive
                      ? "bg-sidebar text-primary shadow-sm"
                      : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* New Chat */}
        <div className="px-3 pb-2">
          <Button onClick={handleNewChat} className="w-full justify-start gap-2 text-sm h-9">
            <Plus className="w-4 h-4" />
            Nova Conversa
          </Button>
        </div>

        <ScrollArea className="flex-1 px-2">
          <div className="space-y-3 pb-4">
            {rootConvs.length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-sidebar-foreground/40 uppercase tracking-wider mb-1 px-2">Recentes</div>
                {rootConvs.map(c => <ConvItem key={c.id} conv={c} />)}
              </div>
            )}

            {folders?.map(folder => {
              const isExpanded = expandedFolders.has(folder.id);
              const folderConvs = conversations?.filter(c => c.folderId === folder.id) ?? [];
              const isEditingThisFolder = editingFolder?.id === folder.id;
              return (
                <div key={folder.id}>
                  <div className="group flex items-center gap-1 px-2 py-1.5 rounded-md hover:bg-sidebar-accent/50 cursor-pointer">
                    <button onClick={() => toggleFolder(folder.id)} className="shrink-0">
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-primary" /> : <ChevronRight className="w-3.5 h-3.5 text-primary" />}
                    </button>
                    <FolderIcon className="w-3.5 h-3.5 text-primary shrink-0" />
                    {isEditingThisFolder ? (
                      <Input autoFocus className="h-6 text-xs py-0 px-1 flex-1"
                        value={editingFolder.name}
                        onChange={e => setEditingFolder({ ...editingFolder, name: e.target.value })}
                        onBlur={() => handleRenameFolder(folder.id, editingFolder.name)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRenameFolder(folder.id, editingFolder.name); if (e.key === 'Escape') setEditingFolder(null); }}
                      />
                    ) : (
                      <span className="text-sm font-medium text-sidebar-foreground flex-1 truncate" onClick={() => toggleFolder(folder.id)}>{folder.name}</span>
                    )}
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button onClick={() => setEditingFolder({ id: folder.id, name: folder.name })} className="p-0.5 hover:text-primary rounded"><Edit2 className="w-3 h-3" /></button>
                      <button onClick={() => handleDeleteFolder(folder.id)} className="p-0.5 hover:text-destructive rounded"><Trash2 className="w-3 h-3" /></button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="pl-3 border-l border-sidebar-border ml-4 space-y-0.5 mt-0.5">
                      {folderConvs.map(c => <ConvItem key={c.id} conv={c} depth={1} />)}
                      {folderConvs.length === 0 && <div className="text-[10px] text-sidebar-foreground/40 px-2 py-1">Pasta vazia</div>}
                    </div>
                  )}
                </div>
              );
            })}

            {newFolderMode ? (
              <div className="flex items-center gap-1 px-2">
                <Input autoFocus placeholder="Nome da pasta..." className="h-7 text-xs flex-1"
                  value={newFolderName} onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') { setNewFolderMode(false); setNewFolderName(""); } }}
                />
                <button onClick={handleCreateFolder} className="p-1 text-primary hover:bg-primary/10 rounded"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={() => { setNewFolderMode(false); setNewFolderName(""); }} className="p-1 hover:text-destructive rounded"><X className="w-3.5 h-3.5" /></button>
              </div>
            ) : (
              <button onClick={() => setNewFolderMode(true)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/40 rounded-md w-full transition-colors">
                <Plus className="w-3 h-3" />
                Nova pasta
              </button>
            )}
          </div>
        </ScrollArea>

        {/* Bottom actions */}
        <div className="p-3 border-t border-sidebar-border space-y-1">
          {/* Plan badge */}
          <Link href="/plans"
            className="flex items-center gap-2 px-2 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
            <Crown className="w-4 h-4 text-amber-500" />
            <span className="flex-1">Planos</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${plan === "free" ? "bg-muted text-muted-foreground" : plan === "pro" ? "bg-primary/10 text-primary" : "bg-amber-100 text-amber-700"}`}>
              {plan === "free" ? "Grátis" : plan === "pro" ? "Pro" : "Premium"}
            </span>
          </Link>

          <button onClick={toggleTheme} className="flex items-center gap-2 px-2 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent w-full transition-colors">
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            {theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}
          </button>
          <Link href="/settings" className="flex items-center gap-2 px-2 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-accent transition-colors">
            <Settings className="w-4 h-4" />
            Configurações
          </Link>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 h-[100dvh]">
        <header className="h-14 border-b border-border flex items-center px-4 shrink-0 bg-card relative">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" className="md:hidden h-9 w-9" onClick={() => setSidebarOpen(true)}>
              <Menu className="w-5 h-5" />
            </Button>
            <div className="font-medium text-card-foreground text-sm hidden sm:block">
              {location === "/settings" ? "Configurações"
                : location === "/agent" ? "Agente de Computador"
                : location === "/plans" ? "Planos"
                : mode === "voice" ? "Modo Voz"
                : mode === "reading" ? "Modo Leitura"
                : "Chat"}
            </div>
          </div>
          <div className="absolute left-1/2 -translate-x-1/2">
            <TokenCounter />
          </div>
          <div className="ml-auto">
            <div className="w-9" />
          </div>
        </header>
        <main className="flex-1 relative overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
