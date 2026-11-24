/**
 * Auditoría de plantillas de correo (Atención Comercial): inventario de solo lectura. Indicadores que filtran por estado
 * o por tarea programada, búsqueda y categoría, y listado compacto (tarjetas en móvil). Datos en emailAuditData.ts.
 */
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Check, FileText, Timer } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/admin/PanelVisual";
import { PanelDataList, StatusBadge, type PanelColumn, type Tone } from "@/components/admin/PanelUi";
import { PanelEmpty } from "@/components/admin/PanelStates";
import { TONE_TEXT } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { AUDIT_CATEGORIES, AUDIT_DATA, type AuditEntry, type AuditStatus, type Recipient, type TriggerType } from "./emailAuditData";

const STATUS_TONE: Record<AuditStatus, Tone> = { ok: "success", warning: "warning", unknown: "neutral" };
const RECIPIENT_TONE: Record<Recipient, Tone> = { client: "info", admin: "brand", both: "success", user: "neutral" };
const TRIGGER_TONE: Record<TriggerType, Tone> = { event: "info", cron: "warning", manual: "neutral", unknown: "danger" };

type Quick = "all" | "ok" | "warning" | "cron";

export default function EmailAuditTab() {
  const { t } = useI18n();
  const [category, setCategory] = useState("all");
  const [quick, setQuick] = useState<Quick>("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const total = AUDIT_DATA.length;
  const okCount = AUDIT_DATA.filter((e) => e.status === "ok").length;
  const warnCount = AUDIT_DATA.filter((e) => e.status === "warning").length;
  const cronCount = AUDIT_DATA.filter((e) => e.isCronDriven).length;

  const filtered = AUDIT_DATA.filter((e) => {
    if (category !== "all" && e.category !== category) return false;
    if (status !== "all" && e.status !== status) return false;
    if (quick === "cron" && !e.isCronDriven) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.functionName.toLowerCase().includes(q) || t(`commMap.tpl.${e.id}.name`).toLowerCase().includes(q) || t(`emailAudit.trig.${e.id}`).toLowerCase().includes(q);
    }
    return true;
  });
  const hasFilters = category !== "all" || status !== "all" || quick === "cron" || !!search;
  const clear = () => { setCategory("all"); setStatus("all"); setQuick("all"); setSearch(""); };
  const pickQuick = (k: Quick) => {
    const next = quick === k ? "all" : k;
    setQuick(next);
    setStatus(next === "ok" || next === "warning" ? next : "all");
  };

  const columns: PanelColumn<AuditEntry>[] = [
    {
      key: "template",
      header: t("emailAudit.col.template"),
      cell: (e) => (
        <div className="min-w-0">
          <div className="break-words text-sm font-medium text-foreground">{t(`commMap.tpl.${e.id}.name`)}</div>
          <div className="break-all font-mono text-xs text-muted-foreground">{e.functionName}</div>
          {e.hasNote && <div className="mt-1 max-w-[260px] text-xs text-warning">{t(`emailAudit.note.${e.id}`)}</div>}
        </div>
      ),
    },
    { key: "category", header: t("emailAudit.col.category"), cell: (e) => <span className="text-xs text-muted-foreground">{t(`commMap.cat.${e.category}.name`)}</span> },
    {
      key: "trigger",
      header: t("emailAudit.col.trigger"),
      cell: (e) => (
        <div className="min-w-0">
          <StatusBadge tone={TRIGGER_TONE[e.triggerType]}>{t(`emailAudit.triggerType.${e.triggerType}`)}</StatusBadge>
          <div className="mt-1 max-w-[260px] text-xs leading-relaxed text-muted-foreground">{t(`emailAudit.trig.${e.id}`)}</div>
        </div>
      ),
    },
    { key: "recipient", header: t("emailAudit.col.recipient"), cell: (e) => <StatusBadge tone={RECIPIENT_TONE[e.recipient]}>{t(`emailAudit.recipient.${e.recipient}`)}</StatusBadge> },
    {
      key: "checks",
      header: t("emailAudit.col.checks"),
      cell: () => (
        <span className="inline-flex flex-wrap gap-1">
          {(["fn", "subject", "body"] as const).map((c) => (
            <span key={c} title={`${t(`emailAudit.check.${c}`)}: ${t("emailAudit.checkOk")}`} className="inline-flex items-center gap-0.5 rounded-md bg-success/10 px-1.5 py-0.5 text-xs text-success">
              <Check className="h-3 w-3" aria-hidden="true" />{t(`emailAudit.check.${c}`)}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "cron",
      header: t("emailAudit.col.cron"),
      cell: (e) => e.isCronDriven
        ? <span className={cn("inline-flex items-center gap-1 text-xs", TONE_TEXT.warning)} title={e.cronAutomation ? t("emailAudit.cronAutomation") : t("emailAudit.cronLegacy")}><Timer className="h-3.5 w-3.5" aria-hidden="true" />{t("emailAudit.cronYes")}</span>
        : <span className="text-xs text-muted-foreground">{t("emailAudit.cronNo")}</span>,
    },
    { key: "status", header: t("emailAudit.col.status"), cell: (e) => <StatusBadge tone={STATUS_TONE[e.status]}>{t(`emailAudit.status.${e.status}`)}</StatusBadge> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("emailAudit.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("emailAudit.description", { total })}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard compact tone="brand" icon={<FileText />} label={t("emailAudit.kpi.total")} value={total} active={quick === "all" && status === "all"} onClick={clear} />
        <MetricCard compact tone="success" icon={<CheckCircle2 />} label={t("emailAudit.kpi.ok")} value={okCount} active={quick === "ok"} onClick={() => pickQuick("ok")} />
        <MetricCard compact tone="warning" icon={<AlertTriangle />} label={t("emailAudit.kpi.warning")} value={warnCount} active={quick === "warning"} onClick={() => pickQuick("warning")} />
        <MetricCard compact tone="info" icon={<Timer />} label={t("emailAudit.kpi.cron")} value={cronCount} active={quick === "cron"} onClick={() => pickQuick("cron")} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input type="search" aria-label={t("emailAudit.searchLabel")} placeholder={t("emailAudit.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="w-full sm:w-56" autoComplete="off" />
        <select aria-label={t("emailAudit.allCategories")} value={category} onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="all">{t("emailAudit.allCategories")}</option>
          {AUDIT_CATEGORIES.map((c) => <option key={c} value={c}>{t(`commMap.cat.${c}.name`)}</option>)}
        </select>
        <select aria-label={t("emailAudit.allStatuses")} value={status} onChange={(e) => { setStatus(e.target.value); setQuick(e.target.value === "ok" || e.target.value === "warning" ? e.target.value : "all"); }}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="all">{t("emailAudit.allStatuses")}</option>
          <option value="ok">{t("emailAudit.status.ok")}</option>
          <option value="warning">{t("emailAudit.status.warning")}</option>
          <option value="unknown">{t("emailAudit.status.unknown")}</option>
        </select>
        {hasFilters && <Button variant="ghost" size="sm" onClick={clear}>{t("emailAudit.clearFilters")}</Button>}
      </div>

      {filtered.length === 0 ? (
        <PanelEmpty icon={<FileText />} title={t("emailAudit.empty")} description={t("emailAudit.emptyHint")}>
          <Button variant="outline" size="sm" onClick={clear}>{t("emailAudit.clearFilters")}</Button>
        </PanelEmpty>
      ) : (
        <PanelDataList rows={filtered} columns={columns} rowKey={(e) => e.id} caption={t("emailAudit.caption")} />
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("emailAudit.legend.title")}</span>
        <span>{t("emailAudit.legend.event")}</span>
        <span>{t("emailAudit.legend.cron")}</span>
        <span>{t("emailAudit.legend.manual")}</span>
        <span>{t("emailAudit.legend.warning")}</span>
      </div>
    </div>
  );
}
