# Plan de publicación de Elephant Source

Un único plan, en orden, para cuando Railway vuelva a estar operativo. Cada paso de las fases 1 a 5 es **una ejecución** del flujo «Despliegue Elephant Source» (GitHub → Actions → Run workflow, rama `integration/elephant-source`). Los pasos marcados «manual» los hace una persona.

**Regla general (CLAUDE.md):** después de cada paso se comprueba su resultado. Si un paso cumple un **criterio de parada**:
- no se encadena otro;
- se aplica su recuperación;
- se investiga en local.

Durante toda la publicación:
- `MAIL_MODE=off`;
- Checkout desactivado;
- portal de facturación apagado;
- sin cambios de DNS;
- ningún secreto en el código ni en los registros.

## Dependencias

```
Fase 0 (personas) ──► Fase 1 (estado) ──► Fase 2 (copia) ──► Fase 3 (migraciones) ──► Fase 4 (servicios) ──► Fase 5 (verificación)
                                                                                                                  │
                                                                                         live sin incidencias ──► Fase 6 (production, con aprobación)
```

- Las migraciones (fase 3) necesitan el código nuevo en `restore-drill` (2.1) y una copia verificada (2.3).
- El código nuevo (fase 4) necesita las migraciones verificadas (3.5). Son aditivas: el código anterior funciona con ellas, así que **primero se migra y después se despliega**, y volver atrás el código no exige revertir migraciones.
- `production` (clientes comerciales) solo después de terminar `live` y con aprobación humana en GitHub.

## Fase 0 — Preparación (manual, una sola vez)

| # | Acción (persona) | Criterio de aceptación |
|---|---|---|
| 0.1 | Crear un **token de proyecto** de Railway por entorno (proyecto Elephant Source → Settings → Tokens → *Project token*; uno para `live` y otro para `production`). Es una credencial nueva: la crea el propietario | Cada token solo ve su proyecto y su entorno |
| 0.2 | En GitHub (repositorio `nayade_experiences_platform` → Settings → Environments), crear `elephant-source-live` y `elephant-source-production`: secreto `RAILWAY_TOKEN` de su entorno, rama permitida solo `integration/elephant-source` y **revisores obligatorios** (el propietario). En `production` la aprobación es la autorización de producción comercial | Una ejecución queda «Waiting for review» hasta aprobarla |
| 0.3 | **Watch paths de Náyade** (su servicio en Railway → Settings → Watch Paths, configuración oficial; sin tocar su `railway.toml`). Los patrones de `docs/elephant-source/railway/watch-paths-nayade.txt`, uno por línea: `**`, `!/.github`, `!/.github/**` | Ver 0.4 |
| 0.4 | **Verificar la exclusión antes de confiar en ella**, sin tocar Náyade: un servicio de PRUEBA conectado al mismo repositorio, a una rama de pruebas y con esas mismas watch paths:<br>a) commit que solo cambia `.github/**` → **no** crea despliegue (aparece como omitido);<br>b) commit que cambia `server/` → **sí** despliega;<br>c) commit mixto (`.github` + `server`) → **sí** despliega.<br>Después, borrar el servicio de prueba y la rama | Los tres resultados como se indican. **Parada** si a) despliega o si b)/c) no: Railway no aplica la semántica documentada; no seguir con 0.5 |
| 0.5 | Con 0.3 y 0.4 correctos: llevar **únicamente** `.github/workflows/deploy-elephant-source.yml` a `main` (GitHub solo permite lanzar a mano flujos que estén en la rama por defecto) | En Railway, Náyade **no** crea despliegue por ese commit. Si lo crea: verificar que arranca limpio (mismo código) y quitar las watch paths hasta revisarlo |
| 0.6 | Confirmar a qué entorno apunta cada dominio (`www`, `app` y `admin.bigelephant.es` → `production`) | Anotado |

Hasta 0.5 el flujo está integrado en `integration/elephant-source` pero no se puede lanzar. No se crean etiquetas de despliegue.

> Comprobación previa ya hecha: las watch paths se validaron con la implementación de referencia de la sintaxis gitignore (`git check-ignore`) y con el historial real de `main` (`server/railwayWatchPaths.test.ts`; 399 commits revisados a mano: 0 que toquen código dejarían de desplegar). Ojo: el patrón «obvio» `** + !/.github/**` **no** excluye nada con esa sintaxis, porque no se puede reincluir un fichero cuyo directorio ya coincide.

## Pruebas previas (hechas en local; repetir si cambia el código de migraciones)

- **Ensayo completo** en un MySQL aislado con datos anonimizados (`server/ensayoMigracionExportacion.mysql.test.ts`):
  - empresas con el esquema anterior a la exportación (hasta 0010) y clientes/leads ficticios;
  - copia cifrada (`backup-job`);
  - simulación: pendientes exactamente 0011, 0012 y 0013;
  - aplicación con canario;
  - verificación de esquema (`check-data-exports`), datos de negocio idénticos (`CHECKSUM TABLE`) y exportación funcionando;
  - segunda aplicación: `up_to_date`;
  - reversión A con `scripts/db/migrate.ts down --steps 3` y nueva aplicación;
  - reversión B restaurando la copia (`restoreTenant --switch`): esquema y datos de antes.
