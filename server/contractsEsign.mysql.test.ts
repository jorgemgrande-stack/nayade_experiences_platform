/**
 * Contratos y firma electrónica con la aplicación real sobre MySQL (opt-in, REGISTRY_TEST_DATABASE_URL): dos empresas
 * nuevas desde la baseline y las migraciones de empresa (incluida la 0049). Licencia contracts-esign (sin ella, 403; en
 * solo lectura, solo consultas), plantillas con versión, contrato para un cliente del CRM con variables rellenadas,
 * borrador editable, envío con enlace de un solo uso por correo (proveedor falso: ningún envío real), firma por la página
 * pública /contrato/<token> con evidencias (IP, navegador, huella), rechazo, anulación, firma en el panel, PDF firmado,
 * caducidad y aislamiento entre empresas. Datos sintéticos (dominios .example).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startEssentialApp, data, errCode, isLicenseDenied, type Co, type EssentialApp } from "./essentialApp.testkit";

// Sin Chromium en CI: el PDF es el HTML del documento con la cabecera %PDF (comprueba que sale del contrato firmado)
vi.mock("./pdfGenerator", async (orig) => {
  const m = await orig<typeof import("./pdfGenerator")>();
  return { ...m, htmlToPdf: async (html: string) => Buffer.from(`%PDF-prueba\n${html}`, "utf8") };
});

const URL_ = process.env.REGISTRY_TEST_DATABASE_URL;
const CAP = "contracts-esign";
const INVALID = "Este enlace no es válido o ha caducado";
const UNAVAILABLE = "Este servicio no está disponible";
const BODY = "Entre {{empresa.nombre}} y {{cliente.nombre}} (DNI/NIF {{cliente.nif}}), a {{fecha}}, se acuerda el servicio por {{importe}}.";

describe.skipIf(!URL_)("Contratos y firma electrónica (aplicación real, dos empresas)", () => {
  let ess: EssentialApp;
  let adA: string;
  let agA: string;
  let adB: string;
  let clientId = 0;
  let templateId = 0;
  let contractId = 0;
  let url = "";

  const m = (proc: string, input: unknown, cookie = adA, co: Co = "a") => ess.m(co, `contractsEsign.${proc}`, input, cookie);
  const q = (proc: string, input?: unknown, cookie = adA, co: Co = "a") => ess.q(co, `contractsEsign.${proc}`, input, cookie);
  const ok = async (p: Promise<{ status: number; json: any; text: string }>) => {
    const r = await p;
    if (r.status !== 200) throw new Error(`${r.status}: ${r.text.slice(0, 400)}`);
    return data(r);
  };
  const tokenOf = (u: string) => u.split("/").pop()!;
  const get = (co: Co, p: string) => ess.call(co, "GET", p);
  const post = (co: Co, p: string, form: Record<string, string>, ua = "NavegadorDePrueba/1.0") =>
    ess.call(co, "POST", p, { raw: new URLSearchParams(form).toString(), headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": ua } });
  const newContract = async (over: Record<string, unknown> = {}) => (await ok(m("create", { templateId, clientId, amount: 250, ...over }))).id as number;

  beforeAll(async () => {
    ess = await startEssentialApp(URL_!, "esign");
    adA = await ess.login("a", "admin");
    agA = await ess.login("a", "agente");
    adB = await ess.login("b", "admin");
    // El correo del cliente es un buzón propio de la empresa: en la prueba gratuita solo se envía a esos
    await ess.sql("a", "INSERT INTO clients (name, email, source, nif) VALUES ('Ana Ficticia', ?, 'manual', '')", [`agente@${ess.ids.a}.example`]);
    clientId = (await ess.sql("a", "SELECT id FROM clients WHERE name = 'Ana Ficticia'"))[0].id;
  }, 300_000);
  afterAll(async () => {
    await ess?.close();
  });

  it("sin la capacidad contracts-esign no responde (403 de licencia) y la página pública no está disponible", async () => {
    expect(isLicenseDenied(await q("list"), CAP)).toBe(true);
    expect(isLicenseDenied(await m("saveTemplate", { title: "Servicio", body: BODY }), CAP)).toBe(true);
    expect((await get("a", `/contrato/${"a".repeat(43)}`)).text).toContain(UNAVAILABLE);
    await ess.setCapability("a", CAP, "active");
    await ess.setCapability("b", CAP, "active");
  });

  it("plantillas: solo la administración; variables desconocidas no; cada cambio sube la versión", async () => {
    expect(errCode(await m("saveTemplate", { title: "Servicio", body: BODY }, agA))).toBe("FORBIDDEN");
    expect(errCode(await m("saveTemplate", { title: "Servicio", body: `${BODY} {{cliente.iban}}` }))).toBe("BAD_REQUEST");
    const t = await ok(m("saveTemplate", { title: "QA-ESIGN Servicio", body: BODY }));
    expect(t).toMatchObject({ version: 1, isActive: true });
    templateId = t.id;
    expect((await ok(m("saveTemplate", { id: templateId, title: "QA-ESIGN Servicio", body: BODY }))).version).toBe(1);
    expect((await ok(m("saveTemplate", { id: templateId, title: "QA-ESIGN Servicio", body: `${BODY}\n\nCláusula final.` }))).version).toBe(2);
    expect((await ok(q("templates", undefined, agA))).map((x: any) => x.id)).toContain(templateId);
  });

  it("contrato para un cliente del CRM: variables rellenadas, lo que falta queda marcado y no se envía hasta completarlo", async () => {
    const r = await ok(m("create", { templateId, clientId, amount: 250, contractDate: "2026-11-08" }, agA));
    expect(r.missing).toEqual(["cliente.nif"]);
    contractId = r.id;
    const c = await ok(q("get", { id: contractId }));
    expect(c).toMatchObject({ status: "draft", templateVersion: 2, customerName: "Ana Ficticia", amount: "250.00", blanks: true });
    expect(c.body).toContain("Ana Ficticia");
    expect(c.body).toContain("8 de noviembre de 2026");
    expect(c.body).toContain("250,00");
    expect(errCode(await m("send", { id: contractId, email: false }))).toBe("BAD_REQUEST");
    expect(errCode(await m("create", { templateId, clientId: 999_999 }))).toBe("NOT_FOUND");
    await ok(m("updateDraft", { id: contractId, title: c.title, body: c.body.replace("________", "12345678Z"), amount: 250 }, agA));
    expect((await ok(q("get", { id: contractId }))).blanks).toBe(false);
  });

  it("envío por correo: fija el texto con su huella, enlace de un solo uso y ya no se edita", async () => {
    const before = ess.mails.length;
    const r = await ok(m("send", { id: contractId, email: true, hours: 48 }, agA));
    expect(r.url).toMatch(/\/contrato\/[A-Za-z0-9_-]{43}$/);
    expect(r.mailed).toBe(true);
    url = r.url;
    const mails = ess.mails.slice(before);
    expect(mails).toHaveLength(1);
    expect(mails[0].to[0].email).toBe(`agente@${ess.ids.a}.example`);
    expect(mails[0].htmlContent).toContain(tokenOf(url));
    const c = await ok(q("get", { id: contractId }));
    expect(c.status).toBe("sent");
    expect(c.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(c.link.expiresAt - Date.now()).toBeGreaterThan(47 * 3_600_000);
    expect(errCode(await m("updateDraft", { id: contractId, title: c.title, body: c.body }))).toBe("CONFLICT");
    // Solo se guarda la huella del token
    const [l] = await ess.sql("a", "SELECT token_hash, status FROM esign_links WHERE contract_id = ?", [contractId]);
    expect(l.status).toBe("active");
    expect(l.token_hash).not.toContain(tokenOf(url));
  });

  it("la página pública muestra el texto exacto con su huella; otra empresa ve «no válido»; sin aceptar no firma", async () => {
    const c = await ok(q("get", { id: contractId }));
    const page = await get("a", `/contrato/${tokenOf(url)}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain(c.contentHash);
    expect(page.text).toContain("12345678Z");
    expect(page.text).toContain("No es una firma electrónica avanzada ni cualificada");
    expect((await get("b", `/contrato/${tokenOf(url)}`)).text).toContain(INVALID);
    const no = await post("a", `/contrato/${tokenOf(url)}`, { action: "sign", signerName: "Ana Ficticia" });
    expect(no.status).toBe(400);
    expect(no.text).toContain("Hay que aceptar el contrato");
  });

  it("firma con el enlace: evidencias (IP, navegador, huella), PDF guardado y enlace usado", async () => {
    const r = await post("a", `/contrato/${tokenOf(url)}`, { action: "sign", signerName: "Ana Ficticia", signerTaxId: "12345678-z", accepted: "1" });
    expect(r.status).toBe(200);
    expect(r.text).toContain("Contrato firmado");
    const [row] = await ess.sql("a", "SELECT status, signer_name, signer_tax_id, signed_method, signed_by, signed_ip, signed_user_agent FROM esign_contracts WHERE id = ?", [contractId]);
    expect(row).toMatchObject({ status: "signed", signer_name: "Ana Ficticia", signer_tax_id: "12345678Z", signed_method: "link", signed_user_agent: "NavegadorDePrueba/1.0" });
    expect(row.signed_by).toMatch(/^public:link:\d+$/);
    expect(row.signed_ip).toBeTruthy();
    expect((await ess.sql("a", "SELECT status FROM esign_links WHERE contract_id = ?", [contractId]))[0].status).toBe("used");
    expect((await post("a", `/contrato/${tokenOf(url)}`, { action: "sign", signerName: "Otra Persona", accepted: "1" })).text).toContain(INVALID);
    expect((await get("a", `/contrato/${tokenOf(url)}`)).text).toContain(INVALID);
    const c = await ok(q("get", { id: contractId }));
    expect(c.events.map((e: any) => e.event)).toEqual(expect.arrayContaining(["created", "edited", "sent", "link_issued", "mail_sent", "viewed", "signed", "pdf"]));
    expect(c.pdf?.hash).toMatch(/^[a-f0-9]{64}$/);
    const pdf = await ok(q("downloadPdf", { id: contractId }, agA));
    const text = Buffer.from(pdf.base64, "base64").toString("utf8");
    expect(text.startsWith("%PDF")).toBe(true);
    expect(text).toContain(c.contentHash);
    expect(text).toContain("Registro de evidencias");
    expect(pdf.sha256).toBe(c.pdf.hash);
    expect(errCode(await m("void", { id: contractId, reason: "Ya no hace falta" }))).toBe("CONFLICT");
    expect(errCode(await m("send", { id: contractId, email: false }))).toBe("CONFLICT");
  });

  it("rechazo con el enlace, anulación (solo admin) y firma en el panel", async () => {
    const r1 = await newContract({ contractDate: "2026-11-09" });
    await ok(m("updateDraft", { id: r1, title: "QA-ESIGN Rechazable", body: "Contrato de prueba sin datos pendientes, para rechazar." }));
    const u = (await ok(m("send", { id: r1, email: false }))).url;
    const rej = await post("a", `/contrato/${tokenOf(u)}`, { action: "reject", reason: "No estoy de acuerdo" });
    expect(rej.text).toContain("Contrato rechazado");
    expect(await ok(q("get", { id: r1 }))).toMatchObject({ status: "rejected", closeReason: "No estoy de acuerdo" });

    const r2 = await newContract();
    await ok(m("updateDraft", { id: r2, title: "QA-ESIGN Anulable", body: "Contrato de prueba sin datos pendientes, para anular." }));
    expect(errCode(await m("void", { id: r2, reason: "Error" }, agA))).toBe("FORBIDDEN");
    await ok(m("void", { id: r2, reason: "Creado por error" }));
    expect((await ok(q("get", { id: r2 }))).status).toBe("void");

    const r3 = await newContract();
    await ok(m("updateDraft", { id: r3, title: "QA-ESIGN Mostrador", body: "Contrato de prueba sin datos pendientes, para el panel." }));
    const u3 = (await ok(m("send", { id: r3, email: false }))).url;
    expect(errCode(await m("signInPanel", { id: r3, signerName: "Ana Ficticia", accepted: false }, agA))).toBe("BAD_REQUEST");
    await ok(m("signInPanel", { id: r3, signerName: "Ana Ficticia", accepted: true }, agA));
    const c3 = await ok(q("get", { id: r3 }));
    expect(c3).toMatchObject({ status: "signed", signedMethod: "panel", signedBy: `user:${await ess.userId("a", "agente")}` });
    // El enlace pendiente deja de valer al firmar en el panel
    expect((await get("a", `/contrato/${tokenOf(u3)}`)).text).toContain(INVALID);
  });

  it("caducado o revocado no vale; dos firmas a la vez: solo una", async () => {
    const id = await newContract();
    await ok(m("updateDraft", { id, title: "QA-ESIGN Caducable", body: "Contrato de prueba sin datos pendientes, para caducar." }));
    const u1 = (await ok(m("send", { id, email: false, hours: 1 }))).url;
    await ess.sql("a", "UPDATE esign_links SET expires_at = ? WHERE contract_id = ? AND status = 'active'", [Date.now() - 1000, id]);
    expect((await get("a", `/contrato/${tokenOf(u1)}`)).text).toContain(INVALID);
    const u2 = (await ok(m("send", { id, email: false }))).url;
    expect(await ok(m("revokeLink", { id }))).toEqual({ revoked: true });
    expect((await get("a", `/contrato/${tokenOf(u2)}`)).text).toContain(INVALID);
    const u3 = (await ok(m("send", { id, email: false }))).url;
    const both = await Promise.all(["Primera Persona", "Segunda Persona"].map((signerName) => post("a", `/contrato/${tokenOf(u3)}`, { action: "sign", signerName, accepted: "1" })));
    expect(both.filter((r) => r.status === 200 && r.text.includes("Contrato firmado"))).toHaveLength(1);
    expect(both.filter((r) => r.text.includes(INVALID))).toHaveLength(1);
  });

  it("aislamiento: otra empresa no ve los contratos ni las plantillas de la primera", async () => {
    expect(await ok(q("list", undefined, adB, "b"))).toEqual([]);
    expect(await ok(q("templates", undefined, adB, "b"))).toEqual([]);
    expect(errCode(await q("get", { id: contractId }, adB, "b"))).toBe("NOT_FOUND");
  });

  it("en solo lectura se consulta (y se descarga el PDF) pero no se escribe", async () => {
    await ess.setCapability("a", CAP, "read_only");
    try {
      expect((await ok(q("list"))).length).toBeGreaterThan(0);
      expect((await ok(q("downloadPdf", { id: contractId }))).base64).toBeTruthy();
      expect(isLicenseDenied(await m("create", { templateId, clientId }), CAP)).toBe(true);
    } finally {
      await ess.setCapability("a", CAP, "active");
    }
  });
});
