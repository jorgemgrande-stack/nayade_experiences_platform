/**
 * Correcciones de una caja YA cerrada: el cierre no cambia; cada corrección queda aparte con su motivo, autor y fecha
 * (tpv.addClosedSessionCorrection, idempotente por la clave de cada intento).
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { formatEur } from "@shared/creditNoteForm";
import { parseCashInput } from "@shared/cashAmount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/components/admin/PanelStates";
import { selectClass } from "@/components/admin/crm/CrmParts";
import { newAttemptKey } from "./tpvKeys";

const KIND_LABELS: Record<string, string> = {
  cash_in: "Entrada de efectivo",
  cash_out: "Salida de efectivo",
  count_adjustment: "Ajuste del recuento",
};

type Correction = { id: number; kind: string; amount: number; reason: string; createdByName: string | null; createdAt: number };

export default function TpvClosedCorrections({ sessionId, corrections, canManage }: { sessionId: number; corrections: Correction[]; canManage: boolean }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: "cash_in", amount: "", reason: "" });
  const [attempt, setAttempt] = useState(newAttemptKey);
  // TPV Advanced: número de la autorización de un supervisor, si la regla de la empresa la pide
  const [authId, setAuthId] = useState("");
  const advanced = trpc.tpv.planInfo.useQuery(undefined, { retry: false, staleTime: 60_000 }).data?.advanced === true;
  const add = trpc.tpv.addClosedSessionCorrection.useMutation({
    onSuccess: () => {
      utils.tpv.getSessionSummary.invalidate({ sessionId });
      setForm({ kind: "cash_in", amount: "", reason: "" });
      setAttempt(newAttemptKey());
      setAuthId("");
      setOpen(false);
      toast.success("Corrección registrada. El cierre original se conserva.");
    },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido registrar la corrección.")),
  });
  // Admite «1.234,56» y, en el ajuste del recuento, el signo menos
  const raw = form.amount.trim();
  const negative = raw.startsWith("-");
  const parsed = parseCashInput(negative ? raw.slice(1) : raw);
  const amount = parsed === null ? NaN : negative ? -parsed : parsed;
  const valid = Number.isFinite(amount) && amount !== 0 && (form.kind === "count_adjustment" || amount > 0) && form.reason.trim().length >= 5;

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">Correcciones después del cierre</h3>
        {canManage && !open && <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Añadir corrección</Button>}
      </div>
      {corrections.length === 0 && !open && <p className="text-xs text-muted-foreground">Sin correcciones. El cierre no se modifica nunca: si hay que corregir algo, queda anotado aquí.</p>}
      {corrections.length > 0 && (
        <ul className="space-y-1">
          {corrections.map((c) => (
            <li key={c.id} className="text-sm flex flex-wrap justify-between gap-2">
              <span className="text-foreground">{KIND_LABELS[c.kind] ?? c.kind} · {c.reason}</span>
              <span className="text-muted-foreground">{formatEur(c.amount)} · {c.createdByName ?? "—"} · {new Date(c.createdAt).toLocaleString("es-ES")}</span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <form
          className="grid gap-2 sm:grid-cols-3"
          onSubmit={(e) => { e.preventDefault(); if (valid) add.mutate({ sessionId, kind: form.kind as "cash_in", amount, reason: form.reason.trim(), idempotencyKey: attempt, ...(authId ? { authorizationId: Number(authId) } : {}) }); }}
        >
          <div className="space-y-1">
            <Label htmlFor="corr-kind">Tipo</Label>
            <select id="corr-kind" className={selectClass} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
              {Object.entries(KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="corr-amount">Importe (€)</Label>
            <Input id="corr-amount" inputMode="decimal" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder={form.kind === "count_adjustment" ? "Ej.: -5,00" : "Ej.: 12,50"} />
          </div>
          {advanced && (
            <div className="space-y-1">
              <Label htmlFor="corr-auth">Autorización (si te la piden)</Label>
              <Input id="corr-auth" inputMode="numeric" value={authId} onChange={(e) => setAuthId(e.target.value.replace(/\D/g, ""))} placeholder="Nº de autorización" />
            </div>
          )}
          <div className="space-y-1 sm:col-span-3">
            <Label htmlFor="corr-reason">Motivo</Label>
            <Input id="corr-reason" maxLength={500} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Qué pasó y por qué se corrige" />
          </div>
          <div className="sm:col-span-3 flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)} disabled={add.isPending}>Cancelar</Button>
            <Button type="submit" size="sm" disabled={!valid || add.isPending}>{add.isPending ? "Guardando…" : "Registrar corrección"}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
