# Validación funcional real del CMS en live

Prueba real, en el entorno desplegado `live`, de que cada empresa gestiona su propia web y de que sus cambios aparecen **solo** en ella:

1. Se crean dos empresas de prueba nuevas, A y B, con la plantilla «generico».
2. A edita su portada y publica una página nueva.
3. Se comprueba por la API pública, por el HTML, por el sitemap y con un navegador real (Chromium) que los cambios aparecen en la web de A y en ninguna otra.
4. Se comprueba también que los textos legales de plantilla nacen en borrador.

Hasta que esta prueba se supere en `live`, la funcionalidad no se da por terminada.

- Script: `scripts/railway/validar-cms-live.cjs`. Reutiliza la sesión de operador de `scripts/railway/cp.cjs`.
- Por defecto solo hace comprobaciones previas y no escribe nada. Con `ES_APLICAR=si` crea las empresas y ejecuta la prueba.
- No envía correos: el alta asistida devuelve la invitación al operador, y el script la usa para definir una contraseña aleatoria que no se imprime.
- No usa Stripe ni cobros. No toca production ni Náyade.

## Requisitos previos

| # | Requisito | Quién | Cómo comprobarlo |
|---|---|---|---|
| 1 | Desplegar en `live` el Core y el plano de control con los PR de la web multiempresa (#268 en adelante: contenido de páginas, legales, ubicaciones, grupos y portada) | Jorge aprueba el despliegue (entorno `elephant-source-live`, con revisores obligatorios) | Workflow `deploy-elephant-source.yml` con entorno `live` y acciones `desplegar-controlplane` y `desplegar-core`. En los registros: `Server running on http://localhost:3000/` |
| 2 | Variables S3 de `live` corregidas | Jorge, en Railway | Lista del diagnóstico 39822663135, ya entregada |
| 3 | `CP_PLATFORM_DOMAIN` de `live` con DNS comodín hacia el `core-gateway` de `live` | Jorge, en Railway y DNS | Lo indica el primer paso del script (`el comodín *.dominio llega a la pasarela del Core`) |
| 4 | Que la pasarela del Core sirva sin autenticación básica los hosts de las empresas de prueba, o que se ejecute desde un origen autorizado | Configuración de `PUBLIC_HOSTS` de la pasarela | Lo indica el script: un 401 en la web de A indica que falta |
| 5 | Operador `jorge` con verificación en dos pasos | — | `ES_TOTP` o se pide por la terminal |
| 6 | Si `live` aplica licencias por capacidad: un plan con el editor web | — | `ES_PLAN=<plan>`. Sin él, el paso «A: portada guardada» falla con un código de licencia |

## Ejecución

```bash
# Comprobaciones previas (no escribe nada)
ES_ENV=live ES_CP_BASE=https://elephant-source-crm-live.up.railway.app ES_PRIVATE_DIR=<carpeta privada> \
  node scripts/railway/validar-cms-live.cjs

# Prueba real (crea dos empresas de prueba en live)
ES_ENV=live ES_CP_BASE=... ES_PRIVATE_DIR=... ES_APLICAR=si [ES_PLAN=<plan>] \
  node scripts/railway/validar-cms-live.cjs

# Al terminar la revisión, archivarlas (solo admite identificadores cms-prueba-…)
ES_ENV=live ES_CP_BASE=... ES_PRIVATE_DIR=... ES_ARCHIVAR=<empresaA>,<empresaB> \
  node scripts/railway/validar-cms-live.cjs
```

## Qué se comprueba

| Paso | Comprobación |
|---|---|
| Alta | Identificador libre, alta completada, invitación devuelta al operador, contraseña definida e inicio de sesión del administrador. Se hace con A y con B |
| Plantilla | La portada de plantilla está publicada; el aviso legal y la privacidad están en borrador y no se sirven; el pie no los enlaza |
| Edición | A guarda su portada y publica `novedades-<código>`, con un texto único de esta ejecución |
| API pública | A sirve su texto nuevo en «inicio» y su página nueva. B no contiene nada de A, ni en la web ni en su panel (`cms.getPages`) |
| HTML y SEO | El HTML de B no lleva la marca de A. La página nueva está en el sitemap de A y no en el de B |
| Navegador real | La portada y la página nueva de A muestran el texto nuevo; la web de B, no |

El script termina con código 0 solo si todas las comprobaciones pasan, e imprime los dos identificadores para archivarlos.

## Limpieza

No hay borrado físico de empresas: la supresión es manual y exige doble aprobación (`CICLO_VIDA_TENANT.md`). Las empresas de prueba se **archivan** (`ES_ARCHIVAR`). Su base de datos se conserva hasta que exista la supresión.

## Resultado

Pendiente de ejecutar en `live`. Faltan los requisitos 1 a 4.
