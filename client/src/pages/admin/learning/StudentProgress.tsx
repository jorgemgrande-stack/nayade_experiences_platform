/**
 * Elephant Learning · progreso de alumnos (lote 4): lecciones completadas y última actividad por persona matriculada. Solo lectura.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";

const fmt = (ms: number | null) => (ms ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }).format(new Date(ms)) : "Sin actividad");
const STATUS_ES: Record<string, string> = { active: "Activa", suspended: "Suspendida", revoked: "Revocada", expired: "Caducada" };

function Learners({ courseId }: { courseId: number }) {
  const q = trpc.learning.admin.progress.useQuery({ courseId });
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const { lessonsTotal, learners } = q.data!;
  if (!learners.length) return <PanelEmpty title="Nadie matriculado" description="Cuando una persona tenga matrícula en este curso verás aquí su avance." />;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {learners.map((l) => {
        const pct = lessonsTotal ? Math.round((l.completed / lessonsTotal) * 100) : 0;
        return (
          <li key={l.userId} className="grid gap-2 p-3 md:grid-cols-[1.4fr_1fr_1fr] md:items-center">
            <div className="min-w-0"><p className="truncate font-medium">{l.name ?? l.email ?? `Persona ${l.userId}`}</p>{l.name && l.email && <p className="truncate text-xs text-muted-foreground">{l.email}</p>}</div>
            <div className="space-y-1" aria-label={`Avance de ${l.name ?? l.email ?? l.userId}`}>
              <Progress value={pct} className="h-2" />
              <p className="text-xs text-muted-foreground">{l.completed} de {lessonsTotal} lecciones{l.inProgress ? ` · ${l.inProgress} en curso` : ""} ({pct}%)</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>Última actividad: {fmt(l.lastActivity)}</span><Badge variant="secondary">{STATUS_ES[l.status] ?? l.status}</Badge></div>
          </li>
        );
      })}
    </ul>
  );
}

export default function StudentProgress() {
  const courses = trpc.learning.admin.courses.useQuery();
  const [sel, setSel] = useState<number | null>(null);
  if (courses.isLoading) return <PanelLoading />;
  if (courses.isError) return <PanelError error={courses.error} onRetry={() => courses.refetch()} />;
  const list = courses.data ?? [];
  if (!list.length) return <PanelEmpty title="Sin cursos" description="Crea o importa un curso para ver el progreso de sus alumnos." />;
  const current = sel ?? list[0].id;
  return (
    <div className="space-y-3">
      <label className="block text-sm">Curso
        <select className="mt-1 block rounded-md border bg-background px-2 py-1.5" value={current} onChange={(e) => setSel(Number(e.target.value))}>
          {list.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </label>
      <Learners courseId={current} />
    </div>
  );
}
