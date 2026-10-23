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
| A | Accesos de las empresas: API Core + plano de control | P0 | **Verificado en live** (Core #301). Production: pendiente de despliegue protegido |
| A | Pestaña «Accesos» en la ficha SaaS (CRM) | P0 | **Verificado en live** (CRM #33). Production: pendiente |
| A | Caso Skibox: localizar al administrador (sin enviar nada) | P0 | Bloqueado: necesita los despliegues de production (aprobación) |
| A | Revocar sesiones sin desactivar | P1 | Bloqueado: requiere migración (versión de sesión por usuario) |
| B | Resource Manager: el plano de control no tenía `ERM_DATABASE_URL` | P0 | **Corregido y verificado en live** (#302, #303). Production: operación protegida pendiente |
| B | Estados de empresa, prueba y suscripción separados | P1 | Desarrollado (CRM #35); el estado técnico, pendiente |
| C | Listado de empresas (orden, avisos «requieren atención») | P1 | Desarrollado (CRM #35) |
| C | Ficha 360° (resumen por dimensión, copias, comunicaciones) | P1 | **Desplegado en live** (CRM #36, #40, #41, #42) |
| G | Etiqueta de entorno: el CRM de live decía «Producción» | P0 | **Corregido** (CRM #34) |
| C | Alta guiada (reutiliza el asistente; alta técnica como avanzada) | P1 | Desplegado en live (CRM #39) |
| D | Dashboard: sección Clientes SaaS | P1 | **Desplegado en live** (CRM #38) |
| D | Tareas: alta, filtros por vencimiento, enlace a empresa | P1 | Desplegado en live (CRM #37) |
| D | Tickets: ya era funcional (estaba vacío por no haber registros); ciclo completo verificado en live | P1 | **Verificado** |
| D | Tareas: responsable y prioridad | P2 | Bloqueado: requiere migración del CRM |
| E | Versiones de esquema por empresa (API + vista) | P2 | Core #306 y CRM #43 (pendiente de publicar en live) |
| E | Copias por empresa en la ficha | P2 | Desplegado en live (CRM #41) |
| G | Publicación: referencia común de servicios (evita copia+migración en cada publicación) | P2 | Core #305 |
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
  - Live: Core #301 publicado automáticamente (CI → live → estado `elephant-source/live`).
    - API real con la empresa de prueba A: lista de usuarios OK.
    - Salvaguardas comprobadas: propietario protegido (409), confirmación obligatoria (400), confirmación distinta (409), destinatario fuera del sandbox (`sandbox_blocked`, sin enlace) y desbloqueo (200).
    - Todo, incluidos los rechazos, queda en `tenant_events`.
  - CRM #33 desplegado en live: pestaña Accesos verificada en el navegador.
  - CRM #34: el CRM de live se presentaba como «Producción»; ahora «Live · pruebas».
  - Resource Manager:
    - el Core de live mide en `es_erm`, pero el plano de control no tenía `ERM_DATABASE_URL`;
    - ahora la lee por referencia a la variable del Core (`almacenamiento-referencias`, solo en live);
    - `/tenants/:id/resources` y `/usage/:id` devuelven datos reales.
  - CRM #35: estados por dimensión en el listado de empresas.

## Pendiente de aprobación humana (production)

1. Despliegues protegidos de controlplane, core y CRM para que Accesos llegue a `admin.bigelephant.es` (caso Skibox).
2. `ERM_DATABASE_URL` en el plano de control de production (referencia a la del Core, si el Core de production la tiene).
3. Token de Railway para el entorno `elephant-source-production-despliegue`.
  - CRM #35–#43 en live (salvo #43, pendiente del Core #306): estados por dimensión, ficha 360°, tareas, dashboard SaaS, alta guiada, copias, comunicaciones y versiones.
  - Tickets: alta, asignación, nota interna, estado y cierre verificados con la API real de live.
  - Incidencias abiertas en live (del dashboard): «Stripe: la tarea periódica falla repetidamente» (ventana de Stripe, no tocada) y «Fallos de envío de correo repetidos» (los 412 del 23/10, anteriores a la aprobación de Postmark).
