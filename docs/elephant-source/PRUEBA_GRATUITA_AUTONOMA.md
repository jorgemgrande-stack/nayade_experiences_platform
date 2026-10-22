# Prueba gratuita autónoma (15 días, sin tarjeta)

Estado: **preparado y probado en local/CI; NO desplegado ni activado.** Nada de esto cambia el
comportamiento de producción mientras no se den los pasos de la sección «Activación». El correo sigue
apagado (`MAIL_MODE=off`), el registro público sigue apagado (`CP_PUBLIC_TRIAL_ENABLED` sin definir) y la
tarea programada está apagada por defecto. Desde el 18/10/2026 **está conectada** en `server/controlPlane/main.ts`
(solo arranca con `CP_TRIALS_SCHEDULER_ENABLED=1`).

Código: `server/trials/*` (servicio, máquina de estados, almacén, rutas, tarea programada),
`server/mail/platform.ts` y `server/mail/templates.ts` (bandeja de salida de plataforma).
Sin migraciones nuevas: se reutilizan `db/crm/migrations/0007_trials.sql` (la columna `action` de
`trial_events` es texto libre) y `0011_platform_mail_outbox.sql`.

## Qué cambió

### 1. Reenvío seguro del enlace de verificación

- **Ruta pública** `POST /cp/v1/public/trial/resend` `{ "email": "...", "website"?: "" }`. Solo existe
  cuando ya existe la ruta pública de la prueba (`CP_PUBLIC_TRIAL_ENABLED=1`; si no, 404).
  - Responde **siempre** `202` con el mismo cuerpo, exista o no el correo, esté o no verificado, haya o no
    límite alcanzado. Responde sin esperar al trabajo (el tiempo de respuesta tampoco delata nada).
  - Campo trampa `website` como en el alta. Límite propio de **5 peticiones/h por IP** (además del
    general de 20/h de la ruta pública).
- **Ruta de operador** `POST /cp/v1/trials/:id/resend-verification` (permiso `subscriptions:write`).
  Devuelve el resultado (`resent`, `cooldown`, `limit`, `not_pending`, `expired`, `not_found`), nunca el
  token: el enlace solo viaja por correo.
- **Rotación**: cada reenvío genera un token nuevo de 256 bits (solo se guarda su hash) con validez
  completa (24 h); el anterior deja de valer en el acto. Queda auditado (`resend_verification`).
- **Idempotencia por correo**: dentro de la espera mínima (2 min desde el último enlace emitido, alta o
  reenvío) no se emite nada; dos clics o dos peticiones simultáneas producen un solo enlace (la segunda
  pierde por versión optimista y se trata como clic repetido). Máximo **3 reenvíos por solicitud en 24 h**.
  En la bandeja de salida la clave es `trial:<id>:verification:<huella del token>`: un mensaje por enlace.

### 2. Solicitudes sin verificar: decisión de seguridad

Problema: una solicitud `pending_verification` con el enlace caducado bloqueaba el correo para siempre
(índice único `open_email`) y el alta pública respondía 202 sin crear nada.

Decisión (la más segura sin perder usabilidad):

1. **Renovar, con techo**: mientras la solicitud tenga menos de **7 días** (`pendingMaxAgeMs`), el
   reenvío renueva el enlace aunque ya hubiera caducado. Solo lo recibe quien controla el buzón.
2. **Caducar sola y liberar el correo**: una solicitud sin verificar con el enlace caducado **no bloquea**
   el correo:
   - si la persona vuelve a registrarse, la solicitud vieja se anula en el acto (`expire_verification` →
     `cancelled`, actor `system:trial`) y se crea una nueva con su propio enlace;
   - pasada la vida máxima (7 días), el reenvío ya no renueva: la anula; y la tarea programada anula las
     que superan ese plazo con el enlace caducado.
3. Nunca se borra la fila: queda `cancelled` con su historial (auditoría y límites por dominio/IP siguen
   contando esas altas).

Por qué es seguro: una solicitud sin verificar no ha creado nada (ni plataforma, ni empresa, ni
licencias), así que anularla no pierde datos; y un tercero que registre el correo de otro solo provoca un
correo al dueño del buzón, que es quien puede verificar. Los límites por IP y dominio se mantienen.

### 3. Protección contra abusos (huecos revisados)

