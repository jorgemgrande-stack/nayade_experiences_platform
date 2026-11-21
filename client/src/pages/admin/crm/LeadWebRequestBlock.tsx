/**
 * Bloque «Solicitud web» de la ficha de un lead: lo que la persona vio y eligió en la ficha del producto (producto,
 * modalidad, precio mostrado y moneda, idioma de la web, convocatoria, participantes y origen). Solo se pinta si el lead
 * viene de una solicitud de producto o tiene alguno de esos campos (`crm.leads.get` → `webRequest`).
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useI18n } from "@/i18n/I18nProvider";
import { productEditionsHref, type LeadWebRequestView } from "@shared/leadWebRequest";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-foreground/60">{label}</span>
      <span className="text-right font-medium text-white">{children}</span>
    </div>
  );
}

export function LeadWebRequestBlock({ request }: { request: LeadWebRequestView | null | undefined }) {
  const { t } = useI18n();
  if (!request) return null;
  const r = request;
  return (
    <section aria-labelledby="lead-web-request" className="space-y-2 rounded-xl border border-sky-500/20 bg-sky-500/[0.06] p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 id="lead-web-request" className="text-xs font-semibold uppercase tracking-wider text-sky-300">{t("crmTags.leadWeb.title")}</h4>
        {r.isTest && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold text-amber-300">{t("crmTags.leadWeb.test")}</span>}
      </div>
      {r.product && <Row label={t("crmTags.leadWeb.product")}>{r.product.title}</Row>}
      {r.variant && <Row label={t("crmTags.leadWeb.variant")}>{r.variant.label}</Row>}
      {r.shownPrice && <Row label={t("crmTags.leadWeb.shownPrice")}>{r.shownPrice}{!r.currency && <span className="ml-1 text-xs font-normal text-foreground/50">{t("crmTags.leadWeb.noCurrency")}</span>}</Row>}
      {r.lang && (
        <Row label={t("crmTags.leadWeb.lang")}>
          <span className="mr-1.5 rounded border border-foreground/20 px-1.5 py-0.5 text-[11px] font-semibold uppercase" aria-hidden="true">{r.lang.code}</span>
          {r.lang.name}
        </Row>
      )}
      {r.edition && (
        <Row label={t("crmTags.leadWeb.edition")}>
          {r.edition.experienceId ? (
            <Link href={productEditionsHref(r.edition.experienceId)} className="underline underline-offset-4 hover:text-sky-300">
              {r.edition.label} · {r.edition.dates}
            </Link>
          ) : (
            <>{r.edition.label} · {r.edition.dates}</>
          )}
        </Row>
      )}
      {r.participants && <Row label={t("crmTags.leadWeb.participants")}>{r.participants}</Row>}
      {r.sourceLabel && <Row label={t("crmTags.leadWeb.source")}>{r.sourceLabel}</Row>}
    </section>
  );
}
