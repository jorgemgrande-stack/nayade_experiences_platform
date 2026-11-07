/**
 * Ski Net · Alquiler — Mostrador (/admin/ski/alquiler): entregas abiertas (con aviso de devolución tardía), nueva
 * entrega escaneando cada unidad, contrato con firma por clic en el propio mostrador (tableta o equipo del empleado:
 * nombre escrito, aceptación expresa, IP, navegador y huella del contenido) y devolución unidad a unidad.
 * Fianzas y cargos por daños: fuera de esta versión.
 */
import { useState } from "react";
import { FileSignature, Plus, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { addDays, todayIso } from "@/components/ski/SkiSchoolShell";
import { SkiRentalShell, toastRental, typeLabel, type RentalCtx } from "@/components/ski/SkiRentalShell";

type Line = { code: string; requestedType: string; requestedSize: string; confirmSize: boolean; reason: string };

function DeliveryForm({ ctx, onCreated, onClose }: { ctx: RentalCtx; onCreated: (id: number) => void; onClose: () => void }) {
  const utils = trpc.useUtils();
  const stores = trpc.skiRental.listStores.useQuery({ siteId: ctx.siteId });
  const active = (stores.data ?? []).filter((s) => s.active);
  const [storeId, setStoreId] = useState<number | null>(null);
  const [customerName, setCustomer] = useState("");
  const [startDate, setStart] = useState(todayIso());
  const [expectedReturnDate, setEnd] = useState(addDays(todayIso(), 1));
  const [reservation, setReservation] = useState("");
  const blank = (): Line => ({ code: "", requestedType: ctx.assetTypes[0]?.code ?? "", requestedSize: "", confirmSize: false, reason: "" });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const create = trpc.skiRental.createDelivery.useMutation({
    onSuccess: (d) => {
      toast.success("Material entregado. Falta la firma del contrato.");
      utils.skiRental.listDeliveries.invalidate();
      utils.skiRental.listModels.invalidate();
      onCreated(d.id);
    },
    onError: toastRental,
  });
  if (stores.isLoading) return <PanelLoading />;
  if (stores.error) return <PanelError error={stores.error} onRetry={() => stores.refetch()} />;
  if (active.length === 0) return <p className="text-sm text-muted-foreground">Antes de entregar material, da de alta una tienda en «Tiendas y contrato».</p>;
  const sid = storeId ?? active[0].id;
  const set = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({
          siteId: ctx.siteId,
          storeId: sid,
          customerName,
          startDate,
          expectedReturnDate,
          reservationId: reservation ? Number(reservation) : null,
          lines: lines.filter((l) => l.code.trim()).map((l) => ({ code: l.code, requestedType: l.requestedType, requestedSize: l.requestedSize || null, confirmSize: l.confirmSize, reason: l.reason || null })),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="dl-store" label="Tienda">
          <select id="dl-store" className={selectClass} value={sid} onChange={(e) => setStoreId(Number(e.target.value))}>
            {active.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="dl-customer" label="Cliente" required>
          <Input id="dl-customer" value={customerName} onChange={(e) => setCustomer(e.target.value)} maxLength={120} required />
        </FormField>
        <FormField id="dl-start" label="Entrega">
          <Input id="dl-start" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} required />
        </FormField>
        <FormField id="dl-end" label="Devolución prevista">
          <Input id="dl-end" type="date" value={expectedReturnDate} onChange={(e) => setEnd(e.target.value)} required />
        </FormField>
        <FormField id="dl-res" label="Nº de reserva (opcional)">
          <Input id="dl-res" inputMode="numeric" value={reservation} onChange={(e) => setReservation(e.target.value.replace(/\D/g, ""))} />
        </FormField>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-foreground">Material (escanea cada unidad)</legend>
        {lines.map((l, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-border p-2">
            <div className="flex flex-wrap items-end gap-2">
              <Input aria-label="Código de la unidad" placeholder="Código" className="w-40 font-mono" value={l.code} onChange={(e) => set(i, { code: e.target.value })} autoComplete="off" />
              <select aria-label="Tipo pedido" className={`${selectClass} w-44`} value={l.requestedType} onChange={(e) => set(i, { requestedType: e.target.value })}>
                {ctx.assetTypes.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
              <Input aria-label="Talla pedida" placeholder="Talla pedida" className="w-28" value={l.requestedSize} onChange={(e) => set(i, { requestedSize: e.target.value })} />
              <Button type="button" variant="ghost" size="icon" aria-label="Quitar" onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [blank()])}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <label className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={l.confirmSize} onChange={(e) => set(i, { confirmSize: e.target.checked })} />
              Talla distinta confirmada
              {l.confirmSize && <Input aria-label="Motivo" placeholder="Motivo" className="h-8 w-56" value={l.reason} onChange={(e) => set(i, { reason: e.target.value })} maxLength={200} />}
            </label>
          </div>
        ))}
        <Button type="button" size="sm" variant="outline" onClick={() => setLines([...lines, blank()])}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Otra unidad
        </Button>
      </fieldset>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={create.isPending}>
          Entregar
        </Button>
      </DialogFooter>
    </form>
  );
}

function Contract({ ctx, deliveryId, contract, customerName }: { ctx: RentalCtx; deliveryId: number; customerName: string; contract: { status: string; content: string; contentHash: string; signerName: string | null; signedAt: string | null; signedIp: string | null; termsVersion: number } }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(customerName);
  const [accepted, setAccepted] = useState(false);
  const sign = trpc.skiRental.signContract.useMutation({
    onSuccess: () => {
      toast.success("Contrato firmado");
      utils.skiRental.getDelivery.invalidate();
      utils.skiRental.listDeliveries.invalidate();
    },
    onError: toastRental,
  });
  let terms = "";
  let lines: Array<{ code: string; model: string; size: string | null }> = [];
  try {
    const c = JSON.parse(contract.content);
    terms = String(c.terms ?? "");
    lines = c.lines ?? [];
  } catch {
    terms = "";
  }
  return (
    <section className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <FileSignature className="h-4 w-4" aria-hidden="true" />
          Contrato (versión {contract.termsVersion})
        </h3>
        <Badge variant={contract.status === "signed" ? "default" : "destructive"}>{contract.status === "signed" ? "Firmado" : "Pendiente de firma"}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">Material: {lines.map((l) => `${l.code} (${l.model}${l.size ? ` ${l.size}` : ""})`).join(", ")}</p>
      <div className="max-h-48 overflow-y-auto whitespace-pre-line rounded-md bg-muted px-3 py-2 text-xs text-foreground">{terms}</div>
      {contract.status === "signed" ? (
        <p className="break-all text-xs text-muted-foreground">
          Firmado por {contract.signerName} el {contract.signedAt ? new Date(contract.signedAt).toLocaleString("es-ES") : "—"} desde {contract.signedIp ?? "IP desconocida"} · huella {contract.contentHash}
        </p>
      ) : (
        ctx.canWrite && (
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              sign.mutate({ siteId: ctx.siteId, deliveryId, signerName: name, accepted });
            }}
          >
            <FormField id="sg-name" label="Nombre de quien firma" required>
              <Input id="sg-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
            </FormField>
            <label className="flex items-start gap-2 text-sm text-foreground">
              <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
              He leído y acepto las condiciones del alquiler.
            </label>
            <Button type="submit" disabled={!accepted || sign.isPending}>
              Firmar
            </Button>
            <p className="text-xs text-muted-foreground">El cliente firma en este equipo. Se guardan su nombre, la fecha, la IP, el navegador y la huella del contrato.</p>
          </form>
        )
      )}
    </section>
  );
}

