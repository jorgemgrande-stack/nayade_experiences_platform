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
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { CompactEmpty, SummaryStrip } from "@/components/admin/SalesFamilyShell";
import { FormField, TAG_COLOR_CLASSES, describedBy, selectClass } from "@/components/admin/crm/CrmParts";
import { toastError } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import {
  LOST_REASON_MAX, STAGE_COLORS, STAGE_KINDS, STAGE_NAME_MAX, canRemoveStageKind, validateStageForm,
  type FunnelStage, type StageColor, type StageForm, type StageKind,
} from "@shared/crmFunnel";

const CAP = "crm-funnel-advanced";

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
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [form, setForm] = useState<StageForm>({ name: stage?.name ?? "", probability: stage?.probability ?? 20, kind: stage?.kind ?? "abierta", color: stage?.color ?? "azul" });
  const [errors, setErrors] = useState<Partial<Record<keyof StageForm, string>>>({});
  const done = (msg: string) => {
    toast.success(msg);
    utils.crmFunnel.invalidate();
    onClose();
  };
  const create = trpc.crmFunnel.createStage.useMutation({ onSuccess: () => done(t("crmFunnel.editor.created")), onError: (e) => setErrors({ name: e.message }) });
  const update = trpc.crmFunnel.updateStage.useMutation({ onSuccess: () => done(t("crmFunnel.editor.saved")), onError: (e) => setErrors({ name: e.message }) });
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
      <FormField id="stage-name" label={t("crmFunnel.editor.name")} error={errors.name} required>
        <Input id="stage-name" value={form.name} maxLength={STAGE_NAME_MAX} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={!!errors.name} aria-required aria-describedby={describedBy("stage-name", errors.name)} autoFocus />
      </FormField>
      <FormField id="stage-kind" label={t("crmFunnel.editor.kind")} error={errors.kind} hint={kindLocked ? t("crmFunnel.editor.kindLocked") : t("crmFunnel.editor.kindHint")}>
        <select id="stage-kind" className={selectClass} value={form.kind} disabled={kindLocked} onChange={(e) => setKind(e.target.value as StageKind)} aria-describedby={describedBy("stage-kind", errors.kind) ?? "stage-kind-hint"}>
          {STAGE_KINDS.map((k) => <option key={k} value={k}>{t(`crmFunnel.kind.${k}`)}</option>)}
        </select>
      </FormField>
      <FormField id="stage-prob" label={t("crmFunnel.editor.probability")} error={errors.probability}>
        <Input id="stage-prob" type="number" inputMode="numeric" min={0} max={100} step={1} value={form.probability} disabled={form.kind !== "abierta"}
          onChange={(e) => setForm({ ...form, probability: Math.round(Number(e.target.value)) })} aria-invalid={!!errors.probability} aria-describedby={describedBy("stage-prob", errors.probability)} />
      </FormField>
      <FormField id="stage-color" label={t("crmFunnel.editor.color")} error={errors.color}>
        <select id="stage-color" className={selectClass} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value as StageColor })}>
          {STAGE_COLORS.map((c) => <option key={c} value={c}>{t(`crmTags.color.${c}`)}</option>)}
        </select>
      </FormField>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>{t("crmFunnel.editor.cancel")}</Button>
        <Button type="submit" disabled={create.isPending || update.isPending}>{stage ? t("crmFunnel.editor.saveChanges") : t("crmFunnel.editor.create")}</Button>
      </DialogFooter>
    </form>
  );
}

