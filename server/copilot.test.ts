/**
 * Elephant Copilot avanzado sin base de datos y sin IA real (todo con dobles): lógica pura compartida (permisos por
 * rol y capacidad, fechas en hora de Madrid, recortes), herramientas de solo lectura sobre un doble de datos, servicio
 * (preguntas con herramientas, herramientas no permitidas, IA no disponible, cuota del ERM, historial por usuario,
 * protección contra ráfagas, borradores y consultas rápidas) y su registro (licencia, menú, migración).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeEach } from "vitest";
import {
  COPILOT_LIMITS,
  COPILOT_TOOLS,
  allowedTools,
  bucketOf,
  draftAllowed,
  madridDay,
  madridDayStartMs,
  resolveRange,
  slotRunsOn,
  toolResultText,
  type CopilotAccess,
  type CopilotPermission,
} from "../shared/copilot";
import { runTool, parseToolArgs } from "./copilot/tools";
import { CopilotError, CopilotService, AI_UNAVAILABLE_MESSAGE, type LlmFn, type LlmReply, type CopilotActor } from "./copilot/service";
import { MemoryCopilotStore } from "./copilot/store";
import type { CopilotData, ClientRow, ReservationRow, SaleRow, SlotRow } from "./copilot/data";
import { QuotaExceededError } from "./_core/erm/types";
import { TRPC_ROUTER_CAPABILITIES, capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { TASK_NAV } from "../shared/adminNav";

// Martes 10 de noviembre de 2026, 11:00 en Madrid
const NOW = Date.parse("2026-11-10T10:00:00Z");
const ALL_CAPS = ["shop-orders", "bill-cash", "bookings-generic", "crm-contacts", "crm-accounts", "crm-leads", "crm-quotes", "bill-invoices", "people-hr", "shop-catalog"];
const access = (perms: CopilotPermission[], caps: string[] = ALL_CAPS): CopilotAccess => ({ permissions: new Set(perms), capabilities: new Set(caps) });
const ADMIN = access(["crm", "finance", "hr"]);
const AGENTE = access(["crm"]);
const actor = (userId: number, a: CopilotAccess, name = "Ana"): CopilotActor => ({ userId, name, access: a });

// ── Doble de datos ─────────────────────────────────────────────────────────────

class FakeData implements CopilotData {
  calls: string[] = [];
  sales: SaleRow[] = [];
  res: ReservationRow[] = [];
  slots: SlotRow[] = [];
  clients: ClientRow[] = [];
  invoices: Array<{ id: number; number: string; clientName: string; total: number; status: string; issuedAt: number | null }> = [];
  creditRows: Array<{ creditNoteForId: number | null; total: number }> = [];
  async paidSales(fromMs: number, toMs: number) {
    this.calls.push("paidSales");
    return this.sales.filter((s) => s.at >= fromMs && s.at < toMs);
  }
  async reservations(from: string, to: string, max: number) {
    this.calls.push("reservations");
    return this.res.filter((r) => r.bookingDate >= from && r.bookingDate <= to).slice(0, max);
  }
  async activeSlots(ids: number[]) {
    return this.slots.filter((s) => ids.includes(s.productId));
  }
  async searchClients(text: string | null, max: number) {
    this.calls.push("searchClients");
    return this.clients.filter((c) => !text || c.name.toLowerCase().includes(text.toLowerCase())).slice(0, max);
  }
  async client(id: number) {
    this.calls.push("client");
    return this.clients.find((c) => c.id === id) ?? null;
  }
  async clientReservations(clientId: number) {
    return this.res.filter((r) => r.id === clientId * 100);
  }
  async openLeads() {
    return { rows: [], byStatus: [{ status: "nuevo", n: 3 }, { status: "contactado", n: 2 }] };
  }
  async pendingQuotes() {
    return { rows: [], count: 0, total: 0 };
  }
  async unpaidInvoices() {
    this.calls.push("unpaidInvoices");
    return this.invoices;
  }
  async credits(ids: number[]) {
    return this.creditRows.filter((c) => c.creditNoteForId != null && ids.includes(c.creditNoteForId));
  }
  async hrSummary() {
    this.calls.push("hrSummary");
    return { leave: [{ type: "vacaciones", requests: 2, days: 6 }], pending: 1, openClocks: 4 };
  }
  async product(id: number) {
    return id === 7 ? { id: 7, title: "Bautismo de buceo", shortDescription: "Primera inmersión", description: null, duration: "3 horas", basePrice: 59, currency: "EUR", minPersons: 1, maxPersons: 6, includes: ["Equipo", "Monitor"] } : null;
  }
}

const sale = (over: Partial<SaleRow>): SaleRow => ({ id: 1, merchantOrder: null, at: NOW, amountTotal: 0, amountPaid: 0, productId: 1, productName: "Kayak", people: 1, ...over });
const reservation = (over: Partial<ReservationRow>): ReservationRow => ({ id: 1, number: "RES-1", bookingDate: "2026-11-10", time: "10:00", productId: 1, productName: "Kayak", people: 2, customerName: "Luis", status: "paid", statusReservation: "CONFIRMADA", statusPayment: "PAGADO", slotId: null, ...over });
const client = (over: Partial<ClientRow>): ClientRow => ({ id: 1, name: "Marta Ruiz", email: "marta@example.test", phone: null, company: null, city: "Madrid", notes: null, tags: [], totalBookings: 3, totalSpent: 420.5, lastBookingAt: NOW, createdAt: NOW, ...over });

// ── Doble de IA ────────────────────────────────────────────────────────────────

type LlmCall = Parameters<LlmFn>[0];
function scriptedLlm(replies: Array<Partial<LlmReply> | Error>) {
  const calls: LlmCall[] = [];
  const fn: LlmFn = async (p) => {
    calls.push(structuredClone(p));
    const r = replies.shift();
    if (!r) throw new Error("La prueba no esperaba otra llamada a la IA");
    if (r instanceof Error) throw r;
    return { content: "", toolCalls: [], tokensIn: 10, tokensOut: 5, ...r };
  };
  return { fn, calls };
}
const aiUnavailable = () => Object.assign(new Error("La inteligencia artificial no está disponible para esta empresa."), { name: "AiUnavailableError" });

// ── Lógica pura ────────────────────────────────────────────────────────────────

describe("permisos de las herramientas por rol y por capacidad", () => {
  it("administración ve todo; ventas, solo los datos comerciales (sin facturación ni RRHH)", () => {
    expect(allowedTools(ADMIN).map((t) => t.name)).toEqual(COPILOT_TOOLS.map((t) => t.name));
    const ag = allowedTools(AGENTE).map((t) => t.name);
    expect(ag).toEqual(["reservas_proximas", "ocupacion", "buscar_clientes", "ficha_cliente", "oportunidades_abiertas", "presupuestos_pendientes"]);
    for (const hidden of ["ventas_periodo", "top_productos", "facturas_pendientes", "ausencias_rrhh"]) expect(ag).not.toContain(hidden);
  });
  it("sin la capacidad de los datos no se ofrece la herramienta (aunque el rol la vea)", () => {
    const names = allowedTools(access(["crm", "finance", "hr"], ["crm-contacts"])).map((t) => t.name);
    expect(names).toEqual(["buscar_clientes", "ficha_cliente"]);
    expect(allowedTools(access(["hr"], ["shop-orders"])).length).toBe(0);
    expect(allowedTools(access([], ALL_CAPS)).length).toBe(0);
  });
  it("borradores: exigen el CRM; resumen, la ficha de clientes; descripción, el catálogo", () => {
    expect(draftAllowed("respuesta_cliente", AGENTE)).toBe(true);
    expect(draftAllowed("resumen_cliente", access(["crm"], ["shop-catalog"]))).toBe(false);
    expect(draftAllowed("descripcion_producto", access(["crm"], ["crm-contacts"]))).toBe(false);
    expect(draftAllowed("respuesta_cliente", access(["finance"]))).toBe(false);
  });
});

describe("fechas en hora de Madrid", () => {
  it("día de Madrid y comienzo del día en invierno y en verano", () => {
    expect(madridDay(Date.parse("2026-11-09T23:30:00Z"))).toBe("2026-11-10");
    expect(new Date(madridDayStartMs("2026-11-10")).toISOString()).toBe("2026-11-09T23:00:00.000Z");
    expect(new Date(madridDayStartMs("2026-07-01")).toISOString()).toBe("2026-06-30T22:00:00.000Z");
  });
  it("intervalos por defecto, validación y límite", () => {
    expect(resolveRange({}, NOW, 30)).toEqual({ from: "2026-10-12", to: "2026-11-10" });
    expect(resolveRange({}, NOW, 7, true)).toEqual({ from: "2026-11-10", to: "2026-11-16" });
    expect(resolveRange({ desde: "2026-11-01" }, NOW, 30)).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(() => resolveRange({ desde: "2026-13-01" }, NOW, 30)).toThrow(/no válida/);
    expect(() => resolveRange({ desde: "2026-11-05", hasta: "2026-11-01" }, NOW, 30)).toThrow(/anterior/);
    expect(() => resolveRange({ desde: "2024-01-01", hasta: "2026-01-01" }, NOW, 30)).toThrow(/366/);
  });
  it("agrupación por semana (lunes) y mes; horarios por día de la semana", () => {
    expect(bucketOf("2026-11-15", "semana")).toBe("2026-11-09");
    expect(bucketOf("2026-11-15", "mes")).toBe("2026-11");
    expect(slotRunsOn("1,2,3,4,5", "2026-11-10")).toBe(true);
    expect(slotRunsOn("6,0", "2026-11-10")).toBe(false);
    expect(slotRunsOn(null, "2026-11-10")).toBe(true);
  });
  it("el resultado que se pasa a la IA se recorta avisando", () => {
    const t = toolResultText({ x: "a".repeat(10_000) });
    expect(t.length).toBeLessThan(COPILOT_LIMITS.toolResultMax + 200);
    expect(t).toMatch(/recortado/);
  });
});

// ── Herramientas ───────────────────────────────────────────────────────────────

describe("herramientas de solo lectura", () => {
  let data: FakeData;
  beforeEach(() => {
    data = new FakeData();
  });

  it("ventas por periodo: una operación por pedido, importe cobrado y fuera de rango excluido", async () => {
    data.sales = [
      sale({ id: 1, merchantOrder: "P1", amountTotal: 5000, amountPaid: 5000, at: Date.parse("2026-11-02T10:00:00Z") }),
      sale({ id: 2, merchantOrder: "P1", amountTotal: 3000, amountPaid: 0, at: Date.parse("2026-11-02T10:00:00Z") }),
      sale({ id: 3, amountTotal: 2000, amountPaid: 1000, at: Date.parse("2026-11-09T10:00:00Z") }),
      sale({ id: 4, amountTotal: 9900, amountPaid: 9900, at: Date.parse("2026-10-01T10:00:00Z") }),
    ];
    const r = await runTool("ventas_periodo", { desde: "2026-11-01", hasta: "2026-11-10", agrupar: "semana" }, data, NOW);
    expect(r).toMatchObject({ periodo: { desde: "2026-11-01", hasta: "2026-11-10" }, total: 90, operaciones: 2, ticketMedio: 45, agrupadoPor: "semana" });
    expect(r.evolucion).toEqual([{ periodo: "2026-11-02", total: 80, operaciones: 1 }, { periodo: "2026-11-09", total: 10, operaciones: 1 }]);
  });

  it("top productos por importe o por personas", async () => {
    data.sales = [sale({ id: 1, productName: "Kayak", amountPaid: 1000, people: 5 }), sale({ id: 2, productName: "Buceo", amountPaid: 5000, people: 1 }), sale({ id: 3, productName: "Kayak", amountPaid: 1000, people: 5 })];
    expect(((await runTool("top_productos", {}, data, NOW)).productos as any[]).map((p) => p.producto)).toEqual(["Buceo", "Kayak"]);
    expect(((await runTool("top_productos", { orden: "personas", limite: 1 }, data, NOW)).productos as any[])).toEqual([{ producto: "Kayak", importe: 20, personas: 10, ventas: 2 }]);
  });

  it("reservas próximas y ocupación frente al aforo de los horarios", async () => {
    data.res = [reservation({ id: 1, people: 6, slotId: 1 }), reservation({ id: 2, people: 4, status: "pending_payment", statusPayment: "PENDIENTE", slotId: 2 }), reservation({ id: 3, bookingDate: "2026-11-20" })];
    data.slots = [{ id: 1, productId: 1, label: "Mañana", startTime: "10:00", daysOfWeek: "1,2,3,4,5", capacity: 10 }, { id: 2, productId: 1, label: "Tarde", startTime: "16:00", daysOfWeek: null, capacity: 10 }];
    const r = await runTool("reservas_proximas", {}, data, NOW);
    expect(r).toMatchObject({ periodo: { desde: "2026-11-10", hasta: "2026-11-16" }, reservas: 2, personas: 10, pendientesDePago: 1 });
    expect((r.detalle as any[])[1]).toMatchObject({ pago: "pendiente de pago", cliente: "Luis" });
    const o = await runTool("ocupacion", {}, data, NOW);
    expect(o.dias).toEqual([{ fecha: "2026-11-10", producto: "Kayak", personas: 10, aforo: 20, ocupacion: "50 %" }]);
  });

  it("facturas pendientes descontando abonos (la misma regla que la portada)", async () => {
    data.invoices = [
      { id: 1, number: "F-1", clientName: "Ana", total: 100, status: "enviada", issuedAt: Date.parse("2026-10-11T10:00:00Z") },
      { id: 2, number: "F-2", clientName: "Bea", total: 50, status: "generada", issuedAt: NOW },
    ];
    data.creditRows = [{ creditNoteForId: 2, total: -50 }, { creditNoteForId: 1, total: -30 }];
    const r = await runTool("facturas_pendientes", {}, data, NOW);
    expect(r).toMatchObject({ facturasPendientes: 1, importePendiente: 70 });
    expect(r.detalle).toEqual([{ numero: "F-1", cliente: "Ana", pendiente: 70, emitida: "2026-10-11", dias: 30, estado: "enviada" }]);
  });

  it("parámetros: valores por defecto, null ignorado, fuera de rango rechazado", () => {
    expect(parseToolArgs("reservas_proximas", { dias: null, limite: "5" })).toEqual({ dias: 7, limite: 5 });
    expect(() => parseToolArgs("reservas_proximas", { dias: 90 })).toThrow(/Parámetros no válidos/);
    expect(() => parseToolArgs("ficha_cliente", {})).toThrow(/clienteId/);
  });

  it("ficha de un cliente que no existe: aviso, sin inventar", async () => {
    expect(await runTool("ficha_cliente", { clienteId: 99 }, data, NOW)).toEqual({ encontrado: false, aviso: "No hay ningún cliente con id 99." });
  });
});

// ── Servicio ───────────────────────────────────────────────────────────────────

describe("servicio de Copilot", () => {
  let store: MemoryCopilotStore;
  let data: FakeData;
  const make = (llm: LlmFn) => new CopilotService({ store, data, llm, companyName: () => "Náyade QA", now: () => NOW });
  beforeEach(() => {
    store = new MemoryCopilotStore();
    store.clock = () => NOW;
    data = new FakeData();
    data.sales = [sale({ id: 1, amountPaid: 12345, at: NOW - 3600_000 })];
  });

  it("pregunta con herramienta: el Core la ejecuta y la IA responde con esos datos (dos llamadas, con tope de tokens)", async () => {
    const llm = scriptedLlm([{ toolCalls: [{ name: "ventas_periodo", arguments: JSON.stringify({ desde: "2026-11-01" }) }] }, { content: "Este mes llevas 123,45 €." }]);
    const r = await make(llm.fn).ask(actor(1, ADMIN), { question: "¿Cuánto llevamos vendido este mes?" });
    expect(r.answer).toBe("Este mes llevas 123,45 €.");
    expect(r.tools).toEqual([{ name: "ventas_periodo", args: { desde: "2026-11-01" }, ok: true }]);
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls.every((c) => c.maxTokens === COPILOT_LIMITS.maxTokens)).toBe(true);
    expect(llm.calls[0].tools?.map((t) => t.function.name)).toContain("ventas_periodo");
    expect(llm.calls[1].tools).toBeUndefined();
    const last = llm.calls[1].messages.at(-1)!.content;
    expect(last).toContain('"total":123.45');
    expect(llm.calls[0].messages[0].content).toContain("Náyade QA");
    // Historial: pregunta y respuesta guardadas en una conversación del usuario
    const list = await make(llm.fn).conversations(actor(1, ADMIN), false);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "chat", title: "¿Cuánto llevamos vendido este mes?", messageCount: 2 });
    expect(store.msgs.at(-1)).toMatchObject({ tokensIn: 20, tokensOut: 10 });
  });

  it("ventas no recibe herramientas de facturación ni RRHH y, si la IA las pide igualmente, el Core las rechaza", async () => {
    const llm = scriptedLlm([{ toolCalls: [{ name: "ausencias_rrhh", arguments: "{}" }, { name: "facturas_pendientes", arguments: "{}" }, { name: "borrar_todo", arguments: "{}" }] }, { content: "No tengo acceso a esos datos." }]);
    const r = await make(llm.fn).ask(actor(2, AGENTE), { question: "¿Quién está de baja y qué facturas faltan?" });
    const offered = llm.calls[0].tools!.map((t) => t.function.name);
    expect(offered).not.toContain("ausencias_rrhh");
    expect(offered).not.toContain("facturas_pendientes");
    expect(r.tools.map((t) => t.ok)).toEqual([false, false, false]);
    expect(data.calls).not.toContain("hrSummary");
    expect(data.calls).not.toContain("unpaidInvoices");
    expect(llm.calls[1].messages.at(-1)!.content).toContain("no tiene permiso");
  });

  it("como máximo 4 herramientas por pregunta; argumentos que no son JSON, error sin romper", async () => {
    const calls = Array.from({ length: 6 }, () => ({ name: "buscar_clientes", arguments: "{}" }));
    calls[0] = { name: "buscar_clientes", arguments: "{no-json" };
    const llm = scriptedLlm([{ toolCalls: calls }, { content: "Listo." }]);
    const r = await make(llm.fn).ask(actor(1, ADMIN), { question: "clientes" });
    expect(r.tools).toHaveLength(COPILOT_LIMITS.toolCallsMax);
    expect(r.tools[0].ok).toBe(false);
    expect(llm.calls[1].messages.at(-1)!.content).toContain("Se han omitido 2 consultas");
  });

  it("sin IA configurada: «no disponible» y no se guarda nada; las consultas rápidas siguen funcionando", async () => {
    const svc = make(scriptedLlm([aiUnavailable()]).fn);
    await expect(svc.ask(actor(1, ADMIN), { question: "Hola" })).rejects.toMatchObject({ code: "unavailable", message: AI_UNAVAILABLE_MESSAGE });
    expect(store.convs).toHaveLength(0);
    const q = await svc.quick(actor(1, ADMIN), "ventas_periodo", {});
    expect(q.result).toMatchObject({ total: 123.45 });
  });

  it("límite de consumo del ERM: el error de cuota pasa tal cual (tRPC lo devuelve como 429)", async () => {
    const quota = new QuotaExceededError("llm.tokens.input", { allowed: false, reason: "exceeded", metric: "llm.tokens.input", limit: 1, used: 1, period: "month" } as any);
    await expect(make(scriptedLlm([quota]).fn).ask(actor(1, ADMIN), { question: "Hola" })).rejects.toBe(quota);
    const other = make(scriptedLlm([new Error("502 del proveedor")]).fn);
    await expect(other.ask(actor(1, ADMIN), { question: "Hola" })).rejects.toMatchObject({ code: "unavailable" });
  });

  it("historial por usuario: nadie lee, continúa ni archiva la conversación de otro", async () => {
    const r = await make(scriptedLlm([{ content: "Hola, Ana." }]).fn).ask(actor(1, ADMIN), { question: "Hola" });
    const other = make(scriptedLlm([]).fn);
    await expect(other.conversation(actor(2, ADMIN), r.conversationId)).rejects.toMatchObject({ code: "not_found" });
    await expect(other.ask(actor(2, ADMIN), { conversationId: r.conversationId, question: "¿y?" })).rejects.toMatchObject({ code: "not_found" });
    await expect(other.archive(actor(2, ADMIN), r.conversationId, true)).rejects.toMatchObject({ code: "not_found" });
    expect(await other.conversations(actor(2, ADMIN), false)).toEqual([]);
    // El dueño continúa: la IA recibe el historial
    const llm = scriptedLlm([{ content: "Seguimos." }]);
    await make(llm.fn).ask(actor(1, ADMIN), { conversationId: r.conversationId, question: "¿Seguimos?" });
    expect(llm.calls[0].messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    await make(llm.fn).archive(actor(1, ADMIN), r.conversationId, true);
    expect(await make(llm.fn).conversations(actor(1, ADMIN), true)).toHaveLength(1);
  });

  it("protección contra ráfagas por usuario", async () => {
    for (let i = 0; i < COPILOT_LIMITS.burstMax; i++) store.msgs.push({ id: i + 1, conversationId: 1, userId: 1, role: "user", content: "x", tools: [], createdAt: "", at: NOW, tokensIn: 0, tokensOut: 0 });
    await expect(make(scriptedLlm([]).fn).ask(actor(1, ADMIN), { question: "Hola" })).rejects.toMatchObject({ code: "busy" });
    // Otro usuario no se ve afectado
    expect((await make(scriptedLlm([{ content: "Hola" }]).fn).ask(actor(2, ADMIN), { question: "Hola" })).answer).toBe("Hola");
  });

  it("consultas rápidas: solo las herramientas del rol", async () => {
    await expect(make(scriptedLlm([]).fn).quick(actor(2, AGENTE), "facturas_pendientes", {})).rejects.toBeInstanceOf(CopilotError);
    await expect(make(scriptedLlm([]).fn).quick(actor(2, AGENTE), "reservas_proximas", { dias: 99 })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("borradores: resumen con la ficha real del cliente, descripción con el producto y validaciones", async () => {
    data.clients = [client({ id: 5, name: "Marta Ruiz", notes: "Prefiere sábados" })];
    const llm = scriptedLlm([{ content: "Marta es una clienta habitual…" }, { content: "Vive tu primera inmersión…" }]);
    const svc = make(llm.fn);
    const r = await svc.draft(actor(2, AGENTE), { kind: "resumen_cliente", tone: "profesional", clienteId: 5 });
    expect(r.text).toBe("Marta es una clienta habitual…");
    expect(llm.calls[0].messages.at(-1)!.content).toContain("Prefiere sábados");
    expect(llm.calls[0].tools).toBeUndefined();
    const d = await svc.draft(actor(2, AGENTE), { kind: "descripcion_producto", tone: "cercano", productoId: 7 });
    expect(d.text).toMatch(/inmersión/);
    expect(llm.calls[1].messages.at(-1)!.content).toContain("Bautismo de buceo");
    expect((await svc.conversations(actor(2, AGENTE), false)).map((c) => c.kind)).toEqual(["draft", "draft"]);
    await expect(svc.draft(actor(2, AGENTE), { kind: "resumen_cliente", tone: "cercano", clienteId: 99 })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.draft(actor(2, AGENTE), { kind: "respuesta_cliente", tone: "cercano", text: "  " })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.draft(actor(3, access(["finance"])), { kind: "respuesta_cliente", tone: "cercano", text: "Hola" })).rejects.toMatchObject({ code: "forbidden" });
    // Una conversación de borrador no se continúa como chat
    const draftId = (await svc.conversations(actor(2, AGENTE), false))[0].id;
    await expect(svc.ask(actor(2, AGENTE), { conversationId: draftId, question: "Más corto" })).rejects.toMatchObject({ code: "not_found" });
  });
});

// ── Registro ───────────────────────────────────────────────────────────────────

describe("registro de Copilot en el Core", () => {
  const root = path.resolve(__dirname, "..");
  it("licencia copilot-advanced en el guardián de rutas y menú solo con la capacidad", () => {
    expect(TRPC_ROUTER_CAPABILITIES.copilot).toBe("copilot-advanced");
    expect(capabilityForProcedure("copilot.ask")).toBe("copilot-advanced");
    const item = TASK_NAV.flatMap((s) => s.items).find((i) => i.href === "/admin/copilot");
    expect(item?.capabilities).toEqual(["copilot-advanced"]);
    expect(item?.roles).toEqual(["admin", "agente"]);
  });
  it("migración 0058: solo CREATE TABLE IF NOT EXISTS y tablas fuera de drizzle/schema.ts", () => {
    const up = fs.readFileSync(path.join(root, "db/migrations/0058_connect_copilot.sql"), "utf8");
    const statements = up.split(";").map((s) => s.replace(/--.*$/gm, "").trim()).filter(Boolean);
    expect(statements).toHaveLength(2);
    for (const s of statements) expect(s).toMatch(/^CREATE TABLE IF NOT EXISTS copilot_/);
    const schema = fs.readFileSync(path.join(root, "drizzle/schema.ts"), "utf8");
    expect(schema).not.toMatch(/copilot_/);
    expect(fs.existsSync(path.join(root, "db/migrations/0058_connect_copilot.down.sql"))).toBe(true);
  });
  it("las herramientas son SELECT parametrizados: sin escritura en el puerto de datos", () => {
    const src = fs.readFileSync(path.join(root, "server/copilot/data.ts"), "utf8");
    expect(src).not.toMatch(/\b(INSERT|UPDATE|REPLACE|ALTER|CREATE)\b/);
    expect(src).not.toMatch(/sql\.raw/);
  });
});
