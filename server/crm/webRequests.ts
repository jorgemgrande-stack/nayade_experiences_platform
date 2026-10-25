/**
 * Solicitudes comerciales desde la web pública (www.bigelephant.es).
 *
 * Reglas:
 *  - Cada envío es una solicitud (`crm_lead_requests`) que cuelga de un lead. No hay bandeja aparte:
 *    el lead sigue su ciclo normal (estado, responsable, historial, conversión a empresa y oportunidad).
 *  - Idempotencia: la misma `Idempotency-Key` devuelve siempre la misma respuesta; con otro contenido, conflicto.
 *  - Duplicados: si el correo ya tiene un lead abierto se reutiliza; solo se rellenan campos vacíos
 *    (nunca se sobrescriben datos comerciales). El mismo envío repetido en 24 h no crea otra solicitud.
 *  - Nada se aprovisiona: una solicitud de prueba queda pendiente hasta que el equipo la active desde el CRM.
 */
import crypto from "node:crypto";
import type { CrmService } from "./service";
import { DuplicateKeyError, type CrmStore } from "./store";
import {
  CrmError,
  LEAD_REQUEST_LABEL,
  type Lead,
  type LeadRequest,
  type LeadRequestStatus,
  type LeadRequestType,
  type RequestConfiguration,
} from "./types";

export const WEB_SOURCE = "web";
export const WEB_AUTHOR = "web:public";
const DUPLICATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const SCAN_LIMIT = 5000;

export interface WebRequestInput {
  type: LeadRequestType;
  name: string;
  email: string;
  phone?: string | null;
  company: string;
  sector?: string | null;
  message?: string | null;
  configuration?: RequestConfiguration | null;
  interest?: string | null;
  preferredTime?: string | null;
  sourcePage?: string | null;
  utm?: Record<string, string> | null;
  marketingConsent: boolean;
  privacyVersion: string;
}

export type ReceiveOutcome = "created" | "replayed" | "duplicate";

/** Lo que el CRM ve de una solicitud: sin clave de idempotencia, huella ni seudónimo de IP. */
export type LeadRequestView = Omit<LeadRequest, "idempotencyKey" | "payloadHash" | "ipHash">;
export interface InboxRow {
  request: LeadRequestView;
  lead: Pick<Lead, "id" | "name" | "email" | "phone" | "companyName" | "status" | "owner" | "priority">;
}

const view = ({ idempotencyKey: _k, payloadHash: _h, ipHash: _i, ...r }: LeadRequest): LeadRequestView => r;

/** Huella estable del contenido (claves ordenadas). */
export function payloadHash(input: WebRequestInput): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  return crypto.createHash("sha256").update(JSON.stringify(canon({ ...input, email: input.email.trim().toLowerCase() }))).digest("hex");
}