function StagesDialog({ open, onClose, stages }: { open: boolean; onClose: () => void; stages: FunnelStage[] }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState<FunnelStage | null | undefined>(undefined);
  const reorder = trpc.crmFunnel.reorderStages.useMutation({ onSuccess: () => utils.crmFunnel.invalidate(), onError: (e) => toastError(e) });
  const remove = trpc.crmFunnel.removeStage.useMutation({
    onSuccess: (r) => {
      toast.success(r.released > 0 ? t("crmFunnel.stages.removedReleased", { n: r.released }) : t("crmFunnel.stages.removed"));
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
          <DialogTitle>{editing === undefined ? t("crmFunnel.stages.title") : editing ? t("crmFunnel.stages.editTitle") : t("crmFunnel.stages.newTitle")}</DialogTitle>
          <DialogDescription>
            {editing === undefined
              ? t("crmFunnel.stages.descList")
              : t("crmFunnel.stages.descEdit")}
          </DialogDescription>
        </DialogHeader>
        {editing !== undefined ? (
          <StageEditor stage={editing} stages={stages} onClose={() => setEditing(undefined)} />
        ) : (
          <>
            <ol className="divide-y divide-border rounded-xl border border-border" aria-label={t("crmFunnel.stages.inOrder")}>
              {stages.map((s, i) => (
                <li key={s.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <StageDot color={s.color} />
                  <span className="min-w-0 flex-1 font-medium text-foreground truncate">{s.name}</span>
                  <span className="text-xs text-muted-foreground">{t(`crmFunnel.kind.${s.kind}`)} · {s.probability} %</span>
                  <Button size="sm" variant="ghost" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} aria-label={t("crmFunnel.stages.moveUp", { name: s.name })}><ArrowUp className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button size="sm" variant="ghost" disabled={i === stages.length - 1 || reorder.isPending} onClick={() => move(i, 1)} aria-label={t("crmFunnel.stages.moveDown", { name: s.name })}><ArrowDown className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)} aria-label={t("crmFunnel.stages.editAria", { name: s.name })}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={!canRemoveStageKind(s, stages) || remove.isPending}
                    onClick={() => remove.mutate({ id: s.id })} aria-label={t("crmFunnel.stages.deleteAria", { name: s.name })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                </li>
              ))}
            </ol>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>{t("crmFunnel.stages.close")}</Button>
              <Button type="button" onClick={() => setEditing(null)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmFunnel.stages.newStage")}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Tablero ─────────────────────────────────────────────────────────────────

export default function CrmFunnel() {
  const { t, format } = useI18n();
  const money = (n: number) => format.currency(n || 0, "EUR", { maximumFractionDigits: 0 });
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
    moveLead.mutate({ leadId: card.id, stageId }, { onSuccess: () => toast.success(t("crmFunnel.board.movedTo", { name: card.name, stage: stage.name })) });
  };

  return (
    <AdminLayout>
      <div className="space-y-5">
        {/* Cabecera compacta: título, búsqueda y configuración en una fila */}
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span aria-hidden="true" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:h-4 [&_svg]:w-4"><Target /></span>
            <div className="min-w-0">
              <h1 className="text-lg font-semibold leading-tight text-foreground">{t("crmFunnel.board.title")}</h1>
              <p className="hidden text-xs text-muted-foreground lg:block">{t("crmFunnel.board.description")}</p>
            </div>
          </div>
          <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <form
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setQuery(search.trim());
              }}
              className="relative min-w-0"
            >
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("crmFunnel.board.searchPlaceholder")} aria-label={t("crmFunnel.board.searchAria")} className="h-9 w-full bg-card pl-8 sm:w-64" />
            </form>
            {canConfigure && (
              <Button variant="outline" onClick={() => setConfigOpen(true)}>
                <Settings2 className="mr-1.5 h-4 w-4" aria-hidden="true" /> {t("crmFunnel.board.configure")}
              </Button>
            )}
          </div>
        </header>

        {forecast && (
          <SummaryStrip items={[
            { key: "open", label: t("crmFunnel.board.openAmount"), value: money(forecast.openAmount), primary: true, tone: "brand" },
            { key: "weighted", label: t("crmFunnel.board.weighted"), value: money(forecast.weightedTotal), tone: "info" },
            { key: "won", label: t("crmFunnel.board.won"), value: money(forecast.wonAmount), tone: "success" },
          ]} />
        )}

        {board.isLoading ? (
          <PanelLoading label={t("crmFunnel.board.loading")} />
        ) : board.isError ? (
          <PanelError error={board.error} onRetry={() => board.refetch()} title={t("crmFunnel.board.loadError")} />
        ) : cards.length === 0 && !query ? (
          <CompactEmpty icon={<Target />} title={t("crmFunnel.board.emptyTitle")} description={t("crmFunnel.board.emptyDesc")} />
        ) : (
          <>
            {board.data?.truncated && <p className="text-sm text-muted-foreground">{t("crmFunnel.board.truncated")}</p>}
            <div className="flex gap-3 overflow-x-auto pb-2" aria-label={t("crmFunnel.board.stagesAria")}>
              {stages.map((s) => {
                const list = byStage.get(s.id) ?? [];
                const f = fOf(s.id);
                return (
                  <section
                    key={s.id}
                    aria-label={t("crmFunnel.board.stageAria", { name: s.name, n: list.length })}
                    className={cn("flex w-72 shrink-0 flex-col rounded-xl border border-border bg-muted/30", over === s.id && "ring-2 ring-primary")}
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
                        <h2 className="min-w-0 flex-1 text-sm font-semibold text-foreground truncate">{s.name}</h2>
                        <span className="text-xs text-muted-foreground">{s.probability} %</span>
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {list.length} · {money(f?.amount ?? 0)}
                        {s.kind === "abierta" && <> · {t("crmFunnel.board.weightedInline", { amount: money(f?.weighted ?? 0) })}</>}
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
                          <Link href={`/admin/crm?tab=leads&search=${encodeURIComponent(c.email)}`} className="block font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring truncate">
                            {c.name}
                          </Link>
                          {c.company && <p className="text-xs text-muted-foreground truncate">{c.company}</p>}
                          <p className="mt-1 text-xs tabular-nums text-foreground">
                            {money(c.amount)} <span className="text-muted-foreground">· {c.probability} %</span>
                          </p>
                          {c.ownerName && <p className="text-xs text-muted-foreground truncate">{t("crmFunnel.board.owner", { name: c.ownerName })}</p>}
                          {s.kind === "perdida" && c.lostReason && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{t("crmFunnel.board.reason", { reason: c.lostReason })}</p>}
                          {canMove && (
                            <label className="mt-2 block text-xs text-muted-foreground">
                              <span className="sr-only">{t("crmFunnel.board.moveAria", { name: c.name })}</span>
                              <select className={cn(selectClass, "h-8 text-xs")} value={c.stageId} disabled={moveLead.isPending} onChange={(e) => requestMove(c, Number(e.target.value))}>
                                {stages.map((o) => <option key={o.id} value={o.id}>{o.id === c.stageId ? t("crmFunnel.board.optionIn", { stage: o.name }) : t("crmFunnel.board.optionMove", { stage: o.name })}</option>)}
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
            <DialogTitle>{t("crmFunnel.board.lostTitle")}</DialogTitle>
            <DialogDescription>{losing ? t("crmFunnel.board.lostDesc", { name: losing.card.name, stage: losing.stage.name }) : ""}</DialogDescription>
          </DialogHeader>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!losing || !reason.trim()) return;
              moveLead.mutate({ leadId: losing.card.id, stageId: losing.stage.id, lostReason: reason.trim() }, { onSuccess: () => toast.success(t("crmFunnel.board.markedLost")) });
            }}
            className="space-y-4"
          >
            <FormField id="lost-reason" label={t("crmFunnel.board.reasonLabel")} required>
              <Textarea id="lost-reason" value={reason} maxLength={LOST_REASON_MAX} onChange={(e) => setReason(e.target.value)} rows={3} aria-required autoFocus />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLosing(null)}>{t("crmFunnel.board.cancel")}</Button>
              <Button type="submit" variant="destructive" disabled={!reason.trim() || moveLead.isPending}>{t("crmFunnel.board.markLost")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
