/**
 * Elephant Learning · Materiales (lote 2): biblioteca de vídeos, audios y PDF de los cursos.
 * Subir un fichero NUEVO a un recurso lo deja «pendiente de publicar»: los alumnos siguen recibiendo el vigente hasta que se
 * publica la sustitución. El anterior se conserva y se puede recuperar. Nada se borra desde aquí.
 */
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import { FILE_STATUS_ES, KIND_ES, checkUpload, formatBytes, spaceLevel, type MaterialView } from "@shared/learningMaterials";
import { AlertTriangle, CheckCircle2, Clock, Copy, Eye, FileText, Film, HardDrive, History, Image as ImageIcon, Music, RotateCcw, Search, UploadCloud, type LucideIcon } from "lucide-react";

const KIND_ICON: Record<string, LucideIcon> = { video: Film, audio: Music, pdf: FileText, document: FileText, image: ImageIcon };
const MAX_BYTES = 2048 * 1024 * 1024;
const fmtDate = (ms: number | null) => (ms ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(ms)) : "—");

type Filter = "todos" | "pendientes" | "sin-fichero" | "video" | "audio" | "pdf";
type Material = MaterialView;

function SpaceBar() {
  const q = trpc.storage.overview.useQuery(undefined, { staleTime: 15_000 });
  const l = q.data?.learning;
  if (!l) return null;
  const limitBytes = l.limitGb != null ? l.limitGb * 1024 ** 3 : null;
  const pct = limitBytes ? Math.min(100, Math.round((l.usedBytes / limitBytes) * 100)) : 0;
  const level = spaceLevel(l.usedBytes, l.limitGb);
  const tone = level === "exceeded" || level === "critical" ? "text-destructive" : level === "warning" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
  return (
    <section className="rounded-xl border bg-card p-4" aria-label="Espacio de formación">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><HardDrive className="h-4 w-4 text-primary" aria-hidden />Espacio de formación</h3>
        <span className={`text-sm ${tone}`}>
          {limitBytes ? <>Usado {formatBytes(l.usedBytes)} de {formatBytes(limitBytes)} · disponible <strong>{formatBytes(l.availableBytes ?? 0)}</strong></> : "Sin espacio de formación concedido"}
        </span>
      </div>
      {limitBytes ? <Progress value={pct} className="mt-3 h-2" aria-label={`${pct}% usado`} /> : null}
      <p className="mt-2 text-xs text-muted-foreground">
        {l.objects} ficheros{q.data?.duplicates?.groups ? ` · ${q.data.duplicates.groups} repetidos (${formatBytes(q.data.duplicates.extraBytes ?? 0)})` : ""}. Al sustituir un material el anterior se conserva y sigue ocupando espacio hasta que se limpie con el procedimiento protegido.
        {level === "warning" && " Queda poco espacio."}{level === "critical" && " Casi sin espacio: no se podrán subir ficheros grandes."}{level === "exceeded" && " Espacio agotado."}
      </p>
    </section>
  );
}

