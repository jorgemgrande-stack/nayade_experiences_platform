/**
 * Consumo de la empresa frente a los límites de su plan (correo, inteligencia artificial, ficheros, exportaciones).
 * Lo mide Elephant Resource Manager por empresa (subscription.usage); solo lectura.
 */
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { Badge } from "@/components/ui/badge";
import { PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import type { Formatters, Translate } from "@shared/i18n/core";

interface UsageRow {
  metric: string;
  label: string;
  unit: "count" | "tokens" | "bytes";
  period: "hour" | "day" | "month";
  periodLabel: string;
  used: number;
  limit: number;
  ratio: number | null;
  state: "ok" | "warning" | "exceeded";
  enforcement: "hard" | "soft";
}

function amount(f: Formatters, n: number, unit: UsageRow["unit"]): string {
  if (unit !== "bytes") return f.number(n);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${f.number(v, { maximumFractionDigits: v < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
}

const stateStyles = (t: Translate): Record<UsageRow["state"], { label: string; bar: string; badge: string }> => ({
  ok: { label: t("subscription.usage.within"), bar: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300" },
  warning: { label: t("subscription.usage.near"), bar: "bg-amber-500", badge: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
  exceeded: { label: t("subscription.usage.reached"), bar: "bg-red-500", badge: "bg-red-100 text-red-900 dark:bg-red-500/15 dark:text-red-300" },
});

function UsageCard({ row }: { row: UsageRow }) {
  const { t, format: f } = useI18n();
  const pct = row.ratio === null ? (row.used > 0 ? 100 : 0) : Math.min(100, Math.round(row.ratio * 100));
  const s = stateStyles(t)[row.state];
  return (
    <li className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-foreground">{row.label}</h2>
          <p className="text-xs text-muted-foreground">{t("subscription.usage.period", { period: row.periodLabel })}</p>
        </div>
        <Badge className={cn("border-0", s.badge)}>{s.label}</Badge>
      </div>
      <div
        className="h-2 w-full rounded-full bg-muted overflow-hidden"
        role="progressbar"
        aria-label={t("subscription.usage.ariaLimit", { label: row.label, pct })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className={cn("h-full rounded-full", s.bar)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-foreground">
        <strong>{amount(f, row.used, row.unit)}</strong> {t("subscription.usage.of")} {amount(f, row.limit, row.unit)}
        {row.unit === "tokens" ? t("subscription.usage.tokens") : ""}
      </p>
      {row.state === "exceeded" && (
        <p className="text-xs text-muted-foreground">
          {row.enforcement === "hard"
            ? t("subscription.usage.hardStop")
            : t("subscription.usage.softStop")}
        </p>
      )}
    </li>
  );
}

const LEVEL: Record<string, UsageRow["state"]> = { ok: "ok", warning: "warning", critical: "warning", exceeded: "exceeded" };

interface ScopeView { usedBytes: number; objects: number; limitGb: number | null; source: string; availableBytes: number | null; level: string }

function StorageCard({ title, hint, v }: { title: string; hint: string; v: ScopeView }) {
  const { t, format: f } = useI18n();
  const limit = v.limitGb === null ? null : v.limitGb * 1024 ** 3;
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, Math.round((v.usedBytes / limit) * 100));
  const s = stateStyles(t)[LEVEL[v.level] ?? "ok"];
  return (
    <li className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </div>
        <Badge className={cn("border-0", s.badge)}>{s.label}</Badge>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden" role="progressbar" aria-label={t("subscription.usage.ariaQuota", { title, pct })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className={cn("h-full rounded-full", s.bar)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-foreground">
        <strong>{amount(f, v.usedBytes, "bytes")}</strong> {t("subscription.usage.of")} {limit === null ? t("subscription.usage.noCap") : amount(f, limit, "bytes")} · {t("subscription.usage.files", { n: f.number(v.objects) })}
        {v.availableBytes !== null ? t("subscription.usage.available", { size: amount(f, v.availableBytes, "bytes") }) : ""}
      </p>
    </li>
  );
}

/** Almacenamiento separado: general (imágenes, documentos) y Elephant Learning (formación). Solo lectura. */
function StorageBreakdown() {
  const { t, format: f } = useI18n();
  const q = trpc.storage.overview.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const d = q.data as { general: ScopeView; learning: ScopeView; duplicates: { groups: number; extraObjects: number; extraBytes: number }; imageMaxBytes: number; traffic: { measurable: boolean } } | null | undefined;
  if (!d) return null;
  return (
    <section className="space-y-3" aria-label={t("subscription.usage.storage")}>
      <h2 className="text-lg font-semibold text-foreground">{t("subscription.usage.storage")}</h2>
      <ul className="grid gap-4 sm:grid-cols-2">
        <StorageCard title={t("subscription.usage.general")} hint={t("subscription.usage.generalHint")} v={d.general} />
        <StorageCard title={t("subscription.usage.learning")} hint={t("subscription.usage.learningHint")} v={d.learning} />
      </ul>
      <p className="text-xs text-muted-foreground">
        {t("subscription.usage.maxImage", { mb: Math.floor(d.imageMaxBytes / 1024 ** 2) })}
        {d.duplicates.groups > 0 ? t("subscription.usage.duplicates", { n: f.number(d.duplicates.extraObjects), size: amount(f, d.duplicates.extraBytes, "bytes") }) : ""}
        {d.traffic.measurable ? "" : t("subscription.usage.noTraffic")}
      </p>
    </section>
  );
}

/** Consumo frente a los límites (también dentro de la página «Suscripción»). */
export function UsageSection() {
  const { t } = useI18n();
  const usage = trpc.subscription.usage.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const data = usage.data as { available: boolean; rows: UsageRow[]; lagSeconds: number } | null | undefined;

  return (
    <>
        {usage.isLoading && <PanelLoading label={t("subscription.usage.loading")} />}
        {usage.isError && <PanelError error={usage.error} onRetry={() => usage.refetch()} title={t("subscription.usage.loadError")} />}

        {usage.isSuccess && (!data || !data.available) && (
          <section className="rounded-2xl border border-border bg-card p-6">
            <p className="text-sm text-muted-foreground">{t("subscription.usage.unavailable")}</p>
          </section>
        )}

        {data?.available && data.rows.length === 0 && <p className="text-sm text-muted-foreground">{t("subscription.usage.noLimits")}</p>}

        {data?.available && data.rows.length > 0 && (
          <>
            <ul className="grid gap-4 sm:grid-cols-2">
              {data.rows.map((r) => (
                <UsageCard key={`${r.metric}:${r.period}`} row={r} />
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t("subscription.usage.lag", { s: data.lagSeconds })}</p>
          </>
        )}

        <StorageBreakdown />
    </>
  );
}

export default function UsagePage() {
  const { t } = useI18n();
  return (
    <AdminLayout>
      <div className="max-w-4xl space-y-6">
        <div>
          <Link href="/admin/suscripcion" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {t("subscription.hero.title")}
          </Link>
          <h1 className="text-2xl font-bold text-foreground mt-1">{t("subscription.usage.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("subscription.usage.pageText")}</p>
        </div>
        <UsageSection />
      </div>
    </AdminLayout>
  );
}
