/**
 * Plantillas y reglas (Atención Comercial): resumen con indicadores que filtran (todas, activas, inactivas), búsqueda,
 * categoría y plantillas agrupadas por categoría. Cada plantilla se abre en una ficha con su configuración y reglas
 * (TemplateRulesParts.tsx). Solo presentación: las consultas y acciones son las de siempre.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { CheckCircle2, FileText, MinusCircle, Search } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MetricCard } from "@/components/admin/PanelVisual";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { CATEGORIES, TemplateCard, type TemplateConfig } from "./TemplateRulesParts";

type StateFilter = "all" | "active" | "inactive";

export default function TemplateRulesTab() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");

  const { data: configs, isLoading, isError, error, refetch } = trpc.emailCommunications.listTemplateConfigs.useQuery();
  const all = useMemo(() => (configs ?? []).filter(Boolean) as TemplateConfig[], [configs]);
  const activeCount = all.filter((c) => c.isActive).length;

  const filtered = all.filter((c) => {
    if (filterCategory !== "all" && c.category !== filterCategory) return false;
    if (stateFilter === "active" && !c.isActive) return false;
    if (stateFilter === "inactive" && c.isActive) return false;
    if (search) {
      const q = search.toLowerCase();
      return (c.key ?? "").includes(q) || (c.friendlyName ?? "").toLowerCase().includes(q) || (c.category ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  const groups = CATEGORIES.map((cat) => ({ cat, label: t(`templateRules.category.${cat}`), items: filtered.filter((c) => c.category === cat) }))
    .filter((g) => g.items.length > 0);
  const uncategorized = filtered.filter((c) => !CATEGORIES.includes(c.category ?? ""));
  if (uncategorized.length > 0) groups.push({ cat: "", label: t("templateRules.uncategorized"), items: uncategorized });
  const hasFilters = !!search || filterCategory !== "all" || stateFilter !== "all";

  if (isLoading) return <PanelLoading label={t("templateRules.loading")} />;
  if (isError) return <PanelError title={t("templateRules.loadError")} error={error} onRetry={() => refetch()} />;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-foreground">{t("templateRules.title")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("templateRules.description")}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard compact tone="brand" icon={<FileText />} label={t("templateRules.summary.total")} value={all.length} detail={t("templateRules.summary.totalDetail")}
          active={stateFilter === "all"} onClick={() => setStateFilter("all")} />
        <MetricCard compact tone="success" icon={<CheckCircle2 />} label={t("templateRules.summary.active")} value={activeCount} detail={t("templateRules.summary.activeDetail")}
          active={stateFilter === "active"} onClick={() => setStateFilter(stateFilter === "active" ? "all" : "active")} />
        <MetricCard compact tone="neutral" icon={<MinusCircle />} label={t("templateRules.summary.inactive")} value={all.length - activeCount} detail={t("templateRules.summary.inactiveDetail")}
          active={stateFilter === "inactive"} onClick={() => setStateFilter(stateFilter === "inactive" ? "all" : "inactive")} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" aria-label={t("templateRules.searchLabel")} placeholder={t("templateRules.search")} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8" autoComplete="off" />
        </div>
        <select aria-label={t("templateRules.allCategories")} value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="all">{t("templateRules.allCategories")}</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{t(`templateRules.category.${c}`)}</option>)}
        </select>
      </div>

      {groups.length === 0 ? (
        <PanelEmpty icon={<FileText />} title={t("templateRules.empty")} description={t("templateRules.emptyHint")}>
          {hasFilters && <Button variant="outline" size="sm" onClick={() => { setSearch(""); setFilterCategory("all"); setStateFilter("all"); }}>{t("templateRules.clearFilters")}</Button>}
        </PanelEmpty>
      ) : (
        <div className="space-y-6">
          {groups.map(({ cat, label, items }) => (
            <section key={cat || "none"}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label} ({items.length})</h3>
              <div className="space-y-2">
                {items.map((c) => <TemplateCard key={c.key} config={c} categoryLabel={cat ? label : undefined} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
