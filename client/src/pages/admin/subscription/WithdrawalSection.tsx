/**
 * Desistimiento del contrato (particulares, 14 días; Directiva (UE) 2023/2673): botón visible durante el plazo,
 * confirmación expresa y justificante con referencia, fecha y hora. Es distinto de cancelar la suscripción (que
 * termina al final del periodo pagado, sin reembolso). Todo lo decide y registra el servidor.
 */
import { randomId } from "@shared/randomId";
import { useMemo, useState } from "react";
import { FileCheck2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Status = {
  available: boolean;
  assessment: { applicability: string; deadlineAt: number | null; withinTerm: boolean; summary: string };
  request: { reference: string; status: string; requestedAt: number } | null;
};
type Receipt = { reference: string; requestedAt: number; text: string; receiptSent: boolean };

const STATUS_LABEL: Record<string, string> = {
  received: "Recibida",
  under_review: "En revisión",
  accepted: "Aceptada",
  rejected: "Rechazada",
  completed: "Completada",
};
const fmt = (ms: number) => new Date(ms).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "long", timeStyle: "short" });
const newKey = () => randomId().replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

export function WithdrawalSection() {
  const utils = trpc.useUtils();
  const q = trpc.subscription.withdrawalStatus.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const [statement, setStatement] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  // Una clave por intento: repetir el envío (doble clic, reintento) no crea otra solicitud
  const key = useMemo(newKey, []);
  const withdraw = trpc.subscription.withdraw.useMutation({
    onSuccess: (r) => {
      const rec = (r as { receipt: Receipt }).receipt;
      setReceipt(rec);
      toast.success(`Solicitud de desistimiento registrada (${rec.reference})`);
      void utils.subscription.withdrawalStatus.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const s = q.data as Status | null | undefined;
  if (!s || s.assessment.applicability !== "applicable") return null;
  const last = s.request;

  return (
    <section id="desistimiento" className="rounded-2xl border border-border bg-card p-6 space-y-3" aria-labelledby="sub-withdrawal">
      <h2 id="sub-withdrawal" className="font-semibold text-foreground flex items-center gap-2">
        <Undo2 className="w-4 h-4" aria-hidden="true" /> Desistimiento del contrato
      </h2>

      {receipt && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm dark:border-emerald-500/40 dark:bg-emerald-500/10" role="status">
          <p className="font-medium flex items-center gap-2">
            <FileCheck2 className="w-4 h-4" aria-hidden="true" /> Justificante {receipt.reference}
          </p>
          <p className="mt-1">{receipt.text}</p>
          <p className="mt-1 text-muted-foreground">{receipt.receiptSent ? "También te lo hemos enviado por correo." : "Guarda esta referencia: es tu justificante."}</p>
        </div>
      )}

      {last && !receipt && (
        <p className="text-sm">
          Solicitud <strong>{last.reference}</strong> del {fmt(last.requestedAt)}: <Badge variant="secondary">{STATUS_LABEL[last.status] ?? last.status}</Badge>
        </p>
      )}

      {s.available ? (
        <>
          <p className="text-sm text-muted-foreground">
            Como particular, puedes desistir del contrato sin dar ningún motivo hasta el <strong>{s.assessment.deadlineAt ? fmt(s.assessment.deadlineAt) : "fin del plazo"}</strong>.
            Si pediste empezar a usar el servicio de inmediato, se descontará la parte ya prestada. Esto no es lo mismo que cancelar la suscripción, que termina al final del periodo pagado.
          </p>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline">Desistir del contrato aquí</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Confirmar desistimiento</AlertDialogTitle>
                <AlertDialogDescription>
                  Vas a comunicar que desistes del contrato de Elephant Source. Recibirás un justificante con la fecha y la hora. Revisaremos la solicitud y te informaremos de la resolución y del reembolso que corresponda.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <label className="text-sm font-medium" htmlFor="withdrawal-statement">
                Comentario (opcional)
              </label>
              <Textarea id="withdrawal-statement" maxLength={1000} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="No es necesario indicar el motivo" />
              <AlertDialogFooter>
                <AlertDialogCancel>Volver</AlertDialogCancel>
                <AlertDialogAction disabled={withdraw.isPending} onClick={() => withdraw.mutate({ idempotencyKey: key, ...(statement.trim() ? { statement: statement.trim() } : {}) })}>
                  Confirmar desistimiento
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : (
        !last && <p className="text-sm text-muted-foreground">{s.assessment.summary}</p>
      )}
    </section>
  );
}
