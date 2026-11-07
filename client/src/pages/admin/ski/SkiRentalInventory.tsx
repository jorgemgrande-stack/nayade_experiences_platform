/**
 * Ski Net · Alquiler — Inventario de material (/admin/ski/inventario): modelos por tipo y talla con sus unidades por
 * estado (disponibilidad en tiempo real), alta de unidades con código automático o propio, búsqueda por código
 * escaneado, historial de cada unidad y cambios manuales (incidencia, retirada, vuelta a disponible, taller).
 */
import { useState } from "react";
import { History, Package, Plus, ScanLine } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { SkiRentalShell, UNIT_STATUS_LABEL, euros, rentalErrorMessage, toastRental, typeLabel, unitStatusVariant, type RentalCtx } from "@/components/ski/SkiRentalShell";

type UnitRow = { id: number; code: string; status: string; modelId: number; notes: string | null };

function ModelForm({ ctx, onClose }: { ctx: RentalCtx; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [assetType, setType] = useState(ctx.assetTypes[0]?.code ?? "");
  const [name, setName] = useState("");
  const [brand, setBrand] = useState("");
  const [size, setSize] = useState("");
  const [value, setValue] = useState("");
  const create = trpc.skiRental.createModel.useMutation({
    onSuccess: () => {
      toast.success("Modelo creado");
      utils.skiRental.listModels.invalidate();
      onClose();
    },
    onError: toastRental,
  });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ siteId: ctx.siteId, assetType, name, brand: brand || null, size: size || null, replacementValueCents: value.trim() ? Math.round(Number(value.replace(",", ".")) * 100) : null });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="md-type" label="Tipo">
          <select id="md-type" className={selectClass} value={assetType} onChange={(e) => setType(e.target.value)}>
            {ctx.assetTypes.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="md-name" label="Modelo" required>
          <Input id="md-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
        </FormField>
        <FormField id="md-brand" label="Marca">
          <Input id="md-brand" value={brand} onChange={(e) => setBrand(e.target.value)} maxLength={80} />
        </FormField>
        <FormField id="md-size" label="Talla" hint="Longitud, número o S/M/L">
          <Input id="md-size" value={size} onChange={(e) => setSize(e.target.value)} maxLength={16} />
        </FormField>
        <FormField id="md-value" label="Valor de reposición (€)">
          <Input id="md-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        </FormField>
      </div>
      <DialogFooter className="gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={create.isPending}>
          Crear modelo
        </Button>
      </DialogFooter>
    </form>
  );
}

function AddUnits({ ctx, modelId, onDone }: { ctx: RentalCtx; modelId: number; onDone: () => void }) {
  const utils = trpc.useUtils();
  const stores = trpc.skiRental.listStores.useQuery({ siteId: ctx.siteId });
  const [count, setCount] = useState("1");
  const [codes, setCodes] = useState("");
  const [storeId, setStoreId] = useState("");
  const create = trpc.skiRental.createUnits.useMutation({
    onSuccess: (r) => {
      toast.success(`${r.length} unidad(es) dada(s) de alta: ${r.map((u) => u.code).slice(0, 5).join(", ")}${r.length > 5 ? "…" : ""}`);
      utils.skiRental.listModels.invalidate();
      utils.skiRental.listUnits.invalidate();
      onDone();
    },
    onError: toastRental,
  });
  const list = codes.split(/[\n,;]+/).map((c) => c.trim()).filter(Boolean);
  return (
    <form
      className="space-y-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate({ siteId: ctx.siteId, modelId, storeId: storeId ? Number(storeId) : null, ...(list.length ? { codes: list } : { count: Number(count) }) });
      }}
    >
      <p className="text-sm font-medium text-foreground">Añadir unidades</p>
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_12rem]">
        <FormField id="un-count" label="Cuántas" hint="Con código automático">
          <Input id="un-count" type="number" min={1} max={200} value={count} onChange={(e) => setCount(e.target.value)} disabled={list.length > 0} />
        </FormField>
        <FormField id="un-codes" label="O sus códigos" hint="Uno por línea (etiquetas ya impresas)">
          <Textarea id="un-codes" rows={2} value={codes} onChange={(e) => setCodes(e.target.value)} />
        </FormField>
        <FormField id="un-store" label="Tienda">
          <select id="un-store" className={selectClass} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Sin tienda</option>
            {(stores.data ?? [])
              .filter((s) => s.active)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </FormField>
      </div>
      <Button type="submit" size="sm" disabled={create.isPending}>
        Dar de alta
      </Button>
    </form>
  );
}

