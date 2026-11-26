/**
 * Mapa de comunicaciones (Atención Comercial): catálogo de solo lectura de las plantillas del sistema. Indicadores que
 * filtran, búsqueda, categorías plegables con un tono propio cada una y leyenda. Las piezas están en
 * CommunicationsMapParts.tsx y los datos en communicationsMapData.ts.
 */
import { useState } from "react";
import { CheckCircle2, Eye, FileText, RefreshCw, Search, ShieldCheck, UserCog } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/admin/PanelVisual";
import { PanelEmpty } from "@/components/admin/PanelStates";
import { StatusBadge } from "@/components/admin/PanelUi";
import { CATALOG, type TemplateEntry } from "./communicationsMapData";
import { CategoryBlock } from "./CommunicationsMapParts";

type Kpi = "all" | "active" | "reminders" | "adminOnly";

const MATCH: Record<Kpi, (t: TemplateEntry) => boolean> = {
  all: () => true,
  active: (t) => t.status === "active",
  reminders: (t) => t.reminderCount != null,
  adminOnly: (t) => !t.sendToCustomer && t.sendToAdmin,
};

export default function CommunicationsMap() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [kpi, setKpi] = useState<Kpi>("all");
  const count = (k: Kpi) => CATALOG.reduce((s, c) => s + c.templates.filter(MATCH[k]).length, 0);

  const q = search.trim().toLowerCase();
  const filtered = CATALOG.map((cat) => ({
    cat,
    templates: cat.templates.filter((tm) => MATCH[kpi](tm) && (!q
      || t(`commMap.tpl.${tm.key}.name`).toLowerCase().includes(q)
      || t(`commMap.tpl.${tm.key}.trigger`).toLowerCase().includes(q)
      || tm.function.toLowerCase().includes(q))),
  })).filter((g) => g.templates.length > 0);

  const toggle = (k: Kpi) => setKpi(kpi === k ? "all" : k);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard compact tone="brand" icon={<FileText />} label={t("commMap.kpi.total")} value={count("all")} detail={t("commMap.kpi.totalDetail")} active={kpi === "all"} onClick={() => setKpi("all")} />
        <MetricCard compact tone="success" icon={<CheckCircle2 />} label={t("commMap.kpi.active")} value={count("active")} detail={t("commMap.kpi.activeDetail")} active={kpi === "active"} onClick={() => toggle("active")} />
        <MetricCard compact tone="info" icon={<RefreshCw />} label={t("commMap.kpi.reminders")} value={count("reminders")} detail={t("commMap.kpi.remindersDetail")} active={kpi === "reminders"} onClick={() => toggle("reminders")} />
        <MetricCard compact tone="warning" icon={<UserCog />} label={t("commMap.kpi.adminOnly")} value={count("adminOnly")} detail={t("commMap.kpi.adminOnlyDetail")} active={kpi === "adminOnly"} onClick={() => toggle("adminOnly")} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" aria-label={t("commMap.searchLabel")} placeholder={t("commMap.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" autoComplete="off" />
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="/admin/plantillas-email"><Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />{t("commMap.editTemplates")}</a>
        </Button>
      </div>

      <div role="note" className="flex items-start gap-3 rounded-lg border border-info/40 bg-info/10 px-4 py-3">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-foreground">
          <strong>{t("commMap.readOnlyTitle")}</strong> {t("commMap.readOnly")}{" "}
          <a href="/admin/plantillas-email" className="font-medium text-info underline">{t("commMap.readOnlyLink")}</a>.
        </p>
      </div>

      {filtered.length === 0 ? (
        <PanelEmpty icon={<Search />} title={t("commMap.empty")} description={t("commMap.emptyHint")}>
          <Button variant="outline" size="sm" onClick={() => { setSearch(""); setKpi("all"); }}>{t("commMap.clearFilters")}</Button>
        </PanelEmpty>
      ) : (
        <div className="space-y-3">
          {filtered.map(({ cat, templates }) => <CategoryBlock key={`${cat.id}-${kpi}-${q ? "q" : ""}`} cat={cat} templates={templates} />)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{t("commMap.legend.title")}</span>
        <StatusBadge tone="info" icon={<span />}>{t("commMap.legend.customer")}</StatusBadge>
        <StatusBadge tone="warning" icon={<span />}>{t("commMap.legend.admin")}</StatusBadge>
        <StatusBadge tone="brand" icon={<span />}>{t("commMap.legend.reminders")}</StatusBadge>
        <StatusBadge tone="success" icon={<span />}>{t("commMap.legend.active")}</StatusBadge>
        <StatusBadge tone="danger" icon={<span />}>{t("commMap.legend.inactive")}</StatusBadge>
      </div>
    </div>
  );
}
