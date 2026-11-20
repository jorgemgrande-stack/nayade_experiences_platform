/**
 * Editor de formación (lote 1) — pestaña «Editor de cursos» de /admin/formacion.
 *
 * Curso → Módulos → Lecciones → Bloques, en un árbol navegable a la izquierda y una zona de edición a la derecha. Todo se edita sobre un
 * BORRADOR: los alumnos siguen viendo lo publicado hasta que se pulsa «Publicar cambios». Publicar conserva progreso, matrículas y
 * accesos (los elementos mantienen su identidad) y guarda la versión anterior para poder recuperarla. Los ficheros (vídeo, audio, PDF)
 * no se tocan en este lote.
 */
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowDown, ArrowUp, BookOpen, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Dumbbell, ExternalLink, Eye, File, GraduationCap, Headphones, History, Layers,
  Link2, Pencil, PlayCircle, RotateCcw, Rocket, Save, ShieldCheck, Trash2, Type, Users,
} from "lucide-react";
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
const KIND: Record<string, { label: string; Icon: typeof Type; tone: string }> = {
  text: { label: "Texto", Icon: Type, tone: "bg-slate-100 text-slate-700" },
  video: { label: "Vídeo", Icon: PlayCircle, tone: "bg-sky-100 text-sky-700" },
  audio: { label: "Audio", Icon: Headphones, tone: "bg-violet-100 text-violet-700" },
  pdf: { label: "Documento PDF", Icon: File, tone: "bg-rose-100 text-rose-700" },
  exercise: { label: "Ejercicio", Icon: Dumbbell, tone: "bg-amber-100 text-amber-800" },
  external_link: { label: "Enlace externo", Icon: Link2, tone: "bg-emerald-100 text-emerald-700" },
};
const kindOf = (k: string | undefined) => KIND[k ?? "text"] ?? KIND.text;
const STATUS: Record<string, string> = { draft: "Curso privado (borrador)", published: "Curso publicado", archived: "Curso archivado" };

type Sel = { k: "course" } | { k: "module"; m: number } | { k: "lesson"; m: number; l: number };
type Mod = EditorTree["modules"][number];
type Les = Mod["lessons"][number];

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const c = list.slice();
  [c[i], c[j]] = [c[j], c[i]];
  return c;
}

function Stat({ Icon, value, label }: { Icon: typeof Type; value: number | string; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
      <Icon className="h-4 w-4 text-primary" aria-hidden />
      <div className="leading-tight"><div className="text-base font-semibold">{value}</div><div className="text-[11px] text-muted-foreground">{label}</div></div>
    </div>
  );
}

