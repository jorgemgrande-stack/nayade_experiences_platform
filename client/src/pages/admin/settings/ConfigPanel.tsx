import { useEffect, useState } from "react";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { WorkplaceLocks } from "@/components/connect/WorkplaceLocks";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { configSectionsFor, type SectionDef, type SectionId } from "./configSections";
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
import { useI18n } from "@/i18n/I18nProvider";

// Texto español de configSections.ts → clave del diccionario (las secciones son lógica pura, sin React)
const SECTION_LABEL_KEYS: Record<string, string> = {
  "Información del negocio": "settingsConfig.lab.negocio",
  "Datos fiscales": "settingsConfig.lab.fiscal",
  "Horarios": "settingsConfig.lab.horarios",
  "Emails y notificaciones": "settingsConfig.lab.emails",
  "Pagos y pasarelas": "settingsConfig.lab.pagos",
  "TPV físico": "settingsConfig.lab.tpv",
  "Caja": "settingsConfig.lab.caja",
  "Banco y conciliación": "settingsConfig.lab.banco",
  "Automatizaciones": "settingsConfig.lab.automatizaciones",
  "Integraciones externas": "settingsConfig.lab.integraciones",
  "Branding": "settingsConfig.lab.branding",
  "Avanzado": "settingsConfig.lab.avanzado",
  "Datos de la empresa": "settingsConfig.lab.empresa",
  "Presupuestos y facturas": "settingsConfig.lab.documentos",
  "Cobros online": "settingsConfig.lab.cobros",
  "Datáfono": "settingsConfig.lab.datafono",
  "Recordatorios automáticos": "settingsConfig.lab.recordatorios",
  "Mensajería": "settingsConfig.lab.mensajeria",
  "Marca": "settingsConfig.lab.marca",
};
const SECTION_DESC_KEYS: Record<string, string> = {
  "Nombre, teléfono, dominio y datos de contacto de la empresa.": "settingsConfig.desc.negocio",
  "NIF/CIF, empresa facturadora, dirección fiscal y tipos de IVA.": "settingsConfig.desc.fiscal",
  "Horarios de apertura por temporada y días operativos.": "settingsConfig.desc.horarios",
  "Direcciones de correo para cada tipo de notificación. Vacío = usa la dirección por defecto del sistema.": "settingsConfig.desc.emails",
  "Configuración de Redsys y otras pasarelas de pago.": "settingsConfig.desc.pagos",
  "Punto de venta presencial, datáfono y tolerancias.": "settingsConfig.desc.tpv",
  "Caja registradora, umbrales de alerta y tolerancias de cuadre.": "settingsConfig.desc.caja",
  "Importación de extractos bancarios y tolerancias de conciliación.": "settingsConfig.desc.banco",
  "Jobs automáticos: recordatorios de presupuestos, cancelaciones caducadas y más.": "settingsConfig.desc.automatizaciones",
  "GoHighLevel CRM, IMAP para ingesta de emails del datáfono y otros conectores externos.": "settingsConfig.desc.integraciones",
  "Logotipo, colores, imagen destacada y redes sociales.": "settingsConfig.desc.branding",
  "Feature flags, ajustes técnicos e historial de cambios.": "settingsConfig.desc.avanzado",
  "Nombre comercial, datos fiscales y contacto público. Son los mismos que indicaste en «Primeros pasos».": "settingsConfig.desc.empresa",
  "Direcciones que reciben los avisos de la plataforma. Si dejas una vacía, se usa la dirección general.": "settingsConfig.desc.emailsPyme",
  "Validez de los presupuestos y plazo de pago de las facturas.": "settingsConfig.desc.documentos",
  "Cobro con tarjeta en tu web a través de la pasarela de pago de tu empresa (Redsys).": "settingsConfig.desc.cobros",
  "Tolerancia al cuadrar las operaciones del datáfono.": "settingsConfig.desc.datafono",
  "Cuándo se envían los recordatorios y avisos automáticos.": "settingsConfig.desc.recordatorios",
  "Conexión con la mensajería contratada.": "settingsConfig.desc.mensajeria",
};
const SECTION_LINK_KEYS: Record<string, string> = {
  "Abrir «Datos de la empresa»": "settingsConfig.link.empresa",
  "Conectar la pasarela de pago": "settingsConfig.link.pasarela",
  "Abrir la puesta en marcha de Finance Sync": "settingsConfig.link.financeSync",
  "Abrir las reglas de Automatizaciones": "settingsConfig.link.automatizaciones",
};

