# Plan de publicación de Elephant Source (cuando Railway vuelva a estar operativo)

Un único plan, en orden. Cada paso es **una ejecución** del flujo «Despliegue Elephant Source» (GitHub → Actions → Run workflow, rama `integration/elephant-source`), salvo los marcados «manual». Después de cada paso, comprobar el resultado antes de seguir. **Si un paso falla, no se encadena otro: se aplica su reversión y se investiga** (CLAUDE.md, reglas operativas).

`MAIL_MODE` sigue en `off`, Checkout desactivado y el portal de facturación apagado durante toda la publicación. No hay cambios de DNS.

## Fase 0 — Preparación (manual, una sola vez)

1. **Token de proyecto de Railway** por entorno (Railway → proyecto Elephant Source → Settings → Tokens → *Project token*, entorno `live`; repetir para `production`). Es una credencial nueva: la crea el propietario.
2. **Entornos protegidos en GitHub** (repositorio `nayade_experiences_platform` → Settings → Environments):
   - `elephant-source-live` y `elephant-source-production`;
   - revisores obligatorios: el propietario;
   - rama permitida: solo `integration/elephant-source`;
   - secreto `RAILWAY_TOKEN` con el token del paso 1 de ese entorno.
3. **Comprobar en qué entorno está cada dominio.** `www`, `app` y `admin.bigelephant.es` apuntan al entorno **production**. Este plan se ejecuta **primero en `live`** (validación completa) y, si todo es correcto, **se repite en `production`**.

## Fase 1 — Estado y puntos de vuelta atrás

| # | Acción | Comprobar |
|---|---|---|
| 1.1 | `verificar-token` | «Token del proyecto de Elephant Source, entorno «live»» y la lista de servicios |
| 1.2 | `estado` | Anotar el despliegue activo y el commit de cada servicio (`controlplane`, `core`, `core-gateway`, `backup-job`, `restore-drill`): son los **puntos de vuelta atrás** |

## Fase 2 — Copia de seguridad y herramientas de migración

| # | Acción | Comprobar | Si falla |
|---|---|---|---|
| 2.1 | `desplegar-restore-drill` | `SUCCESS`; el arranque queda en `backup-job list` (sin tráfico de clientes) | Redesplegar el commit anotado en 1.2 (`commit`) |
| 2.2 | `desplegar-backup-job` | `SUCCESS` | Igual |
| 2.3 | `copia-de-seguridad` | El registro termina sin errores y **cada empresa** tiene una copia de hoy (`backup-job list` en el registro del paso) | **No seguir.** Revisar el destino de las copias; sin copia verificada no se migra |

## Fase 3 — Migraciones de las empresas (0011, 0012, 0013 y las que estén pendientes)

| # | Acción | Comprobar | Si falla |
|---|---|---|---|
| 3.1 | `migraciones-simulacion` | Lista de pendientes por empresa. Revisar que solo aparecen migraciones conocidas (`db/migrations`) | No seguir |
| 3.2 | `migraciones-aplicar` (opcional: `only` = una empresa interna primero) | `migrated` o `up_to_date` en todas; el canario va primero y, si falla, no se toca ninguna más | Empresa afectada: revertir con su `.down.sql` (`scripts/db/migrate.ts down`), o restaurar la copia de 2.3 (`restore-tenant`, manual) |
| 3.3 | `verificar-migraciones` | `ok: true` y `faltan: []` en **todas** las empresas (el paso falla si alguna no) | Volver a 3.2 solo para las que falten (`only`) |

Las migraciones son aditivas: el código anterior funciona con ellas aplicadas. Por eso el orden es primero migrar y después desplegar el código, y la vuelta atrás del código no exige revertir migraciones.

## Fase 4 — Servicios

| # | Acción | Comprobar en el registro del paso | Si falla |
|---|---|---|---|
| 4.1 | `desplegar-controlplane` | `SUCCESS`; sin errores de arranque; montados comercio, Stripe y portal **apagado**; Checkout desactivado | Redesplegar el commit de 1.2 |
| 4.2 | `desplegar-core` | `SUCCESS`; `Server running on http://localhost:3000/`; tareas registrándose, incluida `data-export` | Redesplegar el commit de 1.2. La exportación queda en el estado anterior; las migraciones no se revierten |
| 4.3 | `desplegar-core-gateway` | `SUCCESS`; página central con mostrar/ocultar contraseña | Redesplegar el commit de 1.2 |
| 4.4 | **CRM (manual u otro flujo)**: repositorio `big-elephant-crm`, rama `integration/elephant-source`, commit `1bf6de1` o posterior | `SUCCESS`; «Comunicaciones» visible con el grupo «Datos de la empresa» | Redesplegar el anterior |

## Fase 5 — Verificaciones

1. `comprobar-salud` → `https://app.bigelephant.es/` responde 200. En `live`, con el dominio de pruebas.
2. **Manual, en una empresa interna de pruebas:**
   - solicitar una exportación y comprobar que pasa por «En cola», «Generando» y «Lista»;
   - descargar el ZIP y abrir `LEEME.txt` y `manifest.json` (`complete: true`);
   - en la bandeja de la empresa, el aviso «Exportación disponible» queda registrado como omitido (`MAIL_MODE=off`);
   - el enlace caduca a las 24 h.
3. **Manual:**
   - acceso de dos empresas con su marca;
   - recuperación de contraseña;
   - acceso central.
4. **Manual:** verificar el webhook de Postmark 26051423 (pendiente desde la caída de Railway).
5. Repetir la fase 1 (`estado`) y anotar los nuevos commits activos.

## Fase 6 — Producción

Repetir las fases 1 a 5 con `environment = production`, con su token, después de terminar `live` sin incidencias.

## Reversión rápida (resumen)

- **Código:** la acción del servicio con `commit` = el anotado en 1.2. El flujo comprueba que ese commit pertenece a `integration/elephant-source`.
- **Migraciones:** normalmente no hace falta, porque son aditivas. Si una empresa queda mal: `.down.sql` de la migración o `restore-tenant` desde la copia de 2.3.
- **Nunca:** forzar despliegues, saltarse una fase o desplegar sin copia verificada.