function UnitHistory({ ctx, unitId }: { ctx: RentalCtx; unitId: number }) {
  const q = trpc.skiRental.unitHistory.useQuery({ siteId: ctx.siteId, unitId });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  return (
    <ol className="space-y-1 text-xs">
      {q.data!.events.map((e) => (
        <li key={e.id} className="break-words text-muted-foreground">
          <span className="text-foreground">{new Date(e.createdAt).toLocaleString("es-ES")}</span> · {e.fromStatus ? `${UNIT_STATUS_LABEL[e.fromStatus]} → ` : ""}
          {UNIT_STATUS_LABEL[e.toStatus]} ({e.kind}){e.note ? ` · ${e.note}` : ""}
        </li>
      ))}
    </ol>
  );
}

function UnitActions({ ctx, unit }: { ctx: RentalCtx; unit: UnitRow }) {
  const utils = trpc.useUtils();
  const [history, setHistory] = useState(false);
  const refresh = () => {
    utils.skiRental.listUnits.invalidate();
    utils.skiRental.listModels.invalidate();
    utils.skiRental.unitHistory.invalidate();
    utils.skiRental.scanUnit.invalidate();
    utils.skiRental.listTickets.invalidate();
  };
  const set = trpc.skiRental.setUnitStatus.useMutation({ onSuccess: () => (toast.success("Estado cambiado"), refresh()), onError: toastRental });
  const ticket = trpc.skiRental.openTicket.useMutation({ onSuccess: () => (toast.success("Enviada al taller"), refresh()), onError: toastRental });
  const ask = (msg: string) => window.prompt(msg)?.trim() || null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setHistory(!history)}>
          <History className="mr-1 h-4 w-4" aria-hidden="true" />
          Historial
        </Button>
        {ctx.canWrite && (unit.status === "available" || unit.status === "incident") && (
          <Button size="sm" variant="outline" onClick={() => { const r = ask("Motivo para el taller"); if (r) ticket.mutate({ siteId: ctx.siteId, unitId: unit.id, reason: r }); }}>
            Al taller
          </Button>
        )}
        {ctx.canWrite && unit.status === "available" && (
          <Button size="sm" variant="outline" onClick={() => set.mutate({ siteId: ctx.siteId, unitId: unit.id, status: "incident", note: ask("Describe la incidencia") })}>
            Incidencia
          </Button>
        )}
        {ctx.canWrite && unit.status === "incident" && (
          <Button size="sm" variant="outline" onClick={() => set.mutate({ siteId: ctx.siteId, unitId: unit.id, status: "available", note: null })}>
            Disponible
          </Button>
        )}
        {ctx.canWrite && (unit.status === "available" || unit.status === "incident") && (
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => window.confirm(`¿Retirar ${unit.code}? No se puede deshacer.`) && set.mutate({ siteId: ctx.siteId, unitId: unit.id, status: "retired", note: ask("Motivo de la retirada") })}>
            Retirar
          </Button>
        )}
      </div>
      {history && <UnitHistory ctx={ctx} unitId={unit.id} />}
    </div>
  );
}

