/**
 * Ficha comercial de Elephant Connect (/admin/ampliar/:clave): qué es, qué incluye, precio del catálogo (IVA aparte),
 * condiciones, requisitos, estado para la empresa y la acción que corresponde.
 *
 * «Contratar» reutiliza la compra existente (vista previa → confirmación explícita → compra idempotente →
 * seguimiento): la activación se muestra solo cuando el backend la confirma.
 */
import { useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, PackagePlus } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { connectAction, PURCHASE_BLOCK_TEXT } from "@shared/connectMarketplace";
import { Price, PurchaseDialog, RequestDialog, StateBadge } from "@/components/connect/ConnectParts";
import { AMPLIAR_PATH } from "@/components/connect/LockedFeature";
import { useConnectAttempt, useConnectCatalog, useOrderTracking } from "@/components/connect/useConnect";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
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
  const [dialog, setDialog] = useState<"purchase" | "request" | null>(null);
  const data = catalog.data;
  const action = item && data ? connectAction({ state: item.state, kind: item.kind, purchasable: item.purchasable, canPurchase: data.canPurchase }) : "none";
  const blockText = data?.purchaseBlock ? PURCHASE_BLOCK_TEXT[data.purchaseBlock] : null;
  const showBlock = !!item && item.state === "available" && action === "request" && blockText;
  const requirements = item ? [...item.requirements, ...item.dependencies.map((d) => `Tener contratado ${d.name}.`)] : [];

  return (
    <AdminLayout>
      <div className="max-w-3xl space-y-6">
        <Link href={AMPLIAR_PATH} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Elephant Connect
        </Link>

        {catalog.isLoading && <PanelLoading label="Cargando la ficha…" />}
        {catalog.isError && <PanelError error={catalog.error} onRetry={() => catalog.refetch()} title="No se ha podido cargar la ficha" />}
        {catalog.isSuccess && !item && <p className="text-sm text-muted-foreground">No encontramos este módulo en el catálogo.</p>}

        {item && data && (
          <article className="rounded-2xl border border-border bg-card p-6 space-y-6">
            <header className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h1 className="text-2xl font-bold text-foreground">{item.name}</h1>
                <StateBadge state={item.state} />
              </div>
              {item.tagline && <p className="text-muted-foreground">{item.tagline}</p>}
              {item.state !== "active" && <Price item={item} className="text-base" />}
            </header>

            {item.reasons.length > 0 && (
              <ul className="space-y-1 text-sm text-foreground">
                {item.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}

            {item.description && (
              <Section title="Qué es">
                <p className="text-sm text-muted-foreground">{item.description}</p>
              </Section>
            )}
            {item.forWho && (
              <Section title="Para quién">
                <p className="text-sm text-muted-foreground">{item.forWho}</p>
              </Section>
            )}
            {item.includes.length > 0 && (
              <Section title="Qué incluye">
                <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                  {item.includes.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </Section>
            )}
            {requirements.length > 0 && (
              <Section title="Requisitos">
                <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                  {requirements.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </Section>
            )}

            <Section title="Condiciones">
              <ul className="list-disc pl-5 text-sm text-muted-foreground space-y-1">
                {item.monthly && <li>Precio de catálogo: se suma a tu suscripción en cada renovación{item.monthly.taxIncluded ? "" : "; el IVA se añade aparte"}.</li>}
                {action === "purchase" && <li>Hoy pagas solo la parte proporcional hasta tu próxima renovación; te mostramos el importe exacto antes de confirmar.</li>}
                {action === "purchase" && <li>Se activa cuando el cobro queda verificado. Puedes darlo de baja para el final de cualquier periodo, sin abonos por la parte ya pagada.</li>}
                {item.state === "on_request" && <li>Lo activa nuestro equipo contigo: envíanos una solicitud y te contactamos.</li>}
                {item.thirdPartyCosts && <li>Costes de terceros: {item.thirdPartyCosts}</li>}
              </ul>
            </Section>

            <footer className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              {action === "purchase" && (
                <Button type="button" onClick={() => setDialog("purchase")}>
                  <PackagePlus className="w-4 h-4 mr-1.5" aria-hidden="true" /> Contratar
                </Button>
              )}
              {action === "expand" && (
                <Button asChild>
                  <Link href="/admin/suscripcion/modulos">Ampliar desde Módulos y ampliaciones</Link>
                </Button>
              )}
              {(action === "request" || action === "contact") && (
                <Button type="button" variant={action === "contact" ? "outline" : "default"} onClick={() => setDialog("request")}>
                  {action === "contact" ? "Contactar con el equipo" : "Solicitar"}
                </Button>
              )}
              {item.state === "activating" && attempt && attempt.orderId !== null && (
                <Button type="button" variant="outline" onClick={() => setDialog("purchase")}>
                  Ver el estado del pedido
                </Button>
              )}
              {item.state === "active" && <span className="text-sm text-muted-foreground">Ya forma parte de tu plataforma.</span>}
              {item.state === "coming_soon" && <span className="text-sm text-muted-foreground">Todavía no se puede contratar. Te avisaremos cuando esté disponible.</span>}
              {showBlock && <p className="w-full text-xs text-muted-foreground">{blockText}</p>}
            </footer>
          </article>
        )}
      </div>
      {dialog === "purchase" && item && <PurchaseDialog item={item} onClose={() => setDialog(null)} />}
      {dialog === "request" && item && data && <RequestDialog item={item} supportEmail={data.supportEmail} upgradeUrl={data.upgradeUrl} requestsEnabled={data.requestsEnabled} onClose={() => setDialog(null)} />}
    </AdminLayout>
  );
}
