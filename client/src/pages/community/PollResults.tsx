/**
 * Resultados de una encuesta de comunidad (agregados en el servidor): barras por opción, sí o no, escalas, orden,
 * intención de asistencia, «me apunto» y respuestas libres; con la puntuación de la comunidad. Lo usan el panel y el
 * área de miembros.
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { ATTENDANCE_LABELS, ATTENDANCE_VALUES } from "@shared/communityPolls";

export type PollResultsData = inferRouterOutputs<AppRouter>["communities"]["admin"]["polls"]["results"];

function Bar({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <li className="space-y-1">
      <div className="flex justify-between gap-2 text-sm"><span className="min-w-0 break-words">{label}</span><span className="shrink-0 tabular-nums text-muted-foreground">{value}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" aria-hidden="true">
        <div className="h-full rounded-full bg-teal-600" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </li>
  );
}

export function PollResultsView({ results, onModerate }: { results: PollResultsData; onModerate?: (valueId: number, patch: { hidden?: boolean; featured?: boolean }) => void }) {
  const r = results;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {r.totalResponses} {r.totalResponses === 1 ? "respuesta" : "respuestas"} de {r.totalAudience} {r.totalAudience === 1 ? "miembro" : "miembros"} · participación {r.participationRate} %
      </p>
      {(r.singleChoice || r.multiselect) && (
        <ul className="space-y-2">{(r.singleChoice ?? r.multiselect)!.map((o) => <Bar key={o.optionId} label={o.label} value={`${o.count} · ${o.percentage} %`} pct={o.percentage} />)}</ul>
      )}
      {r.yesNo && (
        <ul className="space-y-2">
          <Bar label="Sí" value={`${r.yesNo.yes} · ${r.yesNo.yesPercentage} %`} pct={r.yesNo.yesPercentage} />
          <Bar label="No" value={`${r.yesNo.no} · ${r.totalResponses ? 100 - r.yesNo.yesPercentage : 0} %`} pct={r.totalResponses ? 100 - r.yesNo.yesPercentage : 0} />
        </ul>
      )}
      {r.percentageScale && <ul className="space-y-2">{r.percentageScale.map((o) => <Bar key={o.optionId} label={o.label} value={`media ${o.average} / 100 (${o.count})`} pct={o.average} />)}</ul>}
      {r.scale15 && (
        <div className="space-y-2">
          <p className="text-sm">Media: <strong>{r.scale15.average}</strong> / 5</p>
          <ul className="space-y-2">{[5, 4, 3, 2, 1].map((v) => { const c = r.scale15!.distribution[v] ?? 0; const pct = r.totalResponses ? Math.round((c / r.totalResponses) * 100) : 0; return <Bar key={v} label={`${v}`} value={`${c}`} pct={pct} />; })}</ul>
        </div>
      )}
      {r.ranking && (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {r.ranking.map((o) => <li key={o.optionId}>{o.label} <span className="text-muted-foreground">· posición media {o.averageRank || "—"} · primera opción para {o.topChoiceCount}</span></li>)}
        </ol>
      )}
      {r.attendanceIntention && (
        <div className="space-y-2">
          <ul className="space-y-2">
            {[...ATTENDANCE_VALUES].reverse().map((v) => { const c = r.attendanceIntention!.breakdown[v] ?? 0; const pct = r.totalResponses ? Math.round((c / r.totalResponses) * 100) : 0; return <Bar key={v} label={ATTENDANCE_LABELS[v]} value={`${c}`} pct={pct} />; })}
          </ul>
          <p className="text-xs text-muted-foreground">Previsión orientativa: unas {r.attendanceIntention.predictedInterested} personas ({r.attendanceIntention.predictedStrongIntent} seguras).</p>
        </div>
      )}
      {r.meApunto && <p className="text-lg font-semibold">{r.meApunto.count} {r.meApunto.count === 1 ? "persona apuntada" : "personas apuntadas"}</p>}
      {r.openText && (
        r.openText.length === 0 ? <p className="text-sm text-muted-foreground">Sin respuestas todavía.</p> : (
          <ul className="space-y-2">
            {r.openText.map((t) => (
              <li key={t.id} className={`rounded-lg border p-2 text-sm ${t.featured ? "border-amber-400 bg-amber-50 dark:bg-amber-500/10" : "border-border"} ${t.hidden ? "opacity-60" : ""}`}>
                <p className="whitespace-pre-wrap break-words">{t.text}</p>
                {onModerate && (
                  <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                    <button type="button" className="hover:text-foreground" onClick={() => onModerate(t.id, { featured: !t.featured })}>{t.featured ? "Quitar destacado" : "Destacar"}</button>
                    <button type="button" className="hover:text-foreground" onClick={() => onModerate(t.id, { hidden: !t.hidden })}>{t.hidden ? "Volver a mostrar" : "Ocultar"}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )
      )}
      {!r.score.insufficientData && (
        <div className="rounded-lg border border-border p-3 text-sm">
          <p className="font-medium">Puntuación de la comunidad: {r.score.score} / 100</p>
          <p className="text-xs text-muted-foreground">{r.score.dimensions.map((d) => `${d.label} ${d.normalizedScore}`).join(" · ")}</p>
        </div>
      )}
    </div>
  );
}
