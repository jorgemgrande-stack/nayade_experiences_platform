/**
 * Ski Net · Cursillos y grupos por niveles (/admin/ski/grupos): un turno (cursillo o escuelita, día y hora), su bolsa de
 * alumnos sin grupo, la propuesta de agrupación por nivel, edad e idioma (revisable antes de aplicarla) y los grupos del
 * turno con fusión y división.
 */
import { useState } from "react";
import { Combine, Split, Users, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { FormField, selectClass } from "@/components/admin/crm/CrmParts";
import { SkiSchoolShell, labelOf, todayIso, toastSki, type SkiCtx } from "@/components/ski/SkiSchoolShell";

const BAND_LABEL: Record<string, string> = { "3-5": "3 a 5 años", "6-8": "6 a 8 años", "9-12": "9 a 12 años", "13-17": "13 a 17 años", adultos: "18 o más", "sin-edad": "Edad sin indicar" };
type Turn = { siteId: string; productId: number; date: string; startTime: string };

function PoolForm({ ctx, turn }: { ctx: SkiCtx; turn: Turn }) {
  const utils = trpc.useUtils();
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [level, setLevel] = useState("");
  const [language, setLanguage] = useState("");
  const add = trpc.skiSchool.addToPool.useMutation({
    onSuccess: () => {
      toast.success("Alumno añadido a la bolsa");
      setName("");
      setAge("");
      utils.skiSchool.groupTurn.invalidate();
      utils.skiSchool.proposeGroups.invalidate();
    },
    onError: toastSki,
  });
  return (
    <form
      className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_6rem_10rem_10rem_auto] sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate({ ...turn, name, age: age.trim() === "" ? null : Number(age), level: level || null, language: language || null });
      }}
    >
      <FormField id="pl-name" label="Alumno" required>
        <Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
      </FormField>
      <FormField id="pl-age" label="Edad">
        <Input id="pl-age" type="number" min={0} max={120} value={age} onChange={(e) => setAge(e.target.value)} />
      </FormField>
      <FormField id="pl-level" label="Nivel">
        <select id="pl-level" className={selectClass} value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">Sin indicar</option>
          {ctx.config.levels.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id="pl-lang" label="Idioma">
        <select id="pl-lang" className={selectClass} value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="">Sin indicar</option>
          {ctx.config.languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </FormField>
      <Button type="submit" disabled={add.isPending}>
        Añadir
      </Button>
    </form>
  );
}

