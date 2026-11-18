/**
 * Panel operativo del Inicio: solicitudes web, inscripciones, presupuestos sin cobrar, participantes, sesiones y
 * servicios pendientes (coreHome.operations, solo lectura). Cada fila lleva a la pantalla de siempre (CRM o
 * convocatorias del producto). Solo para administración y solo si la empresa tiene convocatorias o solicitudes web:
 * sin eso no se pinta nada (ni mientras carga). Las secciones vacías no se enseñan.
 */
import { Link } from "wouter";
import { ArrowRight, CalendarClock, CheckCircle2, ClipboardList, Inbox, Receipt, Users, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { TONE_BADGE } from "@/lib/panelTones";
import { formatEditionDates } from "@shared/editions";
import { languageNameEs } from "@shared/leadWebRequest";

const eur = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const dayFmt = new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
const sessionDay = (d: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? dayFmt.format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))) : d;
};

function Block({ id, title, total, icon: Icon, children }: { id: string; title: string; total: number; icon: typeof Inbox; children: React.ReactNode }) {
  return (
    <div className="min-w-0" aria-labelledby={id} role="group">
      <h3 id={id} className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <span className="flex-1">{title}</span>
        <span className={cn("min-w-[28px] h-6 px-2 rounded-full border text-xs font-semibold flex items-center justify-center", TONE_BADGE.info)}>{total}</span>
      </h3>
      <ul className="mt-1 divide-y divide-border">{children}</ul>
    </div>
  );
}

function Row({ href, main, detail, aside }: { href: string; main: React.ReactNode; detail?: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 py-2 text-sm hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
        <span className="min-w-0 flex-1">
          <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-foreground">{main}</span>
          {detail && <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted-foreground">{detail}</span>}
        </span>
        {aside && <span className="shrink-0 text-xs text-muted-foreground">{aside}</span>}
        <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
    </li>
  );
}

const more = (shown: number, total: number) => (total > shown ? <li className="py-2 text-xs text-muted-foreground">y {total - shown} más</li> : null);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function OperationalPanelCard({ enabled }: { enabled: boolean }) {
  const q = trpc.coreHome.operations.useQuery(undefined, { enabled, retry: 1, staleTime: 30_000, // Sin nada que mostrar (p. ej. una empresa sin convocatorias ni solicitudes web) no se vuelve a consultar
    refetchInterval: (query) => (query.state.data?.visible ? 120_000 : false), refetchIntervalInBackground: false });
  const p = q.data;
  // Sin convocatorias ni solicitudes web (o sin poder leerlo): ninguna tarjeta decorativa
  if (!enabled || !p?.visible) return null;
  const { webRequests: w, pendingEnrollments: pe, unpaidQuotes: uq, upcomingEditions: ue, upcomingSessions: us, pendingServices: ps } = p;
  return (
    <section aria-labelledby="home-operations" className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <h2 id="home-operations" className="font-semibold text-foreground">Solicitudes y convocatorias</h2>
      <p className="text-sm text-muted-foreground mt-0.5">Lo que entra por la web y lo que tienes que preparar. Cada fila abre su pantalla.</p>
      {p.allClear ? (
        <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
          Todo al día: no hay solicitudes nuevas, inscripciones por revisar ni sesiones en los próximos 30 días.
        </p>
      ) : (
        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          {w.total > 0 && (
            <Block id="ops-web" title="Solicitudes web nuevas" total={w.total} icon={Inbox}>
              {w.items.map((r) => (
                <Row
                  key={r.leadId}
                  href={r.href}
                  main={<>{r.name}{r.isTest && <span className="ml-1 text-xs text-muted-foreground">(prueba)</span>}</>}
                  detail={[r.sourceLabel, r.product, r.variant, r.edition, r.lang ? languageNameEs(r.lang) : null].filter(Boolean).join(" · ")}
                />
              ))}
              {more(w.items.length, w.total)}
            </Block>
          )}
          {pe.total > 0 && (
            <Block id="ops-enrollments" title="Inscripciones por revisar" total={pe.total} icon={ClipboardList}>
              {pe.items.map((r) => (
                <Row
                  key={r.editionId}
                  href={r.href}
                  main={`${r.productTitle} · ${r.editionLabel}`}
                  detail={[r.requested > 0 ? plural(r.requested, "solicitada", "solicitadas") : null, r.waitlisted > 0 ? `${r.waitlisted} en lista de espera` : null].filter(Boolean).join(" · ")}
                  aside={formatEditionDates(r.startsAt, null, r.timezone)}
                />
              ))}
            </Block>
          )}
          {uq.total > 0 && (
            <Block id="ops-quotes" title="Presupuestos de inscripción sin cobrar" total={uq.total} icon={Receipt}>
              {uq.items.map((r) => (
                <Row
                  key={r.enrollmentId}
                  href={r.href}
                  main={`${r.name} · ${r.quoteNumber}`}
                  detail={`${r.paymentLabel} · ${r.productTitle} · ${r.editionLabel}${r.enrollmentStatus === "confirmada" ? " · plaza ya confirmada" : ""}`}
                  aside={eur.format(r.total)}
                />
              ))}
              {more(uq.items.length, uq.total)}
            </Block>
          )}
          {ue.total > 0 && (
            <Block id="ops-editions" title="Próximas convocatorias" total={ue.total} icon={Users}>
              {ue.items.map((r) => (
                <Row
                  key={r.editionId}
                  href={r.href}
                  main={`${r.productTitle} · ${r.editionLabel}`}
                  detail={`${plural(r.participants, "participante confirmado", "participantes confirmados")}${r.capacity != null ? ` de ${r.capacity} plazas` : ""}${r.sessionCount > 0 ? ` · ${plural(r.sessionCount, "sesión", "sesiones")}` : ""}`}
                  aside={formatEditionDates(r.startsAt, null, r.timezone)}
                />
              ))}
              {more(ue.items.length, ue.total)}
            </Block>
          )}
          {us.total > 0 && (
            <Block id="ops-sessions" title="Sesiones de los próximos 30 días" total={us.total} icon={CalendarClock}>
              {us.items.map((r) => (
                <Row
                  key={r.sessionId}
                  href={r.href}
                  main={`${sessionDay(r.startsOn)} · ${r.timeLabel}`}
                  detail={`${r.productTitle} · ${r.editionLabel}${r.total > 0 ? ` · sesión ${r.index} de ${r.total}` : ""}`}
                  aside={plural(r.participants, "participante", "participantes")}
                />
              ))}
              {more(us.items.length, us.total)}
            </Block>
          )}
          {ps.total > 0 && (
            <Block id="ops-services" title="Servicios incluidos por programar" total={ps.total} icon={Wrench}>
              {ps.items.map((r) => (
                <Row
                  key={r.id}
                  href={r.href}
                  main={`${r.label}${r.durationMinutes ? ` (${r.durationMinutes} min)` : ""} · ${r.personName}`}
                  detail={`${r.productTitle} · ${r.editionLabel}`}
                />
              ))}
              {more(ps.items.length, ps.total)}
            </Block>
          )}
        </div>
      )}
    </section>
  );
}
