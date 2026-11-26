/**
 * Piezas de SEO Control (/admin/marketing/seo): panel, palabras clave, Search Console, auditoría y reseñas.
 * Solo presentación: las consultas y acciones son las de siempre (trpc.seoControl.*); la autorización real
 * (licencia `seo-control` y administración) la aplica el servidor. Los textos de alertas y de conectores que vienen
 * ya redactados del servidor se muestran tal cual.
 */
import { useState } from "react";
import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, CloudDownload, ExternalLink, FileSearch, Gauge, Pencil, Plus, RefreshCw, Search, Star, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Link } from "wouter";
import { trpc } from "@/lib/trpc";
import { useI18n, useFormat } from "@/i18n/I18nProvider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { PanelDataList, StatusBadge, type PanelColumn, type Tone } from "@/components/admin/PanelUi";
import { MetricCard } from "@/components/admin/PanelVisual";
import { FormField } from "@/pages/admin/accounting/shared/EconomyUi";
import { toastError } from "@/lib/errorMessage";
import { SEO_ISSUE_INFO, type SeoIssue, type SeoPositionSource, type SeoReviewSource, type SeoSeverity } from "@shared/seoControl";

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const sectionClass = "space-y-4 rounded-xl border border-border bg-card p-4";
const ellipsis = "overflow-hidden text-ellipsis whitespace-nowrap";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const fmtPos = (n: number | null | undefined) => (n == null ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const SEVERITY_TONE: Record<SeoSeverity, Tone> = { high: "danger", medium: "warning", low: "neutral" };

function Delta({ delta }: { delta: number | null }) {
  if (delta == null) return <span className="text-muted-foreground">—</span>;
  if (delta === 0) return <span className="text-muted-foreground">=</span>;
  // Posición mayor = peor
  return delta > 0 ? <span className="text-danger">▼ {fmtPos(delta)}</span> : <span className="text-success">▲ {fmtPos(-delta)}</span>;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function Dashboard({ goTo }: { goTo: (tab: string) => void }) {
  const { t } = useI18n();
  const f = useFormat();
  const [days, setDays] = useState(90);
  const q = trpc.seoControl.dashboard.useQuery({ days }, { retry: false });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const maxPos = Math.max(10, ...d.evolution.map((e) => e.averagePosition ?? 0));
  return (
    <div className="space-y-4">
      <label className="block max-w-xs space-y-1.5 text-sm font-medium text-foreground">
        <span>{t("seoControl.dash.period")}</span>
        <select className={selectClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={30}>{t("seoControl.dash.days30")}</option>
          <option value={90}>{t("seoControl.dash.days90")}</option>
          <option value={180}>{t("seoControl.dash.days180")}</option>
          <option value={365}>{t("seoControl.dash.days365")}</option>
        </select>
      </label>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard compact tone="brand" icon={<Gauge />} label={t("seoControl.dash.avgPosition")} value={fmtPos(d.keywords.averagePosition)}
          detail={t("seoControl.dash.avgPositionHint", { withData: d.keywords.withPosition, active: d.keywords.active })} onClick={() => goTo("keywords")} />
        <MetricCard compact tone="success" icon={<TrendingUp />} label={t("seoControl.dash.top10")} value={d.keywords.top10}
          detail={t("seoControl.dash.top3Hint", { count: d.keywords.top3 })} onClick={() => goTo("keywords")} />
        <MetricCard compact tone="info" icon={<FileSearch />} label={t("seoControl.dash.health")} value={d.audit?.score == null ? "—" : `${d.audit.score}/100`}
          detail={d.audit ? t("seoControl.dash.healthHint", { issues: d.audit.withIssues, pages: d.audit.pages }) : t("seoControl.dash.noAudit")} onClick={() => goTo("audit")} />
        <MetricCard compact tone="warning" icon={<Star />} label={t("seoControl.dash.rating")} value={d.reviews.average == null ? "—" : `${d.reviews.average.toFixed(1)} ★`}
          detail={t("seoControl.dash.reviewsHint", { count: d.reviews.count })} onClick={() => goTo("reviews")} />
      </section>

      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">{t("seoControl.dash.alerts")}</h2>
        {d.alerts.length === 0 ? (
          <p className="flex items-start gap-2 text-sm text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />{t("seoControl.dash.noAlerts")}</p>
        ) : (
          <ul className="space-y-2">
            {d.alerts.map((a, i) => (
              <li key={i} className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${a.severity === "high" ? "text-danger" : "text-warning"}`} aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{a.title}</span>
                    <StatusBadge tone={SEVERITY_TONE[a.severity]}>{t(`seoControl.alertKind.${a.kind}`)}</StatusBadge>
                  </div>
                  <p className="break-words text-muted-foreground">{a.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">{t("seoControl.dash.evolution")}</h2>
        {d.evolution.length === 0 ? (
          <PanelEmpty icon={<Search className="h-5 w-5" />} title={t("seoControl.dash.evolutionEmpty")} description={t("seoControl.dash.evolutionEmptyHint")} />
        ) : (
          <div className="space-y-2">
            {d.evolution.map((e) => (
              <div key={e.week} className="grid grid-cols-[5rem_1fr] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[6.5rem_1fr_10rem]">
                <span className="text-muted-foreground">{e.week}</span>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  {e.averagePosition != null && <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(4, Math.round((1 - (e.averagePosition - 1) / maxPos) * 100))}%` }} />}
                </div>
                <span className="col-span-2 text-foreground sm:col-span-1 sm:text-right">{t("seoControl.dash.weekRow", { pos: fmtPos(e.averagePosition), clicks: f.number(e.clicks) })}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">{t("seoControl.dash.evolutionHelp")}</p>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Palabras clave ───────────────────────────────────────────────────────────

type KeywordRow = { id: number; keyword: string; targetUrl: string | null; isArchived: boolean; latest: { observedOn: string; position: number | null; source: SeoPositionSource; clicks: number | null; impressions: number | null; rankingUrl: string | null } | null; delta: number | null };

function KeywordDialog({ editing, onClose }: { editing: KeywordRow | "new" | null; onClose: () => void }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [keyword, setKeyword] = useState("");
  const [targetUrl, setTargetUrl] = useState("");
  const [initFor, setInitFor] = useState<unknown>(null);
  if (editing !== initFor) {
    setInitFor(editing);
    setKeyword(editing && editing !== "new" ? editing.keyword : "");
    setTargetUrl(editing && editing !== "new" ? editing.targetUrl ?? "" : "");
  }
  const save = trpc.seoControl.upsertKeyword.useMutation({ onSuccess: () => (toast.success(t("seoControl.kw.saved")), utils.seoControl.invalidate(), onClose()), onError: (e) => toastError(e) });
  return (
    <Dialog open={!!editing} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing === "new" ? t("seoControl.kw.dialogNew") : t("seoControl.kw.dialogEdit")}</DialogTitle>
          <DialogDescription>{t("seoControl.kw.dialogHelp")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label={t("seoControl.kw.keyword")} required>
            <Input value={keyword} maxLength={150} onChange={(e) => setKeyword(e.target.value)} placeholder={t("seoControl.kw.keywordPlaceholder")} autoComplete="off" />
          </FormField>
          <FormField label={t("seoControl.kw.target")}>
            <Input value={targetUrl} maxLength={500} onChange={(e) => setTargetUrl(e.target.value)} placeholder={t("seoControl.kw.targetPlaceholder")} autoComplete="off" />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("seoControl.kw.cancel")}</Button>
          <Button disabled={keyword.trim().length < 2 || save.isPending} onClick={() => save.mutate({ id: editing && editing !== "new" ? editing.id : undefined, keyword, targetUrl: targetUrl || null })}>{t("seoControl.kw.save")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PositionDialog({ k, onClose }: { k: KeywordRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const f = useFormat();
  const utils = trpc.useUtils();
  const [day, setDay] = useState(today());
  const [position, setPosition] = useState("");
  const [rankingUrl, setRankingUrl] = useState("");
  const [note, setNote] = useState("");
  const history = trpc.seoControl.keywordHistory.useQuery({ keywordId: k?.id ?? 0, days: 120 }, { enabled: !!k, retry: false });
  const save = trpc.seoControl.recordPosition.useMutation({
    onSuccess: () => (toast.success(t("seoControl.kw.posSaved")), setPosition(""), setNote(""), utils.seoControl.invalidate()),
    onError: (e) => toastError(e),
  });
  const pos = position.trim() === "" ? null : Number(position.replace(",", "."));
  const valid = pos == null || (Number.isFinite(pos) && pos >= 1 && pos <= 100);
  type Point = NonNullable<typeof history.data>["points"][number];
  const cols: PanelColumn<Point>[] = [
    { key: "date", header: t("seoControl.kw.hcol.date"), cell: (p) => p.observedOn },
    { key: "pos", header: t("seoControl.kw.hcol.position"), cell: (p) => <span className="font-medium">{fmtPos(p.position)}</span> },
    { key: "clicks", header: t("seoControl.kw.hcol.clicks"), cell: (p) => f.number(p.clicks) },
    { key: "impr", header: t("seoControl.kw.hcol.impressions"), cell: (p) => f.number(p.impressions) },
    { key: "src", header: t("seoControl.kw.hcol.source"), cell: (p) => <span className="text-xs text-muted-foreground">{t(`seoControl.positionSource.${p.source}`)}</span> },
  ];
  return (
    <Dialog open={!!k} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("seoControl.kw.posTitle", { keyword: k?.keyword ?? "" })}</DialogTitle>
          <DialogDescription>{t("seoControl.kw.posHelp")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <FormField label={t("seoControl.kw.date")}>
            <Input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
          </FormField>
          <FormField label={t("seoControl.kw.posField")} error={valid ? null : t("seoControl.kw.posInvalid")}>
            <Input inputMode="decimal" value={position} onChange={(e) => setPosition(e.target.value)} placeholder={t("seoControl.kw.posPlaceholder")} autoComplete="off" />
          </FormField>
          <FormField label={t("seoControl.kw.rankingUrl")}>
            <Input value={rankingUrl} maxLength={500} onChange={(e) => setRankingUrl(e.target.value)} placeholder={t("seoControl.kw.optional")} autoComplete="off" />
          </FormField>
          <FormField label={t("seoControl.kw.note")} className="sm:col-span-3">
            <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder={t("seoControl.kw.notePlaceholder")} autoComplete="off" />
          </FormField>
        </div>
        <div className="flex justify-end">
          <Button disabled={!valid || !k || save.isPending} onClick={() => k && save.mutate({ keywordId: k.id, observedOn: day, position: pos, rankingUrl: rankingUrl || null, note: note || null })}>
            {t("seoControl.kw.record")}
          </Button>
        </div>
        {history.isLoading ? (
          <PanelLoading />
        ) : !history.data?.points.length ? (
          <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">{t("seoControl.kw.historyEmpty")}</p>
        ) : (
          <PanelDataList className="max-h-64 overflow-y-auto" rows={[...history.data.points].reverse()} columns={cols} rowKey={(p) => p.id} caption={t("seoControl.kw.historyCaption")} />
        )}
      </DialogContent>
    </Dialog>
  );
}

export function Keywords() {
  const { t } = useI18n();
  const f = useFormat();
  const utils = trpc.useUtils();
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<KeywordRow | "new" | null>(null);
  const [positions, setPositions] = useState<KeywordRow | null>(null);
  const q = trpc.seoControl.keywords.useQuery({ includeArchived: showArchived }, { retry: false });
  const archive = trpc.seoControl.setKeywordArchived.useMutation({ onSuccess: () => utils.seoControl.invalidate(), onError: (e) => toastError(e) });
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const list = q.data as KeywordRow[];
  const cols: PanelColumn<KeywordRow>[] = [
    {
      key: "keyword",
      header: t("seoControl.kw.col.keyword"),
      className: "max-w-[18rem]",
      cell: (k) => (
        <div className={k.isArchived ? "opacity-60" : undefined}>
          <p className="break-words font-medium text-foreground md:overflow-hidden md:text-ellipsis md:whitespace-nowrap" title={k.keyword}>{k.keyword} {k.isArchived && <StatusBadge tone="neutral">{t("seoControl.kw.archivedBadge")}</StatusBadge>}</p>
          {k.targetUrl && <p className={`${ellipsis} text-xs font-normal text-muted-foreground`} title={k.targetUrl}>{k.targetUrl}</p>}
        </div>
      ),
    },
    { key: "pos", header: t("seoControl.kw.col.position"), cell: (k) => <span className="text-base font-semibold">{fmtPos(k.latest?.position)}</span> },
    { key: "delta", header: t("seoControl.kw.col.change"), cell: (k) => <Delta delta={k.delta} /> },
    { key: "clicks", header: t("seoControl.kw.col.clicks"), cell: (k) => (k.latest?.source === "gsc" ? `${f.number(k.latest.clicks)} / ${f.number(k.latest.impressions)}` : "—") },
    { key: "last", header: t("seoControl.kw.col.last"), cell: (k) => <span className="text-xs text-muted-foreground">{k.latest ? `${k.latest.observedOn} · ${k.latest.source === "gsc" ? "Search Console" : t("seoControl.kw.manual")}` : t("seoControl.kw.noData")}</span> },
    {
      key: "actions",
      header: <span className="sr-only">{t("seoControl.kw.col.actions")}</span>,
      align: "right",
      cell: (k) => (
        <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
          <Button size="sm" variant="outline" aria-label={t("seoControl.kw.positions")} title={t("seoControl.kw.positions")} onClick={() => setPositions(k)} disabled={k.isArchived}><TrendingUp className="h-4 w-4 lg:hidden" aria-hidden="true" /><span className="hidden lg:inline">{t("seoControl.kw.positions")}</span></Button>
          <Button size="icon" variant="ghost" aria-label={t("seoControl.kw.edit")} onClick={() => setEditing(k)}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" aria-label={k.isArchived ? t("seoControl.kw.restore") : t("seoControl.kw.archive")} onClick={() => archive.mutate({ id: k.id, archived: !k.isArchived })}>
            {k.isArchived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          </Button>
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> {t("seoControl.kw.showArchived")}
        </label>
        <Button onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" /> {t("seoControl.kw.new")}</Button>
      </div>
      {list.length === 0 ? (
        <PanelEmpty icon={<Search className="h-5 w-5" />} title={t("seoControl.kw.empty")} description={t("seoControl.kw.emptyHint")}>
          <Button onClick={() => setEditing("new")}><Plus className="mr-1 h-4 w-4" /> {t("seoControl.kw.new")}</Button>
        </PanelEmpty>
      ) : (
        <PanelDataList rows={list} columns={cols} rowKey={(k) => k.id} caption={t("seoControl.kw.caption")} />
      )}
      <KeywordDialog editing={editing} onClose={() => setEditing(null)} />
      <PositionDialog k={positions} onClose={() => setPositions(null)} />
    </div>
  );
}

// ─── Search Console ───────────────────────────────────────────────────────────

export function SearchConsole() {
  const { t } = useI18n();
  const f = useFormat();
  const utils = trpc.useUtils();
  const [days, setDays] = useState(28);
  const [search, setSearch] = useState("");
  const conns = trpc.seoControl.connectors.useQuery(undefined, { retry: false });
  const perf = trpc.seoControl.searchPerformance.useQuery({ limit: 200, search: search || null }, { retry: false });
  const imp = trpc.seoControl.importSearchConsole.useMutation({
    onSuccess: (r) => {
      toast.success(t("seoControl.gsc.imported", { rows: r.performanceRows, keywords: r.keywordsUpdated }));
      for (const w of r.warnings.slice(0, 3)) toast.warning(w);
      utils.seoControl.invalidate();
    },
    onError: (e) => toastError(e),
  });
  const gsc = conns.data?.find((c) => c.provider === "google_search_console");
  const pct = (r: number | null | undefined) => (r == null ? "—" : f.percent(r));
  type Row = NonNullable<typeof perf.data>["rows"][number];
  const cols: PanelColumn<Row>[] = [
    { key: "query", header: t("seoControl.gsc.col.query"), className: "max-w-[14rem]", cell: (r) => <span className="block break-words md:overflow-hidden md:text-ellipsis md:whitespace-nowrap" title={r.query}>{r.query}</span> },
    { key: "page", header: t("seoControl.gsc.col.page"), className: "max-w-[16rem]", cell: (r) => <span className="block break-all text-xs text-muted-foreground md:overflow-hidden md:text-ellipsis md:whitespace-nowrap" title={r.page ?? ""}>{r.page ?? "—"}</span> },
    { key: "clicks", header: t("seoControl.gsc.col.clicks"), cell: (r) => f.number(r.clicks) },
    { key: "impr", header: t("seoControl.gsc.col.impressions"), cell: (r) => f.number(r.impressions) },
    { key: "ctr", header: t("seoControl.gsc.col.ctr"), cell: (r) => pct(r.ctr) },
    { key: "pos", header: t("seoControl.gsc.col.position"), cell: (r) => fmtPos(r.position) },
  ];
  const lastRun = gsc?.lastRun ? (gsc.lastRun.status === "ok" ? gsc.lastRun.summary : gsc.lastRun.error ?? t("seoControl.gsc.running")) : null;
  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-foreground">{t("seoControl.gsc.title")}</h2>
            <p className="text-sm text-muted-foreground">{gsc?.detail ?? t("seoControl.gsc.checking")}</p>
            {lastRun && <p className="text-xs text-muted-foreground">{t("seoControl.gsc.lastImport", { result: lastRun })}</p>}
          </div>
          {gsc?.state === "configured" ? (
            <div className="flex items-end gap-2">
              <select className={`${selectClass} w-40`} value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label={t("seoControl.gsc.period")}>
                <option value={7}>{t("seoControl.gsc.days7")}</option>
                <option value={28}>{t("seoControl.gsc.days28")}</option>
                <option value={90}>{t("seoControl.gsc.days90")}</option>
              </select>
              <Button onClick={() => imp.mutate({ days })} disabled={imp.isPending}>
                <CloudDownload className="mr-1 h-4 w-4" /> {imp.isPending ? t("seoControl.gsc.importing") : t("seoControl.gsc.import")}
              </Button>
            </div>
          ) : (
            <Button variant="outline" asChild><Link href="/admin/configuracion/integraciones">{t("seoControl.gsc.configure")}</Link></Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{t("seoControl.gsc.delay")}</p>
      </section>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-foreground">{t("seoControl.gsc.queries")}{perf.data?.period ? ` (${perf.data.period.start} → ${perf.data.period.end})` : ""}</h2>
          <Input type="search" className="max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("seoControl.gsc.filter")} aria-label={t("seoControl.gsc.filter")} autoComplete="off" />
        </div>
        {perf.isLoading ? (
          <PanelLoading />
        ) : perf.error ? (
          <PanelError error={perf.error} onRetry={() => perf.refetch()} />
        ) : !perf.data?.rows.length ? (
          <p className="text-sm text-muted-foreground">{t("seoControl.gsc.empty")}</p>
        ) : (
          <>
            {perf.data.totals && (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <MetricCard compact tone="brand" icon={<TrendingUp />} label={t("seoControl.gsc.clicks")} value={f.number(perf.data.totals.clicks)} />
                <MetricCard compact tone="info" icon={<Search />} label={t("seoControl.gsc.impressions")} value={f.number(perf.data.totals.impressions)} />
                <MetricCard compact tone="success" icon={<CheckCircle2 />} label={t("seoControl.gsc.ctr")} value={pct(perf.data.totals.ctr)} />
                <MetricCard compact tone="warning" icon={<Gauge />} label={t("seoControl.gsc.avgPosition")} value={fmtPos(perf.data.totals.position)} />
              </div>
            )}
            <PanelDataList rows={perf.data.rows} columns={cols} rowKey={(r) => `${r.query}|${r.page ?? ""}`} caption={t("seoControl.gsc.caption")} />
          </>
        )}
      </section>
    </div>
  );
}

// ─── Auditoría ────────────────────────────────────────────────────────────────

export function Audit() {
  const { t } = useI18n();
  const f = useFormat();
  const utils = trpc.useUtils();
  const q = trpc.seoControl.audit.useQuery(undefined, { retry: false });
  const domains = trpc.seoControl.webHosts.useQuery(undefined, { retry: false });
  const runAudit = trpc.seoControl.runAudit.useMutation({ onSuccess: () => (toast.success(t("seoControl.audit.done")), utils.seoControl.invalidate()), onError: (e) => toastError(e) });
  const [open, setOpen] = useState<string | null>(null);
  const [onlyIssues, setOnlyIssues] = useState(false);
  if (q.isLoading) return <PanelLoading />;
  if (q.error) return <PanelError error={q.error} onRetry={() => q.refetch()} />;
  const a = q.data;
  const hosts = domains.data?.hosts ?? [];
  const withIssues = a ? a.pages.filter((p) => p.issues.length).length : 0;
  const pages = a ? a.pages.filter((p) => !onlyIssues || p.issues.length > 0) : [];
  return (
    <div className="space-y-4">
      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-foreground">{t("seoControl.audit.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("seoControl.audit.help")}{" "}
              {hosts.length ? t("seoControl.audit.onlyIn", { hosts: hosts.join(", ") }) : t("seoControl.audit.noDomain")}
            </p>
            {a && <p className="text-xs text-muted-foreground">{t("seoControl.audit.last", { when: a.finishedAt?.slice(0, 16).replace("T", " ") ?? "—", summary: a.summary })}</p>}
          </div>
          <Button onClick={() => runAudit.mutate({})} disabled={runAudit.isPending || !hosts.length}>
            <RefreshCw className={`mr-1 h-4 w-4 ${runAudit.isPending ? "animate-spin" : ""}`} /> {runAudit.isPending ? t("seoControl.audit.running") : t("seoControl.audit.run")}
          </Button>
        </div>
      </section>
      {!a ? (
        <PanelEmpty icon={<Search className="h-5 w-5" />} title={t("seoControl.audit.empty")} description={t("seoControl.audit.emptyHint")} />
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <MetricCard compact tone="info" icon={<FileSearch />} label={t("seoControl.audit.score")} value={a.score == null ? "—" : `${a.score}/100`}
              detail={t("seoControl.audit.scoreHint", { issues: withIssues, pages: a.pages.length })} active={!onlyIssues} onClick={() => setOnlyIssues(false)} />
            <MetricCard compact tone="warning" icon={<AlertTriangle />} label={t("seoControl.audit.filterIssues")} value={withIssues} active={onlyIssues} onClick={() => setOnlyIssues(!onlyIssues)} />
          </div>
          {pages.map((p) => (
            <div key={p.url} className="rounded-lg border border-border bg-card p-3 text-sm">
              <button type="button" aria-expanded={open === p.url} className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === p.url ? null : p.url)}>
                <div className="min-w-0 flex-1">
                  <p className={`${ellipsis} font-medium text-foreground`} title={p.url}>{p.url}</p>
                  <p className={`${ellipsis} text-xs text-muted-foreground`}>{p.title ?? t("seoControl.audit.noTitle")}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1">
                  {!p.indexable && <StatusBadge tone="danger">{t("seoControl.audit.notIndexable")}</StatusBadge>}
                  {p.issues.length === 0 ? <StatusBadge tone="success">{t("seoControl.audit.ok")}</StatusBadge> : <StatusBadge tone="warning">{t("seoControl.audit.issuesCount", { count: p.issues.length })}</StatusBadge>}
                </div>
              </button>
              {open === p.url && (
                <div className="mt-3 space-y-2 border-t border-border pt-3">
                  <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[9rem_1fr]">
                    <dt className="text-muted-foreground">{t("seoControl.audit.response")}</dt><dd className="break-all">{p.status || "—"}{p.error ? ` · ${p.error}` : ""}{p.finalUrl && p.finalUrl !== p.url ? ` → ${p.finalUrl}` : ""}</dd>
                    <dt className="text-muted-foreground">{t("seoControl.audit.pageTitle")}</dt><dd className="break-words">{p.title ?? "—"} {p.title ? `(${p.title.length})` : ""}</dd>
                    <dt className="text-muted-foreground">{t("seoControl.audit.descriptionLabel")}</dt><dd className="break-words">{p.metaDescription ?? "—"} {p.metaDescription ? `(${p.metaDescription.length})` : ""}</dd>
                    <dt className="text-muted-foreground">H1</dt><dd className="break-words">{p.h1 ?? "—"}{p.h1Count > 1 ? ` (+${p.h1Count - 1})` : ""}</dd>
                    <dt className="text-muted-foreground">{t("seoControl.audit.canonical")}</dt><dd className="break-all">{p.canonical ?? "—"}</dd>
                    <dt className="text-muted-foreground">{t("seoControl.audit.robots")}</dt><dd>{p.robots ?? "—"}</dd>
                    <dt className="text-muted-foreground">{t("seoControl.audit.sizeTime")}</dt><dd>{f.number(Math.round(p.sizeBytes / 1024))} KB · {f.number(p.loadMs)} ms</dd>
                  </dl>
                  {p.issues.length > 0 && (
                    <ul className="space-y-1">
                      {p.issues.map((i: SeoIssue) => (
                        <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
                          <StatusBadge tone={SEVERITY_TONE[SEO_ISSUE_INFO[i].severity]}>{t(`seoControl.severity.${SEO_ISSUE_INFO[i].severity}`)}</StatusBadge>
                          <span className="font-medium">{t(`seoControl.issue.${i}.label`)}:</span>
                          <span className="text-muted-foreground">{t(`seoControl.issue.${i}.advice`)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {p.brokenLinks.length > 0 && (
                    <div className="text-xs">
                      <p className="font-medium">{t("seoControl.audit.brokenLinks")}</p>
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

const REVIEW_TONE: Record<SeoReviewSource | "core", Tone> = { core: "brand", google: "info", tripadvisor: "success" };

export function Reviews() {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const q = trpc.seoControl.reviews.useQuery(undefined, { retry: false });
  const conns = trpc.seoControl.connectors.useQuery(undefined, { retry: false });
  const sync = trpc.seoControl.syncReviews.useMutation({ onSuccess: (r) => (toast.success(t("seoControl.rev.readDone", { count: r.imported })), utils.seoControl.invalidate()), onError: (e) => toastError(e) });
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
          return (
            <MetricCard key={s} compact tone={REVIEW_TONE[s]} icon={<Star />} label={t(`seoControl.reviewSource.${s}`)} value={sum?.average == null ? "—" : `${sum.average.toFixed(1)} ★`}
              detail={sum ? t("seoControl.rev.unansweredHint", { count: sum.count, last30: sum.last30, unanswered: sum.unanswered }) : t("seoControl.rev.noData")} />
          );
        })}
      </section>
      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">{t("seoControl.rev.external")}</h2>
        <div className="space-y-2">
          {ext.map((e) => {
            const c = conns.data?.find((x) => x.provider === e.provider);
            return (
              <div key={e.source} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium text-foreground">{t(`seoControl.reviewSource.${e.source}`)} {c?.state === "configured" ? <StatusBadge tone="success">{t("seoControl.rev.configured")}</StatusBadge> : <StatusBadge tone="neutral">{t("seoControl.rev.disabled")}</StatusBadge>}</p>
                  <p className="text-xs text-muted-foreground">{c?.detail}</p>
                  {c?.lastRun && <p className="text-xs text-muted-foreground">{t("seoControl.rev.lastRead", { result: c.lastRun.status === "ok" ? c.lastRun.summary : c.lastRun.error ?? t("seoControl.gsc.running") })}</p>}
                </div>
                {c?.state === "configured" ? (
                  <Button size="sm" onClick={() => sync.mutate({ source: e.source })} disabled={sync.isPending}><RefreshCw className="mr-1 h-4 w-4" /> {t("seoControl.rev.read")}</Button>
                ) : (
                  <Button size="sm" variant="outline" asChild><Link href="/admin/configuracion/integraciones">{t("seoControl.rev.configure")}</Link></Button>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t("seoControl.rev.readOnly")}</p>
      </section>
      <section className={sectionClass}>
        <h2 className="text-base font-semibold text-foreground">{t("seoControl.rev.recent")}</h2>
        {q.data!.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("seoControl.rev.empty")}</p>
        ) : (
          <ul className="space-y-2">
            {q.data!.recent.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-0.5 font-semibold text-foreground">{r.rating}<Star className="h-3.5 w-3.5 fill-current text-warning" aria-hidden="true" /></span>
                  <span className="text-foreground">{r.author ?? t("seoControl.rev.anonymous")}</span>
                  <StatusBadge tone={REVIEW_TONE[r.source]}>{t(`seoControl.reviewSource.${r.source}`)}</StatusBadge>
                  {r.pending && <StatusBadge tone="warning">{t("seoControl.rev.pending")}</StatusBadge>}
                  {!r.replied && r.rating <= 2 && <StatusBadge tone="danger">{t("seoControl.rev.unanswered")}</StatusBadge>}
                  <span className="text-xs text-muted-foreground">{r.date ?? ""}</span>
                  {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary underline-offset-2 hover:underline">{t("seoControl.rev.view")} <ExternalLink className="inline h-3 w-3" aria-hidden="true" /></a>}
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
