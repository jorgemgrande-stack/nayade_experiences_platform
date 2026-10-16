# Overnight 3 · Lanzamiento comercial de Essential: registro de ejecución

**Objetivo:** que una empresa nueva pueda descubrir Elephant Source, registrarse, probar Essential 15 días y contratarlo sin intervención humana.

**Estados:** COMPLETADO · INTEGRADO (en la rama de integración) · DESPLEGADO · VERIFICADO · PARCIAL · BLOQUEADO · PENDIENTE DE AUTORIZACIÓN.

**Ramas de integración** (candidatos únicos; ninguna despliega por sí misma):

| Repositorio | Rama | PR a `main` |
|---|---|---|
| Core | `integration/elephant-source` | #98 |
| CRM | `integration/elephant-source` | #16 |
| Web | `feat/elephant-web-portfolio` | #5, cadena #1–#5 |

## Fase P0 — Desbloquear la integración

| Tarea | Repositorio | Resultado | Estado |
|---|---|---|---|
| Railway: disparador | Core | Rama `main`, `checkSuites: false`, sin `watchPatterns` (consultado el 16/10/2026). Un merge a `main` desplegaría sin esperar al CI. | **BLOQUEADO**: activar «Wait for CI» requiere al administrador |
| Railway: deploy activo | Core | `baeca78` (= `main`) | VERIFICADO |
| Core #98 | Core | Abierto, sin conflictos con `main`, CI verde en `37664aa` | PENDIENTE DE AUTORIZACIÓN |
| CRM: cadena #1–#15 | CRM | Integrada sin conflictos en el #16; `test` 55/55, `typecheck` y `build` correctos | INTEGRADO · PENDIENTE DE AUTORIZACIÓN (la herramienta no puede fusionar) |
| Web: cadena #1–#5 | Web | El #5 contiene toda la cadena; el trabajo nuevo se basa en él | PENDIENTE DE AUTORIZACIÓN |
| Migraciones del carril de la app 0003 y 0004 | Core | Procedimiento en `docs/runbooks/MIGRACIONES_ELEPHANT_SOURCE.md`; no ejecutadas | PENDIENTE DE AUTORIZACIÓN (requiere copia verificada) |

**Instrucción exacta para el propietario:**
1. Railway → servicio `nayade_experiences_platform` → Settings → Deploy → activar «Wait for CI».
2. Aplicar `0003` y `0004` en la base de Náyade con copia verificada (runbook).
3. Fusionar los PR:
   - Core: `gh pr merge 98 --merge --repo jorgemgrande-stack/nayade_experiences_platform`
   - CRM: `gh pr merge 16 --merge --repo jorgemgrande-stack/big-elephant-crm`
   - Web: fusionar en orden #1 → #5, o el PR del lanzamiento cuando exista.

## Trabajo en curso

Se completa al integrar cada rama:

| Fase | Rama | Repositorio | Estado |
|---|---|---|---|
| P0 Seguridad multiempresa | `fix/seguridad-multiempresa` | Core | en curso |
| P1 Numeración RES y deuda crítica | `fix/numeracion-y-deuda-critica` | Core | en curso |
| P0 Panel | `feat/panel-essential-ux` | Core | en curso |
| P0 Registro, prueba y asistente | `feat/onboarding-essential` | Core | en curso |
| P0 Capacidades Essential | `test/essential-capacidades` | Core | en curso |
| P1 Orquestador de contratación | `feat/orquestador-contratacion` | Core | en curso |
| P0 Web comercial | `feat/web-lanzamiento-essential` | Web | en curso |
| P1 Administración central | `feat/operacion-saas` | CRM | en curso |
