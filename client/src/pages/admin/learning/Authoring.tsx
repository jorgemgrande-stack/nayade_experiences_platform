/**
 * Elephant Learning · Crear formaciones (lote 3): cursos nuevos, estructura, duplicado y archivado.
 * Un curso nuevo nace en borrador (privado). Los cambios de un curso ya publicado se hacen en «Editor» (borrador y publicar).
 */
import { confirmAction } from "@/components/admin/ConfirmHost";
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
import { useI18n } from "@/i18n/I18nProvider";
import { BLOCK_KINDS, RESOURCE_KINDS, type BlockKind } from "@shared/learningAuthoring";
import { Archive, ArchiveRestore, BookPlus, Copy, FileText, Film, Layers, Link2, ListPlus, Music, Plus, Type, type LucideIcon } from "lucide-react";

const KIND_ICON: Record<string, LucideIcon> = { text: Type, video: Film, audio: Music, pdf: FileText, external_link: Link2 };
const STATUS: Record<string, { key: string; cls: string }> = {
  draft: { key: "draft", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  published: { key: "published", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  archived: { key: "archived", cls: "bg-muted text-muted-foreground" },
};

function NewCourseDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("es");
  const create = trpc.learning.admin.authoring.createCourse.useMutation({ onSuccess: (r) => { toast.success(t("learningManage.authoring.courseCreated")); onCreated(r.courseId); }, onError: (e) => toastError(e) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("learningManage.authoring.newCourse")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <label className="block text-sm">{t("learningManage.authoring.title")}<Input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder={t("learningManage.authoring.titlePlaceholder")} /></label>
          <label className="block text-sm">{t("learningManage.authoring.descriptionOptional")}<Textarea value={description} maxLength={5000} rows={3} onChange={(e) => setDescription(e.target.value)} /></label>
          <label className="block text-sm">{t("learningManage.authoring.contentLanguage")}
            <select className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5" value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="es">{t("learningManage.authoring.langEs")}</option><option value="de">{t("learningManage.authoring.langDe")}</option><option value="en">{t("learningManage.authoring.langEn")}</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground">{t("learningManage.authoring.languageNote")}</p>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("learningManage.common.cancel")}</Button><Button disabled={!title.trim() || create.isPending} onClick={() => create.mutate({ title, description: description || null, language })}>{t("learningManage.authoring.createDraft")}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type AddState = null | { kind: "module" } | { kind: "lesson"; moduleId: number } | { kind: "block"; lessonId: number };

function AddDialog({ state, courseId, onClose, onDone }: { state: NonNullable<AddState>; courseId: number; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const lib = trpc.learning.admin.materials.list.useQuery(undefined, { enabled: state.kind === "block" });
  const [title, setTitle] = useState("");
  const [bk, setBk] = useState<BlockKind>("text");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [resourceId, setResourceId] = useState<number | "">("");
  const done = { onSuccess: () => { toast.success(t("learningManage.authoring.added")); onDone(); }, onError: (e: unknown) => toastError(e) };
  const addModule = trpc.learning.admin.authoring.addModule.useMutation(done);
  const addLesson = trpc.learning.admin.authoring.addLesson.useMutation(done);
  const addBlock = trpc.learning.admin.authoring.addBlock.useMutation(done);
  const reusable = useMemo(() => (lib.data ?? []).filter((r) => r.kind === bk && r.objectId), [lib.data, bk]);
  const busy = addModule.isPending || addLesson.isPending || addBlock.isPending;
  const heading = state.kind === "module" ? t("learningManage.authoring.addModule") : state.kind === "lesson" ? t("learningManage.authoring.addLesson") : t("learningManage.authoring.addContent");
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
            <div role="group" aria-label={t("learningManage.authoring.contentType")} className="flex flex-wrap gap-1.5">
              {BLOCK_KINDS.map((k) => { const I = KIND_ICON[k]; return <Button key={k} size="sm" variant={bk === k ? "default" : "outline"} aria-pressed={bk === k} onClick={() => { setBk(k); setResourceId(""); }}><I className="mr-1.5 h-4 w-4" aria-hidden />{t(`learningManage.authoring.kind.${k}`)}</Button>; })}
            </div>
          )}
          <label className="block text-sm">{t("learningManage.authoring.title")}<Input value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} /></label>
          {state.kind === "block" && bk === "text" && <label className="block text-sm">{t("learningManage.authoring.text")}<Textarea rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></label>}
          {state.kind === "block" && bk === "external_link" && <label className="block text-sm">{t("learningManage.authoring.link")}<Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" /></label>}
          {state.kind === "block" && RESOURCE_KINDS.includes(bk as never) && (
            <div className="space-y-1 text-sm">
              <label className="block">{t("learningManage.authoring.material")}
                <select className="mt-1 block w-full rounded-md border bg-background px-2 py-1.5" value={resourceId} onChange={(e) => setResourceId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">{t("learningManage.authoring.newMaterial")}</option>
                  {reusable.map((r) => <option key={r.resourceId} value={r.resourceId}>{t("learningManage.authoring.reuse", { name: r.originalName ?? t("learningManage.authoring.materialFallback", { id: r.resourceId }) })}</option>)}
                </select>
              </label>
              <p className="text-xs text-muted-foreground">{t("learningManage.authoring.reuseNote")}</p>
            </div>
          )}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t("learningManage.common.cancel")}</Button><Button disabled={!title.trim() || busy} onClick={submit}>{t("learningManage.authoring.add")}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Builder({ courseId }: { courseId: number }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.learning.admin.authoring.outline.useQuery({ courseId });
  const [add, setAdd] = useState<AddState>(null);
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const o = q.data!;
  const editable = o.course.status === "draft";
  const refresh = () => { setAdd(null); utils.learning.admin.authoring.outline.invalidate(); utils.learning.admin.courses.invalidate(); utils.learning.admin.materials.list.invalidate(); };
  return (
    <section className="rounded-xl border bg-card p-4" aria-label={t("learningManage.authoring.structure")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Layers className="h-4 w-4 text-primary" aria-hidden />{t("learningManage.authoring.structureOf", { title: o.course.title })}</h3>
        {editable && <Button size="sm" onClick={() => setAdd({ kind: "module" })}><Plus className="mr-1.5 h-4 w-4" aria-hidden />{t("learningManage.authoring.addModule")}</Button>}
      </div>
      {!editable && <p className="mt-2 rounded-md bg-muted p-2 text-sm text-muted-foreground">{o.course.status === "archived" ? t("learningManage.authoring.archivedNote") : t("learningManage.authoring.publishedNote")}</p>}
      {!o.modules.length ? (
        <PanelEmpty title={t("learningManage.authoring.noModulesTitle")} description={t("learningManage.authoring.noModulesDesc")} />
      ) : (
        <ol className="mt-3 space-y-3">
          {o.modules.map((m, mi) => (
            <li key={m.id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{t("learningManage.authoring.moduleN", { n: mi + 1, title: m.title })}</p>
                {editable && <Button size="sm" variant="outline" onClick={() => setAdd({ kind: "lesson", moduleId: m.id })}><ListPlus className="mr-1.5 h-4 w-4" aria-hidden />{t("learningManage.authoring.addLesson")}</Button>}
              </div>
              <ol className="mt-2 space-y-2">
                {m.lessons.map((l, li) => (
                  <li key={l.id} className="rounded-md bg-muted/40 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium">{mi + 1}.{li + 1} {l.title}</p>
                      {editable && <Button size="sm" variant="ghost" onClick={() => setAdd({ kind: "block", lessonId: l.id })}><Plus className="mr-1 h-4 w-4" aria-hidden />{t("learningManage.authoring.content")}</Button>}
                    </div>
                    {l.blocks.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                        {l.blocks.map((b) => { const I = KIND_ICON[b.kind] ?? FileText; return <li key={b.id} className="flex items-center gap-1.5"><I className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{b.title}</span></li>; })}
                      </ul>
                    )}
                  </li>
                ))}
                {!m.lessons.length && <li className="text-sm text-muted-foreground">{t("learningManage.authoring.noLessons")}</li>}
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
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const courses = trpc.learning.admin.courses.useQuery();
  const [sel, setSel] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const refresh = () => { utils.learning.admin.courses.invalidate(); utils.learning.admin.authoring.outline.invalidate(); };
  const duplicate = trpc.learning.admin.authoring.duplicateCourse.useMutation({ onSuccess: (r) => { toast.success(t("learningManage.authoring.copyCreated", { n: r.shared })); refresh(); setSel(r.courseId); }, onError: (e) => toastError(e) });
  const archive = trpc.learning.admin.authoring.archiveCourse.useMutation({ onSuccess: (r) => { toast.success(r.status === "archived" ? t("learningManage.authoring.archivedToast") : t("learningManage.authoring.restoredToast")); refresh(); }, onError: (e) => toastError(e) });
  const setStatus = trpc.learning.admin.setCourseStatus.useMutation({ onSuccess: () => refresh(), onError: (e) => toastError(e) });
  if (courses.isLoading) return <PanelLoading />;
  if (courses.isError) return <PanelError error={courses.error} onRetry={() => courses.refetch()} />;
  const list = courses.data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{t("learningManage.authoring.intro")}</p>
        <Button onClick={() => setCreating(true)}><BookPlus className="mr-1.5 h-4 w-4" aria-hidden />{t("learningManage.authoring.newCourse")}</Button>
      </div>
      {!list.length ? (
        <PanelEmpty title={t("learningManage.authoring.noCoursesTitle")} description={t("learningManage.authoring.noCoursesDesc")} />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((c) => {
            const st = STATUS[c.status] ?? STATUS.draft;
            return (
              <li key={c.id} className={`rounded-xl border bg-card p-4 ${sel === c.id ? "ring-2 ring-primary" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <button className="min-w-0 text-left" onClick={() => setSel(c.id)} aria-label={t("learningManage.authoring.viewStructureOf", { title: c.title })}>
                    <h3 className="truncate font-semibold">{c.title}</h3>
                    <p className="text-sm text-muted-foreground">{t("learningManage.authoring.courseSummary", { modules: c.modules.length, verified: c.coverage.files.verified, pending: c.coverage.files.pending ? t("learningManage.authoring.courseSummaryPending", { n: c.coverage.files.pending }) : "" })}</p>
                  </button>
                  <Badge className={st.cls}>{t(`learningManage.authoring.status.${st.key}`)}</Badge>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setSel(c.id)}>{t("learningManage.authoring.structureBtn")}</Button>
                  <Button size="sm" variant="outline" disabled={duplicate.isPending} onClick={() => duplicate.mutate({ courseId: c.id })}><Copy className="mr-1.5 h-4 w-4" aria-hidden />{t("learningManage.authoring.duplicate")}</Button>
                  {c.status === "draft" && <Button size="sm" variant="outline" onClick={async () => (await confirmAction({ description: t("learningManage.authoring.publishConfirm", { title: c.title }) })) && setStatus.mutate({ courseId: c.id, status: "published" })}>{t("learningManage.authoring.publish")}</Button>}
                  {c.status === "published" && <Button size="sm" variant="outline" onClick={() => setStatus.mutate({ courseId: c.id, status: "draft" })}>{t("learningManage.authoring.backToDraft")}</Button>}
                  {c.status !== "archived" ? (
                    <Button size="sm" variant="ghost" onClick={async () => (await confirmAction({ description: t("learningManage.authoring.archiveConfirm", { title: c.title }), destructive: true })) && archive.mutate({ courseId: c.id, archive: true })}><Archive className="mr-1.5 h-4 w-4" aria-hidden />{t("learningManage.authoring.archive")}</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => archive.mutate({ courseId: c.id, archive: false })}><ArchiveRestore className="mr-1.5 h-4 w-4" aria-hidden />{t("learningManage.authoring.restore")}</Button>
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