function Orphans() {
  const [open, setOpen] = useState(false);
  const q = trpc.storage.reconcile.useQuery({ categories: ["learning-content"] }, { enabled: open, staleTime: 60_000 });
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><Search className="h-4 w-4 text-primary" aria-hidden />Ficheros sin referencias</h3>
        <Button size="sm" variant="outline" disabled={q.isFetching} onClick={() => (open ? q.refetch() : setOpen(true))}>{q.isFetching ? "Analizando…" : open ? "Volver a analizar" : "Analizar"}</Button>
      </div>
      {!open && <p className="mt-2 text-sm text-muted-foreground">Busca ficheros de formación que ningún material usa (por ejemplo, subidas descartadas). Solo informa: no borra nada.</p>}
      {q.isError && <p className="mt-2 text-sm text-destructive">No se pudo analizar. Inténtalo de nuevo.</p>}
      {q.data && (() => {
        const c = q.data.byCategory["learning-content"];
        return (
          <div className="mt-3 space-y-2 text-sm">
            <p>{c?.orphans ?? 0} sin referencias ({formatBytes(c?.orphanBytes ?? 0)}) · {c?.shared ?? 0} compartidos entre varios materiales · {c?.protected ?? 0} recientes protegidos.</p>
            {q.data.orphans.length > 0 && (
              <ul className="divide-y rounded-lg border">
                {q.data.orphans.slice(0, 20).map((o) => (
                  <li key={o.objectId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="truncate">{o.originalName ?? o.objectId}</span>
                    <span className="text-xs text-muted-foreground">{formatBytes(o.sizeBytes)}{o.sameHashAsReferenced ? " · idéntico a uno en uso" : ""}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">Liberarlos es una operación protegida, con simulación y copia verificada. No se hace desde esta pantalla.</p>
          </div>
        );
      })()}
    </section>
  );
}

function UploadControl({ m, space }: { m: Material; space: { usedBytes: number; limitGb: number | null } | null }) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [last, setLast] = useState<File | null>(null);

  function send(file: File) {
    setError(null);
    setLast(file);
    if (space) {
      const c = checkUpload({ kind: m.kind, mimeType: file.type, sizeBytes: file.size, maxBytes: MAX_BYTES, usedBytes: space.usedBytes, limitGb: space.limitGb });
      if (!c.ok && c.problem !== "WRONG_TYPE") return setError(c.message ?? "No se puede subir este fichero.");
    }
    const fd = new FormData();
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/learning/materials/${m.resourceId}/stage`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => e.lengthComputable && setPct(Math.round((e.loaded / e.total) * 100));
    xhr.onerror = () => { setPct(null); setError("Se perdió la conexión durante la subida. Tu material actual no ha cambiado; puedes reintentar."); };
    xhr.onload = () => {
      setPct(null);
      let j: { ok?: boolean; error?: string; duplicateOf?: number[] } = {};
      try { j = JSON.parse(xhr.responseText); } catch { /* respuesta sin JSON */ }
      if (xhr.status >= 200 && xhr.status < 300 && j.ok) {
        toast.success(j.duplicateOf?.length ? `Subido, pendiente de publicar. Atención: mismo contenido que ${j.duplicateOf.length} material(es).` : "Subido y verificado. Revisa la vista previa y publica la sustitución.");
        utils.learning.admin.materials.list.invalidate();
        utils.storage.overview.invalidate();
        return;
      }
      setError(j.error ?? (xhr.status === 413 ? "El fichero supera el tamaño máximo permitido." : "No se pudo subir el fichero. Tu material actual no ha cambiado."));
    };
    setPct(0);
    xhr.send(fd);
  }

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) send(f); }} />
      <Button size="sm" variant="secondary" disabled={pct != null} onClick={() => inputRef.current?.click()}>
        <UploadCloud className="mr-1.5 h-4 w-4" aria-hidden />{m.objectId ? "Sustituir fichero" : "Subir fichero"}
      </Button>
      {pct != null && (
        <div role="status" aria-live="polite" className="space-y-1">
          <Progress value={pct} className="h-2" />
          <p className="text-xs text-muted-foreground">Subiendo… {pct}%</p>
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <div className="space-y-1"><p>{error}</p>{last && <Button size="sm" variant="outline" onClick={() => send(last)}>Reintentar</Button>}</div>
        </div>
      )}
    </div>
  );
}

function MaterialCard({ m, space }: { m: Material; space: { usedBytes: number; limitGb: number | null } | null }) {
  const utils = trpc.useUtils();
  const [confirm, setConfirm] = useState<null | { kind: "publish" | "restore"; fileId: number }>(null);
  const refresh = () => { utils.learning.admin.materials.list.invalidate(); utils.storage.overview.invalidate(); };
  const publish = trpc.learning.admin.materials.publish.useMutation({ onSuccess: () => { toast.success("Sustitución publicada. Los alumnos ya reciben el fichero nuevo."); setConfirm(null); refresh(); }, onError: (e) => toastError(e) });
  const restore = trpc.learning.admin.materials.restore.useMutation({ onSuccess: () => { toast.success("Fichero anterior recuperado."); setConfirm(null); refresh(); }, onError: (e) => toastError(e) });
  const discard = trpc.learning.admin.materials.discard.useMutation({ onSuccess: () => { toast.success("Pendiente descartado. El material vigente no ha cambiado."); refresh(); }, onError: (e) => toastError(e) });
  const Icon = KIND_ICON[m.kind] ?? FileText;
  const use = m.uses[0];
  const previous = m.history.filter((h) => h.status === "replaced");
  return (
    <li className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-6 w-6" aria-hidden /></div>
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{m.originalName ?? `${KIND_ES[m.kind] ?? m.kind} sin nombre`}</h3>
            <p className="text-sm text-muted-foreground">
              {KIND_ES[m.kind] ?? m.kind}{m.sizeBytes ? ` · ${formatBytes(m.sizeBytes)}` : ""}{use ? ` · ${use.courseTitle} › ${use.moduleTitle} › ${use.lessonTitle}` : " · sin usar en ningún curso"}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {m.objectId ? <Badge variant="secondary"><CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />Verificado</Badge> : <Badge variant="outline"><Clock className="mr-1 h-3 w-3" aria-hidden />Sin fichero</Badge>}
              {m.staged && <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300"><Clock className="mr-1 h-3 w-3" aria-hidden />Pendiente de publicar</Badge>}
              {m.sharedWith.length > 0 && <Badge variant="outline"><Copy className="mr-1 h-3 w-3" aria-hidden />Mismo contenido que {m.sharedWith.length} más</Badge>}
              {m.uses.length > 1 && <Badge variant="outline">Usado en {m.uses.length} bloques</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {m.objectId && (
            <Button size="sm" variant="ghost" asChild><a href={`/api/learning/preview/resource/${m.resourceId}`} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" aria-hidden />Ver vigente</a></Button>
          )}
          <UploadControl m={m} space={space} />
        </div>
      </div>

      {m.staged && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
          <p className="text-sm font-medium">Nuevo fichero pendiente: {m.staged.originalName ?? "sin nombre"} · {formatBytes(m.staged.sizeBytes)} · subido {fmtDate(m.staged.createdAt)}</p>
          <p className="text-xs text-muted-foreground">Los alumnos siguen recibiendo el fichero vigente. Revisa el nuevo antes de publicar.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" asChild><a href={`/api/learning/preview/file/${m.staged.id}`} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" aria-hidden />Vista previa</a></Button>
            <Button size="sm" onClick={() => setConfirm({ kind: "publish", fileId: m.staged!.id })}>Publicar sustitución</Button>
            <Button size="sm" variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate({ resourceId: m.resourceId })}>Descartar</Button>
          </div>
        </div>
      )}

      {previous.length > 0 && (
        <details className="mt-3">
          <summary className="flex cursor-pointer items-center gap-1.5 text-sm font-medium"><History className="h-4 w-4" aria-hidden />Versiones anteriores conservadas ({previous.length})</summary>
          <ul className="mt-2 divide-y rounded-lg border text-sm">
            {previous.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 truncate">{h.originalName ?? "sin nombre"} · {formatBytes(h.sizeBytes)} · {FILE_STATUS_ES[h.status]}{h.replacedAt ? ` el ${fmtDate(h.replacedAt)}` : ""}</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="ghost" asChild><a href={`/api/learning/preview/file/${h.id}`} target="_blank" rel="noreferrer"><Eye className="mr-1.5 h-4 w-4" aria-hidden />Ver</a></Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirm({ kind: "restore", fileId: h.id })}><RotateCcw className="mr-1.5 h-4 w-4" aria-hidden />Recuperar</Button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{confirm?.kind === "publish" ? "Publicar la sustitución" : "Recuperar el fichero anterior"}</DialogTitle></DialogHeader>
          <p className="text-sm">
            {confirm?.kind === "publish"
              ? "Desde ahora los alumnos recibirán el fichero nuevo. Su progreso, matrículas y accesos no cambian, y el fichero actual se conserva para poder recuperarlo."
              : "Los alumnos volverán a recibir el fichero anterior. El que está vigente ahora se conserva."}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(null)}>Cancelar</Button>
            <Button disabled={publish.isPending || restore.isPending} onClick={() => confirm && (confirm.kind === "publish" ? publish : restore).mutate({ resourceId: m.resourceId, fileId: confirm.fileId })}>
              {confirm?.kind === "publish" ? "Publicar" : "Recuperar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </li>
  );
}

export default function Materials() {
  const q = trpc.learning.admin.materials.list.useQuery() as { data: MaterialView[] | undefined; isLoading: boolean; isError: boolean; error: any; refetch: () => void }; // eslint-disable-line @typescript-eslint/no-explicit-any
  const overview = trpc.storage.overview.useQuery(undefined, { staleTime: 15_000 });
  const [filter, setFilter] = useState<Filter>("todos");
  const space = overview.data?.learning ? { usedBytes: overview.data.learning.usedBytes, limitGb: overview.data.learning.limitGb } : null;
  const shown = useMemo(() => (q.data ?? []).filter((m) => {
    if (filter === "pendientes") return !!m.staged;
    if (filter === "sin-fichero") return !m.objectId;
    if (filter === "video" || filter === "audio" || filter === "pdf") return m.kind === filter;
    return true;
  }), [q.data, filter]);

  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const pending = (q.data ?? []).filter((m) => m.staged).length;
  const filters: Array<[Filter, string]> = [["todos", "Todos"], ["pendientes", `Pendientes de publicar${pending ? ` (${pending})` : ""}`], ["sin-fichero", "Sin fichero"], ["video", "Vídeos"], ["audio", "Audios"], ["pdf", "PDF"]];
  return (
    <div className="space-y-4">
      <SpaceBar />
      {!(q.data ?? []).length ? (
        <PanelEmpty title="Sin materiales" description="Los vídeos, audios y PDF aparecen aquí cuando un curso los incluye. Sube o sustituye cada fichero sin tocar lo que ven los alumnos hasta publicar." />
      ) : (
        <>
          <div role="group" aria-label="Filtrar materiales" className="flex flex-wrap gap-1.5">
            {filters.map(([k, label]) => (
              <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</Button>
            ))}
          </div>
          {shown.length ? (
            <ul className="space-y-3">{shown.map((m) => <MaterialCard key={m.resourceId} m={m} space={space} />)}</ul>
          ) : (
            <PanelEmpty title="Nada en este filtro" description="Prueba con otro filtro." />
          )}
        </>
      )}
      <Orphans />
    </div>
  );
}
