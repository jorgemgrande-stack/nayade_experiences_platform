# Licencias por capacidad (Elephant Source)

**Elephant Control** (el plano de control) es la autoridad técnica sobre los derechos de uso:
- el **CRM** gestiona lo comercial;
- la **suscripción** guarda lo contratado (con el precio aceptado);
- y **aquí** eso se traduce en licencias que el Core comprueba **en el servidor**.

## Modelo

**Tabla:** `tenant_capabilities`, en el registro (migración `db/registry/0008_tenant_capabilities.sql`). Cada fila es una licencia `(tenant, capacidad, sede)`:
- `sede = ''` cubre toda la empresa;
- el historial va en `tenant_capability_events`, de solo anexado.

**Estados:**

| Estado | Significa | ¿Consultar? | ¿Operar? |
|---|---|---|---|
| (sin fila) | No contratado | no | no |
| `contracted` | Contratado, pendiente de activar | no | no |
| `pending_setup` | Pendiente de configuración | no | no |
| `active` | Activo | sí | sí |
| `read_only` | Solo lectura | sí | no |
| `suspended` | Suspendido | no | no |
| `cancelled` | Cancelado (los datos del tenant **no** se tocan) | no | no |
| `active` con `valid_until` pasado | Caducado (por ejemplo, prueba vencida) | sí | no |

**Origen:** `subscription:<id>`, `trial:<id>` u `operator`.

## Del contrato a las licencias

1. CRM: propuesta cotizada → contrato con configuración (`/cp/v1/crm/contracts`) → firma.
2. Activación del contrato: crea la plataforma (tenant).
3. Suscripción (`/cp/v1/subscriptions`) con la instantánea de precios.
4. **Vista previa:** `POST /cp/v1/subscriptions/:id/licences/preview` (`subscriptions:read`). Muestra las capacidades deseadas, qué producto concede cada una y los cambios.
5. **Aplicar:** `POST /cp/v1/subscriptions/:id/licences/apply` (`subscriptions:write` **y** `entitlements:write`).
   - Con `{ "activate": true }` las deja activas; con `false`, como contratadas.
   - Es una transacción con un evento por cambio, e idempotente.

**Qué capacidades se calculan:**
- las del plan, con su herencia (Business ⊃ Essential);
- las de cada partida viva;
- en los paquetes, las de sus componentes, sin duplicar.

**Casos especiales:**
- Suscripción en **prueba:** licencias con caducidad al final de la prueba. Sin conversión, el Core las trata como solo lectura.
- **Quitar** una partida: al reaplicar, su capacidad pasa a `cancelled`.
- Suscripción **cancelada:** todas sus licencias pasan a `cancelled`.

**Cambio manual:** `PUT /cp/v1/tenants/:id/capabilities/:capacidad` (`entitlements:write`), con `{ status, reason }`. El motivo es obligatorio (mínimo 5 caracteres).

**Consulta:** `GET /cp/v1/tenants/:id/capabilities` (`tenants:read`) devuelve las licencias y su historial.

## Aplicación en el Core

- `server/_core/capabilities/routeGuard.ts` asocia namespaces tRPC a capacidades. Por ejemplo:
  - `hr` → `people-hr`;
  - `gestoria` → `tax-filings`;
  - `vapiCalls` → `voice-ai`;
  - `ticketing` → `deals-coupons`;
  - `crm` → `crm-leads`;
  - `cms` → `cms-editor`;
  - `tpv` → `bill-cash`.
- Las consultas (GET) se permiten en solo lectura; las mutaciones (POST) exigen licencia activa.
- Si el registro no responde, la caché sigue sirviendo hasta 10 minutos; después, 503 (falla cerrado).
- **Solo se aplica en `TENANT_MODE=multi` con `CAPABILITY_ENFORCEMENT=on`.** Las empresas creadas antes de este motor no tienen licencias por capacidad: hay que aplicárselas (paso 5) **antes** de activar la variable, o se quedarían bloqueadas.
- En `single` (la instalación actual de una sola empresa) no cambia nada.

## Despliegue (cuando se autorice)

1. Migración del registro `0008`, con el migrador del registro (`scripts/registry-migrate.ts`) y nunca al arrancar.
2. Desplegar el plano de control. En el registro de arranque aparece `{"ctx":"Capabilities","enabled":true}`.
3. Aplicar licencias a cada empresa existente (paso 5).
4. Solo entonces, `CAPABILITY_ENFORCEMENT=on` en la instalación multiempresa.

## Pruebas

| Suite | Contenido |
|---|---|
| `server/capabilities.test.ts` | Decisión de acceso, caché y continuidad, guardián tRPC (GET y POST, lotes, 503) y aplicación desde suscripciones reales del motor: herencia, paquetes, prueba con caducidad, quitar partida, solo contratado, suspensión con motivo |
| `server/controlPlane.licensing.test.ts` | API: permisos, vista previa, aplicación idempotente, consulta y cambio manual |
| `server/capabilities.mysql.test.ts` | Migración `0008` con el migrador real, transacción con historial, concurrencia serializada y restricciones de la BD |
