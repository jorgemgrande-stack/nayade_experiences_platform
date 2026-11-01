/**
 * Ficha de producto de Elephant Connect y Elephant Net (/admin/ampliar/:clave): una sola plantilla para todos los
 * productos. Cada sección aparece SOLO si el catálogo trae datos para ella (nada de rellenos):
 *
 *   cabecera (icono, nombre, línea, estado, titular y propuesta de valor) → beneficios → qué incluye → integración
 *   con tu Elephant Core → galería (solo imágenes reales) → para quién → requisitos → precio → condiciones →
 *   preguntas frecuentes → productos relacionados; y la acción según el estado, siempre a mano.
 *
 * «Contratar» reutiliza la compra existente (vista previa → confirmación explícita → compra idempotente →
 * seguimiento) y solo aparece si el producto se vende en línea y las compras están abiertas para esta persona.
 */
import { useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Check, CheckCircle2, Minus, PackagePlus } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { brandHeaders, brandOf, connectAction, PURCHASE_BLOCK_TEXT } from "@shared/connectMarketplace";
import { PriceList, ProductCard, ProductIcon, PurchaseDialog, RequestDialog, StateBadge, type RequestKind } from "@/components/connect/ConnectParts";
import { AMPLIAR_PATH } from "@/components/connect/LockedFeature";
import { useConnectAttempt, useConnectCatalog, useOrderTracking, type ConnectCatalogItem } from "@/components/connect/useConnect";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3" aria-labelledby={`cx-${id}`}>
      <h2 id={`cx-${id}`} className="text-lg font-semibold text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Bullets({ items, icon = "check" }: { items: string[]; icon?: "check" | "minus" | "dot" }) {
  return (
    <ul className="space-y-2 text-sm text-foreground">
      {items.map((x) => (
        <li key={x} className="flex items-start gap-2">
          {icon === "check" && <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />}
          {icon === "minus" && <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          {icon === "dot" && <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
          <span className="min-w-0">{x}</span>
        </li>
      ))}
    </ul>
  );
}

function Terms({ rows }: { rows: Array<[string, string | null]> }) {
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  if (shown.length === 0) return null;
  return (
    <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {shown.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[12rem_1fr] sm:gap-4">
          <dt className="font-medium text-foreground">{k}</dt>
          <dd className="text-muted-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ConnectDetailPage() {
  const params = useParams<{ clave: string }>();
  const key = decodeURIComponent(params.clave ?? "");
  const catalog = useConnectCatalog();
  const item = catalog.items.find((i) => i.key === key) ?? null;
  const { attempt } = useConnectAttempt(key);
  // Un pedido propio en curso se sigue también desde la ficha (p. ej. al volver de la página de pago)
  useOrderTracking(attempt);
  const [dialog, setDialog] = useState<"purchase" | RequestKind | null>(null);
  const data = catalog.data;
  const action = item && data ? connectAction({ state: item.state, kind: item.kind, purchasable: item.purchasable, canPurchase: data.canPurchase, interestEnabled: data.interestEnabled }) : "none";
  const blockText = data?.purchaseBlock ? PURCHASE_BLOCK_TEXT[data.purchaseBlock] : null;
  const showBlock = !!item && item.state === "available" && action === "request" && blockText;
  const brands = data?.brands ?? brandHeaders(null);

  return (
    <AdminLayout>
      <div className="max-w-6xl space-y-6">
        <Link href={AMPLIAR_PATH} className="inline-flex items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Volver a Amplía tu empresa
        </Link>

        {catalog.isLoading && <PanelLoading label="Cargando la ficha…" />}
        {catalog.isError && <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title="No se ha podido cargar la ficha" />}
        {catalog.isSuccess && !item && <p className="text-sm text-muted-foreground">No encontramos este módulo en el catálogo.</p>}

        {item && data && (
          <Sheet
            item={item}
            items={catalog.items}
            brand={brands[brandOf(item)].title}
            actionPanel={
              <ActionPanel item={item} action={action} attemptOrdered={!!attempt && attempt.orderId !== null} showBlock={showBlock ? blockText : null} onOpen={setDialog} />
            }
          />
        )}
      </div>
      {dialog === "purchase" && item && <PurchaseDialog item={item} onClose={() => setDialog(null)} />}
      {(dialog === "info" || dialog === "waitlist" || dialog === "contact") && item && data && (
        <RequestDialog item={item} kind={dialog} supportEmail={data.supportEmail} upgradeUrl={data.upgradeUrl} requestsEnabled={data.requestsEnabled} onClose={() => setDialog(null)} />
      )}
    </AdminLayout>
  );
}

/** Precio resumido y la acción que corresponde al estado (fija en pantallas anchas). */
function ActionPanel({
  item,
  action,
  attemptOrdered,
  showBlock,
  onOpen,
}: {
  item: ConnectCatalogItem;
  action: ReturnType<typeof connectAction>;
  attemptOrdered: boolean;
  showBlock: string | null;
  onOpen: (d: "purchase" | RequestKind) => void;
}) {
  const active = item.state === "active";
  return (
    <aside aria-label="Contratación" className="space-y-4 rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-6">
      <StateBadge state={item.state} long />
      {item.reasons.length > 0 && (
        <ul className="space-y-1 text-sm text-foreground">
          {item.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {active ? (
        <p className="flex items-start gap-2 text-sm text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /> Ya forma parte de tu plataforma.
        </p>
      ) : null}
      <div className="flex flex-col gap-2">
        {action === "purchase" && (
          <Button type="button" onClick={() => onOpen("purchase")}>
            <PackagePlus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Contratar
          </Button>
        )}
        {action === "purchase" && <p className="text-xs text-muted-foreground">Te mostramos el importe exacto antes de confirmar. Se activa cuando el cobro queda verificado.</p>}
        {action === "expand" && (
          <Button asChild>
            <Link href="/admin/suscripcion/modulos">Ampliar desde Módulos y ampliaciones</Link>
          </Button>
        )}
        {action === "request" && (
          <Button type="button" onClick={() => onOpen("info")}>
            Solicitar información
          </Button>
        )}
        {action === "interest" && (
          <Button type="button" onClick={() => onOpen("waitlist")}>
            Me interesa
          </Button>
        )}
        {action === "contact" && (
          <Button type="button" variant="outline" onClick={() => onOpen("contact")}>
            Contactar con el equipo
          </Button>
        )}
        {item.state === "activating" && attemptOrdered && (
          <Button type="button" variant="outline" onClick={() => onOpen("purchase")}>
            Ver el estado del pedido
          </Button>
        )}
        {item.state === "coming_soon" && action === "none" && <p className="text-sm text-muted-foreground">Todavía no se puede contratar.</p>}
        {showBlock && <p className="text-xs text-muted-foreground">{showBlock}</p>}
      </div>
    </aside>
  );
}

function Sheet({ item, items, brand, actionPanel }: { item: ConnectCatalogItem; items: ConnectCatalogItem[]; brand: string; actionPanel: ReactNode }) {
  const s = item.sheet;
  const lead = s.headline ?? item.tagline;
  const intro = s.longDescription ?? item.description;
  const requirements = [...item.requirements, ...item.dependencies.map((d) => `Tener contratado ${d.name}.`)];
  const gallery = s.screenshots;
  const related = s.related.map((k) => items.find((i) => i.key === k)).filter((i): i is ConnectCatalogItem => !!i);
  const terms: Array<[string, string | null]> = [
    ["Modalidad de contratación", s.offer],
    ["Permanencia", s.terms.commitment],
    ["Baja", s.terms.cancellation],
    ["Puesta en marcha", s.terms.activation],
    ["Costes de terceros", item.thirdPartyCosts],
  ];
  const hasPrice = item.state !== "active" || item.prices.length > 0;

  return (
    <article className="space-y-8">
      <header className="overflow-hidden rounded-2xl border border-border bg-card">
        {s.cover && (
          <figure>
            <img src={s.cover.src} alt={s.cover.alt} className="max-h-72 w-full object-cover" loading="lazy" />
            {s.cover.caption && <figcaption className="sr-only">{s.cover.caption}</figcaption>}
          </figure>
        )}
        <div className="space-y-4 p-6 md:p-8">
          <div className="flex flex-wrap items-start gap-4">
            <ProductIcon item={item} size="lg" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{brand}</p>
              <h1 className="break-words text-2xl font-bold leading-tight text-foreground md:text-3xl">{item.name}</h1>
              <StateBadge state={item.state} />
            </div>
          </div>
          {lead && <p className="max-w-3xl text-lg text-foreground">{lead}</p>}
          {s.valueProposition && <p className="max-w-3xl text-base text-muted-foreground">{s.valueProposition}</p>}
          {intro && <p className="max-w-3xl text-sm text-muted-foreground">{intro}</p>}
          {s.problem && (
            <div className="max-w-3xl rounded-xl border border-border bg-muted/40 p-4 text-sm">
              <p className="font-medium text-foreground">El reto que resuelve</p>
              <p className="mt-1 text-muted-foreground">{s.problem}</p>
            </div>
          )}
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 space-y-8 lg:order-1">
          {s.benefits.length > 0 && (
            <Section id="benefits" title="Beneficios">
              <Bullets items={s.benefits} />
            </Section>
          )}
          {(item.includes.length > 0 || s.excludes.length > 0) && (
            <Section id="includes" title="Qué incluye">
              {item.includes.length > 0 && <Bullets items={item.includes} icon="dot" />}
              {s.excludes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">No incluye</p>
                  <Bullets items={s.excludes} icon="minus" />
                </div>
              )}
            </Section>
          )}
          {(s.coreIntegration.length > 0 || s.integrations.length > 0) && (
            <Section id="core" title="Integración con tu Elephant Core">
              {s.coreIntegration.length > 0 && <Bullets items={s.coreIntegration} icon="dot" />}
              {s.integrations.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-foreground">Se conecta con</p>
                  <Bullets items={s.integrations} icon="dot" />
                </div>
              )}
            </Section>
          )}
          {gallery.length > 0 && (
            <Section id="gallery" title="Galería">
              <ul className="grid gap-4 sm:grid-cols-2">
                {gallery.map((m) => (
                  <li key={m.src}>
                    <figure className="overflow-hidden rounded-xl border border-border bg-muted/30">
                      <img src={m.src} alt={m.alt} className="aspect-video w-full object-cover" loading="lazy" />
                      {m.caption && <figcaption className="px-3 py-2 text-xs text-muted-foreground">{m.caption}</figcaption>}
                    </figure>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {item.forWho && (
            <Section id="forwho" title="Para quién">
              <p className="text-sm text-muted-foreground">{item.forWho}</p>
            </Section>
          )}
          {requirements.length > 0 && (
            <Section id="requirements" title="Requisitos">
              <Bullets items={requirements} icon="dot" />
            </Section>
          )}
          {hasPrice && (
            <Section id="price" title="Precio">
              <PriceList prices={item.prices} />
            </Section>
          )}
          {terms.some((t) => !!t[1]) && (
            <Section id="terms" title="Condiciones">
              <Terms rows={terms} />
            </Section>
          )}
          {s.faq.length > 0 && (
            <Section id="faq" title="Preguntas frecuentes">
              <Accordion type="multiple" className="rounded-xl border border-border bg-card px-4">
                {s.faq.map((f, i) => (
                  <AccordionItem key={f.q} value={`faq-${i}`}>
                    <AccordionTrigger className="text-foreground">{f.q}</AccordionTrigger>
                    <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
                  </AccordionItem>
                ))}
              </Accordion>
            </Section>
          )}
          {related.length > 0 && (
            <Section id="related" title="Productos relacionados">
              <ul className="grid gap-4 md:grid-cols-2">
                {related.map((r) => (
                  <li key={r.key}>
                    <ProductCard item={r} headingLevel={3} />
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
        <div className="order-1 lg:order-2">{actionPanel}</div>
      </div>
    </article>
  );
}
