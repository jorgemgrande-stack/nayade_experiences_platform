/**
 * Justificantes de los pagos por transferencia de los cargos (notas de cobro de clientes externos, CRM 0050).
 *
 * El justificante es la prueba que APORTA el administrador al confirmar el pago: no se lee ni se valida su contenido
 * (sin OCR, sin consulta al banco, sin comprobaciones automáticas del documento). Solo las de seguridad, las mismas que
 * los adjuntos de las finanzas: base64 estricto, no vacío, hasta 10 MB y que sea un PDF de verdad (firma «%PDF-», no
 * la extensión).
 *
 * Se guarda en el almacén privado ya existente del plano de control (`fin_documents`, CRM 0035: el contenido vive en la
 * propia BD, nunca en un bucket público ni con URL directa) con el tipo de propietario `charge_receipt` y el id del
 * cargo. Ese tipo no está entre los de las finanzas (`DOCUMENT_OWNERS`): las rutas de documentos de las finanzas no lo
 * listan ni lo aceptan; solo se sirve desde la ficha de la operación, a quien tiene `orders:approve`. Nunca se borra.
 */
import { createHash } from "node:crypto";
import { InvoicingError } from "./types";

export const RECEIPT_OWNER = "charge_receipt";
export const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export interface ReceiptDoc {
  id: number;
  /** Cargo al que pertenece (fin_documents.owner_id). */
  chargeId: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  createdAt: number;
}

export interface ReceiptFile {
  filename: string;
  content: Buffer;
  sha256: string;
}

export interface ReceiptStore {
  put(chargeId: number, file: ReceiptFile, by: string, at: number): Promise<ReceiptDoc>;
  /** Solo justificantes de cargos (otro tipo de documento: null). */
  get(id: number): Promise<ReceiptDoc | null>;
  content(id: number): Promise<Buffer | null>;
}

const bad = (m: string) => new InvoicingError("invalid_input", m);

/** Nombre seguro para guardar y servir (sin rutas, comillas ni caracteres de control); siempre acaba en .pdf. */
export function receiptFilename(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|*?:;]/g, "").trim().slice(0, 180) || "justificante";
  return /\.pdf$/i.test(clean) ? clean : `${clean}.pdf`;
}

/** Comprueba y decodifica el justificante (solo seguridad: tamaño, base64 y firma de PDF). */
export function parseReceipt(i: { filename?: string | null; contentBase64?: string | null } | null | undefined): ReceiptFile {
  if (!i || typeof i.contentBase64 !== "string" || !i.contentBase64) throw bad("Adjunta el justificante de la transferencia en PDF: es obligatorio");
  const clean = i.contentBase64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean) || clean.length % 4 !== 0) throw bad("El justificante no es un fichero válido (base64)");
  if ((clean.length / 4) * 3 > MAX_RECEIPT_BYTES + 3) throw bad("El justificante supera el máximo de 10 MB");
  const content = Buffer.from(clean, "base64");
  if (!content.length) throw bad("El justificante está vacío");
  if (content.length > MAX_RECEIPT_BYTES) throw bad("El justificante supera el máximo de 10 MB");
  const pdf = content.length >= 5 && content[0] === 0x25 && content[1] === 0x50 && content[2] === 0x44 && content[3] === 0x46 && content[4] === 0x2d;
  if (!pdf) throw bad("El justificante debe ser un PDF (se comprueba el contenido, no la extensión)");
  return { filename: receiptFilename(i.filename ?? ""), content, sha256: createHash("sha256").update(content).digest("hex") };
}

export class MemoryReceiptStore implements ReceiptStore {
  rows: Array<ReceiptDoc & { content: Buffer }> = [];
  async put(chargeId: number, f: ReceiptFile, by: string, at: number) {
    const row = { id: this.rows.length + 1, chargeId, filename: f.filename, mime: "application/pdf", sizeBytes: f.content.length, sha256: f.sha256, uploadedBy: by, createdAt: at, content: Buffer.from(f.content) };
    this.rows.push(row);
    const { content: _c, ...doc } = row;
    return { ...doc };
  }
  async get(id: number) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    const { content: _c, ...doc } = r;
    return { ...doc };
  }
  async content(id: number) {
    const r = this.rows.find((x) => x.id === id);
    return r ? Buffer.from(r.content) : null;
  }
}

/** Documento de `fin_documents` tal y como lo devuelve el almacén de las finanzas. */
interface FinDocumentLike {
  id: number;
  ownerType: string;
  ownerId: number;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  uploadedBy: string;
  createdAt: number;
}
export interface FinanceDocumentsPort {
  insertDocument(d: { ownerType: never; ownerId: number; filename: string; mime: string; sizeBytes: number; sha256: string; uploadedBy: string; createdAt: number }, content: Buffer): Promise<FinDocumentLike>;
  getDocument(id: number): Promise<FinDocumentLike | null>;
  getDocumentContent(id: number): Promise<Buffer | null>;
}

/** Justificantes sobre el almacén privado de las finanzas (`fin_documents`). */
export function receiptsOnFinanceDocuments(docs: FinanceDocumentsPort): ReceiptStore {
  const of = (d: FinDocumentLike): ReceiptDoc => ({ id: d.id, chargeId: d.ownerId, filename: d.filename, mime: d.mime, sizeBytes: d.sizeBytes, sha256: d.sha256, uploadedBy: d.uploadedBy, createdAt: d.createdAt });
  return {
    async put(chargeId, f, by, at) {
      // El tipo de propietario es propio de los cobros (no es de las finanzas): de ahí la conversión
      const d = await docs.insertDocument({ ownerType: RECEIPT_OWNER as never, ownerId: chargeId, filename: f.filename, mime: "application/pdf", sizeBytes: f.content.length, sha256: f.sha256, uploadedBy: by.slice(0, 100), createdAt: at }, f.content);
      return of(d);
    },
    async get(id) {
      const d = await docs.getDocument(id);
      return d && d.ownerType === RECEIPT_OWNER ? of(d) : null;
    },
    async content(id) {
      const d = await docs.getDocument(id);
      return d && d.ownerType === RECEIPT_OWNER ? docs.getDocumentContent(id) : null;
    },
  };
}
