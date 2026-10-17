# Seguridad de lanzamiento (Fase P0): multiempresa, autenticación y roles

Rama `fix/seguridad-multiempresa`. Ámbito: servidor del Core (Essential). Sin cambios de cliente,
de dependencias ni de infraestructura. Este documento no contiene secretos. Los puntos pendientes
se describen de forma resumida a propósito (el repositorio es público).

## 1. Qué se ha probado

### Aislamiento entre empresas (MySQL real, aplicación real)

`server/securityLaunch.mysql.test.ts` (23 pruebas) amplía `tenantLegacyAccess.mysql.test.ts`
(CRM, descuentos, proveedores, numeración, hotel, caja, TPV) sin repetirlo. Monta dos empresas
sintéticas con la baseline y el carril de migraciones de la app, y prueba lo siguiente con el
middleware real de tenant, la autenticación local y los routers Express/tRPC reales.

| Área | Prueba |
|---|---|
| Presupuestos, reservas, facturas, clientes CRM | Los mismos ids y números (`FAC-2026-0001`) existen en las dos empresas, y cada una ve solo los suyos |
| IDOR | Un id que solo existe en B, pedido con la sesión de A, da 404 y no devuelve nada de B. Con la sesión de A en el host de B da 401 |
| Cookie de A en el host de B | Da 401 en `crm.*`, `admin.getUsers`, `config.listSystemSettings`, `products.getAll`, `modules.active`, `/api/auth/me`, la exportación de liquidaciones y la vista HTML de factura. Las mutaciones se rechazan sin efecto |
| Enlace firmado de factura | El enlace de A abre la factura de A, pero no la factura homónima de B (**corregido**) |
| Productos, usuarios, configuración | Cada panel ve solo su empresa. Ningún listado de usuarios expone el hash de la contraseña ni el token de invitación |
| Licencias | El módulo licenciado en A no se habilita en B (403) |
| Ficheros | `/local-storage` no sirve en el host de B los ficheros de A, tampoco con rutas codificadas |
| Concurrencia | 40 peticiones intercaladas A/B a dos routers no se mezclan nunca |
| Tokens globales de entorno | El token de recuperación de Redsys y el del formulario público de gastos no abren nada en multiempresa (**corregido**) |
| Webhooks | Sin secreto configurado, los webhooks de leads de GHL y de VAPI rechazan y el inbox de GHL ignora la petición. Ninguno escribe nada |

El plano de control (licencias y sedes) ya tenía cobertura propia en `controlPlane.security.test.ts`
y `controlPlane.licensing.test.ts`: autenticación de operador con ámbitos y sin sesión de empresa.
La aplicación de una empresa no recibe un `tenantId` del cliente en ningún procedimiento (revisado).

### Cachés, búsquedas, jobs y webhooks (revisión de código)

- **Cachés:** todas las de datos o ajustes van por empresa (`TenantCache` o mapas con clave
  `tenantId`). Las variables globales que quedan son inocuas: HTML estático, cliente S3,
  navegador de PDF e indicadores `isRunning`.
- **Jobs:** los 10 `SCHEDULED_JOBS` pasan por `runForEachTenant`/`withTenantDb`. Las ejecuciones
  de arranque fuera de contexto fallan cerradas, sin acceso a datos.
- **Webhooks:** la empresa sale siempre del `Host`. Ninguno elige la base de datos a partir del
  cuerpo o de la query. Redsys valida la firma con la clave de cada empresa.

### Autenticación

