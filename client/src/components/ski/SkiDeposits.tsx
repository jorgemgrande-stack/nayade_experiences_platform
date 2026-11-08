/**
 * Ski Net · Fianzas del alquiler (incluidas en la capacidad ski-rental): panel de la fianza en cada entrega (cobro al
 * entregar, liquidación al devolver con fotos y justificante, cargos por daños cobrados en el TPV), tablero de fianzas
 * abiertas con los totales del día para el cierre de caja, e importes por modelo o tipo de material.
 * Criterio contable en shared/skiDeposits.ts: la fianza no es venta; lo retenido por daños sí (ticket del TPV).
 */
import { useMemo, useState } from "react";
import { Camera, Printer, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { useAsk } from "@/components/ski/AskDialog";
import { euros, toastRental, typeLabel, type RentalCtx } from "@/components/ski/SkiRentalShell";
import {
  CHARGE_STATUS_LABEL,
  DEPOSIT_METHOD_LABEL,
  DEPOSIT_STATUS_LABEL,
  PAY_METHOD_LABEL,
  PAY_METHODS,
  needsCashSession,
  parseEurosToCents,
  planSettlement,
  type DepositMethod,
  type DepositStatus,
  type PayMethod,
} from "@shared/skiDeposits";

const statusVariant = (s: DepositStatus) => (s === "held" || s === "settling" ? "default" : s === "refunded" ? "secondary" : "destructive") as "default" | "secondary" | "destructive";
const centsInput = (c: number) => (c / 100).toFixed(2).replace(".", ",");
const newKey = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const EVENT_LABEL: Record<string, string> = {
  collected: "Fianza cobrada",
  refunded: "Fianza devuelta",
  retained: "Retenida por daños (venta en el TPV)",
  charge_created: "Cargo por daños pendiente",
  charge_paid: "Cargo por daños cobrado",
  charge_cancelled: "Cargo por daños anulado",
};

function CashSessionSelect({ ctx, value, onChange, id }: { ctx: RentalCtx; value: number | null; onChange: (v: number | null) => void; id: string }) {
  const q = trpc.skiRental.depositCashSessions.useQuery({ siteId: ctx.siteId });
  const rows = q.data ?? [];
  if (q.isLoading) return <p className="text-xs text-muted-foreground">Cargando cajas…</p>;
  if (!rows.length) return <p className="text-xs text-destructive">No hay ninguna caja abierta en esta sede: ábrela en el TPV.</p>;
  return (
    <select id={id} className={selectClass} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">Elige la caja abierta…</option>
      {rows.map((s) => (
        <option key={s.id} value={s.id}>
          {s.registerName} · sesión #{s.id} · {s.cashierName}
        </option>
      ))}
    </select>
  );
}

function RegisterDeposit({ ctx, deliveryId, suggestedCents }: { ctx: RentalCtx; deliveryId: number; suggestedCents: number }) {
  const utils = trpc.useUtils();
  const [amount, setAmount] = useState(suggestedCents > 0 ? centsInput(suggestedCents) : "");
  const [method, setMethod] = useState<DepositMethod>("cash");
  const [sessionId, setSession] = useState<number | null>(null);
  const [ref, setRef] = useState("");
  const reg = trpc.skiRental.registerDeposit.useMutation({
    onSuccess: (r) => {
      toast.success(r.replayed ? "La fianza ya estaba registrada" : "Fianza cobrada");
      utils.skiRental.depositForDelivery.invalidate();
      utils.skiRental.listDeposits.invalidate();
      utils.skiRental.depositTotals.invalidate();
    },
    onError: toastRental,
  });
  const cents = parseEurosToCents(amount);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!cents) return toast.error("Indica el importe de la fianza");
        reg.mutate({ siteId: ctx.siteId, deliveryId, amountCents: cents, method, sessionId: method === "cash" || sessionId != null ? sessionId : null, externalRef: method === "external" ? ref : null });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="dp-amount" label="Importe de la fianza (€)" required>
          <Input id="dp-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" required />
        </FormField>
        <FormField id="dp-method" label="Forma de cobro">
          <select id="dp-method" className={selectClass} value={method} onChange={(e) => setMethod(e.target.value as DepositMethod)}>
            {(Object.keys(DEPOSIT_METHOD_LABEL) as DepositMethod[]).map((m) => (
              <option key={m} value={m}>
                {DEPOSIT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </FormField>
        {method === "cash" && (
          <FormField id="dp-session" label="Caja donde entra el efectivo" required>
            <CashSessionSelect ctx={ctx} id="dp-session" value={sessionId} onChange={setSession} />
          </FormField>
        )}
        {method === "external" && (
          <FormField id="dp-ref" label="Referencia de la retención" required>
            <Input id="dp-ref" value={ref} onChange={(e) => setRef(e.target.value)} maxLength={120} placeholder="Nº de preautorización" required />
          </FormField>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {suggestedCents > 0 ? `Sugerida según el material: ${euros(suggestedCents)}. ` : ""}
        La fianza no es una venta: no genera ticket ni IVA. {method === "card" ? "Cóbrala en el datáfono." : method === "external" ? "Queda anotada; el cobro se hace fuera del Core." : "Entra en la caja como entrada manual."}
      </p>
      <Button type="submit" disabled={reg.isPending || !cents}>
        Cobrar fianza
      </Button>
    </form>
  );
}

function SettleDeposit({ ctx, deposit, suggestedDamageCents, returned }: { ctx: RentalCtx; deposit: { id: number; amountCents: number; method: DepositMethod }; suggestedDamageCents: number; returned: boolean }) {
  const utils = trpc.useUtils();
  const [mode, setMode] = useState<"full" | "retain">(suggestedDamageCents > 0 ? "retain" : "full");
  const [damage, setDamage] = useState(suggestedDamageCents > 0 ? centsInput(suggestedDamageCents) : "");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [sessionId, setSession] = useState<number | null>(null);
  const settle = trpc.skiRental.settleDeposit.useMutation({
    onSuccess: (r) => {
      toast.success(r.replayed ? "La fianza ya estaba liquidada" : `Fianza liquidada: ${DEPOSIT_STATUS_LABEL[r.deposit.status as DepositStatus]}${r.ticketNumber ? ` · ticket ${r.ticketNumber}` : ""}`);
      utils.skiRental.depositForDelivery.invalidate();
      utils.skiRental.listDeposits.invalidate();
      utils.skiRental.depositTotals.invalidate();
    },
    onError: toastRental,
  });
  const damageCents = mode === "full" ? 0 : (parseEurosToCents(damage) ?? 0);
  const plan = useMemo(() => {
    try {
      return planSettlement(deposit.amountCents, damageCents);
    } catch {
      return null;
    }
  }, [deposit.amountCents, damageCents]);
  if (!returned) return <p className="text-xs text-muted-foreground">La fianza se liquida cuando se haya devuelto todo el material de la entrega.</p>;
  const session = plan ? needsCashSession(deposit.method, plan) : deposit.method === "cash";
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!plan) return toast.error("Importe de daños no válido");
        settle.mutate({ siteId: ctx.siteId, depositId: deposit.id, damageCents, reason: mode === "retain" ? reason : null, note: note || null, sessionId: session ? sessionId : null });
      }}
    >
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Liquidación">
        <Button type="button" size="sm" role="radio" aria-checked={mode === "full"} variant={mode === "full" ? "default" : "outline"} onClick={() => setMode("full")}>
          Devolver toda la fianza
        </Button>
        <Button type="button" size="sm" role="radio" aria-checked={mode === "retain"} variant={mode === "retain" ? "default" : "outline"} onClick={() => setMode("retain")}>
          Retener por daños o faltas
        </Button>
      </div>
      {mode === "retain" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField id="st-damage" label="Importe de los daños (€)" required>
            <Input id="st-damage" inputMode="decimal" value={damage} onChange={(e) => setDamage(e.target.value)} placeholder="0,00" required />
          </FormField>
          <FormField id="st-reason" label="Motivo" required>
            <Input id="st-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Canto roto, fijación dañada, bastón perdido…" required />
          </FormField>
        </div>
      )}
      <FormField id="st-note" label="Nota (opcional)">
        <Textarea id="st-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </FormField>
      {session && (
        <FormField id="st-session" label={deposit.method === "cash" ? "Caja de donde sale el efectivo" : "Caja donde se registra el cargo por daños"} required>
          <CashSessionSelect ctx={ctx} id="st-session" value={sessionId} onChange={setSession} />
        </FormField>
      )}
      {plan && (
        <ul className="space-y-0.5 rounded-md bg-muted px-3 py-2 text-sm text-foreground">
          <li>Se devuelve: {euros(plan.refundCents)}{deposit.method === "card" && plan.refundCents > 0 ? " (en el datáfono)" : deposit.method === "external" && plan.refundCents > 0 ? " (liberar la retención)" : ""}</li>
          <li>Se retiene: {euros(plan.retainedCents)}{plan.retainedCents > 0 ? " · venta «Cargo por daños» en el TPV, con ticket" : ""}</li>
          {plan.extraChargeCents > 0 && <li className="text-destructive">La fianza no cubre {euros(plan.extraChargeCents)}: queda como cargo pendiente del cliente.</li>}
        </ul>
      )}
      <Button type="submit" disabled={settle.isPending || !plan || (session && sessionId == null)}>
        Liquidar fianza
      </Button>
    </form>
  );
}