- El ensayo descubrió y corrigió un fallo: `migrate.ts down` se negaba a operar en las bases de las empresas por el registro `0000_baseline` del aprovisionamiento.
- Suites MySQL de exportación (de punta a punta, retirada a los 7 días, trabajo asíncrono).

## Fase 1 — Estado y puntos de vuelta atrás (`environment = live`)

| # | Acción del flujo | Comprobar | Parada / recuperación |
|---|---|---|---|
| 1.1 | `verificar-token` | «Token del proyecto de Elephant Source, entorno «live»» y la lista de servicios | **Parada** si es otro proyecto o entorno: revisar el secreto del entorno de GitHub |
| 1.2 | `estado` | Despliegue activo y commit de cada servicio (`controlplane`, `core`, `core-gateway`, `backup-job`, `restore-drill`). **Anotarlos**: son los puntos de vuelta atrás | **Parada** si un servicio no tiene despliegue activo: investigar antes de cambiar nada |

## Fase 2 — Herramientas y copia de seguridad

| # | Acción | Comprobar | Parada / recuperación |
|---|---|---|---|
| 2.1 | `desplegar-restore-drill` | `SUCCESS`; el arranque queda en `backup-job list` (sin tráfico de clientes) | Fallo: `desplegar-restore-drill` con el commit de 1.2 |
| 2.2 | `desplegar-backup-job` | `SUCCESS` | Igual, con su commit de 1.2 |
| 2.3 | `copia-de-seguridad` | Sin errores y **cada empresa** con una copia de hoy | **Parada:** sin copia verificada de todas no se migra. Revisar el destino de las copias |

## Fase 3 — Migraciones de las empresas

| # | Acción | Comprobar | Parada / recuperación |
|---|---|---|---|
| 3.1 | `migraciones-simulacion` | Pendientes por empresa: solo migraciones de `db/migrations` (0011–0013 en las anteriores a la exportación) | **Parada** si aparece algo inesperado |
| 3.2 | `migraciones-aplicar` con `only` = **una empresa interna** | `migrated` | **Parada** si falla. Recuperar esa empresa (ver «Recuperación») |
| 3.3 | `verificar-migraciones` con `only` = esa empresa | `ok: true`, `faltan: []` | Igual que 3.2 |
| 3.4 | `migraciones-aplicar` (todas; el canario automático va primero y, si falla, no se toca ninguna más) | `migrated`/`up_to_date` en todas | **Parada** al primer fallo. Recuperar las afectadas |
| 3.5 | `verificar-migraciones` (todas) | `ok: true` en todas; el paso falla si alguna no | Repetir 3.4 solo para las que falten (`only`) |

## Fase 4 — Servicios

| # | Acción | Comprobar en el registro | Parada / recuperación |
|---|---|---|---|
| 4.1 | `desplegar-controlplane` | `SUCCESS`; arranque limpio; portal **apagado**; Checkout desactivado | Redesplegar el commit de 1.2 |
| 4.2 | `desplegar-core` | `SUCCESS`; `Server running on http://localhost:3000/`; tareas registrándose, incluida `data-export` | Redesplegar el commit de 1.2. Las migraciones no se revierten (aditivas) |
| 4.3 | `desplegar-core-gateway` | `SUCCESS`; página central nueva | Redesplegar el commit de 1.2 |
| 4.4 | CRM (repositorio `big-elephant-crm`, rama `integration/elephant-source`, `1bf6de1` o posterior; manual) | `SUCCESS`; «Comunicaciones» con «Datos de la empresa» | Redesplegar el anterior |

## Fase 5 — Verificación

1. `comprobar-salud` (en `live`, con su dominio de pruebas).
2. **Manual, en una empresa interna:**
   - solicitar una exportación y ver que pasa por «En cola», «Generando» y «Lista»;
   - descargar el ZIP y comprobar `LEEME.txt` y `manifest.json` (`complete: true`);
   - el aviso «Exportación disponible» queda en la bandeja como omitido (`MAIL_MODE=off`);
   - el enlace caduca a las 24 h.
3. **Manual:** acceso de dos empresas con su marca; recuperación de contraseña; acceso central.
4. **Manual:** webhook de Postmark 26051423 (pendiente desde la caída de Railway).
5. `estado`: anotar los commits activos nuevos.

**Parada:** cualquier fallo en 1 a 3 → volver atrás el servicio afectado (fase 4) y abrir incidencia; no seguir a la fase 6.

## Fase 6 — Producción comercial (`environment = production`)

Solo con `live` terminado sin incidencias. Repetir las fases 1 a 5 en `production`, con su token. Cada ejecución requiere la **aprobación del propietario** en el entorno protegido. Antes de 3.4, confirmar que la copia de 2.3 incluye todas las empresas comerciales.

## Recuperación

- **Código:** la acción del servicio con `commit` = el anotado en 1.2. El flujo comprueba que pertenece a `integration/elephant-source`.
- **Migraciones de una empresa** (ambas probadas en el ensayo):
  - `scripts/db/migrate.ts down --dir db/migrations --steps N --apply --confirm-database <bd>`;
  - o `restore-tenant <empresa> --apply --switch` desde la copia de 2.3.
- **Watch paths de Náyade:** borrarlas en el panel devuelve el comportamiento anterior (todo despliega).
- **Nunca:** forzar despliegues, saltarse una fase, migrar sin copia verificada o desplegar código sin las migraciones verificadas.
