# Autonomía de despliegues (Core y CRM) — procedimiento permanente

**Procedimiento permanente de Elephant Source**, aprobado por el propietario el 27/10/2026. Vale para todas las ventanas de Claude Code que trabajen en el Core (`nayade_experiences_platform`, rama `integration/elephant-source`) o en el CRM (`big-elephant-crm`). Complementa [PROTOCOLO_PUBLICACION.md](PROTOCOLO_PUBLICACION.md).

**En una frase:** Claude Code integra en `integration/elephant-source` y la cadena automática publica en live y en production con pruebas, barreras, verificación del dominio real y vuelta atrás. Solo interviene el propietario para lo extraordinario.

## Reglas para cada ventana

1. **Nunca se despliega production a mano.** Se fusiona en `integration/elephant-source`; para un cambio que solo toca el CRM, se fusiona en el CRM y se relanza `gh workflow run ci.yml --ref integration/elephant-source`.
2. **Comprobar el resultado en el dominio real, no en GitHub:** `curl -sS https://admin.bigelephant.es/version.txt` debe devolver el commit del CRM. Live (`elephant-source-crm-live.up.railway.app`) NO es el administrador real.
3. **Si production avisa «exige el procedimiento protegido»:** explicar al propietario qué cambio efectivo lo exige y pedir la aprobación de esa ejecución concreta. Nunca reformular el código para esquivar el control.
4. **Compatibilidad Core ↔ CRM:** el Core debe seguir sirviendo al CRM que está en production. Se amplía antes de retirar: primero endpoints nuevos y opcionales, y se retiran solo cuando ningún CRM en servicio los usa. Production puede quedar un tiempo con un Core nuevo y el CRM anterior cuando el CRM espera una aprobación.
5. **Cambios en los controles de despliegue** (`.github/workflows`, `scripts/deploy`, este documento) y en `.claude/settings.json`: los fusiona el propietario.

## Diagnóstico que dio origen al procedimiento (27/10/2026)

| Origen | Bloqueo | Resolución |
|---|---|---|
| GitHub Actions, control del CRM | Buscaba palabras en cualquier línea, comentarios incluidos (`STRIPE_[A-Z_]+`, `SELF_SERVICE[A-Z_]*`). Un comentario con `SELF_SERVICE_PLANS` bloqueó el CRM de las PR #68 y #70. El CRM no lee ningún interruptor comercial. | Clasificación por cambios efectivos |
| GitHub Actions, control del Core | Mismo criterio de palabras: un comentario podía bloquearlo. | Clasificación por cambios efectivos |
| GitHub Actions, cobertura | Solo protegía interruptores por nombre. Un cambio real en la firma de los webhooks, la autorización o un borrado no la activaba. | Puntos críticos (abajo) |
| GitHub Actions, emparejamiento | Si el CRM fallaba tras publicar el Core, el CRM volvía atrás y el Core no. | Vuelta atrás emparejada |
| Claude Code, control de la sesión | Bloqueó `desplegar-crm` en production. Fue correcto: es la vía protegida. | Claude Code ya no usa esa vía |
| Claude Code, `.claude/settings.json` | Reglas mal formadas, que no coincidían con nada. El control de seguridad no deja que Claude Code se escriba sus propios permisos. | Propuesta en `claude-code-settings.json`; la aplica el propietario |
| Railway | Ninguno. | — |

## Cadena automática

```
fusión en integration/elephant-source (Core)              ─┐
o gh workflow run ci.yml --ref integration/elephant-source ├─▶ CI: suites bloqueantes y control de secretos
  (tras fusionar solo en el CRM)                          ─┘
        │
        ▼
Publicar en live — Core (solo los servicios con cambios) y último CRM de su integración
                 → comprobaciones funcionales y sello /version.txt del CRM
                 → estados elephant-source/live y elephant-source/crm-live = <commit del CRM>
        │
        ▼
Publicar en production (ordinario, sin aprobación)
  · solo el MISMO commit del Core que superó live, y el CRM que se probó con él
  · barrera de cambios extraordinarios (abajo); si la hay, no publica y deja aviso
  · copia verificada y migraciones aditivas antes del código
  · Core → comprobaciones → CRM → comprobaciones → admin.bigelephant.es/version.txt = commit del CRM
  · si algo falla: vuelta atrás automática (emparejada: ver abajo)
```

- **Pruebas antes de publicar:** suites bloqueantes del CI del Core. El CRM se prueba y compila en su CI antes de fusionar, y `vite build` se repite al desplegar.
- **Salud después:** `FUNCTIONAL_CHECKS` y `CRM_CHECKS`, más el sello de versión del CRM en el dominio real.
- **Registro:** cada despliegue de Railway lleva «`<repositorio> <commit>`»; los estados de commit enlazan con la ejecución de Actions, que guarda autor, commit y resultado.
- **Sandbox y producción separados:** live usa Stripe de pruebas; production tiene sus propios tokens, entornos de GitHub y cuenta.

