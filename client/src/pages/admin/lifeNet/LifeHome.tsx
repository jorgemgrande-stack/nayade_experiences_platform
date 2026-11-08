/**
 * Life Net · «Mi día» (/admin/net/life y el inicio del panel de un hogar): organización personal. Mis tareas abiertas
 * (vencidas primero) y mi agenda de los próximos 7 días; sin miembro vinculado, las del hogar. La primera vez, la
 * administración prepara el hogar (titular y nombre). Lo protege la licencia `life-net`; la página no concede nada.
 */
import { Link } from "wouter";
import { ArrowRight, CalendarDays, CheckCircle2, Home, ListTodo, Users } from "lucide-react";
import { toast } from "sonner";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { PanelEmpty, toastError } from "@/components/admin/PanelStates";
import { EVENT_KIND_LABELS } from "@shared/lifeNet";
import { LIFE_PATHS, LifeGate, MemberChips, PageHeader, TaskStateBadge, fmtDay, useLife } from "./LifeParts";

function Stat({ label, value, href }: { label: string; value: number; href: string }) {
  return (
    <Link href={href} className="min-w-0 rounded-xl border border-border bg-card p-4 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
    </Link>
  );
}

export default function LifeHome() {
  const { access, members, canWrite, isAdmin } = useLife();
  const utils = trpc.useUtils();
  const ov = trpc.lifeNet.overview.useQuery(undefined, { enabled: access.isSuccess, retry: false });
  const done = trpc.lifeNet.setTaskDone.useMutation({
    onSuccess: () => {
      toast.success("Tarea hecha");
      void utils.lifeNet.overview.invalidate();
      void utils.lifeNet.tasks.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const list = members.data ?? [];
  const d = ov.data;

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <LifeGate q={access}>
          <LifeGate q={ov}>
            {d && (
              <>
                <PageHeader
                  title={d.household.householdName}
                  description={`Mi día · ${fmtDay(d.today, true)}. Tus tareas y tu agenda, y lo que tiene pendiente el hogar.`}
                  actions={
                    canWrite ? (
                      <>
                        <Button asChild size="sm"><Link href={LIFE_PATHS.tasks}><ListTodo className="mr-1.5 h-4 w-4" aria-hidden="true" />Nueva tarea</Link></Button>
                        <Button asChild size="sm" variant="outline"><Link href={LIFE_PATHS.agenda}><CalendarDays className="mr-1.5 h-4 w-4" aria-hidden="true" />Agenda</Link></Button>
                      </>
                    ) : undefined
                  }
                />

                {!d.household.configured && isAdmin && (
                  <PanelEmpty icon={<Home className="h-5 w-5" />} title="Prepara tu hogar" description="Indica quién es la persona titular y el nombre del hogar, y añade a los miembros (hasta el cupo de tu plan).">
                    <Button asChild><Link href={LIFE_PATHS.members}>Preparar el hogar</Link></Button>
                  </PanelEmpty>
                )}

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Stat label="Tareas abiertas del hogar" value={d.counts.openTasks} href={LIFE_PATHS.tasks} />
                  <Stat label="Tareas vencidas" value={d.counts.overdueTasks} href={LIFE_PATHS.tracking} />
                  <Stat label={d.memberId ? "Mis actividades de hoy" : "Actividades de hoy"} value={d.counts.eventsToday} href={LIFE_PATHS.agenda} />
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <section aria-labelledby="life-mis-tareas" className="min-w-0 rounded-2xl border border-border bg-card p-5">
                    <h2 id="life-mis-tareas" className="font-semibold text-foreground">{d.memberId ? "Mis tareas" : "Tareas del hogar"}</h2>
                    {d.myTasks.length === 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">Nada pendiente. Cuando haya tareas para ti, aparecerán aquí.</p>
                    ) : (
                      <ul className="mt-3 divide-y divide-border">
                        {d.myTasks.map((t) => (
                          <li key={t.id} className="flex flex-wrap items-center gap-2 py-2.5">
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-sm font-medium text-foreground">{t.title}</p>
                              <p className="text-xs text-muted-foreground">{t.dueDate ? `Para el ${fmtDay(t.dueDate)}${t.dueTime ? `, ${t.dueTime}` : ""}` : "Sin fecha límite"}</p>
                              <div className="mt-1"><MemberChips ids={t.assigneeIds} members={list} /></div>
                            </div>
                            <TaskStateBadge state={t.state} />
                            {canWrite && (
                              <Button size="sm" variant="outline" disabled={done.isPending} onClick={() => done.mutate({ id: t.id, done: true })}>
                                <CheckCircle2 className="mr-1 h-4 w-4" aria-hidden="true" />Hecha
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link href={LIFE_PATHS.tasks} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
                      Todas las tareas <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </section>

                  <section aria-labelledby="life-mi-agenda" className="min-w-0 rounded-2xl border border-border bg-card p-5">
                    <h2 id="life-mi-agenda" className="font-semibold text-foreground">{d.memberId ? "Mi agenda: próximos 7 días" : "Agenda del hogar: próximos 7 días"}</h2>
                    {d.myEvents.length === 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">No hay actividades en los próximos días.</p>
                    ) : (
                      <ul className="mt-3 divide-y divide-border">
                        {d.myEvents.map((e) => (
                          <li key={e.id} className="py-2.5">
                            <p className="break-words text-sm font-medium text-foreground">{e.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {fmtDay(e.date)}{e.startTime ? `, ${e.startTime}${e.endTime ? `–${e.endTime}` : ""}` : " · todo el día"} · {EVENT_KIND_LABELS[e.kind]}
                              {e.location ? ` · ${e.location}` : ""}
                            </p>
                            <div className="mt-1"><MemberChips ids={e.memberIds} members={list} /></div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <Link href={LIFE_PATHS.agenda} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
                      Abrir la agenda <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </section>
                </div>

                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  {d.household.activeMembers} {d.household.activeMembers === 1 ? "miembro" : "miembros"}
                  {d.household.memberLimit !== null ? ` de ${d.household.memberLimit} incluidos` : ""}
                  <Link href={LIFE_PATHS.tracking} className="underline">Seguimiento por miembro</Link>
                  {isAdmin && <Link href={LIFE_PATHS.members} className="underline">Miembros y hogar</Link>}
                </p>
              </>
            )}
          </LifeGate>
        </LifeGate>
      </div>
    </AdminLayout>
  );
}
