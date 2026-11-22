/**
 * Exportación de los datos de la empresa (dataExport.*): solicitar, seguir y descargar el ZIP (CSV, JSON y ficheros).
 * Solo la persona propietaria; disponible en prueba, activa, suspendida y solo lectura. La autorización real está
 * en el servidor: aquí solo se presenta. La descarga usa un enlace firmado que se pide en el momento (nunca se guarda).
 */
import { Link } from "wouter";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock, Download, FileArchive, Info, Lock, XCircle } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { usePanelSubscription } from "@/hooks/usePanelSubscription";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import { usePanelText } from "@/i18n/usePanelText";
import { exportAccountNotice } from "@shared/subscriptionRecovery";
import type { Formatters } from "@shared/i18n/core";

const fmtSize = (f: Formatters, b: number) => (b >= 1048576 ? `${f.number(b / 1048576, { maximumFractionDigits: 1 })} MB` : `${f.number(Math.max(1, Math.round(b / 1024)))} KB`);

/** Aviso según el estado de la cuenta (la exportación sigue disponible en solo lectura y suspendida), con quién exporta. */
function AccountNotice({ canExport }: { canExport: boolean }) {
  const px = usePanelText();
  const sub = usePanelSubscription();
  const d = sub.data;
  if (!d || d.licensing !== "capabilities") return null;
  // La consulta solo se promete si existe hoy (subscription.overview.consultation, mismas reglas que el servidor)
  const text = exportAccountNotice(d.state, d.consultation, canExport);
  if (!text) return null;
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-500/10 p-4 flex gap-3" role="status">
      <Info className="w-5 h-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-sm text-amber-900 dark:text-amber-100">{px(text)}</p>
    </div>
  );
}

function Contents({ maxMb, linkHours, dailyLimit }: { maxMb: number; linkHours: number; dailyLimit: number }) {
  const { t, format: f } = useI18n();
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-4" aria-labelledby="exp-contents">
      <h2 id="exp-contents" className="font-semibold text-foreground">{t("subscription.export.contentsTitle")}</h2>
      <div className="grid gap-5 md:grid-cols-2 text-sm">
        <div>
          <h3 className="font-medium text-foreground mb-2">{t("subscription.export.includes")}</h3>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>{t("subscription.export.inc1")}</li>
            <li>{t("subscription.export.inc2")}</li>
            <li>{t("subscription.export.inc3a")}<code>manifest.json</code>{t("subscription.export.inc3b")}<code>LEEME.txt</code>.</li>
          </ul>
        </div>
        <div>
          <h3 className="font-medium text-foreground mb-2">{t("subscription.export.excludes")}</h3>
          <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
            <li>{t("subscription.export.exc1")}</li>
            <li>{t("subscription.export.exc2")}</li>
            <li>{t("subscription.export.exc3")}</li>
            <li>{t("subscription.export.exc4")}</li>
          </ul>
        </div>
      </div>
      <ul className="text-xs text-muted-foreground space-y-1">
        <li>{t("subscription.export.note1", { n: dailyLimit })}</li>
        <li>{t("subscription.export.note2", { mb: f.number(maxMb) })}</li>
        <li>{t("subscription.export.note3", { hours: linkHours })}</li>
        <li>{t("subscription.export.note4")}</li>
      </ul>
    </section>
  );
}

/** Documentación de la relación con Elephant Source: fuera del ZIP, a petición y con procedimiento verificable. */
function Relationship() {
  const { t } = useI18n();
  const contact = trpc.subscription.supportContact.useQuery(undefined, { retry: false, staleTime: 300_000 });
  const email = contact.data?.email ?? null;
  return (
    <section className="rounded-2xl border border-border bg-card p-6 space-y-3" aria-labelledby="exp-rel">
      <h2 id="exp-rel" className="font-semibold text-foreground">{t("subscription.export.relTitle")}</h2>
      <p className="text-sm text-muted-foreground">
        {t("subscription.export.relIntro")}
      </p>
      <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
        <li>{t("subscription.export.rel1")}</li>
        <li>{t("subscription.export.rel2")}</li>
        <li>{t("subscription.export.rel3")}</li>
      </ul>
      <p className="text-sm text-muted-foreground">
        {t("subscription.export.relWrite")}{" "}
        {email ? <strong className="text-foreground select-all">{email}</strong> : t("subscription.export.relContact")} {t("subscription.export.relTail")}
      </p>
    </section>
  );
}

