/**
 * Arqueo: recuento por billetes y monedas y lo declarado por el datáfono, Bizum u otros. El servidor calcula lo
 * esperado y las diferencias (tpvAdvanced.createCount, idempotente por la clave del intento). Un arqueo no se edita.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/components/admin/PanelStates";
import { EUR_DENOMINATIONS, denominationLabel, isBill, type CountKind } from "@shared/tpvAdvanced";
import { newAttemptKey } from "../tpvKeys";
import { formatEur, parseAmount, parsePieces } from "./advLogic";

export default function AdvCountForm({ sessionId, kind, onDone }: { sessionId: number; kind: CountKind; onDone: () => void }) {
  const utils = trpc.useUtils();
  const [pieces, setPieces] = useState<Record<string, string>>({});
  const [declared, setDeclared] = useState({ card: "", bizum: "", other: "" });
  const [notes, setNotes] = useState("");
  const [attempt, setAttempt] = useState(newAttemptKey);
  const save = trpc.tpvAdvanced.createCount.useMutation({
    onSuccess: () => {
      utils.tpvAdvanced.sessionDetail.invalidate({ sessionId });
      setAttempt(newAttemptKey());
      toast.success("Arqueo registrado");
      onDone();
    },
    onError: (e) => toast.error(errorMessage(e, "No se ha podido registrar el arqueo.")),
  });

  const parsed = useMemo(() => {
    const out: Record<string, number> = {};
    let total = 0;
    let bad = false;
    for (const d of EUR_DENOMINATIONS) {
      const n = parsePieces(pieces[d] ?? "");
      if (n === null) bad = true;
      else if (n > 0) {
        out[String(d)] = n;
        total += d * n;
      }
    }
    return { out, total: total / 100, bad };
  }, [pieces]);
  const dec = { card: parseAmount(declared.card), bizum: parseAmount(declared.bizum), other: parseAmount(declared.other) };
  const decBad = (["card", "bizum", "other"] as const).some((k) => declared[k].trim() !== "" && dec[k] === null);

  const row = (filter: (d: number) => boolean, title: string) => (
    <fieldset className="space-y-2">
      <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</legend>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {EUR_DENOMINATIONS.filter(filter).map((d) => (
          <div key={d} className="space-y-1">
            <Label htmlFor={`den-${d}`} className="text-xs">{denominationLabel(d)}</Label>
            <Input id={`den-${d}`} inputMode="numeric" value={pieces[d] ?? ""} onChange={(e) => setPieces((p) => ({ ...p, [d]: e.target.value }))} placeholder="0" />
          </div>
        ))}
      </div>
    </fieldset>
  );

  return (
    <form
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (parsed.bad || decBad) return;
        save.mutate({ sessionId, kind, denominations: parsed.out, declaredCard: dec.card, declaredBizum: dec.bizum, declaredOther: dec.other, notes: notes.trim() || null, idempotencyKey: attempt });
      }}
    >
      <h3 className="text-sm font-semibold text-foreground">{kind === "closing" ? "Arqueo de cierre" : "Arqueo intermedio"}</h3>
      {row(isBill, "Billetes (cuántos de cada)")}
      {row((d) => !isBill(d), "Monedas (cuántas de cada)")}
      <p className="text-sm text-foreground">Efectivo contado: <span className="font-semibold tabular-nums">{formatEur(parsed.total)}</span></p>
      <fieldset className="space-y-2">
        <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lo que dice el datáfono y los demás cobros (opcional)</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {([["card", "Tarjeta (total del datáfono)"], ["bizum", "Bizum recibido"], ["other", "Otros cobros"]] as const).map(([k, label]) => (
            <div key={k} className="space-y-1">
              <Label htmlFor={`dec-${k}`} className="text-xs">{label}</Label>
              <Input id={`dec-${k}`} inputMode="decimal" value={declared[k]} onChange={(e) => setDeclared((d) => ({ ...d, [k]: e.target.value }))} placeholder="Sin declarar" />
            </div>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <Label htmlFor="count-notes" className="text-xs">Notas</Label>
        <Input id="count-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Opcional" />
      </div>
      {(parsed.bad || decBad) && <p className="text-sm text-danger">Revisa las cantidades: solo números enteros en billetes y monedas, e importes en euros.</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onDone} disabled={save.isPending}>Cancelar</Button>
        <Button type="submit" size="sm" disabled={save.isPending || parsed.bad || decBad}>{save.isPending ? "Guardando…" : "Registrar arqueo"}</Button>
      </div>
    </form>
  );
}