// ─── Section Definitions ──────────────────────────────────────────────────────
// Datos y filtrado por plan en ./configSections (lógica pura, con pruebas)

const SECTION_ICONS: Record<SectionId, React.ComponentType<{ className?: string }>> = {
  negocio: Building2, fiscal: Receipt, horarios: Clock, emails: Mail, pagos: CreditCard, tpv: Monitor,
  caja: Wallet, banco: Landmark, automatizaciones: Bot, integraciones: Plug, branding: Palette, avanzado: Settings2,
  empresa: Building2, documentos: Receipt,
};

// ─── Dangerous settings ────────────────────────────────────────────────────────

const DANGEROUS_SETTINGS: Record<string, string> = {
  redsys_environment: "settingsConfig.dangerous.redsys",
};

function DangerousSettingModal({ settingKey, label, newValue, warning, onConfirm, onClose }: {
  settingKey: string;
  label: string;
  newValue: string;
  warning: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
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
            <h3 className="font-semibold text-foreground">{t("settingsConfig.dangerous.title")}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t("settingsConfig.dangerous.youWillSave")}<strong>{label}</strong>{t("settingsConfig.dangerous.withValue")}<code className="text-xs bg-muted px-1 rounded">{newValue}</code>.
            </p>
            <p className="text-sm text-red-600 mt-2">{t(warning)}</p>
          </div>
        </div>
        <div className="mb-4">
          <p className="text-xs text-muted-foreground mb-1.5">{t("settingsConfig.dangerous.typePrefix")}<strong>CONFIRMAR</strong>{t("settingsConfig.dangerous.typeSuffix")}</p>
          <Input
            className="h-8 text-sm font-mono"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            placeholder="CONFIRMAR"
            autoFocus
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={onClose}>{t("settingsConfig.dangerous.cancel")}</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={!canConfirm}>{t("settingsConfig.dangerous.save")}</Button>
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
  const { t } = useI18n();
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
            <h3 className="font-semibold text-foreground">{t("settingsConfig.flagModal.title")}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t("settingsConfig.flagModal.sure")}<strong>{pending.newEnabled ? t("settingsConfig.flagModal.enable") : t("settingsConfig.flagModal.disable")}</strong>{" "}
              <em>{pending.name}</em>{t("settingsConfig.flagModal.impact")}
            </p>
          </div>
        </div>
        {requireTyping && (
          <div className="mb-4">
            <p className="text-xs text-muted-foreground mb-1.5">{t("settingsConfig.dangerous.typePrefix")}<strong>CONFIRMAR</strong>{t("settingsConfig.dangerous.typeSuffix")}</p>
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
          <Button variant="outline" size="sm" onClick={onClose}>{t("settingsConfig.dangerous.cancel")}</Button>
          <Button variant="destructive" size="sm" onClick={onConfirm} disabled={!canConfirm}>{t("settingsConfig.flagModal.confirm")}</Button>
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
  /** Muestra la clave interna y dónde se configuran las credenciales (solo instalación original). */
  technical: boolean;
}

function SettingField({ settingKey, label, description, value, isSensitive, technical }: SettingFieldProps) {
  const { t } = useI18n();
  const [local, setLocal] = useState(value ?? "");
  const [dirty, setDirty] = useState(false);
  const [pendingSave, setPendingSave] = useState(false);
  const isDangerous = settingKey in DANGEROUS_SETTINGS;
  const settingsQ = trpc.config.listSystemSettings.useQuery();
  const updateMut = trpc.config.updateSystemSetting.useMutation({
    onSuccess: () => {
      toast.success(t("settingsConfig.settingSaved", { label }));
      setDirty(false);
      settingsQ.refetch();
    },
    onError: (e) => toast.error(t("settingsConfig.error", { message: e.message })),
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
          {technical && <p className="text-xs font-mono text-muted-foreground/50 mt-0.5">{settingKey}</p>}
        </div>
        <span className="text-xs text-muted-foreground italic shrink-0">{technical ? t("settingsConfig.configureRailway") : t("settingsConfig.managedBySupport")}</span>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4 py-3 border-b border-border/30 last:border-0">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{label}</span>
            {isDangerous && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" title={t("settingsConfig.criticalChangeTitle")} />}
          </div>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
          {technical && <p className="text-xs font-mono text-muted-foreground/50 mt-0.5">{settingKey}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Input
            aria-label={label}
            className="w-full sm:w-52 h-11 sm:h-8 text-sm"
            value={local}
            onChange={(e) => { setLocal(e.target.value); setDirty(true); }}
            placeholder={t("settingsConfig.defaultValue")}
          />
          {dirty && (
            <Button
              size="sm"
              className="h-11 sm:h-8 px-3"
              disabled={updateMut.isPending}
              onClick={handleSave}
              aria-label={t("settingsConfig.saveLabel", { label })}
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
  low: "settingsConfig.risk.low", medium: "settingsConfig.risk.medium", high: "settingsConfig.risk.high",
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
  const { t } = useI18n();
  const risk = RISK_COLORS[riskLevel] ?? RISK_COLORS.low;
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-border/30 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{name}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${risk}`}>
            {t("settingsConfig.risk.text", { level: RISK_LABELS[riskLevel] ? t(RISK_LABELS[riskLevel]) : riskLevel })}
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
  const { t, format } = useI18n();
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
          placeholder={t("settingsConfig.audit.searchKey")}
          value={filterKey}
          onChange={e => setFilterKey(e.target.value)}
          className="h-8 text-xs"
        />
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value as typeof filterType)}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="all">{t("settingsConfig.audit.allTypes")}</option>
          <option value="feature_flag">{t("settingsConfig.audit.typeFlag")}</option>
          <option value="system_setting">{t("settingsConfig.audit.typeSetting")}</option>
        </select>
        <Input
          placeholder={t("settingsConfig.audit.user")}
          value={filterUser}
          onChange={e => setFilterUser(e.target.value)}
          className="h-8 text-xs"
        />
        <Input
          type="date"
          value={dateFrom}
          onChange={e => setDateFrom(e.target.value)}
          className="h-8 text-xs"
          title={t("settingsConfig.audit.from")}
        />
        <Input
          type="date"
          value={dateTo}
          onChange={e => setDateTo(e.target.value)}
          className="h-8 text-xs"
          title={t("settingsConfig.audit.to")}
        />
      </div>
      {hasFilters && (
        <button
          onClick={() => { setFilterKey(""); setFilterType("all"); setFilterUser(""); setDateFrom(""); setDateTo(""); }}
          className="text-xs text-muted-foreground hover:text-foreground underline"
        >
          {t("settingsConfig.audit.clear")}
        </button>
      )}

      {/* Table */}
      {logsQ.isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : !logsQ.data?.length ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          {hasFilters ? t("settingsConfig.audit.noResults") : t("settingsConfig.audit.empty")}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground">{t("settingsConfig.audit.colDate")}</th>
                <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground">{t("settingsConfig.audit.colType")}</th>
                <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground">{t("settingsConfig.audit.colKey")}</th>
                <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground">{t("settingsConfig.audit.colOld")}</th>
                <th className="text-left py-2 pr-4 text-xs font-semibold text-muted-foreground">{t("settingsConfig.audit.colNew")}</th>
                <th className="text-left py-2 text-xs font-semibold text-muted-foreground">{t("settingsConfig.audit.colBy")}</th>
              </tr>
            </thead>
            <tbody>
              {logsQ.data.map(log => (
                <tr key={log.id} className="border-b border-border/30 last:border-0">
                  <td className="py-2 pr-4 text-xs text-muted-foreground whitespace-nowrap">
                    {format.dateTime(log.changedAt, { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                      log.entityType === "feature_flag"
                        ? "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {log.entityType === "feature_flag" ? t("settingsConfig.audit.flag") : t("settingsConfig.audit.setting")}
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
  technical: boolean;
}

function SectionContent({ section, allSettings, allFlags, onRequestFlagChange, isFlagPending, technical }: SectionContentProps) {
  const { t } = useI18n();
  const sectionSettings = allSettings.filter(s => section.settingKeys.includes(s.key));
  const sectionFlags = allFlags.filter(f => section.flagModules.includes(f.module));

  if (section.id === "avanzado") {
    return (
      <div className="space-y-6">
        <div className="flex items-start gap-3 p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl">
          <Shield className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            <strong>{t("settingsConfig.advanced.notice")}</strong>{t("settingsConfig.advanced.noticeText")}
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <a
            href="/admin/configuracion/avanzado"
            className="flex items-center justify-between gap-3 p-4 bg-card border border-border/50 rounded-xl hover:border-border transition-colors"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{t("settingsConfig.advanced.flagsTitle")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("settingsConfig.advanced.flagsText")}</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
          <a
            href="/admin/configuracion/sitio"
            className="flex items-center justify-between gap-3 p-4 bg-card border border-border/50 rounded-xl hover:border-border transition-colors"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{t("settingsConfig.advanced.siteTitle")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("settingsConfig.advanced.siteText")}</p>
            </div>
            <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
          </a>
        </div>

        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-muted/30 border-b border-border/50 flex items-center gap-2">
            <History className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">{t("settingsConfig.advanced.history")}</h3>
          </div>
          <div className="p-5">
            <AuditLog />
          </div>
        </div>
      </div>
    );
  }

  const sectionLink = section.link && (
    <Link
      href={section.link.href}
      className="flex items-center justify-between gap-3 p-4 min-h-11 bg-card border border-border/50 rounded-xl hover:border-border transition-colors"
    >
      <span className="text-sm font-medium text-foreground">{SECTION_LINK_KEYS[section.link.label] ? t(SECTION_LINK_KEYS[section.link.label]) : section.link.label}</span>
      <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
    </Link>
  );
  const envVarHints = technical ? section.envVarHints ?? [] : [];
  const hasContent = sectionSettings.length > 0 || sectionFlags.length > 0 || envVarHints.length > 0;

  if (!hasContent && sectionLink) return sectionLink;

  if (!hasContent) {
    return (
      <div className="bg-muted/20 rounded-xl p-8 text-center">
        <CircleDot className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">{t("settingsConfig.emptySection")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {sectionLink}
      {sectionSettings.length > 0 && (
        <div className="bg-card border border-border/50 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 bg-muted/30 border-b border-border/50">
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{t("settingsConfig.settingsHeading")}</h3>
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
                technical={technical}
              />
            ))}
          </div>
        </div>
      )}

      {envVarHints.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
          <div className="flex gap-3">
            <Shield className="w-4 h-4 text-slate-500 mt-0.5 shrink-0" />
            <div className="text-sm text-slate-700 dark:text-slate-300">
              <p className="font-medium mb-1">{t("settingsConfig.envHints.title")}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                {t("settingsConfig.envHints.text")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {envVarHints.map(v => (
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
            <h3 className="text-sm font-semibold text-foreground uppercase tracking-wide">{t("settingsConfig.flagsHeading")}</h3>
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
  const { t } = useI18n();
  const tx = (text: string, map: Record<string, string>) => (map[text] ? t(map[text]) : text);
  const [activeId, setActiveId] = useState<SectionId>("negocio");
  const [pendingFlag, setPendingFlag] = useState<PendingFlag | null>(null);

  // Empresa con licencias por capacidad: solo lo de su plan y sin ajustes técnicos (en single, todo como siempre)
  const sub = usePanelSubscription();
  const licensed = sub.isLicensed;
  const technical = sub.mode === "legacy";
  const sections = configSectionsFor({ licensed, can: sub.can });
  useEffect(() => {
    if (!sections.some((s) => s.id === activeId)) setActiveId(sections[0].id);
  }, [sections, activeId]);

  const flagsQ = trpc.config.listFeatureFlags.useQuery(undefined, { enabled: technical });
  const settingsQ = trpc.config.listSystemSettings.useQuery();

  const updateFlagMut = trpc.config.updateFeatureFlag.useMutation({
    onSuccess: () => {
      toast.success(t("settingsConfig.flagUpdated"));
      flagsQ.refetch();
      setPendingFlag(null);
    },
    onError: (e) => {
      toast.error(t("settingsConfig.error", { message: e.message }));
      setPendingFlag(null);
    },
  });

  const allSettings = settingsQ.data ?? [];
  const allFlags = technical ? flagsQ.data ?? [] : [];

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

  const activeSection = sections.find(s => s.id === activeId) ?? sections[0];

  const isLoading = sub.mode === "loading" || (technical && flagsQ.isLoading) || settingsQ.isLoading;

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-heading font-bold text-foreground">{t("settingsConfig.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {licensed ? t("settingsConfig.introLicensed") : t("settingsConfig.introLegacy")}
          </p>
        </div>
        <WorkplaceLocks place="admin" className="mb-6" />

        {isLoading && (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && (
          <div className="flex flex-col md:flex-row gap-0 bg-card border border-border/50 rounded-2xl overflow-hidden">
            {/* Selector de sección en móvil */}
            <div className="md:hidden p-3 border-b border-border/50">
              <label htmlFor="config-section" className="sr-only">{t("settingsConfig.section")}</label>
              <select
                id="config-section"
                value={activeSection.id}
                onChange={(e) => setActiveId(e.target.value as SectionId)}
                className="w-full h-11 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>{tx(s.label, SECTION_LABEL_KEYS)}</option>
                ))}
              </select>
            </div>
            {/* Sidebar */}
            <aside aria-label={t("settingsConfig.sectionsAria")} className="hidden md:block w-52 shrink-0 border-r border-border/50 py-3">
              {sections.map(section => {
                const Icon = SECTION_ICONS[section.id];
                const status = computeStatus(section);
                const isActive = section.id === activeId;
                return (
                  <button
                    key={section.id}
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => setActiveId(section.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                      isActive
                        ? "bg-primary/8 text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="text-sm flex-1 truncate">{tx(section.label, SECTION_LABEL_KEYS)}</span>
                    {section.id === "avanzado"
                      ? <Shield className="w-3.5 h-3.5 shrink-0 text-amber-500" title={t("settingsConfig.techOnly")} />
                      : <StatusDot status={status} />
                    }
                  </button>
                );
              })}
            </aside>

            {/* Content */}
            <div className="flex-1 min-w-0 p-4 md:p-6">
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                  {(() => { const Icon = SECTION_ICONS[activeSection.id]; return <Icon className="w-5 h-5 text-muted-foreground" />; })()}
                  <h2 className="text-lg font-semibold text-foreground">{tx(activeSection.label, SECTION_LABEL_KEYS)}</h2>
                </div>
                <p className="text-sm text-muted-foreground">{tx(activeSection.description, SECTION_DESC_KEYS)}</p>
              </div>

              <SectionContent
                section={activeSection}
                allSettings={allSettings as SectionContentProps["allSettings"]}
                allFlags={allFlags as SectionContentProps["allFlags"]}
                onRequestFlagChange={handleFlagChangeRequest}
                isFlagPending={updateFlagMut.isPending}
                technical={technical}
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
