/**
 * Elephant Copilot avanzado con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas
 * nuevas desde la baseline y las migraciones de empresa (incluida la 0058). Licencia copilot-advanced (sin ella y en
 * solo lectura), herramientas según el rol (ventas sin facturación ni RRHH), datos reales de la empresa en las
 * consultas rápidas, sin proveedor de IA configurado «no disponible» (sin llamar a ninguna IA) y aislamiento entre
 * empresas.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type Co, type EssentialApp } from "./essentialApp.testkit";

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "copilot-advanced";

describe.skipIf(!URL_)("Copilot avanzado · licencia, roles, herramientas y aislamiento (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;

  const m = (proc: string, input: unknown, cookie = adA, co: Co = "a") => ess.m(co, `copilot.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: Co = "a") => ess.q(co, `copilot.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };

  beforeAll(async () => {
    // Sin proveedor de IA: ninguna prueba llama a una IA real
    delete process.env.ES_AI_API_KEY;
    delete process.env.ES_AI_API_URL;
    ess = await startEssentialApp(URL_!, "copilot");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la capacidad copilot-advanced no responde (403 de licencia)", async () => {
    expect(isLicenseDenied(await q("status"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("ask", { question: "Hola" }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("herramientas según el rol y las capacidades: ventas no ve facturación ni RRHH", async () => {
    await ess.setCapability("a", "people-hr", "active");
    const admin = await ok(q("status"));
    expect(admin.aiAvailable).toBe(false);
    const adminTools = admin.tools.map((t: any) => t.name);
    expect(adminTools).toEqual(expect.arrayContaining(["ventas_periodo", "facturas_pendientes", "ausencias_rrhh", "reservas_proximas", "buscar_clientes"]));
    const agent = (await ok(q("status", undefined, agA))).tools.map((t: any) => t.name);
    expect(agent).toEqual(expect.arrayContaining(["reservas_proximas", "buscar_clientes"]));
    for (const hidden of ["ventas_periodo", "facturas_pendientes", "ausencias_rrhh"]) expect(agent).not.toContain(hidden);
    expect(errCode(await q("quick", { tool: "facturas_pendientes", args: {} }, agA))).toBe("FORBIDDEN");
    expect(errCode(await q("quick", { tool: "ausencias_rrhh", args: {} }, agA))).toBe("FORBIDDEN");
    // La empresa B no tiene RRHH: su administración tampoco ve ausencias
    expect((await ok(q("status", undefined, adB, "b"))).tools.map((t: any) => t.name)).not.toContain("ausencias_rrhh");
  });

  it("consultas rápidas con los datos reales de la empresa, sin mezclar empresas", async () => {
    const now = Date.now();
    const today = new Date(now + 3600_000).toISOString().slice(0, 10);
    await ess.sql("a", "INSERT INTO clients (name, email, source, totalSpent, totalBookings) VALUES ('Marta Copilot QA', 'marta-copilot@cliente.example', 'manual', 250, 2)");
    await ess.sql(
      "a",
      "INSERT INTO reservations (product_id, product_name, booking_date, people, amount_total, amount_paid, status, status_payment, customer_name, merchant_order, created_at, updated_at, paid_at) VALUES (1, 'Kayak QA', ?, 3, 12000, 12000, 'paid', 'PAGADO', 'Marta Copilot QA', 'CPQA1', ?, ?, ?)",
      [today, now, now, now],
    );
    await ess.sql("a", "INSERT INTO invoices (invoiceNumber, clientName, clientEmail, itemsJson, subtotal, taxRate, taxAmount, total, status, issuedAt) VALUES ('CP-QA-1', 'Marta Copilot QA', '', '[]', 82.64, 21, 17.36, 100, 'enviada', ?)", [new Date(now - 5 * 86_400_000)]);

    const sales = await ok(q("quick", { tool: "ventas_periodo", args: {} }));
    expect(sales.result).toMatchObject({ total: 120, operaciones: 1 });
    const inv = await ok(q("quick", { tool: "facturas_pendientes", args: {} }));
    expect(inv.result).toMatchObject({ facturasPendientes: 1, importePendiente: 100 });
    const upcoming = await ok(q("quick", { tool: "reservas_proximas", args: { dias: 3 } }, agA));
    expect(upcoming.result.detalle.map((r: any) => r.producto)).toContain("Kayak QA");
    const clients = await ok(q("quick", { tool: "buscar_clientes", args: { texto: "Copilot QA" } }, agA));
    expect(clients.result.clientes.map((c: any) => c.nombre)).toEqual(["Marta Copilot QA"]);

    // Empresa B: nada de A
    expect((await ok(q("quick", { tool: "buscar_clientes", args: { texto: "Copilot QA" } }, adB, "b"))).result.clientes).toEqual([]);
    expect((await ok(q("quick", { tool: "ventas_periodo", args: {} }, adB, "b"))).result).toMatchObject({ total: 0, operaciones: 0 });
    expect((await ok(q("quick", { tool: "facturas_pendientes", args: {} }, adB, "b"))).result).toMatchObject({ facturasPendientes: 0 });
  });

  it("sin IA configurada: «no disponible» y el historial queda vacío (migración 0058 aplicada)", async () => {
    const r = await m("ask", { question: "¿Cuánto hemos vendido hoy?" });
    expect(errCode(r)).toBe("PRECONDITION_FAILED");
    expect(r.text).toContain("no está disponible");
    const d = await m("draft", { kind: "respuesta_cliente", tone: "cercano", text: "¿Tenéis plazas el sábado?" }, agA);
    expect(errCode(d)).toBe("PRECONDITION_FAILED");
    expect(await ok(q("conversations"))).toEqual([]);
    expect(errCode(await q("conversation", { id: 1 }))).toBe("NOT_FOUND");
  });

  it("con una IA FALSA (doble de la API compatible con OpenAI, sin red): herramienta, respuesta, historial por usuario", async () => {
    const bodies: any[] = [];
    const replies: any[] = [
      { choices: [{ index: 0, message: { role: "assistant", content: "", tool_calls: [{ id: "c1", type: "function", function: { name: "ventas_periodo", arguments: "{}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } },
      { choices: [{ index: 0, message: { role: "assistant", content: "En los últimos 30 días habéis vendido 120,00 €." }, finish_reason: "stop" }], usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 } },
    ];
    const prev = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
      const target = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as { url: string }).url);
      if (target === "https://ia-falsa.example/v1/chat/completions") {
        bodies.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(JSON.stringify(replies.shift()), { status: 200, headers: { "content-type": "application/json" } });
      }
      return prev(input as any, init as any);
    }) as typeof fetch;
    process.env.ES_AI_API_URL = "https://ia-falsa.example/v1";
    process.env.ES_AI_API_KEY = "clave-falsa-de-pruebas";
    try {
      expect((await ok(q("status"))).aiAvailable).toBe(true);
      const r = await ok(m("ask", { question: "¿Cuánto hemos vendido?" }));
      expect(r.answer).toBe("En los últimos 30 días habéis vendido 120,00 €.");
      expect(r.tools).toEqual([{ name: "ventas_periodo", args: {}, ok: true }]);
      expect(bodies).toHaveLength(2);
      expect(bodies.every((b) => b.max_tokens === 900)).toBe(true);
      expect(bodies[0].tools.map((t: any) => t.function.name)).toContain("facturas_pendientes");
      expect(bodies[1].tools).toBeUndefined();
      expect(JSON.stringify(bodies[1].messages)).toContain('\\"total\\":120');

      const conv = await ok(q("conversation", { id: r.conversationId }));
      expect(conv.messages.map((x: any) => x.role)).toEqual(["user", "assistant"]);
      expect(conv.messages[1].tools[0].name).toBe("ventas_periodo");
      // Otro usuario de la misma empresa no la ve ni la continúa; la otra empresa, tampoco
      expect(errCode(await q("conversation", { id: r.conversationId }, agA))).toBe("NOT_FOUND");
      expect(errCode(await m("ask", { conversationId: r.conversationId, question: "¿y?" }, agA))).toBe("NOT_FOUND");
      expect(await ok(q("conversations", undefined, agA))).toEqual([]);
      expect(await ok(q("conversations", undefined, adB, "b"))).toEqual([]);
      expect((await ok(q("conversations"))).map((c: any) => c.title)).toEqual(["¿Cuánto hemos vendido?"]);
    } finally {
      globalThis.fetch = prev;
      delete process.env.ES_AI_API_KEY;
      delete process.env.ES_AI_API_URL;
    }
  });

  it("en solo lectura: historial y consultas rápidas sí; preguntas nuevas, no", async () => {
    await ess.setCapability("a", CAP, "read_only");
    expect(Array.isArray(await ok(q("conversations")))).toBe(true);
    expect((await ok(q("quick", { tool: "buscar_clientes", args: {} }))).tool).toBe("buscar_clientes");
    expect(isLicenseDenied(await m("ask", { question: "Hola" }), CAP)).toBe(true);
    await ess.setCapability("a", CAP, "active");
  });
});
