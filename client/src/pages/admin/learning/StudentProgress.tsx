/**
 * Elephant Learning · progreso de alumnos (lote 4): lecciones completadas y última actividad por persona matriculada. Solo lectura.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { useI18n } from "@/i18n/I18nProvider";


function Learners({ courseId }: { courseId: number }) {
  const { t, format } = useI18n();
  const fmt = (ms: number | null) => (ms ? format.dateTime(ms, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" }) : t("learningManage.progress.noActivity"));
  const q = trpc.learning.admin.progress.useQuery({ courseId });
  if (q.isLoading) return <PanelLoading />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const { lessonsTotal, learners } = q.data!;
  if (!learners.length) return <PanelEmpty title={t("learningManage.progress.nobodyTitle")} description={t("learningManage.progress.nobodyDesc")} />;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {learners.map((l) => {
        const pct = lessonsTotal ? Math.round((l.completed / lessonsTotal) * 100) : 0;
        return (
          <li key={l.userId} className="grid gap-2 p-3 md:grid-cols-[1.4fr_1fr_1fr] md:items-center">
            <div className="min-w-0"><p className="truncate font-medium">{l.name ?? l.email ?? t("learningManage.progress.person", { id: l.userId })}</p>{l.name && l.email && <p className="truncate text-xs text-muted-foreground">{l.email}</p>}</div>
            <div className="space-y-1" aria-label={t("learningManage.progress.progressOf", { name: l.name ?? l.email ?? l.userId })}>
              <Progress value={pct} className="h-2" />
              <p className="text-xs text-muted-foreground">{t("learningManage.progress.summary", { done: l.completed, total: lessonsTotal, inProgress: l.inProgress ? t("learningManage.progress.inProgress", { n: l.inProgress }) : "", pct })}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{t("learningManage.progress.lastActivity", { date: fmt(l.lastActivity) })}</span><Badge variant="secondary">{l.status === "active" ? t("learningManage.progress.status.active") : l.status === "suspended" ? t("learningManage.progress.status.suspended") : l.status === "revoked" ? t("learningManage.progress.status.revoked") : l.status === "expired" ? t("learningManage.progress.status.expired") : l.status}</Badge></div>
          </li>
        );
      })}
    </ul>
  );
}

export default function StudentProgress() {
  const { t } = useI18n();
  const courses = trpc.learning.admin.courses.useQuery();
  const [sel, setSel] = useState<number | null>(null);
  if (courses.isLoading) return <PanelLoading />;
  if (courses.isError) return <PanelError error={courses.error} onRetry={() => courses.refetch()} />;
  const list = courses.data ?? [];
  if (!list.length) return <PanelEmpty title={t("learningManage.progress.noCoursesTitle")} description={t("learningManage.progress.noCoursesDesc")} />;
  const current = sel ?? list[0].id;
  return (
    <div className="space-y-3">
      <label className="block text-sm">{t("learningManage.progress.course")}
        <select className="mt-1 block rounded-md border bg-background px-2 py-1.5" value={current} onChange={(e) => setSel(Number(e.target.value))}>
          {list.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </label>
      <Learners courseId={current} />
    </div>
  );
}
