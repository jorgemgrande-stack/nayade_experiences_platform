# Overnight 3 · Lanzamiento comercial de Essential: registro de ejecución

**Objetivo:** que una empresa nueva pueda descubrir Elephant Source, registrarse, probar Essential 15 días y contratarlo sin intervención humana.

**Estados:**
- COMPLETADO: hecho y probado en su rama.
- INTEGRADO: en la rama de integración, con la batería completa en verde.
- DESPLEGADO.
- VERIFICADO.
- PARCIAL.
- BLOQUEADO.
- PENDIENTE DE AUTORIZACIÓN.

**Resumen:** nada de esta etapa está DESPLEGADO. El despliegue sigue bloqueado por la configuración de Railway y requiere las migraciones con copia verificada (ver «Autorizaciones»).

## Ramas de integración

Son los candidatos únicos; ninguna despliega por sí misma.

| Repositorio | Rama | PR a `main` | Última verificación local |
|---|---|---|---|
| Core | `integration/elephant-source` | #98 | Bloqueantes 1072 · MySQL 238 (37 ficheros) · `tsc` 10 (línea base) · build correcto · migraciones: app 8, CRM 10 |
| CRM | `integration/elephant-source` | #16 | `test` 78/78 · `typecheck` y `build` correctos |
| Web | `feat/elephant-web-portfolio` | #5 (cadena #1–#6) | `check` sin errores · `test` 69/69 · `build` 71 páginas · `e2e` 36/36 (en la rama del lanzamiento) |

