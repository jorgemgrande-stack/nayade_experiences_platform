/**
 * Fidelización y puntos — Comunidades (Social Token Net Complete: comunidades y tokens internos a la vez). Solo se
 * muestra con la integración activa:
 *  - Reglas de puntos por participar (unirse, publicar, comentar, reaccionar, responder encuestas, proponer y apoyar),
 *    con límite por persona y periodo, comunidad concreta o todas, y retirada al ocultar o rechazar el contenido.
 *  - Estadísticas unificadas: participación y puntos emitidos, retirados y canjeados por comunidad, y los miembros con
 *    más participación y más puntos.
 *  - Recuperación: procesa los hechos de comunidad que no llegaron a premiarse al momento (idempotente).
 * Las comunidades de un cliente se ven en su monedero (WalletCommunities).
 */
import { useState } from "react";
import { Link } from "wouter";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { Pencil, Plus, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { toastError } from "@/lib/errorMessage";
import { LIMIT_PERIODS, LIMIT_PERIOD_LABELS, type LimitPeriod } from "@shared/loyalty";
import { MEMBER_ROLE_LABELS, MEMBER_STATUS_LABELS, type MemberRole, type MemberStatus } from "@shared/communities";
import { COMMUNITY_REWARD_EVENTS, COMMUNITY_REWARD_EVENT_LABELS, isRevocableEvent, type CommunityRewardEvent } from "@shared/stnComplete";

type Out = inferRouterOutputs<AppRouter>["socialNet"];
type Rule = Out["rules"][number];

const fmtN = (v: number) => v.toLocaleString("es-ES");
const fmtDate = (ms: number) => new Intl.DateTimeFormat("es-ES", { dateStyle: "medium" }).format(new Date(ms));
const toDateInput = (ms: number | null) => (ms == null ? "" : new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10));
const fromDateInput = (s: string, end: boolean) => (s ? new Date(`${s}T${end ? "23:59:59" : "00:00:00"}`).getTime() : null);
const intOrNull = (s: string) => (s.trim() === "" ? null : Number.parseInt(s, 10));

