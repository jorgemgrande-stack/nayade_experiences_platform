/**
 * Qué puede hacer una sesión de soporte delegado (decisión 13/11/2026).
 *
 *  - VETADO siempre (también con modificación): gestión de usuarios, roles y permisos, accesos de portales, seguridad
 *    de cuenta, secretos y credenciales de integraciones, y operaciones críticas no necesarias para dar soporte
 *    (plan y facturación de la suscripción, dominios, contadores fiscales, borrados masivos).
 *  - EXPORTACIONES y descargas sensibles: solo con modificación, y auditadas antes de servirlas.
 *  - Respuestas: IBAN, secretos, tokens y contraseñas se enmascaran para el usuario de soporte.
 *
 * Se aplica en dos sitios: en el borde HTTP (rutas Express; ./session.ts) y por procedimiento tRPC (server/_core/trpc.ts),
 * para que un procedimiento vetado no tumbe el resto de un lote de consultas del panel.
 */

const FORBIDDEN_PROCEDURES = new Set<string>([
  // Usuarios, roles y permisos
  "admin.createUser", "admin.changeUserRole", "admin.toggleUserActive", "admin.resendInvite", "admin.setUserPassword", "admin.deleteUser",
  "admin.assignRbacRole", "admin.removeRbacRole",
  "customRoles.create", "customRoles.update", "customRoles.remove", "customRoles.assign",
  "sites.setUserSites", "tpv.setRegisterOperators",
  "hr.employees.createPortalAccess", "hr.employees.revokePortalAccess",
  "partners.inviteUser", "partners.removeUser", "suppliers.inviteSupplierUser", "gestoria.access.createPortalAccess",
  "communities.admin.members.add", "communities.admin.members.invite", "communities.admin.members.resendInvite", "communities.admin.members.setRole",
  "communities.admin.members.setStatus", "skiSchool.linkUser",
  "restaurants.adminAssignStaff", "restaurants.adminRemoveStaff",
  // Secretos y credenciales de integraciones (lectura y escritura)
  "integrations.save", "integrations.clear",
  "ghlInbox.getInboxCredentials", "ghlInbox.saveInboxCredentials",
  "vapiCalls.getCredentials", "vapiCalls.saveCredentials",
  "voiceSetup.saveKey", "voiceSetup.connect", "voiceSetup.disconnect",
  "postmarkTenant.save", "postmarkTenant.generateWebhookToken", "postmarkTenant.disconnect",
  "multichannel.rotateInboundToken", "multichannel.revokeInboundToken",
  "emailAccounts.create", "emailAccounts.update", "emailAccounts.delete", "emailAccounts.testImap", "emailAccounts.testSmtp",
  "financeSync.setup", "financeSync.saveMailbox", "financeSync.testMailbox",
  "whatsappCloud.verify", "whatsappCloud.saveSettings", "brevoMarketing.disconnect",
  "receptionAi.regenerateChatLink", "travel.veturisSaveSettings",
  "hotel.adminIcalIssueExport", "hotel.adminIcalRevokeExport", "hotel.adminSetPmsSettings",
  // Ajustes del sitio y del sistema: mezclan claves sensibles (clave de GHL, IBAN de la empresa, entorno de pagos…)
  "cms.updateSiteSettings", "config.updateSystemSetting", "config.updateFeatureFlag",
  // Operaciones críticas no necesarias para el soporte
  "subscription.purchase", "subscription.reduce", "subscription.withdraw", "subscription.billingPortal", "subscription.conversionStart",
  "subscription.cancel", "subscription.undoCancel", "subscription.changePlan", "subscription.planRequest",
  "connect.request", "connect.retryActivation",
  "domains.add", "domains.check", "domains.setPrimary", "domains.disconnect",
  "documentNumbers.resetCounter",
  "crm.leads.bulkDelete", "crm.quotes.bulkDelete", "crm.reservations.bulkDelete", "proposals.bulkDelete",
  "crm.invoices.void", "crm.invoices.delete",
  "setupWizard.saveCompany", "setupWizard.saveFiscal",
  "dataExport.request", "dataExport.link",
  "system.notifyOwner",
]);
/** Prefijos vetados enteros (seguridad de la cuenta de otra persona, etc.). */
const FORBIDDEN_PREFIXES = ["accountSecurity."];

const EXPORT_PROCEDURES = new Set<string>([
  "crm.invoices.exportForGestoria", "crm.invoices.downloadPdf", "crm.clients.exportCsv",
  "accountingGeneral.export", "multichannel.exportSales", "inventory.exportCsv", "tpvAdvanced.exportCsv", "tpv.reports.exportCsv",
  "restaurantReports.csv", "careReports.csv", "skiReports.csv", "travelReports.csv",
  "gestoria.expenses.exportCsv", "skiSchool.exportSettlementCsv", "skiSchool.exportSettlementPdf",
  "reav.exportZip", "crm.reservations.downloadPdf", "crm.quotes.generatePdf",
  "gestoria.dossiers.generate", "partners.generateBatchPdf", "settlements.generatePdf",
]);

/** Para el test que comprueba que cada nombre existe en el router (un nombre mal escrito no veta nada). */
export const SUPPORT_POLICY_NAMES = { forbidden: Array.from(FORBIDDEN_PROCEDURES), export: Array.from(EXPORT_PROCEDURES), forbiddenPrefixes: FORBIDDEN_PREFIXES };

export type SupportKind = "forbidden" | "export" | "normal";