| Control | Estado | Prueba |
|---|---|---|
| Cookie `HttpOnly`, `SameSite=Lax`, `Path=/`; `Secure` en producción | OK | MySQL |
| Logout borra la cookie | OK | MySQL |
| Cookie de una empresa en otra | Rechazada (claim `tid`) | MySQL + `tenantIsolation.test.ts` |
| CSRF en mutaciones con cookie (también entre subdominios de empresas) | **Corregido** | MySQL + unitaria |
| Login enviado desde otro origen | **Corregido** (403) | MySQL |
| Antifuerza bruta por cuenta (además del límite por IP) | **Corregido** | MySQL + unitaria |
| Enumeración de cuentas en el login (respuesta y tiempo) | **Corregido** | MySQL |
| Recuperación: un solo uso, también con dos peticiones simultáneas, y caducidad | **Corregido** (consumo atómico) | MySQL |
| Recuperación: límite de intentos al canjear o validar el enlace | **Corregido** | — |
| Revocación de sesiones al cambiar la contraseña (recuperación, invitación, administrador) | **Corregido** (huella `pwv` en la sesión) | MySQL |
| Revocación al desactivar un usuario | OK | MySQL |
| Invitaciones: un solo uso (también en paralelo), caducidad obligatoria, válidas solo en su empresa | **Corregido** | MySQL |
| Redirecciones abiertas | **Corregido** en el callback OAuth. No hay más redirecciones con destino del cliente | Unitaria |
| `JWT_SECRET` ausente en producción | **Corregido**: no se emiten ni aceptan sesiones (login 503) y el arranque no se rompe | Unitaria |
| Sesiones del modo OAuth heredado (sin empresa) en multiempresa | **Corregido**: no se aceptan ni se emiten | — |

### Roles (servidor)

Los roles del producto se corresponden con los existentes. Solo se añade lo mínimo:

| Producto | Rol | Notas |
|---|---|---|
| Propietario de empresa | `admin` cuyo email coincide con el ajuste `company_owner_email` | Lo siembra el aprovisionamiento. Es un ajuste sensible: no se edita desde el panel |
| Administrador | `admin` | — |
| Empleado | `agente` | Equipo: CRM, reservas, facturas. Sin ajustes ni usuarios |
| Solo lectura | `readonly` (**nuevo**, migración `0005`) | Consulta lo mismo que el equipo. **Ninguna** mutación se ejecuta |

Probado en MySQL real:

- un empleado no crea usuarios, no cambia roles, no edita ajustes ni la configuración de las
  comunicaciones y no envía correos de prueba;
- un usuario sin rol de equipo no accede a comunicaciones, seguimiento comercial, órdenes del día
  ni instantáneas de precio;
- el rol de solo lectura no muta nada: ni CRM, ni descuentos, ni administración;
- otro administrador no puede degradar, desactivar, borrar ni cambiar la contraseña del
  propietario, ni cambiar el ajuste de propietario;
- nadie puede dejar la empresa sin un administrador activo.

## 2. Qué se ha corregido

**Aislamiento multiempresa**
- La firma de los enlaces de factura incluye la empresa en modo multi. En instalación única no
  cambia: los enlaces ya enviados siguen siendo válidos.
- En modo multi se desactivan los tokens globales de entorno (recuperación de Redsys y formulario
  público de gastos), y la comparación de este último pasa a ser en tiempo constante.
- La copia al administrador de los correos no cae en la dirección global en modo multi.
- El modo OAuth heredado no se acepta en modo multi.

**Webhooks**
- Desaparece el valor por defecto del secreto del inbox de GHL, tanto en el servidor como al
  guardar credenciales.
- Sin un secreto configurado de al menos 24 caracteres, el webhook del inbox de GHL queda inactivo
  en cualquier entorno. El antiguo valor por defecto publicado se trata como no configurado.
- En modo multi, los webhooks de leads de GHL y de VAPI exigen secreto. En instalación única
  siguen siendo opcionales por compatibilidad. En ambos casos la comparación es en tiempo
  constante, y al guardar un secreto de VAPI se exige la longitud mínima.

**Autorización**
- `emailCommunications` y `commercialFollowup` estaban abiertos a cualquier usuario con sesión.
  Ahora piden el permiso del equipo, y la configuración y los envíos manuales piden administrador.
- `operations.*.getForDate` exige el permiso `operations.view`.
- `legoPacks.saveSnapshot` y `legoPacks.getSnapshot` exigen el permiso del equipo.

**Errores, cabeceras y límites**
- Errores tRPC: la pila solo se envía en desarrollo, y los errores de base de datos o de
  infraestructura llegan con un mensaje genérico.
