/**
 * Ski Net · Profesores — Liquidaciones (/admin/ski/liquidaciones): vista previa de lo impartido sin liquidar de un
 * profesor en un periodo, cierre con importes congelados, exportación CSV y PDF y anulación con motivo (la anulada
 * queda registrada y sus sesiones pueden volver a liquidarse).
 */
import { useState } from "react";
import { Coins, Download, FileText, Plus } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { useAsk } from "@/components/ski/AskDialog";
import { SkiSchoolShell, skiErrorMessage, todayIso, toastSki, type SkiCtx } from "@/components/ski/SkiSchoolShell";
import { PAY_LABEL, hours } from "@/pages/admin/ski/SkiTeacherHours";

const eur = (c: number) => (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Line = { id?: number; sessionId?: number | null; date: string | null; description: string; minutes: number; baseCents: number; amountCents: number };
function Lines({ lines, percent }: { lines: Line[]; percent: boolean }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border text-sm">
      {lines.map((l, i) => (
        <li key={l.id ?? i} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <span className="min-w-0 break-words text-foreground">
            {l.date ? `${l.date} · ` : ""}
            {l.description}
          </span>
          <span className="text-xs text-muted-foreground">
            {l.minutes ? hours(l.minutes) : ""}
            {percent ? ` · facturado ${eur(l.baseCents)}` : ""} · <span className="font-medium text-foreground">{eur(l.amountCents)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function NewSettlement({ ctx, onDone }: { ctx: SkiCtx; onDone: (id: number) => void }) {
  const utils = trpc.useUtils();
  const instructors = trpc.skiSchool.listInstructors.useQuery({ siteId: ctx.siteId });
  const t = todayIso();
  const [instructorId, setInstructor] = useState<number | null>(null);
  const [from, setFrom] = useState(`${t.slice(0, 7)}-01`);
  const [to, setTo] = useState(t);
  const [asked, setAsked] = useState(false);
  const iid = instructorId ?? instructors.data?.find((i) => i.active)?.id ?? null;
  const preview = trpc.skiSchool.previewSettlement.useQuery({ siteId: ctx.siteId, instructorId: iid ?? 0, from, to }, { enabled: asked && iid != null, retry: false });
  const close = trpc.skiSchool.closeSettlement.useMutation({
    onSuccess: (s) => {
      toast.success(`Liquidación cerrada: ${eur(s.totalCents)}`);
      utils.skiSchool.listSettlements.invalidate();
      onDone(s.id);
    },
    onError: toastSki,
  });
  if (instructors.isLoading) return <PanelLoading />;
  if (instructors.error) return <PanelError error={instructors.error} onRetry={() => instructors.refetch()} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="st-ins" label="Profesor">
          <select id="st-ins" className={selectClass} value={iid ?? ""} onChange={(e) => (setInstructor(Number(e.target.value)), setAsked(false))}>
            {(instructors.data ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.fullName}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="st-from" label="Desde">
          <Input id="st-from" type="date" value={from} onChange={(e) => (setFrom(e.target.value), setAsked(false))} />
        </FormField>
        <FormField id="st-to" label="Hasta">
          <Input id="st-to" type="date" value={to} onChange={(e) => (setTo(e.target.value), setAsked(false))} />
        </FormField>
      </div>
      <Button variant="outline" onClick={() => setAsked(true)} disabled={iid == null}>
        Calcular
      </Button>
      {asked && preview.isLoading && <PanelLoading label="Calculando…" />}
      {asked && preview.error && <p className="text-sm text-destructive">{skiErrorMessage(preview.error)}</p>}
      {asked && preview.data && (
        <div className="space-y-3">
          <p className="text-sm text-foreground">
            {PAY_LABEL[preview.data.payMode]} · {preview.data.sessions} sesiones · {hours(preview.data.minutes)} · total <strong>{eur(preview.data.totalCents)}</strong>
          </p>
          {preview.data.overlapping && <p className="text-sm text-destructive">Ya hay una liquidación vigente de este profesor que se solapa con este periodo.</p>}
          <Lines lines={preview.data.lines} percent={preview.data.payMode === "percent"} />
          <DialogFooter>
            <Button disabled={close.isPending || preview.data.overlapping} onClick={() => iid != null && close.mutate({ siteId: ctx.siteId, instructorId: iid, from, to })}>
              Cerrar la liquidación
            </Button>
          </DialogFooter>
          <p className="text-xs text-muted-foreground">Al cerrarla los importes quedan congelados: cambiar después las condiciones no la modifica.</p>
        </div>
      )}
    </div>
  );
}

function Detail({ ctx, id }: { ctx: SkiCtx; id: number }) {
  const utils = trpc.useUtils();
  const q = trpc.skiSchool.getSettlement.useQuery({ siteId: ctx.siteId, settlementId: id });
  const { ask, dialog } = useAsk();
  const pdf = trpc.skiSchool.exportSettlementPdf.useMutation({
    onSuccess: (r) => download(r.filename, new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], { type: "application/pdf" })),
    onError: toastSki,
  });
  const voidIt = trpc.skiSchool.voidSettlement.useMutation({
    onSuccess: () => {
      toast.success("Liquidación anulada");
      utils.skiSchool.listSettlements.invalidate();
      utils.skiSchool.getSettlement.invalidate();
    },
    onError: toastSki,
  });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data!;
  const csv = async () => {
    try {
      const r = await utils.skiSchool.exportSettlementCsv.fetch({ siteId: ctx.siteId, settlementId: id });
      download(r.filename, new Blob([r.content], { type: "text/csv;charset=utf-8" }));
    } catch (e) {
      toastSki(e);
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-foreground">
        {s.instructorName} · {s.periodStart} → {s.periodEnd} · {PAY_LABEL[s.payMode]} · <strong>{eur(s.totalCents)}</strong>{" "}
        <Badge variant={s.status === "closed" ? "default" : "secondary"}>{s.status === "closed" ? "Cerrada" : "Anulada"}</Badge>
      </p>
      {s.voidReason && <p className="break-words text-xs text-muted-foreground">Motivo de la anulación: {s.voidReason}</p>}
      <Lines lines={s.lines} percent={s.payMode === "percent"} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={csv}>
          <Download className="mr-1.5 h-4 w-4" aria-hidden="true" />
          CSV
        </Button>
        <Button variant="outline" disabled={pdf.isPending} onClick={() => pdf.mutate({ siteId: ctx.siteId, settlementId: id })}>
          <FileText className="mr-1.5 h-4 w-4" aria-hidden="true" />
          PDF
        </Button>
        {ctx.canWrite && s.status === "closed" && (
          <Button
            variant="ghost"
            className="text-destructive"
            onClick={async () => {
              const reason = await ask({ title: "Anular la liquidación", description: "Queda registrada como anulada y sus sesiones podrán volver a liquidarse.", label: "Motivo", required: true, confirmLabel: "Anular", destructive: true });
              if (reason) voidIt.mutate({ siteId: ctx.siteId, settlementId: id, reason });
            }}
          >
            Anular
          </Button>
        )}
      </div>
      {dialog}
    </div>
  );
}

function Body({ ctx }: { ctx: SkiCtx }) {
  const q = trpc.skiSchool.listSettlements.useQuery({ siteId: ctx.siteId });
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      {ctx.canWrite && (
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Nueva liquidación
        </Button>
      )}
      {q.isLoading ? (
        <PanelLoading />
      ) : q.error ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} />
      ) : q.data!.length === 0 ? (
        <PanelEmpty icon={<Coins className="h-5 w-5" />} title="Todavía no hay liquidaciones" description="Configura las condiciones de pago de cada profesor en «Control de horas» y liquida lo impartido de un periodo." />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {q.data!.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s.id)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="min-w-0">
                  <span className="block break-words text-sm font-medium text-foreground">
                    #{s.id} · {s.instructorName}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {s.periodStart} → {s.periodEnd} · {PAY_LABEL[s.payMode]} · {s.sessions} sesiones
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{eur(s.totalCents)}</span>
                  {s.status === "voided" && <Badge variant="secondary">Anulada</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nueva liquidación</DialogTitle>
            <DialogDescription>Sesiones impartidas (con lista pasada o marcadas como impartidas) y sin liquidar del periodo.</DialogDescription>
          </DialogHeader>
          {creating && <NewSettlement ctx={ctx} onDone={(id) => (setCreating(false), setOpen(id))} />}
        </DialogContent>
      </Dialog>
      <Dialog open={open != null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Liquidación #{open}</DialogTitle>
            <DialogDescription>Importes congelados al cerrarla.</DialogDescription>
          </DialogHeader>
          {open != null && <Detail ctx={ctx} id={open} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function SkiSettlements() {
  return (
    <SkiSchoolShell title="Liquidaciones de profesores" description="Liquida lo impartido por cada profesor con sus condiciones de pago y expórtalo en CSV o PDF.">
      {(ctx) => <Body ctx={ctx} />}
    </SkiSchoolShell>
  );
}
