# Propuesta: registro central de tenants

**Estado:** propuesta para revisión. **No hay implementación.** Cualquier código parte de este documento una vez aprobado.

## 0. Principios (decididos)
1. Registro central, **independiente** de las bases de datos operativas.
2. Cada tenant: **su base de datos y sus credenciales**.
3. Resolución por **dominios registrados y validados**.
4. **Sin fallback** a una BD global en modo multiempresa: si no se resuelve, se rechaza.
5. El Core **funciona sin Big Elephant CRM**; el CRM será después el administrador comercial y de aprovisionamiento del registro.
6. **Contratos versionados**, cachés aisladas, operaciones auditables.

## 1. Dónde vive y cómo se accede

```
 ┌──────────────┐  lee (rol de solo lectura)   ┌────────────────────────┐
 │  Core (web,  │ ───────────────────────────► │  REGISTRO (BD propia)  │
 │  workers)    │                              │  tenants · databases   │
 └──────┬───────┘                              │  domains · events      │
        │ DSN descifrado en memoria            └───────────▲────────────┘
        ▼                                                  │ escribe (rol de administración)
 ┌────────────┐ ┌────────────┐                  ┌──────────┴───────────┐
 │ BD tenant A│ │ BD tenant B│                  │ CLI de operador (hoy)│
 └────────────┘ └────────────┘                  │ Big Elephant CRM (+) │
                                                └──────────────────────┘
```

- **Almacén separado**: base de datos (o instancia) distinta de las de los tenants, con credenciales propias y rol de **solo lectura** para el Core. Un fallo o un tenant pesado no afecta al registro.
- **Abstracción** `TenantRegistryStore` (obtener por dominio, por id, listar activos): implementación MySQL en producción y en memoria/fichero para desarrollo y pruebas. El Core no depende del CRM.
- **Escritura** solo mediante `TenantRegistryService` (un único camino): valida transiciones, escribe el evento de auditoría en la misma transacción y usa concurrencia optimista. Hoy lo invoca un **CLI de operador**; mañana, la API de control del CRM, sin cambiar el servicio.

## 2. Esquema (borrador)

```sql
-- Metadatos y versión del contrato
registry_meta(k PK, v)                       -- schema_version, contract_version

tenants(
  id           VARCHAR(63) PK,               -- [a-z0-9_-], inmutable (clave de toda cache y de storage)
  display_name VARCHAR(200),
  status       ENUM('provisioning','trial','active','grace','suspended',
                    'archived','deleting','deleted'),
  status_reason VARCHAR(200) NULL,
  baseline_version  VARCHAR(32),             -- baseline/migración con la que nació
  schema_version    VARCHAR(64),             -- última migración aplicada a su BD
  registry_version  INT,                     -- bump en cada cambio (invalidación de cachés, concurrencia)
  created_at, updated_at
)

tenant_databases(
  id PK, tenant_id FK,
  role         ENUM('primary'),              -- hueco para réplicas/lectura más adelante
  state        ENUM('pending','active','retired'),  -- permite mover un tenant sin corte
  dsn_cipher   VARBINARY(...),               -- AES-256-GCM
  key_id       VARCHAR(32),                  -- clave de cifrado usada (rotación)
  server_alias VARCHAR(64),                  -- etiqueta no sensible ("mysql-a")
  created_at, rotated_at
)  -- como máximo UNA fila 'active' por tenant

tenant_domains(
  domain       VARCHAR(253) PK,              -- minúsculas, punycode, sin puerto
  tenant_id    FK,
  kind         ENUM('platform_subdomain','custom'),
  status       ENUM('pending_verification','verified','active','disabled','removed'),
  is_primary   BOOL,
  verification_token VARCHAR(64),
  verified_at, activated_at, created_at
)  -- un dominio pertenece a un único tenant; un solo primario por tenant

tenant_events(                               -- append-only
  id PK, tenant_id, at,
  actor_type   ENUM('system','operator','crm'),
  actor_id     VARCHAR(100),
  action       VARCHAR(60),                  -- tenant.created, status.changed, domain.verified…
  from_state, to_state,
  details_json JSON,                         -- nunca secretos
  request_id   VARCHAR(64)
)
```

Datos **comerciales** (planes, módulos contratados, facturación) **no** están en el registro: los administrará el CRM y llegarán como *snapshot* de licencias. El registro solo conoce lo operativo.

## 3. Ciclo de vida

```
provisioning ─► trial ─► active ◄─► grace ─► suspended ─► archived ─► deleting ─► deleted
                  │         ▲          ▲          │            ▲
                  └─────────┴──────────┴──────────┴────────────┘  (reactivación si no se ha borrado)
```

