# Autonomía de despliegues (Core y CRM)

Cómo publica Claude Code los cambios ordinarios de Elephant Source Core y Big Elephant CRM sin aprobación manual, y qué sigue exigiendo una autorización. Complementa [PROTOCOLO_PUBLICACION.md](PROTOCOLO_PUBLICACION.md).

## Diagnóstico (27/10/2026)

El 27/10 el CRM con las pantallas de Stripe (PR #68 y #70) llegó a live, pero no a `admin.bigelephant.es` (production). Hubo tres bloqueos de origen distinto.

| Origen | Bloqueo | Tipo |
|---|---|---|
| **GitHub Actions** (`scripts/deploy/esRailway.ts`, `crm-changes`) | El control del CRM buscaba palabras en **cualquier** línea cambiada, también en comentarios, con patrones muy amplios (`STRIPE_[A-Z_]+`, `SELF_SERVICE[A-Z_]*`). Un comentario de la PR #68 que citaba `SELF_SERVICE_PLANS` volvió protegido todo el CRM. El CRM **no lee ningún interruptor comercial**: los únicos reales están en su `Caddyfile`, que ya es extraordinario por ruta. | Falso positivo |
| **GitHub Actions** (Core, `extraordinaryChanges`) | Mismo criterio de palabras, aunque solo sobre `server/`, `shared/` y `client/` y sin pruebas. Un comentario podía bloquear el Core. | Falso positivo posible |
| **Claude Code** | El clasificador de seguridad de la sesión bloqueó `desplegar-crm` en production. Esa acción va al entorno protegido `elephant-source-production`, que exige aprobación. El bloqueo fue **correcto**: el error estaba en intentar la vía protegida. | Correcto |
| **Claude Code** (`.claude/settings.json` del proyecto) | Las reglas de permiso estaban mal formadas: varias reglas pegadas en una sola cadena que no coincide con ningún comando. | Configuración rota |
| **Railway** | Ninguno. Los tokens por entorno (`RAILWAY_TOKEN` en `elephant-source-live`, `-production-despliegue` y `-production`) y la clave de solo lectura del CRM (`CRM_DEPLOY_KEY`) funcionan. | — |

Además, en production faltaba comprobar qué sirve realmente el dominio. Un despliegue en verde no demostraba que `admin.bigelephant.es` tuviera el commit nuevo.

## Modelo

**Claude Code nunca despliega production directamente.** Integra en `integration/elephant-source` y la cadena automática hace el resto con las mismas barreras para todos:

```
fusión en integration/elephant-source (Core)             ─┐
o «gh workflow run ci.yml --ref integration/elephant-source» ├─▶ CI: suites bloqueantes y control de secretos
  (tras fusionar solo en el CRM)                         ─┘
        │
        ▼
Publicar en live      Core + último CRM de su integración → comprobaciones funcionales
                      → estado elephant-source/live y elephant-source/crm-live = <commit del CRM>
        │
        ▼
Publicar en production (ordinario, entorno elephant-source-production-despliegue, sin aprobación)
  · solo el MISMO commit del Core que superó live, y el CRM que se probó con él (nunca versiones incompatibles)
  · barrera de cambios extraordinarios por cambios EFECTIVOS (abajo)
  · copia verificada y migraciones aditivas antes del código
  · despliegue → comprobaciones funcionales → el dominio real sirve el commit del CRM (/version.txt)
  · si algo falla: vuelta atrás automática al despliegue anterior
```

- **Pruebas antes de publicar:** suites bloqueantes del CI del Core. El CRM se construye y prueba en su CI antes de fusionar, y `vite build` se repite al desplegar.
- **Salud después:** `FUNCTIONAL_CHECKS` y `CRM_CHECKS` (salud de la pasarela, `/healthz` y portada) y el sello de versión del CRM.
- **Recuperación:** `publish` y `publish-crm` vuelven atrás solos si un servicio no queda en `SUCCESS`, si fallan las comprobaciones o si el dominio no sirve el commit. A mano están `revertir-<servicio>`, que en production es ordinario.
- **Registro:** cada despliegue de Railway lleva «`<repositorio> <commit>`»; los estados de commit `elephant-source/live`, `crm-live` y `web-live` enlazan con la ejecución; la ejecución de Actions guarda autor, commit y resultado.
- **Sandbox y producción separados:** live usa Stripe de pruebas y production el suyo, con tokens y entornos de GitHub distintos.

## Clasificación por cambios efectivos

Funciones `effectiveChangedLines`, `externalLockedChanges` y `coreLockedChanges` en `scripts/deploy/esRailwayLib.ts`.

1. No cuentan los ficheros que no se ejecutan: documentación, imágenes, pruebas, e2e y `env.example`.
2. En cada línea cambiada se quitan los comentarios (`//`, `/* */`, JSDoc, `#`, `<!-- -->`). Lo que va dentro de una cadena sí cuenta.
3. **Core:** un interruptor bloqueado (`CP_*_ENABLED`, `CP_STRIPE_MODE`, `MAIL_*`, `LLM_*`…) en código o en una cadena es extraordinario.
4. **CRM y web:** es extraordinario solo si el código **lee** un interruptor (`import.meta.env.X`, `process.env.X`, `env.X`) o si el nombre aparece en un fichero de configuración (`.env*`, `vite.config.*`, `Dockerfile*`, `railway*`, `index.html`). Una constante con un nombre parecido, como `STRIPE_LIVE_PROVIDER`, o un texto, no lo son.
5. Siguen siendo extraordinarios por ruta, igual que antes: la pasarela (`Caddyfile`), la política del correo real y las migraciones no aditivas.

Validado con el diff real que se bloqueó, CRM `55760dd..86e1dfc`. La regla anterior lo marcaba por un comentario; la nueva lo deja como ordinario. Una lectura real de `VITE_PUBLIC_CHECKOUT_ENABLED` añadida al mismo diff sigue siendo extraordinaria. Las pruebas están en `server/clasificacionEfectiva.test.ts`.

## Qué sigue exigiendo autorización (sin cambios)

- **Entorno `elephant-source-production`, con aprobación del propietario:**
  - migraciones destructivas;
  - interruptores de cobros, autoservicio, correo real e IA;
  - variables y secretos;
  - la pasarela de accesos;
  - acciones `desplegar-*`, `aplicar-production` y similares.
- **Fusionar cambios en los propios controles de despliegue** (`.github/workflows`, `scripts/deploy`): los fusiona el propietario.
- **Cobros reales, Stripe live y datos de clientes:** decisión del propietario.

## Permisos de Claude Code

Configuración recomendada: [claude-code-settings.json](claude-code-settings.json). Va en `.claude/settings.json` del repositorio del Core y sustituye las reglas mal formadas actuales.

- **Permite:**
  - el ciclo normal de git y PR;
  - consultar ejecuciones;
  - relanzar el CI de `integration/elephant-source`, que es la vía ordinaria hacia production;
  - las acciones de live.
- **Niega:**
  - forzar pushes y borrar etiquetas;
  - lanzar directamente acciones de `desplegar-*` o `aplicar-production` en production. Esas siguen el procedimiento protegido.

Claude Code no se concede permisos a sí mismo: los aplica el propietario.

## Operación

| Situación | Qué hace Claude Code |
|---|---|
| Cambio en el Core | PR → CI → fusión. live y production se publican solos |
| Cambio solo en el CRM | PR del CRM → fusión → `gh workflow run ci.yml --ref integration/elephant-source` |
| El aviso «exige el procedimiento protegido» | Explica qué cambio efectivo lo exige y pide la aprobación de esa ejecución concreta |
| Fallo en production | La vuelta atrás es automática. Si hace falta, `revertir-<servicio>` en production, que es ordinario |
| Comprobar el dominio | `curl https://admin.bigelephant.es/version.txt` → commit del CRM |

**Opcional:** para que una fusión en el CRM publique sola, sin relanzar el CI a mano, el repositorio del CRM necesitaría un flujo que lance el CI del Core. Requiere un token con `actions:write` sobre el Core guardado como secreto del CRM; es una decisión del propietario.
