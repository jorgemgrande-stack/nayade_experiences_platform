import React, { useState } from "react";

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
    id: "quote_reminder",
    name: "quoteReminderJob",
    file: "server/quoteReminderJob.ts",
    schedule: "0 * * * *",
    scheduleHuman: "Cada hora (en el minuto 0)",
    featureFlag: null,
    status: "superseded",
    statusLabel: "Activo sin flag — supersedido",
    condition:
      "Presupuesto en estado 'enviado', sin viewedAt, sin paidAt, con paymentLinkToken, sentAt hace >48h, reminderCount < 2",
    maxPerRun: 50,
    maxPerQuote: 2,
    templates: ["buildQuoteHtml (mismo email de presupuesto)"],
    recipient: "both",
    subject: "⏰ Recordatorio: tu presupuesto {quoteNumber} sigue disponible — {brandName}",
    recommendation:
      "Desactivar o poner bajo feature flag. commercialFollowupJob cubre esta funcionalidad con reglas configurables. Ambos corren en paralelo y pueden enviar al mismo cliente.",
    recommendationType: "deprecate",
    details: [
      { label: "MAX_REMINDERS", value: "2 reenvíos por presupuesto" },
      { label: "Cutoff", value: "48 horas sin abrir" },
      { label: "CC", value: "getBusinessEmail('reservations')" },
      { label: "Alerta interna", value: "notifyOwner() si se envió ≥1" },
      { label: "Ejecuta al arrancar", value: "Sí — sin esperar la hora" },
    ],
  },
  {
    id: "commercial_followup",
    name: "commercialFollowupJob",
    file: "server/commercialFollowupJob.ts",
    schedule: "0 * * * *",
    scheduleHuman: "Cada hora (en el minuto 0)",
    featureFlag: "commercial_followup_job_enabled (en commercialFollowupSettings.enabled)",
    status: "active_with_flag",
    statusLabel: "Activo con feature flag",
    condition:
      "Presupuesto en estado 'enviado', sin paidAt, sentAt suficientemente antiguo según delayHours de cada regla. Filtra por ventana horaria, maxTotalRemindersPerQuote, reminderPaused y commercialStatus.",
    maxPerRun: null,
    maxPerQuote: null,
    templates: [
      "buildCommercialReminder1Html (1er recordatorio)",
      "buildCommercialReminder2Html (2º recordatorio)",
      "buildCommercialReminder3Html (3er recordatorio)",
    ],
    recipient: "client",
    subject: "Configurable por regla — soporta {{clientName}} y {{quoteNumber}}",
    recommendation:
      "Sistema actual. Mantener y usar. Las reglas se configuran en la pestaña 'Reglas' del panel de atención comercial.",
    recommendationType: "keep",
    details: [
      { label: "maxEmailsPerRun", value: "Configurable en commercialFollowupSettings" },
      { label: "maxTotalRemindersPerQuote", value: "Configurable en commercialFollowupSettings" },
      { label: "stopAfterDays", value: "Configurable en commercialFollowupSettings" },
      { label: "Ventana horaria", value: "allowedSendStart – allowedSendEnd (zona Europe/Madrid)" },
      { label: "Anti-duplicado", value: "UNIQUE KEY uq_comm_quote_rule (quoteId + ruleId)" },
      { label: "Registro", value: "commercial_communications + quoteCommercialTracking" },
    ],
  },
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

const STATUS_COLORS: Record<CronCard["status"], string> = {
  active_no_flag: "bg-yellow-900/40 text-yellow-300 border border-yellow-700",
  active_with_flag: "bg-green-900/40 text-green-300 border border-green-700",
  superseded: "bg-orange-900/40 text-orange-300 border border-orange-700",
};

const RECIPIENT_LABELS: Record<CronCard["recipient"], string> = {
  client: "Solo cliente",
  admin: "Solo admin",
  both: "Cliente + Admin",
};

const RECIPIENT_COLORS: Record<CronCard["recipient"], string> = {
  client: "bg-blue-900/40 text-blue-300",
  admin: "bg-purple-900/40 text-purple-300",
  both: "bg-teal-900/40 text-teal-300",
};

const REC_COLORS: Record<CronCard["recommendationType"], string> = {
  keep: "border-l-green-500",
  migrate: "border-l-blue-500",
  deprecate: "border-l-red-500",
};

const REC_ICONS: Record<CronCard["recommendationType"], string> = {
  keep: "✓",
  migrate: "→",
  deprecate: "⚠",
};

function CronDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-gray-500 shrink-0">{label}:</span>
      <span className="text-gray-300 font-mono">{value}</span>
    </div>
  );
}

