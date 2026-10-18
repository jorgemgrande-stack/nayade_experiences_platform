# Autenticación de operadores del plano de control

Acceso de **personas** a Big Elephant CRM con usuario (o correo) y contraseña. Es independiente de los **tokens de servicio** (`CP_TOKENS`), que siguen igual para integraciones máquina a máquina, y del SSO corporativo opcional.

## Diseño

| Aspecto | Implementación |
| --- | --- |
| Contraseñas | Argon2id (`@node-rs/argon2`; 19 MiB, 2 iteraciones, 1 hilo). Mínimo 12 caracteres, sin el usuario, sin contraseñas comunes. Nunca se guardan ni se registran en claro. |
| Sesiones | Token aleatorio de 256 bits en cookie `be_cp_session` (`HttpOnly`, `SameSite=Strict`, `Path=/cp/v1`, `Secure` en HTTPS). En la BD solo su SHA-256 (`cp_operator_sessions`). |
| Caducidad | Inactividad (por defecto 2 h) y duración máxima (12 h). Se revocan al cerrar sesión, al desactivar al operador, al cambiar o restablecer la contraseña y a petición de un administrador. |
| CSRF | Token aleatorio por sesión; toda escritura con cookie exige la cabecera `X-CSRF-Token` y, si hay `Origin`, que esté en `CP_ALLOWED_ORIGINS`. El login también rechaza orígenes no autorizados. |
| CORS | `Access-Control-Allow-Credentials` solo para los orígenes de `CP_ALLOWED_ORIGINS` (nunca comodín). |
| Fuerza bruta | Bloqueo de 15 min tras 5 fallos seguidos (persistente en BD; también para usuarios inexistentes, en memoria, para no revelar qué cuentas existen). Además, 20 intentos fallidos por IP cada 15 min en login y recuperación. Mismo mensaje para usuario inexistente y contraseña errónea; «cuenta desactivada» solo se dice a quien conoce la contraseña. |
| Permisos | Roles → ámbitos existentes, calculados en cada petición a partir del rol actual (un cambio de rol surte efecto de inmediato). Nuevos ámbitos `operators:read` y `operators:write`. |
| Escalada | Solo se gestiona a roles inferiores (el administrador no toca a administradores ni superadministradores); nadie cambia su propio rol ni se desactiva; siempre queda un superadministrador activo (comprobación en la misma transacción, con bloqueo de filas). La gestión de operadores exige sesión de operador: un token de servicio no puede usarla aunque tenga los ámbitos. |
| Auditoría | `cp_operator_events`: inicios de sesión correctos y fallidos, bloqueos, cierres, altas, cambios de datos, rol y estado, contraseñas y revocaciones, con IP y agente de usuario. Sin contraseñas ni tokens. |

### Roles

| Rol | Ámbitos |
| --- | --- |
| Superadministrador (`superadmin`) | Todos, incluida la gestión de cualquier operador |
| Administrador (`admin`) | Todos; gestiona Comercial, Soporte y Solo lectura |
| Comercial (`sales`) | `crm:read/write`, `tenants:read`, `billing:read`, `usage:read`, `tickets:read` |
| Soporte (`support`) | `tickets:read/write`, `support:write`, `tenants:read`, `usage:read`, `ops:read`, `crm:read` |
| Solo lectura (`readonly`) | `tenants:read`, `billing:read`, `usage:read`, `crm:read`, `ops:read`, `tickets:read` |

## API (`/cp/v1`)

Sin sesión: `GET /auth/options`, `POST /auth/login`, `POST /auth/password-reset/request`, `POST /auth/password-reset/confirm`.
Con sesión de operador: `GET /auth/session` (devuelve el token CSRF), `POST /auth/logout`, `POST /auth/password`, `GET|POST /operators`, `PATCH /operators/:id`, `POST /operators/:id/password`, `GET /operators/:id/sessions`, `POST /operators/:id/sessions/revoke`, `GET /operators/:id/events`.
`/auth/me` y el resto de la API no cambian; los tokens de servicio siguen con `Authorization: Bearer`.

## Configuración