function Photos({ ctx, depositId, photos, enabled }: { ctx: RentalCtx; depositId: number; photos: Array<{ id: number; fileUrl: string; fileName: string }>; enabled: boolean }) {
  const utils = trpc.useUtils();
  const add = trpc.skiRental.addDepositPhoto.useMutation({
    onSuccess: () => {
      toast.success("Foto añadida");
      utils.skiRental.depositForDelivery.invalidate();
    },
    onError: toastRental,
  });
  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast.error("La foto ocupa demasiado (5 MB como mucho)");
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = String(reader.result).split(",")[1] ?? "";
      add.mutate({ siteId: ctx.siteId, depositId, fileName: f.name, mimeType: f.type, base64: b64 });
    };
    reader.readAsDataURL(f);
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <a key={p.id} href={p.fileUrl} target="_blank" rel="noreferrer" className="break-all text-xs text-primary underline">
            {p.fileName}
          </a>
        ))}
      </div>
      {ctx.canWrite && !enabled && <p className="text-xs text-muted-foreground">Las fotos de los daños necesitan el almacén privado de ficheros, que no está activo: describe los daños en la nota.</p>}
      {ctx.canWrite && enabled && (
        <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Camera className="h-4 w-4" aria-hidden="true" />
          Añadir foto de los daños
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" disabled={add.isPending} onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      )}
    </div>
  );
}

