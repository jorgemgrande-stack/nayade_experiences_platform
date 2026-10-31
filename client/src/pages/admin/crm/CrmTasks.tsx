/**
 * Tareas y recordatorios internos del CRM (crm-tasks): «Mis tareas» y las de todo el equipo, con
 * vencimiento, responsable, prioridad y vínculo opcional a un cliente, una oportunidad o un
 * presupuesto. Las vencidas se destacan con texto e icono (no solo con color). No envía correos.
 *
 * Filtro por elemento: /admin/crm/tareas?vinculo=client&id=12&nombre=Ana (desde la ficha del cliente).
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { AlertTriangle, CalendarClock, CheckCircle2, Circle, ClipboardList, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, describedBy, selectClass, useCrmCanWrite } from "@/components/admin/crm/CrmParts";
import { useAuth } from "@/_core/hooks/useAuth";
import { cn } from "@/lib/utils";
import {
  TASK_ENTITY_LABELS, TASK_ENTITY_TYPES, TASK_PRIORITIES, TASK_PRIORITY_LABELS, TASK_TITLE_MAX,
  isTaskDueToday, isTaskOverdue, localYmd, taskEntityHref, validateTaskForm,
  type TaskEntityType, type TaskPriority,
} from "@shared/crmTagsTasks";
import { toastError } from "@/lib/errorMessage";

type TaskRow = {
  id: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  status: "pendiente" | "hecha";
  priority: TaskPriority;
  assignedTo: number | null;
  assigneeName: string | null;
  entityType: TaskEntityType | null;
  entityId: number | null;
  entityLabel: string | null;
};

type EntityRef = { type: TaskEntityType; id: number; label: string };

const fmtDate = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
};

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  alta: "bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-100",
  media: "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100",
  baja: "bg-slate-100 text-slate-900 dark:bg-slate-500/20 dark:text-slate-100",
};

/** Buscador del elemento a vincular (cliente, oportunidad o presupuesto). */
function EntityPicker({ type, value, onChange, invalid }: { type: TaskEntityType; value: EntityRef | null; onChange: (v: EntityRef | null) => void; invalid?: boolean }) {
  const [q, setQ] = useState("");
  const input = { search: q.trim() || undefined, limit: 20, offset: 0 };
  const clients = trpc.crm.clients.list.useQuery(input, { enabled: type === "client" });
  const leads = trpc.crm.leads.list.useQuery(input, { enabled: type === "lead" });
  const quotes = trpc.crm.quotes.list.useQuery(input, { enabled: type === "quote" });
  const options: Array<{ id: number; label: string }> =
    type === "client" ? (clients.data?.items ?? []).map((c) => ({ id: c.id, label: c.email ? `${c.name} (${c.email})` : c.name }))
      : type === "lead" ? (leads.data?.rows ?? []).map((l) => ({ id: l.id, label: l.email ? `${l.name} (${l.email})` : l.name }))
        : (quotes.data?.rows ?? []).map((x) => ({ id: x.id, label: `${x.quoteNumber} · ${x.title}` }));
  const loading = (type === "client" ? clients : type === "lead" ? leads : quotes).isLoading;
  const failed = (type === "client" ? clients : type === "lead" ? leads : quotes).isError;
  const labelOf = (o: { id: number; label: string }) => (type === "quote" ? o.label.split(" · ")[0] : o.label.replace(/ \(.*\)$/, ""));

  return (
    <div className="space-y-2">
      <Input
        id="task-entity-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={`Buscar ${TASK_ENTITY_LABELS[type].toLowerCase()}…`}
        aria-label={`Buscar ${TASK_ENTITY_LABELS[type].toLowerCase()}`}
      />
      <select
        id="task-entity"
        className={selectClass}
        value={value?.type === type ? String(value.id) : ""}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? "task-entity-error" : undefined}
        onChange={(e) => {
          const o = options.find((x) => String(x.id) === e.target.value);
          onChange(o ? { type, id: o.id, label: labelOf(o) } : null);
        }}
      >
        <option value="">{loading ? "Cargando…" : failed ? "No se han podido cargar" : options.length ? "Elige uno" : "Sin resultados"}</option>
        {value?.type === type && !options.some((o) => o.id === value.id) && <option value={value.id}>{value.label}</option>}
        {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
}

function TaskForm({ task, presetEntity, onClose }: { task: TaskRow | null; presetEntity: EntityRef | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const assignees = trpc.crmTasks.assignees.useQuery();
  const [title, setTitle] = useState(task?.title ?? "");
  const [description, setDescription] = useState(task?.description ?? "");
  const [dueDate, setDueDate] = useState(task?.dueDate ?? "");
  const [assignedTo, setAssignedTo] = useState<string>(task ? (task.assignedTo ? String(task.assignedTo) : "") : user?.id ? String(user.id) : "");
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? "media");
  const initialEntity: EntityRef | null = task
    ? task.entityType && task.entityId != null ? { type: task.entityType, id: task.entityId, label: task.entityLabel ?? `#${task.entityId}` } : null
    : presetEntity;
  const [entityType, setEntityType] = useState<TaskEntityType | "">(initialEntity?.type ?? "");
  const [entity, setEntity] = useState<EntityRef | null>(initialEntity);
  const [errors, setErrors] = useState<ReturnType<typeof validateTaskForm> & { server?: string }>({});

  const done = (msg: string) => {
    toast.success(msg);
    utils.crmTasks.list.invalidate();
    utils.crmTasks.summary.invalidate();
    utils.notifications.feed.invalidate();
    onClose();
  };
  const onError = (e: { message: string }) => setErrors({ server: e.message });
  const create = trpc.crmTasks.create.useMutation({ onSuccess: () => done("Tarea creada"), onError });
  const update = trpc.crmTasks.update.useMutation({ onSuccess: () => done("Tarea guardada"), onError });
  const pending = create.isPending || update.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const linked = entityType && entity?.type === entityType ? entity : null;
    const errs = validateTaskForm({ title, description, dueDate: dueDate || null, entityType: entityType || null, entityId: linked?.id ?? null });
    if (entityType && !linked) errs.entity = `Elige ${entityType === "quote" ? "el presupuesto" : entityType === "lead" ? "la oportunidad" : "el cliente"} o quita el vínculo.`;
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      dueDate: dueDate || null,
      assignedTo: assignedTo ? Number(assignedTo) : null,
      priority,
      entityType: linked?.type ?? null,
      entityId: linked?.id ?? null,
    };
    if (task) update.mutate({ id: task.id, ...payload });
    else create.mutate(payload);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      {errors.server && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm text-destructive">{errors.server}</p>}
      <FormField id="task-title" label="Título" error={errors.title} required>
        <Input id="task-title" value={title} maxLength={TASK_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} aria-invalid={!!errors.title} aria-required aria-describedby={describedBy("task-title", errors.title)} autoFocus />
      </FormField>
      <FormField id="task-description" label="Descripción" error={errors.description}>
        <Textarea id="task-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={!!errors.description} aria-describedby={describedBy("task-description", errors.description)} />
      </FormField>
      <div className="grid gap-4 sm:grid-cols-3">
        <FormField id="task-due" label="Vence el" error={errors.dueDate}>
          <Input id="task-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-invalid={!!errors.dueDate} aria-describedby={describedBy("task-due", errors.dueDate)} />
        </FormField>
        <FormField id="task-assignee" label="Responsable">
          <select id="task-assignee" className={selectClass} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
            <option value="">Sin responsable</option>
            {(assignees.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </FormField>
        <FormField id="task-priority" label="Prioridad">
          <select id="task-priority" className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
            {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</option>)}
          </select>
        </FormField>
      </div>
      <FormField id="task-entity-type" label="Vincular a" error={errors.entity}>
        <select
          id="task-entity-type"
          className={selectClass}
          value={entityType}
          onChange={(e) => { setEntityType(e.target.value as TaskEntityType | ""); setErrors((x) => ({ ...x, entity: undefined })); }}
          aria-invalid={!!errors.entity}
          aria-describedby={describedBy("task-entity-type", errors.entity)}
        >
          <option value="">Sin vínculo</option>
          {TASK_ENTITY_TYPES.map((t) => <option key={t} value={t}>{TASK_ENTITY_LABELS[t]}</option>)}
        </select>
      </FormField>
      {entityType && <EntityPicker type={entityType} value={entity} onChange={setEntity} invalid={!!errors.entity} />}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
        <Button type="submit" disabled={pending}>{task ? "Guardar cambios" : "Crear tarea"}</Button>
      </DialogFooter>
    </form>
  );
}

export default function CrmTasks() {
  const canWrite = useCrmCanWrite("crm-tasks");
  const utils = trpc.useUtils();
  const search = useSearch();
  const urlEntity = useMemo<EntityRef | null>(() => {
    const p = new URLSearchParams(search);
    const type = p.get("vinculo") as TaskEntityType | null;
    const id = Number(p.get("id"));
    if (!type || !(TASK_ENTITY_TYPES as readonly string[]).includes(type) || !Number.isInteger(id) || id <= 0) return null;
    return { type, id, label: p.get("nombre") || `#${id}` };
  }, [search]);
  const [entityFilter, setEntityFilter] = useState<EntityRef | null>(urlEntity);
  useEffect(() => setEntityFilter(urlEntity), [urlEntity]);

  const [scope, setScope] = useState<"mine" | "all">(urlEntity ? "all" : "mine");
  const [status, setStatus] = useState<"pendiente" | "hecha" | "todas">("pendiente");
  const [overdue, setOverdue] = useState(false);
  const [assignee, setAssignee] = useState("");
  const assignees = trpc.crmTasks.assignees.useQuery();
  const tasks = trpc.crmTasks.list.useQuery({
    scope,
    status,
    overdue: overdue || undefined,
    assignedTo: scope === "all" && assignee ? Number(assignee) : undefined,
    entityType: entityFilter?.type,
    entityId: entityFilter?.id,
    limit: 100,
    offset: 0,
  });
  const [editing, setEditing] = useState<TaskRow | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<TaskRow | null>(null);
  const refresh = () => {
    utils.crmTasks.list.invalidate();
    utils.crmTasks.summary.invalidate();
    utils.notifications.feed.invalidate();
  };
  const setDone = trpc.crmTasks.setStatus.useMutation({
    onSuccess: (_r, v) => { toast.success(v.status === "hecha" ? "Tarea marcada como hecha" : "Tarea reabierta"); refresh(); },
    onError: (e) => toastError(e),
  });
  const del = trpc.crmTasks.delete.useMutation({
    onSuccess: () => { toast.success("Tarea eliminada"); refresh(); setDeleting(null); },
    onError: (e) => toastError(e),
  });

  const today = localYmd();
  const rows = (tasks.data?.rows ?? []) as TaskRow[];
  const filtered = status !== "pendiente" || overdue || assignee || entityFilter;

  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Tareas</h1>
            <p className="text-sm text-muted-foreground">Recordatorios internos del equipo: qué hay que hacer, para cuándo y quién se encarga.</p>
          </div>
          {canWrite && (
            <Button onClick={() => setEditing(null)}>
              <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Nueva tarea
            </Button>
          )}
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4">
          <div role="group" aria-label="Qué tareas ver" className="inline-flex rounded-md border border-input p-0.5">
            {([["mine", "Mis tareas"], ["all", "Todo el equipo"]] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={scope === k}
                onClick={() => setScope(k)}
                className={cn("rounded px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", scope === k ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted")}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-w-[150px] space-y-1">
            <label htmlFor="tasks-status" className="block text-xs font-medium text-muted-foreground">Estado</label>
            <select id="tasks-status" className={selectClass} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
              <option value="pendiente">Pendientes</option>
              <option value="hecha">Hechas</option>
              <option value="todas">Todas</option>
            </select>
          </div>
          {scope === "all" && (
            <div className="min-w-[180px] space-y-1">
              <label htmlFor="tasks-assignee" className="block text-xs font-medium text-muted-foreground">Responsable</label>
              <select id="tasks-assignee" className={selectClass} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                <option value="">Cualquiera</option>
                {(assignees.data ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
          <label className="flex h-9 items-center gap-2 text-sm text-foreground">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
            Solo vencidas
          </label>
          {entityFilter && (
            <span className="inline-flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
              <Link2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {TASK_ENTITY_LABELS[entityFilter.type]}: <strong className="font-medium">{entityFilter.label}</strong>
              <button type="button" onClick={() => setEntityFilter(null)} className="rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Quitar el filtro por elemento vinculado">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          )}
        </div>

        {tasks.isLoading ? (
          <PanelLoading label="Cargando tareas…" />
        ) : tasks.isError ? (
          <PanelError error={tasks.error} onRetry={() => tasks.refetch()} title="No se han podido cargar las tareas" />
        ) : rows.length === 0 ? (
          <PanelEmpty
            icon={<ClipboardList className="h-6 w-6" />}
            title={filtered ? "No hay tareas con estos filtros" : scope === "mine" ? "No tienes tareas pendientes" : "El equipo no tiene tareas pendientes"}
            description={filtered ? "Cambia los filtros para ver más tareas." : "Crea una tarea para acordarte de llamar a un cliente, enviar un presupuesto o cualquier otra gestión."}
          >
            {canWrite && !filtered && <Button onClick={() => setEditing(null)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Crear una tarea</Button>}
          </PanelEmpty>
        ) : (
          <ul className="space-y-2" aria-label="Listado de tareas">
            {rows.map((t) => {
              const late = isTaskOverdue(t, today);
              const dueToday = isTaskDueToday(t, today);
              const href = taskEntityHref(t.entityType, t.entityId, t.entityLabel);
              return (
                <li key={t.id} className={cn("flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-start", late ? "border-red-400 dark:border-red-500/60" : "border-border")}>
                  {canWrite ? (
                    <button
                      type="button"
                      onClick={() => setDone.mutate({ id: t.id, status: t.status === "hecha" ? "pendiente" : "hecha" })}
                      disabled={setDone.isPending}
                      className="self-start rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t.status === "hecha" ? `Reabrir la tarea «${t.title}»` : `Marcar como hecha la tarea «${t.title}»`}
                    >
                      {t.status === "hecha"
                        ? <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                        : <Circle className="h-5 w-5 text-muted-foreground" aria-hidden="true" />}
                    </button>
                  ) : t.status === "hecha" ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" aria-label="Hecha" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground" aria-label="Pendiente" />
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className={cn("font-medium text-foreground break-words", t.status === "hecha" && "text-muted-foreground line-through")}>{t.title}</p>
                    {t.description && <p className="text-sm text-muted-foreground whitespace-pre-line break-words">{t.description}</p>}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className={cn("rounded px-1.5 py-0.5 font-medium", PRIORITY_CLASSES[t.priority])}>Prioridad {TASK_PRIORITY_LABELS[t.priority].toLowerCase()}</span>
                      {t.dueDate ? (
                        late ? (
                          <span className="inline-flex items-center gap-1 font-semibold text-red-700 dark:text-red-300">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> Vencida · {fmtDate(t.dueDate)}
                          </span>
                        ) : (
                          <span className={cn("inline-flex items-center gap-1", dueToday && "font-semibold text-amber-800 dark:text-amber-300")}>
                            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> {dueToday ? "Vence hoy" : `Vence el ${fmtDate(t.dueDate)}`}
                          </span>
                        )
                      ) : (
                        <span>Sin fecha</span>
                      )}
                      <span>Responsable: {t.assigneeName ?? "sin asignar"}</span>
                      {t.entityType && (
                        href && t.entityLabel !== null ? (
                          <Link href={href} className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline">
                            <Link2 className="h-3.5 w-3.5" aria-hidden="true" /> {TASK_ENTITY_LABELS[t.entityType]}: {t.entityLabel}
                          </Link>
                        ) : (
                          <span>{TASK_ENTITY_LABELS[t.entityType]} eliminado</span>
                        )
                      )}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex gap-1 self-end sm:self-start">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(t)} aria-label={`Editar la tarea «${t.title}»`}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(t)} aria-label={`Eliminar la tarea «${t.title}»`} className="text-destructive hover:text-destructive">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {tasks.data && tasks.data.total > rows.length && (
          <p className="text-sm text-muted-foreground">Se muestran {rows.length} de {tasks.data.total} tareas. Usa los filtros para acotar.</p>
        )}
      </div>

      <Dialog open={editing !== undefined} onOpenChange={(o) => !o && setEditing(undefined)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar tarea" : "Nueva tarea"}</DialogTitle>
            <DialogDescription>Es un recordatorio interno: no se envía nada al cliente.</DialogDescription>
          </DialogHeader>
          {editing !== undefined && <TaskForm task={editing} presetEntity={entityFilter} onClose={() => setEditing(undefined)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>¿Eliminar la tarea?</DialogTitle>
            <DialogDescription>{deleting ? `«${deleting.title}» se borrará. Esta acción no se puede deshacer.` : ""}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button type="button" variant="destructive" disabled={del.isPending} onClick={() => deleting && del.mutate({ id: deleting.id })}>Eliminar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
