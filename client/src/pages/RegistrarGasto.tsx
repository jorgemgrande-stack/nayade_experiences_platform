import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Upload, AlertCircle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── helpers ──────────────────────────────────────────────────────────────────
const token = new URLSearchParams(window.location.search).get("t") ?? "";

const ALLOWED_EXTS = ["jpg", "jpeg", "png", "webp", "pdf"];
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
const MAX_BYTES = 10 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── No disponible ─────────────────────────────────────────────────────────────
function NoDisponible() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
      <div className="text-center space-y-3">
        <AlertCircle className="w-12 h-12 text-slate-500 mx-auto" />
        <p className="text-slate-400 text-lg">Formulario no disponible</p>
      </div>
    </div>
  );
}

// ─── Componente principal ──────────────────────────────────────────────────────
export default function RegistrarGasto() {
  // Inyectar meta noindex (no accesible sin token; igualmente no indexable)
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  if (!token) return <NoDisponible />;

  return <GastoForm token={token} />;
}

// ─── Formulario ───────────────────────────────────────────────────────────────
function GastoForm({ token }: { token: string }) {
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: categories, isLoading: catsLoading, error: catsError } =
    trpc.publicExpenses.categories.useQuery({ token }, { retry: false });

  const submitMut = trpc.publicExpenses.submit.useMutation({
    onSuccess: () => setSubmitted(true),
  });

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFileError("");
    const f = e.target.files?.[0];
    if (!f) { setFile(null); return; }

    const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ALLOWED_EXTS.includes(ext) || !ALLOWED_MIME.has(f.type)) {
      setFileError("Formato no permitido. Usa JPG, PNG, WEBP o PDF.");
      setFile(null);
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError("El archivo supera el tamaño máximo de 10 MB.");
      setFile(null);
      return;
    }
    setFile(f);
  }

  function removeFile() {
    setFile(null);
    setFileError("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(amount.replace(",", "."));
    if (isNaN(amt) || amt <= 0) return;
    if (!categoryId) return;

    let filePayload: { fileName: string; mimeType: string; base64: string } | undefined;
    if (file) {
      const base64 = await fileToBase64(file);
      filePayload = { fileName: file.name, mimeType: file.type, base64 };
    }

    submitMut.mutate({
      token,
      amount: amt.toFixed(2),
      categoryId: parseInt(categoryId),
      notes: notes.trim() || undefined,
      file: filePayload,
    });
  }

  function resetForm() {
    setAmount("");
    setCategoryId("");
    setNotes("");
    setFile(null);
    setFileError("");
    setSubmitted(false);
    submitMut.reset();
    if (fileRef.current) fileRef.current.value = "";
  }

  // Token inválido según el servidor
  if (catsError?.data?.code === "NOT_FOUND") return <NoDisponible />;

  // ── Éxito ──
  if (submitted) {
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center px-4">
        <div className="w-full max-w-sm text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
          <div className="space-y-2">
            <h2 className="text-white text-xl font-semibold">Gasto enviado correctamente</h2>
            <p className="text-slate-400 text-sm leading-relaxed">
              Queda pendiente de revisión por administración.
            </p>
          </div>
          <Button
            onClick={resetForm}
            className="w-full bg-[#e8b86d] hover:bg-[#d4a55a] text-black font-medium"
          >
            Registrar otro gasto
          </Button>
        </div>
      </div>
    );
  }

  // ── Formulario ──
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        {/* Header */}
        <div className="text-center space-y-1">
          <p className="text-[#e8b86d] text-xs font-medium tracking-widest uppercase">
            Nayade Experiences
          </p>
          <h1 className="text-white text-2xl font-bold">Registrar gasto</h1>
          <p className="text-slate-400 text-sm">
            Rellena los datos y adjunta el ticket o factura.
          </p>
        </div>

        {/* Error global */}
        {submitMut.error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{submitMut.error.message}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Importe */}
          <div className="space-y-1.5">
            <label className="text-slate-300 text-sm font-medium">
              Importe <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0,00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                required
                className="bg-slate-900 border-slate-700 text-white pr-10 placeholder:text-slate-600
                  focus:border-[#e8b86d] focus:ring-[#e8b86d]/20"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">
                €
              </span>
            </div>
          </div>

          {/* Categoría */}
          <div className="space-y-1.5">
            <label className="text-slate-300 text-sm font-medium">
              Categoría <span className="text-red-400">*</span>
            </label>
            {catsLoading ? (
              <div className="flex items-center gap-2 text-slate-400 text-sm py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Cargando categorías…
              </div>
            ) : (
              <Select value={categoryId} onValueChange={setCategoryId} required>
                <SelectTrigger className="bg-slate-900 border-slate-700 text-white focus:border-[#e8b86d]">
                  <SelectValue placeholder="Selecciona una categoría" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {(categories ?? []).map(cat => (
                    <SelectItem
                      key={cat.id}
                      value={String(cat.id)}
                      className="text-white focus:bg-slate-800"
                    >
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Notas */}
          <div className="space-y-1.5">
            <label className="text-slate-300 text-sm font-medium">
              Notas
            </label>
            <Textarea
              placeholder="Concepto, motivo, proveedor u otras observaciones…"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              className="bg-slate-900 border-slate-700 text-white placeholder:text-slate-600
                focus:border-[#e8b86d] focus:ring-[#e8b86d]/20 resize-none"
            />
          </div>

          {/* Adjunto */}
          <div className="space-y-1.5">
            <label className="text-slate-300 text-sm font-medium">Adjuntar archivo</label>
            {file ? (
              <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-md px-3 py-2">
                <Upload className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-white text-sm truncate flex-1">{file.name}</span>
                <button
                  type="button"
                  onClick={removeFile}
                  className="text-slate-400 hover:text-white transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <label
                className={cn(
                  "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed",
                  "border-slate-700 hover:border-slate-500 transition-colors cursor-pointer py-6 px-4",
                  "bg-slate-900/50",
                )}
              >
                <Upload className="w-6 h-6 text-slate-500" />
                <span className="text-slate-400 text-sm text-center">
                  Toca para seleccionar ticket o factura
                  <br />
                  <span className="text-slate-600 text-xs">JPG, PNG, WEBP, PDF · máx. 10 MB</span>
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".jpg,.jpeg,.png,.webp,.pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            )}
            {fileError && (
              <p className="text-red-400 text-xs flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                {fileError}
              </p>
            )}
          </div>

          {/* Enviar */}
          <Button
            type="submit"
            disabled={submitMut.isPending || !amount || !categoryId}
            className="w-full bg-[#e8b86d] hover:bg-[#d4a55a] text-black font-semibold disabled:opacity-50"
          >
            {submitMut.isPending ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Enviando…
              </>
            ) : (
              "Enviar gasto"
            )}
          </Button>
        </form>

        <p className="text-center text-slate-600 text-xs">
          El gasto quedará pendiente de revisión por el equipo de administración.
        </p>
      </div>
    </div>
  );
}