- Cabeceras globales: `X-Content-Type-Options`, `X-Frame-Options`/`frame-ancestors`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS (en producción con HTTPS) y sin `X-Powered-By`.
  Va en un commit aislado que solo toca el arranque.
- Los formularios públicos de ticketing y su subida de adjuntos entran en el límite por IP de
  los formularios públicos.

### Migración preparada

`db/migrations/0006_readonly_role.sql` y su `.down.sql`: amplía el ENUM `users.role` con
`readonly`. Es aditiva y reversible (la reversión pasa esos usuarios a `user`) y está verificada
con `migrate.ts verify`. El número puede cambiar al integrar. Hasta que se aplique, crear usuarios
`readonly` falla de forma controlada y el resto no cambia.

## 3. Pendiente

Resumido; el detalle va en el informe de la tarea.

1. **Acción operativa (Náyade, instalación única):** si el inbox de WhatsApp de GHL usa un secreto
   corto o el antiguo valor por defecto, el webhook queda **inactivo** al desplegar. Hay que
   configurar un secreto de 24 caracteres o más en el panel o en `GHL_WEBHOOK_SECRET`, y también
   en GHL. El cliente aún envía el antiguo valor como respaldo. El servidor lo ignora, pero
   conviene retirarlo del cliente (lo lleva otra rama).
2. **Revocación individual en servidor:** el logout borra la cookie, pero un token copiado sigue
   siendo válido hasta caducar, salvo que cambie la contraseña o se desactive el usuario. Requiere
   un almacén de sesiones (migración).
3. El límite antifuerza bruta por cuenta vive en la memoria de cada réplica. Con varias réplicas,
   requiere un almacén compartido.
4. En modo multi, los enlaces de recuperación e invitación se construyen con la URL global. Fallan
   cerrados (el token no existe en otra empresa), pero no funcionan para las demás empresas
   (funcional).
5. En modo multi no existen las tablas RBAC: los permisos salen de los roles heredados. En
   instalación única, `readonly` necesita su rol RBAC para ver datos.
6. Las activaciones de los portales de empleado, partner, proveedor y gestoría siguen el patrón
   antiguo de invitación. Hay que alinearlas con el canje atómico.
7. Validación de ficheros en las subidas de administración (tipo real del contenido, formatos con
   scripts), límite global del cuerpo de las peticiones y errores REST con detalle en algunas
   rutas de administración.
8. Otros endurecimientos menores, revisados y no explotables entre empresas: datos personales en
   algunos logs de correo, constantes globales congeladas al importar en Meta CAPI, el límite
   global de conexiones SSE, `BASE_URL` fija en el sitemap y el secreto del inbox visible para el
   equipo en la configuración.
9. **Dependencias** (`pnpm audit --prod`, sin cambios en `package.json` ni en el lockfile):
   146 avisos (2 críticos, 52 altos). Hay que actualizar, en un PR aislado de infraestructura:
   - críticos: `fast-xml-parser` (vía `@aws-sdk/client-s3`) y `proxy-addr` (vía `express`);
   - altos: `axios`, `multer`, `drizzle-orm`, `mysql2`, `@trpc/server`, `nodemailer`,
     `path-to-regexp`, `xlsx`, `nanoid`, `express-rate-limit` (`ip-address`) y dependencias de
     `puppeteer-core`/`archiver`.

## 4. Cómo ejecutar

```bash
# Unitarias (incluidas en el CI: prefijo server/securityLaunch)
pnpm exec vitest run server/securityLaunch.test.ts server/ghlInboxRouter

# Aplicación real con dos empresas (MySQL desechable)
REGISTRY_TEST_DATABASE_URL=mysql://root:clave@127.0.0.1:3306/registry_test \
  pnpm exec vitest run server/securityLaunch.mysql.test.ts
```

Prueba de sabotaje: se revirtió cada corrección clave por separado (firma de factura por empresa,
CSRF, solo lectura, propietario, canje atómico de recuperación e invitación, huella `pwv`). Cada
reversión hace fallar al menos una prueba (7 en total).
