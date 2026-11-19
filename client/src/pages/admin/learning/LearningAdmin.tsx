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
import { effectiveStatus } from "@shared/learning";

const fmt = (ms: number | null) => (ms ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(ms)) : "Sin caducidad");
const STATUS_LABEL: Record<string, string> = { active: "Activa", scheduled: "Programada", expired: "Caducada", suspended: "Suspendida", revoked: "Revocada" };
type Tab = "matriculas" | "cursos" | "reglas" | "demo" | "tecnica";

function ReasonDialog({ title, withDate, onClose, onSubmit }: { title: string; withDate?: boolean; onClose: () => void; onSubmit: (v: { reason: string; date: string }) => void }) {
  const [reason, setReason] = useState("");
  const [date, setDate] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {withDate && <label className="block text-sm">Nueva fecha de fin (vacío = sin caducidad)<Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
          <label className="block text-sm">Motivo (obligatorio, queda en el historial)<Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mínimo 8 caracteres" /></label>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={reason.trim().length < 8} onClick={() => onSubmit({ reason, date })}>Confirmar</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Enrollments() {
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.enrollments.useQuery();
  const [dialog, setDialog] = useState<null | { id: number; kind: "extend" | "revoke" | "suspend" | "reactivate" }>(null);
  const [history, setHistory] = useState<number | null>(null);
  const ev = trpc.learning.admin.events.useQuery({ enrollmentId: history ?? 1 }, { enabled: history != null });
  const done = { onSuccess: () => { utils.learning.admin.enrollments.invalidate(); setDialog(null); toast.success("Hecho"); }, onError: (e: unknown) => toastError(e) };
  const extend = trpc.learning.admin.extend.useMutation(done);
  const revoke = trpc.learning.admin.revoke.useMutation(done);
  const suspend = trpc.learning.admin.suspend.useMutation(done);
  const reactivate = trpc.learning.admin.reactivate.useMutation(done);
  const invite = trpc.learning.admin.sendInvite.useMutation({ onSuccess: (r) => toast[r.sent ? "success" : "info"](r.sent ? "Invitación enviada" : "La persona ya activó su cuenta"), onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.length) return <PanelEmpty title="Sin matrículas" description="Aparecen cuando una inscripción confirmada con cobro verificado coincide con una regla, o por concesión administrativa." />;
  const now = Date.now();
  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left"><tr><th className="p-2">Persona</th><th className="p-2">Estado</th><th className="p-2">Módulos</th><th className="p-2">Fin</th><th className="p-2">Origen</th><th className="p-2" /></tr></thead>
          <tbody>
            {q.data!.map((e) => {
              const st = effectiveStatus(e, now);
              return (
                <tr key={e.id} className="border-t align-top">
                  <td className="p-2"><div className="font-medium">{e.userName ?? "—"}</div><div className="text-xs text-muted-foreground">{e.userEmail}</div></td>
                  <td className="p-2"><Badge variant={st === "active" ? "default" : "secondary"}>{STATUS_LABEL[st] ?? st}</Badge></td>
                  <td className="p-2">{e.moduleIds.length}</td>
                  <td className="p-2">{fmt(e.endsAt)}</td>
                  <td className="p-2 text-xs">{e.source === "payment" ? `Pago ${e.paymentRef ?? ""}` : e.source === "demo" ? "Demostración" : `Concesión: ${e.grantReason ?? ""}`}</td>
                  <td className="p-2"><div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "extend" })}>Prorrogar</Button>
                    {e.status === "active" && <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "suspend" })}>Suspender</Button>}
                    {e.status !== "revoked" && <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "revoke" })}>Revocar</Button>}
                    {e.status !== "active" && <Button size="sm" variant="outline" onClick={() => setDialog({ id: e.id, kind: "reactivate" })}>Reactivar</Button>}
                    <Button size="sm" variant="ghost" onClick={() => invite.mutate({ userId: e.userId })}>Invitar</Button>
                    <Button size="sm" variant="ghost" onClick={() => setHistory(e.id)}>Historial</Button>
                  </div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dialog && (
        <ReasonDialog
          title={{ extend: "Prorrogar la matrícula", revoke: "Revocar la matrícula", suspend: "Suspender la matrícula", reactivate: "Reactivar la matrícula" }[dialog.kind]}
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
          <DialogHeader><DialogTitle>Historial de la matrícula</DialogTitle></DialogHeader>
          <ul className="max-h-80 space-y-2 overflow-auto text-sm">
            {(ev.data ?? []).map((x) => (<li key={x.id} className="rounded border p-2"><div className="font-medium">{x.type}</div><div className="text-xs text-muted-foreground">{fmt(x.createdAt)}{x.actorUserId ? ` · usuario ${x.actorUserId}` : ""}</div><pre className="whitespace-pre-wrap text-xs">{JSON.stringify(x.detail)}</pre></li>))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Courses() {
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
      if (!r.ok) throw new Error(j.error ?? "No se pudo subir el fichero");
      toast.success(j.duplicateOf?.length ? `Subido. Atención: mismo contenido que ${j.duplicateOf.length} recurso(s)` : "Fichero subido y verificado");
      utils.learning.admin.courses.invalidate();
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(null);
    }
  }
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data!.length) return <PanelEmpty title="Sin cursos" description="Importa un inventario de Articulate para crear el curso en borrador." />;
  return (
    <div className="space-y-5">
      {q.data!.map((c) => (
        <section key={c.id} className="rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">{c.title} <Badge variant="secondary">{c.status === "draft" ? "Borrador (privado)" : c.status === "published" ? "Publicado" : "Archivado"}</Badge></h2>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" asChild><a href={`/admin/formacion/vista-previa/curso/${c.id}`}>Vista previa como alumno</a></Button>
              {c.status !== "published" && <Button size="sm" disabled={c.coverage.files.pending > 0 && false} onClick={() => confirm(`Publicar «${c.title}»: los alumnos con matrícula podrán entrar. ${c.coverage.files.pending ? `Faltan ${c.coverage.files.pending} ficheros.` : ""} ¿Continuar?`) && setStatus.mutate({ courseId: c.id, status: "published" })}>Publicar</Button>}
              {c.status === "published" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ courseId: c.id, status: "draft" })}>Volver a borrador</Button>}
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{c.modules.length} módulos · ficheros verificados: {c.coverage.files.verified} · pendientes: {c.coverage.files.pending}</p>
          {c.sourceNote && <p className="mt-1 text-xs text-muted-foreground">{c.sourceNote}</p>}
          {c.pending.length > 0 && (
            <details className="mt-3"><summary className="cursor-pointer text-sm font-medium">Materiales pendientes ({c.pending.length})</summary>
              <ul className="mt-2 divide-y text-sm">
                {c.pending.map((p) => (
                  <li key={p.resourceId} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span>M{p.module} · L{p.lesson} · {p.lessonTitle} — <span className="text-muted-foreground">{p.kind}{p.originalName ? ` · ${p.originalName}` : ""}</span></span>
                    <label className="cursor-pointer text-sm text-primary underline">
                      {busy === p.resourceId ? "Subiendo…" : "Subir fichero"}
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

function Rules() {
  const q = trpc.learning.admin.rules.useQuery();
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  return !q.data!.length ? <PanelEmpty title="Sin reglas" description="Una regla une una modalidad del catálogo con los módulos que abre y su duración. Sin regla no hay acceso." /> : (
    <table className="w-full text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">Producto</th><th className="p-2">Variante</th><th className="p-2">Módulos</th><th className="p-2">Días</th><th className="p-2">Inicio</th><th className="p-2">Activa</th></tr></thead>
      <tbody>{q.data!.map((r) => <tr key={r.id} className="border-t"><td className="p-2">{r.experienceId}</td><td className="p-2">{r.variantId ?? "cualquiera"}</td><td className="p-2">{r.moduleIds.length}</td><td className="p-2">{r.durationDays ?? "sin límite"}</td><td className="p-2">{r.startMode === "fixed_date" ? fmt(r.fixedStart) : "al conceder"}</td><td className="p-2">{r.active ? "Sí" : "No"}</td></tr>)}</tbody></table>
  );
}

function Demo() {
  const courses = trpc.learning.admin.courses.useQuery();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState(0);
  const [trigger, setTrigger] = useState("");
  const [moduleIds, setModuleIds] = useState<number[]>([]);
  const demo = trpc.learning.admin.grantDemoByEmail.useMutation({ onSuccess: (r) => toast.success(r.created ? "Demostración concedida (60 min). La invitación se envía aparte." : "Ya tenía esa demostración"), onError: (e) => toastError(e) });
  const course = courses.data?.find((c) => c.id === courseId);
  return (
    <div className="max-w-xl space-y-3">
      <p className="text-sm text-muted-foreground">Acceso individual de 60 minutos a los módulos elegidos, desde su concesión. Un mismo evento da una sola demostración por persona. No se envía ningún correo: la invitación es una acción aparte en «Matrículas».</p>
      <label className="block text-sm">Nombre<Input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block text-sm">Correo<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="block text-sm">Curso
        <select className="mt-1 w-full rounded-md border bg-background p-2" value={courseId} onChange={(e) => { setCourseId(Number(e.target.value)); setModuleIds([]); }}>
          <option value={0}>Elige…</option>{(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </label>
      {course && <fieldset className="text-sm"><legend>Módulos de la demostración</legend>{course.modules.map((m) => <label key={m.id} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={moduleIds.includes(m.id)} onChange={(e) => setModuleIds(e.target.checked ? [...moduleIds, m.id] : moduleIds.filter((x) => x !== m.id))} />{m.title}</label>)}</fieldset>}
      <label className="block text-sm">Evento que la activa (p. ej. taller-2026-11-25)<Input value={trigger} onChange={(e) => setTrigger(e.target.value)} /></label>
      <Button disabled={!email || name.length < 2 || !courseId || !moduleIds.length || trigger.length < 3 || demo.isPending} onClick={() => demo.mutate({ email, name, courseId, moduleIds, trigger })}>Conceder demostración de 60 minutos</Button>
    </div>
  );
}

function Tecnica() {
  const courses = trpc.learning.admin.courses.useQuery();
  const audit = trpc.learning.admin.previewAccess.useQuery();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState(0);
  const [note, setNote] = useState("");
  const [moduleIds, setModuleIds] = useState<number[]>([]);
  const grant = trpc.learning.admin.grantTechnical.useMutation({ onSuccess: (r) => toast.success(r.created ? "Matrícula técnica concedida (caduca en 24 h). No se ha enviado ningún correo." : "Ya existía esa matrícula técnica"), onError: (e) => toastError(e) });
  const course = courses.data?.find((c) => c.id === courseId);
  return (
    <div className="max-w-xl space-y-4">
      <p className="text-sm text-muted-foreground">Matrícula técnica de validación: es la única que abre un curso en borrador. Marcada «[PRUEBA TÉCNICA]», caduca en 24 horas, no envía correo ni invitación, no simula ningún pago y no toca las reglas comerciales. Revócala desde «Matrículas» al terminar. Usa una dirección de pruebas propia, nunca la de un cliente.</p>
      <label className="block text-sm">Nombre<Input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="block text-sm">Correo de pruebas<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="block text-sm">Curso
        <select className="mt-1 w-full rounded-md border bg-background p-2" value={courseId} onChange={(e) => { setCourseId(Number(e.target.value)); setModuleIds([]); }}>
          <option value={0}>Elige…</option>{(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </label>
      {course && <fieldset className="text-sm"><legend>Módulos</legend>{course.modules.map((m) => <label key={m.id} className="mr-3 inline-flex items-center gap-1"><input type="checkbox" checked={moduleIds.includes(m.id)} onChange={(e) => setModuleIds(e.target.checked ? [...moduleIds, m.id] : moduleIds.filter((x) => x !== m.id))} />{m.title}</label>)}</fieldset>}
      <label className="block text-sm">Nota (opcional)<Input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <Button disabled={!email || name.length < 2 || !courseId || !moduleIds.length || grant.isPending} onClick={() => grant.mutate({ email, name, courseId, moduleIds, note: note || null })}>Conceder matrícula técnica</Button>
      <div>
        <h3 className="mb-1 text-sm font-semibold">Accesos de vista previa (auditoría)</h3>
        {audit.isLoading ? <PanelLoading /> : audit.isError ? <PanelError error={audit.error} onRetry={() => audit.refetch()} /> : !audit.data!.length ? <p className="text-sm text-muted-foreground">Sin accesos todavía.</p> : (
          <ul className="max-h-60 space-y-1 overflow-auto text-xs text-muted-foreground">{audit.data!.map((e) => <li key={e.id}>{new Date(e.createdAt).toLocaleString("es-ES")} · {e.type.replace("admin_preview_", "")} · usuario {e.actorUserId ?? "—"} · {JSON.stringify(e.detail)}</li>)}</ul>
        )}
      </div>
    </div>
  );
}

export default function LearningAdmin() {
  const [tab, setTab] = useState<Tab>("matriculas");
  const tabs: Array<[Tab, string]> = [["matriculas", "Matrículas"], ["cursos", "Cursos y materiales"], ["reglas", "Reglas por modalidad"], ["demo", "Demostración"], ["tecnica", "Prueba técnica"]];
  return (
    <AdminLayout>
      <div className="space-y-5">
        <div><h1 className="text-2xl font-bold">Formación digital</h1><p className="text-sm text-muted-foreground">Cursos privados con matrícula nominativa. El acceso solo se concede con pago confirmado, concesión con motivo o demostración.</p></div>
        <div role="tablist" className="flex flex-wrap gap-1 border-b">
          {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 py-2 text-sm ${tab === k ? "border-b-2 border-primary font-semibold" : "text-muted-foreground"}`}>{label}</button>)}
        </div>
        {tab === "matriculas" && <Enrollments />}
        {tab === "cursos" && <Courses />}
        {tab === "reglas" && <Rules />}
        {tab === "demo" && <Demo />}
        {tab === "tecnica" && <Tecnica />}
      </div>
    </AdminLayout>
  );
}
