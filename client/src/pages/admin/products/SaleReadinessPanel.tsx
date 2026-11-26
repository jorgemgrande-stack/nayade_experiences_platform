import type { ReactNode } from "react";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { useI18n } from "@/i18n/I18nProvider";
import { StatusBadge } from "@/components/admin/PanelUi";
import type { CheckSeverity } from "@shared/saleReadiness";

const TONE: Record<CheckSeverity, "success" | "warning" | "danger"> = { ok: "success", warning: "warning", blocker: "danger" };
const ICON: Record<CheckSeverity, ReactNode> = {
  ok: <CheckCircle2 aria-hidden="true" />,
  warning: <AlertTriangle aria-hidden="true" />,
  blocker: <XCircle aria-hidden="true" />,
};

/**
 * «Preparación para venta online»: qué le falta a un producto guardado para pasar a «Precio fijo». Solo informa.
 * Si se está cambiando a precio fijo con avisos sin cerrar, pide la confirmación expresa del administrador.
 */
export function SaleReadinessPanel({ experienceId, targetMode, confirmed, onConfirmChange }: {
  experienceId: number | null;
  targetMode: string;
  confirmed: boolean;
  onConfirmChange: (v: boolean) => void;
}) {
  const { t } = useI18n();
  const q = trpc.products.saleReadiness.check.useQuery({ experienceId: experienceId ?? 0 }, { enabled: !!experienceId });
  const k = (s: string) => `saleReadiness.${s}`;

  return (
    <section className="sm:col-span-2 rounded-lg border bg-muted/30 p-3" aria-labelledby="saleReadiness-title" data-testid="sale-readiness-panel">
      <h3 id="saleReadiness-title" className="text-sm font-semibold">{t(k("title"))}</h3>
      <p className="text-xs text-muted-foreground mt-1">{t(k("intro"))}</p>
      {!experienceId ? (
        <p className="text-xs mt-2">{t(k("saveFirst"))}</p>
      ) : q.isLoading ? (
        <p className="text-xs mt-2" role="status">{t(k("loading"))}</p>
      ) : q.error || !q.data ? (
        <p className="text-xs mt-2 text-destructive" role="alert">{t(k("failed"))}</p>
      ) : (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={q.data.verdict === "technically_ready" ? "success" : "danger"}>{t(k(`verdict.${q.data.verdict}`))}</StatusBadge>
            <span className="text-xs text-muted-foreground">{t(k("commercialPending"), { n: q.data.commercialPending.length })}</span>
          </div>
          <ul className="space-y-2">
            {[...q.data.checks].sort((a, b) => Number(b.severity !== "ok") - Number(a.severity !== "ok") || Number(b.severity === "blocker") - Number(a.severity === "blocker")).map((c) => {
              const fix = c.severity === "ok" ? "" : t(k(`checks.${c.id}.fix`), c.params);
              return (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <StatusBadge tone={TONE[c.severity]} icon={ICON[c.severity]}>{t(k(`severity.${c.severity}`))}</StatusBadge>
                  <span className="min-w-0 break-words">
                    {t(k(`checks.${c.id}.label`), c.params)}
                    <span className="block text-xs text-muted-foreground">{t(k(`scope.${c.scope}`))}</span>
                    {c.severity !== "ok" && fix ? <span className="block text-xs">{t(k("fix"))} {fix}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {targetMode === "fixed" && q.data.offerMode !== "fixed" && q.data.blockers.length === 0 && q.data.warnings.length > 0 && (
            <div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => onConfirmChange(e.target.checked)} />
                <span>{t(k("confirmLabel"))}</span>
              </label>
              {!confirmed && <p className="text-xs text-muted-foreground mt-1">{t(k("confirmNeeded"))}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
