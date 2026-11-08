/**
 * Contratos y firma electrónica sin base de datos: variables de plantilla, estados y transiciones, validación de la firma
 * simple, huella del contenido firmado, caducidad del enlace, documentos (PDF y correo), licencia y menú del panel.
 */
import { describe, expect, it } from "vitest";
import {
  ESIGN_LIMITS,
  MISSING_VALUE,
  SIMPLE_SIGNATURE_NOTICE,
  canTransition,
  checkSigner,
  isFinalStatus,
  isLinkExpired,
  linkHours,
  nextStatus,
  renderTemplate,
  templateProblem,
  unknownVariables,
  variablesOf,
} from "../shared/contractsEsign";
import { canonicalContent, contentHash, hasBlanks, signRequestEmail, signedContractHtml, verifiedContent, type SignedContent } from "./contractsEsign/content";
import { isMissingEsignSchema, resolveEsignLink } from "./contractsEsignDb";
import { TRPC_ROUTER_CAPABILITIES, capabilityForProcedure } from "./_core/capabilities/routeGuard";
import { TASK_NAV, routeCapabilities } from "../shared/adminNav";

const content = (over: Partial<SignedContent> = {}): SignedContent => ({
  contractId: 7,
  company: "Empresa Ficticia",
  title: "Contrato de servicio",
  body: "Texto del contrato con todas sus cláusulas.",
  customerName: "Cliente Ficticio",
  customerEmail: "cliente@ejemplo.example",
  amount: "120.00",
  contractDate: "2026-11-08",
  templateId: 3,
  templateVersion: 2,
  ...over,
});

describe("variables de plantilla", () => {
  it("detecta las variables (con espacios) sin repetir", () => {
    expect(variablesOf("Hola {{cliente.nombre}}, {{ fecha }} y {{cliente.nombre}}")).toEqual(["cliente.nombre", "fecha"]);
  });
  it("rellena las conocidas; las que faltan quedan marcadas y las desconocidas se dejan", () => {
    const r = renderTemplate("{{cliente.nombre}} paga {{importe}} el {{fecha}}. NIF {{cliente.nif}}. {{otra.cosa}}", {
      "cliente.nombre": "  Ana Prueba ",
      importe: "120,00 €",
      fecha: "8 de noviembre de 2026",
      "cliente.nif": "",
    });
    expect(r.text).toBe(`Ana Prueba paga 120,00 € el 8 de noviembre de 2026. NIF ${MISSING_VALUE}. {{otra.cosa}}`);
    expect(r.missing).toEqual(["cliente.nif"]);
    expect(r.unknown).toEqual(["otra.cosa"]);
    expect(hasBlanks(r.text)).toBe(true);
  });
  it("una plantilla con variables desconocidas, sin título o demasiado corta no se guarda", () => {
    expect(unknownVariables("{{cliente.nombre}} {{cliente.iban}}")).toEqual(["cliente.iban"]);
    expect(templateProblem({ title: "Servicio", body: "Contrato con {{cliente.iban}} y bastante texto" })).toMatch(/Variables desconocidas/);
    expect(templateProblem({ title: "", body: "x".repeat(40) })).toMatch(/título/);
    expect(templateProblem({ title: "Servicio", body: "corto" })).toMatch(/corto/);
    expect(templateProblem({ title: "Servicio", body: "Entre {{empresa.nombre}} y {{cliente.nombre}} por {{importe}}." })).toBeNull();
  });
});

describe("estados del contrato", () => {
  it("borrador → enviado → firmado o rechazado; borrador o enviado → anulado", () => {
    expect(nextStatus("draft", "send")).toEqual({ ok: true, status: "sent" });
    expect(nextStatus("sent", "send")).toEqual({ ok: true, status: "sent" });
    expect(nextStatus("draft", "sign")).toEqual({ ok: true, status: "signed" });
    expect(nextStatus("sent", "sign")).toEqual({ ok: true, status: "signed" });
    expect(nextStatus("sent", "reject")).toEqual({ ok: true, status: "rejected" });
    expect(nextStatus("draft", "void")).toEqual({ ok: true, status: "void" });
    expect(nextStatus("sent", "void")).toEqual({ ok: true, status: "void" });
  });
  it("lo firmado, rechazado o anulado ya no cambia; solo el borrador se edita", () => {
    for (const s of ["signed", "rejected", "void"] as const) {
      expect(isFinalStatus(s)).toBe(true);
      for (const a of ["edit", "send", "sign", "reject", "void"] as const) expect(canTransition(s, a)).toBe(false);
    }
    expect(canTransition("sent", "edit")).toBe(false);
    expect(canTransition("draft", "reject")).toBe(false);
    const r = nextStatus("signed", "void");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("Un contrato firmado no se puede anular.");
  });
});

describe("firma simple", () => {
  it("exige aceptar y el nombre; el DNI/NIF es opcional y se normaliza", () => {
    expect(checkSigner({ signerName: "Ana Prueba", accepted: false })).toEqual({ ok: false, error: "Hay que aceptar el contrato para firmarlo." });
    expect(checkSigner({ signerName: " a ", accepted: true }).ok).toBe(false);
    expect(checkSigner({ signerName: "  Ana   Prueba ", accepted: true })).toEqual({ ok: true, signerName: "Ana Prueba", signerTaxId: null });
    expect(checkSigner({ signerName: "Ana Prueba", signerTaxId: "12.345.678-z", accepted: true })).toEqual({ ok: true, signerName: "Ana Prueba", signerTaxId: "12345678Z" });
    expect(checkSigner({ signerName: "Ana Prueba", signerTaxId: "<script>", accepted: true }).ok).toBe(false);
  });
  it("el aviso dice que no es firma avanzada ni cualificada", () => {
    expect(SIMPLE_SIGNATURE_NOTICE).toMatch(/simple/);
    expect(SIMPLE_SIGNATURE_NOTICE).toMatch(/No es una firma electrónica avanzada ni cualificada/);
  });
});