**Notas sobre la verificación local:**
- `server/tscBaseline.test.ts` y `server/sensitiveFiles.test.ts` fallan solo en Windows, porque los `.mjs` con shebang tienen finales CRLF en la copia de trabajo. Con LF pasan, y en el CI (Linux) también.
- La suite completa del Core ya no arrastra fallos heredados: los 18 se diagnosticaron y se resolvieron (#108).

## Registro por fase

| Fase | Tarea | Repositorio · rama · PR | Prueba principal | Estado |
|---|---|---|---|---|
| P0 Integración | Railway: disparador | Core | Consulta del 16/10/2026: `main`, `checkSuites: false`, sin `watchPatterns` | **BLOQUEADO** (administrador) |
| P0 Integración | Cadenas de PR unificadas | Core #98, CRM #16, Web #5 | CI de #98 verde salvo el último arreglo de gitleaks (ver CI) | INTEGRADO · PENDIENTE DE AUTORIZACIÓN |
| P0 Seguridad | Aislamiento, autenticación, roles, webhooks | Core `fix/seguridad-multiempresa` #110 | `securityLaunch.mysql` 23 + unitarias 13; 7 sabotajes | INTEGRADO |
| P0 Panel | Menú por licencias, Inicio, estados vacíos, formularios, Suscripción | Core `feat/panel-essential-ux` #107 | `panelEssential` 29 + E2E de panel 5 | INTEGRADO |
| P0 Web | Portada, prueba como lista de espera, precios, comparador, legales en borrador, SEO | Web `feat/web-lanzamiento-essential` #6 | `test` 69, `e2e` 36 | INTEGRADO (en #5) · sin publicar |
| P0 Registro y prueba | Recorrido de 15 días y 6 huecos cerrados | Core `feat/onboarding-essential` #111 | `trialJourney.mysql` 11 | INTEGRADO · registro público apagado |
| P0 Asistente | «Primeros pasos» (7 pasos, progreso en servidor, límite de usuarios) | Core #111, más una corrección de rol en la integración | `setupWizard` 11 | INTEGRADO |
| P0 Essential | Matriz de las 29 capacidades | Core `test/essential-capacidades` #109, más #113, #115 y #116 | `essential.*.mysql` (5 ficheros) | INTEGRADO · ver matriz |
| P1 Contratación | Orquestador, pagos de prueba firmados, cancelación en cascada, impago | Core `feat/orquestador-contratacion` #106 | `controlPlane.orchestrator` 19, `orchestrator.mysql` 5 | INTEGRADO · apagado (`CP_ORCHESTRATOR_ENABLED`) |
| P1 Administración central | Operación SaaS en el CRM y endpoints del plano de control | CRM `feat/operacion-saas` #17; Core #113 | CRM 78 · `controlPlane.saasOps` 11 | INTEGRADO |
| P1 Defectos | Numeración atómica, línea base de tipos (108 → 10) y suite completa | Core `fix/numeracion-y-deuda-critica` #108 | `documentNumbers.mysql` 5 | INTEGRADO |
| P1 Defectos | Reservas históricas de hotel y spa | — | Reconciliación en modo informe (#105) | PENDIENTE DE AUTORIZACIÓN: no se modifican sin autorización |
| P1 Cliente nuevo E2E | 28 pasos (Empresa Demo 01) y aislamiento (Empresa Demo 02) | Core `test/cliente-nuevo-e2e` #114 | `clienteNuevo.e2e.mysql`, 25 bloques | INTEGRADO |
| P1 Rendimiento | Medidas reproducibles y 5 fallos corregidos | Core #114 | `rendimiento.perf.mysql` (opt-in `PERF=1`) | INTEGRADO · riesgos abajo |
| P1 Observabilidad | `X-Request-Id`, logs sin datos personales, `/readyz`, alertas | Core `feat/observabilidad-y-ayuda` #112 | `opsObservability` 16 | INTEGRADO |
| P1 Soporte y ayuda | Centro de ayuda con guías sobre la interfaz real y contacto configurable | Core #112, ampliado en #115 y #116 | `panelEssentialHelp` | INTEGRADO · falta la dirección de soporte |
| P1 Pulido | WhatsApp por empresa, correos y páginas de acceso con la marca de la empresa, Nueva caja, RBAC, 503 en `/api/auth` | Core `fix/pulido-essential` #113 | `pulidoEssential*` (43) | INTEGRADO |
| P0 Essential | Etiquetas, tareas y blog | Core #116 y #115 | `essential.crm`/`web.mysql` | INTEGRADO |

**Documentos de detalle:**

| Tema | Documento |
|---|---|
| Matriz de capacidades | `docs/elephant-source/ESSENTIAL_CAPACIDADES.md` |
| E2E de cliente nuevo | `docs/elephant-source/E2E_CLIENTE_NUEVO.md` |
| Rendimiento | `docs/elephant-source/RENDIMIENTO_ESSENTIAL.md` |
| Seguridad | `docs/seguridad/SEGURIDAD_LANZAMIENTO.md` |
| Orquestador | `docs/architecture/ORQUESTADOR_CONTRATACION.md` |
| Observabilidad | `docs/runbooks/OBSERVABILIDAD.md` |
| Migraciones | `docs/runbooks/MIGRACIONES_ELEPHANT_SOURCE.md` |

## Criterios de aceptación (§20)

| # | Criterio | Estado |
|---|---|---|
| 1 | Web pública desplegada y verificada | **NO**: compilada y probada (71 páginas), sin publicar |
| 2 | Precios correctos | SÍ, en el código: Essential 29/279, Business 79/759, Enterprise desde 199/1.899 (sin IVA), probados en web y Core |
| 3 | Comparador | SÍ, en el código (E2E de la web) |
| 4 | Registro | SÍ en pruebas; **apagado** en producción (`CP_PUBLIC_TRIAL_ENABLED`) |
| 5 | Correo de verificación | En pruebas (buzón en memoria). **Sin proveedor real configurado** |
| 6 | Creación del tenant | SÍ (aprovisionamiento real sobre MySQL en las pruebas) |
| 7 | Prueba de 15 días | SÍ (pruebas) |
| 8 | Onboarding | SÍ (servidor probado; la interfaz solo con tipos, build y E2E ligeras) |
| 9 | Panel comprensible | SÍ en las pantallas del recorrido. Pendiente de una revisión con usuarios reales |
| 10 | 29 capacidades verificadas | 6 funcionales y 23 funcionales con limitaciones; ninguna incompleta ni sin implementar (ver matriz) |
| 11 | Permisos | SÍ (roles: propietario, administrador, empleado y solo lectura) |
| 12 | Aislamiento multiempresa probado | SÍ (tRPC, REST, IDOR, cookies, concurrencia) |
| 13 | Límites de licencia en el servidor | SÍ (`CAPABILITY_ENFORCEMENT=on` en multi; usuarios del plan) |
| 14 | El vencimiento preserva los datos | SÍ |
| 15 | Contratación en sandbox | SÍ, con pagos de prueba firmados. Sin pasarela real de pruebas (no hay credenciales) |
| 16 | La conversión preserva los datos | SÍ |
| 17 | El CRM interno refleja la contratación | SÍ en vistas (Operación SaaS). Falta la interfaz de pedidos del orquestador |
| 18 | Sin vulnerabilidades críticas conocidas | En el código del recorrido, sí. **Dependencias:** `pnpm audit` informa de 2 críticas y 52 altas → PR de infraestructura aislado pendiente |
| 19 | Sin defectos críticos conocidos en el recorrido | Sin defectos abiertos en las pruebas. Riesgos de capacidad abajo |
| 20 | Soporte básico | Centro de ayuda listo; **falta configurar la dirección de soporte** |
| 21 | Procedimiento de copia y recuperación | SÍ (runbook ensayado). Ejecución real pendiente |
| 22 | E2E de cliente nuevo | SÍ (28 pasos + aislamiento) |
| 23 | Textos legales revisados | **NO**: borradores marcados, faltan datos societarios y la revisión jurídica |
| 24 | Autorización de cobros y registros públicos | **PENDIENTE** |

**Conclusión:** Elephant Source **no está listo para vender** todavía. Faltan 1, 5, 20, 23 y 24, y el despliegue. El producto está preparado en el código y probado de punta a punta.

## Riesgos de capacidad (medidos, no estimados)

- **Login:** con `bcryptjs` de coste 12, unos 4 inicios de sesión por segundo y proceso. Requiere `bcrypt` nativo o *workers*, lo que supone cambiar dependencias.
- **Conexiones MySQL:** cada empresa activa abre hasta 10 conexiones; con 10 empresas se llegó a 129. Antes de abrir el registro hay que dimensionar `max_connections` o reducir el pool por empresa.
- **Contadores en memoria:** el antifuerza bruta y las alertas viven en memoria de cada réplica.

## Autorizaciones necesarias (acción humana exacta)

1. **Railway:** servicio `nayade_experiences_platform` → Settings → Deploy → activar «Wait for CI».
2. **Copia verificada de la base de Náyade** y aplicación del carril de la app `0003`–`0008`, en orden y con `status` previo sobre una copia (runbook). Sin la `0004` fallan las reservas de spa y hotel.
3. **Fusionar:**
   - Core `gh pr merge 98 --merge`.
   - CRM `gh pr merge 16 --merge --repo jorgemgrande-stack/big-elephant-crm`.
   - Web: cadena #1 → #5.
   - Después, verificar el deploy en Railway (`Server running on http://localhost:3000/` y trabajos sin errores).
4. **Plano de control:** migraciones de CRM 0008–0010 y de registro 0008–0009, y la semilla del catálogo.
5. **Proveedor de correo** (credenciales SMTP o de API) y **dirección de soporte** (`ELEPHANT_SUPPORT_EMAIL`).
6. **Secreto del inbox de GHL** de 24 caracteres o más, en el panel y en GHL. Sin él, el webhook queda inactivo.
7. **Pasarela de pagos en modo pruebas** (credenciales de prueba) antes de cualquier cobro real; los cobros reales necesitan autorización expresa.
8. **Textos legales:** datos societarios y revisión jurídica.
9. **Apertura pública:**
   - `CP_PUBLIC_TRIAL_ENABLED=1`, `PUBLIC_TRIAL_SIGNUP=1` en la web y `CP_TRIAL_VERIFY_URL`, con autorización expresa.
   - Antes, resolver el dimensionamiento de conexiones.
10. **Dependencias:** PR de infraestructura aislado para las vulnerabilidades críticas y altas de `pnpm audit`.
