# Protocolo de publicación continua de Elephant Source

**Norma permanente** (autorizada por el propietario el 23/10/2026). Se aplica sin pedir autorizaciones rutinarias.

## Responsable técnico

Claude publica sin consultar todo lo ordinario (Diseña → Implementa → Prueba → Corrige → Fusiona → Publica → Verifica → Informa). Solo pide la aprobación protegida cuando la cadena la exige y nunca sortea un control de seguridad: ver «Protocolo de autonomía» en `CLAUDE.md`.

## Ramas

- Elephant Source se publica **solo** desde `integration/elephant-source`, siempre vía PR (CI en verde y fusión automática).
- `main` no publica Elephant Source, y los despliegues heredados de Náyade no se tocan.

## Tipos de despliegue

| Tipo | Qué hace | Cómo se lanza | Entorno de GitHub | Aprobación |
|---|---|---|---|---|
| **Live** | Publica controlplane, core y core-gateway en live. Si hay migraciones nuevas, antes hace una copia y las aplica en live | Automático en cada fusión en `integration/elephant-source`, cuando las suites bloqueantes del CI están en verde (job `publicar-live`) | `elephant-source-live` | No |
| **Production ordinario** | Publica controlplane, core, core-gateway, CRM y web comercial. Si el cambio exige el procedimiento protegido, no publica y deja un aviso (automático) o falla (manual) | **Automático** justo después de superar live (job `publicar-production` del CI, en cada fusión en `integration/elephant-source` o con `workflow_dispatch` del CI tras fusionar solo en el CRM), o manual con `Despliegue Elephant Source` → `publicar` · `production` | `elephant-source-production-despliegue` | No |
| **Vuelta atrás** | Devuelve un servicio a su despliegue anterior, ya construido | `revertir-controlplane`, `revertir-core` o `revertir-core-gateway` | El ordinario del entorno | No |
| **Protegido** | Migraciones, bases de datos, copias y restauraciones, infraestructura, variables y secretos, operaciones destructivas y cambios críticos | Resto de acciones (`preparar-production`, `aplicar-production`, `migraciones-*`, `almacenamiento-referencias`, `desplegar-*`…) | `elephant-source-production` | **Sí, obligatoria** |

## Barreras del despliegue ordinario en production

1. **Mismo commit, CI en verde.** El commit debe tener en verde las suites bloqueantes del CI.
2. **Mismo commit, superado en live.** El commit debe tener el estado `elephant-source/live` = `success`. Solo lo marca la publicación automática en live, cuando terminan bien el despliegue y las comprobaciones funcionales.
3. **Nada que exija el procedimiento protegido.** Se comparan el commit que sirve production y el que se quiere publicar. El despliegue se detiene si el cambio trae alguna de estas cosas:
   - migraciones o esquema (`db/`, `drizzle/`, `migrations/`, `scripts/db/`);
   - infraestructura (`deploy/`, `Dockerfile*`, `railway*.toml`, `Caddyfile`);
   - dependencias o configuración de compilación;
   - la política del correo real;
   - alguna lectura de un interruptor de funciones bloqueadas (`CP_*_ENABLED`, `CP_STRIPE_MODE`, `MAIL_MODE`, `MAIL_LIVE_AUTHORIZED`, `MAIL_SANDBOX_ALLOWLIST`, `LLM_*`, `ES_AI_*`, `IMAGE_MODEL`, `TENANT_MODE`).

   Si no se sabe qué versión está activa, también se considera protegido.
4. **Solo código.** Sube el código de los tres servicios. No toca variables, secretos, dominios, servicios ni bases de datos. `MAIL_MODE=off` y los bloqueos comerciales siguen como estén.
5. **Ramas.** El entorno solo admite `integration/elephant-source`, y el flujo comprueba además la rama y que el commit pertenece a ella.

## Comprobaciones funcionales y vuelta atrás

- **Live:** `readyz`, la home y el login de la empresa de prueba A, y `healthz` del CRM. Pasan por la pasarela, con el secreto `ES_GATEWAY_AUTH` del entorno live.
- **Production:** `readyz` y la home de `app.bigelephant.es`, y `readyz` y el login de Skibox.
- Si un servicio no queda en `SUCCESS` o falla una comprobación, **todos** los servicios publicados en esa ejecución vuelven a su despliegue anterior.
- Para volver atrás a mano: `revertir-<servicio>`. Reactiva el despliegue anterior del servicio sin compilar.

## CRM (repositorio privado `big-elephant-crm`)

- **Publicación ordinaria:** en cada publicación de live se despliega el último commit de `integration/elephant-source` del CRM y se anota cuál superó live (estado `elephant-source/crm-live` en el commit del Core). Production publica **solo ese commit** y solo si no toca `deploy/`, `Dockerfile`, `Caddyfile`, `railway.*` ni dependencias; si los toca, se omite con aviso (procedimiento protegido). Vuelta atrás automática si sus comprobaciones fallan.
- **Tras fusionar solo en el CRM:** lanza el CI de `integration/elephant-source` (`workflow_dispatch`) y la cadena hace live y production sin aprobación.

- **Acceso del flujo:** clave de despliegue de **solo lectura** registrada en `big-elephant-crm` («Despliegue Elephant Source (GitHub Actions, solo lectura)»). Su parte privada es el secreto `CRM_DEPLOY_KEY` de los entornos `elephant-source-live` y `elephant-source-production`, y no existe en ningún otro sitio. Para retirar el acceso, se borra la clave en *big-elephant-crm → Settings → Deploy keys*.
- **`desplegar-crm`:** despliega el último commit de `integration/elephant-source` del CRM, solo en el servicio `crm`. En live no requiere aprobación; en production es protegido (con aprobación).
- **`revertir-crm`:** vuelve al despliegue anterior del CRM.

## Web comercial (repositorio privado `bigelephant-web`)

- **Rama publicada:** `feat/elephant-web-portfolio`.
- **Publicación ordinaria:** mismo modelo que el CRM.
  - live despliega el último commit de esa rama y anota cuál superó live (estado `elephant-source/web-live`);
  - production publica **solo ese commit** y solo si no toca `deploy/`, `Dockerfile`, `Caddyfile`, `railway.*`, dependencias ni interruptores bloqueados (`PUBLIC_CHECKOUT_ENABLED`, autoservicio, Stripe, credenciales de la pasarela);
  - vuelta atrás automática si sus comprobaciones fallan (`www.bigelephant.es`).
- **Acceso del flujo:** clave de despliegue de **solo lectura** `WEB_DEPLOY_KEY` en los entornos. Sin ella, la web se omite con aviso y no bloquea el resto de la publicación.
- **`desplegar-web` / `revertir-web`:** despliegue protegido (production, con aprobación) y vuelta atrás. Ya no se usa `railway up` a mano.
- **Variables y pasarela:** el despliegue ordinario solo sube código; no cambia variables (`PUBLIC_CHECKOUT_ENABLED` sigue sin definir) ni la autenticación básica de live.

## Concurrencia

- Hay un solo despliegue a la vez por entorno (grupo `deploy-elephant-source-<entorno>`), compartido entre la publicación automática y las acciones manuales.
- El CI de `integration/elephant-source` no se cancela a medias: cada fusión termina su publicación. Si mientras tanto llegan varias fusiones, solo queda en espera la última.

## Cuándo hace falta el procedimiento protegido

Si `publicar` en production se detiene en la barrera 3, se usa el procedimiento protegido:
1. `preparar-production`: copia, verificación, prueba de restauración y simulación.
2. `aplicar-production`: requiere la aprobación del propietario en GitHub.

Después, los despliegues vuelven a ser ordinarios.
