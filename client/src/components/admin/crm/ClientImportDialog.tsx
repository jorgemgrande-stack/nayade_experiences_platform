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
import { CLIENT_CSV_MAX_BYTES, CLIENT_CSV_MAX_ROWS, clientCsvTemplate } from "@shared/clientImportCsv";
import { importButtonLabel, importDoneToast, importPreviewSummary, importResultSentence } from "@shared/clientImportTexts";

type Action = "create" | "update" | "unchanged" | "review" | "error";

const ACTION_LABEL: Record<Action, string> = {
  create: "Alta nueva",
  update: "Completar datos",
  unchanged: "Sin cambios",
  review: "Revisar a mano",
  error: "No se importa",
};
const ACTION_TONE: Record<Action, Tone> = {
  create: "success",
  update: "info",
  unchanged: "neutral",
  review: "warning",
  error: "danger",
};
const FIELD_LABEL: Record<string, string> = {
  name: "nombre", phone: "teléfono", company: "empresa", nif: "NIF", address: "dirección", city: "ciudad",
  postalCode: "código postal", country: "país", notes: "notas",
};

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
      toast.error(`El fichero supera ${CLIENT_CSV_MAX_BYTES / 1024 / 1024} MB. Divídelo en varios y súbelos por partes.`);
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
            <Upload className="w-5 h-5 text-primary" aria-hidden="true" /> Importar clientes
          </DialogTitle>
          <DialogDescription>
            Paso {step} de 3 · {step === 1 ? "Sube el fichero" : step === 2 ? "Revisa qué se hará con cada fila" : "Listo"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 text-sm">
            <p className="text-foreground">
              Sube un fichero CSV (por ejemplo, guardado desde Excel) con una fila por cliente. Columnas reconocidas:
              nombre, email, teléfono, empresa, NIF, dirección, ciudad, código postal, país y notas. El email es
              obligatorio para dar de alta un cliente nuevo. Hasta {CLIENT_CSV_MAX_ROWS.toLocaleString("es-ES")} filas.
            </p>
            <p className="text-muted-foreground">
              Si un cliente ya existe (mismo email, o mismo teléfono y nombre), solo se completan los datos que tenga
              vacíos: nunca se cambia lo que ya tiene. Antes de importar verás qué pasará con cada fila.
            </p>
            <div className="flex flex-wrap gap-2">
              <label className={cn(buttonVariants(), "cursor-pointer has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50")}>
                {preview.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {preview.isPending ? "Leyendo…" : "Elegir fichero CSV"}
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="sr-only"
                  disabled={preview.isPending}
                  onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
              <Button variant="outline" onClick={() => downloadTextFile("plantilla-clientes.csv", clientCsvTemplate())}>
                <Download className="w-4 h-4 mr-2" /> Descargar plantilla
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
              <p className="text-muted-foreground text-xs">Columnas que no se usan: {plan.ignoredColumns.join(", ")}</p>
            )}
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left w-8"><span className="sr-only">Importar</span></th>
                    <th className="p-2 text-left">Fila</th>
                    <th className="p-2 text-left">Cliente</th>
                    <th className="p-2 text-left">Qué se hará</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((r) => {
                    const canApply = r.action === "create" || r.action === "update";
                    return (
                      <tr key={r.line} className="border-t border-border align-top">
                        <td className="p-2">
                          {canApply && (
                            <input type="checkbox" aria-label={`Importar la fila ${r.line}`} checked={!excluded.has(r.line)} onChange={() => toggle(r.line)} />
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground">{r.line}</td>
                        <td className="p-2">
                          <div className="text-foreground">{r.values.name || "—"}</div>
                          <div className="text-muted-foreground">{[r.values.email, r.values.phone].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="p-2">
                          <StatusBadge tone={ACTION_TONE[r.action as Action]}>{ACTION_LABEL[r.action as Action]}</StatusBadge>
                          {r.action === "update" && r.fill && (
                            <div className="text-muted-foreground mt-1">Se añade: {Object.keys(r.fill).map((f) => FIELD_LABEL[f] ?? f).join(", ")}</div>
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
              Las filas para revisar a mano no se han tocado: corrígelas en el fichero o en la ficha del cliente.
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 2 && (
            <>
              <Button variant="outline" onClick={reset}>Elegir otro fichero</Button>
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
            <Button variant="outline" onClick={close}>{step === 3 ? "Cerrar" : "Cancelar"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
