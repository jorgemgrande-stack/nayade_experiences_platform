/**
 * Formación digital (Elephant LMS) — administración del tenant: /admin/formacion.
 * Matrículas (estado, módulos, fin, origen y pago; prorrogar, suspender, revocar, reactivar, invitar, historial),
 * cursos y materiales (cobertura, recursos pendientes con subida de fichero, publicar), reglas por modalidad y demostración.
 * Toda acción sensible pide motivo y queda en el historial de la matrícula. Sin permisos globales de plataforma.
 */
import { useState } from "react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { useI18n } from "@/i18n/I18nProvider";
import { effectiveStatus } from "@shared/learning";
import { BarChart3, BookPlus, Film, FolderOpen, GraduationCap, PenSquare, PlayCircle, ShieldCheck, Users, Wrench, type LucideIcon } from "lucide-react";
import CourseEditor from "./CourseEditor";
import Materials from "./Materials";
import Authoring from "./Authoring";
import Rules from "./Rules";
import StudentProgress from "./StudentProgress";

function useFmt() {
  const { t, format } = useI18n();
  return (ms: number | null) => (ms ? format.dateTime(ms, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }) : t("learningAdmin.noExpiry"));
}
type Tab = "matriculas" | "progreso" | "cursos" | "crear" | "materiales" | "editor" | "reglas" | "demo" | "tecnica";

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
  if (!q.data!.length) return <PanelEmpty title={t("learningAdmin.enrollments.emptyTitle")} description={t("learningAdmin.enrollments.emptyDesc")} />;
  const now = Date.now();
  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left"><tr><th className="p-2">{t("learningAdmin.enrollments.person")}</th><th className="p-2">{t("learningAdmin.enrollments.state")}</th><th className="p-2">{t("learningAdmin.enrollments.modules")}</th><th className="p-2">{t("learningAdmin.enrollments.end")}</th><th className="p-2">{t("learningAdmin.enrollments.origin")}</th><th className="p-2" /></tr></thead>
          <tbody>
            {q.data!.map((e) => {
              const st = effectiveStatus(e, now);
              return (
                <tr key={e.id} className="border-t align-top">
                  <td className="p-2"><div className="font-medium">{e.userName ?? "—"}</div><div className="text-xs text-muted-foreground">{e.userEmail}</div></td>
                  <td className="p-2"><Badge variant={st === "active" ? "default" : "secondary"}>{st === "active" ? t("learningAdmin.status.active") : st === "scheduled" ? t("learningAdmin.status.scheduled") : st === "expired" ? t("learningAdmin.status.expired") : st === "suspended" ? t("learningAdmin.status.suspended") : st === "revoked" ? t("learningAdmin.status.revoked") : st}</Badge></td>
                  <td className="p-2">{e.moduleIds.length}</td>
                  <td className="p-2">{fmt(e.endsAt)}</td>
                  <td className="p-2 text-xs">{e.source === "payment" ? t("learningAdmin.enrollments.payment", { ref: e.paymentRef ?? "" }) : e.source === "demo" ? t("learningAdmin.enrollments.demo") : t("learningAdmin.enrollments.grant", { reason: e.grantReason ?? "" })}</td>
                  <td className="p-2"><div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "extend" })}>{t("learningAdmin.enrollments.extend")}</Button>
                    {e.status === "active" && <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "suspend" })}>{t("learningAdmin.enrollments.suspend")}</Button>}
                    {e.status !== "revoked" && <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "revoke" })}>{t("learningAdmin.enrollments.revoke")}</Button>}
                    {e.status !== "active" && <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "reactivate" })}>{t("learningAdmin.enrollments.reactivate")}</Button>}
                    <Button size="sm" variant="ghost" onClick={() => invite.mutate({ userId: e.userId })}>{t("learningAdmin.enrollments.invite")}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setHistory(e.id)}>{t("learningAdmin.enrollments.history")}</Button>
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
    </>
  );
}

function Courses() {
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
  if (!q.data!.length) return <PanelEmpty title={t("learningAdmin.courses.emptyTitle")} description={t("learningAdmin.courses.emptyDesc")} />;
  return (
    <div className="space-y-5">
      {q.data!.map((c) => (
        <section key={c.id} className="rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{c.title} <Badge variant="secondary">{c.status === "draft" ? t("learningAdmin.courseStatus.draft") : c.status === "published" ? t("learningAdmin.courseStatus.published") : t("learningAdmin.courseStatus.archived")}</Badge></h2>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" asChild><a href={`/admin/formacion/vista-previa/curso/${c.id}`}>{t("learningAdmin.courses.preview")}</a></Button>
              {c.status !== "published" && <Button size="sm" disabled={c.coverage.files.pending > 0 && false} onClick={() => confirm(t("learningAdmin.courses.publishConfirm", { title: c.title, missing: c.coverage.files.pending ? t("learningAdmin.courses.missingFiles", { n: c.coverage.files.pending }) : "" })) && setStatus.mutate({ courseId: c.id, status: "published" })}>{t("learningAdmin.courses.publish")}</Button>}
              {c.status === "published" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ courseId: c.id, status: "draft" })}>{t("learningAdmin.courses.backToDraft")}</Button>}
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
  const [tab, setTab] = useState<Tab>("matriculas");
  // Uso diario a la izquierda; las herramientas técnicas (pruebas y auditoría) quedan aparte, a la derecha
  const tabs: Array<[Tab, string, LucideIcon]> = [["matriculas", t("learningAdmin.tabs.enrollments"), Users], ["progreso", t("learningAdmin.tabs.progress"), BarChart3], ["editor", t("learningAdmin.tabs.editor"), PenSquare], ["cursos", t("learningAdmin.tabs.courses"), FolderOpen], ["crear", t("learningAdmin.tabs.create"), BookPlus], ["materiales", t("learningAdmin.tabs.materials"), Film], ["reglas", t("learningAdmin.tabs.rules"), ShieldCheck], ["demo", t("learningAdmin.tabs.demo"), PlayCircle]];
  const tech: [Tab, string, LucideIcon] = ["tecnica", t("learningAdmin.tabs.tech"), Wrench];
  const tabButton = ([k, label, Icon]: [Tab, string, LucideIcon]) => (
    <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm ${tab === k ? "border-b-2 border-primary font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}><Icon className="h-4 w-4" aria-hidden />{label}</button>
  );
  return (
    <AdminLayout>
      <div className="space-y-5">
        <div><h1 className="flex items-center gap-2 text-2xl font-bold"><GraduationCap className="h-6 w-6 text-primary" aria-hidden />{t("learningAdmin.title")}</h1><p className="text-sm text-muted-foreground">{t("learningAdmin.subtitle")}</p></div>
        <div role="tablist" className="flex flex-wrap gap-1 border-b">
          {tabs.map(tabButton)}
          <span className="ml-auto">{tabButton(tech)}</span>
        </div>
        {tab === "matriculas" && <Enrollments />}
        {tab === "cursos" && <Courses />}
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
