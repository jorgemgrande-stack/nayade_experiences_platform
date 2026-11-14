/**
 * Convocatorias en la web pública (E-4): lista de próximas fechas de los productos REALES de la tienda (nada se copia),
 * con su estado (plazas abiertas, lista de espera, completa, cerrada) y el botón «Solicitar plaza», que abre el
 * formulario de solicitud (entra en el CRM; no hay compra ni cobro). Lo usan la ficha de producto y el bloque Studio
 * «Próximas fechas».
 */
import { useState } from "react";
import { CalendarDays, Clock, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { ProductRequestDialog, type ProductRequestTarget } from "@/components/site/ProductRequestForm";
import { EDITION_MODE_LABELS, PUBLIC_EDITION_STATE_LABELS, canRequestSeat, formatEditionDates, type PublicEditionState } from "@shared/editions";
import { formatEuros } from "@shared/storefront";

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
}

const STATE_STYLE: Record<PublicEditionState, string> = {
  open: "bg-primary/10 text-primary",
  waitlist: "bg-secondary text-secondary-foreground",
  full: "bg-secondary text-secondary-foreground",
  closed: "bg-muted text-muted-foreground",
};

function ctaLabel(s: PublicEditionState): string {
  return s === "open" ? "Solicitar plaza" : s === "closed" ? "Inscripción cerrada" : "Apuntarme a la lista de espera";
}

function EditionCard({ e, showProduct, onRequest }: { e: PublicEditionItem; showProduct: boolean; onRequest: (e: PublicEditionItem) => void }) {
  const seats = e.state === "open" && e.seatsLeft != null ? `${e.seatsLeft === 1 ? "Queda 1 plaza" : `Quedan ${e.seatsLeft} plazas`}` : null;
  return (
    <li className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-sm" data-testid="fecha-convocatoria">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {showProduct && <p className="text-xs font-semibold uppercase tracking-wide text-primary">{e.productTitle}</p>}
          <h3 className="break-words font-heading text-lg font-semibold">{e.label}</h3>
        </div>
        <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", STATE_STYLE[e.state])} data-testid="estado-convocatoria">{PUBLIC_EDITION_STATE_LABELS[e.state]}</span>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
        <li className="flex items-start gap-2"><CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span>{formatEditionDates(e.startsAt, e.endsAt, e.timezone, true)}</span></li>
        {e.scheduleNote && <li className="flex items-start gap-2"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span className="whitespace-pre-line break-words">{e.scheduleNote}</span></li>}
        <li className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span>{EDITION_MODE_LABELS[e.mode].split(" (")[0]}{e.locationNote ? ` · ${e.locationNote}` : ""}</span></li>
        {seats && <li className="flex items-start gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span>{seats}</span></li>}
      </ul>
      <div className="mt-4 flex flex-1 items-end justify-between gap-3">
        <p className="text-base font-semibold">{e.price != null ? formatEuros(e.price) : ""}</p>
        <Button size="sm" disabled={!canRequestSeat(e.state)} variant={e.state === "open" ? "default" : "outline"} onClick={() => onRequest(e)} data-testid="solicitar-plaza">
          {ctaLabel(e.state)}
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
  const q = trpc.public.getExperiences.useQuery({ limit, offset: 0, editions: { experienceId, productSlug: productSlug || undefined, categorySlug: categorySlug || undefined } }, { staleTime: 60_000, retry: false });
  const [target, setTarget] = useState<{ t: ProductRequestTarget; open: boolean }>({ t: { productId: 0, productTitle: "" }, open: false });
  const items = (q.data ?? []) as unknown as PublicEditionItem[];
  if (q.isLoading) return <div className="h-40 animate-pulse rounded-2xl bg-muted" aria-hidden="true" />;
  if (!items.length) {
    if (emptyText) return <p className="rounded-2xl border border-dashed border-border bg-muted/40 px-6 py-8 text-center text-muted-foreground">{emptyText}</p>;
    return editing ? <p className="rounded-2xl border-2 border-dashed border-border bg-muted/50 px-6 py-10 text-center text-sm text-muted-foreground">Aquí aparecerán las próximas convocatorias de tus productos. Ahora mismo no hay ninguna abierta o con fecha futura.</p> : null;
  }
  return (
    <>
      <ul className={cn("grid grid-cols-1 gap-5", columns === 3 ? "md:grid-cols-2 lg:grid-cols-3" : "md:grid-cols-2")}>
        {items.map((e) => (
          <EditionCard
            key={e.id}
            e={e}
            showProduct={showProduct}
            onRequest={(x) => setTarget({ t: { productId: x.experienceId, productTitle: x.productTitle, editionId: x.id, editionLabel: x.label, withSeats: true, submitLabel: x.state === "open" ? "Solicitar plaza" : "Apuntarme a la lista de espera" }, open: true })}
          />
        ))}
      </ul>
      <ProductRequestDialog target={target.t} open={target.open} onOpenChange={(o) => setTarget((s) => ({ ...s, open: o }))} preview={preview} />
    </>
  );
}

/** Sección «Próximas fechas» de la ficha de un producto (no pinta nada si el producto no tiene convocatorias visibles). */
export function ProductEditionsSection({ productId }: { productId: number }) {
  const q = trpc.public.getExperiences.useQuery({ limit: 12, offset: 0, editions: { experienceId: productId } }, { staleTime: 60_000, retry: false });
  if (!q.data || (q.data as unknown[]).length === 0) return null;
  return (
    <section className="mt-12" aria-labelledby="proximas-fechas" data-testid="seccion-fechas">
      <h2 id="proximas-fechas" className="mb-4 text-xl font-heading font-semibold text-foreground">Próximas fechas</h2>
      <EditionsList experienceId={productId} limit={12} showProduct={false} columns={2} />
    </section>
  );
}
