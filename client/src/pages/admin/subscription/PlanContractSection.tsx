/**
 * «Mi plan»: contrato vigente (precio, periodicidad, renovación), estado del cobro y facturas de la empresa.
 * Todo viene del plano de control (subscription.plan); aquí no se calcula ningún importe. Solo la administración.
 */
import { useRef, useState } from "react";
import { AlertTriangle, CalendarClock, FileText, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
const money = (cents: number, currency: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(cents / 100);
const PLAN_NAMES: Record<string, string> = { essential: "Essential", business: "Business", enterprise: "Enterprise" };
const ORDER_STATE: Record<string, { label: string; warn?: boolean }> = {
  active: { label: "Al corriente" },
  past_due: { label: "Cobro pendiente", warn: true },
  suspended: { label: "Suspendida por impago", warn: true },
  cancel_scheduled: { label: "Baja programada", warn: true },
};
const PAYMENT: Record<string, string> = { paid: "Pagada", pending: "Pendiente", failed: "Fallida", refunded: "Devuelta" };

function InvoiceViewer({ id, onClose }: { id: number; onClose: () => void }) {
  const doc = trpc.subscription.invoiceDocument.useQuery({ id }, { retry: false });
  const frame = useRef<HTMLIFrameElement>(null);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Factura</DialogTitle>
        </DialogHeader>
        {doc.isLoading && <p className="text-sm text-muted-foreground">Cargando la factura…</p>}
        {doc.isError && <p className="text-sm text-destructive">{doc.error.message}</p>}
        {doc.data && (
          <>
            {/* Aislada: sin scripts (el mismo origen solo para poder imprimirla desde aquí) */}
            <iframe ref={frame} title="Factura" sandbox="allow-same-origin allow-modals" srcDoc={doc.data} className="h-[70vh] w-full rounded-md border border-border bg-white" />
            <Button type="button" variant="outline" onClick={() => frame.current?.contentWindow?.print()}>
              Imprimir o guardar en PDF
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PlanContractSection({ isTrial }: { isTrial: boolean }) {
  const plan = trpc.subscription.plan.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const [viewing, setViewing] = useState<number | null>(null);
  const p = plan.data;
  if (!p) return null;
  const c = p.contract;
  const st = c ? ORDER_STATE[c.state] : undefined;
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-4" aria-labelledby="sub-contract">
      <h2 id="sub-contract" className="font-semibold text-foreground">Contrato y facturación</h2>
      {!c ? (
        <p className="text-sm text-muted-foreground">
          {isTrial
            ? "Estás en la prueba gratuita: no hay ningún cobro ni contrato todavía. Durante la prueba no se puede comprar ni dar de baja módulos, y los cobros a tus clientes solo funcionan con el entorno de pruebas de tu pasarela."
            : "Tu plan lo gestiona directamente el equipo de Elephant Source. Para cambios, escribe a tu contacto comercial."}
        </p>
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="font-medium text-foreground">{PLAN_NAMES[c.plan] ?? c.plan} · {c.interval === "year" ? "anual" : "mensual"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Importe {c.interval === "year" ? "anual" : "mensual"}</dt>
              <dd className="font-medium text-foreground">{c.recurringNetCents === null ? "Según contrato" : `${money(c.recurringNetCents, c.currency)} + IVA`}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">{p.period?.cancelAt ? "Fin del servicio" : "Próxima renovación"}</dt>
              <dd className="font-medium text-foreground flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                {p.period?.cancelAt ? fmtDate(p.period.cancelAt) : p.period?.renewsAt ? fmtDate(p.period.renewsAt) : "—"}
              </dd>
            </div>
          </dl>
          {c.items.length > 0 && <p className="text-xs text-muted-foreground">Módulos contratados: {c.items.join(", ")}.</p>}
          {st && (
            <div className={st.warn ? "flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200" : "text-sm text-foreground"}>
              {st.warn && <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />}
              <span>
                Estado del cobro: <strong>{st.label}</strong>
                {c.state === "past_due" && c.graceEndsAt && ` · actualiza el método de pago antes del ${fmtDate(c.graceEndsAt)} para evitar la suspensión.`}
              </span>
            </div>
          )}
        </>
      )}
      {p.invoices.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-foreground"><Receipt className="w-4 h-4" aria-hidden="true" /> Facturas</h3>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {p.invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                <span className="font-medium text-foreground">{i.number ?? "—"}</span>
                <span className="text-muted-foreground">{i.periodLabel ?? i.issueDate ?? ""}</span>
                <span className="ml-auto text-foreground">{money(i.totalCents, i.currency)}</span>
                <Badge variant="outline" className="text-[11px]">{i.kind === "rectification" ? "Rectificativa" : (PAYMENT[i.paymentStatus] ?? i.paymentStatus)}</Badge>
                <Button type="button" size="sm" variant="ghost" onClick={() => setViewing(i.id)} aria-label={`Ver la factura ${i.number ?? ""}`}>
                  <FileText className="w-4 h-4" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {viewing !== null && <InvoiceViewer id={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}
