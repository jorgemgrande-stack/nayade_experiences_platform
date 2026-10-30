/**
 * accountSecurity.* — seguridad de la cuenta del usuario en curso: sus dispositivos (ver y olvidar) y el cambio de su
 * correo de acceso con verificación. Un administrador de la empresa también puede solicitar el cambio del correo de
 * otro usuario (con las mismas salvaguardas que el resto de la gestión de usuarios); la confirmación siempre la hace
 * el propio usuario con su sesión y el enlace recibido en el correo nuevo.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { assertUserAdminAllowed } from "../_core/companyOwner";
import { currentFingerprint, listMyDevices, sqlDeviceStore, DevicesUnavailableError } from "../accountSecurity/devices";
import { EmailChangeError, confirmEmailChange, defaultEmailChangeDeps, pendingEmailChange, requestEmailChange, sqlEmailChangeStore, type EmailChangeErrorCode } from "../accountSecurity/emailChange";

const ERR: Record<EmailChangeErrorCode, { code: TRPCError["code"]; message: string }> = {
  unavailable: { code: "PRECONDITION_FAILED", message: "El cambio de correo todavía no está disponible en esta empresa." },
  not_found: { code: "NOT_FOUND", message: "Usuario no encontrado." },
  inactive: { code: "CONFLICT", message: "El usuario está desactivado." },
  same_email: { code: "BAD_REQUEST", message: "Ese ya es el correo de la cuenta." },
  email_taken: { code: "CONFLICT", message: "Ese correo ya lo usa otro usuario de la empresa." },
  bad_password: { code: "FORBIDDEN", message: "La contraseña actual no es correcta." },
  rate_limited: { code: "TOO_MANY_REQUESTS", message: "Demasiadas solicitudes. Inténtalo dentro de una hora." },
  invalid_token: { code: "BAD_REQUEST", message: "El enlace no es válido, ha caducado o pertenece a otra cuenta." },
  owner_account: { code: "FORBIDDEN", message: "El correo de la persona propietaria de la empresa identifica la propiedad: para cambiarlo, contacta con soporte de Big Elephant." },
};

async function mapErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof EmailChangeError) throw new TRPCError(ERR[e.code]);
    throw e;
  }
}

/** Solo usuarios reales de la empresa (nunca la sesión delegada de soporte, id -1). */
function realUserId(user: { id: number }): number {
  if (!Number.isInteger(user.id) || user.id <= 0) throw new TRPCError({ code: "FORBIDDEN", message: "No disponible para esta sesión." });
  return user.id;
}

const email = z.string().trim().toLowerCase().email().max(320);

export const accountSecurityRouter = router({
  myDevices: protectedProcedure.query(async ({ ctx }) => listMyDevices(sqlDeviceStore(), realUserId(ctx.user), currentFingerprint(ctx.req))),

  forgetDevice: protectedProcedure.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    try {
      const ok = await sqlDeviceStore().forget(realUserId(ctx.user), input.id);
      if (!ok) throw new TRPCError({ code: "NOT_FOUND", message: "Dispositivo no encontrado." });
      return { ok: true } as const;
    } catch (e) {
      if (e instanceof DevicesUnavailableError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El registro de dispositivos todavía no está disponible en esta empresa." });
      throw e;
    }
  }),

  pendingEmailChange: protectedProcedure.query(async ({ ctx }) => pendingEmailChange(sqlEmailChangeStore(), realUserId(ctx.user), new Date())),

  requestEmailChange: protectedProcedure
    .input(z.object({ newEmail: email, currentPassword: z.string().min(1).max(256) }))
    .mutation(async ({ ctx, input }) => {
      const id = realUserId(ctx.user);
      return mapErrors(() => requestEmailChange(defaultEmailChangeDeps(), { actorId: id, userId: id, newEmail: input.newEmail, currentPassword: input.currentPassword }));
    }),

  /** Un administrador de la empresa solicita el cambio del correo de otro usuario (el usuario lo confirma). */
  requestEmailChangeForUser: adminProcedure
    .input(z.object({ userId: z.number().int().positive(), newEmail: email }))
    .mutation(async ({ ctx, input }) => {
      const actorId = realUserId(ctx.user);
      if (input.userId === actorId) throw new TRPCError({ code: "BAD_REQUEST", message: "Para tu propia cuenta, usa «Mi cuenta»." });
      await assertUserAdminAllowed(ctx.user, input.userId, "set_password");
      return mapErrors(() => requestEmailChange(defaultEmailChangeDeps(), { actorId, userId: input.userId, newEmail: input.newEmail }));
    }),

  confirmEmailChange: protectedProcedure.input(z.object({ token: z.string().min(16).max(128) })).mutation(async ({ ctx, input }) => {
    const id = realUserId(ctx.user);
    const r = await mapErrors(() => confirmEmailChange(defaultEmailChangeDeps(), { userId: id, token: input.token }));
    // Las sesiones se han cerrado (también esta): hay que volver a entrar con el correo nuevo
    return { email: r.email, signInAgain: true } as const;
  }),
});
