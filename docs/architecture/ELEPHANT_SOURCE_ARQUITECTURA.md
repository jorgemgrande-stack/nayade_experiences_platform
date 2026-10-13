# Elephant Source — arquitectura multiempresa (estado implementado)

Documento de referencia de lo que **existe en el código**. Para decisiones y su motivo, ver `docs/roadmap/DECISIONS.md`; para operar, `docs/runbooks/`.

## 1. Piezas

| Pieza | Dónde | Responsabilidad |
|---|---|---|
| **Core** | `server/`, `client/` | CMS, Commerce, TPV, administración. Un único despliegue. |
| **Registro de tenants** | `server/_core/tenantRegistry/`, `db/registry/` | Quién es cada tenant, sus dominios, su BD (DSN cifrado), estado, licencias, cuotas, auditoría. BD separada; el Core solo la lee. |
| **ERM** | `server/_core/erm/`, `db/erm/` | Medición, agregación, cuotas, limitación (tasa/concurrencia) por tenant. |
| **Módulos** | `server/_core/modules/` | Contrato de módulos, licencias aplicadas en servidor, migraciones por módulo. |
| **Aprovisionamiento** | `server/_core/provisioning/` | Alta automática idempotente y reanudable. |
| **Facturación SaaS** | `server/_core/billing/`, `db/billing/` | Suscripciones, prueba, gracia, cobros idempotentes, conciliación. Biblioteca extraíble al CRM. |
| **Operaciones** | `server/_core/ops/`, `scripts/tenants/cli.ts` | Migraciones por tenant (canario), diagnóstico, copias verificadas. |
| **Soporte delegado** | `server/_core/support/` | Acceso temporal, auditado, solo lectura por defecto. |
| **Plano de control (API)** | `server/controlPlane/` | `/cp/v1`, proceso separado, tokens con ámbitos. Lo consume Big Elephant CRM. |
| **Big Elephant CRM** | repo `big-elephant-crm` | SPA de administración sobre el plano de control. |

## 2. Resolución de tenant (cada petición)

```
Host → normalizeHost → TenantResolver (caché + registro) ─┬─ desconocido → 404
                                                          ├─ no servible → 410/503
                                                          └─ resuelto → runWithTenant(tenantId)
                                                                          ├─ dbRegistry: pool del tenant (DSN descifrado, LRU)
                                                                          ├─ sesión: JWT con `tid` == tenant resuelto
                                                                          ├─ cachés/SSE/ficheros: aislados por tenant
                                                                          ├─ ERM: tasa, concurrencia, cuotas
                                                                          └─ licencias de módulo (hotel/spa/restaurants)
```

Nada procedente del cliente (cabeceras, query, cuerpo, `tid` del token) elige el tenant: el tenant sale solo del `Host` resuelto en el registro.

## 3. Modos (`TENANT_MODE`)

- `single` (producción hoy): comportamiento histórico; ningún componente multiempresa actúa.
- `shadow`: resuelve y compara con el comportamiento actual **sin efecto**; métrica `tenant.shadow`.
- `multi`: tenant por dominio; sin tenant no hay BD; credenciales de integraciones solo del tenant; remitente de correo por tenant.

Runbook de paso: `docs/runbooks/ACTIVACION_MULTITENANT.md`.

## 4. Separación de datos

| Plano | Contenido | Quién escribe |
|---|---|---|
| Registro | hechos operativos: tenants, dominios, BD cifrada, licencias, cuotas, soporte, estado de alta, eventos (solo anexado) | plano de control |
| BD de métricas (`db/erm`) | consumo agregado por hora | Core |
| BD comercial (`db/billing`) | suscripciones, facturas, eventos de pago | plano comercial |
| BD del tenant | datos de negocio | Core (con el contexto del tenant) |

## 5. Garantías verificadas por pruebas

- Aislamiento de datos con MySQL real y con la **aplicación real** (dos empresas, baseline completo, login, tRPC).
- Dominio desconocido: 404 sin tocar BD ni `DATABASE_URL`.
- Sesión de un tenant no autentica en otro (`tid`).
- Cachés, eventos SSE, ficheros y plantillas SEO por tenant, con escape de HTML.
- Licencias en servidor (HTTP y tRPC); caducidad, suspensión, dependencias.
- Cuotas duras/blandas, alertas, vecino ruidoso (429), continuidad si cae el registro.
- Alta idempotente/reanudable; compensación solo por operador; sin secretos persistidos.
- Copias de seguridad verificadas por restauración y comparación de checksum.

## 6. Pendiente (ver `docs/roadmap/BLOCKERS.md`)

Activación `multi` en producción (autorización), titularidad/DNS de `elephantsource.es`, proveedor de pagos y tarifas, política de copias, tema/marca del cliente público por tenant, configuración de integraciones por tenant desde la UI, extracción de módulos sectoriales a repositorios propios.
