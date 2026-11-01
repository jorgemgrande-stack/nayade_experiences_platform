/**
 * Importar clientes desde un CSV en tres pasos: subir el fichero, revisar qué pasará con cada fila y confirmar.
 * La vista previa no escribe nada; al confirmar se aplica exactamente lo revisado (las filas desmarcadas no).
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { toastError } from "@/lib/errorMessage";
import { Download, Upload, RefreshCw, CheckCircle2, AlertCircle } from "lucide-react";
import { CLIENT_CSV_MAX_BYTES, CLIENT_CSV_MAX_ROWS, clientCsvTemplate } from "@shared/clientImportCsv";

type Action = "create" | "update" | "unchanged" | "review" | "error";

const ACTION_LABEL: Record<Action, string> = {
  create: "Alta nueva",
  update: "Completar datos",
  unchanged: "Sin cambios",
  review: "Revisar a mano",
  error: "No se importa",
};
const ACTION_CLASS: Record<Action, string> = {
  create: "bg-emerald-500/15 text-emerald-300",
  update: "bg-blue-500/15 text-blue-300",
  unchanged: "bg-white/10 text-white/60",
  review: "bg-amber-500/15 text-amber-300",
  error: "bg-red-500/15 text-red-300",
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
      toast.success(`Importación terminada: ${r.created} altas y ${r.updated} clientes completados`);
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
      <DialogContent className="max-w-3xl bg-[#0d1526] border-white/10 text-white">
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Upload className="w-5 h-5 text-blue-400" /> Importar clientes
          </DialogTitle>
          <DialogDescription className="text-white/60">
            Paso {step} de 3 · {step === 1 ? "Sube el fichero" : step === 2 ? "Revisa qué se hará con cada fila" : "Listo"}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-4 text-sm">
            <p className="text-white/70">
              Sube un fichero CSV (por ejemplo, guardado desde Excel) con una fila por cliente. Columnas reconocidas:
              nombre, email, teléfono, empresa, NIF, dirección, ciudad, código postal, país y notas. El email es
              obligatorio para dar de alta un cliente nuevo. Hasta {CLIENT_CSV_MAX_ROWS.toLocaleString("es-ES")} filas.
            </p>
            <p className="text-white/60">
              Si un cliente ya existe (mismo email, o mismo teléfono y nombre), solo se completan los datos que tenga
              vacíos: nunca se cambia lo que ya tiene. Antes de importar verás qué pasará con cada fila.
            </p>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-2 rounded-md bg-blue-600 hover:bg-blue-700 px-4 py-2 cursor-pointer font-medium">
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
              <Button variant="outline" onClick={() => downloadTextFile("plantilla-clientes.csv", clientCsvTemplate())} className="border-white/20 text-white">
                <Download className="w-4 h-4 mr-2" /> Descargar plantilla
              </Button>
            </div>
          </div>
        )}

        {step === 2 && plan && (
          <div className="space-y-3 text-sm">
            <p className="text-white/70">
              <strong className="text-white">{fileName}</strong>: {plan.totals.create} altas nuevas, {plan.totals.update} clientes a completar,
              {" "}{plan.totals.unchanged} sin cambios, {plan.totals.review} para revisar a mano y {plan.totals.error} que no se importan.
            </p>
            {plan.ignoredColumns.length > 0 && (
              <p className="text-white/50 text-xs">Columnas que no se usan: {plan.ignoredColumns.join(", ")}</p>
            )}
            <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-white/10">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-[#0d1526] text-white/50">
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
                      <tr key={r.line} className="border-t border-white/5 align-top">
                        <td className="p-2">
                          {canApply && (
                            <input type="checkbox" aria-label={`Importar la fila ${r.line}`} checked={!excluded.has(r.line)} onChange={() => toggle(r.line)} />
                          )}
                        </td>
                        <td className="p-2 text-white/50">{r.line}</td>
                        <td className="p-2">
                          <div className="text-white">{r.values.name || "—"}</div>
                          <div className="text-white/50">{[r.values.email, r.values.phone].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td className="p-2">
                          <span className={`inline-block rounded px-1.5 py-0.5 ${ACTION_CLASS[r.action as Action]}`}>{ACTION_LABEL[r.action as Action]}</span>
                          {r.action === "update" && r.fill && (
                            <div className="text-white/50 mt-1">Se añade: {Object.keys(r.fill).map((f) => FIELD_LABEL[f] ?? f).join(", ")}</div>
                          )}
                          {r.reason && <div className="text-white/50 mt-1">{r.reason}</div>}
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
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <p className="text-white/80">
              Se han dado de alta {result.created} clientes y se han completado los datos de {result.updated}.
              Las filas para revisar a mano no se han tocado: corrígelas en el fichero o en la ficha del cliente.
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 2 && (
            <>
              <Button variant="outline" onClick={reset} className="border-white/15 text-white/70">Elegir otro fichero</Button>
              <Button
                onClick={() => plan && apply.mutate({ csv, fingerprint: plan.fingerprint, excludeLines: Array.from(excluded) })}
                disabled={apply.isPending || chosen.length === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {apply.isPending ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : chosen.length === 0 ? <AlertCircle className="w-4 h-4 mr-2" /> : null}
                {chosen.length === 0 ? "Nada que importar" : `Importar ${chosen.length} ${chosen.length === 1 ? "cliente" : "clientes"}`}
              </Button>
            </>
          )}
          {step !== 2 && (
            <Button variant="outline" onClick={close} className="border-white/15 text-white/70">{step === 3 ? "Cerrar" : "Cancelar"}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
