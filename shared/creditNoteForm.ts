/**
 * Formulario «Emitir abono» (rectificativa): del estado de la pantalla a la petición al servidor.
 * Total = lo que quede por abonar de la factura. Parcial = líneas elegidas, cada una por unidades o por
 * importe con IVA. El servidor vuelve a aplicar todas las reglas (planCreditNote): esto solo evita enviar
 * peticiones imposibles y da el mensaje junto al campo.
 */
import { parseAmount } from "./directInvoice";

export type CreditNoteMode = "total" | "partial";
export type CreditNoteLineBy = "quantity" | "amount";

/** Lo que el usuario ha escrito para una línea de la factura. */
export interface CreditNoteLineDraft {
  selected: boolean;
  by: CreditNoteLineBy;
  value: string;
}

/** Datos de la línea de la factura que necesita el formulario (los da creditNotePreview). */
export interface CreditNoteLineInfo {
  itemIndex: number;
  description: string;
  quantity: number;
  remaining: number;
}

export interface CreditNoteLineRequest {
  itemIndex: number;
  quantity?: number;
  amount?: number;
}

export type CreditNoteSelection =
  | { ok: true; lines?: CreditNoteLineRequest[] }
  | { ok: false; errors: Record<string, string>; message: string };

/** Borrador inicial de una línea: sin marcar, por unidades, con todas las unidades. */
export function emptyLineDraft(line: Pick<CreditNoteLineInfo, "quantity">): CreditNoteLineDraft {
  return { selected: false, by: "quantity", value: String(line.quantity) };
}

/**
 * Selección de líneas para el servidor, o los errores por línea (`line<índice>`). En modo total no hay
 * líneas: se abona lo pendiente.
 */
export function buildCreditNoteSelection(mode: CreditNoteMode, lines: CreditNoteLineInfo[], drafts: Record<number, CreditNoteLineDraft>): CreditNoteSelection {
  if (mode === "total") return { ok: true };
  const errors: Record<string, string> = {};
  const out: CreditNoteLineRequest[] = [];
  for (const line of lines) {
    const d = drafts[line.itemIndex];
    if (!d?.selected) continue;
    const key = `line${line.itemIndex}`;
    if (!(line.remaining > 0)) {
      errors[key] = "Esta línea ya está abonada por completo";
      continue;
    }
    const n = parseAmount(d.value);
    if (!Number.isFinite(n) || !(n > 0)) {
      errors[key] = d.by === "quantity" ? "Indica cuántas unidades abonar" : "Indica el importe a abonar";
      continue;
    }
    if (d.by === "quantity") {
      if (n - line.quantity > 1e-9) {
        errors[key] = `Como máximo ${line.quantity} ${line.quantity === 1 ? "unidad" : "unidades"}`;
        continue;
      }
      // Todas las unidades = la línea entera (o lo que le quede por abonar)
      out.push(Math.abs(n - line.quantity) < 1e-9 ? { itemIndex: line.itemIndex } : { itemIndex: line.itemIndex, quantity: n });
    } else {
      if (n - line.remaining > 0.005) {
        errors[key] = `Como máximo ${formatEur(line.remaining)}`;
        continue;
      }
      out.push({ itemIndex: line.itemIndex, amount: Math.round(n * 100) / 100 });
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors, message: "Revisa las líneas marcadas" };
  if (!out.length) return { ok: false, errors: {}, message: "Marca al menos una línea que abonar" };
  return { ok: true, lines: out };
}

/** Motivo obligatorio del abono (consta en la rectificativa). */
export function validateCreditNoteReason(reason: string): string | null {
  return reason.trim() ? null : "Indica el motivo del abono";
}

export function formatEur(n: number): string {
  return n.toLocaleString("es-ES", { style: "currency", currency: "EUR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