| Variable | Uso |
| --- | --- |
| `CP_ALLOWED_ORIGINS` | Orígenes del CRM (obligatorio para usarlo desde el navegador) |
| `CP_SESSION_IDLE_MINUTES` / `CP_SESSION_MAX_HOURS` | Caducidad (por defecto 120 min / 12 h) |
| `CP_COOKIE_SECURE` | `auto` (por defecto: `Secure` si la petición llega por HTTPS), `true` o `false` |
| `CP_TRUST_PROXY` | Proxies de confianza delante del servicio (IP real y HTTPS detrás de Railway u otro proxy) |
| `CP_RESET_SMTP_URL`, `CP_RESET_FROM`, `CP_RESET_URL` | Recuperación por correo. Sin las tres, no se ofrece y **no se simula** ningún envío |
| `CP_OPERATOR_AUTH=off` | Desactiva el acceso con contraseña |

El CRM y el plano de control deben estar en el **mismo sitio** (mismo dominio registrable, p. ej. `crm.ejemplo.es` y `control.ejemplo.es`) para que la cookie `SameSite=Strict` viaje, y en producción siempre con HTTPS. En el CRM, la dirección del servidor se fija con `VITE_CP_URL`.

## Puesta en marcha (entorno de pruebas o local)

1. **Migración** (explícita, nunca en el arranque; copia de seguridad antes):
   ```bash
   REGISTRY_ADMIN_DATABASE_URL=mysql://… pnpm exec tsx scripts/registry-migrate.ts            # plan
   REGISTRY_ADMIN_DATABASE_URL=mysql://… pnpm exec tsx scripts/registry-migrate.ts --execute  # aplicar
   ```
   Sin la migración, el servicio arranca igual y lo indica en el log (`OperatorAuth enabled:false`); los tokens siguen funcionando.
2. **Primer superadministrador** (solo funciona si aún no hay operadores):
   ```bash
   REGISTRY_ADMIN_DATABASE_URL=mysql://… pnpm exec tsx scripts/cp-operators.ts bootstrap \
     --username administrador --name "Administrador" --password-file <ruta fuera del repositorio>
   ```
   La contraseña se genera al azar (~128 bits), se escribe solo en ese archivo (que no puede existir ni estar dentro del repositorio) y no aparece en pantalla ni en logs. Tras guardarla en un gestor de contraseñas, borra el archivo o cámbiala desde el CRM.
3. El resto de operadores se dan de alta desde el CRM (**Administración → Operadores**).

## Restablecer una contraseña

- Con correo configurado: «¿Has olvidado tu contraseña?» envía un enlace de un solo uso válido 30 min; al usarlo se cierran todas las sesiones.
- Un administrador puede fijar una contraseña nueva a un operador de rol inferior (cierra sus sesiones).
- En el servidor, con acceso a la BD del registro (último recurso, también para el superadministrador):
  ```bash
  REGISTRY_ADMIN_DATABASE_URL=mysql://… pnpm exec tsx scripts/cp-operators.ts reset-password \
    --username administrador --password-file <ruta fuera del repositorio>
  ```

No hay preguntas de seguridad ni forma de consultar una contraseña existente.

## Verificación en dos pasos (MFA)

TOTP estándar (RFC 6238: 6 cifras, 30 s), compatible con Google Authenticator, Microsoft Authenticator, 1Password y similares. Requiere la migración `db/registry/0012_operator_mfa.sql` y el llavero del registro (`REGISTRY_KEYS`). **Sin la 0012 el acceso funciona exactamente como antes** y el arranque lo indica: `{"ctx":"OperatorAuth",…,"mfa":{"available":false,"reason":…}}`.

