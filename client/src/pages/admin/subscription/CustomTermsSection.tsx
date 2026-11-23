/**
 * «Mi plan»: condiciones comerciales pactadas con la empresa. Solo lectura y con la presentación que eligió Big
 * Elephant: con cuota global se muestran los productos y servicios incluidos y la cuota, nunca precios por partida;
 * con desglose, cada partida con su precio y sus descuentos o recargos. Todo viene del plano de control
 * (subscription.plan); aquí no se calcula ningún importe y no hay ninguna acción que cambie precios.
 */
import { CalendarClock, PackageCheck } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";

type Money = { netCents: number; taxCents: number; totalCents: number };
export interface CustomTermsView {
  presentation: "global" | "breakdown";
  packageName: string | null;
  currency: string;
  interval: "month" | "year";
  included: Array<{ name: string; description: string | null; kind: "product" | "service"; recurring: boolean; quantity: number; conditions: string | null }>;
  breakdown: null | { lines: Array<{ name: string; quantity: number; baseCents: number; adjustments: Array<{ label: string; cents: number }>; netCents: number; taxRateBp: number }> };
  recurring: Money & { taxes: Array<{ rateBp: number; baseCents: number; taxCents: number }> };
  oneTime: Array<{ name: string; description: string | null; at: number; netCents: number; taxRateBp: number; taxCents: number; totalCents: number }>;
  onceAdjustments: Array<{ label: string; cents: number }>;
  first: Money;
  validity: { from: number | null; to: number | null; afterEnd: string | null; afterEndText: string | null };
  scheduledChanges: Array<Money & { at: number }>;
  conditions: string | null;
  timeZone: string;
}
export interface CustomTerms {
  current: CustomTermsView;
  today: Money;
  upcoming: CustomTermsView | null;
  renewsAt: number | null;
  timeZone: string;
}

export function CustomTermsSection({ terms }: { terms: CustomTerms }) {
  const { t, format: fm } = useI18n();
  const money = (cents: number, currency: string) => fm.currency(cents / 100, currency);
  const percent = (bp: number) => `${fm.number(bp / 100, { maximumFractionDigits: 2 })} %`;
  // Las fechas del acuerdo se presentan en la hora peninsular (la del contrato)
  const timeZone = terms.timeZone || "Europe/Madrid";
  const fmtDate = (ms: number) => fm.date(ms, { day: "numeric", month: "long", year: "numeric", timeZone });
  const v = terms.current;
  const per = v.interval === "year" ? t("subscription.terms.perYear") : t("subscription.terms.perMonth");
  const m = (c: number) => money(c, v.currency);
  const changed = terms.today.netCents !== v.recurring.netCents;
  return (
    <section className="rounded-xl border border-border bg-card p-6 space-y-4" aria-labelledby="sub-custom-terms" data-testid="custom-terms">
      <h2 id="sub-custom-terms" className="font-semibold text-foreground flex items-center gap-2">
        <PackageCheck className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
        {v.packageName ?? t("subscription.terms.defaultTitle")}
      </h2>
      <div>
        <h3 className="mb-1 text-sm font-medium text-foreground">{t("subscription.terms.included")}</h3>
        <ul className="list-disc pl-5 text-sm text-foreground space-y-0.5">
          {v.included.map((l, i) => (
            <li key={i}>
              {l.name}
              {l.quantity > 1 ? ` × ${l.quantity}` : ""}
              {!l.recurring && <span className="text-muted-foreground">{t("subscription.terms.oneOff")}</span>}
              {l.description && <span className="text-muted-foreground"> · {l.description}</span>}
            </li>
          ))}
        </ul>
      </div>
      {v.breakdown && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="custom-terms-breakdown">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 pr-3 font-normal">{t("subscription.terms.colConcept")}</th>
                <th className="py-1 pr-3 font-normal text-right">{t("subscription.terms.colPrice", { per })}</th>
                <th className="py-1 pr-3 font-normal text-right">{t("subscription.terms.colAdjust")}</th>
                <th className="py-1 font-normal text-right">{t("subscription.terms.colAmount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {v.breakdown.lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-1.5 pr-3 text-foreground">
                    {l.name}
                    {l.quantity > 1 ? ` × ${l.quantity}` : ""}
                  </td>
                  <td className="py-1.5 pr-3 text-right text-foreground">{m(l.baseCents)}</td>
                  <td className="py-1.5 pr-3 text-right text-muted-foreground">{l.adjustments.length ? l.adjustments.map((a) => `${a.label}: ${m(a.cents)}`).join("; ") : "—"}</td>
                  <td className="py-1.5 text-right font-medium text-foreground">{m(l.netCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <dl className="grid gap-4 sm:grid-cols-3 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("subscription.terms.fee", { label: v.presentation === "global" ? t("subscription.terms.globalFee") : t("subscription.terms.negotiated"), interval: v.interval === "year" ? t("subscription.common.perYear") : t("subscription.common.perMonth") })}</dt>
          <dd className="font-medium text-foreground" data-testid="custom-terms-fee">
            {m(terms.today.netCents)} {per}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("subscription.terms.taxes")}</dt>
          <dd className="font-medium text-foreground">
            {m(terms.today.taxCents)}
            {!changed && v.recurring.taxes.length > 0 && <span className="text-muted-foreground font-normal"> ({v.recurring.taxes.map((g) => t("subscription.terms.vat", { pct: percent(g.rateBp) })).join(", ")})</span>}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("subscription.terms.total")}</dt>
          <dd className="font-medium text-foreground">
            {m(terms.today.totalCents)} {per}
          </dd>
        </div>
      </dl>
      {(v.oneTime.length > 0 || v.onceAdjustments.length > 0) && (
        <div>
          <h3 className="mb-1 text-sm font-medium text-foreground">{t("subscription.terms.oneTimeTitle")}</h3>
          <ul className="text-sm text-foreground space-y-0.5">
            {v.oneTime.map((c, i) => (
              <li key={i}>
                {t("subscription.terms.oneTimeLine", { name: c.name, net: m(c.netCents), total: m(c.totalCents) })}
              </li>
            ))}
            {v.onceAdjustments.map((a, i) => (
              <li key={`a${i}`}>
                {t("subscription.terms.onceAdjust", { label: a.label, amount: m(a.cents) })}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-sm text-foreground space-y-1">
        <p className="flex items-center gap-1.5">
          <CalendarClock className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          {v.validity.to === null ? t("subscription.terms.noEnd") : t("subscription.terms.until", { date: fmtDate(v.validity.to) })}
          {terms.renewsAt && t("subscription.terms.renews", { date: fmtDate(terms.renewsAt) })}
        </p>
        {v.scheduledChanges.map((c, i) => (
          <p key={i} className="text-muted-foreground">
            {t("subscription.terms.since", { date: fmtDate(c.at), amount: m(c.netCents), per })}
          </p>
        ))}
        {v.validity.afterEndText && <p className="text-muted-foreground">{v.validity.afterEndText}</p>}
        {terms.upcoming && terms.upcoming.validity.from !== null && (
          <p className="text-muted-foreground">
            {t("subscription.terms.upcoming", { date: fmtDate(terms.upcoming.validity.from), amount: money(terms.upcoming.recurring.netCents, terms.upcoming.currency), per: terms.upcoming.interval === "year" ? t("subscription.terms.perYear") : t("subscription.terms.perMonth") })}
          </p>
        )}
        {v.conditions && <p className="text-muted-foreground whitespace-pre-line">{t("subscription.terms.special")} {v.conditions}</p>}
      </div>
      <p className="text-xs text-muted-foreground">{t("subscription.terms.footer")}</p>
    </section>
  );
}