function Proposal({ ctx, turn }: { ctx: SkiCtx; turn: Turn }) {
  const utils = trpc.useUtils();
  const [asked, setAsked] = useState(false);
  const q = trpc.skiSchool.proposeGroups.useQuery(turn, { enabled: asked, retry: false });
  const apply = trpc.skiSchool.applyGroups.useMutation({
    onSuccess: (r) => {
      toast.success(`Grupos aplicados: ${r.placed} alumnos colocados, ${r.created} grupos nuevos`);
      setAsked(false);
      utils.skiSchool.invalidate();
    },
    onError: (e) => (toastSki(e), utils.skiSchool.proposeGroups.invalidate()),
  });
  return (
    <section className="space-y-2">
      <Button variant="outline" onClick={() => (setAsked(true), utils.skiSchool.proposeGroups.invalidate())}>
        <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
        Proponer grupos
      </Button>
      {asked && q.isLoading && <PanelLoading label="Calculando la propuesta…" />}
      {asked && q.error && <PanelError error={q.error} onRetry={() => q.refetch()} />}
      {asked && q.data && (
        <div className="space-y-2 rounded-xl border border-primary/40 bg-primary/5 p-4">
          {q.data.groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay alumnos pendientes de grupo en este turno.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {q.data.groups.map((g, i) => (
                <li key={i} className="break-words text-foreground">
                  <Badge variant={g.kind === "incorporate" ? "secondary" : "default"} className="mr-1.5">
                    {g.kind === "incorporate" ? `Al grupo #${g.sessionId}` : "Grupo nuevo"}
                  </Badge>
                  {labelOf(ctx.config.levels, g.level) ?? "Sin nivel"} · {BAND_LABEL[g.ageBand] ?? g.ageBand}
                  {g.language ? ` · ${labelOf(ctx.config.languages, g.language)}` : ""}: {g.names.join(", ")}
                </li>
              ))}
            </ul>
          )}
          {q.data.emptySessionIds.length > 0 && <p className="text-xs text-muted-foreground">Grupos sin alumnos en este turno: {q.data.emptySessionIds.map((id) => `#${id}`).join(", ")} (puedes cancelarlos o fusionarlos).</p>}
          {ctx.canWrite && q.data.groups.length > 0 && (
            <Button disabled={apply.isPending} onClick={() => apply.mutate({ ...turn, fingerprint: q.data!.fingerprint })}>
              Aplicar esta propuesta
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

function Groups({ ctx, turn }: { ctx: SkiCtx; turn: Turn }) {
  const utils = trpc.useUtils();
  const q = trpc.skiSchool.groupTurn.useQuery(turn);
  const [selected, setSelected] = useState<Record<number, number[]>>({});
  const [mergeTarget, setMergeTarget] = useState<Record<number, string>>({});
  const refresh = () => utils.skiSchool.invalidate();
  const cancel = trpc.skiSchool.cancelPoolEntry.useMutation({ onSuccess: refresh, onError: toastSki });
  const merge = trpc.skiSchool.mergeGroups.useMutation({ onSuccess: (r) => (toast.success(`Grupos fusionados: ${r.moved} alumnos movidos`), refresh()), onError: toastSki });
  const split = trpc.skiSchool.splitGroup.useMutation({ onSuccess: (r) => (toast.success(`Grupo dividido: ${r.moved} alumnos al grupo #${r.newSessionId}`), setSelected({}), refresh()), onError: toastSki });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const v = q.data!;
  const pending = v.pool.filter((p) => p.status === "pending");
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">
          Bolsa del turno ({pending.length} sin grupo) · aforo por grupo {v.product.capacity}
        </h2>
        {ctx.canWrite && <PoolForm ctx={ctx} turn={turn} />}
        {pending.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border text-sm">
            {pending.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0 break-words text-foreground">
                  {p.name}
                  {p.age != null ? ` · ${p.age} años` : ""} · {labelOf(ctx.config.levels, p.level) ?? "sin nivel"}
                  {p.language ? ` · ${labelOf(ctx.config.languages, p.language)}` : ""}
                </span>
                {ctx.canWrite && (
                  <Button size="sm" variant="ghost" onClick={() => cancel.mutate({ siteId: turn.siteId, entryId: p.id })}>
                    Quitar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Proposal ctx={ctx} turn={turn} />
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-foreground">Grupos del turno</h2>
        {v.sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay grupos en este turno: añade alumnos a la bolsa y propón los grupos.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {v.sessions.map((s) => {
              const sel = selected[s.id] ?? [];
              const others = v.sessions.filter((o) => o.id !== s.id);
              return (
                <div key={s.id} className="space-y-2 rounded-xl border border-border bg-card p-4">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-foreground">
                    <span>
                      Grupo #{s.id} · {labelOf(ctx.config.levels, s.level) ?? "sin nivel"}
                      {s.language ? ` · ${labelOf(ctx.config.languages, s.language)}` : ""}
                    </span>
                    <Badge variant="outline">
                      {s.participants.length}/{s.capacity}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">{s.instructorName ?? "Sin profesor"}</p>
                  <ul className="space-y-1 text-sm">
                    {s.participants.map((p) => (
                      <li key={p.id}>
                        <label className="flex items-center gap-2 text-foreground">
                          {ctx.canWrite && (
                            <input
                              type="checkbox"
                              checked={sel.includes(p.id)}
                              onChange={(e) => setSelected({ ...selected, [s.id]: e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id) })}
                            />
                          )}
                          <span className="break-words">
                            {p.name}
                            {p.age != null ? ` (${p.age})` : ""}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {ctx.canWrite && (
                    <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                      <Button size="sm" variant="outline" disabled={!sel.length || split.isPending} onClick={() => split.mutate({ siteId: turn.siteId, sessionId: s.id, participantIds: sel })}>
                        <Split className="mr-1 h-4 w-4" aria-hidden="true" />
                        Dividir ({sel.length})
                      </Button>
                      {others.length > 0 && (
                        <>
                          <select aria-label="Fusionar con" className={`${selectClass} w-36`} value={mergeTarget[s.id] ?? ""} onChange={(e) => setMergeTarget({ ...mergeTarget, [s.id]: e.target.value })}>
                            <option value="">Fusionar en…</option>
                            {others.map((o) => (
                              <option key={o.id} value={o.id}>
                                Grupo #{o.id}
                              </option>
                            ))}
                          </select>
                          <Button size="sm" variant="outline" disabled={!mergeTarget[s.id] || merge.isPending} onClick={() => merge.mutate({ siteId: turn.siteId, targetId: Number(mergeTarget[s.id]), sourceId: s.id })}>
                            <Combine className="mr-1 h-4 w-4" aria-hidden="true" />
                            Fusionar
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function Body({ ctx }: { ctx: SkiCtx }) {
  const products = trpc.skiSchool.listProducts.useQuery({ siteId: ctx.siteId });
  const collective = (products.data ?? []).filter((p) => p.active && p.kind !== "private");
  const [productId, setProductId] = useState<number | null>(null);
  const [date, setDate] = useState(todayIso());
  const [startTime, setStartTime] = useState(ctx.config.dayStart);
  if (products.isLoading) return <PanelLoading />;
  if (products.error) return <PanelError error={products.error} onRetry={() => products.refetch()} />;
  if (!collective.length)
    return <PanelEmpty icon={<Users className="h-5 w-5" />} title="Crea primero un cursillo o una escuelita" description="La agrupación por niveles es para productos docentes colectivos. Créalos en «Productos docentes»." />;
  const pid = productId ?? collective[0].id;
  const turn: Turn = { siteId: ctx.siteId, productId: pid, date, startTime };
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="gr-prod" label="Cursillo o escuelita">
          <select id="gr-prod" className={selectClass} value={pid} onChange={(e) => setProductId(Number(e.target.value))}>
            {collective.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField id="gr-date" label="Día">
          <Input id="gr-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </FormField>
        <FormField id="gr-time" label="Hora">
          <Input id="gr-time" type="time" value={startTime} onChange={(e) => e.target.value && setStartTime(e.target.value)} />
        </FormField>
      </div>
      <Groups ctx={ctx} turn={turn} />
    </div>
  );
}

export default function SkiGroups() {
  return (
    <SkiSchoolShell title="Cursillos y grupos" description="Reparte a los alumnos de un turno en grupos por nivel, edad e idioma, revisa la propuesta antes de aplicarla y fusiona o divide grupos.">
      {(ctx) => <Body ctx={ctx} />}
    </SkiSchoolShell>
  );
}
