/**
 * Importar clientes desde un CSV en tres pasos: subir el fichero, revisar qué pasará con cada fila y confirmar.
 * La vista previa no escribe nada; al confirmar se aplica exactamente lo revisado (las filas desmarcadas no).
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/errorMessage";
import { Download, Upload, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { StatusBadge, type Tone } from "@/components/admin/PanelUi";
import { TONE_TEXT } from "@/lib/panelTones";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/I18nProvider";
import { CLIENT_CSV_MAX_BYTES, CLIENT_CSV_MAX_ROWS, clientCsvTemplate } from "@shared/clientImportCsv";
import { importButtonLabel, importDoneToast, importPreviewSummary, importResultSentence } from "@shared/clientImportTexts";

type Action = "create" | "update" | "unchanged" | "review" | "error";

const ACTION_TONE: Record<Action, Tone> = {
  create: "success",
  update: "info",
  unchanged: "neutral",
  review: "warning",
  error: "danger",
};
const FIELD_KEYS = ["name", "phone", "company", "nif", "address", "city", "postalCode", "country", "notes"];

/** Descarga un texto como fichero (sin pasar por el servidor). */
export function downloadTextFile(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function ClientImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, format: f } = useI18n();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState("");
  const [csv, setCsv] = useState("");
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null);
  const utils = trpc.useUtils();

  const preview = trpc.crm.clients.importPreview.useMutation({
    onSuccess: () => { setExcluded(new Set()); setStep(2); },
    onError: (e) => toastError(e),
  });
  const apply = trpc.crm.clients.importApply.useMutation({
    onSuccess: (r) => {
      setResult(r);
      setStep(3);
      utils.crm.clients.list.invalidate();
      toast.success(importDoneToast(r.created, r.updated));
    },
    onError: (e) => toastError(e),
  });

  const plan = preview.data;
  const applicable = useMemo(() => (plan?.rows ?? []).filter((r) => r.action === "create" || r.action === "update"), [plan]);
  const chosen = applicable.filter((r) => !excluded.has(r.line));

  const reset = () => {
    setStep(1); setFileName(""); setCsv(""); setExcluded(new Set()); setResult(null);
    preview.reset(); apply.reset();
  };
  const close = () => { reset(); onClose(); };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > CLIENT_CSV_MAX_BYTES) {
      toast.error(t("crmForm.import.tooBig", { mb: CLIENT_CSV_MAX_BYTES / 1024 / 1024 }));
      return;
    }
    const text = await f.text();
    setFileName(f.name);
    setCsv(text);
    preview.mutate({ csv: text });
  };

  const toggle = (line: number) => setExcluded((prev) => {
    const next = new Set(prev);
    if (next.has(line)) next.delete(line); else next.add(line);
    return next;
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-primary" aria-hidden="true" /> {t("crmForm.import.title")}
          </DialogTitle>
          <DialogDescription>
            {t("crmForm.import.step", { step, label: step === 1 ? t("crmForm.import.step1") : step === 2 ? t("crmForm.import.step2") : t("crmForm.import.step3") })}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 text-sm">
            <p className="text-foreground">
              {t("crmForm.import.intro", { max: f.number(CLIENT_CSV_MAX_ROWS) })}
            </p>
            <p className="text-muted-foreground">
              {t("crmForm.import.existing")}
            </p>
            <div className="flex flex-wrap gap-2">
              <label className={cn(buttonVariants(), "cursor-pointer has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50")}>
                {preview.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {preview.isPending ? t("crmForm.import.reading") : t("crmForm.import.chooseFile")}
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="sr-only"
                  disabled={preview.isPending}
                  onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
              <Button variant="outline" onClick={() => downloadTextFile(t("crmForm.import.templateFile"), clientCsvTemplate())}>
                <Download className="w-4 h-4 mr-2" /> {t("crmForm.import.template")}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && plan && (
          <div className="space-y-3 text-sm">
            <p className="text-foreground">
              <strong>{fileName}</strong>: {importPreviewSummary(plan.totals)}
            </p>
            {plan.ignoredColumns.length > 0 && (
              <p className="text-muted-foreground text-xs">{t("crmForm.import.ignoredColumns", { list: plan.ignoredColumns.join(", ") })}</p>
            )}
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left w-8"><span className="sr-only">{t("crmForm.import.colImport")}</span></th>
                    <th className="p-2 text-left">{t("crmForm.import.colRow")}</th>
                    <th className="p-2 text-left">{t("crmForm.import.colClient")}</th>
                    <th className="p-2 text-left">{t("crmForm.import.colAction")}</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r) => {
                    const canApply = r.action === "create" || r.action === "update";
                    return (
                      <tr key={r.line} className="border-t border-border align-top">
                        <td className="p-2">
                          {canApply && (
                            <input type="checkbox" aria-label={t("crmForm.import.importRow", { line: r.line })} checked={!excluded.has(r.line)} onChange={() => toggle(r.line)} />
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground">{r.line}</td>
                        <td className="p-2">
                          <div className="text-foreground">{r.values.name || "—"}</div>
                          <div className="text-muted-foreground">{[r.values.email, r.values.phone].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="p-2">
                          <StatusBadge tone={ACTION_TONE[r.action as Action]}>{t(`crmForm.import.action.${r.action as Action}`)}</StatusBadge>
                          {r.action === "update" && r.fill && (
                            <div className="text-muted-foreground mt-1">{t("crmForm.import.willAdd", { list: Object.keys(r.fill).map((k) => (FIELD_KEYS.includes(k) ? t(`crmForm.import.field.${k}`) : k)).join(", ") })}</div>
                          )}
                          {r.reason && <div className="text-muted-foreground mt-1">{r.reason}</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 3 && result && (
          <div className="flex items-start gap-3 text-sm">
            <CheckCircle2 className={cn("w-5 h-5 shrink-0", TONE_TEXT.success)} aria-hidden="true" />
            <p className="text-foreground">
              {importResultSentence(result.created, result.updated)}
              {t("crmForm.import.doneNote")}
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 2 && (
            <>
              <Button variant="outline" onClick={reset}>{t("crmForm.import.chooseOther")}</Button>
              <Button
                onClick={() => plan && apply.mutate({ csv, fingerprint: plan.fingerprint, excludeLines: Array.from(excluded) })}
                disabled={apply.isPending || chosen.length === 0}
              >
                {apply.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : chosen.length === 0 ? <AlertCircle className="w-4 h-4 mr-2" /> : null}
                {importButtonLabel(chosen.length)}
              </Button>
            </>
          )}
          {step !== 2 && (
            <Button variant="outline" onClick={close}>{step === 3 ? t("crmForm.import.close") : t("crmForm.import.cancel")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