describe("huella del contenido firmado", () => {
  it("canónica: el orden de las claves no cambia el texto ni la huella", () => {
    const a = content();
    const b = Object.fromEntries(Object.entries(a).reverse()) as unknown as SignedContent;
    expect(canonicalContent(a)).toBe(canonicalContent(b));
    expect(contentHash(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(contentHash(a)).toBe(contentHash(b));
  });
  it("cualquier cambio del texto, el importe o el cliente cambia la huella", () => {
    const h = contentHash(content());
    expect(contentHash(content({ body: "Texto del contrato con todas sus cláusulas!" }))).not.toBe(h);
    expect(contentHash(content({ amount: "121.00" }))).not.toBe(h);
    expect(contentHash(content({ customerName: "Otra Persona" }))).not.toBe(h);
  });
  it("lo guardado solo vale si corresponde a su huella", () => {
    const c = content();
    const json = JSON.stringify(c);
    expect(verifiedContent(json, contentHash(c))).toEqual(c);
    expect(verifiedContent(json.replace("120.00", "999.00"), contentHash(c))).toBeNull();
    expect(verifiedContent("{roto", contentHash(c))).toBeNull();
    expect(verifiedContent(null, null)).toBeNull();
  });
});

describe("enlace de firma: caducidad y formato", () => {
  it("72 horas por defecto, entre 1 hora y 14 días", () => {
    expect(linkHours(undefined)).toBe(72);
    expect(linkHours(0)).toBe(1);
    expect(linkHours(10_000)).toBe(ESIGN_LIMITS.linkMaxHours);
    expect(linkHours(5.4)).toBe(5);
  });
  it("caduca justo en su hora", () => {
    expect(isLinkExpired(1000, 999)).toBe(false);
    expect(isLinkExpired(1000, 1000)).toBe(true);
    expect(isLinkExpired(null, 5)).toBe(false);
  });
  it("un token mal formado se descarta sin consultar la base de datos", async () => {
    for (const bad of ["", "corto", "x".repeat(44), "../../etc" + "a".repeat(34), 42, null]) expect(await resolveEsignLink(bad)).toBeNull();
  });
  it("falta de la migración 0049: se reconoce solo en tablas esign_", () => {
    expect(isMissingEsignSchema({ code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'x.esign_links' doesn't exist" })).toBe(true);
    expect(isMissingEsignSchema({ cause: { errno: 1146, message: "Table 'x.esign_contracts' doesn't exist" } })).toBe(true);
    expect(isMissingEsignSchema({ code: "ER_NO_SUCH_TABLE", sqlMessage: "Table 'x.clients' doesn't exist" })).toBe(false);
  });
});

describe("documentos", () => {
  const sig = { signerName: "Ana <Prueba>", signerTaxId: "12345678Z", signedAt: Date.UTC(2026, 10, 8, 9, 0), ip: "203.0.113.5", userAgent: "NavegadorDePrueba/1.0", method: "link" as const, signedBy: "public:link:1" };
  it("el PDF lleva el texto, la firma, la huella, el aviso y las evidencias, escapado", () => {
    const c = content({ body: "Cláusula <b>1</b>" });
    const html = signedContractHtml(c, contentHash(c), sig, [{ event: "signed", actor: "public:link:1", ip: "203.0.113.5", userAgent: null, detail: "Ana", createdAt: sig.signedAt }]);
    expect(html).toContain("Cláusula &lt;b&gt;1&lt;/b&gt;");
    expect(html).toContain("Ana &lt;Prueba&gt;");
    expect(html).toContain(contentHash(c));
    expect(html).toContain("12345678Z");
    expect(html).toContain("Contrato firmado");
    expect(html).toContain("No es una firma electrónica avanzada ni cualificada");
  });
  it("el correo lleva el enlace, la marca de la empresa y la caducidad", () => {
    const m = signRequestEmail({ company: "Empresa Ficticia", customerName: "Ana", title: "Contrato\nde servicio", amount: "120.00", url: "https://empresa.example/contrato/abc", expiresAt: Date.UTC(2026, 10, 11), recipient: "ana@ejemplo.example" });
    expect(m.subject).toBe("Empresa Ficticia: contrato para firmar «Contrato de servicio»");
    expect(m.html).toContain("https://empresa.example/contrato/abc");
    expect(m.text).toContain("https://empresa.example/contrato/abc");
    expect(m.html).toContain("Empresa Ficticia");
  });
});

describe("licencia y menú", () => {
  it("contractsEsign.* lo licencia contracts-esign", () => {
    expect(TRPC_ROUTER_CAPABILITIES.contractsEsign).toBe("contracts-esign");
    expect(capabilityForProcedure("contractsEsign.signInPanel")).toBe("contracts-esign");
  });
  it("las pantallas del panel (también la ficha) exigen contracts-esign; entrada en «Módulos contratados»", () => {
    expect(routeCapabilities("/admin/contratos")).toEqual(["contracts-esign"]);
    expect(routeCapabilities("/admin/contratos/42")).toEqual(["contracts-esign"]);
    expect(routeCapabilities("/admin/contratos/plantillas")).toEqual(["contracts-esign"]);
    const item = TASK_NAV.find((s) => s.id === "contratados")!.items.find((i) => i.key === "x-contratos")!;
    expect(item).toMatchObject({ href: "/admin/contratos", capabilities: ["contracts-esign"], roles: ["admin", "agente"] });
  });
});
