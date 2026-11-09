/**
 * Elephant Connect · SEO Control (/admin/marketing/seo): seguimiento SEO de la web de la empresa. Palabras clave con su
 * URL objetivo y sus posiciones (importadas de su Google Search Console o anotadas a mano), rendimiento por consulta y
 * página, auditoría on-page de sus páginas públicas, reseñas (propias de la web, Google Business Profile y
 * TripAdvisor) y un panel con evolución y alertas simples. Los conectores usan las credenciales de la empresa
 * (Integraciones): sin configurar, están desactivados. La autorización real (licencia `seo-control` y administración)
 * la aplica el servidor.
 */
import { useState } from "react";
import { AlertTriangle, Archive, ArchiveRestore, CloudDownload, ExternalLink, Pencil, Plus, RefreshCw, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { toastError } from "@/lib/errorMessage";
import {
  SEO_ALERT_LABELS,
  SEO_ISSUE_INFO,
  SEO_POSITION_SOURCE_LABELS,
  SEO_REVIEW_SOURCE_LABELS,
  type SeoIssue,
  type SeoPositionSource,
  type SeoReviewSource,
  type SeoSeverity,
} from "@shared/seoControl";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sectionClass = "space-y-4 rounded-xl border border-border bg-card p-4";
const ellipsis = "overflow-hidden text-ellipsis whitespace-nowrap";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const fmtPos = (n: number | null | undefined) => (n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const fmtNum = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("es-ES").format(n));
const pct = (r: number | null | undefined) => (r == null ? "—" : `${(r * 100).toFixed(1)} %`);
const SEVERITY_VARIANT: Record<SeoSeverity, "destructive" | "secondary" | "outline"> = { high: "destructive", medium: "secondary", low: "outline" };
const SEVERITY_LABEL: Record<SeoSeverity, string> = { high: "Alta", medium: "Media", low: "Baja" };

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Delta({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-muted-foreground">—</span>;
  if (delta === 0) return <span className="text-muted-foreground">=</span>;
  // Posición mayor = peor
  return delta > 0 ? <span className="text-red-600 dark:text-red-400">▼ {fmtPos(delta)}</span> : <span className="text-emerald-600 dark:text-emerald-400">▲ {fmtPos(-delta)}</span>;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

function Dashboard() {
  const [days, setDays] = useState(90);
  const q = trpc.seoControl.dashboard.useQuery({ days }, { retry: false });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const maxPos = Math.max(10, ...d.evolution.map((e) => e.averagePosition ?? 0));
  return (
    <div className="space-y-4">
      <label className="block max-w-xs space-y-1.5 text-sm font-medium text-foreground">
        <span>Periodo</span>
        <select className={selectClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>Últimos 30 días</option>
          <option value={90}>Últimos 90 días</option>
          <option value={180}>Últimos 6 meses</option>
          <option value={365}>Último año</option>
        </select>
      </label>
      <section className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Posición media" value={fmtPos(d.keywords.averagePosition)} hint={`${d.keywords.withPosition} de ${d.keywords.active} palabras clave con datos`} />
        <Kpi label="En el top 10" value={String(d.keywords.top10)} hint={`${d.keywords.top3} en el top 3`} />
        <Kpi label="Salud on-page" value={d.audit?.score == null ? "—" : `${d.audit.score}/100`} hint={d.audit ? `${d.audit.withIssues} de ${d.audit.pages} páginas con incidencias` : "Aún sin auditoría"} />
        <Kpi label="Valoración media" value={d.reviews.average == null ? "—" : `${d.reviews.average.toFixed(1)} ★`} hint={`${d.reviews.count} reseñas`} />
      </section>

      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">Alertas</h2>
        {d.alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin alertas: ninguna palabra clave ha caído de forma notable, las páginas auditadas se pueden indexar y no hay reseñas negativas recientes sin responder.</p>
        ) : (
          <ul className="space-y-2">
            {d.alerts.map((a, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{a.title}</span>
                    <Badge variant={SEVERITY_VARIANT[a.severity]}>{SEO_ALERT_LABELS[a.kind]}</Badge>
                  </div>
                  <p className="break-words text-muted-foreground">{a.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">Evolución semanal</h2>
        {d.evolution.length === 0 ? (
          <PanelEmpty icon={<Search className="h-5 w-5" />} title="Aún no hay posiciones en este periodo" description="Importa los datos de Search Console o anota posiciones a mano en «Palabras clave»." />
        ) : (
          <div className="space-y-2">
            {d.evolution.map((e) => (
              <div key={e.week} className="grid grid-cols-[6.5rem_1fr_9rem] items-center gap-3 text-sm">
                <span className="text-muted-foreground">{e.week}</span>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  {e.averagePosition != null && <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.round((1 - (e.averagePosition - 1) / maxPos) * 100))}%` }} />}
                </div>
                <span className="text-right text-foreground">
                  Pos. {fmtPos(e.averagePosition)} · {fmtNum(e.clicks)} clics
                </span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">Media semanal de la posición de tus palabras clave (barra más larga = mejor posición). Con Search Console es la posición media que informa Google.</p>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Palabras clave ───────────────────────────────────────────────────────────

type KeywordRow = { id: number; keyword: string; targetUrl: string | null; isArchived: boolean; latest: { observedOn: string; position: number | null; source: SeoPositionSource; clicks: number | null; impressions: number | null; rankingUrl: string | null } | null; delta: number | null };

function KeywordDialog({ editing, onClose }: { editing: KeywordRow | "new" | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [keyword, setKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [initFor, setInitFor] = useState<unknown>(null);
  if (editing !== initFor) {
    setInitFor(editing);
    setKeyword(editing && editing !== "new" ? editing.keyword : "");
    setTargetUrl(editing && editing !== "new" ? editing.targetUrl ?? "" : "");
  }
  const save = trpc.seoControl.upsertKeyword.useMutation({ onSuccess: () => (toast.success("Palabra clave guardada"), utils.seoControl.invalidate(), onClose()), onError: (e) => toastError(e) });
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing === "new" ? "Nueva palabra clave" : "Editar palabra clave"}</DialogTitle>
          <DialogDescription>Escríbela como la buscaría un cliente en Google. La URL objetivo es la página de tu web que quieres que aparezca.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm font-medium text-foreground">
            <span>Palabra clave *</span>
            <Input value={keyword} maxLength={150} onChange={(e) => setKeyword(e.target.value)} placeholder="Ej.: clases de esquí en Sierra Nevada" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-foreground">
            <span>URL objetivo</span>
            <Input value={targetUrl} maxLength={500} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://www.miempresa.es/servicio" />
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={keyword.trim().length < 2 || save.isPending} onClick={() => save.mutate({ id: editing && editing !== "new" ? editing.id : undefined, keyword, targetUrl: targetUrl || null })}>Guardar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PositionDialog({ k, onClose }: { k: KeywordRow | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [day, setDay] = useState(today());
  const [position, setPosition] = useState("");
  const [rankingUrl, setRankingUrl] = useState("");
  const [note, setNote] = useState("");
  const history = trpc.seoControl.keywordHistory.useQuery({ keywordId: k?.id ?? 0, days: 120 }, { enabled: !!k, retry: false });
  const save = trpc.seoControl.recordPosition.useMutation({
    onSuccess: () => (toast.success("Posición anotada"), setPosition(""), setNote(""), utils.seoControl.invalidate()),
    onError: (e) => toastError(e),
  });
  const pos = position.trim() === "" ? null : Number(position.replace(",", "."));
  const valid = pos == null || (Number.isFinite(pos) && pos >= 1 && pos <= 100);
  return (
    <Dialog open={!!k} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Posiciones de «{k?.keyword}»</DialogTitle>
          <DialogDescription>Anota la posición que ves en Google (en una ventana privada). Déjala vacía si no aparece en los primeros resultados.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            <span>Fecha</span>
            <Input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            <span>Posición (1-100)</span>
            <Input inputMode="decimal" value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Vacía = no aparece" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-foreground">
            <span>URL que aparece</span>
            <Input value={rankingUrl} maxLength={500} onChange={(e) => setRankingUrl(e.target.value)} placeholder="Opcional" />
          </label>
          <label className="space-y-1.5 text-sm font-medium text-foreground sm:col-span-3">
            <span>Nota</span>
            <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Opcional (ej.: búsqueda desde móvil)" />
          </label>
        </div>
        <div className="flex justify-end">
          <Button disabled={!valid || !k || save.isPending} onClick={() => k && save.mutate({ keywordId: k.id, observedOn: day, position: pos, rankingUrl: rankingUrl || null, note: note || null })}>
            Anotar posición
          </Button>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
          {history.isLoading ? (
            <PanelLoading />
          ) : !history.data?.points.length ? (
            <p className="p-3 text-sm text-muted-foreground">Aún no hay posiciones de esta palabra clave.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Fecha</th><th className="p-2">Posición</th><th className="p-2">Clics</th><th className="p-2">Impresiones</th><th className="p-2">Origen</th></tr>
              </thead>
              <tbody>
                {[...history.data.points].reverse().map((p) => (
                  <tr key={p.id} className="border-t border-border">
                    <td className="p-2">{p.observedOn}</td>
                    <td className="p-2 font-medium">{fmtPos(p.position)}</td>
                    <td className="p-2">{fmtNum(p.clicks)}</td>
                    <td className="p-2">{fmtNum(p.impressions)}</td>
                    <td className="p-2 text-xs text-muted-foreground">{SEO_POSITION_SOURCE_LABELS[p.source]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Keywords() {
  const utils = trpc.useUtils();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<KeywordRow | "new" | null>(null);
  const [positions, setPositions] = useState<KeywordRow | null>(null);
  const q = trpc.seoControl.keywords.useQuery({ includeArchived: showArchived }, { retry: false });
  const archive = trpc.seoControl.setKeywordArchived.useMutation({ onSuccess: () => utils.seoControl.invalidate(), onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const list = q.data as KeywordRow[];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Ver también las archivadas
        </label>
        <Button onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" /> Nueva palabra clave</Button>
      </div>
      {list.length === 0 ? (
        <PanelEmpty icon={<Search className="h-5 w-5" />} title="Aún no sigues ninguna palabra clave" description="Añade las búsquedas por las que quieres que te encuentren tus clientes y la página de tu web que debería aparecer." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Palabra clave</th>
                <th className="p-3">Posición</th>
                <th className="p-3">Cambio</th>
                <th className="p-3">Clics / impr.</th>
                <th className="p-3">Último dato</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {list.map((k) => (
                <tr key={k.id} className={`border-t border-border ${k.isArchived ? "opacity-60" : ""}`}>
                  <td className="max-w-[18rem] p-3">
                    <p className={`${ellipsis} font-medium text-foreground`} title={k.keyword}>{k.keyword}</p>
                    {k.targetUrl && <p className={`${ellipsis} text-xs text-muted-foreground`} title={k.targetUrl}>{k.targetUrl}</p>}
                  </td>
                  <td className="p-3 text-base font-semibold">{fmtPos(k.latest?.position)}</td>
                  <td className="p-3"><Delta delta={k.delta} /></td>
                  <td className="p-3">{k.latest?.source === "gsc" ? `${fmtNum(k.latest.clicks)} / ${fmtNum(k.latest.impressions)}` : "—"}</td>
                  <td className="p-3 text-xs text-muted-foreground">{k.latest ? `${k.latest.observedOn} · ${k.latest.source === "gsc" ? "Search Console" : "Manual"}` : "Sin datos"}</td>
                  <td className="whitespace-nowrap p-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => setPositions(k)} disabled={k.isArchived}>Posiciones</Button>
                    <Button size="icon" variant="ghost" aria-label="Editar" onClick={() => setEditing(k)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" aria-label={k.isArchived ? "Recuperar" : "Archivar"} onClick={() => archive.mutate({ id: k.id, archived: !k.isArchived })}>
                      {k.isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <KeywordDialog editing={editing} onClose={() => setEditing(null)} />
      <PositionDialog k={positions} onClose={() => setPositions(null)} />
    </div>
  );
}

// ─── Search Console ───────────────────────────────────────────────────────────

function SearchConsole() {
  const utils = trpc.useUtils();
  const [days, setDays] = useState(28);
  const [search, setSearch] = useState("");
  const conns = trpc.seoControl.connectors.useQuery(undefined, { retry: false });
  const perf = trpc.seoControl.searchPerformance.useQuery({ limit: 200, search: search || null }, { retry: false });
  const imp = trpc.seoControl.importSearchConsole.useMutation({
    onSuccess: (r) => {
      toast.success(`Importado: ${r.performanceRows} filas, ${r.keywordsUpdated} palabra(s) clave con datos`);
      for (const w of r.warnings.slice(0, 3)) toast.warning(w);
      utils.seoControl.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const gsc = conns.data?.find((c) => c.provider === "google_search_console");
  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">Google Search Console</h2>
            <p className="text-sm text-muted-foreground">{gsc?.detail ?? "Comprobando…"}</p>
            {gsc?.lastRun && <p className="text-xs text-muted-foreground">Última importación: {gsc.lastRun.status === "ok" ? gsc.lastRun.summary : gsc.lastRun.error ?? "en curso"}</p>}
          </div>
          {gsc?.state === "configured" ? (
            <div className="flex items-end gap-2">
              <select className={`${selectClass} w-40`} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Periodo a importar">
                <option value={7}>Últimos 7 días</option>
                <option value={28}>Últimos 28 días</option>
                <option value={90}>Últimos 90 días</option>
              </select>
              <Button onClick={() => imp.mutate({ days })} disabled={imp.isPending}>
                <CloudDownload className="mr-1 h-4 w-4" /> {imp.isPending ? "Importando…" : "Importar"}
              </Button>
            </div>
          ) : (
            <Button variant="outline" asChild><Link href="/admin/configuracion/integraciones">Configurar en Integraciones</Link></Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Search Console publica los datos con unos 3 días de retraso. La posición es la media ponderada por impresiones de tu web para esa búsqueda.</p>
      </section>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">Consultas y páginas{perf.data?.period ? ` (${perf.data.period.start} → ${perf.data.period.end})` : ""}</h2>
          <Input className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrar consultas" />
        </div>
        {perf.isLoading ? (
          <PanelLoading />
        ) : perf.error ? (
          <PanelError error={perf.error} onRetry={() => perf.refetch()} />
        ) : !perf.data?.rows.length ? (
          <p className="text-sm text-muted-foreground">Sin datos importados todavía.</p>
        ) : (
          <>
            {perf.data.totals && (
              <div className="grid gap-3 sm:grid-cols-4">
                <Kpi label="Clics" value={fmtNum(perf.data.totals.clicks)} />
                <Kpi label="Impresiones" value={fmtNum(perf.data.totals.impressions)} />
                <Kpi label="CTR" value={pct(perf.data.totals.ctr)} />
                <Kpi label="Posición media" value={fmtPos(perf.data.totals.position)} />
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[40rem] text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr><th className="p-2">Consulta</th><th className="p-2">Página</th><th className="p-2">Clics</th><th className="p-2">Impr.</th><th className="p-2">CTR</th><th className="p-2">Pos.</th></tr>
                </thead>
                <tbody>
                  {perf.data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="max-w-[14rem] p-2"><span className={`block ${ellipsis}`} title={r.query}>{r.query}</span></td>
                      <td className="max-w-[16rem] p-2 text-xs text-muted-foreground"><span className={`block ${ellipsis}`} title={r.page ?? ""}>{r.page ?? "—"}</span></td>
                      <td className="p-2">{fmtNum(r.clicks)}</td>
                      <td className="p-2">{fmtNum(r.impressions)}</td>
                      <td className="p-2">{pct(r.ctr)}</td>
                      <td className="p-2">{fmtPos(r.position)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ─── Auditoría ────────────────────────────────────────────────────────────────

function Audit() {
  const utils = trpc.useUtils();
  const q = trpc.seoControl.audit.useQuery(undefined, { retry: false });
  const domains = trpc.seoControl.domains.useQuery(undefined, { retry: false });
  const runAudit = trpc.seoControl.runAudit.useMutation({ onSuccess: () => (toast.success("Auditoría terminada"), utils.seoControl.invalidate()), onError: (e) => toastError(e) });
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  const hosts = domains.data?.hosts ?? [];
  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground">Auditoría on-page</h2>
            <p className="text-sm text-muted-foreground">
              Revisa la portada y las páginas de tu sitemap.xml (hasta 25): título, descripción, H1, canónica, si se pueden indexar, tamaño y enlaces internos rotos.
              {hosts.length ? ` Solo en ${hosts.join(", ")}.` : " Tu empresa aún no tiene una web pública con dominio."}
            </p>
            {a && <p className="text-xs text-muted-foreground">Última: {a.finishedAt?.slice(0, 16).replace("T", " ")} · {a.summary}</p>}
          </div>
          <Button onClick={() => runAudit.mutate({})} disabled={runAudit.isPending || !hosts.length}>
            <RefreshCw className={`mr-1 h-4 w-4 ${runAudit.isPending ? "animate-spin" : ""}`} /> {runAudit.isPending ? "Auditando… (hasta 1 min)" : "Auditar ahora"}
          </Button>
        </div>
      </section>
      {!a ? (
        <PanelEmpty icon={<Search className="h-5 w-5" />} title="Aún no hay auditorías" description="Pulsa «Auditar ahora» para revisar las páginas públicas de tu web." />
      ) : (
        <div className="space-y-2">
          <Kpi label="Salud on-page (orientativa)" value={a.score == null ? "—" : `${a.score}/100`} hint={`${a.pages.filter((p) => p.issues.length).length} de ${a.pages.length} páginas con incidencias`} />
          {a.pages.map((p) => (
            <div key={p.url} className="rounded-lg border border-border bg-card p-3 text-sm">
              <button type="button" className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === p.url ? null : p.url)}>
                <div className="min-w-0 flex-1">
                  <p className={`${ellipsis} font-medium text-foreground`} title={p.url}>{p.url}</p>
                  <p className={`${ellipsis} text-xs text-muted-foreground`}>{p.title ?? "(sin título)"}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {!p.indexable && <Badge variant="destructive">No indexable</Badge>}
                  {p.issues.length === 0 ? <Badge variant="outline">Correcta</Badge> : <Badge variant="secondary">{p.issues.length} incidencia(s)</Badge>}
                </div>
              </button>
              {open === p.url && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[9rem_1fr]">
                    <dt className="text-muted-foreground">Respuesta</dt><dd>{p.status || "—"}{p.error ? ` · ${p.error}` : ""}{p.finalUrl && p.finalUrl !== p.url ? ` → ${p.finalUrl}` : ""}</dd>
                    <dt className="text-muted-foreground">Título</dt><dd className="break-words">{p.title ?? "—"} {p.title ? `(${p.title.length})` : ""}</dd>
                    <dt className="text-muted-foreground">Descripción</dt><dd className="break-words">{p.metaDescription ?? "—"} {p.metaDescription ? `(${p.metaDescription.length})` : ""}</dd>
                    <dt className="text-muted-foreground">H1</dt><dd className="break-words">{p.h1 ?? "—"}{p.h1Count > 1 ? ` (+${p.h1Count - 1})` : ""}</dd>
                    <dt className="text-muted-foreground">Canónica</dt><dd className="break-words">{p.canonical ?? "—"}</dd>
                    <dt className="text-muted-foreground">Robots</dt><dd>{p.robots ?? "—"}</dd>
                    <dt className="text-muted-foreground">Tamaño / tiempo</dt><dd>{fmtNum(Math.round(p.sizeBytes / 1024))} KB · {fmtNum(p.loadMs)} ms</dd>
                  </dl>
                  {p.issues.length > 0 && (
                    <ul className="space-y-1">
                      {p.issues.map((i: SeoIssue) => (
                        <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                          <Badge variant={SEVERITY_VARIANT[SEO_ISSUE_INFO[i].severity]}>{SEVERITY_LABEL[SEO_ISSUE_INFO[i].severity]}</Badge>
                          <span className="font-medium">{SEO_ISSUE_INFO[i].label}:</span>
                          <span className="text-muted-foreground">{SEO_ISSUE_INFO[i].advice}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {p.brokenLinks.length > 0 && (
                    <div className="text-xs">
                      <p className="font-medium">Enlaces rotos:</p>
                      <ul className="list-disc pl-5 text-muted-foreground">{p.brokenLinks.map((l) => <li key={l} className="break-all">{l}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Reseñas ──────────────────────────────────────────────────────────────────

function Reviews() {
  const utils = trpc.useUtils();
  const q = trpc.seoControl.reviews.useQuery(undefined, { retry: false });
  const conns = trpc.seoControl.connectors.useQuery(undefined, { retry: false });
  const sync = trpc.seoControl.syncReviews.useMutation({ onSuccess: (r) => (toast.success(`${r.imported} reseña(s) leída(s)`), utils.seoControl.invalidate()), onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const ext: Array<{ source: SeoReviewSource; provider: string }> = [
    { source: "google", provider: "google_business_profile" },
    { source: "tripadvisor", provider: "tripadvisor" },
  ];
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-3">
        {(["core", "google", "tripadvisor"] as const).map((s) => {
          const sum = q.data!.summaries.find((x) => x.source === s);
          return <Kpi key={s} label={SEO_REVIEW_SOURCE_LABELS[s]} value={sum?.average == null ? "—" : `${sum.average.toFixed(1)} ★`} hint={sum ? `${sum.count} reseñas · ${sum.last30} en 30 días · ${sum.unanswered} sin responder` : "Sin datos"} />;
        })}
      </section>
      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">Fuentes externas</h2>
        <div className="space-y-2">
          {ext.map((e) => {
            const c = conns.data?.find((x) => x.provider === e.provider);
            return (
              <div key={e.source} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{SEO_REVIEW_SOURCE_LABELS[e.source]} {c?.state === "configured" ? <Badge variant="outline">Configurado</Badge> : <Badge variant="secondary">Desactivado</Badge>}</p>
                  <p className="text-xs text-muted-foreground">{c?.detail}</p>
                  {c?.lastRun && <p className="text-xs text-muted-foreground">Última lectura: {c.lastRun.status === "ok" ? c.lastRun.summary : c.lastRun.error ?? "en curso"}</p>}
                </div>
                {c?.state === "configured" ? (
                  <Button size="sm" onClick={() => sync.mutate({ source: e.source })} disabled={sync.isPending}><RefreshCw className="mr-1 h-4 w-4" /> Leer reseñas</Button>
                ) : (
                  <Button size="sm" variant="outline" asChild><Link href="/admin/configuracion/integraciones">Configurar</Link></Button>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">Solo lectura: SEO Control no publica ni responde reseñas. Las de tu web se moderan y responden en «Reseñas».</p>
      </section>
      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">Reseñas recientes</h2>
        {q.data!.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aún no hay reseñas.</p>
        ) : (
          <ul className="space-y-2">
            {q.data!.recent.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-0.5 font-semibold text-foreground">{r.rating}<Star className="h-3.5 w-3.5 fill-current text-amber-500" /></span>
                  <span className="text-foreground">{r.author ?? "Anónimo"}</span>
                  <Badge variant="outline">{SEO_REVIEW_SOURCE_LABELS[r.source]}</Badge>
                  {r.pending && <Badge variant="secondary">Pendiente de moderar</Badge>}
                  {!r.replied && r.rating <= 2 && <Badge variant="destructive">Sin responder</Badge>}
                  <span className="text-xs text-muted-foreground">{r.date ?? ""}</span>
                  {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline-offset-2 hover:underline">Ver <ExternalLink className="inline h-3 w-3" /></a>}
                </div>
                {r.title && <p className="mt-1 font-medium text-foreground">{r.title}</p>}
                {r.body && <p className="mt-1 line-clamp-3 break-words text-muted-foreground">{r.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function SeoControl() {
  const [tab, setTab] = useState("panel");
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Elephant Connect</p>
          <h1 className="text-2xl font-bold text-foreground">SEO y reseñas (SEO Control)</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">Sigue las posiciones de tus palabras clave en Google, revisa el SEO on-page de tu web y reúne tus reseñas en un solo panel, con alertas cuando algo empeora.</p>
        </header>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="flex-wrap">
            <TabsTrigger value="panel">Panel</TabsTrigger>
            <TabsTrigger value="palabras">Palabras clave</TabsTrigger>
            <TabsTrigger value="gsc">Search Console</TabsTrigger>
            <TabsTrigger value="auditoria">Auditoría</TabsTrigger>
            <TabsTrigger value="resenas">Reseñas</TabsTrigger>
          </TabsList>
          <TabsContent value="panel" className="pt-4"><Dashboard /></TabsContent>
          <TabsContent value="palabras" className="pt-4"><Keywords /></TabsContent>
          <TabsContent value="gsc" className="pt-4"><SearchConsole /></TabsContent>
          <TabsContent value="auditoria" className="pt-4"><Audit /></TabsContent>
          <TabsContent value="resenas" className="pt-4"><Reviews /></TabsContent>
        </Tabs>
      </div>
    </AdminLayout>
  );
}
