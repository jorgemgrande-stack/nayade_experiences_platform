/**
 * Formación digital (Elephant LMS) — administración del tenant: /admin/formacion.
 * Matrículas (estado, módulos, fin, origen y pago; prorrogar, suspender, revocar, reactivar, invitar, historial),
 * cursos y materiales (cobertura, recursos pendientes con subida de fichero, publicar), reglas por modalidad y demostración.
 * Toda acción sensible pide motivo y queda en el historial de la matrícula. Sin permisos globales de plataforma.
 */
import { confirmAction } from "@/components/admin/ConfirmHost";
import { useState } from "react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelDataList, PanelPageHeader, StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";
import { effectiveStatus } from "@shared/learning";
import { AlertTriangle, BarChart3, BookPlus, Film, FolderOpen, GraduationCap, PenSquare, PlayCircle, ShieldCheck, Users, Wrench, type LucideIcon } from "lucide-react";
import CourseEditor from "./CourseEditor";
import Materials from "./Materials";
import Authoring from "./Authoring";
import Rules from "./Rules";
import StudentProgress from "./StudentProgress";

function useFmt() {
  const { t, format } = useI18n();
  return (ms: number | null) => (ms ? format.dateTime(ms, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }) : t("learningAdmin.noExpiry"));
}
const STATUS_KEYS = ["active", "scheduled", "expired", "suspended", "revoked"];
const STATUS_TONE: Record<string, Tone> = { active: "success", scheduled: "info", expired: "neutral", suspended: "warning", revoked: "danger" };
type Tab = "matriculas" | "progreso" | "cursos" | "crear" | "materiales" | "editor" | "reglas" | "demo" | "tecnica";
const TABS: Tab[] = ["matriculas", "progreso", "cursos", "crear", "materiales", "editor", "reglas", "demo", "tecnica"];

function ReasonDialog({ title, withDate, onClose, onSubmit }: { title: string; withDate?: boolean; onClose: () => void; onSubmit: (v: { reason: string; date: string }) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {withDate && <label className="block text-sm">{t("learningAdmin.reason.newEnd")}<Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
          <label className="block text-sm">{t("learningAdmin.reason.label")}<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("learningAdmin.reason.placeholder")} /></label>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("learningAdmin.cancel")}</Button><Button disabled={reason.trim().length < 8} onClick={() => onSubmit({ reason, date })}>{t("learningAdmin.confirm")}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Cola de recuperación: pedidos de la tienda PAGADOS con regla de acceso activa y sin matrícula. «Reparar acceso» llama al
 * procedimiento existente `grantForOrder`, que vuelve a aplicar las reglas del catálogo solo a líneas con pago confirmado
 * (idempotente: no duplica matrículas ni correos). Aquí no se concede nada por libre ni se evita ninguna condición de pago.
 */
function PendingOrders() {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.pendingOrders.useQuery();
  const [busy, setBusy] = useState<string | null>(null);
  const grantForOrder = trpc.learning.admin.grantForOrder.useMutation();
  async function repair(merchantOrder: string) {
    if (!(await confirmAction({ title: t("learningAdmin.pending.confirmTitle"), description: t("learningAdmin.pending.confirmDesc", { order: merchantOrder }), confirmLabel: t("learningAdmin.pending.repair") }))) return;
    setBusy(merchantOrder);
    try {
      const r = await grantForOrder.mutateAsync({ merchantOrder });
      if (r.status === "granted") toast.success(t("learningAdmin.pending.granted", { created: r.created, existing: r.existing }));
      else toast.error(t(`learningAdmin.pending.skipped.${r.reason}`));
      await Promise.all([utils.learning.admin.pendingOrders.invalidate(), utils.learning.admin.enrollments.invalidate()]);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }
  if (q.isLoading) return null;
  if (q.isError) return <PanelError title={t("learningAdmin.pending.errorTitle")} error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.length) return null;
  return (
    <section className="space-y-3 rounded-xl border border-warning/50 bg-warning/10 p-4" aria-labelledby="learning-pending-title">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <h2 id="learning-pending-title" className="font-semibold text-foreground">{t("learningAdmin.pending.title", { n: q.data!.length })}</h2>
          <p className="text-sm text-muted-foreground">{t("learningAdmin.pending.intro")}</p>
        </div>
      </div>
      <PanelDataList
        caption={t("learningAdmin.pending.title", { n: q.data!.length })}
        rows={q.data!}
        rowKey={(o) => o.reservationId}
        columns={[
          { key: "order", header: t("learningAdmin.pending.order"), cell: (o) => <span className="font-mono">{o.merchantOrder}</span> },
          { key: "email", header: t("learningAdmin.pending.email"), cell: (o) => o.email ?? t("learningAdmin.pending.noEmail") },
          { key: "paid", header: t("learningAdmin.pending.paidAt"), cell: (o) => (o.paidAt ? format.dateTime(o.paidAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }) : "—") },
          { key: "actions", header: t("learningAdmin.enrollments.actions"), align: "right", cell: (o) => <Button size="sm" variant="outline" disabled={busy != null} onClick={() => void repair(o.merchantOrder)}>{busy === o.merchantOrder ? t("learningAdmin.pending.repairing") : t("learningAdmin.pending.repair")}</Button> },
        ]}
      />
    </section>
  );
}

