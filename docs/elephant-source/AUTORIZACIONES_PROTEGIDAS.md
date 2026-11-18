# Autorizaciones protegidas y releases por servicio — procedimiento permanente

Complementa [AUTONOMIA_DESPLIEGUES.md](AUTONOMIA_DESPLIEGUES.md) y [PROTOCOLO_PUBLICACION.md](PROTOCOLO_PUBLICACION.md). Código: `scripts/deploy/esReleaseLib.ts` (modelo puro), `esGitView.ts`, `esGithub.ts` y las órdenes `release-plan` / `release-verify` de `esRailway.ts`. Pruebas: `server/despliegueRelease.test.ts` (escenarios A–N).

## Qué fallaba (incidente #875, 17–18/11/2026)

`publicar` calculaba UN commit de referencia con `active-sha`: el **ancestro común** (`git merge-base --octopus`) de lo que servían controlplane, core y core-gateway. Tras un despliegue protegido solo en Core, los otros dos servicios seguían atrás, así que la referencia era el commit viejo y el cambio protegido ya aprobado (`server/authGuard.ts`) volvía a aparecer como pendiente en **cada** publicación ordinaria. Además la aprobación no quedaba registrada en ningún sitio, y `publicar` terminaba en verde aunque production se hubiese omitido.

## Modelo

1. **Versión por servicio.** La verdad es el despliegue activo de Railway (`SUCCESS` con su commit en los metadatos). `release-plan` decide cada servicio contra **su** commit; `release-verify` comprueba tras publicar que sirve el destino. Si Railway no responde: `desconocido` (nunca éxito, y production queda bloqueado).
2. **Estados por servicio:** `al-dia`, `ordinario`, `requiere-aprobacion`, `regresion`, `desconocido`. Decisión de la release: `sin-cambios`, `publicar`, `bloqueado-protegido`, `bloqueado-regresion`, `bloqueado-desconocido`.
3. **Autorización ligada al contenido.** Cada cambio protegido se identifica por *fichero + contenido (blob) en el commit de destino*. Está aprobado si existe una aprobación válida cuyo commit tiene ese fichero con **exactamente** ese contenido. Si el fichero vuelve a cambiar, el contenido difiere y se exige una autorización nueva. Si el motivo no se puede ligar a un fichero, no es aprobable (bloqueo seguro).
4. **Qué es una aprobación válida** (`approvalsFromRuns`): una ejecución del flujo «Despliegue Elephant Source» que fue **manual** (`workflow_dispatch`), de `integration/elephant-source`, terminó en `success`, lanzada por un **administrador** del repositorio, con acción `aplicar-production` o `desplegar-controlplane|core|core-gateway`, entorno `production` y el commit exacto en su `run-name` (`<acción> · <entorno> · <commit>`). No cuentan mensajes de commit, variables de CI, PR, otras acciones, otro entorno ni otro repositorio. Ni live ni `publicar` aprueban nada.
5. **Alcance.** La aprobación de código vale para los tres servicios del Core (se construyen del mismo export): que falte desplegar el mismo contenido en otro servicio no es una decisión nueva de Dirección. No cubre cambios protegidos distintos ni posteriores.
6. **Sin regresiones.** El destino debe descender de lo que sirve cada servicio. Un commit antiguo o ajeno no sustituye a uno nuevo; volver atrás es `revertir-<servicio>`, explícito.
7. **Todo o nada al publicar.** `publicar` despliega los tres servicios que falten (los ya al día se saltan) con vuelta atrás automática; las migraciones no se revierten solas.

> Estado de GitHub a 18/11/2026: el entorno `elephant-source-production` no tiene revisores obligatorios (solo política de rama) y la rama no tiene protección. La aprobación efectiva es la ejecución manual del administrador tras la autorización expresa del propietario. Activar *Required reviewers* en ese entorno la reforzaría sin cambiar este modelo: es un acto del propietario (Settings → Environments).

## Qué cambió en los flujos

- `run-name` fijo en `deploy-elephant-source.yml` (lo lee `approvalsFromRuns`).
- Production clasifica con `release-plan` (por servicio y con aprobaciones) en vez de `active-sha` + `changes --production`.
- Tras publicar, `release-verify`; el estado de commit `elephant-source/production` es `success` solo con los tres servicios verificados, `pending` si está bloqueado o sin verificar, `failure` si falló.
- **Production pedido y no publicado ya no termina en verde:** el último paso marca el trabajo en rojo (`Production NO publicado`) tras publicar CRM/web, que son independientes. `publicacion.yml` añade `resumen` con live y production separados («Live publicado pero production NO»).
- `estado` en production imprime además el plan de la última versión de la rama (qué servicio falta, qué exigiría aprobación).

## Procedimiento para operadores

| Situación | Qué hacer |
|---|---|
| Cambio ordinario | Fusionar; la cadena publica live y production. Verificar `version.txt` y el estado `elephant-source/production`. |
| Production «NO publicado — bloqueado» | Abrir el resumen del trabajo: lista cada servicio, qué cambio protegido falta y qué aprobaciones existen. Pedir al propietario la aprobación de **ese** cambio y lanzar `aplicar-production` (o `desplegar-<servicio>`) con el commit exacto. |
| Parcial (un servicio atrás) | Tras aprobar y desplegar en un servicio, lo ordinario posterior ya no pide nada del mismo contenido: la siguiente publicación completa los demás. `estado` en production muestra cuál falta. |
| `desconocido` | Railway no respondió o falta metadato de commit: reintentar `estado`; no se publica a ciegas. |
| `regresion` | Alguien intenta publicar algo anterior a lo servido. Si se quiere volver atrás: `revertir-<servicio>`. |
| Fallo a medias | La vuelta atrás automática restaura el estado previo; `release-verify` dirá `desalineado` por servicio; relanzar. |
| Verificar | No fiarse del color: estado `elephant-source/production`, resumen del trabajo y comportamiento real del tenant. |

## Reglas que no cambian

Los controles de despliegue (`.github/workflows`, `scripts/deploy`, este documento) los fusiona el propietario. Sin fusiones automáticas desatendidas: no hay ninguna en este repositorio y las ventanas de Claude fusionan una a una, comprobando antes que el CI del SHA exacto está en `success`. Los clasificadores críticos (`CRITICAL_PATHS`, `CRITICAL_CODE`, migraciones, interruptores) no se tocan.

## Riesgos conocidos

- Las ejecuciones anteriores a este cambio no tienen el `run-name` fijo: sus aprobaciones no se reconocen (se pide una nueva; nunca se concede de más).
- Las aprobaciones se leen de las últimas 300 ejecuciones manuales correctas; si el historial se purga, vuelve a pedirse aprobación (bloqueo seguro).
- `concurrency` de GitHub conserva una sola ejecución en cola por grupo: una publicación antigua en cola puede descartarse; la guarda de regresión evita que una antigua pise a una nueva.
