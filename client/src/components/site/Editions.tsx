/**
 * Convocatorias en la web pública (E-4): lista de próximas fechas de los productos REALES de la tienda (nada se copia),
 * con su estado (plazas abiertas, lista de espera, completa, cerrada) y el botón «Solicitar plaza», que abre el
 * formulario de solicitud (entra en el CRM; no hay compra ni cobro). Lo usan la ficha de producto y el bloque Studio
 * «Próximas fechas».
 */
import { useState } from "react";
import { CalendarDays, Clock, Layers, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ProductRequestDialog, type ProductRequestTarget } from "@/components/site/ProductRequestForm";
import { SmartLink } from "@/components/site/SmartLink";
import { canRequestSeat, formatEditionDates, type PublicEditionState } from "@shared/editions";
import { formatEuros, productPath } from "@shared/storefront";
import type { PublicEditionSession } from "@shared/editionSessions";
import { editionSubtitle, eventDurationText, sessionsSummary, startsAtHasTime } from "@shared/editionSummary";
import { cardGridClasses } from "@shared/cardGrid";
import { editionModeText, editionStateText, fillUiText, siteUiText, type SiteUiText } from "@shared/siteUiText";
import { useSiteLocale } from "@/hooks/useSiteLocale";

export interface PublicEditionItem {
  id: number;
  experienceId: number;
  productTitle: string;
  productSlug: string;
  label: string;
  startsAt: number;
  endsAt: number | null;
  timezone: string;
  scheduleNote: string;
  mode: "online" | "presencial" | "hibrido";
  locationNote: string;
  state: PublicEditionState;
  seatsLeft: number | null;
  price: number | null;
  /** Sesiones del paquete (vacío = convocatoria sin sesiones). Nunca traen notas internas. */
  sessions?: PublicEditionSession[];
  /** Categoría del producto (antetítulo de la tarjeta), traducida al idioma de la página si hay traducción validada */
  categoryId?: number | null;
  categoryName?: string | null;
}

const STATE_STYLE: Record<PublicEditionState, string> = {
  open: "bg-primary/10 text-primary",
  waitlist: "bg-secondary text-secondary-foreground",
  full: "bg-secondary text-secondary-foreground",
  closed: "bg-muted text-muted-foreground",
};

function ctaLabel(t: SiteUiText, s: PublicEditionState): string {
  return s === "open" ? t.requestSeat : s === "closed" ? t.editionClosed : t.joinWaitlist;
}

/**
 * Tarjeta comercial de una convocatoria: categoría (o modalidad) como antetítulo, el producto como título, la etiqueta
 * de la convocatoria sin sus fechas como subtítulo, UNA línea de fechas, UNA línea de resumen de sesiones (nunca una
 * hora inventada), lugar y plazas, y un pie con precio, botón de solicitud y enlace a la ficha. La nota de horario solo
 * se pinta cuando no hay sesiones (con sesiones repetiría las fechas). `className`: la medida dentro de la rejilla.
 */