const REF_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newReference(): string {
  const bytes = crypto.randomBytes(8);
  return "SOL-" + Array.from(bytes, (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join("");
}

export class WebRequestService {
  private locks = new Map<string, Promise<unknown>>();
  private now: () => number;

  constructor(
    private d: {
      store: CrmStore;
      crm: CrmService;
      now?: () => number;
      /** Tras registrar una solicitud NUEVA (aviso interno al equipo). Nunca retrasa ni rompe la respuesta. */
      onCreated?: (r: LeadRequest) => void | Promise<void>;
    },
  ) {
    this.now = d.now ?? Date.now;
  }

  /**
   * Registra una solicitud de la web. Serializa por correo dentro del proceso para que dos envíos
   * simultáneos de la misma persona no creen dos leads.
   */
  async receive(input: WebRequestInput, ctx: { idempotencyKey: string; ipHash: string | null }): Promise<{ outcome: ReceiveOutcome; request: LeadRequest }> {
    const email = input.email.trim().toLowerCase();
    const prev = this.locks.get(email) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(() => this.receiveLocked(input, email, ctx));
    this.locks.set(email, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(email) === run) this.locks.delete(email);
    }
  }

  private async receiveLocked(input: WebRequestInput, email: string, ctx: { idempotencyKey: string; ipHash: string | null }) {
    const hash = payloadHash(input);
    const replay = await this.byIdempotencyKey(ctx.idempotencyKey);
    if (replay) {
      if (replay.payloadHash !== hash) throw new CrmError("conflict", "La clave de idempotencia ya se usó con otro contenido");
      return { outcome: "replayed" as const, request: replay };
    }

    const lead = await this.leadFor(input, email);
    const recent = (await this.d.store.list("leadRequests", { leadId: lead.id, type: input.type, status: "pending" }, { desc: true, limit: 50 })).find(
      (r) => r.payloadHash === hash && this.now() - r.createdAt < DUPLICATE_WINDOW_MS,
    );
    // Carrera entre réplicas con la MISMA clave: otra instancia la insertó entre la consulta de la clave y esta. Es un
    // reintento, no una solicitud repetida (ni se anota como tal en el lead)
    if (recent && recent.idempotencyKey === ctx.idempotencyKey) return { outcome: "replayed" as const, request: recent };
    if (recent) {
      await this.d.crm.log("lead", lead.id, "note", `Solicitud web repetida: ${LEAD_REQUEST_LABEL[input.type]} (${recent.reference}); no se ha duplicado`, WEB_AUTHOR);
      return { outcome: "duplicate" as const, request: recent };
    }

    const now = this.now();
    for (let attempt = 0; ; attempt++) {
      try {
        const request = await this.d.store.insert("leadRequests", {
          leadId: lead.id,
          reference: newReference(),
          type: input.type,
          status: "pending",
          sector: input.sector ?? null,
          message: input.message ?? null,
          configuration: input.configuration ?? null,
          interest: input.interest ?? null,
          preferredTime: input.preferredTime ?? null,
          sourcePage: input.sourcePage ?? null,
          utm: input.utm && Object.keys(input.utm).length ? input.utm : null,
          privacyAcceptedAt: now,
          privacyVersion: input.privacyVersion,
          marketingConsent: input.marketingConsent,
          idempotencyKey: ctx.idempotencyKey,
          payloadHash: hash,
          ipHash: ctx.ipHash,
          attendedAt: null,
          attendedBy: null,
          createdAt: now,
        });
        await this.d.crm.log("lead", lead.id, "note", this.describe(request), WEB_AUTHOR);
        // La solicitud ya está guardada: el aviso va aparte, sin esperar, y su fallo nunca afecta a la captación
        const notify = this.d.onCreated;
        if (notify) setImmediate(() => void Promise.resolve().then(() => notify(request)).catch(() => undefined));
        return { outcome: "created" as const, request };
      } catch (e) {
        if (!(e instanceof DuplicateKeyError)) throw e;
        // Carrera con un reintento de la misma clave (otra instancia): se responde como reintento
        const same = await this.byIdempotencyKey(ctx.idempotencyKey);
        if (same) {
          if (same.payloadHash !== hash) throw new CrmError("conflict", "La clave de idempotencia ya se usó con otro contenido");
          return { outcome: "replayed" as const, request: same };
        }
        if (attempt >= 3) throw e; // colisión de referencia improbable: se reintenta con otra
      }
    }
  }

  /** La solicitud ya registrada con esa clave y ese contenido (reintento); conflicto si el contenido difiere. */
  async replayOf(key: string, input: WebRequestInput): Promise<LeadRequest | null> {
    const r = await this.byIdempotencyKey(key);
    if (r && r.payloadHash !== payloadHash(input)) throw new CrmError("conflict", "La clave de idempotencia ya se usó con otro contenido");
    return r;
  }

  private async byIdempotencyKey(key: string): Promise<LeadRequest | null> {
    return (await this.d.store.list("leadRequests", { idempotencyKey: key }, { limit: 1 }))[0] ?? null;
  }

  /** Lead abierto con ese correo (se completa sin sobrescribir) o uno nuevo con origen «web». */
  private async leadFor(input: WebRequestInput, email: string): Promise<Lead> {
    const leads = await this.d.store.list("leads", {}, { desc: true, limit: SCAN_LIMIT });
    const same = leads.filter((l) => l.email?.toLowerCase() === email);
    const open = same.find((l) => l.status !== "converted" && l.status !== "disqualified");
    if (open) {
      const fill: Partial<Lead> = {};
      const filled: string[] = [];
      if (!open.phone && input.phone) {
        fill.phone = input.phone;
        filled.push("teléfono");
      }
      if (!open.companyName && input.company) {
        fill.companyName = input.company;
        filled.push("empresa");
      }
      if (!filled.length) return open;
      const upd = await this.d.store.update("leads", open.id, { ...fill, updatedAt: this.now() });
      await this.d.crm.log("lead", open.id, "note", `Datos completados desde la web: ${filled.join(", ")}`, WEB_AUTHOR);
      return upd;
    }
    // Cliente ya convertido que vuelve a escribir: lead nuevo, enlazado a su empresa
    const converted = same.find((l) => l.status === "converted" && l.convertedCompanyId);
    return this.d.crm.createLead(
      {
        name: input.name,
        email,
        phone: input.phone ?? null,
        companyName: input.company,
        source: WEB_SOURCE,
        priority: input.type === "trial" || input.type === "onboarding" ? "high" : "normal",
        companyId: converted?.convertedCompanyId ?? null,
      },
      WEB_AUTHOR,
    );
  }

  /** Resumen para el historial del lead, sin datos personales. */
  private describe(r: LeadRequest): string {
    const parts = [`Solicitud web: ${LEAD_REQUEST_LABEL[r.type]} (${r.reference})`];
    const c = r.configuration;
    if (c) {
      const bits = [c.plan ? `plan ${c.plan}` : null, c.extensions.length ? `extensiones: ${c.extensions.join(", ")}` : null, c.industries.length ? `sector: ${c.industries.join(", ")}` : null, c.interests.length ? `interés: ${c.interests.join(", ")}` : null].filter(Boolean);
      if (bits.length) parts.push(`Configuración: ${bits.join("; ")}`);
    }
    if (r.interest) parts.push(`Sobre: ${r.interest}`);
    if (r.type === "onboarding") parts.push(r.preferredTime ? "Preferencia horaria indicada; el equipo propone la fecha" : "El equipo propone la fecha");
    if (r.type === "trial") parts.push("Pendiente de activación manual desde el CRM");
    return parts.join(". ").slice(0, 1000);
  }

  // ── Uso desde el CRM ───────────────────────────────────────────────────────

  /**
   * Bandeja de solicitudes. `companyId`: solo las de leads de esa empresa (enlazados a ella o ya
   * convertidos en ella), para la ficha de la empresa en el CRM.
   */
  async list(f: { type?: LeadRequestType; status?: LeadRequestStatus; owner?: string; q?: string; companyId?: number; limit?: number; offset?: number } = {}): Promise<{ rows: InboxRow[]; total: number }> {
    const filter: Partial<LeadRequest> = {};
    if (f.type) filter.type = f.type;
    if (f.status) filter.status = f.status;
    const [requests, leads] = await Promise.all([
      this.d.store.list("leadRequests", filter, { desc: true, limit: SCAN_LIMIT }),
      this.d.store.list("leads", {}, { limit: SCAN_LIMIT }),
    ]);
    const byId = new Map(leads.map((l) => [l.id, l]));
    const q = (f.q ?? "").trim().toLowerCase();
    let rows: InboxRow[] = requests.flatMap((r) => {
      const l = byId.get(r.leadId);
      if (!l) return [];
      if (f.companyId !== undefined && l.companyId !== f.companyId && l.convertedCompanyId !== f.companyId) return [];
      return [{ request: view(r), lead: { id: l.id, name: l.name, email: l.email, phone: l.phone, companyName: l.companyName, status: l.status, owner: l.owner, priority: l.priority } }];
    });
    if (f.owner === "-") rows = rows.filter((x) => !x.lead.owner);
    else if (f.owner) rows = rows.filter((x) => x.lead.owner === f.owner);
    if (q) rows = rows.filter((x) => [x.lead.name, x.lead.email, x.lead.companyName, x.request.reference].some((v) => (v ?? "").toLowerCase().includes(q)));
    const offset = Math.max(0, f.offset ?? 0);
    const limit = Math.min(100, Math.max(1, f.limit ?? 25));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  }

  async forLead(leadId: number): Promise<LeadRequestView[]> {
    return (await this.d.store.list("leadRequests", { leadId }, { desc: true, limit: 200 })).map(view);
  }

  /** Atender o descartar (y reabrir). Al atender la primera, un lead nuevo pasa a «contactado». */
  async setStatus(id: number, status: LeadRequestStatus, author: string): Promise<LeadRequestView> {
    const cur = await this.d.store.get("leadRequests", id);
    if (!cur) throw new CrmError("not_found", "Solicitud no encontrada");
    if (cur.status === status) return view(cur);
    const upd = await this.d.store.update("leadRequests", id, {
      status,
      attendedAt: status === "pending" ? null : this.now(),
      attendedBy: status === "pending" ? null : author.slice(0, 100),
    });
    const label = { pending: "pendiente", attended: "atendida", discarded: "descartada" }[status];
    await this.d.crm.log("lead", cur.leadId, "note", `Solicitud ${cur.reference} marcada como ${label}`, author);
    if (status === "attended") {
      const lead = await this.d.store.get("leads", cur.leadId);
      if (lead?.status === "new") await this.d.crm.setLeadStatus(lead.id, "contacted", author);
    }
    return view(upd);
  }

  async summary(): Promise<{ pending: number; byType: Record<LeadRequestType, number> }> {
    const pending = await this.d.store.list("leadRequests", { status: "pending" }, { limit: SCAN_LIMIT });
    const byType = Object.fromEntries(Object.keys(LEAD_REQUEST_LABEL).map((k) => [k, 0])) as Record<LeadRequestType, number>;
    for (const r of pending) byType[r.type] += 1;
    return { pending: pending.length, byType };
  }
}