function UnitsDialog({ ctx, model, onClose }: { ctx: RentalCtx; model: { id: number; name: string; size: string } | null; onClose: () => void }) {
  const q = trpc.skiRental.listUnits.useQuery({ siteId: ctx.siteId, modelId: model?.id ?? 0 }, { enabled: !!model });
  const [adding, setAdding] = useState(false);
  return (
    <Dialog open={!!model} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Unidades de {model?.name}
            {model?.size ? ` · ${model.size}` : ""}
          </DialogTitle>
          <DialogDescription>Cada unidad tiene su código (el de su etiqueta, QR o código de barras) y su estado.</DialogDescription>
        </DialogHeader>
        {ctx.canWrite && (adding && model ? <AddUnits ctx={ctx} modelId={model.id} onDone={() => setAdding(false)} /> : <Button size="sm" onClick={() => setAdding(true)}>Añadir unidades</Button>)}
        {q.isLoading ? (
          <PanelLoading />
        ) : q.error ? (
          <PanelError error={q.error} onRetry={() => q.refetch()} />
        ) : q.data!.length === 0 ? (
          <p className="text-sm text-muted-foreground">Este modelo aún no tiene unidades. Da de alta la primera.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(q.data as UnitRow[]).map((u) => (
              <li key={u.id} className="space-y-1 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono text-sm text-foreground">{u.code}</span>
                  <Badge variant={unitStatusVariant(u.status)}>{UNIT_STATUS_LABEL[u.status]}</Badge>
                </div>
                <UnitActions ctx={ctx} unit={u} />
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Scan({ ctx }: { ctx: RentalCtx }) {
  const [input, setInput] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const q = trpc.skiRental.scanUnit.useQuery({ siteId: ctx.siteId, code: code ?? "" }, { enabled: !!code, retry: false });
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) setCode(input.trim());
        }}
      >
        <FormField id="scan" label="Buscar por código" hint="Escanea la etiqueta o escribe el código">
          <Input id="scan" className="w-56" value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" />
        </FormField>
        <Button type="submit" variant="outline">
          <ScanLine className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Buscar
        </Button>
      </form>
      {code && q.isLoading && <p className="text-xs text-muted-foreground">Buscando…</p>}
      {code && q.error && <p className="text-sm text-destructive">{rentalErrorMessage(q.error)}</p>}
      {q.data && (
        <div className="space-y-1 rounded-lg border border-border px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="break-words text-sm text-foreground">
              <span className="font-mono">{q.data.unit.code}</span> · {q.data.model?.name}
              {q.data.model?.size ? ` · ${q.data.model.size}` : ""}
            </span>
            <Badge variant={unitStatusVariant(q.data.unit.status)}>{UNIT_STATUS_LABEL[q.data.unit.status]}</Badge>
          </div>
          <UnitActions ctx={ctx} unit={q.data.unit} />
        </div>
      )}
    </div>
  );
}

function Models({ ctx, onNew }: { ctx: RentalCtx; onNew: () => void }) {
  const utils = trpc.useUtils();
  const q = trpc.skiRental.listModels.useQuery({ siteId: ctx.siteId });
  const [open, setOpen] = useState<{ id: number; name: string; size: string } | null>(null);
  const archive = trpc.skiRental.updateModel.useMutation({ onSuccess: () => utils.skiRental.listModels.invalidate(), onError: toastRental });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (q.data!.length === 0)
    return (
      <PanelEmpty icon={<Package className="h-5 w-5" />} title="Da de alta tu primer modelo de material" description="Un modelo es un tipo y una talla (por ejemplo, esquís Allround de 160). Después añade sus unidades con su código.">
        {ctx.canWrite && <Button onClick={onNew}>Nuevo modelo</Button>}
      </PanelEmpty>
    );
  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {q.data!.map((m) => (
          <li key={m.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="break-words font-semibold text-foreground">
                  {m.name}
                  {m.size ? ` · ${m.size}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {typeLabel(ctx.assetTypes, m.assetType)}
                  {m.brand ? ` · ${m.brand}` : ""} · reposición {euros(m.replacementValueCents)}
                </p>
              </div>
              {!m.active && <Badge variant="secondary">Archivado</Badge>}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge>{m.units.available} disponibles</Badge>
              {m.units.rented > 0 && <Badge variant="secondary">{m.units.rented} alquiladas</Badge>}
              {m.units.workshop > 0 && <Badge variant="destructive">{m.units.workshop} en taller</Badge>}
              {m.units.incident > 0 && <Badge variant="destructive">{m.units.incident} con incidencia</Badge>}
              {m.units.retired > 0 && <Badge variant="outline">{m.units.retired} retiradas</Badge>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen({ id: m.id, name: m.name, size: m.size })}>
                Unidades
              </Button>
              {ctx.canWrite && (
                <Button size="sm" variant="ghost" onClick={() => archive.mutate({ siteId: ctx.siteId, modelId: m.id, active: !m.active })}>
                  {m.active ? "Archivar" : "Reactivar"}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <UnitsDialog ctx={ctx} model={open} onClose={() => setOpen(null)} />
    </>
  );
}

export default function SkiRentalInventory() {
  const [creating, setCreating] = useState(false);
  return (
    <SkiRentalShell
      title="Inventario de material"
      description="Modelos y unidades de la sede, con su estado y su código para escanear."
      actions={(ctx) =>
        ctx.canWrite && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Nuevo modelo
          </Button>
        )
      }
    >
      {(ctx) => (
        <div className="space-y-4">
          <Scan ctx={ctx} />
          <Models ctx={ctx} onNew={() => setCreating(true)} />
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Nuevo modelo</DialogTitle>
                <DialogDescription>Tipo, nombre y talla. Los tipos se configuran en «Tiendas y contrato».</DialogDescription>
              </DialogHeader>
              {creating && <ModelForm ctx={ctx} onClose={() => setCreating(false)} />}
            </DialogContent>
          </Dialog>
        </div>
      )}
    </SkiRentalShell>
  );
}