| Hueco | Antes | Ahora |
|---|---|---|
| Mayúsculas / espacios | ya se normalizaba (`trim` + minúsculas) | igual, con test |
| Alias `+etiqueta` (`ana+1@`, `ana+2@`) | una prueba abierta por cada alias | **una prueba abierta por buzón**: se busca `base@dominio` o `base+…@dominio` en el índice de correo abierto (prefijo constante, comodines de `LIKE` escapados) |
| Correo desechable | sin control | lista **corta** de dominios desechables muy conocidos (`DISPOSABLE_DOMAINS` en `service.ts`), activa siempre; ampliable con la opción `blockedDomains` del servicio (`blockedDomainsFromEnv` lee `CP_TRIAL_BLOCKED_DOMAINS`, **aún no conectada**: ver pendientes) |
| Reenvíos masivos | no existía el reenvío | espera mínima, máximo diario por solicitud y límite por IP |
| Puntos de Gmail (`a.na@gmail.com`) | — | **pendiente** (ver abajo); acotado por el límite por IP |

### 4. Tarea programada de vencimiento y avisos (`server/trials/scheduler.ts`)

`TrialScheduler.tick(now)` — idempotente, en este orden:

1. Pruebas `active` con el plazo vencido → `expired` (actor `system:trial-scheduler`) y aviso de
   vencimiento (0 días). **No toca licencias ni borra nada**: las licencias ya caducaron solas al final
   de la prueba (`validUntil`), y el Core las trata como solo lectura.
2. Avisos de **3 y 1 días** antes del fin, una sola vez por prueba **y fecha de fin** (una ampliación
   vuelve a avisar). Si la tarea estuvo parada, manda solo el aviso más cercano. La constancia queda en
   el historial (`trial_events.action = 'notice_queued'`, sin cambiar estado ni versión). El envío manual
   `POST /trials/notices/send` deja la misma constancia, así que la tarea no lo repite.
3. Solicitudes `pending_verification` con el enlace caducado y más de 7 días → `cancelled`.

- Nunca suspende, nunca cancela pruebas activas, nunca borra.
- Un fallo de envío no deja constancia: se reintenta en el siguiente tick.
- Un cambio simultáneo de un operador (ampliación, suspensión) gana: la tarea lo deja para el siguiente tick.
- **Exclusión entre réplicas**: `GET_LOCK('elephant_trials_scheduler', 0)` de MySQL en una conexión propia
  (`mysqlAdvisoryLock`). Si otra réplica lo tiene, el tick no hace nada (`skipped: "locked"`). Se libera
  al terminar o si se corta la conexión. En el mismo proceso nunca se solapan dos ticks.
- **Apagada por defecto**. `startTrialScheduler` no hace nada al arrancar: el primer tick llega al cabo de
  1 minuto (o del intervalo, si es menor) y los temporizadores no retienen el proceso (`unref`).

### 5. Conversión de prueba a pago (comprobado, sin cambios de lógica)

Probado por HTTP (`server/controlPlane.trialsAutonomia.test.ts`) con una prueba **vencida por la tarea**:

- Pedido `trial_conversion` del orquestador → aceptación → pago de PRUEBA verificado por webhook firmado:
  misma plataforma (tenant), misma empresa del CRM, **misma suscripción** (pasa de `trialing` a `active`),
  ningún tenant nuevo en el registro, licencias de solo lectura (caducadas) a activas sin caducidad,
  escritura recuperada y prueba `converted` enlazada a esa suscripción. Sin pago verificado no cambia nada.
- Conversión por operador (`POST /trials/:id/convert`) de una prueba vencida: mismos tenant, empresa y
  suscripción; escritura recuperada.
- No se convierte dos veces: ni repetir la conversión del operador ni abrir otro pedido sobre una prueba
  convertida (ambos `409`).

### 6. Acceso tras vencer (comprobado)

Una empresa vencida queda en **solo lectura**: consultar sí, operar no (el motor de licencias responde
`expired`); las licencias, la plataforma y la suscripción siguen ahí (nada se borra ni se suspende) y puede
seguir contratando (punto 5). El recorrido con MySQL real (`server/trialJourney.mysql.test.ts`) lo confirma
también sobre la base de la empresa.

### 7. Plantillas de correo (español, marca Elephant Source, sin enlaces a Náyade)

