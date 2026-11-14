/**
 * Convocatorias de un producto (E-4): ediciones con fechas y plazas, y sus inscripciones. Se monta dentro de `products`
 * (`products.editions.*`), así que la licencia es la del catálogo (`shop-catalog`) y solo administración llega aquí.
 * La lógica y las reglas de plazas están en server/editionsDb.ts.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { adminProcedure, router } from "../_core/trpc";
import { EDITION_MODES, EDITION_STATUSES, ENROLLMENT_STATUSES, EDITION_LIMITS } from "../../shared/editions";
import { notifyEnrollmentChange, getNotifySettings, saveNotifySettings } from "../editionsNotify";
import { EditionError, addEnrollment, searchPeople, cancelEdition, createEdition, duplicateEdition, isMissingEditionsSchema, listEditions, listEnrollments, listUpcomingEditions, recountReserved, setEnrollmentStatus, updateEdition } from "../editionsDb";

const id = z.number().int().positive();
const local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Fecha y hora no válidas");

const form = z.object({
  label: z.string().max(EDITION_LIMITS.label * 2),
  startsLocal: local,
  endsLocal: local.nullable(),
  timezone: z.string().max(64),
  scheduleNote: z.string().max(EDITION_LIMITS.schedule * 2),
  mode: z.enum(EDITION_MODES),
  locationNote: z.string().max(EDITION_LIMITS.location * 2),
  capacity: z.number().int().nullable(),
  showAvailability: z.boolean(),
  status: z.enum(EDITION_STATUSES),
  priceOverride: z.number().finite().nullable(),
});

/** Los errores de reglas salen como errores tRPC con su texto en español; la falta de migración, como aviso claro. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EditionError) throw new TRPCError({ code: e.code, message: e.message });
    if (isMissingEditionsSchema(e)) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Las convocatorias todavía no están activadas en tu empresa. Avisa a soporte." });
    throw e;
  }
}

export const editionsRouter = router({
  /** Convocatorias de un producto, con el recuento de inscripciones por estado. */
  list: adminProcedure.input(z.object({ experienceId: id })).query(({ input }) => guard(() => listEditions(input.experienceId))),

  /** Próximas convocatorias de todos los productos (lista/calendario). */
  upcoming: adminProcedure.input(z.object({ limit: z.number().int().min(1).max(500).optional() }).optional()).query(({ input }) => guard(() => listUpcomingEditions(Date.now(), input?.limit))),

  create: adminProcedure.input(z.object({ experienceId: id, form })).mutation(({ input }) => guard(() => createEdition(input.experienceId, input.form))),

  update: adminProcedure.input(z.object({ id, form })).mutation(({ input }) => guard(() => updateEdition(input.id, input.form))),

  /** «Crear nueva edición a partir de esta»: copia como borrador, sin inscripciones. */
  duplicate: adminProcedure
    .input(z.object({ id, label: z.string().max(EDITION_LIMITS.label * 2).optional(), startsLocal: local.optional(), endsLocal: local.nullable().optional() }))
    .mutation(({ input }) => guard(() => duplicateEdition(input.id, { label: input.label, startsLocal: input.startsLocal, endsLocal: input.endsLocal }))),

  cancel: adminProcedure.input(z.object({ id })).mutation(({ input }) => guard(() => cancelEdition(input.id))),

  enrollments: adminProcedure.input(z.object({ editionId: id })).query(({ input }) => guard(() => listEnrollments(input.editionId))),

  /** Confirmar (ocupa plazas con un UPDATE condicionado), poner en lista de espera o cancelar (libera plazas). */
  setEnrollmentStatus: adminProcedure
    .input(z.object({ enrollmentId: id, status: z.enum(ENROLLMENT_STATUSES) }))
    .mutation(({ input }) =>
      guard(async () => {
        const r = await setEnrollmentStatus(input.enrollmentId, input.status);
        // Aviso por correo (opcional, apagado por defecto): solo si cambió de verdad y sin esperar al correo
        if (r.changed && (input.status === "confirmada" || input.status === "cancelada")) void notifyEnrollmentChange(input.enrollmentId, input.status === "confirmada" ? "confirmed" : "cancelled");
        return r;
      })),

  /** Personas ya conocidas (clientes y oportunidades) para inscribirlas desde el panel. */
  searchPeople: adminProcedure.input(z.object({ q: z.string().max(80) })).query(({ input }) => guard(() => searchPeople(input.q))),

  /** Alta manual de una inscripción (no ocupa plaza hasta confirmarla). */
  addEnrollment: adminProcedure
    .input(z.object({
      editionId: id,
      name: z.string().max(EDITION_LIMITS.name * 2),
      email: z.string().max(320),
      phone: z.string().max(EDITION_LIMITS.phone * 2).optional(),
      seats: z.number().int(),
      status: z.enum(["solicitada", "lista_espera"]),
      notes: z.string().max(EDITION_LIMITS.notes * 2).optional(),
      source: z.object({ kind: z.enum(["client", "lead"]), id: id }).nullable().optional(),
    }))
    .mutation(({ input }) => guard(() => addEnrollment(input))),

  /** Aviso por correo al confirmar o cancelar una plaza (apagado por defecto; textos editables). */
  notifySettings: adminProcedure.query(() => guard(() => getNotifySettings())),
  saveNotifySettings: adminProcedure
    .input(z.object({ enabled: z.boolean(), confirmSubject: z.string().max(300), confirmBody: z.string().max(4000), cancelSubject: z.string().max(300), cancelBody: z.string().max(4000) }))
    .mutation(({ input }) => guard(() => saveNotifySettings(input))),

  /** Repara el contador de plazas confirmadas a partir de las inscripciones. */
  recount: adminProcedure.input(z.object({ editionId: id })).mutation(({ input }) => guard(async () => ({ reserved: await recountReserved(input.editionId) }))),
});