/**
 * Retiros SIN convocatoria: presupuestos PAGADOS con regla de acceso activa y aún sin derecho. Los de duración variable piden
 * confirmar los días contratados (nunca se conceden solos); el resto se concede en el barrido o con «Conceder ahora». Todo
 * idempotente: el derecho nace pendiente de activar por la persona.
 */
function PendingQuotes() {
  const { t, format } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.pendingQuotes.useQuery();
  const [days, setDays] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const confirmDays = trpc.learning.admin.confirmContractedDays.useMutation();
  const grantForQuote = trpc.learning.admin.grantForQuote.useMutation();
  const refresh = () => Promise.all([utils.learning.admin.pendingQuotes.invalidate(), utils.learning.admin.enrollments.invalidate()]);
  async function confirmTerms(p: { quoteId: number; quoteNumber: string }) {
    const n = Number(days[p.quoteId]);
    if (!Number.isInteger(n) || n < 1) return;
    if (!(await confirmAction({ title: t("learningAdmin.pendingQuotes.confirmTitle"), description: t("learningAdmin.pendingQuotes.confirmDesc", { days: n, quote: p.quoteNumber }), confirmLabel: t("learningAdmin.pendingQuotes.confirm") }))) return;
    setBusy(p.quoteId);
    try {
      const r = await confirmDays.mutateAsync({ quoteId: p.quoteId, days: n, reason: t("learningAdmin.pendingQuotes.reasonDefault") });
      if (r.status === "granted") toast.success(t("learningAdmin.pendingQuotes.granted", { created: r.created, existing: r.existing }));
      else if (r.status === "needs_terms") toast.info(t("learningAdmin.pendingQuotes.notYet"));
      else toast.error(t("learningAdmin.pendingQuotes.skipped", { reason: r.reason }));
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }
  async function grant(p: { quoteId: number }) {
    setBusy(p.quoteId);
    try {
      const r = await grantForQuote.mutateAsync({ quoteId: p.quoteId });
      if (r.status === "granted") toast.success(t("learningAdmin.pendingQuotes.granted", { created: r.created, existing: r.existing }));
      else toast.error(t("learningAdmin.pendingQuotes.skipped", { reason: r.status === "skipped" ? r.reason : r.status }));
      await refresh();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }
  if (q.isLoading) return null;
  if (q.isError) return <PanelError title={t("learningAdmin.pendingQuotes.errorTitle")} error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.length) return null;
  return (
    <section className="space-y-3 rounded-xl border border-warning/50 bg-warning/10 p-4" aria-labelledby="learning-pending-quotes-title">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
        <div>
          <h2 id="learning-pending-quotes-title" className="font-semibold text-foreground">{t("learningAdmin.pendingQuotes.title", { n: q.data!.length })}</h2>
          <p className="text-sm text-muted-foreground">{t("learningAdmin.pendingQuotes.intro")}</p>
        </div>
      </div>
      <PanelDataList
        caption={t("learningAdmin.pendingQuotes.title", { n: q.data!.length })}
        rows={q.data!}
        rowKey={(p) => p.quoteId}
        columns={[
          { key: "quote", header: t("learningAdmin.pendingQuotes.quote"), cell: (p) => <span className="font-mono">{p.quoteNumber}</span> },
          { key: "email", header: t("learningAdmin.pendingQuotes.email"), cell: (p) => p.email ?? t("learningAdmin.pending.noEmail") },
          { key: "paid", header: t("learningAdmin.pending.paidAt"), cell: (p) => (p.paidAt ? format.dateTime(p.paidAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }) : "—") },
          { key: "state", header: "", cell: (p) => (p.needsTermsMinDays != null ? t("learningAdmin.pendingQuotes.needs", { n: p.needsTermsMinDays }) : t("learningAdmin.pendingQuotes.ready")) },
          {
            key: "actions", header: t("learningAdmin.enrollments.actions"), align: "right",
            cell: (p) => p.needsTermsMinDays != null ? (
              <span className="inline-flex items-center gap-2">
                <input aria-label={t("learningAdmin.pendingQuotes.days")} type="number" min={1} max={365} className="h-8 w-16 rounded-md border bg-background px-2 text-sm" value={days[p.quoteId] ?? ""} onChange={(e) => setDays({ ...days, [p.quoteId]: e.target.value })} />
                <Button size="sm" variant="outline" disabled={busy != null || !(Number(days[p.quoteId]) >= 1)} onClick={() => void confirmTerms(p)}>{t("learningAdmin.pendingQuotes.confirm")}</Button>
              </span>
            ) : <Button size="sm" variant="outline" disabled={busy != null} onClick={() => void grant(p)}>{t("learningAdmin.pendingQuotes.grant")}</Button>,
          },
        ]}
      />
    </section>
  );
}