function Charges({ ctx, deliveryId, charges }: { ctx: RentalCtx; deliveryId: number; charges: Array<{ id: number; amountCents: number; reason: string; status: string; tpvSaleId: number | null; payMethod: string | null }> }) {
  const utils = trpc.useUtils();
  const { ask, dialog } = useAsk();
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  const [paying, setPaying] = useState<number | null>(null);
  const [sessionId, setSession] = useState<number | null>(null);
  const [method, setMethod] = useState<PayMethod>("card");
  const refresh = () => {
    utils.skiRental.depositForDelivery.invalidate();
    utils.skiRental.listDeposits.invalidate();
    utils.skiRental.depositTotals.invalidate();
  };
  const create = trpc.skiRental.createDamageCharge.useMutation({
    onSuccess: () => {
      toast.success("Cargo por daños pendiente de cobro");
      setAdding(false);
      setAmount("");
      setReason("");
      setKey(newKey());
      refresh();
    },
    onError: toastRental,
  });
  const pay = trpc.skiRental.payDamageCharge.useMutation({
    onSuccess: (r) => {
      toast.success(r.replayed ? "El cargo ya estaba cobrado" : `Cargo cobrado${r.ticketNumber ? ` · ticket ${r.ticketNumber}` : ""}`);
      setPaying(null);
      refresh();
    },
    onError: toastRental,
  });
  const cancel = trpc.skiRental.cancelDamageCharge.useMutation({ onSuccess: () => (toast.success("Cargo anulado"), refresh()), onError: toastRental });
  return (
    <div className="space-y-2">
      {charges.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {charges.map((c) => (
            <li key={c.id} className="space-y-2 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-words">
                  {euros(c.amountCents)} · {c.reason}
                </span>
                <Badge variant={c.status === "paid" ? "secondary" : c.status === "cancelled" ? "outline" : "destructive"}>
                  {CHARGE_STATUS_LABEL[c.status as keyof typeof CHARGE_STATUS_LABEL] ?? c.status}
                  {c.status === "paid" && c.payMethod ? ` · ${PAY_METHOD_LABEL[c.payMethod as PayMethod] ?? c.payMethod}` : ""}
                </Badge>
              </div>
              {ctx.canWrite && (c.status === "pending" || c.status === "paying") && (
                paying === c.id ? (
                  <div className="flex flex-wrap items-end gap-2">
                    <CashSessionSelect ctx={ctx} id={`ch-s-${c.id}`} value={sessionId} onChange={setSession} />
                    <select aria-label="Forma de pago" className={`${selectClass} w-36`} value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
                      {PAY_METHODS.map((m) => (
                        <option key={m} value={m}>
                          {PAY_METHOD_LABEL[m]}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" disabled={pay.isPending || sessionId == null} onClick={() => pay.mutate({ siteId: ctx.siteId, chargeId: c.id, sessionId: sessionId!, method })}>
                      Cobrar en el TPV
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPaying(null)}>
                      Cancelar
                    </Button>
                  </div>
                ) : (
                  <span className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => setPaying(c.id)}>
                      Cobrar
                    </Button>
                    {c.status === "pending" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={cancel.isPending}
                        onClick={async () => {
                          const r = await ask({ title: "Anular el cargo", label: "Motivo de la anulación", required: true, confirmLabel: "Anular" });
                          if (r) cancel.mutate({ siteId: ctx.siteId, chargeId: c.id, reason: r });
                        }}
                      >
                        Anular
                      </Button>
                    )}
                  </span>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {ctx.canWrite &&
        (adding ? (
          <form
            className="grid gap-2 sm:grid-cols-[8rem_1fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const cents = parseEurosToCents(amount);
              if (!cents) return toast.error("Importe no válido");
              create.mutate({ siteId: ctx.siteId, deliveryId, amountCents: cents, reason, requestKey: key });
            }}
          >
            <FormField id="ch-amount" label="Importe (€)" required>
              <Input id="ch-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </FormField>
            <FormField id="ch-reason" label="Motivo" required>
              <Input id="ch-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} required />
            </FormField>
            <Button type="submit" size="sm" disabled={create.isPending}>
              Añadir cargo
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            Cargo por daños adicional
          </Button>
        ))}
      <p className="text-xs text-muted-foreground">Los cargos por daños se cobran en el TPV del Core (ticket con IVA). El cobro por enlace de pago no está disponible para el alquiler: el cargo queda pendiente y visible hasta cobrarlo en el mostrador.</p>
      {dialog}
    </div>
  );
}

/** Justificante imprimible de la fianza: cobro, liquidación y cargos con su caja o su ticket. */
function Receipt({ data }: { data: { delivery: { id: number; customerName: string }; deposit: { id: number; amountCents: number; method: DepositMethod; status: DepositStatus; externalRef: string | null; settleReason: string | null; settleNote: string | null }; events: Array<{ id: number; kind: string; amountCents: number; method: string | null; cashSessionId: number | null; tpvSaleId: number | null; note: string | null; createdAt: number; actor: string }> } }) {
  const d = data.deposit;
  return (
    <div id={`ski-deposit-receipt-${d.id}`} className="space-y-2 rounded-md border border-dashed border-border p-3 text-xs text-foreground">
      <p className="font-semibold">Justificante de fianza #{d.id} · alquiler #{data.delivery.id}</p>
      <p>
        Cliente: {data.delivery.customerName} · Fianza {euros(d.amountCents)} ({DEPOSIT_METHOD_LABEL[d.method]}
        {d.externalRef ? ` · ref. ${d.externalRef}` : ""}) · {DEPOSIT_STATUS_LABEL[d.status]}
      </p>
      <ul className="space-y-0.5">
        {data.events.map((e) => (
          <li key={e.id} className="break-words">
            {new Date(e.createdAt).toLocaleString("es-ES")} · {EVENT_LABEL[e.kind] ?? e.kind} · {euros(e.amountCents)}
            {e.cashSessionId ? ` · caja sesión #${e.cashSessionId}` : ""}
            {e.tpvSaleId ? ` · venta TPV #${e.tpvSaleId}` : ""}
            {e.note ? ` · ${e.note}` : ""}
          </li>
        ))}
      </ul>
      {d.settleNote && <p className="whitespace-pre-line">Nota: {d.settleNote}</p>}
      <p className="text-muted-foreground">La fianza no es una venta y no lleva IVA. Lo retenido por daños se documenta con el ticket del TPV.</p>
    </div>
  );
}

function printReceipt(id: number) {
  const el = document.getElementById(`ski-deposit-receipt-${id}`);
  if (!el) return;
  const w = window.open("", "_blank", "width=600,height=700");
  if (!w) return toast.error("El navegador ha bloqueado la ventana de impresión");
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Justificante de fianza</title><style>body{font-family:system-ui,sans-serif;font-size:13px;padding:16px}li{margin:4px 0}</style></head><body>${el.innerHTML}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

/** Fianza de una entrega (en el detalle del mostrador). */
export function DepositPanel({ ctx, deliveryId }: { ctx: RentalCtx; deliveryId: number }) {
  const q = trpc.skiRental.depositForDelivery.useQuery({ siteId: ctx.siteId, deliveryId }, { retry: false });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const data = q.data!;
  const dep = data.deposit;
  return (
    <section className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Fianza
        </h3>
        {dep ? (
          <Badge variant={statusVariant(dep.status)}>
            {DEPOSIT_STATUS_LABEL[dep.status]} · {euros(dep.amountCents)} · {DEPOSIT_METHOD_LABEL[dep.method]}
          </Badge>
        ) : (
          <Badge variant="outline">Sin fianza</Badge>
        )}
      </div>
      {!dep && (data.delivery.status === "open" ? ctx.canWrite && <RegisterDeposit ctx={ctx} deliveryId={deliveryId} suggestedCents={data.suggestedCents} /> : <p className="text-xs text-muted-foreground">Esta entrega no tiene fianza.</p>)}
      {dep && (dep.status === "held" || dep.status === "settling") && ctx.canWrite && (
        <>
          {data.damagedLines.length > 0 && (
            <ul className="space-y-0.5 text-xs text-destructive">
              {data.damagedLines.map((l, i) => (
                <li key={i} className="break-words">
                  {l.code}: {l.condition === "lost" ? "perdida" : "con daño"}
                  {l.note ? ` · ${l.note}` : ""}
                  {l.condition === "lost" && l.replacementValueCents != null ? ` · reposición ${euros(l.replacementValueCents)}` : ""}
                </li>
              ))}
            </ul>
          )}
          <SettleDeposit ctx={ctx} deposit={dep} suggestedDamageCents={data.suggestedDamageCents} returned={data.delivery.status === "returned"} />
        </>
      )}
      {dep && <Photos ctx={ctx} depositId={dep.id} photos={data.attachments} enabled={data.photosEnabled} />}
      {dep && (
        <>
          <Receipt data={{ delivery: data.delivery, deposit: dep, events: data.events }} />
          <Button type="button" size="sm" variant="outline" onClick={() => printReceipt(dep.id)}>
            <Printer className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Imprimir justificante
          </Button>
        </>
      )}
      <div className="space-y-1 border-t border-border pt-2">
        <h4 className="text-xs font-semibold text-foreground">Cargos por daños</h4>
        <Charges ctx={ctx} deliveryId={deliveryId} charges={data.charges} />
      </div>
    </section>
  );
}

/** Tablero del mostrador: fianzas en custodia, cargos pendientes y totales del día para el cierre de caja. */
export function DepositsBoard({ ctx, onOpen }: { ctx: RentalCtx; onOpen: (deliveryId: number) => void }) {
  const [status, setStatus] = useState<"open" | "closed">("open");
  const list = trpc.skiRental.listDeposits.useQuery({ siteId: ctx.siteId, status });
  const totals = trpc.skiRental.depositTotals.useQuery({ siteId: ctx.siteId });
  const t = totals.data;
  return (
    <div className="space-y-4">
      {t && (
        <section className="space-y-2 rounded-xl border border-border bg-card p-4" aria-label="Totales del día">
          <h2 className="text-sm font-semibold text-foreground">Fianzas de hoy ({t.day}) · para el cierre de caja</h2>
          <dl className="grid gap-2 text-sm sm:grid-cols-3">
            {(
              [
                ["Cobradas", t.collected],
                ["Devueltas", t.refunded],
                ["Retenidas (ventas por daños)", t.retained],
              ] as const
            ).map(([label, b]) => (
              <div key={label} className="rounded-md bg-muted px-3 py-2">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="font-medium text-foreground">
                  {euros(b.total)} ({b.count})
                </dd>
                <dd className="text-xs text-muted-foreground">
                  Efectivo {euros(b.cash)} · Tarjeta {euros(b.card)} · Externa {euros(b.external)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Efectivo neto de fianzas en caja hoy: <strong className="text-foreground">{euros(t.netCashCents)}</strong> · En custodia ahora: {euros(t.open.total)} ({t.open.count}) · Cargos
            pendientes: {euros(t.chargesPending.total)} ({t.chargesPending.count}) · Cargos cobrados hoy: {euros(t.chargesPaid.total)} ({t.chargesPaid.count})
          </p>
        </section>
      )}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Fianzas">
        {(["open", "closed"] as const).map((s) => (
          <Button key={s} role="tab" aria-selected={status === s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
            {s === "open" ? "Abiertas" : "Liquidadas"}
          </Button>
        ))}
      </div>
      {list.isLoading ? (
        <PanelLoading />
      ) : list.error ? (
        <PanelError error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <>
          {list.data!.deposits.length === 0 ? (
            <p className="text-sm text-muted-foreground">{status === "open" ? "No hay fianzas en custodia." : "Todavía no hay fianzas liquidadas."}</p>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {list.data!.deposits.map((d) => (
                <li key={d.id}>
                  <button type="button" onClick={() => onOpen(d.deliveryId)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="min-w-0 break-words text-sm text-foreground">
                      Alquiler #{d.deliveryId} · {d.customerName}
                      <span className="block text-xs text-muted-foreground">
                        {DEPOSIT_METHOD_LABEL[d.method]} · {new Date(d.collectedAt).toLocaleString("es-ES")}
                      </span>
                    </span>
                    <Badge variant={statusVariant(d.status)}>
                      {DEPOSIT_STATUS_LABEL[d.status]} · {euros(d.amountCents)}
                    </Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.data!.pendingCharges.length > 0 && (
            <section className="space-y-1">
              <h3 className="text-sm font-semibold text-foreground">Cargos por daños pendientes</h3>
              <ul className="divide-y divide-border rounded-xl border border-border bg-card">
                {list.data!.pendingCharges.map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => onOpen(c.deliveryId)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left text-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="min-w-0 break-words text-foreground">
                        Alquiler #{c.deliveryId} · {c.reason}
                      </span>
                      <Badge variant="destructive">{euros(c.amountCents)}</Badge>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

/** Importe de la fianza por tipo de material y, si hace falta, por modelo (el del modelo gana). */
export function DepositRules({ ctx }: { ctx: RentalCtx }) {
  const utils = trpc.useUtils();
  const rules = trpc.skiRental.depositRules.useQuery({ siteId: ctx.siteId });
  const models = trpc.skiRental.listModels.useQuery({ siteId: ctx.siteId });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = trpc.skiRental.setDepositRule.useMutation({
    onSuccess: () => {
      toast.success("Fianza guardada");
      utils.skiRental.depositRules.invalidate();
    },
    onError: toastRental,
  });
  if (rules.isLoading || models.isLoading) return <PanelLoading />;
  if (rules.error) return <PanelError error={rules.error} onRetry={() => rules.refetch()} />;
  const active = new Map((rules.data ?? []).filter((r) => r.active).map((r) => [r.ruleKey, r.amountCents]));
  const row = (key: string, label: string, target: { modelId?: number; assetType?: string }) => {
    const cur = active.get(key);
    const v = draft[key] ?? (cur != null ? centsInput(cur) : "");
    return (
      <li key={key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
        <span className="min-w-0 break-words text-foreground">{label}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Input aria-label={`Fianza de ${label}`} inputMode="decimal" className="h-8 w-24" value={v} placeholder="Sin fianza" disabled={!ctx.canWrite} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
          {ctx.canWrite && (
            <Button
              size="sm"
              variant="outline"
              disabled={save.isPending || draft[key] == null}
              onClick={() => {
                const raw = (draft[key] ?? "").trim();
                const cents = raw ? parseEurosToCents(raw) : null;
                if (raw && !cents) return toast.error("Importe no válido");
                save.mutate({ siteId: ctx.siteId, ...target, amountCents: cents });
              }}
            >
              Guardar
            </Button>
          )}
        </span>
      </li>
    );
  };
  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Fianzas</h2>
      <p className="text-xs text-muted-foreground">Importe por unidad entregada. Se suma por contrato y en el mostrador puede cambiarse. Déjalo vacío para no pedir fianza.</p>
      <h3 className="text-xs font-semibold text-foreground">Por tipo de material</h3>
      <ul className="divide-y divide-border rounded-md border border-border">{ctx.assetTypes.map((t) => row(`type:${t.code}`, t.label, { assetType: t.code }))}</ul>
      {(models.data ?? []).filter((m) => m.active).length > 0 && (
        <>
          <h3 className="text-xs font-semibold text-foreground">Por modelo (opcional)</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {(models.data ?? [])
              .filter((m) => m.active)
              .map((m) => row(`model:${m.id}`, `${m.name}${m.size ? ` ${m.size}` : ""} · ${typeLabel(ctx.assetTypes, m.assetType)}`, { modelId: m.id }))}
          </ul>
        </>
      )}
    </section>
  );
}