En `platformTemplates` (`server/mail/templates.ts`), por la bandeja de salida de plataforma:

| Aviso | Plantilla | Categoría | Clave de idempotencia |
|---|---|---|---|
| Verificación | `emailVerification` | `email_verification` | `trial:<id>:verification:<huella token>` |
| Reenvío | `emailVerificationResent` (nuevo) | `email_verification` | ídem (token nuevo ⇒ mensaje nuevo) |
| Aviso 3 / 1 días | `trialExpiry` | `trial_expiry` | `trial:<id>:expiry:<fin>:<días>` |
| Vencimiento (0 días) | `trialExpired` (nuevo; `trialExpiry` con 0 días lo usa) | `trial_expiry` | `trial:<id>:expiry:<fin>:0` |

Cambio de clave: el aviso de vencimiento incluye ahora la fecha de fin (antes `trial:<id>:expiry:<días>`),
para poder avisar otra vez tras una ampliación. Con `MAIL_MODE=off` las filas quedan `skipped` y no sale
nada (probado).

## Variables nuevas

| Variable | Por defecto | Efecto |
|---|---|---|
| `CP_TRIALS_SCHEDULER_ENABLED` | sin definir (apagado) | `1` exacto activa la tarea programada (si está montada en `main.ts`) |
| `CP_TRIALS_SCHEDULER_INTERVAL_MS` | `900000` (15 min) | Intervalo entre ticks; se acota a 1 min – 24 h |
| `CP_TRIAL_BLOCKED_DOMAINS` | vacío | Dominios de correo adicionales rechazados en el alta (separados por comas). **Conectada** el 18/10/2026 (`main.ts` → `api.ts`) |

Existentes que intervienen: `CP_PUBLIC_TRIAL_ENABLED` (monta también `/resend`), `CP_TRIAL_VERIFY_URL`,
`CP_TRIAL_PRICING_URL`, `MAIL_MODE` y compañía.

## Cómo se monta la tarea programada (conectada el 18/10/2026)

`server/controlPlane/main.ts` lo está editando otra persona; para no generar conflictos no se ha tocado.
Montaje sugerido, justo después del bloque `// Prueba gratuita de Essential` (donde se crea `trials`):

```ts
import { TrialScheduler, mysqlAdvisoryLock, startTrialScheduler } from "../trials/scheduler";

// Tarea programada de la prueba (apagada salvo CP_TRIALS_SCHEDULER_ENABLED=1)
let trialScheduler: ReturnType<typeof startTrialScheduler> | undefined;
if (trials && crmPool) {
  trialScheduler = startTrialScheduler({
    scheduler: new TrialScheduler({
      store: trials.store,
      // Mismo notificador que las rutas: con la bandeja de plataforma, por ella (MAIL_MODE decide si sale algo)
      notify: trials.notify ?? { verification: async () => undefined, welcome: async () => undefined, expiryNotice: async () => undefined },
      lock: mysqlAdvisoryLock(crmPool),
    }),
    env: process.env,
  });
}
// En el apagado ordenado (si existe): trialScheduler?.stop();
```

Notas: el `crmPool` es el mismo pool del CRM (las tablas de la prueba viven ahí); `GET_LOCK` ocupa una
conexión del pool solo durante el tick. Sin `CP_TRIALS_SCHEDULER_ENABLED=1` la función solo escribe una
línea de log (`{"ctx":"Trials","event":"scheduler","enabled":false,...}`) y no programa nada.

## Cómo configurar `CP_TRIAL_VERIFY_URL` (NO configurado)

Sin esta variable el enlace de verificación (y el reenvío) **no se encola** (`not_queued`,
`reason: verify_url_missing`). Valor sugerido, apuntando a la web comercial:

```
CP_TRIAL_VERIFY_URL=https://elephant-source-web.up.railway.app/prueba-gratuita/verificar
```

El Core añade `?id=<id>&token=<token>` (o `&…` si la URL ya lleva parámetros). Esa página de la web debe
leer ambos y llamar a `POST /cp/v1/public/trial/verify` `{ id, token }`; para pedir un enlace nuevo debe
ofrecer un formulario que llame a `POST /cp/v1/public/trial/resend` `{ email }` y mostrar siempre el mismo
mensaje. Solo admite `https://`. Configurarla en Railway (servicio del plano de control) es un paso manual
que no se ha hecho; no activa ningún envío por sí sola (`MAIL_MODE` sigue mandando).

