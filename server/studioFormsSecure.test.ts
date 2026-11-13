/**
 * Elephant Studio — formularios seguros (E-7), sin base de datos: consentimiento, campos nuevos, antirrobots por
 * empresa, origen, duplicados, aviso al propietario y aislamiento entre empresas.
 */
import { describe, it, expect, vi } from "vitest";
import { createBlock, newFormField, DEFAULT_FORM_CONSENT_TEXT, type BlockDataMap } from "../shared/pageBlocks";
import { normalizeBlocks } from "./_core/pageBlocks";
import { evaluateFormSubmission, formConsentText, allowFormSubmit } from "./_core/studioForms";
import { FORM_DEDUPE_WINDOW_MS, StudioSubmitError, ipFingerprint, processStudioSubmission, sameSiteOrigin, type SubmissionRecord, type SubmitDeps } from "./_core/studioFormsSubmit";
import { readCaptchaConfig, verifyTurnstile } from "./_core/studioFormsCaptcha";
import { IntegrationVault, MemoryCredentialStore, type Keyring } from "./_core/credentials/vault";
import { PROVIDERS } from "./_core/credentials/catalog";

const form = (fields = createBlock("form").data.fields, extra: Partial<BlockDataMap["form"]> = {}): BlockDataMap["form"] => ({ ...createBlock("form").data, fields, ...extra });
const ok = { elapsedMs: 8000, consent: true };

describe("E-7 · campos y consentimiento", () => {
  it("un formulario existente (sin las opciones nuevas) se comporta igual: nada de aviso, antirrobots ni textos propios", () => {
    const legacy = normalizeBlocks([{ id: "f", type: "form", data: { title: "Hola", fields: [{ kind: "email", label: "Correo", role: "email", required: "on" }], successMessage: "Gracias" } }]) as any;
    expect(legacy[0].data).toMatchObject({ notifyOwner: "off", captcha: "off", consentText: "", errorMessage: "", consent: "on" });
    expect(createBlock("form").data).toMatchObject({ notifyOwner: "off", captcha: "off" });
  });

  it("nombre y apellidos por separado se unen para el CRM; el nombre completo, si existe, manda; empresa va al lead", () => {
    const fields = [
      newFormField("text", "Nombre", { role: "first_name", required: "on" }),
      newFormField("text", "Apellidos", { role: "last_name" }),
      newFormField("email", "Correo", { role: "email", required: "on" }),
      newFormField("text", "Empresa", { role: "company" }),
      newFormField("select", "Programa de interés", { options: "Uno\nDos" }),
      newFormField("checkbox", "Quiero novedades"),
    ];
    const r = evaluateFormSubmission(form(fields), { ...ok, values: { f0: "Ana", f1: "Pérez <b>Gil</b>", f2: "a@b.es", f3: "Acme", f4: "Dos", f5: true } }, { slug: "x" });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.lead).toMatchObject({ name: "Ana Pérez Gil", company: "Acme" });
    // Ningún dato se pierde: todas las respuestas van al mensaje del CRM
    expect(r.lead.message).toContain("Programa de interés: Dos");
    expect(r.lead.message).toContain("Quiero novedades: Sí");
    const full = evaluateFormSubmission(form([newFormField("text", "N", { role: "name" }), ...fields]), { ...ok, values: { f0: "Completo", f1: "Ana", f3: "a@b.es" } }, { slug: "x" });
    expect(full.kind === "ok" && full.lead.name).toBe("Completo");
  });

  it("el consentimiento lleva el texto exacto y una versión que cambia con el texto", () => {
    const a = formConsentText({ consentText: "" });
    expect(a.text).toBe(DEFAULT_FORM_CONSENT_TEXT);
    const b = formConsentText({ consentText: "Acepto que me contacten sobre mi solicitud." });
    expect(b.version).not.toBe(a.version);
    expect(b.version).toMatch(/^[0-9a-f]{12}$/);
    const r = evaluateFormSubmission(form(undefined, { consentText: "Acepto que me contacten sobre mi solicitud." }), { ...ok, values: { f0: "Ana", f1: "a@b.es" } }, { slug: "x" });
    expect(r.kind === "ok" && r.consent).toEqual(b);
    const off = evaluateFormSubmission(form(undefined, { consent: "off" }), { values: { f0: "Ana", f1: "a@b.es" }, elapsedMs: 9000 }, { slug: "x" });
    expect(off.kind === "ok" && off.consent).toBeNull();
  });
});