type ExportRow = {
  id: number;
  status: "pending" | "ready" | "failed";
  sizeBytes: number | null;
  tableCount: number | null;
  rowCount: number | null;
  fileCount: number | null;
  error: string | null;
  warning: string | null;
  requestedAt: number;
  completedAt: number | null;
  expiresAt: number | null;
  downloadCount: number;
  startedAt?: number | null;
  attempts?: number;
  purgedAt?: number | null;
};

function StatusBadge({ row, now }: { row: ExportRow; now: number }) {
  const { t } = useI18n();
  if (row.status === "pending") return <Badge variant="outline" className="gap-1"><Clock className="w-3.5 h-3.5" aria-hidden="true" />{row.startedAt ? (row.attempts && row.attempts > 1 ? t("subscription.export.generatingRetry") : t("subscription.export.generating")) : t("subscription.export.queued")}</Badge>;
  if (row.status === "failed") return <Badge variant="outline" className="gap-1 text-red-800 dark:text-red-300"><XCircle className="w-3.5 h-3.5" aria-hidden="true" />{t("subscription.export.failed")}</Badge>;
  if (row.purgedAt) return <Badge variant="outline">{t("subscription.export.purged")}</Badge>;
  if (row.expiresAt && row.expiresAt <= now) return <Badge variant="outline">{t("subscription.export.linkExpired")}</Badge>;
  if (row.warning) return <Badge variant="outline" className="gap-1 text-amber-800 dark:text-amber-300"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />{t("subscription.export.readyIncomplete")}</Badge>;
  return <Badge variant="outline" className="gap-1 text-emerald-800 dark:text-emerald-300"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />{t("subscription.export.ready")}</Badge>;
}