## Activación (pasos manuales, ninguno hecho)

1. Montar la tarea en `main.ts` (bloque de arriba) en una rama propia y desplegar con
   `CP_TRIALS_SCHEDULER_ENABLED` sin definir; verificar el log de arranque.
2. Activar `CP_TRIALS_SCHEDULER_ENABLED=1` y comprobar en logs `scheduler_tick` (solo aparece si hizo algo).
3. Configurar `CP_TRIAL_VERIFY_URL` y, cuando se autorice, el correo (`MAIL_MODE`) y la ruta pública.

## Pruebas

- `server/trials.autonomia.test.ts` (unitario, 21 casos): rotación del token, espera mínima, máximo diario,
  concurrencia, renovación con techo y anulación, correo liberado, alias +etiqueta, mayúsculas, desechables,
  tarea programada (3/1/0 una vez, ampliación, envío manual previo, réplicas, bloqueo ocupado, reintento
  tras fallo, nada fuera de su sitio), configuración apagada por defecto y temporizadores, plantillas en
  español sin Náyade y con `MAIL_MODE=off` nada sale; sin `CP_TRIAL_VERIFY_URL` no se encola.
- `server/controlPlane.trialsAutonomia.test.ts` (HTTP, 7 casos): reenvío público genérico, rotación,
  operador, campo trampa y 429; vencimiento por la tarea en solo lectura; conversión por pedido con pago de
  prueba y por operador sin duplicar tenant/empresa/suscripción; sin doble conversión.
- `server/trials.autonomia.mysql.test.ts` (MySQL real, 6 casos): alias con `LIKE` escapado, correo liberado
  con el índice único, reenvío concurrente (un solo token), anotación sin cambio de versión, `GET_LOCK`
  entre dos pools y tick simultáneo en dos réplicas (un vencimiento, un aviso).
- Siguen pasando: `server/trials.test.ts`, `server/controlPlane.trials.test.ts`,
  `server/controlPlane.orchestrator.test.ts`, `server/mail/*`, `server/trials.mysql.test.ts`,
  `server/orchestrator.mysql.test.ts`, `server/trialJourney.mysql.test.ts`.

Local: `REGISTRY_TEST_DATABASE_URL=mysql://root:<clave>@127.0.0.1:<puerto>/mysql pnpm exec vitest run server/trials.autonomia.mysql.test.ts`.

## Pendientes y riesgos conocidos

- La tarea ya está conectada (18/10/2026), pero **apagada** hasta `CP_TRIALS_SCHEDULER_ENABLED=1`; mientras, el
  vencimiento y los avisos siguen siendo manuales. Sin notificador, el aviso de vencimiento solo queda en el log.
- Resuelto con la migración 0023 del CRM: los **puntos de Gmail** (`a.na@gmail.com` = `ana@gmail.com`, también
  `googlemail.com`) y las altas **simultáneas** con alias del mismo buzón. La BD impone una sola prueba abierta por
  buzón canónico (`open_mailbox`). Hasta aplicar la migración, la búsqueda cae en la de alias +etiqueta de siempre.
- El aviso de 0 días solo lo manda la tarea al vencer ella la prueba; si un operador la vence a mano
  (`/trials/:id/expire`) no se envía ese aviso.
- La constancia de aviso se registra aunque la bandeja lo deje `skipped` (`MAIL_MODE=off`): al encender el
  correo no se reenvían los avisos ya «encolados».
- La web comercial necesita la página de verificación y el formulario de reenvío (fuera de este repo).
- Conversión por operador mientras hay un pedido `trial_conversion` abierto: el operador gana y el pedido
  queda parado con error («ya no está en prueba»); no duplica nada, pero hay que cancelarlo a mano.
- `POST /subscriptions/:id/renewals` (operador) sobre una suscripción en prueba con el plazo pasado la pasa
  a `active` sin pago; después el pedido `trial_conversion` no podría convertirla. Es una acción manual de
  operador fuera de este módulo; no se ha cambiado.
- El reenvío público responde antes de terminar el trabajo: si falla, solo queda en el log
  (`resend_failed`), no en la respuesta (a propósito).