function DeliveryDetail({ ctx, deliveryId }: { ctx: RentalCtx; deliveryId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.skiRental.getDelivery.useQuery({ siteId: ctx.siteId, deliveryId });
  const ret = trpc.skiRental.returnLine.useMutation({
    onSuccess: (r) => {
      toast.success(r.deliveryClosed ? "Entrega devuelta por completo" : "Unidad devuelta");
      utils.skiRental.getDelivery.invalidate();
      utils.skiRental.listDeliveries.invalidate();
      utils.skiRental.listModels.invalidate();
    },
    onError: toastRental,
  });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const giveBack = (lineId: number, condition: "ok" | "damaged" | "lost") => {
    const note = condition === "ok" ? null : window.prompt(condition === "damaged" ? "Describe el daño" : "Describe la pérdida")?.trim();
    if (condition !== "ok" && !note) return;
    ret.mutate({ siteId: ctx.siteId, lineId, condition, note });
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground">
        {d.customerName} · {d.storeName} · {d.startDate} → {d.expectedReturnDate} {d.late && <Badge variant="destructive">Devolución tardía</Badge>}
        {d.reservationId != null && <span className="text-muted-foreground"> · Reserva #{d.reservationId}</span>}
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {d.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 break-words">
              <span className="font-mono text-foreground">{l.code}</span> · {l.modelName}
              {l.size ? ` ${l.size}` : ""} · {typeLabel(ctx.assetTypes, l.requestedType)}
              {l.sizeMismatchReason ? <span className="text-xs text-muted-foreground"> · talla distinta: {l.sizeMismatchReason}</span> : null}
            </span>
            {l.returnedAt ? (
              <Badge variant={l.returnCondition === "ok" ? "secondary" : "destructive"}>{l.returnCondition === "ok" ? "Devuelta" : l.returnCondition === "damaged" ? "Devuelta con daño" : "Perdida"}</Badge>
            ) : (
              ctx.canWrite && (
                <span className="flex flex-wrap gap-1.5">
                  <Button size="sm" onClick={() => giveBack(l.id, "ok")} disabled={ret.isPending}>
                    Devolver
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => giveBack(l.id, "damaged")} disabled={ret.isPending}>
                    Con daño
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => giveBack(l.id, "lost")} disabled={ret.isPending}>
                    Perdida
                  </Button>
                </span>
              )
            )}
          </li>
        ))}
      </ul>
      {d.contract && <Contract ctx={ctx} deliveryId={d.id} customerName={d.customerName} contract={d.contract} />}
    </div>
  );
}