// ─── Doble en memoria de UNA empresa ────────────────────────────────────────

function tenant(id: string, over: Partial<SubmitDeps> & { published?: BlockDataMap["form"] } = {}) {
  const { published = form(), ...rest } = over;
  const leads: Array<{ id: number; name: string; email: string; message: string; company?: string }> = [];
  const notes: Array<{ leadId: number; text: string }> = [];
  const subs: SubmissionRecord[] = [];
  const owner: unknown[] = [];
  const hits = new Map<string, number>();
  let clock = 1_800_000_000_000;
  const deps: SubmitDeps = {
    tenantId: id,
    now: () => clock,
    allow: (k) => {
      hits.set(k, (hits.get(k) ?? 0) + 1);
      return (hits.get(k) ?? 0) <= 3;
    },
    getForm: async (slug, blockId) => (slug === "contacto" && blockId === "blk1" ? { slug, data: published } : null),
    captchaConfig: async () => null,
    verifyCaptcha: async () => true,
    findRecent: async (email, slug, blockId, since) => {
      const s = [...subs].reverse().find((x) => x.email === email && x.slug === slug && x.blockId === blockId && x.at >= since);
      return s ? { leadId: s.leadId } : null;
    },
    createLead: async (l) => {
      leads.push({ id: leads.length + 1, ...l });
      return leads.length;
    },
    addLeadNote: async (leadId, text) => void notes.push({ leadId, text }),
    recordSubmission: async (r) => void subs.push(r),
    notifyOwner: async (n) => void owner.push(n),
    lock: (_k, fn) => fn(),
    ipSecret: "secreto-de-prueba",
    ...rest,
  };
  return { id, deps, leads, notes, subs, owner, tick: (ms: number) => (clock += ms) };
}
const input = (extra: Record<string, unknown> = {}) => ({ slug: "contacto", blockId: "blk1", values: { f0: "Ana Pérez", f1: "ana@ejemplo.es" } as Record<string, string>, ...ok, ...extra });

