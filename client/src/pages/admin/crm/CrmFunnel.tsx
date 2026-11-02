/**
 * Embudo de ventas (Business, `crm-funnel-advanced`): tablero por etapas con arrastrar y soltar, importe, probabilidad
 * y previsión ponderada por etapa y total. Administración configura las etapas; el equipo comercial mueve las
 * oportunidades. Essential no llega a esta pantalla (el guardián de rutas muestra «No incluido en tu plan») y sigue con
 * los cuatro estados de siempre en Oportunidades.
 */
import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowDown, ArrowUp, Pencil, Plus, Search, Settings2, Target, Trash2 } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, TAG_COLOR_CLASSES, describedBy, selectClass } from "@/components/admin/crm/CrmParts";
import { toastError } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import {
  LOST_REASON_MAX, STAGE_COLORS, STAGE_COLOR_LABELS, STAGE_KINDS, STAGE_KIND_LABELS, STAGE_NAME_MAX, canRemoveStageKind, validateStageForm,
  type FunnelStage, type StageColor, type StageForm, type StageKind,
} from "@shared/crmFunnel";

const CAP = "crm-funnel-advanced";
const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const money = (n: number) => eur.format(n || 0);

type Card = { id: number; name: string; company: string | null; email: string; stageId: number; amount: number; probability: number; lostReason: string | null; ownerName: string | null };

function useFunnelRoles() {
  const { user } = useAuth();
  const sub = usePanelSubscription();
  const role = (user as { role?: string } | null)?.role ?? "user";
  const write = sub.canWrite(CAP);
  return { canMove: (role === "admin" || role === "agente") && write, canConfigure: role === "admin" && write };
}

function StageDot({ color }: { color: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full border", TAG_COLOR_CLASSES[color] ?? TAG_COLOR_CLASSES.gris)} aria-hidden="true" />;
}

// ─── Configuración de etapas (administración) ────────────────────────────────

function StageEditor({ stage, stages, onClose }: { stage: FunnelStage | null; stages: FunnelStage[]; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<StageForm>({ name: stage?.name ?? "", probability: stage?.probability ?? 20, kind: stage?.kind ?? "abierta", color: stage?.color ?? "azul" });
  const [errors, setErrors] = useState<Partial<Record<keyof StageForm, string>>>({});
  const done = (msg: string) => {
    toast.success(msg);
    utils.crmFunnel.invalidate();
    onClose();
  };
  const create = trpc.crmFunnel.createStage.useMutation({ onSuccess: () => done("Etapa creada"), onError: (e) => setErrors({ name: e.message }) });
  const update = trpc.crmFunnel.updateStage.useMutation({ onSuccess: () => done("Etapa guardada"), onError: (e) => setErrors({ name: e.message }) });
  const kindLocked = !!stage?.legacyStatus;
  const setKind = (kind: StageKind) => setForm((f) => ({ ...f, kind, probability: kind === "ganada" ? 100 : kind === "perdida" ? 0 : f.probability }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateStageForm(form, stages, stage?.id);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (stage) update.mutate({ id: stage.id, ...form });
    else create.mutate(form);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <FormField id="stage-name" label="Nombre" error={errors.name} required>
        <Input id="stage-name" value={form.name} maxLength={STAGE_NAME_MAX} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("stage-name", errors.name)} autoFocus />
      </FormField>
      <FormField id="stage-kind" label="Tipo" error={errors.kind} hint={kindLocked ? "Las etapas por defecto conservan su tipo." : "Abierta: en curso. Ganada y perdida cierran la oportunidad."}>
        <select id="stage-kind" className={selectClass} value={form.kind} disabled={kindLocked} onChange={(e) => setKind(e.target.value as StageKind)} aria-describedby={describedBy("stage-kind", errors.kind) ?? "stage-kind-hint"}>
          {STAGE_KINDS.map((k) => <option key={k} value={k}>{STAGE_KIND_LABELS[k]}</option>)}
        </select>
      </FormField>
      <FormField id="stage-prob" label="Probabilidad de cierre (%)" error={errors.probability}>
        <Input id="stage-prob" type="number" inputMode="numeric" min={0} max={100} step={1} value={form.probability} disabled={form.kind !== "abierta"}
          onChange={(e) => setForm({ ...form, probability: Math.round(Number(e.target.value)) })} aria-invalid={!!errors.probability} aria-describedby={describedBy("stage-prob", errors.probability)} />
      </FormField>
      <FormField id="stage-color" label="Color" error={errors.color}>
        <select id="stage-color" className={selectClass} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value as StageColor })}>
          {STAGE_COLORS.map((c) => <option key={c} value={c}>{STAGE_COLOR_LABELS[c]}</option>)}
        </select>
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>{stage ? "Guardar cambios" : "Crear etapa"}</Button>
      </DialogFooter>
    </form>
  );
}