function History({ rows }: { rows: ExportRow[] }) {
  const { t, format: f } = useI18n();
  const fmtDateTime = (ms: number) => f.dateTime(ms, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const fmtNum = (n: number | null) => f.number(n ?? 0);
  const utils = trpc.useUtils();
  const now = Date.now();
  const link = trpc.dataExport.link.useMutation({
    onSuccess: (r) => {
      utils.dataExport.list.invalidate();
      window.location.assign(r.url);
    },
    onError: (e) => toast.error(e.message),
  });
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{t("subscription.export.none")}</p>;
  return (
    <ul className="divide-y divide-border">
      {rows.map((r) => {
        const downloadable = r.status === "ready" && !!r.expiresAt && r.expiresAt > now;
        return (
          <li key={r.id} className="py-4 flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{t("subscription.export.requestedOn", { date: fmtDateTime(r.requestedAt) })}</span>
                <StatusBadge row={r} now={now} />
              </div>
              {r.status === "ready" && (
                <p className="text-sm text-muted-foreground">
                  {t("subscription.export.summary", { tables: fmtNum(r.tableCount), rows: fmtNum(r.rowCount), files: fmtNum(r.fileCount), size: r.sizeBytes ? ` · ${fmtSize(f, r.sizeBytes)}` : "" })}
                  {r.expiresAt && (r.expiresAt > now ? t("subscription.export.until", { date: fmtDateTime(r.expiresAt) }) : t("subscription.export.requestNew"))}
                  {r.downloadCount > 0 && t("subscription.export.downloaded", { n: r.downloadCount })}
                </p>
              )}
              {r.warning && <p className="text-sm text-amber-800 dark:text-amber-300">{r.warning}</p>}
              {r.status === "failed" && r.error && <p className="text-sm text-red-800 dark:text-red-300">{r.error}</p>}
            </div>
            {downloadable && (
              <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={link.isPending} onClick={() => link.mutate({ id: r.id })}>
                <Download className="w-4 h-4 mr-1.5" aria-hidden="true" />
                {t("subscription.export.downloadZip")}
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function OwnerArea({ maxMb, linkHours, dailyLimit }: { maxMb: number; linkHours: number; dailyLimit: number }) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const list = trpc.dataExport.list.useQuery(undefined, {
    // Mientras se genera, se consulta cada pocos segundos
    refetchInterval: (q) => ((q.state.data as ExportRow[] | undefined)?.some((r) => r.status === "pending") ? 4000 : false),
    refetchOnWindowFocus: true,
  });
  const request = trpc.dataExport.request.useMutation({
    onSuccess: () => {
      toast.success(t("subscription.export.toastRequested"));
      utils.dataExport.list.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const rows = (list.data ?? []) as ExportRow[];
  const pending = rows.some((r) => r.status === "pending");
  return (
    <>
      <section className="rounded-2xl border border-border bg-card p-6 space-y-4" aria-labelledby="exp-request">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex-1">
            <h2 id="exp-request" className="font-semibold text-foreground">{t("subscription.export.newTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("subscription.export.newText")}
            </p>
          </div>
          <Button type="button" disabled={pending || request.isPending || list.isLoading} onClick={() => request.mutate()} className="shrink-0">
            <FileArchive className="w-4 h-4 mr-1.5" aria-hidden="true" />
            {pending ? t("subscription.export.inProgress") : t("subscription.export.request")}
          </Button>
        </div>
      </section>
      <section className="rounded-2xl border border-border bg-card p-6" aria-labelledby="exp-history">
        <h2 id="exp-history" className="font-semibold text-foreground mb-2">{t("subscription.export.yours")}</h2>
        {list.isLoading && <PanelLoading label={t("subscription.export.loadingList")} />}
        {list.isError && <PanelError error={list.error} onRetry={() => list.refetch()} title={list.error.message || t("subscription.export.loadListError")} />}
        {list.data && <History rows={rows} />}
      </section>
      <Contents maxMb={maxMb} linkHours={linkHours} dailyLimit={dailyLimit} />
      <Relationship />
    </>
  );
}

export default function DataExportPage() {
  const { t } = useI18n();
  const status = trpc.dataExport.status.useQuery(undefined, { retry: 1, refetchOnWindowFocus: false });
  const s = status.data;
  return (
    <AdminLayout>
      <div className="max-w-5xl space-y-6">
        <div>
          <Link href="/admin/suscripcion" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {t("subscription.hero.title")}
          </Link>
          <h1 className="text-2xl font-bold text-foreground">{t("subscription.export.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("subscription.export.pageText")}</p>
        </div>

        {s && <AccountNotice canExport={s.canExport} />}

        {status.isLoading && <PanelLoading label={t("subscription.export.checking")} />}
        {status.isError && <PanelError error={status.error} onRetry={() => status.refetch()} title={t("subscription.export.checkError")} />}

        {s && !s.canExport && (
          <section className="rounded-2xl border border-border bg-card p-6 flex gap-3" aria-labelledby="exp-denied">
            <Lock className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 id="exp-denied" className="font-semibold text-foreground">{t("subscription.export.ownerOnly")}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {s.ownerConfigured
                  ? t("subscription.export.ownerOnlyText", { owner: s.owner ? ` (${s.owner})` : "" })
                  : t("subscription.export.noOwner")}
              </p>
            </div>
          </section>
        )}

        {s && s.canExport && <OwnerArea maxMb={s.maxMb} linkHours={s.linkHours} dailyLimit={s.dailyLimit} />}
        {s && !s.canExport && <Contents maxMb={s.maxMb} linkHours={s.linkHours} dailyLimit={s.dailyLimit} />}
      </div>
    </AdminLayout>
  );
}