export default function CourseEditor() {
  const utils = trpc.useUtils();
  const courses = trpc.learning.admin.courses.useQuery();
  const [courseId, setCourseId] = useState<number | null>(null);
  useEffect(() => { if (courseId == null && courses.data?.length) setCourseId(courses.data[0].id); }, [courses.data, courseId]);
  const q = trpc.learning.admin.editor.state.useQuery({ courseId: courseId ?? 1 }, { enabled: courseId != null, refetchOnWindowFocus: false });

  const [tree, setTree] = useState<EditorTree | null>(null);
  const [sel, setSel] = useState<Sel>({ k: "lesson", m: 0, l: 0 });
  const [open, setOpen] = useState<Set<number>>(new Set([0]));
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
  const serverDraft = q.data?.draft ?? null;
  const unsaved = useMemo(() => !!tree && JSON.stringify(normalizeTree(tree)) !== JSON.stringify(normalizeTree(serverDraft ?? live ?? tree)), [tree, serverDraft, live]);
  // Elementos que difieren de lo publicado (punto ámbar en el árbol)
  const dirty = useMemo(() => {
    const out = { course: false, modules: new Set<number>(), lessons: new Set<number>() };
    if (!live || !tree) return out;
    const blockLesson = new Map<number, number>();
    tree.modules.forEach((m) => m.lessons.forEach((l) => l.blocks.forEach((b) => blockLesson.set(b.id, l.id))));
    for (const c of diffTrees(live, normalizeTree(tree))) {
      if (c.level === "course") out.course = true;
      else if (c.level === "module" && c.id != null) out.modules.add(c.id);
      else if (c.level === "lesson" && c.id != null) out.lessons.add(c.id);
      else if (c.level === "block" && c.id != null && blockLesson.has(c.id)) out.lessons.add(blockLesson.get(c.id)!);
    }
    return out;
  }, [live, tree]);

  if (courses.isLoading) return <PanelLoading />;
  if (courses.isError) return <PanelError error={courses.error} onRetry={() => courses.refetch()} />;
  if (!courses.data?.length) return <PanelEmpty title="Sin cursos" description="Todavía no hay ningún curso que editar." />;
  if (q.isLoading || !tree || !q.data) return q.isError ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : <PanelLoading />;

  const s = q.data;
  const totals = (() => {
    let lessons = 0, blocks = 0, files = 0;
    tree.modules.forEach((m) => m.lessons.forEach((l) => { lessons += 1; blocks += l.blocks.length; l.blocks.forEach((b) => { if (s.blockMeta[b.id]?.resourceKind) files += 1; }); }));
    return { modules: tree.modules.length, lessons, blocks, files };
  })();
  const mod: Mod | undefined = sel.k === "course" ? undefined : tree.modules[sel.m];
  const les: Les | undefined = sel.k === "lesson" ? mod?.lessons[sel.l] : undefined;
  const setMod = (mi: number, f: (m: Mod) => Mod) => setTree({ ...tree, modules: tree.modules.map((m, i) => (i === mi ? f(m) : m)) });
  const setLes = (mi: number, li: number, f: (l: Les) => Les) => setMod(mi, (m) => ({ ...m, lessons: m.lessons.map((l, i) => (i === li ? f(l) : l)) }));
  const setBlock = (b: number, f: (x: EditorBlock) => EditorBlock) => sel.k === "lesson" && setLes(sel.m, sel.l, (l) => ({ ...l, blocks: l.blocks.map((x, i) => (i === b ? f(x) : x)) }));
  const pick = (next: Sel) => { setSel(next); if (next.k !== "course") setOpen((o) => new Set(o).add(next.m)); };

  const state = unsaved ? { label: "Cambios sin guardar", cls: "bg-red-100 text-red-800", Icon: CircleDot } : s.draft ? { label: `Borrador guardado · ${s.changes.length} cambio(s) sin publicar`, cls: "bg-amber-100 text-amber-900", Icon: Pencil } : { label: "Todo publicado", cls: "bg-emerald-100 text-emerald-800", Icon: CheckCircle2 };

  return (
    <div className="space-y-4">
      {/* Cabecera del curso */}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><GraduationCap className="h-6 w-6" aria-hidden /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {courses.data.length > 1 ? (
                <select className="rounded-md border bg-background px-2 py-1 text-lg font-semibold" value={courseId ?? ""} onChange={(e) => { setCourseId(Number(e.target.value)); setSel({ k: "lesson", m: 0, l: 0 }); }} aria-label="Curso">
                  {courses.data.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select>
              ) : <h2 className="text-xl font-semibold">{tree.course.title || "Curso sin título"}</h2>}
              <Badge variant="secondary">{STATUS[s.course.status] ?? s.course.status}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">Edita títulos, textos y orden. Los alumnos ven lo publicado hasta que publiques tus cambios.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Stat Icon={Layers} value={totals.modules} label="módulos" />
            <Stat Icon={BookOpen} value={totals.lessons} label="lecciones" />
            <Stat Icon={PlayCircle} value={totals.files} label="materiales" />
            <Stat Icon={Users} value={s.usage.activeEnrollments} label="matrículas activas" />
          </div>
        </div>
      </section>

      {/* Barra de acciones */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-xl border bg-background/95 p-2 backdrop-blur">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${state.cls}`}><state.Icon className="h-3.5 w-3.5" aria-hidden />{state.label}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant={preview ? "default" : "outline"} onClick={() => setPreview((p) => !p)}><Eye className="mr-1 h-4 w-4" aria-hidden />{preview ? "Volver a editar" : "Vista previa del borrador"}</Button>
          <Button size="sm" variant="outline" onClick={() => setShowVersions(true)}><History className="mr-1 h-4 w-4" aria-hidden />Versiones ({s.versions.length})</Button>
          <Button size="sm" variant="outline" disabled={!s.draft || discard.isPending} onClick={() => confirm("¿Descartar el borrador? Lo publicado no cambia.") && discard.mutate({ courseId: s.course.id })}><Trash2 className="mr-1 h-4 w-4" aria-hidden />Descartar</Button>
          <Button size="sm" variant="secondary" disabled={!unsaved || save.isPending} onClick={() => save.mutate({ courseId: s.course.id, tree, expectedUpdatedAt: s.draftInfo?.updatedAt ?? null })}><Save className="mr-1 h-4 w-4" aria-hidden />Guardar borrador</Button>
          <Button size="sm" disabled={!s.draft || unsaved || !s.changes.length || publish.isPending} title={unsaved ? "Guarda el borrador antes de publicar" : undefined} onClick={() => setPublishing(true)}><Rocket className="mr-1 h-4 w-4" aria-hidden />Publicar cambios</Button>
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

      <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Árbol */}
        <nav aria-label="Estructura del curso" className="space-y-1 rounded-xl border bg-card p-2">
          <button type="button" onClick={() => pick({ k: "course" })} className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-semibold ${sel.k === "course" ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}>
            <GraduationCap className="h-4 w-4 shrink-0" aria-hidden /><span className="truncate">{tree.course.title || "Curso"}</span>
            {dirty.course && <span className="ml-auto h-2 w-2 rounded-full bg-amber-500" title="Modificado" />}
          </button>
          {tree.modules.map((m, mi) => {
            const isOpen = open.has(mi);
            const modSel = sel.k === "module" && sel.m === mi;
            return (
              <div key={m.id}>
                <div className={`flex items-center gap-1 rounded-lg pr-1 ${modSel ? "bg-primary/10" : "hover:bg-muted"}`}>
                  <button type="button" aria-label={isOpen ? "Contraer módulo" : "Desplegar módulo"} aria-expanded={isOpen} className="p-1.5" onClick={() => setOpen((o) => { const n = new Set(o); if (n.has(mi)) n.delete(mi); else n.add(mi); return n; })}>
                    {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden /> : <ChevronRight className="h-4 w-4" aria-hidden />}
                  </button>
                  <button type="button" onClick={() => pick({ k: "module", m: mi })} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm font-medium">
                    <Layers className="h-4 w-4 shrink-0 text-primary" aria-hidden /><span className="truncate">{m.title || "(sin título)"}</span>
                    {dirty.modules.has(m.id) && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Modificado" />}
                  </button>
                  <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{m.lessons.length}</span>
                  <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Subir módulo" disabled={mi === 0} onClick={() => { setTree({ ...tree, modules: move(tree.modules, mi, -1) }); setOpen((o) => new Set(Array.from(o).map((x) => (x === mi ? mi - 1 : x === mi - 1 ? mi : x)))); setSel({ k: "module", m: mi - 1 }); }}><ArrowUp className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Bajar módulo" disabled={mi === tree.modules.length - 1} onClick={() => { setTree({ ...tree, modules: move(tree.modules, mi, 1) }); setOpen((o) => new Set(Array.from(o).map((x) => (x === mi ? mi + 1 : x === mi + 1 ? mi : x)))); setSel({ k: "module", m: mi + 1 }); }}><ArrowDown className="h-3.5 w-3.5" /></Button>
                </div>
                {isOpen && (
                  <ul className="ml-5 mt-0.5 space-y-0.5 border-l pl-2">
                    {m.lessons.map((l, li) => {
                      const on = sel.k === "lesson" && sel.m === mi && sel.l === li;
                      return (
                        <li key={l.id} className={`flex items-center gap-1 rounded-md pr-1 ${on ? "bg-primary/10 font-medium text-primary" : "hover:bg-muted"}`}>
                          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-sm" onClick={() => pick({ k: "lesson", m: mi, l: li })}>
                            <BookOpen className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{li + 1}. {l.title || "(sin título)"}</span>
                            {dirty.lessons.has(l.id) && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Modificada" />}
                          </button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Subir lección" disabled={li === 0} onClick={() => { setMod(mi, (x) => ({ ...x, lessons: move(x.lessons, li, -1) })); setSel({ k: "lesson", m: mi, l: li - 1 }); }}><ArrowUp className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6" aria-label="Bajar lección" disabled={li === m.lessons.length - 1} onClick={() => { setMod(mi, (x) => ({ ...x, lessons: move(x.lessons, li, 1) })); setSel({ k: "lesson", m: mi, l: li + 1 }); }}><ArrowDown className="h-3.5 w-3.5" /></Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </nav>

        {/* Zona de edición */}
        <section className="min-w-0 rounded-xl border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-center gap-1 text-xs text-muted-foreground" aria-label="Ubicación">
            <GraduationCap className="h-3.5 w-3.5" aria-hidden /><span>{tree.course.title}</span>
            {mod && <><ChevronRight className="h-3 w-3" aria-hidden /><Layers className="h-3.5 w-3.5" aria-hidden /><span>{mod.title}</span></>}
            {les && <><ChevronRight className="h-3 w-3" aria-hidden /><BookOpen className="h-3.5 w-3.5" aria-hidden /><span className="font-medium text-foreground">{les.title}</span></>}
          </div>

          {sel.k === "course" && (
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 text-base font-semibold"><GraduationCap className="h-5 w-5 text-primary" aria-hidden />Datos del curso</h3>
              <label className="block text-sm font-medium">Título del curso<Input value={tree.course.title} onChange={(e) => setTree({ ...tree, course: { ...tree.course, title: e.target.value } })} maxLength={300} /></label>
              <label className="block text-sm font-medium">Descripción<Textarea rows={4} value={tree.course.description ?? ""} onChange={(e) => setTree({ ...tree, course: { ...tree.course, description: e.target.value } })} maxLength={5000} placeholder="Qué aprenderá la persona que haga este curso" /></label>
              <p className="text-xs text-muted-foreground">El idioma de los títulos y textos es el del curso. Los vídeos, audios y documentos se mantienen tal cual.</p>
            </div>
          )}

          {sel.k === "module" && mod && (
            <div className="space-y-4">
              <h3 className="flex items-center gap-2 text-base font-semibold"><Layers className="h-5 w-5 text-primary" aria-hidden />Módulo {sel.m + 1} de {tree.modules.length}</h3>
              <label className="block text-sm font-medium">Título del módulo<Input value={mod.title} onChange={(e) => setMod(sel.m, (x) => ({ ...x, title: e.target.value }))} maxLength={300} /></label>
              <div>
                <h4 className="mb-1 text-sm font-medium">Lecciones del módulo ({mod.lessons.length})</h4>
                <ol className="divide-y rounded-lg border">
                  {mod.lessons.map((l, li) => (
                    <li key={l.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="w-6 text-muted-foreground">{li + 1}</span>
                      <BookOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                      <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => pick({ k: "lesson", m: sel.m, l: li })}>{l.title}</button>
                      <span className="text-xs text-muted-foreground">{l.blocks.length} bloques</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Subir lección" disabled={li === 0} onClick={() => setMod(sel.m, (x) => ({ ...x, lessons: move(x.lessons, li, -1) }))}><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Bajar lección" disabled={li === mod.lessons.length - 1} onClick={() => setMod(sel.m, (x) => ({ ...x, lessons: move(x.lessons, li, 1) }))}><ArrowDown className="h-4 w-4" /></Button>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

          {sel.k === "lesson" && mod && les && (preview ? (
            <article className="space-y-3">
              <p className="rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">Vista previa del borrador · así quedará la lección para el alumno. Los vídeos, audios y PDF no cambian.</p>
              <h3 className="text-xl font-semibold">{les.title}</h3>
              {les.blocks.map((b) => {
                const K = kindOf(s.blockMeta[b.id]?.kind);
                return (
                  <div key={b.id} className="rounded-lg border p-3">
                    <h4 className="flex items-center gap-2 text-sm font-semibold"><span className={`rounded p-1 ${K.tone}`}><K.Icon className="h-3.5 w-3.5" aria-hidden /></span>{b.title}</h4>
                    {b.body && <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{b.body}</p>}
                    {b.attribution && <p className="mt-1 text-xs text-muted-foreground">{b.attribution}</p>}
                  </div>
                );
              })}
            </article>
          ) : (
            <div className="space-y-4">
              <label className="block text-sm font-medium">Título de la lección<Input className="mt-1 text-base font-semibold" value={les.title} onChange={(e) => setLes(sel.m, sel.l, (l) => ({ ...l, title: e.target.value }))} maxLength={300} /></label>
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Contenido de la lección ({les.blocks.length} bloques)</h4>
                <a className="inline-flex items-center gap-1 text-xs text-primary underline" href={`/admin/formacion/vista-previa/curso/${s.course.id}/leccion/${les.id}`} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-3 w-3" aria-hidden />Ver lo publicado como alumno</a>
              </div>
              {les.blocks.map((b, bi) => {
                const meta = s.blockMeta[b.id];
                const K = kindOf(meta?.kind);
                const hasText = ["text", "exercise", "external_link"].includes(meta?.kind ?? "text") || !!b.body;
                return (
                  <div key={b.id} className="overflow-hidden rounded-lg border">
                    <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5">
                      <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${K.tone}`}><K.Icon className="h-3.5 w-3.5" aria-hidden />{K.label}</span>
                      {meta?.resourceKind && <span className={`text-xs ${meta.resourceStatus === "verified" ? "text-emerald-700" : "text-amber-700"}`}>{meta.resourceStatus === "verified" ? "Fichero verificado" : "Fichero pendiente"}</span>}
                      <span className="ml-auto text-xs text-muted-foreground">{bi + 1} de {les.blocks.length}</span>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Subir bloque" disabled={bi === 0} onClick={() => setLes(sel.m, sel.l, (l) => ({ ...l, blocks: move(l.blocks, bi, -1) }))}><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Bajar bloque" disabled={bi === les.blocks.length - 1} onClick={() => setLes(sel.m, sel.l, (l) => ({ ...l, blocks: move(l.blocks, bi, 1) }))}><ArrowDown className="h-4 w-4" /></Button>
                    </div>
                    <div className="space-y-2 p-3">
                      <Input aria-label="Título del bloque" className="font-medium" value={b.title} onChange={(e) => setBlock(bi, (x) => ({ ...x, title: e.target.value }))} maxLength={300} />
                      {hasText && <Textarea aria-label="Texto del bloque" rows={Math.min(Math.max((b.body ?? "").split("\n").length + 1, 3), 14)} value={b.body ?? ""} onChange={(e) => setBlock(bi, (x) => ({ ...x, body: e.target.value }))} placeholder={meta?.kind === "external_link" ? "Texto del enlace" : "Texto que verá el alumno"} />}
                      <Input aria-label="Atribución" className="text-xs" value={b.attribution ?? ""} onChange={(e) => setBlock(bi, (x) => ({ ...x, attribution: e.target.value }))} placeholder="Atribución o autoría (opcional)" maxLength={300} />
                      {meta?.resourceKind && <p className="text-xs text-muted-foreground">El fichero de este bloque no se edita aquí; podrás sustituirlo en un próximo lote.</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      </div>

      {publishing && (
        <Dialog open onOpenChange={(o) => !o && setPublishing(false)}>
          <DialogContent>
            <DialogHeader><DialogTitle className="flex items-center gap-2"><Rocket className="h-5 w-5 text-primary" aria-hidden />Publicar cambios</DialogTitle></DialogHeader>
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
            <DialogHeader><DialogTitle className="flex items-center gap-2"><History className="h-5 w-5 text-primary" aria-hidden />Versiones anteriores</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground">Cada publicación guarda lo que había antes. Recuperar una versión la carga como borrador: no cambia nada hasta que la publiques.</p>
            {!s.versions.length ? <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Todavía no hay versiones. Aparecerán aquí cuando publiques tu primer cambio.</p> : (
              <ul className="max-h-72 divide-y overflow-auto text-sm">
                {s.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                    <span><span className="font-medium">Versión {v.version}</span> · {fmt(v.createdAt)}<br /><span className="text-xs text-muted-foreground">{v.summary}{v.note ? ` · ${v.note}` : ""}</span></span>
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
    </div>
  );
}
