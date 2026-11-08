/**
 * Ski Net · Alquiler — Tiendas y contrato (/admin/ski/alquiler-ajustes): tiendas de la sede con su horario y hora
 * límite de devolución, tipos de material (plantilla por defecto editable) y texto del contrato (plantilla neutra o el
 * de la empresa; cada cambio crea una versión y los contratos ya generados conservan la suya) e importe de la fianza
 * por tipo de material o por modelo.
 */
import { useState } from "react";
import { Store } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField } from "@/components/admin/crm/CrmParts";
import { SkiRentalShell, toastRental, type RentalCtx } from "@/components/ski/SkiRentalShell";
import { DepositRules } from "@/components/ski/SkiDeposits";

type StoreRow = { id: number; name: string; openingTime: string; closingTime: string; overdueReturnTime: string; active: boolean };

function StoreForm({ ctx, row, onDone }: { ctx: RentalCtx; row: StoreRow | null; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState(row?.name ?? "");
  const [openingTime, setOpening] = useState(row?.openingTime ?? "08:30");
  const [closingTime, setClosing] = useState(row?.closingTime ?? "18:00");
  const [overdueReturnTime, setOverdue] = useState(row?.overdueReturnTime ?? "17:30");
  const done = (m: string) => {
    toast.success(m);
    utils.skiRental.listStores.invalidate();
    onDone();
  };
  const create = trpc.skiRental.createStore.useMutation({ onSuccess: () => (done("Tienda creada"), setName("")), onError: toastRental });
  const update = trpc.skiRental.updateStore.useMutation({ onSuccess: () => done("Tienda guardada"), onError: toastRental });
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_7rem_7rem_9rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        const data = { siteId: ctx.siteId, name, openingTime, closingTime, overdueReturnTime };
        if (row) update.mutate({ ...data, storeId: row.id });
        else create.mutate(data);
      }}
    >
      <FormField id={`st-name-${row?.id ?? "n"}`} label="Tienda" required>
        <Input id={`st-name-${row?.id ?? "n"}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
      </FormField>
      <FormField id={`st-o-${row?.id ?? "n"}`} label="Abre">
        <Input id={`st-o-${row?.id ?? "n"}`} type="time" value={openingTime} onChange={(e) => setOpening(e.target.value)} />
      </FormField>
      <FormField id={`st-c-${row?.id ?? "n"}`} label="Cierra">
        <Input id={`st-c-${row?.id ?? "n"}`} type="time" value={closingTime} onChange={(e) => setClosing(e.target.value)} />
      </FormField>
      <FormField id={`st-d-${row?.id ?? "n"}`} label="Límite devolución">
        <Input id={`st-d-${row?.id ?? "n"}`} type="time" value={overdueReturnTime} onChange={(e) => setOverdue(e.target.value)} />
      </FormField>
      <Button type="submit" disabled={create.isPending || update.isPending}>
        {row ? "Guardar" : "Añadir tienda"}
      </Button>
    </form>
  );
}

function Stores({ ctx }: { ctx: RentalCtx }) {
  const utils = trpc.useUtils();
  const q = trpc.skiRental.listStores.useQuery({ siteId: ctx.siteId });
  const [editing, setEditing] = useState<number | null>(null);
  const toggle = trpc.skiRental.updateStore.useMutation({ onSuccess: () => utils.skiRental.listStores.invalidate(), onError: toastRental });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data as StoreRow[];
  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <PanelEmpty icon={<Store className="h-5 w-5" />} title="Da de alta tu primera tienda" description="Cada entrega sale de una tienda, con su horario y la hora a partir de la cual una devolución es tardía." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 px-4 py-3">
              {editing === r.id ? (
                <StoreForm ctx={ctx} row={r} onDone={() => setEditing(null)} />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-foreground">
                      {r.name} {!r.active && <Badge variant="secondary">Archivada</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.openingTime}–{r.closingTime} · devolución tardía desde las {r.overdueReturnTime}
                    </p>
                  </div>
                  {ctx.canWrite && (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(r.id)}>
                        Editar
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle.mutate({ siteId: ctx.siteId, storeId: r.id, active: !r.active })}>
                        {r.active ? "Archivar" : "Reactivar"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {ctx.canWrite && (
        <div className="rounded-xl border border-border p-4">
          <StoreForm ctx={ctx} row={null} onDone={() => undefined} />
        </div>
      )}
    </div>
  );
}

const toLines = (l: Array<{ code: string; label: string }>) => l.map((x) => `${x.code} = ${x.label}`).join("\n");
const fromLines = (t: string) =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return i < 0 ? { code: l, label: l } : { code: l.slice(0, i).trim(), label: l.slice(i + 1).trim() };
    });

function SettingsForm({ ctx }: { ctx: RentalCtx }) {
  const utils = trpc.useUtils();
  const q = trpc.skiRental.settings.useQuery({ siteId: ctx.siteId });
  const [types, setTypes] = useState<string | null>(null);
  const [terms, setTerms] = useState<string | null>(null);
  const save = trpc.skiRental.updateSettings.useMutation({
    onSuccess: () => {
      toast.success("Ajustes guardados");
      setTypes(null);
      setTerms(null);
      utils.skiRental.settings.invalidate();
    },
    onError: toastRental,
  });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Tipos de material</h2>
        <p className="text-xs text-muted-foreground">Una línea por tipo, «código = nombre». El código (minúsculas) no conviene cambiarlo si ya hay modelos de ese tipo.</p>
        <Textarea aria-label="Tipos de material" rows={8} value={types ?? toLines(s.assetTypes)} onChange={(e) => setTypes(e.target.value)} disabled={!ctx.canWrite} />
        {ctx.canWrite && (
          <Button size="sm" disabled={types == null || save.isPending} onClick={() => save.mutate({ siteId: ctx.siteId, assetTypes: fromLines(types ?? "") })}>
            Guardar tipos
          </Button>
        )}
      </section>
      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Texto del contrato</h2>
          <span className="flex flex-wrap gap-1.5">
            <Badge variant="outline">Versión {s.termsVersion}</Badge>
            {s.defaultTerms && <Badge variant="secondary">Plantilla neutra</Badge>}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">Sustitúyelo por las condiciones de tu empresa (revísalas con tu asesoría). Los contratos ya generados guardan el texto con el que se crearon.</p>
        <Textarea aria-label="Texto del contrato" rows={12} value={terms ?? s.contractTerms} onChange={(e) => setTerms(e.target.value)} disabled={!ctx.canWrite} />
        {ctx.canWrite && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={terms == null || save.isPending} onClick={() => save.mutate({ siteId: ctx.siteId, contractTerms: terms })}>
              Guardar texto
            </Button>
            {!s.defaultTerms && (
              <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ siteId: ctx.siteId, contractTerms: null })}>
                Volver a la plantilla neutra
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export default function SkiRentalSettings() {
  return (
    <SkiRentalShell title="Tiendas y contrato" description="Tiendas de la sede, tipos de material y condiciones del contrato de alquiler.">
      {(ctx) => (
        <div className="space-y-6">
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Tiendas</h2>
            <Stores ctx={ctx} />
          </section>
          <SettingsForm ctx={ctx} />
          <DepositRules ctx={ctx} />
        </div>
      )}
    </SkiRentalShell>
  );
}