function Enrollments() {
  const { t } = useI18n();
  const fmt = useFmt();
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.enrollments.useQuery();
  const [dialog, setDialog] = useState<null | { id: number; kind: "extend" | "revoke" | "suspend" | "reactivate" }>(null);
  const [history, setHistory] = useState<number | null>(null);
  const ev = trpc.learning.admin.events.useQuery({ enrollmentId: history ?? 1 }, { enabled: history != null });
  const done = { onSuccess: () => { utils.learning.admin.enrollments.invalidate(); setDialog(null); toast.success(t("learningAdmin.done")); }, onError: (e: unknown) => toastError(e) };
  const extend = trpc.learning.admin.extend.useMutation(done);
  const revoke = trpc.learning.admin.revoke.useMutation(done);
  const suspend = trpc.learning.admin.suspend.useMutation(done);
  const reactivate = trpc.learning.admin.reactivate.useMutation(done);
  const invite = trpc.learning.admin.sendInvite.useMutation({ onSuccess: (r) => toast[r.sent ? "success" : "info"](r.sent ? t("learningAdmin.enrollments.inviteSent") : t("learningAdmin.enrollments.alreadyActive")), onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const now = Date.now();
  if (!q.data!.length) return <div className="space-y-4"><PendingOrders /><PendingQuotes /><PanelEmpty title={t("learningAdmin.enrollments.emptyTitle")} description={t("learningAdmin.enrollments.emptyDesc")} /></div>;
  return (
    <div className="space-y-4">
      <PendingOrders />
      <PendingQuotes />
      <PanelDataList
        caption={t("learningAdmin.tabs.enrollments")}
        rows={q.data!}
        rowKey={(e) => e.id}
        columns={[
          { key: "person", header: t("learningAdmin.enrollments.person"), cell: (e) => <><span className="font-medium">{e.userName ?? "—"}</span><span className="block break-all text-xs font-normal text-muted-foreground">{e.userEmail}</span></> },
          { key: "state", header: t("learningAdmin.enrollments.state"), cell: (e) => { const st = effectiveStatus(e, now); return <StatusBadge tone={STATUS_TONE[st] ?? "neutral"}>{STATUS_KEYS.includes(st) ? t(`learningAdmin.status.${st}`) : st}</StatusBadge>; } },
          { key: "modules", header: t("learningAdmin.enrollments.modules"), cell: (e) => e.moduleIds.length },
          { key: "end", header: t("learningAdmin.enrollments.end"), cell: (e) => fmt(e.endsAt) },
          { key: "origin", header: t("learningAdmin.enrollments.origin"), className: "text-xs", cell: (e) => e.source === "payment" ? t("learningAdmin.enrollments.payment", { ref: e.paymentRef ?? "" }) : e.source === "demo" ? t("learningAdmin.enrollments.demo") : t("learningAdmin.enrollments.grant", { reason: e.grantReason ?? "" }) },
          { key: "actions", header: t("learningAdmin.enrollments.actions"), cell: (e) => (
            <div className="flex flex-wrap justify-end gap-1">
              <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "extend" })}>{t("learningAdmin.enrollments.extend")}</Button>
              {e.status === "active" && <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "suspend" })}>{t("learningAdmin.enrollments.suspend")}</Button>}
              {e.status !== "revoked" && <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "revoke" })}>{t("learningAdmin.enrollments.revoke")}</Button>}
              {e.status !== "active" && <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "reactivate" })}>{t("learningAdmin.enrollments.reactivate")}</Button>}
              <Button size="sm" variant="ghost" onClick={() => invite.mutate({ userId: e.userId })}>{t("learningAdmin.enrollments.invite")}</Button>
              <Button size="sm" variant="ghost" onClick={() => setHistory(e.id)}>{t("learningAdmin.enrollments.history")}</Button>
            </div>
          ) },
        ]}
      />
      {dialog && (
        <ReasonDialog
          title={{ extend: t("learningAdmin.enrollments.extendTitle"), revoke: t("learningAdmin.enrollments.revokeTitle"), suspend: t("learningAdmin.enrollments.suspendTitle"), reactivate: t("learningAdmin.enrollments.reactivateTitle") }[dialog.kind]}
          withDate={dialog.kind === "extend"}
          onClose={() => setDialog(null)}
          onSubmit={({ reason, date }) => {
            if (dialog.kind === "extend") extend.mutate({ enrollmentId: dialog.id, newEndsAt: date ? new Date(date).getTime() : null, reason });
            else if (dialog.kind === "revoke") revoke.mutate({ enrollmentId: dialog.id, reason });
            else if (dialog.kind === "suspend") suspend.mutate({ enrollmentId: dialog.id, reason });
            else reactivate.mutate({ enrollmentId: dialog.id, reason });
          }}
        />
      )}
      <Dialog open={history != null} onOpenChange={(o) => !o && setHistory(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t("learningAdmin.enrollments.historyTitle")}</DialogTitle></DialogHeader>
          <ul className="max-h-80 space-y-2 overflow-auto text-sm">
            {(ev.data ?? []).map((x) => (<li key={x.id} className="rounded border p-2"><div className="font-medium">{x.type}</div><div className="text-xs text-muted-foreground">{fmt(x.createdAt)}{x.actorUserId ? t("learningAdmin.enrollments.user", { id: x.actorUserId }) : ""}</div><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(x.detail)}</pre></li>))}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Courses({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.courses.useQuery();
  const setStatus = trpc.learning.admin.setCourseStatus.useMutation({ onSuccess: () => utils.learning.admin.courses.invalidate(), onError: (e) => toastError(e) });
  const [busy, setBusy] = useState<number | null>(null);
  async function upload(resourceId: number, file: File) {
    setBusy(resourceId);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/learning/upload/${resourceId}`, { method: "POST", body: fd, credentials: "include" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? t("learningAdmin.courses.uploadFail"));
      toast.success(j.duplicateOf?.length ? t("learningAdmin.courses.uploadedDup", { n: j.duplicateOf.length }) : t("learningAdmin.courses.uploaded"));
      utils.learning.admin.courses.invalidate();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.length) return <PanelEmpty title={t("learningAdmin.courses.emptyTitle")} description={t("learningAdmin.courses.emptyDesc")}><Button onClick={onCreate}>{t("learningAdmin.createCourse")}</Button></PanelEmpty>;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">{t("learningAdmin.courses.visibilityNote")}</p>
      {q.data!.map((c) => (
        <section key={c.id} className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold">{c.title} <StatusBadge tone={c.status === "published" ? "success" : c.status === "draft" ? "warning" : "neutral"}>{c.status === "draft" ? t("learningAdmin.courseStatus.draft") : c.status === "published" ? t("learningAdmin.courseStatus.published") : t("learningAdmin.courseStatus.archived")}</StatusBadge></h2>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" asChild><a href={`/admin/formacion/vista-previa/curso/${c.id}`}>{t("learningAdmin.courses.preview")}</a></Button>
              {c.status !== "published" && <Button size="sm" onClick={async () => (await confirmAction({ description: t("learningAdmin.courses.publishConfirm", { title: c.title, missing: c.coverage.files.pending ? t("learningAdmin.courses.missingFiles", { n: c.coverage.files.pending }) : "" }) })) && setStatus.mutate({ courseId: c.id, status: "published" })}>{t("learningAdmin.courses.publish")}</Button>}
              {c.status === "published" && <Button size="sm" variant="outline" onClick={async () => (await confirmAction({ description: t("learningAdmin.courses.draftConfirm", { title: c.title }) })) && setStatus.mutate({ courseId: c.id, status: "draft" })}>{t("learningAdmin.courses.backToDraft")}</Button>}
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("learningAdmin.courses.summary", { modules: c.modules.length, verified: c.coverage.files.verified, pending: c.coverage.files.pending })}</p>
          {c.sourceNote && <p className="mt-1 text-xs text-muted-foreground">{c.sourceNote}</p>}
          {c.pending.length > 0 && (
            <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">{t("learningAdmin.courses.pendingMaterials", { n: c.pending.length })}</summary>
              <ul className="mt-2 divide-y text-sm">
                {c.pending.map((p) => (
                  <li key={p.resourceId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span>M{p.module} · L{p.lesson} · {p.lessonTitle} — <span className="text-muted-foreground">{p.kind}{p.originalName ? ` · ${p.originalName}` : ""}</span></span>
                    <label className="cursor-pointer text-sm text-primary underline">
                      {busy === p.resourceId ? t("learningAdmin.courses.uploading") : t("learningAdmin.courses.uploadFile")}
                      <input type="file" className="sr-only" disabled={busy != null} onChange={(e) => e.target.files?.[0] && upload(p.resourceId, e.target.files[0])} />
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ))}
    </div>
  );
}

function Demo() {
  const { t } = useI18n();
  const courses = trpc.learning.admin.courses.useQuery();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState(0);
  const [trigger, setTrigger] = useState("");
  const [moduleIds, setModuleIds] = useState<number[]>([]);
  const demo = trpc.learning.admin.grantDemoByEmail.useMutation({ onSuccess: (r) => toast.success(r.created ? t("learningAdmin.demo.granted") : t("learningAdmin.demo.already")), onError: (e) => toastError(e) });
  const course = courses.data?.find((c) => c.id === courseId);
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-sm text-muted-foreground">{t("learningAdmin.demo.intro")}</p>
      <label className="block text-sm">{t("learningAdmin.demo.name")}<Input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block text-sm">{t("learningAdmin.demo.email")}<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="block text-sm">{t("learningAdmin.demo.course")}
        <select className="mt-1 w-full rounded-md border bg-background p-2" value={courseId} onChange={(e) => { setCourseId(Number(e.target.value)); setModuleIds([]); }}>
          <option value={0}>{t("learningAdmin.demo.choose")}</option>{(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </label>
      {course && <fieldset className="text-sm"><legend>{t("learningAdmin.demo.modules")}</legend>{course.modules.map((m) => <label key={m.id} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={moduleIds.includes(m.id)} onChange={(e) => setModuleIds(e.target.checked ? [...moduleIds, m.id] : moduleIds.filter((x) => x !== m.id))} />{m.title}</label>)}</fieldset>}
      <label className="block text-sm">{t("learningAdmin.demo.trigger")}<Input value={trigger} onChange={(e) => setTrigger(e.target.value)} /></label>
      <Button disabled={!email || name.length < 2 || !courseId || !moduleIds.length || trigger.length < 3 || demo.isPending} onClick={() => demo.mutate({ email, name, courseId, moduleIds, trigger })}>{t("learningAdmin.demo.submit")}</Button>
    </div>
  );
}

function Tecnica() {
  const { t, format } = useI18n();
  const courses = trpc.learning.admin.courses.useQuery();
  const audit = trpc.learning.admin.previewAccess.useQuery();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState(0);
  const [note, setNote] = useState("");
  const [moduleIds, setModuleIds] = useState<number[]>([]);
  const grant = trpc.learning.admin.grantTechnical.useMutation({ onSuccess: (r) => toast.success(r.created ? t("learningAdmin.tech.granted") : t("learningAdmin.tech.already")), onError: (e) => toastError(e) });
  const course = courses.data?.find((c) => c.id === courseId);
  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">{t("learningAdmin.tech.intro")}</p>
      <label className="block text-sm">{t("learningAdmin.demo.name")}<Input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block text-sm">{t("learningAdmin.tech.testEmail")}<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="block text-sm">{t("learningAdmin.demo.course")}
        <select className="mt-1 w-full rounded-md border bg-background p-2" value={courseId} onChange={(e) => { setCourseId(Number(e.target.value)); setModuleIds([]); }}>
          <option value={0}>{t("learningAdmin.demo.choose")}</option>{(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </label>
      {course && <fieldset className="text-sm"><legend>{t("learningAdmin.tech.modules")}</legend>{course.modules.map((m) => <label key={m.id} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={moduleIds.includes(m.id)} onChange={(e) => setModuleIds(e.target.checked ? [...moduleIds, m.id] : moduleIds.filter((x) => x !== m.id))} />{m.title}</label>)}</fieldset>}
      <label className="block text-sm">{t("learningAdmin.tech.note")}<Input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <Button disabled={!email || name.length < 2 || !courseId || !moduleIds.length || grant.isPending} onClick={() => grant.mutate({ email, name, courseId, moduleIds, note: note || null })}>{t("learningAdmin.tech.submit")}</Button>
      <div>
        <h3 className="mb-1 text-sm font-semibold">{t("learningAdmin.tech.auditTitle")}</h3>
        {audit.isLoading ? <PanelLoading /> : audit.isError ? <PanelError error={audit.error} onRetry={() => audit.refetch()} /> : !audit.data!.length ? <p className="text-sm text-muted-foreground">{t("learningAdmin.tech.noAccess")}</p> : (
          <ul className="max-h-60 space-y-1 overflow-auto text-xs text-muted-foreground">{audit.data!.map((e) => <li key={e.id}>{t("learningAdmin.tech.auditLine", { date: format.dateTime(e.createdAt, { day: "numeric", month: "numeric", year: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }), type: e.type.replace("admin_preview_", ""), user: e.actorUserId ?? "—", detail: JSON.stringify(e.detail) })}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

export default function LearningAdmin() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>(() => {
    // La pestaña vive en la URL (?tab=): recargar o volver desde la vista previa no pierde el sitio
    try { const v = new URLSearchParams(window.location.search).get("tab"); if (v && TABS.includes(v as Tab)) return v as Tab; } catch { /* sin URL */ }
    return "matriculas";
  });
  const selectTab = (k: Tab) => {
    setTab(k);
    try { const u = new URL(window.location.href); u.searchParams.set("tab", k); window.history.replaceState(null, "", u); } catch { /* sin historial */ }
  };
  // Uso diario a la izquierda; las herramientas técnicas (pruebas y auditoría) quedan aparte, a la derecha
  const tabs: Array<[Tab, string, LucideIcon]> = [["matriculas", t("learningAdmin.tabs.enrollments"), Users], ["progreso", t("learningAdmin.tabs.progress"), BarChart3], ["editor", t("learningAdmin.tabs.editor"), PenSquare], ["cursos", t("learningAdmin.tabs.courses"), FolderOpen], ["crear", t("learningAdmin.tabs.create"), BookPlus], ["materiales", t("learningAdmin.tabs.materials"), Film], ["reglas", t("learningAdmin.tabs.rules"), ShieldCheck], ["demo", t("learningAdmin.tabs.demo"), PlayCircle]];
  const tech: [Tab, string, LucideIcon] = ["tecnica", t("learningAdmin.tabs.tech"), Wrench];
  const allTabs = Object.fromEntries([...tabs, tech].map((x) => [x[0], x])) as Record<Tab, [Tab, string, LucideIcon]>;
  const groups: Array<{ key: string; label: string; icon: LucideIcon; tabs: Tab[] }> = [
    { key: "courses", label: t("learningAdmin.groups.courses"), icon: FolderOpen, tabs: ["cursos", "editor", "crear"] },
    { key: "content", label: t("learningAdmin.groups.content"), icon: Film, tabs: ["materiales"] },
    { key: "students", label: t("learningAdmin.groups.students"), icon: Users, tabs: ["matriculas"] },
    { key: "tracking", label: t("learningAdmin.groups.tracking"), icon: BarChart3, tabs: ["progreso"] },
    { key: "settings", label: t("learningAdmin.groups.settings"), icon: Wrench, tabs: ["reglas", "demo", "tecnica"] },
  ];
  const current = groups.find((g) => g.tabs.includes(tab));
  const tabButton = ([k, label, Icon]: [Tab, string, LucideIcon]) => (
    <button key={k} role="tab" aria-selected={tab === k} onClick={() => selectTab(k)} className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm ${tab === k ? "border-b-2 border-primary font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}><Icon className="h-4 w-4" aria-hidden />{label}</button>
  );
  return (
    <AdminLayout>
      <div className="space-y-5">
        <PanelPageHeader className="mb-0" icon={<GraduationCap />} title={t("learningAdmin.title")} description={t("learningAdmin.subtitle")} actions={tab !== "crear" ? <Button onClick={() => selectTab("crear")}><BookPlus className="mr-1.5 h-4 w-4" aria-hidden />{t("learningAdmin.createCourse")}</Button> : undefined} />
        {/* Cinco grupos funcionales; las páginas de cada grupo (si hay varias) en una segunda fila. Las rutas y el parámetro ?tab= no cambian */}
        <nav aria-label={t("learningAdmin.groups.aria")} className="flex flex-wrap gap-1 rounded-xl border border-border bg-muted/40 p-1">
          {groups.map((g) => {
            const on = g.tabs.includes(tab);
            return (
              <button
                key={g.key}
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => selectTab(on ? tab : g.tabs[0])}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? "bg-card font-semibold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <g.icon className="h-4 w-4" aria-hidden />
                {g.label}
              </button>
            );
          })}
        </nav>
        {current && current.tabs.length > 1 && (
          <div role="tablist" aria-label={t("learningAdmin.groups.subAria")} className="-mt-2 flex gap-1 overflow-x-auto border-b border-border">
            {current.tabs.map((k) => tabButton(allTabs[k]))}
          </div>
        )}
        {tab === "matriculas" && <Enrollments />}
        {tab === "cursos" && <Courses onCreate={() => selectTab("crear")} />}
        {tab === "editor" && <CourseEditor />}
        {tab === "progreso" && <StudentProgress />}
        {tab === "crear" && <Authoring />}
        {tab === "materiales" && <Materials />}
        {tab === "reglas" && <Rules />}
        {tab === "demo" && <Demo />}
        {tab === "tecnica" && <Tecnica />}
      </div>
    </AdminLayout>
  );
}
