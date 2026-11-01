/**
 * Bloques reutilizables de la ficha de producto, en el orden y con la visibilidad que publica el catálogo
 * (`layout.blocks`; sin él, el orden por defecto). Un bloque sin datos no aparece. Composición visual con tarjetas e
 * iconos; todo el contenido sale del catálogo.
 */
import type { ReactNode } from "react";
import { ArrowRight, BadgeCheck, Check, CircleSlash, ClipboardList, FileText, HelpCircle, Images, Link2, ListChecks, Minus, Target, TrendingUp, Workflow } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { resolveBlocks, type SheetBlockId } from "@shared/connectCard";
import { ImageKindNote, ProductCard, focalStyle, type ConnectView, type RequestKind } from "./ConnectParts";
import type { ConnectCatalogItem } from "./useConnect";

/** Anclas de la navegación de la ficha. */
export const SHEET_ANCHORS = {
  description: "cx-descripcion",
  features: "cx-funcionalidades",
  integration: "cx-integracion",
  prices: "cx-precios",
  faq: "cx-faq",
} as const;

type Width = "half" | "full";
interface Block {
  id: SheetBlockId;
  width: Width;
  anchor?: string;
  node: ReactNode;
}

function Card({ id, icon, title, tone = "neutral", children, className }: { id?: string; icon: ReactNode; title: string; tone?: "neutral" | "problem" | "result"; children: ReactNode; className?: string }) {
  const headingId = `${id ?? title.replace(/\W+/g, "-").toLowerCase()}-t`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        "h-full scroll-mt-20 rounded-2xl border p-5 sm:p-6",
        tone === "problem" ? "border-primary/50 bg-primary/10" : tone === "result" ? "border-success/40 bg-success/10" : "border-border bg-card",
        className,
      )}
    >
      <h2 id={headingId} className="mb-4 flex items-center gap-3 text-lg font-bold text-foreground sm:text-xl">
        <span aria-hidden="true" className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [&_svg]:h-5 [&_svg]:w-5", tone === "result" ? "bg-success/15 text-success" : "bg-primary/15 cx-red-text")}>
          {icon}
        </span>
        <span className="min-w-0 break-words">{title}</span>
      </h2>
      {children}
    </section>
  );
}

