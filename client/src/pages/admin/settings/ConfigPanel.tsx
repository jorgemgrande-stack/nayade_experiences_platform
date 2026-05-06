import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle, Building2, Receipt, Mail, CreditCard,
  Monitor, Wallet, Landmark, Bot, Plug, Palette, Settings2,
  Shield, Save, Loader2, Check, ExternalLink, History,
  CircleDot, Clock,
} from "lucide-react";

// ─── Section Definitions ──────────────────────────────────────────────────────

type SectionId =
  | "negocio" | "fiscal" | "horarios" | "emails" | "pagos" | "tpv"
  | "caja" | "banco" | "automatizaciones" | "integraciones" | "branding" | "avanzado";

interface SectionDef {
  id: SectionId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
  settingKeys: string[];
  flagModules: string[];
  requiredKeys: string[];
  envVarHints?: string[];
}

const SECTIONS: SectionDef[] = [
  {
    id: "negocio",
    label: "Información del negocio",
    icon: Building2,
    description: "Nombre, teléfono, dominio y datos de contacto de la empresa.",
    settingKeys: ["brand_name", "brand_short_name", "brand_phone", "brand_support_phone", "brand_domain", "brand_website_url", "brand_location", "site_business_email", "site_business_description"],
    flagModules: [],
    requiredKeys: ["brand_name"],
  },
  {
    id: "fiscal",
    label: "Datos fiscales",
    icon: Receipt,
    description: "NIF/CIF, empresa facturadora, dirección fiscal y tipos de IVA.",
    settingKeys: ["site_legal_name", "brand_nif", "site_legal_phone", "brand_address", "site_legal_zip", "site_legal_city", "site_legal_province", "site_legal_email", "site_legal_iban", "tax_rate_general", "tax_rate_reduced"],
    flagModules: [],
    requiredKeys: ["brand_nif", "brand_address"],
  },
  {
    id: "horarios",
    label: "Horarios",
    icon: Clock,
    description: "Horarios de apertura por temporada y días operativos.",
    settingKeys: ["site_schedule_high_open", "site_schedule_high_close", "site_schedule_low_open", "site_schedule_low_close", "site_schedule_days"],
    flagModules: [],
    requiredKeys: [],
  },
  {
    id: "emails",
    label: "Emails y notificaciones",
    icon: Mail,
    description: "Direcciones de correo para cada tipo de notificación. Vacío = usa la dirección por defecto del sistema.",
    settingKeys: ["email_reservations", "email_admin_alerts", "email_accounting", "email_cancellations", "email_tpv_ingestion", "email_noreply_sender", "email_copy_recipient", "site_notif_email_restaurant"],
    flagModules: [],
    requiredKeys: [],
  },
  {
    id: "pagos",
    label: "Pagos y pasarelas",
    icon: CreditCard,
    description: "Configuración de Redsys y otras pasarelas de pago.",
    settingKeys: ["redsys_environment", "redsys_currency", "site_payment_currency", "site_payment_deposit_restaurant"],
    flagModules: [],
    requiredKeys: [],
    envVarHints: ["REDSYS_MERCHANT_CODE", "REDSYS_SECRET_KEY", "REDSYS_TERMINAL"],
  },
  {
    id: "tpv",
    label: "TPV físico",
    icon: Monitor,
    description: "Punto de venta presencial, datáfono y tolerancias.",
    settingKeys: ["card_terminal_tolerance"],
    flagModules: ["tpv", "card_terminal"],
    requiredKeys: [],
  },
  {
    id: "caja",
    label: "Caja",
    icon: Wallet,
    description: "Caja registradora, umbrales de alerta y tolerancias de cuadre.",
    settingKeys: ["cash_register_tolerance", "cash_alert_threshold"],
    flagModules: ["cash_register"],
    requiredKeys: [],
  },
  {
    id: "banco",
    label: "Banco y conciliación",
    icon: Landmark,
    description: "Importación de extractos bancarios y tolerancias de conciliación.",
    settingKeys: ["bank_match_tolerance", "card_batch_tolerance", "expense_bank_match_tolerance"],
    flagModules: ["bank"],
    requiredKeys: [],
  },
  {
    id: "automatizaciones",
    label: "Automatizaciones",
    icon: Bot,
    description: "Jobs automáticos: recordatorios de presupuestos, cancelaciones caducadas y más.",
    settingKeys: ["cancellation_stale_days", "quote_reminder_days_before", "quote_validity_days", "invoice_due_days"],
    flagModules: ["crm", "cancellations"],
    requiredKeys: [],
  },
  {
    id: "integraciones",
    label: "Integraciones externas",
    icon: Plug,
    description: "GoHighLevel CRM, IMAP para ingesta de emails del datáfono y otros conectores externos.",
    settingKeys: ["site_ghl_api_key", "site_ghl_location_id"],
    flagModules: ["email_ingestion", "commercial_email"],
    requiredKeys: [],
  },
  {
    id: "branding",
    label: "Branding",
    icon: Palette,
    description: "Logotipo, colores, imagen destacada y redes sociales.",
    settingKeys: ["brand_logo_url", "brand_hero_image_url", "brand_primary_color", "brand_accent_color", "brand_instagram"],
    flagModules: [],
    requiredKeys: [],
  },
  {
    id: "avanzado",
    label: "Avanzado",
    icon: Settings2,
    description: "Feature flags, ajustes técnicos e historial de cambios.",
    settingKeys: [],
    flagModules: [],
    requiredKeys: [],
  },
];

