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
| **Ordinario de production sin aprobación** | Solo lectura, copias y revisiones auditadas: `estado`, `verificar-token`, `comprobar-salud`, `diagnostico-almacenamiento`, `copia-de-seguridad`, `verificar-copia`, simulaciones y verificación de migraciones, `huerfanos`, estados del correo y de los avisos, `medicion-comprobar`, `catalogo-revision(-aplicar)` (lista `ORDINARY_PRODUCTION_ACTIONS`) | Manual | `elephant-source-production-despliegue` | No |
| **Extraordinario** | Migraciones destructivas, variables y secretos, correo real, almacenamiento, aplicar a mano migraciones o restauraciones, y cambios críticos | Resto de acciones (`preparar-production`, `aplicar-production`, `migraciones-*-aplicar`, `almacenamiento-referencias`, `correo-acceso-activar`, `avisos-solicitudes-activar`, `desplegar-*`…) | `elephant-source-production` | **Sí, obligatoria** |

**Orden permanente del propietario (26/10/2026):** lo ordinario se publica en production sin intervención humana. Lo extraordinario conserva la aprobación del propietario.

## Barreras del despliegue ordinario en production

1. **Mismo commit, CI en verde.** El commit debe tener en verde las suites bloqueantes del CI.
2. **Mismo commit, superado en live.** El commit debe tener el estado `elephant-source/live` = `success`. Solo lo marca la publicación automática en live, cuando terminan bien el despliegue y las comprobaciones funcionales.
3. **Nada extraordinario.** Se comparan el commit que sirve production y el que se quiere publicar (`extraordinaryChanges`). El despliegue se detiene si el cambio trae alguna de estas cosas:
   - una migración **no aditiva**: borra, vacía, reescribe, renombra o cambia el tipo de algo, o contiene una sentencia no reconocida como aditiva (`destructiveMigration`);
   - la política del correo real (`server/mail/policy.ts`);
   - alguna lectura de un interruptor de funciones bloqueadas (`CP_*_ENABLED`, `CP_STRIPE_MODE`, `MAIL_MODE`, `MAIL_LIVE_AUTHORIZED`, `MAIL_SANDBOX_ALLOWLIST`, `LLM_*`, `ES_AI_*`, `IMAGE_MODEL`, `TENANT_MODE`) en código efectivo: los comentarios, la documentación y las pruebas no cuentan ([AUTONOMIA_DESPLIEGUES.md](AUTONOMIA_DESPLIEGUES.md));
   - en el CRM o la web, la pasarela de seguridad (`Caddyfile`) o una lectura real de los interruptores de cobros, autoservicio y Stripe (o su nombre en un fichero de configuración).

   Si no se sabe qué versión está activa, también se considera extraordinario.

   Son **ordinarios**:
   - las dependencias, la compilación y las imágenes (`deploy/`, `Dockerfile*`), porque ya se probaron en live y tienen vuelta atrás automática;
   - las migraciones **aditivas** (crear tablas, añadir columnas o índices e insertar datos nuevos).
4. **Migraciones aditivas, automáticas y controladas.** Antes de desplegar el código:
   1. restore-drill pasa a ese mismo commit;
   2. copia de seguridad y verificación de la copia en el bucket;
   3. migraciones de registro y CRM;
   4. migraciones de las empresas: canario (`t3-empresa-demo-elephant-01`) con comprobación, después Skibox y después el resto, con comprobación final.

   Cualquier fallo detiene la publicación, y production sigue con la versión anterior.
5. **No toca configuración.** Sube el código y aplica las migraciones aditivas. No toca variables, secretos, dominios ni servicios, y los bloqueos comerciales siguen como estén.
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

## Incidencia 21/11/2026: la publicación «solo CRM» sella live y puede dejar sin publicar el Core

**Qué pasó.** Tras fusionar #919 (cambio de cliente del Core, `95b253a6`), los CI del CRM lanzaron `publicacion.yml` con `solo: crm`. Esa ejecución publica el CRM y pone `elephant-source/live=success` en el commit **sin esperar al CI del Core ni publicar el Core**. Cuando Railway terminó el despliegue de live, `disparar` vio «ya superó live» y no lanzó la publicación completa. Resultado: el run salió en verde, `elephant-source/live` en success, y production seguía sirviendo el commit anterior (`611ead4f`) en Core, controlplane y core-gateway. Se repitió con el siguiente commit (`2310761b`).

**Cómo se detecta (no fiarse del color ni del estado de live).**
1. En el log de la publicación: `ES_SERVICES: crm` / `solo: crm` en las entradas indica que fue parcial.
2. `gh workflow run deploy-elephant-source.yml --ref integration/elephant-source -f environment=production -f action=estado -f confirm=production` (ordinaria, solo lectura): las líneas «core / controlplane / core-gateway: … sirve <sha>» son el SHA realmente servido. Debe coincidir con el commit fusionado.
3. El estado `elephant-source/production` solo aparece si production se publicó completo.

**Cómo se completa por la vía ordinaria.** Cuando el CI del commit (`Suites del Core multiempresa`) esté en verde y siga siendo el último de la rama: `gh workflow run publicacion.yml --ref integration/elephant-source` (es exactamente lo que ejecuta `disparar`). No es una acción protegida, no crea ramas y no se salta ninguna barrera: `publicar` vuelve a comprobar CI, live y el plan de production.

**Regla para próximos desarrollos.** Tras fusionar cualquier cambio del Core, la publicación no está completa hasta que `estado` en production muestre el SHA fusionado en los tres servicios. Un run «solo CRM» en verde nunca lo demuestra.

**Mejora pendiente (cambio de código, no hecho aquí).** Que `solo: crm|web` no escriba `elephant-source/live` (usar solo `crm-live`), o que `disparar` ignore ese sello cuando el Core del commit no figure como publicado.
