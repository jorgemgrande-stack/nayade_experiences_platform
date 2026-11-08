/**
 * Contratos y firma electrónica (namespace `contractsEsign`, licenciado con la capacidad `contracts-esign` en
 * server/_core/capabilities/routeGuard.ts: sin ella, 403; en solo lectura, solo consultas). Cada procedimiento lo
 * comprueba además aquí (`licensed`).
 *
 * Roles: el equipo comercial (admin y agente; `readonly` solo consulta) crea contratos, los envía a firma y recoge la
 * firma en el panel. Las plantillas y la anulación son de la administración. La lógica vive en server/contractsEsignDb.ts.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router, staffProcedure } from "../_core/trpc";
import { getCapabilityAccess } from "../_core/capabilities/access";
import * as esign from "../contractsEsignDb";
import { CONTRACT_STATUSES, ESIGN_CAPABILITY, ESIGN_LIMITS } from "../../shared/contractsEsign";

const id = z.number().int().positive();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha no es válida.");
const amount = z.number().min(0).max(99_999_999).nullable();

async function checkLicense(write: boolean) {
  const d = await getCapabilityAccess().check(ESIGN_CAPABILITY, { write });
  if (!d.allowed) throw new TRPCError({ code: "FORBIDDEN", message: d.reason || "Contratos y firma electrónica no está incluido en tu plan." });
}
/** Además del guardián de rutas: licencia `contracts-esign` (consultas en solo lectura; operar exige la licencia activa). */
const staff = staffProcedure.use(async ({ type, next }) => {
  await checkLicense(type === "mutation");
  return next();
});
const admin = adminProcedure.use(async ({ type, next }) => {
  await checkLicense(type === "mutation");
  return next();
});

const evidence = (ctx: { req: { ip?: string; headers: Record<string, string | string[] | undefined> } }): esign.Evidence => {
  const ua = ctx.req.headers["user-agent"];
  return { ip: ctx.req.ip ?? null, userAgent: typeof ua === "string" ? ua.slice(0, 300) : null };
};

export const contractsEsignRouter = router({
  // ── Plantillas ─────────────────────────────────────────────────────────
  templates: staff.input(z.object({ includeInactive: z.boolean().optional() }).optional()).query(({ input }) => esign.listTemplates(input?.includeInactive ?? false)),
  saveTemplate: admin
    .input(z.object({ id: id.optional(), title: z.string().max(ESIGN_LIMITS.titleMax), body: z.string().max(ESIGN_LIMITS.bodyMax) }))
    .mutation(({ ctx, input }) => esign.saveTemplate(input, ctx.user.id)),
  setTemplateActive: admin.input(z.object({ id, active: z.boolean() })).mutation(({ ctx, input }) => esign.setTemplateActive(input.id, input.active, ctx.user.id)),

  // ── Contratos ──────────────────────────────────────────────────────────
  clients: staff.input(z.object({ q: z.string().max(100).default("") })).query(({ input }) => esign.searchClients(input.q)),
  list: staff
    .input(z.object({ status: z.enum(CONTRACT_STATUSES).optional(), q: z.string().max(100).optional() }).optional())
    .query(({ input }) => esign.listContracts(input ?? {})),
  get: staff.input(z.object({ id })).query(({ input }) => esign.getContract(input.id)),
  create: staff
    .input(z.object({ templateId: id, clientId: id, amount: amount.optional(), contractDate: day.nullish(), quoteId: id.nullish(), reservationId: id.nullish() }))
    .mutation(({ ctx, input }) => esign.createContract(input, ctx.user.id)),
  updateDraft: staff
    .input(z.object({ id, title: z.string().max(ESIGN_LIMITS.titleMax), body: z.string().max(ESIGN_LIMITS.bodyMax), amount: amount.optional() }))
    .mutation(({ ctx, input }) => esign.updateDraft(input, ctx.user.id)),
  send: staff
    .input(z.object({ id, hours: z.number().int().min(1).max(ESIGN_LIMITS.linkMaxHours).optional(), email: z.boolean() }))
    .mutation(({ ctx, input }) => esign.sendForSignature(input, ctx.user.id)),
  revokeLink: staff.input(z.object({ id })).mutation(({ ctx, input }) => esign.revokeSignLink(input.id, ctx.user.id)),
  signInPanel: staff
    .input(z.object({ id, signerName: z.string().max(ESIGN_LIMITS.nameMax), signerTaxId: z.string().max(ESIGN_LIMITS.taxIdMax + 10).nullish(), accepted: z.boolean() }))
    .mutation(({ ctx, input }) => esign.signInPanel(input, ctx.user.id, evidence(ctx))),
  void: admin.input(z.object({ id, reason: z.string().max(ESIGN_LIMITS.reasonMax) })).mutation(({ ctx, input }) => esign.voidContract(input.id, input.reason, ctx.user.id)),
  // Consulta (también en solo lectura): la primera vez genera y guarda el PDF firmado
  downloadPdf: staff.input(z.object({ id })).query(({ input }) => esign.downloadPdf(input.id)),
});
