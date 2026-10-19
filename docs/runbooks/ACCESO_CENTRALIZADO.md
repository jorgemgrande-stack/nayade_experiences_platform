# Acceso centralizado de las empresas (app.bigelephant.es)

Un usuario entra en `https://app.bigelephant.es` con su correo y su contraseña:

- Si pertenece a una sola empresa, se le lleva directamente.
- Si pertenece a varias, elige empresa en un selector.

La alternativa «Entrar con la dirección de mi empresa» sigue disponible.

## Cómo funciona

| Paso | Dónde | Qué ocurre |
|---|---|---|
| 1 | Página estática de `core-gateway` (`deploy/railway/gateway/app-entry`) | `POST /api/central/login`. La pasarela solo deja pasar `/api/central/*` de ese host al Core. |
| 2 | Core, `server/_core/centralAuth.ts`, montado **antes** de resolver la empresa | Comprueba la contraseña (bcrypt) en las empresas cuyo estado admite panel (`accessPolicy(status).admin`). Devuelve **solo** las empresas en las que es correcta, cada una con un **pase** firmado (`JWT_SECRET`, 5 min, un solo uso). El pase va ligado a la empresa (`tid`), al host de destino (`aud`), al usuario y a la huella de su contraseña (`pwv`). |
| 3 | Navegador | Envía el pase por **POST** (formulario, nunca en la URL) a `https://<host de la empresa>/api/auth/handoff`. |
| 4 | Core, en el host de la empresa (`createCentralHandoffRouter`, `server/localAuth.ts`) | Comprueba el origen (la página central), la firma, la empresa, el host, el uso único, que la cuenta siga activa y que la contraseña no haya cambiado. Emite la sesión habitual de la empresa (`__Host-nayade_session`, de ese host) y redirige a su panel. |

**Host de destino:** el dominio público de la empresa (`choosePublicDomain`). Es su dominio propio verificado o, si no tiene, su subdominio de plataforma principal.

**Recuperación:** `POST /api/central/forgot` lanza la recuperación de **cada** empresa en la que existe el correo, con su flujo, su URL y su remitente. La respuesta es siempre la misma.

**Invitaciones:** no cambian. Se aceptan en el host de la empresa y, después, la cuenta funciona también desde el acceso central.

## Seguridad

- **No revela qué correos existen:**
  - la respuesta es genérica;
  - sin candidatos se hace igualmente una comparación bcrypt;
  - una cuenta desactivada no aparece.
- **Límites:**
  - 10 intentos de login y 5 de recuperación por minuto e IP;
  - bloqueo por correo tras 10 fallos en 15 minutos (`loginThrottle`, clave `central:<correo>`).
- **Origen:**
  - `Origin` obligatorio: la página central para `/api/central/*` y para el canje (evita el *login CSRF*);
  - la página envía `Referrer-Policy: strict-origin-when-cross-origin`: con `no-referrer` el navegador mandaría `Origin: null`.
- **Aislamiento entre empresas:**
  - un pase de una empresa no sirve en otra (`tid` y `aud`);
  - la sesión resultante es la de la empresa (`tid`) y su cookie `__Host-` es del propio host.
- **Pase:**
  - caduca a los 5 minutos;
  - un solo uso, en memoria del proceso, válido con **una réplica** del Core; con varias habría que moverlo a almacenamiento compartido;
  - deja de valer si la contraseña cambia.

## Configuración

| Servicio | Variable | Valor en production |
|---|---|---|
| core | `CENTRAL_LOGIN_HOST` | `app.bigelephant.es` (sin ella, inactivo) |
| core-gateway | `APP_ENTRY_HOST` | `app.bigelephant.es` |
| core-gateway | `PUBLIC_HOSTS` | `app.bigelephant.es *.app.bigelephant.es` |

**Escala:** la comprobación recorre las empresas con acceso al panel, 4 en paralelo. Para muchos cientos de empresas convendría un directorio de correos en el registro (huella del correo → empresas).

## Pruebas

`server/securityLaunch.mysql.test.ts`, bloque «acceso centralizado», con la aplicación real en multiempresa y MySQL:

- respuesta genérica y origen;
- una empresa → pase → sesión `__Host-` → `/api/auth/me`;
- uso único;
- pase rechazado en otra empresa, desde otro origen o tras cambiar la contraseña;
- selector con dos empresas y cuenta desactivada;
- recuperación con respuesta genérica.