function RuleDialog({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const communities = trpc.socialNet.communities.useQuery();
  const [name, setName] = useState(rule?.name ?? "");
  const [eventType, setEventType] = useState<CommunityRewardEvent>(rule?.eventType ?? "member.posted");
  const [communityId, setCommunityId] = useState<number | null>(rule?.communityId ?? null);
  const [points, setPoints] = useState(rule?.points?.toString() ?? "10");
  const [limitCount, setLimitCount] = useState(rule?.limitCount?.toString() ?? "");
  const [limitPeriod, setLimitPeriod] = useState<LimitPeriod | "">(rule?.limitPeriod ?? "");
  const [revoke, setRevoke] = useState(rule?.revokeHidden ?? true);
  const [priority, setPriority] = useState(rule?.priority?.toString() ?? "0");
  const [active, setActive] = useState(rule?.active ?? true);
  const [startsAt, setStartsAt] = useState(toDateInput(rule?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDateInput(rule?.endsAt ?? null));
  const save = trpc.socialNet.saveRule.useMutation({
    onSuccess: () => {
      toast.success("Regla guardada");
      utils.socialNet.invalidate();
      onClose();
    },
    onError: (e) => toastError(e),
  });
  const pointsN = intOrNull(points);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{rule ? "Editar regla de participación" : "Nueva regla de participación"}</DialogTitle>
          <DialogDescription>Puntos fijos cada vez que un miembro participa. Cada hecho da puntos una sola vez, aunque se repita. Las reglas nuevas no premian la actividad anterior.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField id="cr-name" label="Nombre" required>
            <Input id="cr-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Publicar en el club" />
          </FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField id="cr-event" label="Se gana al">
              <select id="cr-event" className={selectClass} value={eventType} onChange={(e) => setEventType(e.target.value as CommunityRewardEvent)}>
                {COMMUNITY_REWARD_EVENTS.map((t) => <option key={t} value={t}>{COMMUNITY_REWARD_EVENT_LABELS[t]}</option>)}
              </select>
            </FormField>
            <FormField id="cr-comm" label="Comunidad">
              <select id="cr-comm" className={selectClass} value={communityId ?? ""} onChange={(e) => setCommunityId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Todas las comunidades</option>
                {(communities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === "archived" ? " (archivada)" : ""}</option>)}
              </select>
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="cr-points" label="Puntos" required>
              <Input id="cr-points" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} />
            </FormField>
            <FormField id="cr-lc" label="Veces por persona" hint="Vacío: sin límite">
              <Input id="cr-lc" inputMode="numeric" value={limitCount} onChange={(e) => setLimitCount(e.target.value)} />
            </FormField>
            <FormField id="cr-lp" label="Periodo del límite">
              <select id="cr-lp" className={selectClass} value={limitPeriod} onChange={(e) => setLimitPeriod(e.target.value as LimitPeriod | "")}>
                <option value="">—</option>
                {LIMIT_PERIODS.map((p) => <option key={p} value={p}>{LIMIT_PERIOD_LABELS[p]}</option>)}
              </select>
            </FormField>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField id="cr-prio" label="Prioridad">
              <Input id="cr-prio" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
            </FormField>
            <FormField id="cr-from" label="Desde">
              <Input id="cr-from" type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </FormField>
            <FormField id="cr-to" label="Hasta">
              <Input id="cr-to" type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </FormField>
          </div>
          {isRevocableEvent(eventType) && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={revoke} onChange={(e) => setRevoke(e.target.checked)} className="h-4 w-4" />
              Retirar los puntos si el contenido se oculta o se rechaza
            </label>
          )}
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-4 w-4" /> Activa
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button
            disabled={save.isPending || name.trim().length < 2 || !pointsN || pointsN <= 0}
            onClick={() => save.mutate({
              id: rule?.id ?? null,
              rule: {
                name: name.trim(), eventType, communityId, points: pointsN!, limitCount: intOrNull(limitCount), limitPeriod: limitPeriod || null, revokeHidden: revoke,
                priority: intOrNull(priority) ?? 0, active, startsAt: fromDateInput(startsAt, false), endsAt: fromDateInput(endsAt, true),
              },
            })}
          >
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Rules({ canManage, pointsName }: { canManage: boolean; pointsName: string }) {
  const q = trpc.socialNet.rules.useQuery();
  const communities = trpc.socialNet.communities.useQuery();
  const [editing, setEditing] = useState<Rule | null | "new">(null);
  const communityName = (id: number | null) => (id == null ? "todas las comunidades" : communities.data?.find((c) => c.id === id)?.name ?? `comunidad ${id}`);
  return (
    <section className="space-y-3" aria-labelledby="stn-rules">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="stn-rules" className="text-lg font-semibold text-foreground">Puntos por participar</h2>
        {canManage && <Button onClick={() => setEditing("new")}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Nueva regla</Button>}
      </div>
      {q.isLoading ? <PanelLoading /> : q.isError || !q.data ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <PanelEmpty icon={<Users className="h-5 w-5" />} title="Sin reglas de participación" description="Crea una regla, por ejemplo «10 puntos por publicar, máximo 3 al día», para premiar a los miembros que participan." />
      ) : (
        <ul className="space-y-2">
          {q.data.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <p className="font-medium text-foreground">{r.name} {!r.active && <span className="text-xs text-muted-foreground">(inactiva)</span>}</p>
                <p className="text-sm text-muted-foreground">
                  {[COMMUNITY_REWARD_EVENT_LABELS[r.eventType] ?? r.eventType, `${fmtN(r.points)} ${pointsName}`, communityName(r.communityId),
                    r.limitCount && r.limitPeriod ? `${r.limitCount} ${LIMIT_PERIOD_LABELS[r.limitPeriod]} por persona` : null,
                    isRevocableEvent(r.eventType) ? (r.revokeHidden ? "se retiran al ocultar o rechazar" : "no se retiran") : null,
                    `prioridad ${r.priority}`, r.startsAt || r.endsAt ? `${r.startsAt ? fmtDate(r.startsAt) : "…"} – ${r.endsAt ? fmtDate(r.endsAt) : "…"}` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              {canManage && <Button size="sm" variant="outline" onClick={() => setEditing(r)}><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" /> Editar</Button>}
            </li>
          ))}
        </ul>
      )}
      {editing && <RuleDialog rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function Stats({ pointsName }: { pointsName: string }) {
  const q = trpc.socialNet.stats.useQuery();
  return (
    <section className="space-y-3" aria-labelledby="stn-stats">
      <h2 id="stn-stats" className="text-lg font-semibold text-foreground">Participación y puntos por comunidad</h2>
      {q.isLoading ? <PanelLoading /> : q.isError || !q.data ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : q.data.length === 0 ? (
        <PanelEmpty icon={<Users className="h-5 w-5" />} title="Sin comunidades" description="Crea una comunidad en Comunidades para ver aquí su participación y sus puntos." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <caption className="sr-only">Participación y puntos ({pointsName}) por comunidad</caption>
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th scope="col" className="px-3 py-2 font-medium">Comunidad</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Miembros</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Participación (30 días)</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Emitidos</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Retirados</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Extra de campañas</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Canjeados por miembros</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Canjes exclusivos</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.communityId} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/admin/comunidades/${c.communityId}`} className="font-medium text-foreground underline-offset-2 hover:underline">{c.name}</Link>
                    {c.status === "archived" && <span className="ml-1 text-xs text-muted-foreground">(archivada)</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{fmtN(c.activeMembers)}</td>
                  <td className="px-3 py-2 text-right">{fmtN(c.participation)} <span className="text-xs text-muted-foreground">({fmtN(c.participation30)})</span></td>
                  <td className="px-3 py-2 text-right">{fmtN(c.pointsIssued)}</td>
                  <td className="px-3 py-2 text-right">{fmtN(c.pointsRevoked)}</td>
                  <td className="px-3 py-2 text-right">{fmtN(c.campaignPoints)}</td>
                  <td className="px-3 py-2 text-right">{fmtN(c.memberRedeemed)}</td>
                  <td className="px-3 py-2 text-right">{fmtN(c.exclusiveRedemptions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">«Canjeados por miembros» suma los canjes de los miembros activos (un cliente en varias comunidades cuenta en cada una).</p>
    </section>
  );
}

function TopMembers({ onOpenWallet }: { onOpenWallet: (clientId: number) => void }) {
  const communities = trpc.socialNet.communities.useQuery();
  const [communityId, setCommunityId] = useState<number | null>(null);
  const q = trpc.socialNet.topMembers.useQuery({ communityId, limit: 10 });
  const list = (title: string, items: NonNullable<typeof q.data>["byPoints"], metric: "participation" | "points") => (
    <div className="rounded-xl border border-border bg-card p-3">
      <h3 className="mb-2 font-medium text-foreground">{title}</h3>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">Todavía no hay datos.</p> : (
        <ol className="space-y-1 text-sm">
          {items.map((m, i) => (
            <li key={`${m.userId ?? "c"}-${m.clientId ?? i}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <span className="mr-1.5 text-muted-foreground">{i + 1}.</span>
                {m.clientId ? <button type="button" className="font-medium text-foreground underline-offset-2 hover:underline" onClick={() => onOpenWallet(m.clientId!)}>{m.name}</button> : <span className="font-medium text-foreground">{m.name}</span>}
              </span>
              <span className="shrink-0 text-muted-foreground">{metric === "participation" ? `${fmtN(m.participation)} aportaciones · ${fmtN(m.points)} puntos` : `${fmtN(m.points)} puntos${m.balance != null ? ` · saldo ${fmtN(m.balance)}` : ""}`}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
  return (
    <section className="space-y-3" aria-labelledby="stn-top">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h2 id="stn-top" className="text-lg font-semibold text-foreground">Miembros destacados</h2>
        <select aria-label="Comunidad de la clasificación" className={`${selectClass} w-auto`} value={communityId ?? ""} onChange={(e) => setCommunityId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Todas las comunidades</option>
          {(communities.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {q.isLoading ? <PanelLoading /> : q.isError || !q.data ? <PanelError error={q.error} onRetry={() => q.refetch()} /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {list("Por participación", q.data.byParticipation, "participation")}
          {list("Por puntos ganados participando", q.data.byPoints, "points")}
        </div>
      )}
    </section>
  );
}

export function CommunityLoyalty({ canManage, pointsName, onOpenWallet }: { canManage: boolean; pointsName: string; onOpenWallet: (clientId: number) => void }) {
  const utils = trpc.useUtils();
  const catchUp = trpc.socialNet.catchUp.useMutation({
    onSuccess: (r) => {
      toast.success(r.processed ? `Recuperación hecha: ${fmtN(r.granted)} premiados y ${fmtN(r.revoked)} retirados` : "No había nada pendiente");
      utils.socialNet.invalidate();
      utils.loyalty.invalidate();
    },
    onError: (e) => toastError(e),
  });
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-3xl text-sm text-muted-foreground">
          Social Token Net Complete: la participación en tus comunidades da puntos del mismo programa, las campañas pueden dirigirse a los miembros de una comunidad y
          las recompensas pueden reservarse a sus miembros.
        </p>
        {canManage && (
          <Button variant="outline" disabled={catchUp.isPending} onClick={() => catchUp.mutate()}>
            <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden="true" /> Recuperar participación pendiente
          </Button>
        )}
      </div>
      <Rules canManage={canManage} pointsName={pointsName} />
      <Stats pointsName={pointsName} />
      <TopMembers onOpenWallet={onOpenWallet} />
    </div>
  );
}

/** Comunidades del cliente en su monedero (con lo ganado participando en cada una). */
export function WalletCommunities({ clientId }: { clientId: number }) {
  const q = trpc.socialNet.walletCommunities.useQuery({ clientId });
  if (q.isLoading) return <PanelLoading label="Cargando sus comunidades…" />;
  if (q.isError || !q.data) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div className="rounded-xl border border-border p-3">
      <h3 className="mb-1.5 text-sm font-medium text-foreground">Comunidades</h3>
      {q.data.length === 0 ? <p className="text-sm text-muted-foreground">No es miembro de ninguna comunidad.</p> : (
        <ul className="space-y-1 text-sm">
          {q.data.map((c) => (
            <li key={c.communityId} className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/admin/comunidades/${c.communityId}`} className="font-medium text-foreground underline-offset-2 hover:underline">{c.name}</Link>
              <span className="text-muted-foreground">{[MEMBER_ROLE_LABELS[c.role as MemberRole] ?? c.role, MEMBER_STATUS_LABELS[c.status as MemberStatus] ?? c.status, `${fmtN(c.points)} puntos por participar`].join(" · ")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
