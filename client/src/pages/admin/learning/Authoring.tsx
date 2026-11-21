/**
 * Elephant Learning · Crear formaciones (lote 3): cursos nuevos, estructura, duplicado y archivado.
 * Un curso nuevo nace en borrador (privado). Los cambios de un curso ya publicado se hacen en «Editor» (borrador y publicar).
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { BLOCK_KINDS, BLOCK_KIND_ES, RESOURCE_KINDS, type BlockKind } from "@shared/learningAuthoring";
import { Archive, ArchiveRestore, BookPlus, Copy, FileText, Film, Layers, Link2, ListPlus, Music, Plus, Type, type LucideIcon } from "lucide-react";

const KIND_ICON: Record<string, LucideIcon> = { text: Type, video: Film, audio: Music, pdf: FileText, external_link: Link2 };
const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Borrador (privado)", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  published: { label: "Publicado", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  archived: { label: "Archivado", cls: "bg-muted text-muted-foreground" },
};

function NewCourseDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("es");
  const create = trpc.learning.admin.authoring.createCourse.useMutation({ onSuccess: (r) => { toast.success("Curso creado en borrador. Nadie lo ve hasta que lo publiques."); onCreated(r.courseId); }, onError: (e) => toastError(e) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nuevo curso</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">Título<Input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder="Por ejemplo, Meditación y sanación" /></label>
          <label className="block text-sm">Descripción (opcional)<Textarea value={description} maxLength={5000} rows={3} onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="block text-sm">Idioma del contenido
            <select className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="es">Español</option><option value="de">Alemán</option><option value="en">Inglés</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">El idioma indica en qué idioma está el contenido; no se traduce nada automáticamente.</p>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate({ title, description: description || null, language })}>Crear en borrador</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type AddState = null | { kind: "module" } | { kind: "lesson"; moduleId: number } | { kind: "block"; lessonId: number };

function AddDialog({ state, courseId, onClose, onDone }: { state: NonNullable<AddState>; courseId: number; onClose: () => void; onDone: () => void }) {
  const lib = trpc.learning.admin.materials.list.useQuery(undefined, { enabled: state.kind === "block" });
  const [title, setTitle] = useState("");
  const [bk, setBk] = useState<BlockKind>("text");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [resourceId, setResourceId] = useState<number | "">("");
  const done = { onSuccess: () => { toast.success("Añadido"); onDone(); }, onError: (e: unknown) => toastError(e) };
  const addModule = trpc.learning.admin.authoring.addModule.useMutation(done);
  const addLesson = trpc.learning.admin.authoring.addLesson.useMutation(done);
  const addBlock = trpc.learning.admin.authoring.addBlock.useMutation(done);
  const reusable = useMemo(() => (lib.data ?? []).filter((r) => r.kind === bk && r.objectId), [lib.data, bk]);
  const busy = addModule.isPending || addLesson.isPending || addBlock.isPending;
  const heading = state.kind === "module" ? "Añadir módulo" : state.kind === "lesson" ? "Añadir lección" : "Añadir contenido";
  function submit() {
    if (state.kind === "module") addModule.mutate({ courseId, title });
    else if (state.kind === "lesson") addLesson.mutate({ moduleId: state.moduleId, title });
    else addBlock.mutate({ lessonId: state.lessonId, kind: bk, title, body: bk === "text" ? body : null, externalUrl: bk === "external_link" ? url : null, resourceId: RESOURCE_KINDS.includes(bk as never) && resourceId ? Number(resourceId) : null });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{heading}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          {state.kind === "block" && (
            <div role="group" aria-label="Tipo de contenido" className="flex flex-wrap gap-1.5">
              {BLOCK_KINDS.map((k) => { const I = KIND_ICON[k]; return <Button key={k} size="sm" variant={bk === k ? "default" : "outline"} aria-pressed={bk === k} onClick={() => { setBk(k); setResourceId(""); }}><I className="mr-1.5 h-4 w-4" aria-hidden />{BLOCK_KIND_ES[k]}</Button>; })}
            </div>
          )}
          <label className="block text-sm">Título<Input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} /></label>
          {state.kind === "block" && bk === "text" && <label className="block text-sm">Texto<Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></label>}
          {state.kind === "block" && bk === "external_link" && <label className="block text-sm">Enlace (https://…)<Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>}
          {state.kind === "block" && RESOURCE_KINDS.includes(bk as never) && (
            <div className="space-y-1 text-sm">
              <label className="block">Material
                <select className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5" value={resourceId} onChange={(e) => setResourceId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Nuevo material: subiré el fichero después</option>
                  {reusable.map((r) => <option key={r.resourceId} value={r.resourceId}>Reutilizar: {r.originalName ?? `material ${r.resourceId}`}</option>)}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">Reutilizar un material no duplica el fichero ni ocupa espacio nuevo. Un material nuevo se sube desde la pestaña Materiales.</p>
            </div>
          )}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancelar</Button><Button disabled={!title.trim() || busy} onClick={submit}>Añadir</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Builder({ courseId }: { courseId: number }) {
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.authoring.outline.useQuery({ courseId });
  const [add, setAdd] = useState<AddState>(null);
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data!;
  const editable = o.course.status === "draft";
  const refresh = () => { setAdd(null); utils.learning.admin.authoring.outline.invalidate(); utils.learning.admin.courses.invalidate(); utils.learning.admin.materials.list.invalidate(); };
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Estructura del curso">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Layers className="h-4 w-4 text-primary" aria-hidden />Estructura de «{o.course.title}»</h3>
        {editable && <Button size="sm" onClick={() => setAdd({ kind: "module" })}><Plus className="mr-1.5 h-4 w-4" aria-hidden />Añadir módulo</Button>}
      </div>
      {!editable && <p className="mt-2 rounded-md bg-muted p-2 text-sm text-muted-foreground">{o.course.status === "archived" ? "Curso archivado: restáuralo para editarlo." : "Curso publicado: para cambiar textos y orden usa «Editor». Para añadir módulos o lecciones, vuélvelo a borrador."}</p>}
      {!o.modules.length ? (
        <PanelEmpty title="Curso sin módulos" description="Empieza añadiendo el primer módulo; dentro irán las lecciones y su contenido." />
      ) : (
        <ol className="mt-3 space-y-3">
          {o.modules.map((m, mi) => (
            <li key={m.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">Módulo {mi + 1} · {m.title}</p>
                {editable && <Button size="sm" variant="outline" onClick={() => setAdd({ kind: "lesson", moduleId: m.id })}><ListPlus className="mr-1.5 h-4 w-4" aria-hidden />Añadir lección</Button>}
              </div>
              <ol className="mt-2 space-y-2">
                {m.lessons.map((l, li) => (
                  <li key={l.id} className="rounded-md bg-muted/40 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{mi + 1}.{li + 1} {l.title}</p>
                      {editable && <Button size="sm" variant="ghost" onClick={() => setAdd({ kind: "block", lessonId: l.id })}><Plus className="mr-1 h-4 w-4" aria-hidden />Contenido</Button>}
                    </div>
                    {l.blocks.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                        {l.blocks.map((b) => { const I = KIND_ICON[b.kind] ?? FileText; return <li key={b.id} className="flex items-center gap-1.5"><I className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{b.title}</span></li>; })}
                      </ul>
                    )}
                  </li>
                ))}
                {!m.lessons.length && <li className="text-sm text-muted-foreground">Sin lecciones todavía.</li>}
              </ol>
            </li>
          ))}
        </ol>
      )}
      {add && <AddDialog state={add} courseId={courseId} onClose={() => setAdd(null)} onDone={refresh} />}
    </section>
  );
}

export default function Authoring() {
  const utils = trpc.useUtils();
  const courses = trpc.learning.admin.courses.useQuery();
  const [sel, setSel] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const refresh = () => { utils.learning.admin.courses.invalidate(); utils.learning.admin.authoring.outline.invalidate(); };
  const duplicate = trpc.learning.admin.authoring.duplicateCourse.useMutation({ onSuccess: (r) => { toast.success(`Copia creada en borrador (${r.shared} materiales compartidos, sin duplicar ficheros).`); refresh(); setSel(r.courseId); }, onError: (e) => toastError(e) });
  const archive = trpc.learning.admin.authoring.archiveCourse.useMutation({ onSuccess: (r) => { toast.success(r.status === "archived" ? "Curso archivado. Se conservan matrículas, progreso y ficheros." : "Curso restaurado como borrador."); refresh(); }, onError: (e) => toastError(e) });
  const setStatus = trpc.learning.admin.setCourseStatus.useMutation({ onSuccess: () => refresh(), onError: (e) => toastError(e) });
  if (courses.isLoading) return <PanelLoading />;
  if (courses.isError) return <PanelError error={courses.error} onRetry={() => courses.refetch()} />;
  const list = courses.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Crea cursos, módulos, lecciones y contenidos. Un curso nuevo es privado hasta que lo publiques.</p>
        <Button onClick={() => setCreating(true)}><BookPlus className="mr-1.5 h-4 w-4" aria-hidden />Nuevo curso</Button>
      </div>
      {!list.length ? (
        <PanelEmpty title="Sin cursos" description="Crea tu primer curso: empieza en borrador y nadie lo verá hasta que lo publiques." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((c) => {
            const st = STATUS[c.status] ?? STATUS.draft;
            return (
              <li key={c.id} className={`rounded-xl border bg-card p-4 ${sel === c.id ? "ring-2 ring-primary" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <button className="min-w-0 text-left" onClick={() => setSel(c.id)} aria-label={`Ver estructura de ${c.title}`}>
                    <h3 className="truncate font-semibold">{c.title}</h3>
                    <p className="text-sm text-muted-foreground">{c.modules.length} módulos · ficheros {c.coverage.files.verified} verificados{c.coverage.files.pending ? `, ${c.coverage.files.pending} pendientes` : ""}</p>
                  </button>
                  <Badge className={st.cls}>{st.label}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setSel(c.id)}>Estructura</Button>
                  <Button size="sm" variant="outline" disabled={duplicate.isPending} onClick={() => duplicate.mutate({ courseId: c.id })}><Copy className="mr-1.5 h-4 w-4" aria-hidden />Duplicar</Button>
                  {c.status === "draft" && <Button size="sm" variant="outline" onClick={() => confirm(`Publicar «${c.title}»: los alumnos con matrícula podrán entrar. ¿Continuar?`) && setStatus.mutate({ courseId: c.id, status: "published" })}>Publicar</Button>}
                  {c.status === "published" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ courseId: c.id, status: "draft" })}>Volver a borrador</Button>}
                  {c.status !== "archived" ? (
                    <Button size="sm" variant="ghost" onClick={() => confirm(`Archivar «${c.title}»: deja de abrirse, pero se conservan matrículas, progreso y ficheros. ¿Continuar?`) && archive.mutate({ courseId: c.id, archive: true })}><Archive className="mr-1.5 h-4 w-4" aria-hidden />Archivar</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => archive.mutate({ courseId: c.id, archive: false })}><ArchiveRestore className="mr-1.5 h-4 w-4" aria-hidden />Restaurar</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {sel != null && <Builder courseId={sel} />}
      {creating && <NewCourseDialog onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); refresh(); setSel(id); }} />}
    </div>
  );
}