// ─── Dangerous settings ────────────────────────────────────────────────────────

const DANGEROUS_SETTINGS: Record<string, string> = {
  redsys_environment: "Cambiar el entorno de Redsys afecta los cobros en tiempo real. En modo producción los pagos son reales e irreversibles.",
};

function DangerousSettingModal({ settingKey, label, newValue, warning, onConfirm, onClose }: {
  settingKey: string;
  label: string;
  newValue: string;
  warning: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const canConfirm = typed === "CONFIRMAR";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-lg shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Cambio crítico</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Vas a guardar <strong>{label}</strong> con valor <code className="text-xs bg-muted px-1 rounded">{newValue}</code>.
            </p>
            <p className="text-sm text-red-600 mt-2">{warning}</p>
          </div>
        </div>
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-1.5">Escribe <strong>CONFIRMAR</strong> para continuar:</p>
          <Input
            className="h-8 text-sm font-mono"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder="CONFIRMAR"
            autoFocus
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={!canConfirm}>Guardar</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Confirmation Modal (feature flags) ──────────────────────────────────────

interface PendingFlag {
  key: string;
  name: string;
  newEnabled: boolean;
  riskLevel: string;
}

function ConfirmModal({ pending, onConfirm, onClose }: {
  pending: PendingFlag;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const requireTyping = pending.riskLevel === "high" && !pending.newEnabled;
  const canConfirm = !requireTyping || typed === "CONFIRMAR";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-lg shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Cambio de alto riesgo</h3>
            <p className="text-sm text-muted-foreground mt-1">
              ¿Seguro que quieres <strong>{pending.newEnabled ? "activar" : "desactivar"}</strong>{" "}
              <em>{pending.name}</em>? Este flag tiene impacto en producción.
            </p>
          </div>
        </div>
        {requireTyping && (
          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-1.5">Escribe <strong>CONFIRMAR</strong> para continuar:</p>
            <Input
              className="h-8 text-sm font-mono"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder="CONFIRMAR"
              autoFocus
            />
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={!canConfirm}>Confirmar</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Setting Field ─────────────────────────────────────────────────────────────

interface SettingFieldProps {
  settingKey: string;
  label: string;
  description: string | null;
  value: string | null;
  isSensitive: boolean;
}

function SettingField({ settingKey, label, description, value, isSensitive }: SettingFieldProps) {
  const [local, setLocal] = useState(value ?? "");
  const [dirty, setDirty] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const isDangerous = settingKey in DANGEROUS_SETTINGS;
  const settingsQ = trpc.config.listSystemSettings.useQuery();
  const updateMut = trpc.config.updateSystemSetting.useMutation({
    onSuccess: () => {
      toast.success(`"${label}" guardado`);
      setDirty(false);
      settingsQ.refetch();
    },
    onError: (e) => toast.error("Error: " + e.message),
  });

  function handleSave() {
    if (isDangerous) {
      setPendingSave(true);
    } else {
      updateMut.mutate({ key: settingKey, value: local });
    }
  }

  if (isSensitive) {
    return (
      <div className="flex items-center justify-between gap-4 py-3 border-b border-border/30 last:border-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{label}</span>
            <Shield className="w-3.5 h-3.5 text-muted-foreground/60" />
          </div>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          <p className="text-xs font-mono text-muted-foreground/50 mt-0.5">{settingKey}</p>
        </div>
        <span className="text-xs text-muted-foreground italic shrink-0">Configurar en Railway</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 py-3 border-b border-border/30 last:border-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{label}</span>
            {isDangerous && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" title="Cambio crítico — requiere confirmación" />}
          </div>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          <p className="text-xs font-mono text-muted-foreground/50 mt-0.5">{settingKey}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Input
            className="w-52 h-8 text-sm"
            value={local}
            onChange={(e) => { setLocal(e.target.value); setDirty(true); }}
            placeholder="(valor por defecto)"
          />
          {dirty && (
            <Button
              size="sm"
              className="h-8 px-3"
              disabled={updateMut.isPending}
              onClick={handleSave}
            >
              {updateMut.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            </Button>
          )}
        </div>
      </div>
      {pendingSave && (
        <DangerousSettingModal
          settingKey={settingKey}
          label={label}
          newValue={local}
          warning={DANGEROUS_SETTINGS[settingKey]}
          onConfirm={() => { setPendingSave(false); updateMut.mutate({ key: settingKey, value: local }); }}
          onClose={() => setPendingSave(false)}
        />
      )}
    </>
  );
}

// ─── Flag Toggle ───────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  low:    "bg-emerald-100 text-emerald-700",
  medium: "bg-amber-100 text-amber-700",
  high:   "bg-red-100 text-red-700",
};
const RISK_LABELS: Record<string, string> = {
  low: "Bajo", medium: "Medio", high: "Alto",
};

interface FlagRowProps {
  flagKey: string;
  name: string;
  description: string | null;
  enabled: boolean;
  riskLevel: string;
  onRequestChange: (key: string, name: string, newEnabled: boolean) => void;
  isPending: boolean;
}

function FlagRow({ flagKey, name, description, enabled, riskLevel, onRequestChange, isPending }: FlagRowProps) {
  const risk = RISK_COLORS[riskLevel] ?? RISK_COLORS.low;
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border/30 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{name}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${risk}`}>
            Riesgo {RISK_LABELS[riskLevel] ?? riskLevel}
          </span>
        </div>
        {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        <p className="text-xs font-mono text-muted-foreground/50 mt-0.5">{flagKey}</p>
      </div>
      <Switch
        checked={enabled}
        disabled={isPending}
        onCheckedChange={(checked) => onRequestChange(flagKey, name, checked)}
      />
    </div>
  );
}

// ─── Status dot ───────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: "ok" | "warning" | "neutral" }) {
  if (status === "ok") return <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />;
  if (status === "warning") return <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />;
  return <span className="w-2 h-2 rounded-full bg-border shrink-0" />;
}

// ─── Audit Log ────────────────────────────────────────────────────────────────

function AuditLog() {
  const [filterKey,  setFilterKey]  = useState("");
  const [filterType, setFilterType] = useState<"all" | "feature_flag" | "system_setting">("all");
  const [filterUser, setFilterUser] = useState("");
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");

  const logsQ = trpc.config.listChangeLogs.useQuery({
    limit: 100,
    ...(filterKey.trim()            && { key: filterKey.trim() }),
    ...(filterType !== "all"        && { entityType: filterType }),
    ...(filterUser.trim()           && { changedByName: filterUser.trim() }),
    ...(dateFrom                    && { dateFrom }),
    ...(dateTo                      && { dateTo }),
  });

  const hasFilters = filterKey || filterType !== "all" || filterUser || dateFrom || dateTo;

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <Input
          placeholder="Buscar clave…"
          value={filterKey}
          onChange={e => setFilterKey(e.target.value)}
          className="h-8 text-xs"
        />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value as typeof filterType)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">Todos los tipos</option>
          <option value="feature_flag">Feature flag</option>
          <option value="system_setting">Setting</option>
        </select>
        <Input
          placeholder="Usuario…"
          value={filterUser}
          onChange={e => setFilterUser(e.target.value)}
          className="h-8 text-xs"
        />
        <Input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="h-8 text-xs"
          title="Desde"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="h-8 text-xs"
          title="Hasta"
        />
      </div>
      {hasFilters && (
        <button
          onClick={() => { setFilterKey(""); setFilterType("all"); setFilterUser(""); setDateFrom(""); setDateTo(""); }}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          Limpiar filtros
        </button>
      )}

      {/* Table */}
      {logsQ.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : !logsQ.data?.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {hasFilters ? "No hay resultados para los filtros aplicados." : "No hay cambios registrados todavía."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground">Fecha</th>
                <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground">Tipo</th>
                <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground">Clave</th>
                <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground">Anterior</th>
                <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground">Nuevo</th>
                <th className="text-left py-2 text-xs font-semibold text-muted-foreground">Por</th>
              </tr>
            </thead>
            <tbody>
              {logsQ.data.map(log => (
                <tr key={log.id} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.changedAt).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      log.entityType === "feature_flag"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {log.entityType === "feature_flag" ? "flag" : "setting"}
                    </span>
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">{log.key}</td>
                  <td className="py-2 pr-4 text-xs text-muted-foreground max-w-[120px] truncate">{log.oldValue ?? "—"}</td>
                  <td className="py-2 pr-4 text-xs max-w-[120px] truncate">{log.newValue ?? "—"}</td>
                  <td className="py-2 text-xs text-muted-foreground">{log.changedByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Section Content ──────────────────────────────────────────────────────────

interface SectionContentProps {
  section: SectionDef;
  allSettings: Array<{
    id: number; key: string; label: string; description: string | null;
    value: string | null; isSensitive: boolean; valueType: string;
  }>;
  allFlags: Array<{
    key: string; name: string; description: string | null;
    enabled: boolean; riskLevel: string; module: string;
  }>;
  onRequestFlagChange: (key: string, name: string, newEnabled: boolean) => void;
  isFlagPending: boolean;
}

function SectionContent({ section, allSettings, allFlags, onRequestFlagChange, isFlagPending }: SectionContentProps) {
  const sectionSettings = allSettings.filter(s => section.settingKeys.includes(s.key));
  const sectionFlags = allFlags.filter(f => section.flagModules.includes(f.module));

  if (section.id === "avanzado") {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
          <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <strong>Solo administradores técnicos.</strong> Los cambios en esta sección pueden afectar el funcionamiento del sistema en producción.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href="/admin/configuracion/avanzado"
            className="flex items-center justify-between gap-3 p-4 bg-card border border-border/50 rounded-xl hover:border-border transition-colors"
          >
            <div>
              <p className="text-sm font-medium text-foreground">Feature Flags y ajustes técnicos</p>
              <p className="text-xs text-muted-foreground mt-0.5">Vista técnica completa con todos los flags y settings</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
          <a
            href="/admin/configuracion/sitio"
            className="flex items-center justify-between gap-3 p-4 bg-card border border-border/50 rounded-xl hover:border-border transition-colors"
          >
            <div>
              <p className="text-sm font-medium text-foreground">Datos del negocio</p>
              <p className="text-xs text-muted-foreground mt-0.5">Textos, imágenes y contenido CMS de la web pública</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
        </div>

        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-muted/30 border-b border-border/50 flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">Historial de cambios</h3>
          </div>
          <div className="p-5">
            <AuditLog />
          </div>
        </div>
      </div>
    );
  }

  const hasContent = sectionSettings.length > 0 || sectionFlags.length > 0 || (section.envVarHints?.length ?? 0) > 0;

  if (!hasContent) {
    return (
      <div className="bg-muted/20 rounded-xl p-8 text-center">
        <CircleDot className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">No hay ajustes configurables en esta sección todavía.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sectionSettings.length > 0 && (
        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-muted/30 border-b border-border/50">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Ajustes</h3>
          </div>
          <div className="px-5">
            {sectionSettings.map(s => (
              <SettingField
                key={s.key}
                settingKey={s.key}
                label={s.label}
                description={s.description ?? null}
                value={s.value ?? null}
                isSensitive={s.isSensitive}
              />
            ))}
          </div>
        </div>
      )}

      {section.envVarHints && section.envVarHints.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex gap-3">
            <Shield className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
            <div className="text-sm text-slate-700 dark:text-slate-300">
              <p className="font-medium mb-1">Variables confidenciales en Railway</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Estos valores contienen credenciales y deben configurarse como variables de entorno:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {section.envVarHints.map(v => (
                  <code key={v} className="text-xs bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded font-mono">{v}</code>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {sectionFlags.length > 0 && (
        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-muted/30 border-b border-border/50 flex items-center gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">Feature Flags</h3>
          </div>
          <div className="px-5">
            {sectionFlags.map(f => (
              <FlagRow
                key={f.key}
                flagKey={f.key}
                name={f.name}
                description={f.description ?? null}
                enabled={f.enabled}
                riskLevel={f.riskLevel}
                onRequestChange={onRequestFlagChange}
                isPending={isFlagPending}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ConfigPanel() {
  const [activeId, setActiveId] = useState<SectionId>("negocio");
  const [pendingFlag, setPendingFlag] = useState<PendingFlag | null>(null);

  const flagsQ = trpc.config.listFeatureFlags.useQuery();
  const settingsQ = trpc.config.listSystemSettings.useQuery();

  const updateFlagMut = trpc.config.updateFeatureFlag.useMutation({
    onSuccess: () => {
      toast.success("Flag actualizado");
      flagsQ.refetch();
      setPendingFlag(null);
    },
    onError: (e) => {
      toast.error("Error: " + e.message);
      setPendingFlag(null);
    },
  });

  const allSettings = settingsQ.data ?? [];
  const allFlags = flagsQ.data ?? [];

  function computeStatus(section: SectionDef): "ok" | "warning" | "neutral" {
    if (section.id === "avanzado") return "neutral";
    if (section.requiredKeys.length === 0) return "ok";
    const hasAllRequired = section.requiredKeys.every(k => {
      const s = allSettings.find(s => s.key === k);
      return s && s.value && s.value.trim() !== "";
    });
    return hasAllRequired ? "ok" : "warning";
  }

  function handleFlagChangeRequest(key: string, name: string, newEnabled: boolean) {
    const flag = allFlags.find(f => f.key === key);
    if (flag?.riskLevel === "high") {
      setPendingFlag({ key, name, newEnabled, riskLevel: flag.riskLevel });
    } else {
      updateFlagMut.mutate({ key, enabled: newEnabled });
    }
  }

  const activeSection = SECTIONS.find(s => s.id === activeId)!;

  const isLoading = flagsQ.isLoading || settingsQ.isLoading;

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-heading font-bold text-foreground">Configuración</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Gestiona los ajustes del negocio, notificaciones, módulos y más.
          </p>
        </div>

        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (
          <div className="flex gap-0 bg-card border border-border/50 rounded-2xl overflow-hidden">
            {/* Sidebar */}
            <aside className="w-52 shrink-0 border-r border-border/50 py-3">
              {SECTIONS.map(section => {
                const Icon = section.icon;
                const status = computeStatus(section);
                const isActive = section.id === activeId;
                return (
                  <button
                    key={section.id}
                    onClick={() => setActiveId(section.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                      isActive
                        ? "bg-primary/8 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="text-sm flex-1 truncate">{section.label}</span>
                    {section.id === "avanzado"
                      ? <Shield className="w-3.5 h-3.5 shrink-0 text-amber-500" title="Solo administradores técnicos" />
                      : <StatusDot status={status} />
                    }
                  </button>
                );
              })}
            </aside>

            {/* Content */}
            <div className="flex-1 min-w-0 p-6">
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                  {(() => { const Icon = activeSection.icon; return <Icon className="w-5 h-5 text-muted-foreground" />; })()}
                  <h2 className="text-lg font-semibold text-foreground">{activeSection.label}</h2>
                </div>
                <p className="text-sm text-muted-foreground">{activeSection.description}</p>
              </div>

              <SectionContent
                section={activeSection}
                allSettings={allSettings as SectionContentProps["allSettings"]}
                allFlags={allFlags as SectionContentProps["allFlags"]}
                onRequestFlagChange={handleFlagChangeRequest}
                isFlagPending={updateFlagMut.isPending}
              />
            </div>
          </div>
        )}
      </div>

      {pendingFlag && (
        <ConfirmModal
          pending={pendingFlag}
          onConfirm={() => updateFlagMut.mutate({ key: pendingFlag.key, enabled: pendingFlag.newEnabled })}
          onClose={() => setPendingFlag(null)}
        />
      )}
    </AdminLayout>
  );
}
