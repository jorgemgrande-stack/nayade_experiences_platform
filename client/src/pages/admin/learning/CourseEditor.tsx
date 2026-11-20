/**
 * Editor de formación (lote 1) — pestaña «Editor» de /admin/formacion.
 *
 * Edita títulos, textos y orden de un curso sobre un BORRADOR. Los alumnos siguen viendo lo publicado hasta que se pulsa
 * «Publicar cambios»; publicar conserva progreso, matrículas y accesos (los elementos mantienen su identidad) y guarda la versión
 * anterior para poder recuperarla. Los ficheros (vídeo, audio, PDF) no se tocan en este lote.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, BookOpen, Dumbbell, Eye, FileText, Headphones, History, Link2, PlayCircle, RotateCcw, Save, Send, ShieldCheck, Trash2, Type } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { diffTrees, normalizeTree, type EditorBlock, type EditorTree } from "@shared/learningEditor";

const fmt = (ms: number) => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(ms));
const KIND: Record<string, { label: string; Icon: typeof Type }> = {
  text: { label: "Texto", Icon: Type }, video: { label: "Vídeo", Icon: PlayCircle }, audio: { label: "Audio", Icon: Headphones },
  pdf: { label: "PDF", Icon: FileText }, exercise: { label: "Ejercicio", Icon: Dumbbell }, external_link: { label: "Enlace", Icon: Link2 },
};
const STATUS: Record<string, string> = { draft: "Curso en borrador (privado)", published: "Curso publicado", archived: "Curso archivado" };

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const c = list.slice();
  [c[i], c[j]] = [c[j], c[i]];
  return c;
}

export default function CourseEditor() {
  const utils = trpc.useUtils();
  const courses = trpc.learning.admin.courses.useQuery();
  const [courseId, setCourseId] = useState<number | null>(null);
  useEffect(() => { if (courseId == null && courses.data?.length) setCourseId(courses.data[0].id); }, [courses.data, courseId]);
  const q = trpc.learning.admin.editor.state.useQuery({ courseId: courseId ?? 1 }, { enabled: courseId != null, refetchOnWindowFocus: false });

  const [tree, setTree] = useState<EditorTree | null>(null);
  const [sel, setSel] = useState<{ m: number; l: number }>({ m: 0, l: 0 });
  const [preview, setPreview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [note, setNote] = useState("");
  const [showVersions, setShowVersions] = useState(false);

  const serverKey = q.data ? `${q.data.course.id}:${q.data.draftInfo?.updatedAt ?? "live"}:${q.data.versions[0]?.version ?? 0}` : "";
  useEffect(() => { if (q.data) setTree(structuredClone(q.data.draft ?? q.data.live)); }, [serverKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => utils.learning.admin.editor.state.invalidate();
  const save = trpc.learning.admin.editor.saveDraft.useMutation({ onSuccess: () => { toast.success("Borrador guardado. Los alumnos no ven nada nuevo hasta que publiques."); refresh(); }, onError: (e) => toastError(e) });
  const discard = trpc.learning.admin.editor.discardDraft.useMutation({ onSuccess: () => { toast.success("Borrador descartado"); refresh(); }, onError: (e) => toastError(e) });
  const publish = trpc.learning.admin.editor.publish.useMutation({
    onSuccess: (r) => { toast.success(r.published ? `Cambios publicados (versión ${r.version}). Progreso y accesos de los alumnos intactos.` : "No había cambios que publicar"); setPublishing(false); setNote(""); refresh(); utils.learning.admin.courses.invalidate(); },
    onError: (e) => { toastError(e); setPublishing(false); },
  });
  const restore = trpc.learning.admin.editor.restoreVersion.useMutation({ onSuccess: () => { toast.success("Versión cargada como borrador. Revísala y publícala cuando quieras."); setShowVersions(false); refresh(); }, onError: (e) => toastError(e) });

  const live = q.data?.live;
  const changesVsLive = useMemo(() => (live && tree ? diffTrees(live, normalizeTree(tree)) : []), [live, tree]);
  const serverDraft = q.data?.draft ?? null;
  const unsaved = useMemo(() => !!tree && JSON.stringify(normalizeTree(tree)) !== JSON.stringify(normalizeTree(serverDraft ?? live ?? tree)), [tree, serverDraft, live]);

  if (courses.isLoading) return <PanelLoading />;
  if (courses.isError) return <PanelError error={courses.error} onRetry={() => courses.refetch()} />;
  if (!courses.data?.length) return <PanelEmpty title="Sin cursos" description="Todavía no hay ningún curso que editar." />;
  if (q.isLoading || !tree || !q.data) return q.isError ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : <PanelLoading />;

  const s = q.data;
  const mod = tree.modules[sel.m] ?? tree.modules[0];
  const les = mod?.lessons[sel.l] ?? mod?.lessons[0];
  const setMod = (mi: number, f: (m: EditorTree["modules"][number]) => EditorTree["modules"][number]) => setTree({ ...tree, modules: tree.modules.map((m, i) => (i === mi ? f(m) : m)) });
  const setLes = (mi: number, li: number, f: (l: EditorTree["modules"][number]["lessons"][number]) => EditorTree["modules"][number]["lessons"][number]) => setMod(mi, (m) => ({ ...m, lessons: m.lessons.map((l, i) => (i === li ? f(l) : l)) }));
  const setBlock = (b: number, f: (x: EditorBlock) => EditorBlock) => setLes(sel.m, sel.l, (l) => ({ ...l, blocks: l.blocks.map((x, i) => (i === b ? f(x) : x)) }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {courses.data.length > 1 && (
          <select className="rounded-md border bg-background px-2 py-1.5 text-sm" value={courseId ?? ""} onChange={(e) => { setCourseId(Number(e.target.value)); setSel({ m: 0, l: 0 }); }} aria-label="Curso">
            {courses.data.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
        <Badge variant="secondary"><BookOpen className="mr-1 h-3 w-3" aria-hidden />{STATUS[s.course.status] ?? s.course.status}</Badge>
        {s.draft ? <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">Borrador sin publicar</Badge> : <Badge variant="outline">Sin cambios pendientes</Badge>}
        {unsaved && <Badge variant="destructive">Cambios sin guardar</Badge>}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setPreview((p) => !p)}><Eye className="mr-1 h-4 w-4" aria-hidden />{preview ? "Volver a editar" : "Vista previa del borrador"}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowVersions(true)}><History className="mr-1 h-4 w-4" aria-hidden />Versiones ({s.versions.length})</Button>
          <Button size="sm" variant="outline" disabled={!s.draft || discard.isPending} onClick={() => confirm("¿Descartar el borrador? Lo publicado no cambia.") && discard.mutate({ courseId: s.course.id })}><Trash2 className="mr-1 h-4 w-4" aria-hidden />Descartar</Button>
          <Button size="sm" variant="secondary" disabled={!unsaved || save.isPending} onClick={() => save.mutate({ courseId: s.course.id, tree, expectedUpdatedAt: s.draftInfo?.updatedAt ?? null })}><Save className="mr-1 h-4 w-4" aria-hidden />Guardar borrador</Button>
          <Button size="sm" disabled={!s.draft || unsaved || !s.changes.length || publish.isPending} title={unsaved ? "Guarda el borrador antes de publicar" : undefined} onClick={() => setPublishing(true)}><Send className="mr-1 h-4 w-4" aria-hidden />Publicar cambios</Button>
        </div>
      </div>

      {s.usage.activeEnrollments > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>Hay {s.usage.activeEnrollments} matrícula(s) activa(s) y {s.usage.learnersWithProgress} persona(s) con progreso. Editar no les afecta hasta que publiques, y al publicar se conservan su progreso, su acceso y su última posición.</p>
        </div>
      )}
      {s.draftInfo?.stale && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>Lo publicado ha cambiado desde que empezaste este borrador (por ejemplo, por una importación). No se puede publicar para no pisar esos cambios: descarta el borrador y vuelve a empezar.</p>
        </div>
      )}

      <section className="rounded-xl border p-4">
        <h2 className="mb-2 text-sm font-semibold">Curso</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">Título<Input value={tree.course.title} onChange={(e) => setTree({ ...tree, course: { ...tree.course, title: e.target.value } })} maxLength={300} /></label>
          <label className="text-sm">Descripción<Textarea rows={2} value={tree.course.description ?? ""} onChange={(e) => setTree({ ...tree, course: { ...tree.course, description: e.target.value } })} maxLength={5000} /></label>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <nav aria-label="Estructura del curso" className="space-y-3 rounded-xl border p-3">
          {tree.modules.map((m, mi) => (
            <div key={m.id}>
              <div className="flex items-center gap-1">
                <Input aria-label={`Título del módulo ${mi + 1}`} className="h-8 text-sm font-semibold" value={m.title} onChange={(e) => setMod(mi, (x) => ({ ...x, title: e.target.value }))} maxLength={300} />
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Subir módulo" disabled={mi === 0} onClick={() => { setTree({ ...tree, modules: move(tree.modules, mi, -1) }); setSel({ m: Math.max(mi - 1, 0), l: 0 }); }}><ArrowUp className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Bajar módulo" disabled={mi === tree.modules.length - 1} onClick={() => { setTree({ ...tree, modules: move(tree.modules, mi, 1) }); setSel({ m: mi + 1, l: 0 }); }}><ArrowDown className="h-4 w-4" /></Button>
              </div>
              <ul className="mt-1 space-y-0.5">
                {m.lessons.map((l, li) => {
                  const on = sel.m === mi && sel.l === li;
                  return (
                    <li key={l.id} className={`flex items-center gap-1 rounded-md pl-2 ${on ? "bg-primary/10" : ""}`}>
                      <button type="button" className="flex-1 truncate py-1 text-left text-sm" onClick={() => setSel({ m: mi, l: li })}>{li + 1}. {l.title || "(sin título)"}</button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Subir lección" disabled={li === 0} onClick={() => { setMod(mi, (x) => ({ ...x, lessons: move(x.lessons, li, -1) })); setSel({ m: mi, l: li - 1 }); }}><ArrowUp className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Bajar lección" disabled={li === m.lessons.length - 1} onClick={() => { setMod(mi, (x) => ({ ...x, lessons: move(x.lessons, li, 1) })); setSel({ m: mi, l: li + 1 }); }}><ArrowDown className="h-3.5 w-3.5" /></Button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <section className="rounded-xl border p-4">
          {!les ? <PanelEmpty title="Sin lecciones" description="Este módulo no tiene lecciones." /> : preview ? (
            <article className="space-y-3">
              <p className="text-xs text-muted-foreground">Vista previa del borrador · así quedará la lección para el alumno (los vídeos, audios y PDF no cambian).</p>
              <h2 className="text-xl font-semibold">{les.title}</h2>
              {les.blocks.map((b) => {
                const K = KIND[s.blockMeta[b.id]?.kind ?? "text"] ?? KIND.text;
                return (
                  <div key={b.id} className="rounded-lg border p-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold"><K.Icon className="h-4 w-4" aria-hidden />{b.title}</h3>
                    {b.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{b.body}</p>}
                    {b.attribution && <p className="mt-1 text-xs text-muted-foreground">{b.attribution}</p>}
                  </div>
                );
              })}
            </article>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm font-medium">Título de la lección<Input value={les.title} onChange={(e) => setLes(sel.m, sel.l, (l) => ({ ...l, title: e.target.value }))} maxLength={300} /></label>
              <p className="text-xs text-muted-foreground">Módulo: {mod.title}. {les.blocks.length} bloque(s). Los ficheros se sustituirán en un próximo lote; aquí se editan títulos, textos y orden.</p>
              {les.blocks.map((b, bi) => {
                const meta = s.blockMeta[b.id];
                const K = KIND[meta?.kind ?? "text"] ?? KIND.text;
                const hasText = ["text", "exercise", "external_link"].includes(meta?.kind ?? "text") || !!b.body;
                return (
                  <div key={b.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary"><K.Icon className="mr-1 h-3 w-3" aria-hidden />{K.label}</Badge>
                      {meta?.resourceKind && <span className="text-xs text-muted-foreground">{meta.resourceStatus === "verified" ? "fichero verificado" : "fichero pendiente"}</span>}
                      <div className="ml-auto flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Subir bloque" disabled={bi === 0} onClick={() => setLes(sel.m, sel.l, (l) => ({ ...l, blocks: move(l.blocks, bi, -1) }))}><ArrowUp className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Bajar bloque" disabled={bi === les.blocks.length - 1} onClick={() => setLes(sel.m, sel.l, (l) => ({ ...l, blocks: move(l.blocks, bi, 1) }))}><ArrowDown className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <Input aria-label="Título del bloque" value={b.title} onChange={(e) => setBlock(bi, (x) => ({ ...x, title: e.target.value }))} maxLength={300} />
                    {hasText && <Textarea aria-label="Texto del bloque" rows={Math.min(Math.max((b.body ?? "").split("\n").length + 1, 3), 14)} value={b.body ?? ""} onChange={(e) => setBlock(bi, (x) => ({ ...x, body: e.target.value }))} placeholder={meta?.kind === "external_link" ? "Texto del enlace" : "Texto que verá el alumno"} />}
                    <Input aria-label="Atribución" className="text-xs" value={b.attribution ?? ""} onChange={(e) => setBlock(bi, (x) => ({ ...x, attribution: e.target.value }))} placeholder="Atribución (opcional)" maxLength={300} />
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {publishing && (
        <Dialog open onOpenChange={(o) => !o && setPublishing(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Publicar cambios</DialogTitle></DialogHeader>
            <div className="space-y-3 text-sm">
              <p>Los alumnos verán estos {s.changes.length} cambio(s) al instante. Se guarda una versión con lo publicado ahora para poder recuperarlo. No se borra ningún fichero ni se toca el progreso, las matrículas ni las ventas.</p>
              <ul className="max-h-48 space-y-1 overflow-auto rounded-md border p-2 text-xs">
                {s.changes.map((c, i) => <li key={i}><span className="font-medium">{c.level === "course" ? "Curso" : c.level === "module" ? "Módulo" : c.level === "lesson" ? "Lección" : "Bloque"}</span> «{c.label}»: {[...c.fields, ...(c.moved ? ["nuevo orden"] : [])].join(", ")}</li>)}
              </ul>
              <label className="block">Nota de la versión (opcional)<Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ej.: corrección de textos del módulo 1" /></label>
              <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setPublishing(false)}>Cancelar</Button><Button disabled={publish.isPending} onClick={() => publish.mutate({ courseId: s.course.id, note: note || null })}>Publicar ahora</Button></div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {showVersions && (
        <Dialog open onOpenChange={(o) => !o && setShowVersions(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle>Versiones anteriores</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Cada publicación guarda lo que había antes. Recuperar una versión la carga como borrador: no cambia nada hasta que la publiques.</p>
            {!s.versions.length ? <p className="text-sm">Todavía no hay versiones.</p> : (
              <ul className="max-h-72 divide-y overflow-auto text-sm">
                {s.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                    <span>Versión {v.version} · {fmt(v.createdAt)}<br /><span className="text-xs text-muted-foreground">{v.summary}{v.note ? ` · ${v.note}` : ""}</span></span>
                    <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => {
                      const replace = !!s.draft && s.changes.length > 0;
                      if (replace && !confirm("Ya tienes un borrador con cambios sin publicar. ¿Sustituirlo por esta versión?")) return;
                      restore.mutate({ courseId: s.course.id, versionId: v.id, replace });
                    }}><RotateCcw className="mr-1 h-4 w-4" aria-hidden />Recuperar</Button>
                  </li>
                ))}
              </ul>
            )}
          </DialogContent>
        </Dialog>
      )}
      <p className="text-xs text-muted-foreground">{changesVsLive.length ? `${changesVsLive.length} cambio(s) respecto a lo publicado.` : "Sin diferencias con lo publicado."}</p>
    </div>
  );
}
