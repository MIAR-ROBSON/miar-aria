import { Layout } from "@/components/layout";
import { useGetSettings, useUpdateSettings, getGetSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ExternalLink, Save, CheckCircle, Eye, EyeOff, Brain, X } from "lucide-react";

type FormData = {
  userEmail: string;
  directives: string;
  audioSpeed: number;
  activeProvider: string;
  activeModel: string;
  groqKeys: string;
  openrouterKeys: string;
  geminiKeys: string;
  mistralKeys: string;
  mem0Key: string;
  silentMode: boolean;
  saveToMemory: boolean;
  groqEnabled: boolean;
  openrouterEnabled: boolean;
  geminiEnabled: boolean;
  mistralEnabled: boolean;
};

export function SettingsPage() {
  const { data: settings, isLoading } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey() }
  });
  const updateSettings = useUpdateSettings();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [saveTimer, setSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Autosave diretivas após 1s
  const handleDirectivesChange = (value: string) => {
    setFormData(f => ({ ...f, directives: value }));
    if (saveTimer) clearTimeout(saveTimer);
    const t = setTimeout(() => {
      updateSettings.mutate({ data: { directives: value } }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() }),
      });
    }, 1000);
    setSaveTimer(t);
  };

  // Salvar chave individual
  const saveKey = (keyName: string, value: string | string[]) => {
    updateSettings.mutate({ data: { [keyName]: value } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        toast({ title: "Salvo!", description: `${keyName} salvo com sucesso.` });
      }
    });
  };

  const [formData, setFormData] = useState<FormData>({
    userEmail: "robson@ia.miarmaktub.com",
    directives: "",
    audioSpeed: 1,
    activeProvider: "groq",
    activeModel: "llama-3.3-70b-versatile",
    groqKeys: "",
    openrouterKeys: "",
    geminiKeys: "",
    mistralKeys: "",
    mem0Key: "",
    silentMode: false,
    saveToMemory: true,
    groqEnabled: true,
    openrouterEnabled: true,
    geminiEnabled: true,
    mistralEnabled: true,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        userEmail: settings.userEmail || "robson@miarmaktub.com",
        directives: settings.directives || "",
        audioSpeed: settings.audioSpeed || 1,
        activeProvider: settings.activeProvider || "groq",
        activeModel: settings.activeModel || "llama-3.3-70b-versatile",
        groqKeys: settings.groqKeys?.join("\n") || "",
        openrouterKeys: settings.openrouterKeys?.join("\n") || "",
        geminiKeys: settings.geminiKeys?.join("\n") || "",
        mistralKeys: settings.mistralKeys?.join("\n") || "",
        mem0Key: settings.mem0Key || "",
        silentMode: settings.silentMode ?? false,
        saveToMemory: settings.saveToMemory ?? true,
        groqEnabled: settings.groqEnabled ?? true,
        openrouterEnabled: settings.openrouterEnabled ?? true,
        geminiEnabled: settings.geminiEnabled ?? true,
        mistralEnabled: settings.mistralEnabled ?? true,
      });
    }
  }, [settings]);

  const parseKeys = (raw: string) =>
    raw.split(/[\n,]+/).map(k => k.trim()).filter(Boolean);

  const saveAndGoBack = useCallback((patch: Partial<Record<string, unknown>>) => {
    updateSettings.mutate(
      { data: patch as Parameters<typeof updateSettings.mutate>[0]["data"] },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          toast({ title: "✓ Salvo!" });
          setTimeout(() => window.history.back(), 800);
        },
        onError: () => {
          toast({ title: "Erro ao salvar", variant: "destructive" });
        },
      }
    );
  }, [updateSettings, queryClient, toast]);

  const saveToggle = useCallback((patch: Partial<FormData>) => {
    setFormData(prev => {
      const next = { ...prev, ...patch };
      updateSettings.mutate(
        {
          data: {
            silentMode: next.silentMode,
            saveToMemory: next.saveToMemory,
            groqEnabled: next.groqEnabled,
            openrouterEnabled: next.openrouterEnabled,
            geminiEnabled: next.geminiEnabled,
            mistralEnabled: next.mistralEnabled,
          }
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
          },
        }
      );
      return next;
    });
  }, [updateSettings, queryClient]);

  if (isLoading) return <Layout><div className="p-8 text-muted-foreground">Carregando...</div></Layout>;

  return (
    <Layout>
      <div className="max-w-2xl mx-auto p-6 md:p-8 space-y-6 pb-16 overflow-y-auto h-full">

        {/* Conta */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h2 className="text-lg font-semibold mb-1">Conta</h2>
          <p className="text-sm text-muted-foreground mb-4">E-mail associado às suas APIs</p>
          <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2.5 text-sm font-mono select-all">
            <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>{formData.userEmail}</span>
          </div>
        </div>

        {/* Preferências */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-5">
          <h2 className="text-lg font-semibold">Preferências</h2>

          <div className="space-y-2">
            <Label>Provedor Ativo</Label>
            <Select value={formData.activeProvider} onValueChange={v => setFormData(f => ({ ...f, activeProvider: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="groq">Groq</SelectItem>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem value="gemini">Gemini</SelectItem>
                <SelectItem value="mistral">Mistral</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Velocidade da Voz</Label>
            <Select value={String(formData.audioSpeed)} onValueChange={v => setFormData(f => ({ ...f, audioSpeed: parseFloat(v) }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0.5">0,5x — Lento</SelectItem>
                <SelectItem value="1">1,0x — Normal</SelectItem>
                <SelectItem value="1.5">1,5x — Rápido</SelectItem>
                <SelectItem value="2">2,0x — Muito rápido</SelectItem>
                <SelectItem value="2.5">2,5x — Acelerado</SelectItem>
                <SelectItem value="3">3,0x — Máximo</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Duplo-clique em qualquer texto no chat para ouvi-lo</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Diretrizes Personalizadas</Label>
              <span className="text-xs text-muted-foreground">salva automaticamente</span>
            </div>
            <div className="max-h-[120px] overflow-y-auto rounded-md border border-border">
              <Textarea
                value={formData.directives}
                onChange={e => handleDirectivesChange(e.target.value)}
                placeholder="Ex: Sempre responda de forma direta e objetiva..."
                className="min-h-[100px] resize-none border-0 focus-visible:ring-0"
              />
            </div>
          </div>

          {/* Toggles — salvam na hora */}
          <div className="space-y-3 pt-1 border-t border-border">
            <ToggleRow
              icon={<Brain className="w-4 h-4 text-violet-500" />}
              label="Salvar na memória"
              description="Miar Ária lembra o que você conversa entre sessões"
              checked={formData.saveToMemory}
              onCheckedChange={v => saveToggle({ saveToMemory: v })}
            />
            <ToggleRow
              label="Modo silencioso"
              description="Recebe feedback mas não responde em voz"
              checked={formData.silentMode}
              onCheckedChange={v => saveToggle({ silentMode: v })}
            />
          </div>

          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              onClick={() =>
                saveAndGoBack({
                  activeProvider: formData.activeProvider,
                  activeModel: formData.activeModel,
                  audioSpeed: formData.audioSpeed,
                  directives: formData.directives,
                })
              }
              disabled={updateSettings.isPending}
              className="gap-2"
            >
              <Save className="w-3.5 h-3.5" />
              Salvar preferências
            </Button>
          </div>
        </div>

        {/* Chaves de API */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Chaves de API</h2>
            <p className="text-xs text-muted-foreground mt-1">O toggle liga/desliga o provedor sem apagar as chaves. Clique no olho para revelar.</p>
          </div>

          <ApiKeyField
            name="Groq"
            url="https://console.groq.com/keys"
            value={formData.groqKeys}
            onChange={v => setFormData(f => ({ ...f, groqKeys: v }))}
            enabled={formData.groqEnabled}
            onToggle={v => saveToggle({ groqEnabled: v })}
          />
          <ApiKeyField
            name="OpenRouter"
            url="https://openrouter.ai/keys"
            value={formData.openrouterKeys}
            onChange={v => setFormData(f => ({ ...f, openrouterKeys: v }))}
            enabled={formData.openrouterEnabled}
            onToggle={v => saveToggle({ openrouterEnabled: v })}
          />
          <ApiKeyField
            name="Gemini"
            url="https://aistudio.google.com/app/apikey"
            value={formData.geminiKeys}
            onChange={v => setFormData(f => ({ ...f, geminiKeys: v }))}
            enabled={formData.geminiEnabled}
            onToggle={v => saveToggle({ geminiEnabled: v })}
          />
          <ApiKeyField
            name="Mistral"
            url="https://console.mistral.ai/api-keys"
            value={formData.mistralKeys}
            onChange={v => setFormData(f => ({ ...f, mistralKeys: v }))}
            enabled={formData.mistralEnabled}
            onToggle={v => saveToggle({ mistralEnabled: v })}
          />
          <ApiKeyField
            name="Mem0"
            url="https://app.mem0.ai"
            value={formData.mem0Key}
            onChange={v => setFormData(f => ({ ...f, mem0Key: v }))}
            single
          />

          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              onClick={() =>
                saveAndGoBack({
                  groqKeys: parseKeys(formData.groqKeys),
                  openrouterKeys: parseKeys(formData.openrouterKeys),
                  geminiKeys: parseKeys(formData.geminiKeys),
                  mistralKeys: parseKeys(formData.mistralKeys),
                  mem0Key: formData.mem0Key || null,
                })
              }
              disabled={updateSettings.isPending}
              className="gap-2"
            >
              <Save className="w-3.5 h-3.5" />
              Salvar chaves
            </Button>
          </div>
        </div>

      </div>
    </Layout>
  );
}

function ToggleRow({
  icon, label, description, checked, onCheckedChange,
}: {
  icon?: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <div className="flex items-center gap-2">
        {icon}
        <div>
          <p className="text-sm font-medium leading-none">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function ApiKeyField({
  name, url, value, onChange, enabled, onToggle, single,
}: {
  name: string;
  url: string;
  value: string;
  onChange: (v: string) => void;
  enabled?: boolean;
  onToggle?: (v: boolean) => void;
  single?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const count = value.split(/[\n,]+/).filter(k => k.trim()).length;
  const hasKeys = count > 0;
  const isDisabled = enabled === false;

  return (
    <div className={`space-y-2 transition-opacity duration-200 ${isDisabled ? "opacity-40" : ""}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label>{name}</Label>
          {hasKeys && !isDisabled && (
            <span className="text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full font-medium">
              {count} chave{count > 1 ? "s" : ""}
            </span>
          )}
          {isDisabled && (
            <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full font-medium">
              desligado
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline flex items-center gap-1">
            Obter <ExternalLink className="w-3 h-3" />
          </a>
          {onToggle !== undefined && (
            <Switch
              checked={enabled ?? true}
              onCheckedChange={onToggle}
              className="scale-90"
            />
          )}
        </div>
      </div>

      <div className="relative">
        <Textarea
          value={visible ? value : (value ? value.replace(/\S/g, "•") : "")}
          onChange={e => {
            if (visible) onChange(e.target.value);
          }}
          onFocus={() => setVisible(true)}
          onBlur={() => setVisible(false)}
          placeholder={single ? "Cole sua chave aqui..." : "Cole cada chave em uma linha separada..."}
          className="font-mono text-xs resize-none pr-9"
          rows={single ? 1 : Math.max(2, count + 1)}
          spellCheck={false}
          disabled={isDisabled}
        />
        {hasKeys && !isDisabled && (
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); setVisible(v => !v); }}
            className="absolute right-2 top-2 text-muted-foreground hover:text-foreground transition-colors"
            tabIndex={-1}
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        )}
      </div>
    </div>
  );
}