function Deliveries({ ctx, status, onOpen, onNew }: { ctx: RentalCtx; status: "open" | "returned"; onOpen: (id: number) => void; onNew: () => void }) {
  const q = trpc.skiRental.listDeliveries.useQuery({ siteId: ctx.siteId, status });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (q.data!.length === 0)
    return status === "open" ? (
      <PanelEmpty icon={<ShoppingCart className="h-5 w-5" />} title="No hay material en la calle" description="Haz la primera entrega escaneando las unidades; el cliente firma el contrato en el mostrador.">
        {ctx.canWrite && <Button onClick={onNew}>Nueva entrega</Button>}
      </PanelEmpty>
    ) : (
      <p className="text-sm text-muted-foreground">Todavía no hay entregas devueltas.</p>
    );
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-card">
      {q.data!.map((d) => (
        <li key={d.id}>
          <button type="button" onClick={() => onOpen(d.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="min-w-0">
              <span className="block break-words text-sm font-medium text-foreground">
                #{d.id} · {d.customerName}
              </span>
              <span className="block text-xs text-muted-foreground">
                {d.storeName} · vuelve el {d.expectedReturnDate} · {d.pending}/{d.units} sin devolver
              </span>
            </span>
            <span className="flex flex-wrap gap-1.5">
              {d.late && <Badge variant="destructive">Tardía</Badge>}
              {d.contractStatus === "pending" && <Badge variant="outline">Sin firmar</Badge>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function SkiRentalCounter() {
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [tab, setTab] = useState<"open" | "returned">("open");
  return (
    <SkiRentalShell
      title="Alquiler: mostrador"
      description="Entregas y devoluciones por unidad, con el contrato firmado por el cliente en el mostrador."
      actions={(ctx) =>
        ctx.canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Nueva entrega
          </Button>
        )
      }
    >
      {(ctx) => (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Entregas">
            {(["open", "returned"] as const).map((t) => (
              <Button key={t} role="tab" aria-selected={tab === t} size="sm" variant={tab === t ? "default" : "outline"} onClick={() => setTab(t)}>
                {t === "open" ? "En la calle" : "Devueltas"}
              </Button>
            ))}
          </div>
          <Deliveries ctx={ctx} status={tab} onOpen={setOpen} onNew={() => setCreating(true)} />
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Nueva entrega</DialogTitle>
                <DialogDescription>Escanea cada unidad. Si la talla no es la pedida, confírmalo e indica el motivo.</DialogDescription>
              </DialogHeader>
              {creating && (
                <DeliveryForm
                  ctx={ctx}
                  onClose={() => setCreating(false)}
                  onCreated={(id) => {
                    setCreating(false);
                    setOpen(id);
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
          <Dialog open={open != null} onOpenChange={(o) => !o && setOpen(null)}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Entrega #{open}</DialogTitle>
                <DialogDescription>Material entregado, devolución por unidad y contrato.</DialogDescription>
              </DialogHeader>
              {open != null && <DeliveryDetail ctx={ctx} deliveryId={open} />}
            </DialogContent>
          </Dialog>
        </div>
      )}
    </SkiRentalShell>
  );
}
