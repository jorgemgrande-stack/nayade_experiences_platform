/**
 * Care Net · Clientes con bono (/admin/care-net/clientes): saldo de sesiones por cliente (activos, caducados con
 * sesiones sin usar o todos), y en la ficha de cada uno sus bonos, el historial de sesiones consumidas y la devolución
 * de una sesión (con o sin anular la cita). Un bono pendiente de cobro se cobra o se anula aquí.
 */
import { useState } from "react";
import { Search, Ticket, Undo2, Users } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { cn } from "@/lib/utils";
import { formatEur } from "@shared/careNet";
import { PageHeader, PurchaseBadge, SellPackDialog, fmtDate, useCareWrite, useOpenCash } from "./CareNetParts";

const FILTERS = [["active", "Con sesiones"], ["expired", "Caducados con sesiones"], ["all", "Todos"]] as const;

export default function Clientes() {
  const { canWrite } = useCareWrite();
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("active");
  const [search, setSearch] = useState("");
  const list = trpc.careNet.clientsWithPacks.useQuery({ filter, search: search.trim() || undefined });
  const [open, setOpen] = useState<number | null>(null);
  const [selling, setSelling] = useState(false);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHeader
          title="Clientes con bono"
          description="Sesiones pendientes de cada cliente y cuándo caducan. Abre un cliente para ver sus bonos y las sesiones que ha usado."
          actions={canWrite && <Button onClick={() => setSelling(true)}><Ticket className="mr-1.5 h-4 w-4" aria-hidden="true" />Vender un bono</Button>}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtro">
            {FILTERS.map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
                className={cn("rounded-full border px-3 py-1 text-sm", filter === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground hover:bg-muted")}>
                {l}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input aria-label="Buscar cliente" placeholder="Buscar cliente" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        {list.isLoading ? (
          <PanelLoading label="Cargando los clientes…" />
        ) : list.isError ? (
          <PanelError error={list.error} onRetry={() => list.refetch()} />
        ) : (list.data ?? []).length === 0 ? (
          <PanelEmpty icon={<Users className="h-5 w-5" />} title={filter === "expired" ? "Ningún bono caducado con sesiones" : "Ningún cliente con bono"} description="Cuando vendas un bono, el cliente aparecerá aquí con su saldo de sesiones.">
            {canWrite && <Button onClick={() => setSelling(true)}>Vender un bono</Button>}
          </PanelEmpty>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {(list.data ?? []).map((c) => (
              <li key={c.clientId}>
                <button type="button" onClick={() => setOpen(c.clientId)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50">
                  <span className="min-w-0">
                    <span className="block break-words font-medium text-foreground">{c.clientName}</span>
                    <span className="block break-words text-xs text-muted-foreground">{c.email ?? ""} · {c.purchases.length} {c.purchases.length === 1 ? "bono" : "bonos"}</span>
                  </span>
                  <span className="text-right text-sm">
                    <span className="block font-semibold tabular-nums text-foreground">{c.remaining} sesiones</span>
                    <span className="block text-xs text-muted-foreground">{c.nextExpiry ? `caduca ${fmtDate(c.nextExpiry)}` : c.purchases.map((p) => p.state).includes("expired") ? "caducado" : ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open != null && <ClientDetail clientId={open} onClose={() => setOpen(null)} />}
      {selling && <SellPackDialog onClose={() => setSelling(false)} />}
    </AdminLayout>
  );
}

function ClientDetail({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const { canWrite } = useCareWrite();
  const utils = trpc.useUtils();
  const d = trpc.careNet.clientPacks.useQuery({ clientId });
  const [reverting, setReverting] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [cancelRes, setCancelRes] = useState(false);
  const [paying, setPaying] = useState<{ id: number; price: number } | null>(null);
  const [selling, setSelling] = useState(false);
  const refresh = () => { utils.careNet.clientPacks.invalidate(); utils.careNet.clientsWithPacks.invalidate(); utils.careNet.spaReservations.invalidate(); };
  const revert = trpc.careNet.revertConsumption.useMutation({ onSuccess: () => { toast.success("Sesión devuelta al bono"); setReverting(null); refresh(); }, onError: (e) => toastError(e) });
  const cancel = trpc.careNet.cancelPendingPurchase.useMutation({ onSuccess: () => { toast.success("Bono anulado"); refresh(); }, onError: (e) => toastError(e) });

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{d.data?.client?.name ?? "Cliente"}</DialogTitle>
            <DialogDescription>{d.data?.client?.email ?? ""}</DialogDescription>
          </DialogHeader>
          {d.isLoading ? (
            <PanelLoading />
          ) : d.isError ? (
            <PanelError error={d.error} onRetry={() => d.refetch()} />
          ) : (
            <div className="space-y-4">
              <section className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Bonos</h3>
                  {canWrite && <Button size="sm" variant="outline" onClick={() => setSelling(true)}>Vender otro</Button>}
                </div>
                <ul className="space-y-2">
                  {(d.data?.purchases ?? []).map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2">
                      <span className="min-w-0 text-sm">
                        <span className="block break-words font-medium text-foreground">{p.packName}</span>
                        <span className="block text-xs text-muted-foreground">
                          {p.sessionsUsed} de {p.sessionsTotal} usadas · {p.remaining} pendientes · {formatEur(p.price)}{p.expiresAt ? ` · caduca ${fmtDate(p.expiresAt)}` : ""}
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <PurchaseBadge state={p.state} />
                        {canWrite && p.state === "pending" && (
                          <>
                            <Button size="sm" onClick={() => setPaying({ id: p.id, price: p.price })}>Cobrar</Button>
                            <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ purchaseId: p.id })}>Anular</Button>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">Sesiones usadas</h3>
                {(d.data?.consumptions ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aún no ha usado ninguna sesión.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-xl border border-border text-sm">
                    {(d.data?.consumptions ?? []).map((k) => (
                      <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                        <span className={cn("min-w-0 break-words", k.status === "reverted" ? "text-muted-foreground line-through" : "text-foreground")}>
                          {k.date ?? fmtDate(k.consumedAt)} {k.time ?? ""} · {k.treatmentName ?? "Tratamiento"} · {k.packName}{k.source === "counter" ? " · mostrador" : ""}
                        </span>
                        {k.status === "reverted" ? (
                          <span className="text-xs text-muted-foreground">Devuelta: {k.revertReason}</span>
                        ) : (
                          canWrite && <Button size="sm" variant="ghost" onClick={() => { setReason(""); setCancelRes(false); setReverting(k.id); }}><Undo2 className="mr-1 h-4 w-4" aria-hidden="true" />Devolver</Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={reverting != null} onOpenChange={(o) => !o && setReverting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Devolver la sesión al bono</DialogTitle>
            <DialogDescription>La sesión vuelve al saldo del cliente. Si además anulas la cita, se libera su plaza.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="care-rev-reason">Motivo</Label>
              <Input id="care-rev-reason" maxLength={255} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={cancelRes} onCheckedChange={(v) => setCancelRes(!!v)} />
              Anular también la cita
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReverting(null)}>Cancelar</Button>
            <Button disabled={reason.trim().length < 3 || revert.isPending} onClick={() => revert.mutate({ consumptionId: reverting!, reason, cancelReservation: cancelRes })}>Devolver</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {paying && <PayPendingDialog purchase={paying} onClose={() => { setPaying(null); refresh(); }} />}
      {selling && <SellPackDialog initialClient={d.data?.client ? { id: d.data.client.id, name: d.data.client.name } : null} onClose={() => { setSelling(false); refresh(); }} />}
    </>
  );
}

function PayPendingDialog({ purchase, onClose }: { purchase: { id: number; price: number }; onClose: () => void }) {
  const cash = useOpenCash();
  const pay = trpc.careNet.payPurchase.useMutation({ onSuccess: () => { toast.success("Bono cobrado"); onClose(); }, onError: (e) => toastError(e) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cobrar el bono ({formatEur(purchase.price)})</DialogTitle>
          <DialogDescription>Se registra como venta del TPV en la caja elegida.</DialogDescription>
        </DialogHeader>
        {cash.picker}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={!cash.sessionId || pay.isPending} onClick={() => pay.mutate({ purchaseId: purchase.id, sessionId: cash.sessionId!, payments: [{ method: "card", amount: purchase.price }] })}>Cobrar con tarjeta</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
