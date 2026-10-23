# Overnight — evolución del backoffice SaaS (Big Elephant Admin)

Registro de ejecución persistente: si la sesión se interrumpe, el siguiente arranque continúa desde aquí. Sin secretos.

**Objetivo:** convertir Big Elephant Admin (`admin.bigelephant.es`, CRM `big-elephant-crm` + plano de control de este
repositorio) en la consola operativa del negocio SaaS. Encargo del 24/10/2026.

**Reglas:**
- `integration/elephant-source` (Core y plano de control) e `integration/elephant-source` del CRM; nunca `main`.
- Live se publica automáticamente; production solo por el protocolo ([PROTOCOLO_PUBLICACION.md](PROTOCOLO_PUBLICACION.md)).
- `MAIL_MODE=off` en production. Sin Stripe real, sin autoservicio, sin IA y sin textos legales.

## Matriz de trabajo

| Bloque | Tarea | Prioridad | Estado |
|---|---|---|---|
| A | Accesos de las empresas: API Core + plano de control | P0 | Desarrollado y probado (PR en curso) |
| A | Pestaña «Accesos» en la ficha SaaS (CRM) | P0 | Pendiente |
| A | Caso Skibox: localizar al administrador (sin enviar nada) | P0 | Pendiente |
| A | Revocar sesiones sin desactivar | P1 | Bloqueado: requiere migración (versión de sesión por usuario) |
| B | Resource Manager: diagnóstico de `ERM_DATABASE_URL` | P0 | Pendiente |
| B | Estados de empresa, prueba, suscripción y técnico separados | P1 | Pendiente |
| C | Listado de empresas y ficha 360° | P1 | Pendiente |
| C | Alta guiada | P1 | Pendiente |
| D | Dashboard, tareas y tickets | P1 | Pendiente |
| E | Versiones, migraciones, backups y salud | P2 | Pendiente |
| F | Web comercial | P2 | Pendiente |

## Decisiones técnicas

- **Accesos de las empresas:** el plano de control NO toca la tabla `users` de una empresa.
  - Pide al Core, por la red privada, que ejecute la acción en el contexto de la empresa: `POST /_ops/access`.
  - El token va firmado con una clave derivada de `SUPPORT_JWT_SECRET`, con audiencia propia, caducidad ≤ 2 min y un solo uso.
  - Se reutilizan los flujos existentes:
    - `requestPasswordReset`;
    - invitación de 72 h;
    - `loginThrottle`;
    - `users.isActive`, que corta las sesiones porque se comprueba en cada petición;
    - las salvaguardas de propietario y del último administrador.
  - **Destino:** `CP_CORE_INTERNAL_URL`, por defecto `http://core.railway.internal:3000` (el mismo que el `UPSTREAM` de la pasarela).
- **Envíos de accesos:**
  - el operador teclea el correo del destinatario;
  - con `MAIL_MODE=off`, o con un destinatario fuera del sandbox, no se crea ningún enlace;
  - nunca se muestra ni se fija una contraseña.
- **Auditoría:** cada acción (también las fallidas) queda en `tenant_events` como `access.<acción>`, con el usuario (id), el motivo y el resultado; sin correos ni tokens.

## Registro

- **24/10:**
  - Análisis del bloque A: no existían rutas de usuarios por empresa en el plano de control.
  - Implementados el canal y las rutas `GET /cp/v1/tenants/:id/access` y `POST /cp/v1/tenants/:id/access/users/:uid/{reset|invite|unlock|activate|deactivate}`.
  - 11 pruebas nuevas; suites del plano de control y del registro en verde; sin errores de tipos nuevos.
