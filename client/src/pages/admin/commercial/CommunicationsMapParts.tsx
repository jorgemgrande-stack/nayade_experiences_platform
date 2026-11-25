/** Piezas del «Mapa de comunicaciones»: ficha de plantilla y bloque plegable por categoría. Solo lectura. */
import { useState } from "react";
import { ChevronDown, Copy, Mail, RefreshCw } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { TONE_SURFACE, TONE_TEXT } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import type { CategoryEntry, TemplateEntry } from "./communicationsMapData";

const STATUS_TONE: Record<TemplateEntry["status"], Tone> = { active: "success", inactive: "danger", manual_only: "warning" };

export function TemplateTile({ tmpl }: { tmpl: TemplateEntry }) {
  const { t } = useI18n();
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 break-words text-sm font-semibold leading-snug text-foreground">{t(`commMap.tpl.${tmpl.key}.name`)}</span>
        <StatusBadge tone={STATUS_TONE[tmpl.status]} className="shrink-0">{t(`commMap.status.${tmpl.status}`)}</StatusBadge>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{t(`commMap.tpl.${tmpl.key}.trigger`)}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {tmpl.sendToCustomer && <StatusBadge tone="info" icon={<Mail />}>{t("commMap.toCustomer")}</StatusBadge>}
        {tmpl.sendToAdmin && <StatusBadge tone="warning" icon={<Copy />}>{t("commMap.toAdmin")}</StatusBadge>}
        {tmpl.reminderCount != null && <StatusBadge tone="brand" icon={<RefreshCw />}>{t("commMap.remindersCount", { count: tmpl.reminderCount })}</StatusBadge>}
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-muted-foreground">{tmpl.function}</span>
      </div>
      {tmpl.hasNotes && <p className="border-t border-border pt-1.5 text-xs italic text-muted-foreground">{t(`commMap.tpl.${tmpl.key}.notes`)}</p>}
    </div>
  );
}

export function CategoryBlock({ cat, templates, defaultOpen = true }: { cat: CategoryEntry; templates: TemplateEntry[]; defaultOpen?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  const Icon = cat.icon;
  return (
    <section className={cn("overflow-hidden rounded-xl border", TONE_SURFACE[cat.tone])}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="rounded-lg bg-background/60 p-1.5"><Icon className={cn("h-4 w-4", TONE_TEXT[cat.tone])} aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{t(`commMap.cat.${cat.id}.name`)}</span>
          <span className="block text-xs text-muted-foreground">{t(`commMap.cat.${cat.id}.description`)}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <StatusBadge tone={cat.tone}>{t("commMap.templatesCount", { count: templates.length })}</StatusBadge>
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-label={open ? t("commMap.collapse") : t("commMap.expand")} />
        </span>
      </button>
      {open && (
        <div className="grid grid-cols-1 gap-2 px-4 pb-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((tm) => <TemplateTile key={tm.key} tmpl={tm} />)}
        </div>
      )}
    </section>
  );
}
