/**
 * Bloque «Solicitud web» de la ficha de un lead: lo que la persona vio y eligió en la ficha del producto (producto,
 * modalidad, precio mostrado y moneda, idioma de la web, convocatoria, participantes y origen). Solo se pinta si el lead
 * viene de una solicitud de producto o tiene alguno de esos campos (`crm.leads.get` → `webRequest`).
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Globe } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { productEditionsHref, type LeadWebRequestView } from "@shared/leadWebRequest";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-info/15 pt-2 text-sm first:border-t-0 first:pt-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{children}</dd>
    </div>
  );
}

export function LeadWebRequestBlock({ request }: { request: LeadWebRequestView | null | undefined }) {
  const { t } = useI18n();
  if (!request) return null;
  const r = request;
  return (
    <section aria-labelledby="lead-web-request" className="space-y-3 rounded-xl border border-info/30 bg-info/5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 id="lead-web-request" className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-info"><Globe className="h-3.5 w-3.5" aria-hidden="true" />{t("crmTags.leadWeb.title")}</h4>
        {r.isTest && <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-semibold text-warning">{t("crmTags.leadWeb.test")}</span>}
      </div>
      <dl className="space-y-2">
      {r.product && <Row label={t("crmTags.leadWeb.product")}>{r.product.title}</Row>}
      {r.variant && <Row label={t("crmTags.leadWeb.variant")}>{r.variant.label}</Row>}
      {r.shownPrice && <Row label={t("crmTags.leadWeb.shownPrice")}>{r.shownPrice}{!r.currency && <span className="ml-1 text-xs font-normal text-muted-foreground">{t("crmTags.leadWeb.noCurrency")}</span>}</Row>}
      {r.lang && (
        <Row label={t("crmTags.leadWeb.lang")}>
          <span className="mr-1.5 rounded border border-border px-1.5 py-0.5 text-xs font-semibold uppercase" aria-hidden="true">{r.lang.code}</span>
          {r.lang.name}
        </Row>
      )}
      {r.edition && (
        <Row label={t("crmTags.leadWeb.edition")}>
          {r.edition.experienceId ? (
            <Link href={productEditionsHref(r.edition.experienceId)} className="underline underline-offset-4 hover:text-info">
              {r.edition.label} · {r.edition.dates}
            </Link>
          ) : (
            <>{r.edition.label} · {r.edition.dates}</>
          )}
        </Row>
      )}
      {r.participants && <Row label={t("crmTags.leadWeb.participants")}>{r.participants}</Row>}
      {r.sourceLabel && <Row label={t("crmTags.leadWeb.source")}>{r.sourceLabel}</Row>}
      </dl>
    </section>
  );
}