function Checks({ items, icon = "check" }: { items: string[]; icon?: "check" | "minus" }) {
  return (
    <ul className="space-y-2 text-sm text-foreground sm:text-base">
      {items.map((x) => (
        <li key={x} className="flex items-start gap-2.5">
          {icon === "check" ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" /> : <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
          <span className="min-w-0">{x}</span>
        </li>
      ))}
    </ul>
  );
}

function Terms({ rows }: { rows: Array<[string, string | null]> }) {
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  return (
    <dl className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {shown.map(([k, v]) => (
        <div key={k} className="space-y-0.5 px-4 py-3 text-sm">
          <dt className="font-medium text-foreground">{k}</dt>
          <dd className="text-muted-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Une los bloques de media anchura de dos en dos; uno suelto ocupa toda la fila. */
function layoutRows(blocks: Block[]): Array<{ block: Block; full: boolean }> {
  const out: Array<{ block: Block; full: boolean }> = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.width === "half" && blocks[i + 1]?.width === "half") {
      out.push({ block: b, full: false }, { block: blocks[i + 1], full: false });
      i++;
    } else out.push({ block: b, full: true });
  }
  return out;
}

export function SheetBlocks({
  item,
  items,
  view,
  onAction,
}: {
  item: ConnectCatalogItem;
  items: ConnectCatalogItem[];
  view: ConnectView;
  onAction: (item: ConnectCatalogItem, kind: RequestKind) => void;
}) {
  const s = item.sheet;
  const order = resolveBlocks(s.layout);
  const requirements = [...item.requirements, ...item.dependencies.map((d) => `Tener contratado ${d.name}.`)];
  const related = s.related.map((k) => items.find((i) => i.key === k)).filter((i): i is ConnectCatalogItem => !!i);
  const terms: Array<[string, string | null]> = [
    ["Modalidad de contratación", s.offer],
    ["Permanencia", s.terms.commitment],
    ["Baja", s.terms.cancellation],
    ["Puesta en marcha", s.terms.activation],
    ["Costes de terceros", item.thirdPartyCosts],
  ];
  // «Qué incluye» se muestra una sola vez: como funcionalidades (tarjetas) o como lista, lo que el catálogo ponga antes
  const includesAs = order.find((id) => id === "features" || id === "includes") ?? null;
  const blocks: Block[] = [];
  for (const id of order) {
    switch (id) {
      case "problem":
        if (s.problem)
          blocks.push({
            id,
            width: "half",
            node: (
              <Card id="cx-reto" icon={<Target />} title="El reto que resuelve" tone="problem">
                <p className="text-sm text-foreground/90 sm:text-base">{s.problem}</p>
              </Card>
            ),
          });
        break;
      case "benefits":
        if (s.benefits.length > 0)
          blocks.push({
            id,
            width: "half",
            anchor: SHEET_ANCHORS.features,
            node: (
              <Card id="cx-beneficios" icon={<TrendingUp />} title="Beneficios" tone="result">
                <Checks items={s.benefits} />
              </Card>
            ),
          });
        break;
      case "features":
        if (includesAs === "features" && item.includes.length > 0)
          blocks.push({
            id,
            width: "full",
            anchor: SHEET_ANCHORS.features,
            node: (
              <Card id="cx-incluye" icon={<ListChecks />} title="Funcionalidades">
                <ul className="grid gap-3 sm:grid-cols-2">
                  {item.includes.map((x) => (
                    <li key={x} className="flex items-start gap-3 rounded-xl border border-border bg-muted p-3 text-sm text-foreground">
                      <BadgeCheck className="mt-0.5 h-5 w-5 shrink-0 cx-red-text" aria-hidden="true" />
                      <span className="min-w-0">{x}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ),
          });
        break;
      case "howItWorks":
        if (s.howItWorks.length > 0)
          blocks.push({
            id,
            width: "full",
            anchor: SHEET_ANCHORS.features,
            node: (
              <Card id="cx-como-funciona" icon={<Workflow />} title="Cómo funciona">
                <ol className={cn("grid gap-3", s.howItWorks.length >= 3 ? "sm:grid-cols-3 lg:grid-cols-1 2xl:grid-cols-3" : "sm:grid-cols-2")}>
                  {s.howItWorks.map((st, i) => (
                    <li key={st.title} className="relative flex gap-3 rounded-xl border border-border bg-muted p-4">
                      <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground">
                          <span className="sr-only">Paso {i + 1}: </span>
                          {st.title}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">{st.text}</p>
                      </div>
                      {i < s.howItWorks.length - 1 && <ArrowRight aria-hidden="true" className="absolute -right-3 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 text-muted-foreground sm:block lg:hidden 2xl:block" />}
                    </li>
                  ))}
                </ol>
              </Card>
            ),
          });
        break;
      case "includes":
        if (includesAs === "includes" && item.includes.length > 0)
          blocks.push({
            id,
            width: "half",
            anchor: SHEET_ANCHORS.features,
            node: (
              <Card id="cx-incluye" icon={<ListChecks />} title="Qué incluye">
                <Checks items={item.includes} />
              </Card>
            ),
          });
        break;
      case "excludes":
        if (s.excludes.length > 0)
          blocks.push({
            id,
            width: "half",
            node: (
              <Card id="cx-no-incluye" icon={<CircleSlash />} title="No incluye">
                <Checks items={s.excludes} icon="minus" />
              </Card>
            ),
          });
        break;
      case "integration":
        if (s.coreIntegration.length > 0 || s.integrations.length > 0)
          blocks.push({
            id,
            width: "half",
            anchor: SHEET_ANCHORS.integration,
            node: (
              <Card id={SHEET_ANCHORS.integration} icon={<Link2 />} title="Integración con tu Elephant Core">
                <div className="space-y-4">
                  {s.coreIntegration.length > 0 && <Checks items={s.coreIntegration} />}
                  {s.integrations.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">Se conecta con</p>
                      <ul className="flex flex-wrap gap-2">
                        {s.integrations.map((x) => (
                          <li key={x} className="rounded-xl border border-border bg-muted px-3 py-2 text-sm font-medium text-foreground">
                            {x}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </Card>
            ),
          });
        break;
      case "gallery":
        if (s.media.gallery.length > 0 || s.media.video)
          blocks.push({
            id,
            width: "full",
            node: (
              <Card id="cx-galeria" icon={<Images />} title="Galería">
                <div className="space-y-4">
                  {s.media.video && (
                    <div className="overflow-hidden rounded-xl border border-border bg-background">
                      <iframe
                        src={s.media.video.embedUrl}
                        title={s.media.video.title}
                        loading="lazy"
                        sandbox="allow-scripts allow-same-origin allow-presentation"
                        allow="fullscreen; picture-in-picture"
                        referrerPolicy="strict-origin-when-cross-origin"
                        className="aspect-video w-full"
                      />
                    </div>
                  )}
                  {s.media.gallery.length > 0 && (
                    <ul className="grid gap-4 sm:grid-cols-2">
                      {s.media.gallery.map((m) => (
                        <li key={m.src}>
                          <figure className="overflow-hidden rounded-xl border border-border bg-muted">
                            <div className="relative">
                              <img
                                src={m.src}
                                srcSet={m.srcset ?? undefined}
                                sizes={m.srcset ? "(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw" : undefined}
                                width={m.width ?? undefined}
                                height={m.height ?? undefined}
                                alt={m.alt}
                                style={focalStyle(m)}
                                className="aspect-video w-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                              <ImageKindNote kind={m.kind} className="absolute left-2 top-2" />
                            </div>
                            {m.caption && <figcaption className="px-3 py-2 text-xs text-muted-foreground">{m.caption}</figcaption>}
                          </figure>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            ),
          });
        break;
      case "requirements":
        if (requirements.length > 0)
          blocks.push({
            id,
            width: "half",
            node: (
              <Card id="cx-requisitos" icon={<ClipboardList />} title="Requisitos">
                <Checks items={requirements} />
              </Card>
            ),
          });
        break;
      case "terms":
        if (terms.some((t) => !!t[1]))
          blocks.push({
            id,
            width: "half",
            node: (
              <Card id="cx-condiciones" icon={<FileText />} title="Condiciones">
                <Terms rows={terms} />
              </Card>
            ),
          });
        break;
      case "faq":
        if (s.faq.length > 0)
          blocks.push({
            id,
            width: "full",
            anchor: SHEET_ANCHORS.faq,
            node: (
              <Card id={SHEET_ANCHORS.faq} icon={<HelpCircle />} title="Preguntas frecuentes">
                <Accordion type="multiple" className="rounded-xl border border-border bg-muted px-4">
                  {s.faq.map((f, i) => (
                    <AccordionItem key={f.q} value={`faq-${i}`}>
                      <AccordionTrigger className="text-left text-foreground">{f.q}</AccordionTrigger>
                      <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </Card>
            ),
          });
        break;
      case "related":
        if (related.length > 0)
          blocks.push({
            id,
            width: "full",
            node: (
              <section aria-labelledby="cx-relacionados-t" className="space-y-4">
                <h2 id="cx-relacionados-t" className="text-xl font-bold text-foreground">
                  Productos relacionados
                </h2>
                <ul className="grid gap-5 md:grid-cols-2">
                  {related.map((r) => (
                    <li key={r.key}>
                      <ProductCard item={r} view={view} onAction={onAction} headingLevel={3} />
                    </li>
                  ))}
                </ul>
              </section>
            ),
          });
        break;
    }
  }
  // El ancla de funcionalidades va al primero de sus bloques
  const firstFeature = blocks.find((b) => b.anchor === SHEET_ANCHORS.features);
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {layoutRows(blocks).map(({ block, full }) => (
        <div key={block.id} id={block === firstFeature ? SHEET_ANCHORS.features : undefined} className={cn("min-w-0 scroll-mt-20", full && "md:col-span-2")}>
          {block.node}
        </div>
      ))}
    </div>
  );
}

/** Qué anclas tienen destino en esta ficha (la navegación solo muestra esas). */
export function sheetAnchorTargets(item: ConnectCatalogItem): { features: boolean; integration: boolean; faq: boolean } {
  const s = item.sheet;
  const order = new Set(resolveBlocks(s.layout));
  return {
    features: (order.has("benefits") && s.benefits.length > 0) || (order.has("howItWorks") && s.howItWorks.length > 0) || ((order.has("features") || order.has("includes")) && item.includes.length > 0),
    integration: order.has("integration") && (s.coreIntegration.length > 0 || s.integrations.length > 0),
    faq: order.has("faq") && s.faq.length > 0,
  };
}