| Estado | Web pública | Admin | Escrituras / cobros / envíos | Notas |
|---|---|---|---|---|
| provisioning | No | No | No | Alta en curso (BD, migraciones, seed, dominio) |
| trial / active | Sí | Sí | Sí (en *trial*, en modo sandbox) | |
| grace | Sí | Sí | Sí | Avisos |
| suspended | Aviso de suspensión | Solo propietario | **Bloqueadas** | Reversible; exportación permitida |
| archived | No | Solo exportación | No | Ventana de retención |
| deleting / deleted | No | No | No | **Nunca automático**: exige aprobación explícita y backup verificado |

Reglas: transiciones permitidas en una **tabla cerrada** (cualquier otra se rechaza); cada una **idempotente** y **auditada**; sin borrados irreversibles en el flujo ordinario.

## 4. Resolución del tenant (por petición)

1. **Normalizar** `Host`: minúsculas, sin puerto, punycode. Rechazar IP y nombres no válidos (salvo lista explícita en desarrollo). `X-Forwarded-Host` solo si proviene del proxy de confianza configurado.
2. **Caché de dominios** (por proceso, LRU): `domain → {tenantId, estado, registry_version}`. TTL corto (30–60 s); caché **negativa** más corta (5 s) para dominios desconocidos.
3. **Fallo de caché** → lectura del registro (solo dominios `active` de tenants en estado servible).
4. **Decisión**:
   - dominio desconocido → `404` genérico (sin revelar si existe un tenant);
   - `suspended` → página de suspensión (`503`);
   - `archived`/`deleted` → `410`;
   - servible → `runWithTenant(tenantId, …)` (ya existe `_core/tenant`).
5. **Conexión**: el resolvedor de `_core/dbRegistry` pide al registro el DSN activo, lo **descifra en memoria** y crea el pool del tenant (LRU con máximo de pools y expulsión por inactividad). **Nunca** `DATABASE_URL` en modo multi.
6. **Sesiones**: el JWT lleva `tid` y se valida contra el tenant resuelto: una cookie de A no sirve en B.
7. **Fuera de HTTP** (jobs, webhooks): el planificador itera tenants activos; los webhooks entran por el subdominio del tenant (o ruta con id) con secreto por tenant.
8. **Registro inaccesible**: se sirve desde la última caché válida con **antigüedad máxima** (p. ej. 10 min) para dominios ya conocidos; para desconocidos, **falla cerrado** (503). Jamás se cae a otra BD.

### Cachés aisladas
Todas las cachés de la aplicación (ajustes, flags, HTML, emisores SSE, almacenamiento) pasan a clave `tenantId:…` o a instancias por tenant. Invalidación por `registry_version` (sondeo ligero de cambios) y, más adelante, por evento.

## 5. Contratos versionados
- **Interfaz TypeScript** `TenantRegistryStore` + esquemas JSON de los objetos (`Tenant`, `TenantDomain`, `TenantEvent`) con `contract_version` (SemVer). Cambios solo **aditivos** dentro de una mayor.
- El Core declara el rango de contrato que soporta y **se niega a arrancar en modo multi** si el registro está fuera de rango.
- **API de control v1** (para el CRM, más adelante): `POST /control/v1/tenants`, `POST …/domains`, `POST …/lifecycle`, con idempotency-key y autenticación mutua. Misma `TenantRegistryService` por debajo.

## 6. Auditoría y secretos
- Toda mutación escribe `tenant_events` en la misma transacción. Sin SQL directo sobre el registro.
- DSN cifrados (AES-256-GCM) con `key_id`; la clave **no** vive en el registro. Rotación: nueva `key_id`, re-cifrado por lotes, retirada de la anterior.
- Ningún DSN, token ni contraseña en logs, eventos ni respuestas.

## 7. Transición de Náyade (sin corte)
1. Desplegar el registro y el código **inactivo** (`TENANT_MODE=single`).
2. Registrar el tenant `nayade` con su BD actual y sus dominios; **modo sombra**: se resuelve y compara con el comportamiento actual sin efecto.
3. Activar `multi` primero en preproducción con 2 tenants de prueba; suite de aislamiento cruzado obligatoria.
4. Activar en producción cuando la sombra no muestre discrepancias.

## 8. Decisiones que necesito de ti
| # | Decisión | Recomendación |
|---|---|---|
| R1 | ¿Dónde vive el registro? | BD/instancia **separada** de las de tenants (aislamiento de fallos) |
| R2 | Dominio base de subdominios de prueba | Un dominio de plataforma propio (decisión comercial/infra) |
| R3 | Verificación de dominio propio | CNAME a la plataforma + registro TXT con token |
| R4 | Clave de cifrado de DSN | Variable de entorno con `key_id` ahora; KMS más adelante |
| R5 | Emisión de TLS para dominios propios | Delegada en el proveedor (Railway/CDN); fuera del Core |
| R6 | ¿Antigüedad máxima aceptable de caché si el registro cae? | 10 min |
