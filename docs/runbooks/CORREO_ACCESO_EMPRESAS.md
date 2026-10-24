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

## Pasos para production

1. **[TÚ] Postmark fuera de Test mode.** Solicitar la aprobación de la cuenta (Account → Request approval). Mientras
   siga en Test mode, Postmark solo entrega a direcciones de `bigelephant.es`.
2. **[TÚ] Token de production.** Crear en Postmark el servidor de production (stream transaccional) y guardar su
   token en Railway → production → `core` → `POSTMARK_SERVER_TOKEN`, como variable sellada. No se pega en ningún chat.
3. **[Equipo técnico] Comprobaciones previas, solo lectura:**
   - el dominio público de Skibox resuelve y sirve su acceso;
   - DKIM y Return-Path de `bigelephant.es` siguen verificados en Postmark;
   - el webhook de production apunta al plano de control de production.
4. **[TÚ] Autorización expresa** de la activación limitada para `t5-skibox`.
5. **[Equipo técnico] Variables** de la tabla anterior en `core`, por el procedimiento protegido (`MAIL_MODE` y
   `MAIL_LIVE_AUTHORIZED` son interruptores bloqueados). Al cambiarlas, Railway vuelve a desplegar `core`.
6. **[Equipo técnico] Verificación sin enviar nada:** Accesos de Skibox muestra «Correo activo» y los botones
   habilitados. La pestaña de otra empresa muestra «no habilitado para esta empresa».
7. **[TÚ] Envío:** en Accesos de Skibox, «Reenviar invitación» y escribir el correo del administrador para confirmar.
   El administrador recibe un enlace de 72 h a su propio dominio y define su contraseña.
8. **[Equipo técnico]** Auditoría, estado del envío (entregado o rebotado) y primer acceso registrado en Accesos.

## Marcha atrás

`MAIL_MODE=off` en `core`. No se borra nada, y los enlaces ya enviados siguen caducando solos. Si un enlace se
hubiera enviado por error, «Reenviar invitación» o «Enviar restablecimiento» lo sustituye, y «Cerrar sesiones»
cierra cualquier acceso abierto.

## Prueba en live (24/10/2026, `sandbox`)

Se dio de alta la empresa de prueba `alta-correo-20261024c`, cuyo administrador es el buzón de pruebas autorizado. La prueba no tocó Skibox ni production.

| Paso | Resultado |
|---|---|
| Accesos: modo y ámbito | `sandbox` · `accessMail {invite: true, reset: true}` · invitación pendiente, sin contraseña |
| Reenviar invitación con un correo de confirmación distinto | 409 `confirm_mismatch`, sin enlace |
| Reenviar invitación | 200 · `sent` · nueva caducidad a 72 h |
| Enlace de la invitación anterior tras reenviar | 404: anulado |
| Enviar restablecimiento | 200 · `sent` |
| Auditoría | Cada acción registrada con operador, motivo y resultado del envío |

Lo comprobado con MySQL real en la CI: un solo uso (también en paralelo), caducidad, token inválido en otra empresa, el restablecimiento anula la invitación y el reenvío va al correo de la base.