export function supportProcedureKind(path: string): SupportKind {
  if (FORBIDDEN_PROCEDURES.has(path) || FORBIDDEN_PREFIXES.some((p) => path.startsWith(p))) return "forbidden";
  if (EXPORT_PROCEDURES.has(path) || /\.(export\w*|download\w*)$/i.test(path)) return "export";
  return "normal";
}

/** Procedimientos de una URL tRPC (`/api/trpc/a.b,c.d?batch=1`), decodificados. */
export function trpcProcedures(url: string): string[] | null {
  const path = url.split("?")[0];
  const m = /^\/api\/trpc\/(.+)$/.exec(path);
  if (!m) return null;
  let raw = m[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    /* se usa tal cual */
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Clasificación en el borde HTTP. tRPC se decide por procedimiento (trpc.ts); aquí solo se describe el recurso.
 * Rutas Express: autenticación propia (cambiar contraseñas…) vetada; exportaciones a Excel/CSV/ZIP, solo con modificación.
 */
export function classifySupportRequest(method: string, url: string): { kind: SupportKind; resource: string } {
  const path = url.split("?")[0];
  const procs = trpcProcedures(url);
  if (procs) return { kind: "normal", resource: procs.join(",").slice(0, 200) };
  const resource = path.slice(0, 200);
  // Express no distingue mayúsculas en las rutas: la comparación tampoco
  const lower = path.toLowerCase();
  if (lower.startsWith("/api/auth/") && method !== "GET" && method !== "HEAD") return { kind: "forbidden", resource };
  // Diagnóstico y recuperación de pagos (filas completas de pedidos, rehacer cobros): no son de soporte delegado
  if (lower.startsWith("/api/admin/")) return { kind: "forbidden", resource };
  if (/\/(export|exports)(\b|-|\/)|export-excel|\.(csv|xlsx|zip)$/i.test(path)) return { kind: "export", resource };
  return { kind: "normal", resource };
}

const SECRET_KEY = /(iban|secret|password|passwd|^pass$|token|apikey|api_key|privatekey|private_key|clientsecret|credential|accountnumber|account_number|merchantkey|merchant_key|serviceaccount|service_account|signingkey|webhookkey)/i;
/**
 * Campos que solo describen el secreto (si existe, su caducidad, sus 4 últimas cifras…), no lo contienen. Sufijos en
 * camelCase (sensible a mayúsculas): «tokenFormat» NO se libra por acabar en «at»; «tokenExpiresAt» sí.
 */
const KEEP_KEY = /(ExpiresAt|Expiry|Expires|At|Count|Type|Kind|Status|Required|Enabled|Configured|Present|Last4|Masked|Display|Holder|Hint|Label)$/;
/** Clave de una fila de ajustes ({ key, value }) cuyo valor es sensible (p. ej. `site_legal_iban`, `redsys_merchant_key`). */
const SENSITIVE_SETTING = /(iban|secret|password|pass$|token|api_?key|private|merchant|credential|account|webhook)/i;
const isSecretKey = (k: string) => SECRET_KEY.test(k) && !KEEP_KEY.test(k);

function maskValue(key: string, v: string | number): string | number {
  if (v === "" || v === null) return v;
  v = String(v);
  if (/iban|account/i.test(key)) return v.length > 4 ? `•••• ${v.replace(/\s+/g, "").slice(-4)}` : "••••";
  return "••••••";
}

/** Enmascara IBAN, secretos, tokens y contraseñas de una respuesta para el usuario de soporte (recursivo, sin mutar). */
export function maskForSupport<T>(data: T, depth = 0): T {
  if (depth > 12 || data === null || typeof data !== "object") return data;
  if (Array.isArray(data)) return data.map((x) => maskForSupport(x, depth + 1)) as unknown as T;
  // Solo objetos planos: fechas, Buffer, Decimal, Map… se devuelven tal cual
  const proto = Object.getPrototypeOf(data);
  if (proto !== Object.prototype && proto !== null) return data;
  const src = data as Record<string, unknown>;
  // Filas de ajustes { key, value }: se decide por la clave del ajuste, no por el nombre del campo
  const settingSensitive = typeof src.key === "string" && "value" in src && SENSITIVE_SETTING.test(src.key);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if ((typeof v === "string" || typeof v === "number") && (isSecretKey(k) || (settingSensitive && k === "value"))) out[k] = maskValue(settingSensitive && k === "value" ? String(src.key) : k, v);
    else if (v !== null && typeof v === "object" && isSecretKey(k)) out[k] = "••••••"; // JSON de credenciales completo
    else out[k] = maskForSupport(v, depth + 1);
  }
  return out as T;
}

/**
 * ¿La entrada de una modificación lleva datos bancarios o secretos? En modo soporte no se escriben: además de ser datos
 * de pago o credenciales, el formulario los recibe enmascarados y guardarlos los estropearía.
 */
export function inputTouchesSecrets(input: unknown, depth = 0): boolean {
  if (depth > 8 || input === null || typeof input !== "object") return false;
  if (Array.isArray(input)) return input.some((x) => inputTouchesSecrets(x, depth + 1));
  const o = input as Record<string, unknown>;
  if (typeof o.key === "string" && "value" in o && SENSITIVE_SETTING.test(o.key)) return true;
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && isSecretKey(k)) return true;
    if (inputTouchesSecrets(v, depth + 1)) return true;
  }
  return false;
}
