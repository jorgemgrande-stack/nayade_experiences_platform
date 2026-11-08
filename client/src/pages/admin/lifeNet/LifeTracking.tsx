/**
 * Life Net · Seguimiento (/admin/life/seguimiento): por cada miembro del hogar, sus tareas pendientes, vencidas y hechas
 * (hechas en los últimos 30 días) y sus actividades próximas y recientes; y las últimas tareas hechas con quién y cuándo.
 */
import { Link } from "wouter";
import { BarChart3 } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { TONE_TEXT } from "@/lib/panelTones";
import { RELATIONSHIP_LABELS } from "@shared/lifeNet";
import { LIFE_PATHS, LifeGate, MemberChip, PageHeader, fmtMs, useLife } from "./LifeParts";

function Figure({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className={`text-xl font-semibold tabular-nums ${tone ?? "text-foreground"}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export default function LifeTracking() {
  const { access, isAdmin } = useLife();
  const tr = trpc.lifeNet.tracking.useQuery(undefined, { enabled: access.isSuccess, retry: false });
  const byId = new Map((tr.data?.members ?? []).map((m) => [m.id, m] as const));
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-5">
        <LifeGate q={access}>
          <PageHeader title="Seguimiento" description="Cómo va cada miembro del hogar con sus tareas y compromisos." />
          {tr.isLoading ? (
            <PanelLoading label="Cargando el seguimiento…" />
          ) : tr.isError ? (
            <PanelError error={tr.error} onRetry={() => tr.refetch()} />
          ) : (tr.data?.members ?? []).length === 0 ? (
            <PanelEmpty icon={<BarChart3 className="h-5 w-5" />} title="Aún no hay miembros" description="Añade a los miembros del hogar para ver su seguimiento.">
              {isAdmin && <Link href={LIFE_PATHS.members} className="text-sm font-medium text-primary underline">Miembros y hogar</Link>}
            </PanelEmpty>
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {tr.data!.members.map((m) => (
                  <li key={m.id} className="min-w-0 rounded-2xl border border-border bg-card p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <MemberChip m={m} />
                      <span className="text-xs text-muted-foreground">{RELATIONSHIP_LABELS[m.relationship]}{m.hasAccess ? " · con acceso" : " · sin acceso propio"}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      <Figure label="Pendientes" value={m.pending} />
                      <Figure label="Vencidas" value={m.overdue} tone={m.overdue ? TONE_TEXT.danger : undefined} />
                      <Figure label="Hechas (30 días)" value={m.done} tone={m.done ? TONE_TEXT.success : undefined} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {m.upcomingEvents} {m.upcomingEvents === 1 ? "actividad próxima" : "actividades próximas"} · {m.pastEvents} en los últimos 30 días
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-3 text-xs">
                      <Link href={LIFE_PATHS.tasks} className="text-primary underline-offset-4 hover:underline">Tareas</Link>
                      <Link href={LIFE_PATHS.agenda} className="text-primary underline-offset-4 hover:underline">Agenda</Link>
                    </div>
                  </li>
                ))}
              </ul>
              <section aria-labelledby="life-hechas" className="rounded-2xl border border-border bg-card p-5">
                <h2 id="life-hechas" className="font-semibold text-foreground">Últimas tareas hechas</h2>
                {tr.data!.recentDone.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">Aún no se ha marcado ninguna tarea como hecha.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {tr.data!.recentDone.map((t) => (
                      <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                        <span className="min-w-0 break-words text-foreground">{t.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {t.doneByMemberId && byId.get(t.doneByMemberId) ? `${byId.get(t.doneByMemberId)!.displayName} · ` : ""}
                          {fmtMs(t.doneAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </LifeGate>
      </div>
    </AdminLayout>
  );
}