- **Secreto:** cifrado con AES-256-GCM con el llavero del registro y con el operador como dato autenticado. Nunca se guarda en claro.
- **Códigos de recuperación:** 10 de un solo uso. Solo se guarda su SHA-256 y se muestran una sola vez.
- **Login en dos pasos:** con MFA activo, la contraseña abre una sesión **pendiente**. No da acceso, ni token CSRF, ni datos del operador, y caduca a los 5 minutos. `POST /auth/mfa/verify {code}` la cambia por una sesión nueva: el token emitido tras la contraseña deja de valer.
- **Códigos:** un código TOTP no se acepta dos veces (último paso aceptado). Se admite un desfase de ±30 s. Los códigos erróneos cuentan para el **bloqueo de la cuenta** igual que una contraseña errónea.
- **Obligatorio por rol:** `CP_OPERATOR_MFA_ROLES=superadmin,admin`. Sin MFA activo, esos operadores reciben una sesión **sin permisos** que solo sirve para darlo de alta; el CRM muestra la pantalla de alta. Se evalúa en cada petición, también si se exige después de iniciar sesión.
- **Apagado:** `CP_OPERATOR_MFA=off` desactiva el MFA, pero **falla cerrado**. Los operadores con MFA activo y los de un rol de `CP_OPERATOR_MFA_ROLES` no entran solo con la contraseña (`503 mfa_unavailable`) y el arranque registra `mfa_required_but_unavailable`. Los demás entran como siempre.
- **Rotación del llavero (`REGISTRY_KEYS`):** el secreto TOTP usa la misma clave activa que las DSN de las empresas, y `rotate-keys` re-cifra ambos.
  1. Añadir la clave nueva y hacerla activa (`REGISTRY_ACTIVE_KEY_ID`) **conservando la antigua** en `REGISTRY_KEYS`. Reiniciar `controlplane`.
  2. `pnpm exec tsx scripts/tenants/cli.ts rotate-keys` (simulación): indica los secretos pendientes y los irrecuperables, y sale con código 1 si hay alguno irrecuperable.
  3. Repetir con `--apply`. Cada secreto rotado queda auditado como `mfa_key_rotated`.
  4. Repetir la simulación: solo con `pendientes: 0` y sin irrecuperables se puede retirar la clave antigua.

  Si se retira antes, esos operadores no completan el segundo paso y el arranque registra `mfa_key_missing` con las claves que faltan. Para corregirlo, se vuelve a añadir la clave y se ejecuta `rotate-keys`.
- **API (sesión de operador):**
  - `GET /auth/mfa`: estado;
  - `POST /auth/mfa/setup`: clave y `otpauth://`, alta sin confirmar;
  - `POST /auth/mfa/enable {code}`: activa, devuelve los códigos de recuperación y cierra el resto de sesiones;
  - `POST /auth/mfa/disable {code}`: baja propia con un código.

  Escrituras con CSRF.
- **Pérdida del móvil:**
  - un administrador lo restablece desde el CRM (`POST /operators/:id/mfa/reset`, `operators:write`, mismas reglas de rol que la gestión de operadores); se cierran las sesiones del operador;
  - si es el único superadministrador, desde el servidor:
    ```bash
    REGISTRY_ADMIN_DATABASE_URL=mysql://… pnpm exec tsx scripts/cp-operators.ts reset-mfa --username administrador
    ```
- **Auditoría:** `login_mfa_required`, `login_success` (con `mfa: totp|recovery`), `login_failed`/`account_locked` (`reason: bad_mfa_code`), `mfa_setup_started`, `mfa_enabled`, `mfa_disabled`, `mfa_reset_by_admin`, `mfa_reset_by_server`, `mfa_key_rotated`.
- **Puesta en marcha:**
  1. Aplicar la 0012 con el ejecutor del registro (simulación primero).
  2. Desplegar `controlplane` y el CRM.
  3. Cada operador privilegiado da de alta su MFA.
  4. Fijar `CP_OPERATOR_MFA_ROLES=superadmin,admin`.

  Solo después se puede valorar retirar la autenticación básica de la pasarela en `admin.bigelephant.es`.

## Riesgos y pendientes

- **Producción:** no está desplegado ni activado. Requiere revisión de seguridad, migración 0007 en el registro de producción, HTTPS con el CRM y el plano de control en el mismo sitio, `CP_TRUST_PROXY` correcto y alta del primer superadministrador.
- **Límites en memoria:** el límite por IP y el bloqueo de usuarios inexistentes se guardan en memoria del proceso (se reinician al reiniciar; con varias réplicas, cada una lleva el suyo). El bloqueo de cuentas existentes sí es persistente.
- **Segundo factor (MFA):** disponible con la migración 0012 (ver la sección anterior). Obligatorio solo para los roles de `CP_OPERATOR_MFA_ROLES`. Sigue sin haber caducidad obligatoria de contraseñas.
- **Correo de recuperación:** no hay proveedor configurado; mientras tanto, la recuperación es por un administrador o por la herramienta del servidor.