describe("E-7 · recorrido del envío", () => {
  it("guarda con el lead: consentimiento (texto, versión, fecha), formulario, página de origen, UTM y huella de IP (nunca la IP)", async () => {
    const t = tenant("a");
    const r = await processStudioSubmission(input({ meta: { page: "/programas?x=1", utm: { source: "news<script>", campaign: "otoño" } } }), "203.0.113.9", t.deps);
    expect(r).toMatchObject({ ok: true, id: 1 });
    expect(t.leads).toHaveLength(1);
    expect(t.leads[0].message).toContain("Origen: /programas?x=1");
    expect(t.leads[0].message).toContain("UTM campaign: otoño");
    expect(t.leads[0].message).toContain("Consentimiento RGPD: aceptado el");
    const s = t.subs[0];
    expect(s).toMatchObject({ leadId: 1, slug: "contacto", blockId: "blk1", formTitle: "Pide información", duplicate: false, page: "/programas?x=1" });
    expect(s.consent).toMatchObject({ given: true, text: DEFAULT_FORM_CONSENT_TEXT });
    expect(s.utm).toEqual({ source: "newsscript", campaign: "otoño" });
    expect(s.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(s)).not.toContain("203.0.113.9");
  });

  it("la huella de IP depende de la empresa y del secreto; sin secreto no se guarda nada", () => {
    expect(ipFingerprint("1.2.3.4", "a", "s")).not.toBe(ipFingerprint("1.2.3.4", "b", "s"));
    expect(ipFingerprint("1.2.3.4", "a", "s")).toBe(ipFingerprint("1.2.3.4", "a", "s"));
    expect(ipFingerprint("1.2.3.4", "a", "")).toBeNull();
  });

  it("mismo correo y formulario en la ventana corta: no se crea otro lead, se anota en el existente; fuera de la ventana, sí", async () => {
    const t = tenant("a");
    await processStudioSubmission(input(), "1.1.1.1", t.deps);
    t.tick(60_000);
    const r2 = await processStudioSubmission(input({ values: { f0: "Ana", f1: "ANA@ejemplo.es", f3: "otra cosa" } }), "1.1.1.2", t.deps);
    expect(r2).toMatchObject({ ok: true, id: 1 });
    expect(t.leads).toHaveLength(1);
    expect(t.notes).toHaveLength(1);
    expect(t.notes[0].leadId).toBe(1);
    expect(t.subs[1]).toMatchObject({ leadId: 1, duplicate: true });
    t.tick(FORM_DEDUPE_WINDOW_MS + 1);
    await processStudioSubmission(input(), "1.1.1.3", t.deps);
    expect(t.leads).toHaveLength(2);
  });

  it("antispam intacto: trampa y envío rápido no guardan nada; el límite por visitante responde 429", async () => {
    const t = tenant("a");
    expect(await processStudioSubmission(input({ website: "http://spam" }), "9.9.9.9", t.deps)).toMatchObject({ ok: true, id: 0 });
    expect(await processStudioSubmission(input({ elapsedMs: 100 }), "9.9.9.8", t.deps)).toMatchObject({ ok: true, id: 0 });
    expect(t.leads).toHaveLength(0);
    for (let i = 0; i < 3; i++) await processStudioSubmission(input({ website: "x" }), "7.7.7.7", t.deps).catch(() => {});
    await expect(processStudioSubmission(input(), "7.7.7.7", t.deps)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("formulario inexistente o en borrador: NOT_FOUND; demasiado grande: BAD_REQUEST", async () => {
    const t = tenant("a");
    await expect(processStudioSubmission(input({ blockId: "otro" }), "1.1.1.1", t.deps)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(processStudioSubmission(input({ values: { f0: "x".repeat(21_000) } }), "1.1.1.1", t.deps)).rejects.toBeInstanceOf(StudioSubmitError);
  });

  it("aviso al propietario solo si el formulario lo activa; un fallo del correo nunca rompe el envío", async () => {
    const off = tenant("a");
    await processStudioSubmission(input(), "1.1.1.1", off.deps);
    expect(off.owner).toHaveLength(0);
    const on = tenant("a", { published: form(undefined, { notifyOwner: "on" }) });
    await processStudioSubmission(input(), "1.1.1.1", on.deps);
    expect(on.owner).toHaveLength(1);
    expect(on.owner[0]).toMatchObject({ leadId: 1, duplicate: false, email: "ana@ejemplo.es" });
    const broken = tenant("a", {
      published: form(undefined, { notifyOwner: "on" }),
      notifyOwner: async () => {
        throw new Error("smtp caído");
      },
    });
    expect(await processStudioSubmission(input(), "1.1.1.1", broken.deps)).toMatchObject({ ok: true });
    expect(broken.leads).toHaveLength(1);
  });

  it("mensaje de éxito y destino configurables por formulario (texto sin HTML)", async () => {
    const t = tenant("a", { published: form(undefined, { successMessage: "¡Listo, te escribimos!", redirectUrl: "/gracias" }) });
    expect(await processStudioSubmission(input(), "1.1.1.1", t.deps)).toEqual({ ok: true, id: 1, message: "¡Listo, te escribimos!", redirectUrl: "/gracias" });
    // Son texto plano: se guardan acotados y la web los pinta como texto (React los escapa; el correo usa escapeHtml), nunca como HTML
    const [b] = normalizeBlocks([{ id: "f", type: "form", data: { errorMessage: "Ups ".repeat(200), consentText: "Acepto ".repeat(100) } }]) as any;
    expect(b.data.errorMessage.length).toBeLessThanOrEqual(300);
    expect(b.data.consentText.length).toBeLessThanOrEqual(300);
  });
});

describe("E-7 · Turnstile por empresa", () => {
  it("desactivado por defecto: sin la opción en el formulario no se pide ni se comprueba nada", async () => {
    const verify = vi.fn(async () => false);
    const t = tenant("a", { captchaConfig: async () => ({ siteKey: "sk", secretKey: "secreto" }), verifyCaptcha: verify });
    expect(await processStudioSubmission(input(), "1.1.1.1", t.deps)).toMatchObject({ ok: true });
    expect(verify).not.toHaveBeenCalled();
  });

  it("activado y con claves: sin token o con token inválido no se crea nada; con token válido sí, usando el secreto de ESA empresa", async () => {
    const verify = vi.fn(async (token: string, secret: string) => token === "bueno" && secret === "secreto-a");
    const t = tenant("a", { published: form(undefined, { captcha: "on" }), captchaConfig: async () => ({ siteKey: "sk-a", secretKey: "secreto-a" }), verifyCaptcha: verify });
    expect(await processStudioSubmission(input(), "1.1.1.1", t.deps)).toMatchObject({ ok: false, errors: { captcha: expect.any(String) } });
    expect(await processStudioSubmission(input({ captchaToken: "malo" }), "1.1.1.1", t.deps)).toMatchObject({ ok: false });
    expect(t.leads).toHaveLength(0);
    expect(await processStudioSubmission(input({ captchaToken: "bueno" }), "1.1.1.1", t.deps)).toMatchObject({ ok: true, id: 1 });
    expect(verify).toHaveBeenLastCalledWith("bueno", "secreto-a", "1.1.1.1");
  });

  it("activado en el formulario pero la empresa no tiene claves: el formulario sigue funcionando (sin tercero)", async () => {
    const t = tenant("a", { published: form(undefined, { captcha: "on" }) });
    expect(await processStudioSubmission(input(), "1.1.1.1", t.deps)).toMatchObject({ ok: true });
  });

  it("verifyTurnstile: éxito, rechazo, error de red y respuesta rara = no verificado; nunca lanza", async () => {
    const f = (body: unknown, okStatus = true) => vi.fn(async () => ({ ok: okStatus, json: async () => body })) as unknown as typeof fetch;
    expect(await verifyTurnstile("t", "s", "1.1.1.1", f({ success: true }))).toBe(true);
    expect(await verifyTurnstile("t", "s", "1.1.1.1", f({ success: false }))).toBe(false);
    expect(await verifyTurnstile("t", "s", "1.1.1.1", f({}, false))).toBe(false);
    expect(
      await verifyTurnstile("t", "s", "1.1.1.1", vi.fn(async () => {
        throw new Error("red");
      }) as unknown as typeof fetch),
    ).toBe(false);
    expect(await verifyTurnstile("", "s", "1.1.1.1", f({ success: true }))).toBe(false);
    const call = f({ success: true });
    await verifyTurnstile("tok", "sec", "9.9.9.9", call);
    const [url, init] = (call as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string, { body: URLSearchParams }];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(init.body.get("secret")).toBe("sec");
    expect(init.body.get("remoteip")).toBe("9.9.9.9");
  });
});

describe("E-7 · origen (CSRF)", () => {
  it("el origen debe ser el mismo sitio; sin cabecera (no navegador) se admite y queda el límite por visitante", () => {
    expect(sameSiteOrigin("https://web.ejemplo.es", "web.ejemplo.es")).toBe(true);
    expect(sameSiteOrigin("https://otra.es", "web.ejemplo.es")).toBe(false);
    expect(sameSiteOrigin("https://web.ejemplo.es.atacante.com", "web.ejemplo.es")).toBe(false);
    expect(sameSiteOrigin("null", "web.ejemplo.es")).toBe(false);
    expect(sameSiteOrigin("no-es-una-url", "web.ejemplo.es")).toBe(false);
    expect(sameSiteOrigin(undefined, "web.ejemplo.es")).toBe(true);
  });
});

describe("E-7 · aislamiento entre empresas", () => {
  const ring: Keyring = { keys: new Map([["k1", Buffer.alloc(32, 7)]]), activeId: "k1" };
  const vaultOf = (id: string, store = new MemoryCredentialStore()) => ({ vault: new IntegrationVault(store, () => id, () => ring), store });

  it("un envío en A nunca crea datos en B (cada empresa tiene su propio almacén y su propio límite)", async () => {
    const a = tenant("a");
    const b = tenant("b");
    await processStudioSubmission(input(), "1.1.1.1", a.deps);
    expect(a.leads).toHaveLength(1);
    expect(a.subs).toHaveLength(1);
    expect(b.leads).toHaveLength(0);
    expect(b.subs).toHaveLength(0);
    expect(b.notes).toHaveLength(0);
    // Mismo correo y formulario en B: es un lead nuevo (la detección de duplicados no cruza empresas)
    await processStudioSubmission(input(), "1.1.1.1", b.deps);
    expect(b.leads).toHaveLength(1);
    expect(b.notes).toHaveLength(0);
  });

  it("el límite por visitante incluye la empresa: agotarlo en A no bloquea a B ni al revés", () => {
    const k = (t: string) => `${t}:contacto:5.5.5.5`;
    const stamp = String(Math.random());
    for (let i = 0; i < 5; i++) expect(allowFormSubmit(`${stamp}${k("a")}`, 1000 + i)).toBe(true);
    expect(allowFormSubmit(`${stamp}${k("a")}`, 1100)).toBe(false);
    expect(allowFormSubmit(`${stamp}${k("b")}`, 1100)).toBe(true);
  });

  it("las claves de Turnstile no se mezclan: cada empresa lee solo las suyas y el cifrado de una no sirve en otra", async () => {
    const A = vaultOf("empresa-a");
    const B = vaultOf("empresa-b");
    await A.vault.save("turnstile", { siteKey: "site-key-AAAA", secretKey: "secret-key-AAAA" }, "u");
    await B.vault.save("turnstile", { siteKey: "site-key-BBBB", secretKey: "secret-key-BBBB" }, "u");
    expect(await readCaptchaConfig(A.vault)).toEqual({ siteKey: "site-key-AAAA", secretKey: "secret-key-AAAA" });
    expect(await readCaptchaConfig(B.vault)).toEqual({ siteKey: "site-key-BBBB", secretKey: "secret-key-BBBB" });
    // Las claves van cifradas en el almacén (ni la pública ni la secreta en claro)
    for (const r of A.store.rows.values()) {
      expect(r.secret).toBe(true);
      expect(r.value).not.toContain("AAAA");
    }
    // Un valor cifrado de A copiado a la BD de B no se descifra (AAD con la empresa): se trata como «sin configurar»
    const stolen = new MemoryCredentialStore();
    for (const [k, v] of A.store.rows) stolen.rows.set(k, v);
    expect(await readCaptchaConfig(vaultOf("empresa-b", stolen).vault)).toBeNull();
    // Una empresa sin claves no hereda las de otra
    expect(await readCaptchaConfig(vaultOf("empresa-c").vault)).toBeNull();
  });

  it("la verificación usa el secreto de la empresa que recibe el envío, aunque otra haya activado Turnstile", async () => {
    const seen: string[] = [];
    const mk = (id: string, secret: string | null) =>
      tenant(id, {
        published: form(undefined, { captcha: "on" }),
        captchaConfig: async () => (secret ? { siteKey: `s-${id}`, secretKey: secret } : null),
        verifyCaptcha: async (_t, s) => {
          seen.push(s);
          return true;
        },
      });
    const a = mk("a", "secreto-a");
    const b = mk("b", null);
    await processStudioSubmission(input({ captchaToken: "t" }), "1.1.1.1", a.deps);
    await processStudioSubmission(input({ captchaToken: "t" }), "1.1.1.1", b.deps);
    expect(seen).toEqual(["secreto-a"]);
    expect(b.leads).toHaveLength(1);
  });

  it("el catálogo de credenciales declara Turnstile con ambas claves cifradas y comprobación solo local", () => {
    const p = PROVIDERS.find((x) => x.id === "turnstile")!;
    expect(p.fields.map((f) => [f.key, f.secret])).toEqual([
      ["siteKey", true],
      ["secretKey", true],
    ]);
    expect(p.check).toBeTruthy();
  });
});

describe("E-7 · migración 0066", () => {
  it("solo crea una tabla propia (no toca leads ni otras tablas) y su reversión solo la borra", async () => {
    const fs = await import("node:fs");
    const up = fs.readFileSync(new URL("../db/migrations/0066_studio_form_submissions.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
    const down = fs.readFileSync(new URL("../db/migrations/0066_studio_form_submissions.down.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
    expect(up).toMatch(/CREATE TABLE IF NOT EXISTS studio_form_submissions/);
    expect(up).not.toMatch(/ALTER TABLE|DROP|DELETE|TRUNCATE/i);
    expect(down.trim()).toBe("DROP TABLE IF EXISTS studio_form_submissions;");
  });
});