## Vuelta atrás y versiones emparejadas

| Fallo | Qué pasa |
|---|---|
| Un servicio del Core no queda en `SUCCESS` o fallan las comprobaciones | Todos los servicios del Core publicados en esa ejecución vuelven a su despliegue anterior. El CRM no se toca. |
| El CRM no queda en `SUCCESS`, fallan sus comprobaciones o el dominio no sirve su commit (`/version.txt`) | El CRM vuelve a su despliegue anterior **y** el Core publicado en esa misma ejecución también (`rollback-recorded`). Quedan el Core y el CRM que ya convivían. El commit no recibe el estado de live, así que production no lo publicará. |
| El CRM exige el procedimiento protegido | El Core se publica y el CRM sigue en el anterior (regla de compatibilidad 4). |
| Vuelta atrás manual | `revertir-<servicio>`, que en production es ordinario. Si se revierte el Core a un commit anterior al CRM en servicio, se revierten los dos. |

`/version.txt` es el commit del CRM, sellado en el export justo antes de subirlo; Vite lo copia a `dist`. Comprobado: una compilación con el sello produce `dist/version.txt` con el commit. En production el dominio corporativo no pasa por la autenticación básica, así que el fichero es público; en live se lee con `ES_GATEWAY_AUTH`. Una respuesta distinta, incluida la portada de la SPA cuando no existe, es un fallo.

## Qué es ordinario y qué es extraordinario

Se analizan **cambios efectivos**:

- No cuentan la documentación, las pruebas, los e2e, `env.example` ni los comentarios.
- Lo que va dentro de una cadena sí cuenta.

**Extraordinario: lo aprueba el propietario en el entorno `elephant-source-production`.**

| Qué | Cómo se detecta |
|---|---|
| Migraciones no aditivas | Contenido SQL (`destructiveMigration`) |
| Interruptores de funciones bloqueadas: cobros, autoservicio, correo real, IA, modo de Stripe | Nombre en código efectivo del Core (`coreLockedChanges`). En el CRM o la web, solo si se lee la variable o aparece en un fichero de configuración (`externalLockedChanges`) |
| Envolvente de **cobros**: modo live/test, claves, interruptores, política fiscal, firma de webhooks y elegibilidad | Ficheros `server/stripe/{config,liveReadiness,webhook,eligibility}.ts`. En cualquier fichero: `constructEvent`, `assertModeObject`, `livemode`, claves `sk_live_`/`rk_live_` |
| **Autorización:** permisos del plano de control, operadores, roles, MFA, sesiones, recuperación de contraseña, OAuth y RBAC | Ficheros de `CRITICAL_PATHS`. En cualquier fichero: **retirar** o cambiar el permiso de una comprobación (`requireScope("…")`, `requireRole`, `protectedProcedure`, `adminProcedure`, `ctx.user.role`) |
| **Seguridad:** bóveda y cifrado de credenciales, cifrado del registro, canal firmado de operaciones, guardas de endpoints públicos, saneado, control de secretos | Ficheros de `CRITICAL_PATHS` |
| **Operaciones destructivas** | `DROP TABLE/DATABASE/SCHEMA/USER`, `TRUNCATE`, `DELETE FROM`, `dropDatabase(`, `deleteTenant…(`, `purgeTenant…(`, borrado recursivo |
| Pasarela de accesos (`Caddyfile`) y política del correo real | Por ruta |

**Ordinario: se publica solo.**

- código e interfaces;
- flujos de Checkout, compras y suscripciones, que dependen de la envolvente protegida;
- rutas nuevas con permisos existentes;
- catálogos y dependencias, compilación e imágenes;
- migraciones aditivas.

**Medido sobre las últimas 60 fusiones de `integration/elephant-source`:** 6 habrían pedido aprobación, todas por algo sensible de verdad:

- el canal firmado de operaciones (#320, #350 y #352);
- la recuperación de contraseña (#344);
- las sesiones (#320, `localAuth.ts`);
- dos `DELETE FROM` nuevos en código (#329 y #334).

Las otras 54 se publican solas. El falso positivo del 27/10 (CRM `55760dd..86e1dfc`) pasa a ser ordinario, y una lectura real de `VITE_PUBLIC_CHECKOUT_ENABLED` añadida al mismo diff sigue siendo extraordinaria.

Pruebas: `server/clasificacionEfectiva.test.ts`, `server/publicacionContinua.test.ts` y `server/autonomiaProduction.test.ts`.

## Permisos de Claude Code

[claude-code-settings.json](claude-code-settings.json) es la configuración permanente. El propietario la copia a `.claude/settings.json`; el control de seguridad no deja que Claude Code se conceda permisos a sí mismo.

- **Permite sin preguntar:**
  - git (ramas, commits, fusiones, worktrees);
  - push de ramas `feat/`, `fix/`, `chore/`, `docs/` y `refactor/`;
  - pruebas y compilación;
  - PR: crear, revisar, comprobar y fusionar;
  - consultar ejecuciones;
  - relanzar el CI de `integration/elephant-source`;
  - las acciones de live;
  - en production, solo las acciones ordinarias: `publicar`, `estado`, `comprobar-salud` y `revertir-*`;
  - comprobar `admin.bigelephant.es/version.txt`.
- **Niega siempre:**
  - forzar o borrar ramas y etiquetas;
  - `git reset --hard`;
  - push directo a `main` o a `integration/elephant-source`;
  - `gh api -X DELETE`;
  - las acciones protegidas de production: `desplegar-*`, `aplicar-production`, `preparar-production`, `migraciones-*`, `correo-*`, `avisos-*`, `almacenamiento-*` y `medicion-preparar`.

Las reglas comparan el comando literal: hay que usar las formas exactas de la tabla siguiente.

| Operación | Comando |
|---|---|
| Publicar tras fusionar solo en el CRM | `gh workflow run ci.yml --ref integration/elephant-source` |
| Estado de production | `gh workflow run deploy-elephant-source.yml --ref integration/elephant-source -f environment=production -f action=estado -f confirm=production` |
| Revertir un servicio en production | `gh workflow run deploy-elephant-source.yml --ref integration/elephant-source -f environment=production -f action=revertir-crm -f confirm=production` |
| Verificar el CRM en el dominio real | `curl -sS https://admin.bigelephant.es/version.txt` |

**Opcional:** para que una fusión en el CRM publique sola, el repositorio del CRM necesitaría un flujo que lance el CI del Core. Requiere un token con `actions:write` sobre el Core guardado como secreto del CRM; es una decisión del propietario.

## Debilitamiento frente a salvaguardas nuevas (27/10/2026)

**Por qué hacía falta.** El Core #380 (clientes externos) no llegó solo a production. El motivo no fue su migración 0026, que es aditiva y ya entra por la vía ordinaria con copia verificada y canario. Lo frenaron dos reglas que marcaban la mera **aparición** de un patrón:

- cualquier `livemode` o `assertModeObject`, aunque se **añadieran** comprobaciones;
- cualquier lectura de un interruptor, aunque fuera uno **nuevo** que nace desactivado (`CP_EXTERNAL_LIVE_ENABLED`).

Ahora la clasificación compara las líneas quitadas con las añadidas (`weakenedLines` en `scripts/deploy/esRailwayLib.ts`).

| Cambio | Clasificación |
|---|---|
| Quitar o cambiar una línea existente con una salvaguarda de Stripe (`constructEvent`, `assertModeObject`, `livemode`) | Extraordinario |
| Añadir salvaguardas nuevas en operaciones nuevas | Ordinario |
| Quitar o cambiar una lectura existente de un interruptor bloqueado | Extraordinario |
| Añadir lecturas de un interruptor que **ya existía** en lo publicado | Extraordinario: puede encender algo con él |
| Añadir un interruptor **nuevo**, que no existía en lo publicado (`git grep` sobre el commit de production) | Ordinario: nace apagado, y activarlo exige su variable, que es una operación protegida aparte |
| Clave live de Stripe (`sk_live_`, `rk_live_`) en el código | Siempre extraordinario |
| Borrados (`DROP`, `TRUNCATE`, `DELETE FROM`, borrado de bases o empresas), migraciones no aditivas, autorización y seguridad | Sin cambios: extraordinario |

**Medición.**
- El #380 pasa a ordinario.
- De las últimas 60 fusiones, 6 siguen siendo extraordinarias, todas por algo sensible de verdad:
  - una migración que reescribe datos;
  - el canal firmado de operaciones;
  - la política del correo y la recuperación de contraseña;
  - dos `DELETE FROM` nuevos.

**Migraciones aditivas.** Las aplica la publicación **ordinaria** de production (`publicar`) cuando el SQL real solo crea tablas o índices, añade columnas o inserta datos (`destructiveMigration` analiza cada sentencia, no el nombre del fichero). Antes aplica la copia de seguridad verificada y el canario. Por eso `preparar-production` y `aplicar-production` siguen protegidas en GitHub y denegadas en `.claude/settings.json`: son la vía de **lo extraordinario**, y Claude Code no las necesita para lo ordinario.

**«Workflow dispatch failed» en GitHub.** El formulario «Run workflow» usa por defecto la rama `main`, cuya copia del workflow es antigua y no tiene esas acciones. Hay que elegir `integration/elephant-source` en «Use workflow from». Desde la línea de comandos: `--ref integration/elephant-source`.
