/**
 * Autocompletado de credenciales en el panel (24/11/2026). En production Chrome rellenaba «Usuario IMAP», «Contraseña
 * IMAP», «Número de terminal» y los campos de clave secreta con el correo/contraseña del administrador, porque los
 * tomaba por un inicio de sesión. Riesgo: guardar sin querer la contraseña del administrador como credencial de un
 * servicio.
 *
 * Guarda 1 (fuentes): todo `<Input|input>` del panel que sea una credencial o un secreto debe llevar los atributos
 * acordados (los da `@/lib/credentialFields`, o se escriben a mano) y `name`/`id` específicos.
 * Guarda 2 (componentes): el formulario de cuenta de correo y el de Integraciones se pintan en el servidor y se
 * comprueban los atributos renderizados y que un secreto guardado no se precarga.
 *
 * `autocomplete="off"` no garantiza que Chrome ni los gestores de contraseñas lo respeten; por eso se combina con
 * `new-password` en secretos, nombres específicos y las pistas data-*. Esta guarda evita regresiones, no lo certifica.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

(globalThis as { React?: unknown }).React = React;

// ─── Guarda 1: fuentes ────────────────────────────────────────────────────────

const ROOT = path.join(__dirname, "../client/src");
const SECRETISH = /imap|smtp|passw|contrase|secret|clave|api[-_ ]?key|token|terminal|merchant|webhook|credencial|private/i;
// Pantallas de inicio de sesión / alta de la contraseña propia del usuario (ahí SÍ debe poder rellenar el gestor) y
// falsos positivos de la palabra «terminal»/«clave»/«webhook» en campos que no son credenciales.
const EXCEPTIONS: Record<string, string> = {
  "pages/Login.tsx": "inicio de sesión: current-password/username son lo correcto",
  "pages/ForgotPassword.tsx": "recuperación de cuenta propia",
  "pages/ResetPassword.tsx": "contraseña propia (autoComplete llega por prop)",
  "pages/SetPassword.tsx": "contraseña propia, new-password",
  "pages/admin/MiCuenta.tsx": "cambio de la contraseña propia (current-password)",
  "components/admin/UsersManager.tsx": "alta de contraseña de otro usuario, new-password",
  "pages/admin/partners/PartnersManager.tsx": "alta de contraseña de un partner, new-password",
  "pages/community/ActivateMember.tsx": "activación de la cuenta propia, new-password",
  "pages/learning/Aula.tsx": "alta de la contraseña propia del alumno, new-password",
  "pages/employee/ActivarEmpleado.tsx": "página pública de activación de la cuenta propia (fuera del panel)",
  "pages/gestoria/ActivarGestoria.tsx": "página pública de activación de la cuenta propia (fuera del panel)",
  "pages/partner/ActivarPartner.tsx": "página pública de activación de la cuenta propia (fuera del panel)",
  "pages/supplier/ActivarProveedor.tsx": "página pública de activación de la cuenta propia (fuera del panel)",
  "pages/admin/accounting/CardTerminalBatchesManager.tsx": "justificación en texto libre (menciona «terminal»)",
  "pages/admin/accounting/CardTerminalOperationsManager.tsx": "buscador de operaciones",
  "pages/admin/commercial/WhatsAppCloud.tsx": "URL de webhook de solo lectura para copiar",
  "pages/admin/marketing/SeoControl.tsx": "palabra clave SEO",
  "pages/admin/communities/CommunityDetail.tsx": "buscador de personas",
  "pages/admin/PdfTemplatesManager.tsx": "plantillas PDF de texto libre",
  "pages/admin/products/EditionsPanel.tsx": "texto libre",
  "pages/admin/ski/SkiTeacherHours.tsx": "correo de un usuario a buscar, no una credencial",
};
const TAG = /<(Input|input|Textarea|textarea)\b((?:[^<>{}]|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})*?)\/?>/g;
const HINTS = ["data-lpignore", "data-1p-ignore", "data-bwignore", "data-form-type"];

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sources(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

describe("autocompletado de credenciales: fuentes", () => {
  const found: Array<{ rel: string; line: number; tag: string; secret: boolean }> = [];
  for (const file of sources(ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (EXCEPTIONS[rel]) continue;
    const s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    for (const m of s.matchAll(TAG)) {
      const tag = m[0];
      if (/type="(checkbox|radio|number|hidden|file|time|date)"/.test(tag) || /\breadOnly\b/.test(tag)) continue;
      const before = s.slice(Math.max(0, (m.index ?? 0) - 250), m.index).split("\n").slice(-3).join(" ");
      const isPwd = /type=(?:"password"|\{[^}]*"password"[^}]*\})/.test(tag) || /\bf\.secret\b/.test(tag);
      if (!isPwd && !SECRETISH.test(tag) && !SECRETISH.test(before)) continue;
      found.push({ rel, line: s.slice(0, m.index).split("\n").length, tag, secret: isPwd });
    }
  }

  it("encuentra los campos de credenciales del panel (la guarda no está vacía)", () => {
    const rels = new Set(found.map((f) => f.rel));
    for (const r of ["pages/admin/settings/EmailAccountsSettings.tsx", "pages/admin/settings/Integrations.tsx", "pages/admin/settings/PostmarkSettings.tsx", "pages/admin/commercial/VapiAgente.tsx", "pages/admin/commercial/WhatsAppGHLInbox.tsx"]) {
      expect(rels.has(r), r).toBe(true);
    }
  });

  it("cada campo de credencial o secreto lleva autoComplete adecuado, nombre específico y las pistas de gestores", () => {
    const bad: string[] = [];
    for (const f of found) {
      const helper = /service(?:Secret|Field)Props\(/.test(f.tag);
      const literal = HINTS.every((h) => f.tag.includes(h)) && /autoComplete=/.test(f.tag) && /\bname=/.test(f.tag);
      if (!helper && !literal) bad.push(`${f.rel}:${f.line}`);
      if (f.secret && !/serviceSecretProps\(|autoComplete="new-password"/.test(f.tag)) bad.push(`${f.rel}:${f.line} (secreto sin new-password)`);
      if (/\bname="(?:username|password|email|user|pass)"/.test(f.tag)) bad.push(`${f.rel}:${f.line} (name genérico de inicio de sesión)`);
    }
    expect(bad, `Campos sin los atributos de autocompletado acordados (usa @/lib/credentialFields):\n${bad.join("\n")}`).toEqual([]);
  });

  it("los secretos de servicio parten vacíos y el secreto de los webhooks se escribe como contraseña", () => {
    const read = (r: string) => fs.readFileSync(path.join(ROOT, r), "utf8").replace(/\r\n/g, "\n");
    const vapi = read("pages/admin/commercial/VapiAgente.tsx");
    const ghl = read("pages/admin/commercial/WhatsAppGHLInbox.tsx");
    expect(vapi).toMatch(/\[credApiKey, setCredApiKey\] = useState\(""\)/);
    expect(vapi).toMatch(/\[credSecret, setCredSecret\] = useState\(""\)/);
    expect(ghl).toMatch(/\[credToken, setCredToken\] = useState\(""\)/);
    expect(ghl).toMatch(/\[credSecret, setCredSecret\] = useState\(""\)/);
    expect(vapi).toMatch(/type="password"\s*\n\s*\{\.\.\.serviceSecretProps\("vapi-webhook-secreto"\)\}/);
    expect(ghl).toMatch(/type="password"\s*\n\s*\{\.\.\.serviceSecretProps\("ghl-inbox-webhook-secreto"\)\}/);
  });

  it("las excepciones apuntan a ficheros que existen", () => {
    for (const rel of Object.keys(EXCEPTIONS)) expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
  });
});

// ─── Guarda 2: componentes ────────────────────────────────────────────────────

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({ locale: "es", t: (k: string, p?: Record<string, string>) => (p ? `${k}|${Object.values(p).join(",")}` : k) }),
}));
vi.mock("@/lib/trpc", () => {
  const deep: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => (prop === "useMutation" ? () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false }) : prop === "useUtils" ? () => ({}) : deep),
    apply: () => ({}),
  });
  return { trpc: deep };
});
vi.mock("@/components/AdminLayout", () => ({ default: ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children) }));
vi.mock("@/components/ui/dialog", () => {
  const box = (tag: string) => ({ children }: { children?: React.ReactNode }) => React.createElement(tag, null, children);
  return { Dialog: box("div"), DialogContent: box("section"), DialogHeader: box("header"), DialogFooter: box("footer"), DialogTitle: box("h2"), DialogDescription: box("p"), useDialogComposition: () => ({ isComposing: () => false, setComposing: () => undefined, justEndedComposing: () => false, markCompositionEnd: () => undefined }) };
});

import { AccountModal } from "../client/src/pages/admin/settings/EmailAccountsSettings";
import { FieldInput } from "../client/src/pages/admin/settings/Integrations";
import type { PanelField, PanelIntegration } from "../shared/integrationsPanel";

function inputs(html: string) {
  return [...html.matchAll(/<input\b[^>]*>/g)].map((m) => {
    const attr = (n: string) => m[0].match(new RegExp(`\\s${n}="([^"]*)"`, "i"))?.[1];
    return { raw: m[0], name: attr("name"), id: attr("id"), type: attr("type"), ac: attr("autocomplete"), value: attr("value") };
  });
}

describe("autocompletado de credenciales: cuenta de correo", () => {
  const initial = {
    name: "Soporte", email: "soporte@ejemplo.invalid", fromName: "", fromEmail: "",
    imapHost: "imap.ejemplo.invalid", imapPort: 993, imapSecure: true, imapUser: "buzon", imapPassword: "",
    smtpHost: "smtp.ejemplo.invalid", smtpPort: 587, smtpSecure: false, smtpUser: "buzon", smtpPassword: "",
    folderInbox: "INBOX", folderSent: "Sent", folderArchive: "Archive", folderTrash: "Trash",
    maxEmailsPerSync: 50, syncIntervalMinutes: 15, syncEnabled: true, isDefault: false,
  };
  const html = renderToStaticMarkup(React.createElement(AccountModal, { open: true, onClose: () => undefined, editId: 7, initial: initial as never }));
  const list = inputs(html);
  const by = (n: string) => list.find((i) => i.name === n);

  it("usuarios IMAP/SMTP: texto, autocomplete off, nombre específico y pistas de gestores", () => {
    for (const n of ["imap-usuario", "smtp-usuario"]) {
      const i = by(n)!;
      expect(i, n).toBeTruthy();
      expect(i.ac).toBe("off");
      expect(i.id).toBe(n);
      expect(i.type === undefined || i.type === "text").toBe(true);
      for (const h of HINTS) expect(i.raw).toContain(h);
    }
  });

  it("contraseñas IMAP/SMTP: password con new-password y sin valor precargado", () => {
    for (const n of ["imap-clave", "smtp-clave"]) {
      const i = by(n)!;
      expect(i, n).toBeTruthy();
      expect(i.type).toBe("password");
      expect(i.ac).toBe("new-password");
      expect(i.value ?? "").toBe("");
      for (const h of HINTS) expect(i.raw).toContain(h);
    }
  });

  it("ningún campo usa un nombre genérico de inicio de sesión y el correo de la cuenta no se autorrellena", () => {
    for (const i of list) expect(i.name ?? "", i.raw).not.toMatch(/^(username|password|email|user|pass)$/);
    expect(by("cuenta-direccion")?.ac).toBe("off");
  });
});

describe("autocompletado de credenciales: Integraciones", () => {
  const p = { id: "pasarela", title: "Pasarela", fields: [] } as unknown as PanelIntegration;
  const base = { help: null, required: false, options: [], pattern: null, formatMessage: null, example: null, set: false, display: null, secret: false, control: "text", key: "campo", label: "Campo" };
  const render = (f: Partial<PanelField>, value?: string) =>
    inputs(renderToStaticMarkup(React.createElement(FieldInput, { p, f: { ...base, ...f } as PanelField, value, onChange: () => undefined, error: null })))[0];

  it("un secreto guardado no se precarga: value vacío y la máscara va en el placeholder", () => {
    const i = render({ key: "claveSecreta", secret: true, control: "secret", set: true, display: "•••• guardada" });
    expect(i.type).toBe("password");
    expect(i.ac).toBe("new-password");
    expect(i.value ?? "").toBe("");
    expect(i.raw).toContain("placeholder=");
    expect(i.raw).not.toMatch(/value="[^"]+"/);
    expect(i.name).toBe("pasarela-claveSecreta");
    for (const h of HINTS) expect(i.raw).toContain(h);
  });

  it("un identificador de servicio (p. ej. terminal) es texto con autocomplete off, nombre propio y pistas", () => {
    const i = render({ key: "terminal", label: "Número de terminal", display: "001" });
    expect(i.type).toBe("text");
    expect(i.ac).toBe("off");
    expect(i.name).toBe("pasarela-terminal");
    for (const h of HINTS) expect(i.raw).toContain(h);
  });

  it("lo que teclea el administrador sí se muestra (el envío no cambia)", () => {
    expect(render({ key: "claveSecreta", secret: true, control: "secret" }, "nuevo").value).toBe("nuevo");
  });
});
