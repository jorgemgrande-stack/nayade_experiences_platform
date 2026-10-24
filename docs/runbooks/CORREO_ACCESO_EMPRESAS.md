# Correo de acceso de las empresas: activación limitada

Estado (24/10/2026): **preparado y apagado en production** (`MAIL_MODE=off`). En live funciona en `sandbox`.

Este procedimiento activa **solo** los correos transaccionales de acceso (invitación, restablecimiento y aviso de
contraseña cambiada) y **solo** para las empresas elegidas. No activa campañas, correos comerciales, avisos de
prueba gratuita ni confirmaciones de pedidos.

## Qué garantiza el código

| Garantía | Dónde |
|---|---|
| El enlace va al dominio de la propia empresa (su subdominio o su dominio verificado), nunca a otro | `getTrustedBaseUrl` → `tenantPublicUrl` |
| Invitación de un solo uso, caduca a las 72 h y al reenviarla se anula la anterior | `resendUserInvite`, `public.setPassword` |
| Restablecimiento de un solo uso (también con peticiones simultáneas), caduca a los 60 min y cierra las sesiones abiertas | `server/passwordReset.ts` |
| Un restablecimiento anula la invitación pendiente | `server/passwordReset.ts` |
| El token solo vale en la base de su empresa (en otra empresa responde 404) | `securityLaunch.mysql.test.ts` |
| Ningún correo lleva contraseñas, y ningún operador ve ni fija la contraseña del usuario | plantillas `inviteEmail.ts` y `passwordReset.ts` |
| Desde Accesos (CRM) el operador tiene que teclear el correo del destinatario para confirmar | `runAccessAction` |
| El destinatario sale de la base, no de la petición; una invitación aceptada no se reabre | `admin.resendInvite`, `runAccessAction` |
| Si no se puede enviar, no se crea ningún enlace y la contraseña y los enlaces vigentes no cambian | `mailGate` |
| Cada acción queda en la auditoría del plano de control con el resultado del envío | Auditoría de la empresa |

## Controles de activación (variables del servicio `core`)

| Variable | Valor para Skibox | Efecto |
|---|---|---|
| `MAIL_MODE` | `live` | Sin esta variable no sale nada |
| `MAIL_LIVE_AUTHORIZED` | `1` | Sin ella, `live` se degrada a `off` |
| `MAIL_SCOPE_TENANTS` | `t5-skibox` | Solo esas empresas envían. Una lista vacía o mal escrita no deja pasar **nada** |
| `MAIL_SCOPE_CATEGORIES` | `user_invite,password_reset,security_notice` | Solo esos tipos. Todo lo demás se cierra como `skipped / scope_not_allowed` |
| `MAIL_PROVIDER` | `postmark` | Fija el proveedor, sin alternativa silenciosa |
| `POSTMARK_SERVER_TOKEN` | secreto | Token del servidor de Postmark de production |
| `MAIL_SENDING_DOMAIN` | `bigelephant.es` | Remitente `no-reply@bigelephant.es`, con el nombre de la empresa |

`controlplane` **se queda en `MAIL_MODE=off`**: ahí viven los avisos de prueba gratuita y comerciales.

Las dos variables de ámbito **solo restringen**: quitarlas abre el envío a todas las empresas y tipos. Para ampliar a
otra empresa se añade su id a `MAIL_SCOPE_TENANTS`. El CRM solo habilita «Reenviar invitación» y «Enviar
restablecimiento» cuando la empresa está en el ámbito (`accessMail` en `GET /cp/v1/tenants/:id/access`).

## Estado comprobado (24/10/2026, ejecución 40132881414, solo lectura)

- La cuenta de Postmark ya no está en Test mode: hay 72 entregas a `gmail.com`.
- El servicio `core` de production **no tiene `POSTMARK_SERVER_TOKEN`**. Es el único bloqueo técnico.
- El plano de control de production está en `sandbox` y solo envía al buzón del propietario. No se toca.

## Pasos para production

1. **[TÚ] Servidor de Postmark propio de production.** En Postmark: Servers → Create Server, con el nombre
   `Elephant Source - production real` y el tipo **Live**.
   - No se reutiliza «Elephant Source - Production»: lo usa live, y su webhook apunta al CRM de live.
   - El dominio `bigelephant.es` ya está verificado en la cuenta.
2. **[TÚ] Token.** En el servidor nuevo, API Tokens → Server API token.
   - Guárdalo en Railway → production → `core` → Variables → `POSTMARK_SERVER_TOKEN` y márcalo como **Sealed**.
   - No se pega en ningún chat.
3. **[Equipo técnico] `correo-acceso-estado`** (production, `only=t5-skibox`; necesita aprobación).
   - Comprueba las variables sin mostrar valores y que el token responde en Postmark. No envía nada.
4. **[TÚ] Autorización expresa** de la activación para `t5-skibox`. Concedida el 24/10/2026.
5. **[Equipo técnico] `correo-acceso-activar`** (production, `only=t5-skibox`; necesita aprobación).
   - Solo cambia `core`: proveedor, dominio, ámbito y, al final, `MAIL_MODE=live`.
   - Redespliega la misma imagen.
   - Se niega sin token válido, sin empresas o con el plano de control en `live`.
6. **[Equipo técnico] Comprobación:** Accesos de Skibox muestra «Correo activo» y los botones habilitados. En otra empresa aparece «no habilitado para esta empresa».
7. **[TÚ, sesión de operador con autenticación multifactor] Envío:** en Accesos de Skibox, pulsar «Reenviar invitación» y escribir el correo del administrador.
   - Solo se admite el correo registrado del administrador.
   - Una invitación aceptada no se reabre.
8. **[Equipo técnico] Seguimiento:** aceptación y entrega en Postmark, auditoría, y el primer acceso en Accesos.

