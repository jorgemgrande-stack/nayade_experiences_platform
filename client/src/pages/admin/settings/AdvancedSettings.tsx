import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, AlertTriangle, Shield, Zap } from "lucide-react";

// ─── Feature Flags ────────────────────────────────────────────────────────────

const RISK_META: Record<string, { label: string; color: string }> = {
  low:    { label: "Bajo",  color: "bg-emerald-100 text-emerald-700" },
  medium: { label: "Medio", color: "bg-amber-100 text-amber-700" },
  high:   { label: "Alto",  color: "bg-red-100 text-red-700" },
};

function FeatureFlagsTab() {
  const flagsQ = trpc.config.listFeatureFlags.useQuery();
  const updateMut = trpc.config.updateFeatureFlag.useMutation({
    onSuccess: () => { toast.success("Flag actualizado"); flagsQ.refetch(); },
    onError: (e) => toast.error("Error: " + e.message),
  });

  const flags = flagsQ.data ?? [];
  const modules = Array.from(new Set(flags.map(f => f.module))).sort();

  return (
    <div className="space-y-6">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="text-sm text-amber-800">
          <span className="font-semibold">Precaución:</span> Desactivar un flag puede interrumpir funcionalidades en producción. Los cambios son inmediatos.
        </div>
      </div>

      {flagsQ.isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {modules.map(module => {
        const moduleFlags = flags.filter(f => f.module === module);
        return (
          <div key={module} className="bg-card border border-border/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 bg-muted/30 border-b border-border/50">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{module.replace(/_/g, " ")}</h3>
            </div>
            <div className="divide-y divide-border/30">
              {moduleFlags.map(flag => {
                const risk = RISK_META[flag.riskLevel] ?? RISK_META.low;
                const isUpdating = updateMut.isPending;
                return (
                  <div key={flag.key} className="flex items-center justify-between gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{flag.name}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${risk.color}`}>
                          Riesgo {risk.label}
                        </span>
                        {!flag.defaultEnabled && (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            Off por defecto
                          </span>
                        )}
                      </div>
                      {flag.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{flag.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground/60 font-mono mt-0.5">{flag.key}</p>
                    </div>
                    <Switch
                      checked={flag.enabled}
                      disabled={isUpdating}
                      onCheckedChange={(checked) => updateMut.mutate({ key: flag.key, enabled: checked })}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── System Settings ──────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  email:      "Correos electrónicos",
  finance:    "Finanzas y tolerancias",
  branding:   "Marca y empresa",
  operations: "Operaciones",
  imap:       "Configuración IMAP",
  payments:   "Pagos",
  app:        "Aplicación",
};

interface SettingRowProps {
  id: number;
  settingKey: string;
  label: string;
  description: string | null;
  value: string | null;
  isSensitive: boolean;
}

function SettingRow({ settingKey, label, description, value, isSensitive }: SettingRowProps) {
  const [localValue, setLocalValue] = useState(value ?? "");
  const [dirty, setDirty] = useState(false);
  const updateMut = trpc.config.updateSystemSetting.useMutation({
    onSuccess: () => { toast.success(`"${label}" guardado`); setDirty(false); },
    onError: (e) => toast.error("Error: " + e.message),
  });

  if (isSensitive) {
    return (
      <div className="flex items-center justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <Shield className="w-3.5 h-3.5 text-muted-foreground" />
          </div>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          <p className="text-xs text-muted-foreground/60 font-mono mt-0.5">{settingKey}</p>
        </div>
        <span className="text-xs text-muted-foreground italic">Solo por variable de entorno</span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0 flex-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        <p className="text-xs text-muted-foreground/60 font-mono mt-0.5">{settingKey}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Input
          className="w-56 h-8 text-sm"
          value={localValue}
          onChange={(e) => { setLocalValue(e.target.value); setDirty(true); }}
          placeholder="(usa valor por defecto)"
        />
        {dirty && (
          <Button
            size="sm"
            variant="default"
            className="h-8 px-3"
            disabled={updateMut.isPending}
            onClick={() => updateMut.mutate({ key: settingKey, value: localValue })}
          >
            {updateMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          </Button>
        )}
      </div>
    </div>
  );
}

function SystemSettingsTab() {
  const settingsQ = trpc.config.listSystemSettings.useQuery();
  const settings = settingsQ.data ?? [];
  const categories = Array.from(new Set(settings.map(s => s.category))).sort();

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <Zap className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          Los ajustes vacíos usan los valores por defecto del sistema. Los cambios se aplican en un máximo de 60 segundos (caché).
        </div>
      </div>

      {settingsQ.isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {categories.map(cat => {
        const catSettings = settings.filter(s => s.category === cat);
        return (
          <div key={cat} className="bg-card border border-border/50 rounded-2xl overflow-hidden">
            <div className="px-5 py-3 bg-muted/30 border-b border-border/50">
              <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">
                {CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ")}
              </h3>
            </div>
            <div className="divide-y divide-border/30">
              {catSettings.map(s => (
                <SettingRow
                  key={s.key}
                  id={s.id}
                  settingKey={s.key}
                  label={s.label}
                  description={s.description ?? null}
                  value={s.value ?? null}
                  isSensitive={s.isSensitive}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = "flags" | "settings";

export default function AdvancedSettings() {
  const [tab, setTab] = useState<Tab>("flags");

  return (
    <AdminLayout>
      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-heading font-bold text-foreground">Configuración avanzada</h1>
          <p className="text-sm text-muted-foreground mt-1">Feature flags y ajustes de sistema. Solo administradores.</p>
        </div>

        <div className="flex gap-1 bg-muted/40 p-1 rounded-xl w-fit">
          {(["flags", "settings"] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === t
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "flags" ? "Feature Flags" : "Ajustes de sistema"}
            </button>
          ))}
        </div>

        {tab === "flags" ? <FeatureFlagsTab /> : <SystemSettingsTab />}
      </div>
    </AdminLayout>
  );
}