function CronJobCard({ cron }: { cron: CronCard }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-[#2a2a2a]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm font-semibold text-white">{cron.name}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[cron.status]}`}>
                {cron.statusLabel}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${RECIPIENT_COLORS[cron.recipient]}`}>
                {RECIPIENT_LABELS[cron.recipient]}
              </span>
            </div>
            <div className="mt-1 text-xs text-gray-500 font-mono">{cron.file}</div>
          </div>
          <button
            onClick={() => setExpanded((e) => !e)}
            className="text-gray-500 hover:text-white transition-colors shrink-0 text-xs"
          >
            {expanded ? "▲ Colapsar" : "▼ Expandir"}
          </button>
        </div>

        {/* Schedule + flag */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="bg-[#111] rounded p-2">
            <div className="text-xs text-gray-500 mb-1">Frecuencia</div>
            <div className="font-mono text-xs text-amber-400">{cron.schedule}</div>
            <div className="text-xs text-gray-400 mt-0.5">{cron.scheduleHuman}</div>
          </div>
          <div className="bg-[#111] rounded p-2">
            <div className="text-xs text-gray-500 mb-1">Feature flag</div>
            {cron.featureFlag ? (
              <div className="font-mono text-xs text-green-400 break-all">{cron.featureFlag}</div>
            ) : (
              <div className="text-xs text-red-400">Sin flag — siempre activo</div>
            )}
          </div>
        </div>
      </div>

      {/* Body — always visible */}
      <div className="p-4 space-y-3">
        {/* Condition */}
        <div>
          <div className="text-xs text-gray-500 mb-1">Condición de disparo</div>
          <div className="text-xs text-gray-300 bg-[#111] rounded p-2 leading-relaxed">{cron.condition}</div>
        </div>

        {/* Templates */}
        <div>
          <div className="text-xs text-gray-500 mb-1">Template(s) usado(s)</div>
          <div className="space-y-1">
            {cron.templates.map((t) => (
              <div key={t} className="font-mono text-xs text-blue-300 bg-blue-950/20 rounded px-2 py-1">
                {t}
              </div>
            ))}
          </div>
        </div>

        {/* Subject */}
        <div>
          <div className="text-xs text-gray-500 mb-1">Subject del email</div>
          <div className="text-xs text-gray-300 font-mono bg-[#111] rounded px-2 py-1 break-all">{cron.subject}</div>
        </div>

        {/* Recommendation */}
        <div className={`border-l-4 pl-3 py-1 ${REC_COLORS[cron.recommendationType]}`}>
          <div className="text-xs text-gray-500 mb-0.5">Recomendación</div>
          <div className="text-xs text-gray-200">
            <span className="mr-1">{REC_ICONS[cron.recommendationType]}</span>
            {cron.recommendation}
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-[#2a2a2a] pt-4">
          <div className="text-xs text-gray-500 mb-2">Detalles técnicos</div>
          <div className="space-y-1.5 bg-[#111] rounded p-3">
            {cron.maxPerRun !== null && (
              <CronDetail label="Límite por ejecución" value={`${cron.maxPerRun} registros`} />
            )}
            {cron.maxPerQuote !== null && (
              <CronDetail label="Máx. por presupuesto" value={`${cron.maxPerQuote}`} />
            )}
            {cron.details.map((d) => (
              <CronDetail key={d.label} label={d.label} value={d.value} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function LegacyAutomationsTab() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Automatizaciones activas</h2>
          <p className="text-sm text-gray-400 mt-1">
            Los 3 cron jobs actuales del sistema. Esta vista es de solo lectura — para modificar la configuración
            edita los archivos de servidor directamente.
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="bg-yellow-900/20 border border-yellow-800/40 rounded-lg p-3 flex gap-2 text-xs text-yellow-300">
        <span className="shrink-0">⚠</span>
        <span>
          <strong>quoteReminderJob</strong> y <strong>commercialFollowupJob</strong> corren en paralelo y ambos
          pueden contactar al mismo cliente en la misma hora. Revisa la recomendación de depreciación antes de activar
          nuevas reglas en commercialFollowupJob.
        </span>
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-white">3</div>
          <div className="text-xs text-gray-500 mt-1">Cron jobs totales</div>
        </div>
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-red-400">1</div>
          <div className="text-xs text-gray-500 mt-1">Sin feature flag y supersedido</div>
        </div>
        <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-green-400">2</div>
          <div className="text-xs text-gray-500 mt-1">Recomendados mantener</div>
        </div>
      </div>

      {/* Cards */}
      <div className="space-y-4">
        {CRONS.map((c) => (
          <CronJobCard key={c.id} cron={c} />
        ))}
      </div>

      {/* Legend */}
      <div className="border border-[#2a2a2a] rounded-lg p-3">
        <div className="text-xs text-gray-500 mb-2">Leyenda de estados</div>
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-green-500 inline-block" />
            <span className="text-gray-400">Activo con feature flag — controlado</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-yellow-500 inline-block" />
            <span className="text-gray-400">Activo sin flag — siempre corre</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-full bg-orange-500 inline-block" />
            <span className="text-gray-400">Supersedido — funcionalidad reemplazada</span>
          </div>
        </div>
      </div>
    </div>
  );
}
