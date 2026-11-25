import { useState } from "react";
import { Cog, Info, ShieldCheck, ToggleLeft } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";

interface CronCard {
  id: string;
  name: string;
  file: string;
  schedule: string;
  scheduleHuman: string;
  featureFlag: string | null;
  status: "active_no_flag" | "active_with_flag" | "superseded";
  statusLabel: string;
  condition: string;
  maxPerRun: number | null;
  maxPerQuote: number | null;
  templates: string[];
  recipient: "client" | "admin" | "both";
  subject: string;
  recommendation: string;
  recommendationType: "keep" | "migrate" | "deprecate";
  details: { label: string; value: string }[];
}

const CRONS: CronCard[] = [
  {
    id: "email_automation_job",
    name: "emailAutomationJob",
    file: "server/emailAutomationJob.ts",
    schedule: "*/10 * * * *",
    scheduleHuman: "Cada 10 minutos",
    featureFlag: "email_automation_job_enabled",
    status: "active_with_flag",
    statusLabel: "Activo con feature flag — controlado",
    condition:
      "Jobs en email_scheduled_jobs con status='pending' y scheduledFor <= NOW(). Los jobs se crean automáticamente cuando sendManagedEmail() envía con éxito y hay reglas activas para esa plantilla.",
    maxPerRun: 50,
    maxPerQuote: null,
    templates: ["Configurable por regla — emailSubject / emailBody en email_automation_rules"],
    recipient: "client",
    subject: "Configurable por regla de automatización (campo emailSubject)",
    recommendation:
      "Motor genérico de automatización. NO usar para seguimiento de presupuestos — eso lo gestiona commercialFollowupJob. Usar para plantillas sin cron propio: post-reserva, post-pago, bienvenida, etc. El bloqueo anti-duplicado para 'quote' es automático en emailManager.",
    recommendationType: "keep",
    details: [
      { label: "Feature flag", value: "email_automation_job_enabled (desactivado por defecto)" },
      { label: "Anti-duplicado", value: "lockedAt + maxSendsPerEntity + LEGACY_CRON_TEMPLATES guard" },
      { label: "Ventana horaria", value: "allowedSendStart – allowedSendEnd por regla (Europe/Madrid)" },
      { label: "Condiciones de parada", value: "stopIfPaid, stopIfConverted, automationsPaused" },
      { label: "Registro", value: "email_comm_log (isAutomatic=true, ruleId)" },
      { label: "CC", value: "GLOBAL_CC_EMAIL vía mergeGlobalCc en mailer.ts (dirección de copia configurada)" },
    ],
  },
  // quoteReminderJob y commercialFollowupJob eliminados en Fase 5.
  // Toda la lógica de recordatorios de presupuestos vive ahora en emailAutomationJob,
  // que aparece arriba con sus reglas comerciales (respectCommercialPause=true).
  {
    id: "cancellation_stale",
    name: "cancellationStaleJob",
    file: "server/cancellationStaleJob.ts",
    schedule: "0 8,14,20,2 * * *",
    scheduleHuman: "4 veces al día: 8h, 14h, 20h, 2h",
    featureFlag: null,
    status: "active_no_flag",
    statusLabel: "Activo sin feature flag",
    condition:
      "Anulaciones con operationalStatus = 'recibida' creadas hace >48h y sin ningún log de acción admin (excluye 'created' y 'linked_reservation')",
    maxPerRun: 50,
    maxPerQuote: null,
    templates: ["HTML inline (sin función separada en emailTemplates.ts)"],
    recipient: "admin",
    subject: "⚠ {N} anulación(es) sin atender (>48h)",
    recommendation:
      "Mantener tal cual. Es una alerta interna sin equivalente en el sistema nuevo. No hay solapamiento con ningún otro job.",
    recommendationType: "keep",
    details: [
      { label: "STALE_HOURS", value: "48 horas" },
      { label: "Destinatario", value: "getBusinessEmail('cancellations') — solo admin" },
      { label: "Enlace en email", value: "/admin/crm?tab=anulaciones" },
      { label: "Filtro de logs", value: "Excluye 'created' y 'linked_reservation'" },
    ],
  },
];

const STATUS_TONE: Record<CronCard["status"], Tone> = { active_no_flag: "warning", active_with_flag: "success", superseded: "neutral" };
const RECIPIENT_TONE: Record<CronCard["recipient"], Tone> = { client: "info", admin: "brand", both: "success" };
const REC_BORDER: Record<CronCard["recommendationType"], string> = { keep: "border-l-success", migrate: "border-l-info", deprecate: "border-l-danger" };

function CronDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs sm:flex-row sm:gap-2">
      <span className="shrink-0 text-muted-foreground">{label}:</span>
      <span className="break-words font-mono text-foreground/80">{value}</span>
    </div>
  );
}

function CronJobCard({ cron }: { cron: CronCard }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="space-y-3 border-b border-border p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-all font-mono text-sm font-semibold text-foreground">{cron.name}</h3>
            <StatusBadge tone={STATUS_TONE[cron.status]}>{t(`legacyCrons.status.${cron.status}`)}</StatusBadge>
            <StatusBadge tone={RECIPIENT_TONE[cron.recipient]}>{t(`legacyCrons.recipient.${cron.recipient}`)}</StatusBadge>
          </div>
          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{cron.file}</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="mb-1 text-xs text-muted-foreground">{t("legacyCrons.frequency")}</p>
            <p className="font-mono text-xs text-foreground">{cron.schedule}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{cron.scheduleHuman}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-2.5">
            <p className="mb-1 text-xs text-muted-foreground">{t("legacyCrons.flag")}</p>
            {cron.featureFlag ? <p className="break-all font-mono text-xs text-success">{cron.featureFlag}</p> : <p className="text-xs text-warning">{t("legacyCrons.noFlag")}</p>}
          </div>
        </div>
      </div>

      <div className="space-y-3 p-4">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">{t("legacyCrons.condition")}</p>
          <p className="rounded-lg bg-muted/50 p-2.5 text-xs leading-relaxed text-foreground/80">{cron.condition}</p>
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">{t("legacyCrons.templates")}</p>
          <div className="space-y-1">
            {cron.templates.map((tpl) => (
              <p key={tpl} className="rounded-lg bg-info/10 px-2.5 py-1.5 font-mono text-xs text-info">{tpl}</p>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">{t("legacyCrons.subject")}</p>
          <p className="break-words rounded-lg bg-muted/50 px-2.5 py-1.5 font-mono text-xs text-foreground/80">{cron.subject}</p>
        </div>
        <div className={`border-l-4 py-1 pl-3 ${REC_BORDER[cron.recommendationType]}`}>
          <p className="mb-0.5 text-xs text-muted-foreground">{t("legacyCrons.recommendation")}</p>
          <p className="text-xs text-foreground/80">{cron.recommendation}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? t("legacyCrons.collapse") : t("legacyCrons.expand")}
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-border p-4">
          <p className="mb-2 text-xs text-muted-foreground">{t("legacyCrons.details")}</p>
          <div className="space-y-1.5 rounded-lg bg-muted/50 p-3">
            {cron.maxPerRun !== null && <CronDetail label={t("legacyCrons.limitRun")} value={t("legacyCrons.records", { n: cron.maxPerRun })} />}
            {cron.maxPerQuote !== null && <CronDetail label={t("legacyCrons.limitQuote")} value={String(cron.maxPerQuote)} />}
            {cron.details.map((d) => (
              <CronDetail key={d.label} label={d.label} value={d.value} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function LegacyAutomationsTab() {
  const { t } = useI18n();
  const withoutFlag = CRONS.filter((c) => c.featureFlag === null).length;
  const keep = CRONS.filter((c) => c.recommendationType === "keep").length;
  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-foreground">{t("legacyCrons.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("legacyCrons.description")}</p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard tone="brand" icon={<Cog />} label={t("legacyCrons.total")} value={CRONS.length} />
        <MetricCard tone="warning" icon={<ToggleLeft />} label={t("legacyCrons.withoutFlag")} value={withoutFlag} />
        <MetricCard tone="success" icon={<ShieldCheck />} label={t("legacyCrons.keep")} value={keep} />
      </div>

      <div role="note" className="flex gap-2 rounded-lg border border-info/30 bg-info/5 p-3 text-sm text-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
        <p><strong className="font-medium">{t("legacyCrons.infoTitle")}.</strong> {t("legacyCrons.info")}</p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {CRONS.map((c) => (
          <CronJobCard key={c.id} cron={c} />
        ))}
      </div>

      <div className="rounded-lg border border-border p-3">
        <p className="mb-2 text-xs text-muted-foreground">{t("legacyCrons.legend")}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-success" aria-hidden="true" />{t("legacyCrons.legendFlag")}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-warning" aria-hidden="true" />{t("legacyCrons.legendNoFlag")}</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" aria-hidden="true" />{t("legacyCrons.legendSuperseded")}</span>
        </div>
      </div>
    </div>
  );
}