function StagesDialog({ open, onClose, stages }: { open: boolean; onClose: () => void; stages: FunnelStage[] }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<FunnelStage | null | undefined>(undefined);
  const reorder = trpc.crmFunnel.reorderStages.useMutation({ onSuccess: () => utils.crmFunnel.invalidate(), onError: (e) => toastError(e) });
  const remove = trpc.crmFunnel.removeStage.useMutation({
    onSuccess: (r) => {
      toast.success(r.released > 0 ? `Etapa eliminada. ${r.released} ${r.released === 1 ? "oportunidad vuelve" : "oportunidades vuelven"} a la etapa de su estado.` : "Etapa eliminada");
      utils.crmFunnel.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const move = (i: number, d: -1 | 1) => {
    const ids = stages.map((s) => s.id);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    reorder.mutate({ ids });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing === undefined ? "Etapas del embudo" : editing ? "Editar etapa" : "Nueva etapa"}</DialogTitle>
          <DialogDescription>
            {editing === undefined
              ? "Ordena, renombra y ajusta la probabilidad de cada etapa. Siempre queda al menos una etapa abierta, una ganada y una perdida."
              : "La probabilidad se usa para la previsión ponderada (importe × probabilidad)."}
          </DialogDescription>
        </DialogHeader>
        {editing !== undefined ? (
          <StageEditor stage={editing} stages={stages} onClose={() => setEditing(undefined)} />
        ) : (
          <>
            <ol className="divide-y divide-border rounded-xl border border-border" aria-label="Etapas en orden">
              {stages.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <StageDot color={s.color} />
                  <span className="min-w-0 flex-1 truncate font-medium text-foreground">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{STAGE_KIND_LABELS[s.kind]} · {s.probability} %</span>
                  <Button size="sm" variant="ghost" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={`Subir la etapa ${s.name}`}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button size="sm" variant="ghost" disabled={i === stages.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={`Bajar la etapa ${s.name}`}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={`Editar la etapa ${s.name}`}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!canRemoveStageKind(s, stages) || remove.isPending}
                    onClick={() => remove.mutate({ id: s.id })} aria-label={`Eliminar la etapa ${s.name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </li>
              ))}
            </ol>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>Cerrar</Button>
              <Button type="button" onClick={() => setEditing(null)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Nueva etapa</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Tablero ─────────────────────────────────────────────────────────────────

export default function CrmFunnel() {
  const { canMove, canConfigure } = useFunnelRoles();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const board = trpc.crmFunnel.board.useQuery(query ? { search: query } : undefined);
  const [configOpen, setConfigOpen] = useState(false);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [losing, setLosing] = useState<{ card: Card; stage: FunnelStage } | null>(null);
  const [reason, setReason] = useState("");

  const moveLead = trpc.crmFunnel.moveLead.useMutation({
    onSuccess: () => {
      utils.crmFunnel.board.invalidate();
      utils.crm.leads.invalidate();
      setLosing(null);
      setReason("");
    },
    onError: (e) => toastError(e),
  });

  const stages = (board.data?.stages ?? []) as FunnelStage[];
  const cards = (board.data?.cards ?? []) as Card[];
  const forecast = board.data?.forecast;
  const byStage = useMemo(() => {
    const m = new Map<number, Card[]>();
    for (const c of cards) m.set(c.stageId, [...(m.get(c.stageId) ?? []), c]);
    return m;
  }, [cards]);
  const fOf = (id: number) => forecast?.stages.find((f) => f.stageId === id);

  const requestMove = (card: Card, stageId: number) => {
    if (card.stageId === stageId) return;
    const stage = stages.find((s) => s.id === stageId);
    if (!stage) return;
    if (stage.kind === "perdida") {
      setReason("");
      setLosing({ card, stage });
      return;
    }
    moveLead.mutate({ leadId: card.id, stageId }, { onSuccess: () => toast.success(`«${card.name}» pasa a ${stage.name}`) });
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Embudo de ventas</h1>
            <p className="text-sm text-muted-foreground">Arrastra cada oportunidad a su etapa. La previsión pondera el importe por la probabilidad de cada etapa abierta.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search.trim());
              }}
              className="relative"
            >
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre, correo o empresa" aria-label="Buscar oportunidades" className="w-64 pl-8" />
            </form>
            {canConfigure && (
              <Button variant="outline" onClick={() => setConfigOpen(true)}>
                <Settings2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> Configurar etapas
              </Button>
            )}
          </div>
        </div>

        {forecast && (
          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              { label: "Importe abierto", value: forecast.openAmount },
              { label: "Previsión ponderada", value: forecast.weightedTotal },
              { label: "Ganado", value: forecast.wonAmount },
            ].map((k) => (
              <div key={k.label} className="rounded-2xl border border-border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">{k.label}</dt>
                <dd className="text-xl font-semibold tabular-nums text-foreground">{money(k.value)}</dd>
              </div>
            ))}
          </dl>
        )}

        {board.isLoading ? (
          <PanelLoading label="Cargando el embudo…" />
        ) : board.isError ? (
          <PanelError error={board.error} onRetry={() => board.refetch()} title="No se ha podido cargar el embudo" />
        ) : cards.length === 0 && !query ? (
          <PanelEmpty icon={<Target className="h-6 w-6" />} title="Todavía no hay oportunidades" description="Las solicitudes de la web y las que crees en Oportunidades aparecerán aquí, en su etapa." />
        ) : (
          <>
            {board.data?.truncated && <p className="text-sm text-muted-foreground">Se muestran las oportunidades más recientes. Usa la búsqueda para encontrar el resto.</p>}
            <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Etapas del embudo">
              {stages.map((s) => {
                const list = byStage.get(s.id) ?? [];
                const f = fOf(s.id);
                return (
                  <section
                    key={s.id}
                    aria-label={`${s.name}: ${list.length} ${list.length === 1 ? "oportunidad" : "oportunidades"}`}
                    className={cn("flex w-72 shrink-0 flex-col rounded-2xl border border-border bg-muted/30", over === s.id && "ring-2 ring-primary")}
                    onDragOver={(e) => {
                      if (!canMove || dragging === null) return;
                      e.preventDefault();
                      setOver(s.id);
                    }}
                    onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
                    onDrop={(e) => {
                      e.preventDefault();
                      setOver(null);
                      const card = cards.find((c) => c.id === dragging);
                      setDragging(null);
                      if (card) requestMove(card, s.id);
                    }}
                  >
                    <header className="space-y-1 border-b border-border px-3 py-2">
                      <div className="flex items-center gap-2">
                        <StageDot color={s.color} />
                        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{s.name}</h2>
                        <span className="text-xs text-muted-foreground">{s.probability} %</span>
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {list.length} · {money(f?.amount ?? 0)}
                        {s.kind === "abierta" && <> · ponderado {money(f?.weighted ?? 0)}</>}
                      </p>
                    </header>
                    <ul className="flex min-h-24 flex-col gap-2 p-2">
                      {list.map((c) => (
                        <li
                          key={c.id}
                          draggable={canMove}
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = "move";
                            e.dataTransfer.setData("text/plain", String(c.id));
                            setDragging(c.id);
                          }}
                          onDragEnd={() => setDragging(null)}
                          className={cn("rounded-xl border border-border bg-card p-3 text-sm shadow-sm", canMove && "cursor-grab active:cursor-grabbing", dragging === c.id && "opacity-50")}
                        >
                          <Link href={`/admin/crm?tab=leads&search=${encodeURIComponent(c.email)}`} className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            {c.name}
                          </Link>
                          {c.company && <p className="truncate text-xs text-muted-foreground">{c.company}</p>}
                          <p className="mt-1 text-xs tabular-nums text-foreground">
                            {money(c.amount)} <span className="text-muted-foreground">· {c.probability} %</span>
                          </p>
                          {c.ownerName && <p className="truncate text-xs text-muted-foreground">Responsable: {c.ownerName}</p>}
                          {s.kind === "perdida" && c.lostReason && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">Motivo: {c.lostReason}</p>}
                          {canMove && (
                            <label className="mt-2 block text-xs text-muted-foreground">
                              <span className="sr-only">Mover «{c.name}» a otra etapa</span>
                              <select className={cn(selectClass, "h-8 text-xs")} value={c.stageId} disabled={moveLead.isPending} onChange={(e) => requestMove(c, Number(e.target.value))}>
                                {stages.map((o) => <option key={o.id} value={o.id}>{o.id === c.stageId ? `En ${o.name}` : `Mover a ${o.name}`}</option>)}
                              </select>
                            </label>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>

      {canConfigure && <StagesDialog open={configOpen} onClose={() => setConfigOpen(false)} stages={stages} />}

      <Dialog open={losing !== null} onOpenChange={(o) => !o && setLosing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Motivo de la pérdida</DialogTitle>
            <DialogDescription>{losing ? `«${losing.card.name}» pasa a ${losing.stage.name}. Indica por qué se ha perdido.` : ""}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!losing || !reason.trim()) return;
              moveLead.mutate({ leadId: losing.card.id, stageId: losing.stage.id, lostReason: reason.trim() }, { onSuccess: () => toast.success("Oportunidad marcada como perdida") });
            }}
            className="space-y-4"
          >
            <FormField id="lost-reason" label="Motivo" required>
              <Textarea id="lost-reason" value={reason} maxLength={LOST_REASON_MAX} onChange={(e) => setReason(e.target.value)} rows={3} aria-required autoFocus />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLosing(null)}>Cancelar</Button>
              <Button type="submit" variant="destructive" disabled={!reason.trim() || moveLead.isPending}>Marcar como perdida</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