function EditionCard({ e, onRequest, t, locale, detailHref, showProduct, preview, className }: { e: PublicEditionItem; onRequest: (e: PublicEditionItem) => void; t: SiteUiText; locale: string; detailHref: string; showProduct: boolean; preview?: boolean; className?: string }) {
  const sessions = e.sessions ?? [];
  const seats = e.state === "open" && e.seatsLeft != null ? (e.seatsLeft === 1 ? t.oneSeatLeft : fillUiText(t.seatsLeft, { n: e.seatsLeft })) : null;
  // En la propia ficha del producto (showProduct=false) el título es la convocatoria y no hay enlace «ver detalles»
  const subtitleRaw = editionSubtitle(e.label, e.productTitle);
  const title = showProduct ? e.productTitle : subtitleRaw ?? e.productTitle;
  const subtitle = showProduct ? subtitleRaw : null;
  const summary = sessions.length ? sessionsSummary(sessions, { locale, t }) : null;
  const summaryLine = summary ? [summary.count, summary.weekday, summary.time, summary.duration].filter((x): x is string => !!x).join(" · ") : null;
  const duration = sessions.length ? null : eventDurationText(e.startsAt, e.endsAt, e.timezone, t);
  // Con sesiones la hora va en el resumen; sin ellas, solo si el inicio tiene hora real (a medianoche no se pinta «00:00 h»)
  const dates = formatEditionDates(e.startsAt, e.endsAt, e.timezone, !sessions.length && startsAtHasTime(e.startsAt, e.timezone), locale);
  return (
    <li className={cn("flex flex-col rounded-2xl border border-border/50 bg-card p-6 text-card-foreground shadow-sm", className)} data-testid="fecha-convocatoria">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">{e.categoryName || editionModeText(t, e.mode)}</p>
          <h3 className="mt-1 break-words font-heading text-xl font-semibold leading-snug">{title}</h3>
          {subtitle && <p className="mt-0.5 break-words text-sm font-medium text-foreground/80">{subtitle}</p>}
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", STATE_STYLE[e.state])} data-testid="estado-convocatoria">{editionStateText(t, e.state)}</span>
      </div>
      <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
        <li className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span className="first-letter:uppercase">{dates}</span></li>
        {summaryLine && (
          <li className="flex items-start gap-2" data-testid="sesiones-convocatoria">
            <Layers className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span className="break-words">{summaryLine}</span>
          </li>
        )}
        {duration && <li className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span>{duration}</span></li>}
        {!sessions.length && e.scheduleNote && <li className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span className="line-clamp-3 whitespace-pre-line break-words">{e.scheduleNote}</span></li>}
        <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span>{editionModeText(t, e.mode)}{e.locationNote ? ` · ${e.locationNote}` : ""}</span></li>
        {seats && <li className="flex items-start gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span>{seats}</span></li>}
      </ul>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border/60 pt-4">
        <div className="min-w-0">
          {e.price != null && <p className="text-lg font-semibold leading-tight">{formatEuros(e.price)}</p>}
          {showProduct && (
            <SmartLink href={detailHref} preview={preview} className="text-sm text-primary underline-offset-4 hover:underline">
              {t.viewDetails}
            </SmartLink>
          )}
        </div>
        <Button size="sm" className="shrink-0" disabled={!canRequestSeat(e.state)} variant={e.state === "open" ? "default" : "outline"} onClick={() => onRequest(e)} data-testid="solicitar-plaza">
          {ctaLabel(t, e.state)}
        </Button>
      </div>
    </li>
  );
}

/** Próximas fechas visibles. `emptyText` vacío y sin fechas = no pinta nada (salvo en el editor, que lo explica). */
export function EditionsList({
  experienceId,
  productSlug,
  categorySlug,
  limit = 6,
  showProduct = true,
  emptyText = "",
  editing = false,
  preview,
  columns = 3,
}: {
  experienceId?: number;
  productSlug?: string;
  categorySlug?: string;
  limit?: number;
  showProduct?: boolean;
  emptyText?: string;
  editing?: boolean;
  preview?: boolean;
  columns?: 2 | 3;
}) {
  // Textos fijos y convocatorias en el idioma de la página (solo traducciones validadas; sin idioma adicional, como siempre)
  const site = useSiteLocale();
  const t = siteUiText(site.locale);
  const q = trpc.public.getExperiences.useQuery({ limit, offset: 0, editions: { experienceId, productSlug: productSlug || undefined, categorySlug: categorySlug || undefined, ...(site.prefix ? { locale: site.prefix } : {}) } }, { staleTime: 60_000, retry: false });
  const [target, setTarget] = useState<{ t: ProductRequestTarget; open: boolean }>({ t: { productId: 0, productTitle: "" }, open: false });
  const items = (q.data ?? []) as unknown as PublicEditionItem[];
  if (q.isLoading) return <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />;
  if (!items.length) {
    if (emptyText) return <p className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center text-muted-foreground">{emptyText}</p>;
    return editing ? <p className="rounded-2xl border-2 border-dashed border-border bg-muted/50 px-6 py-10 text-center text-sm text-muted-foreground">Aquí aparecerán las próximas convocatorias de tus productos. Ahora mismo no hay ninguna abierta o con fecha futura.</p> : null;
  }
  // Rejilla dinámica: una convocatoria centrada, dos en un contenedor acotado, tres a todo el ancho (ver shared/cardGrid)
  const grid = cardGridClasses(items.length, columns === 3 ? 3 : 2);
  return (
    <>
      <ul className={grid.wrap}>
        {items.map((e) => (
          <EditionCard
            key={e.id}
            e={e}
            className={grid.item}
            showProduct={showProduct}
            t={t}
            locale={site.locale}
            preview={preview}
            detailHref={site.prefix ? `/${site.prefix}${productPath(e.productSlug)}` : productPath(e.productSlug)}
            onRequest={(x) => setTarget({ t: { productId: x.experienceId, productTitle: x.productTitle, editionId: x.id, editionLabel: x.label, withSeats: true, submitLabel: x.state === "open" ? t.requestSeat : t.joinWaitlist }, open: true })}
          />
        ))}
      </ul>
      <ProductRequestDialog target={target.t} open={target.open} onOpenChange={(o) => setTarget((s) => ({ ...s, open: o }))} preview={preview} />
    </>
  );
}

/** Sección «Próximas fechas» de la ficha de un producto (no pinta nada si el producto no tiene convocatorias visibles). */
export function ProductEditionsSection({ productId }: { productId: number }) {
  const site = useSiteLocale();
  const q = trpc.public.getExperiences.useQuery({ limit: 12, offset: 0, editions: { experienceId: productId, ...(site.prefix ? { locale: site.prefix } : {}) } }, { staleTime: 60_000, retry: false });
  if (!q.data || (q.data as unknown[]).length === 0) return null;
  return (
    <section className="mt-12" aria-labelledby="proximas-fechas" data-testid="seccion-fechas">
      <h2 id="proximas-fechas" className="mb-4 text-xl font-heading font-semibold text-foreground">{siteUiText(site.locale).upcomingDates}</h2>
      <EditionsList experienceId={productId} limit={12} showProduct={false} columns={2} />
    </section>
  );
}
