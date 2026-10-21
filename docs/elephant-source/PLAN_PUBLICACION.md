# Plan de publicación de Elephant Source

Un único plan, en orden, para cuando Railway vuelva a estar operativo. La sección 1 es la **lista de puesta en marcha**; las secciones siguientes, el detalle de cada fase. Cada paso de las fases 1 a 5 es **una ejecución** del flujo «Despliegue Elephant Source» (GitHub → Actions, rama `integration/elephant-source`).

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

## 1. Lista de puesta en marcha

### 1.1 Intervenciones humanas imprescindibles

| # | Qué | Cuándo | Detalle |
|---|---|---|---|
| H1 | Crear los tokens de proyecto de Railway (`live` y `production`) | Antes de todo | Fase 0.1 |
| H2 | Crear los entornos protegidos de GitHub con su `RAILWAY_TOKEN` y revisores | Antes de todo | Fase 0.2 |
| H3 | Poner las watch paths de Náyade y verificarlas en un servicio de prueba | Antes de H4 | Fases 0.3 y 0.4 |
| H4 | Fusionar en `main` el PR que lleva **solo** el fichero del flujo (lo prepara Claude) | Tras H3 correcto | Fase 0.5 |
| H5 | Aprobar cada ejecución en los entornos protegidos (en `production`, la aprobación es la autorización comercial) | Cada paso | Fase 0.2 |
| H6 | Añadir una variable a `restore-drill` **solo si** la simulación de la fase 3 dice que falta (`PROVISIONING_DB_ADMIN_URL`) | Si ocurre | Fase 3.1 |
| H7 | Pruebas en el navegador y webhook de Postmark | Fase 5 | Fase 5.2 a 5.4 |
| H8 | Decidir el paso a `production` | Tras `live` | Fase 6 |

No bloquean el lanzamiento, porque lo que dependen de ellos sigue apagado o sin publicar:
- la configuración restringida del portal en Stripe;
- los textos legales;
- los plazos de ciclo de vida (`CICLO_VIDA_TENANT.md`).

### 1.2 Lo que Claude ejecuta con credenciales autorizadas

Las credenciales autorizadas son los tokens en los entornos de GitHub y la sesión de `gh` del propietario. Claude **nunca ve** el token de Railway: es un secreto del entorno.

**Claude hace:**
- Preparar el PR de H4.
- Lanzar cada acción en orden con `gh workflow run deploy-elephant-source.yml --ref integration/elephant-source -f environment=<entorno> -f action=<acción> -f confirm=<entorno>` (y `commit`/`only` cuando toque).
- Seguir la ejecución y leer su registro (`gh run view --log`).
- Comparar cada resultado con el criterio de la fase.
- Anotar los puntos de vuelta atrás.
- Ante una parada: detenerse, lanzar la recuperación prevista **de ese paso** e informar.
- Comprobaciones HTTP públicas.

**Claude no hace:**
- aprobar ejecuciones;
- crear o ver tokens;
- cambiar variables de Railway;
- tocar `main` (salvo abrir el PR), DNS, `MAIL_MODE`, Checkout o el portal;
- forzar despliegues;
- encadenar arreglos.

### 1.3 Comprobaciones por plataforma

| Plataforma | Debe cumplirse |
|---|---|
| **GitHub Actions** | El flujo está en `main` (H4) y solo se lanza desde `integration/elephant-source`. Cada ejecución espera aprobación. `verificar-token` dice «proyecto de Elephant Source, entorno «X»». Ninguna ejecución afecta a Náyade |
| **Railway** | Náyade **no** se redespliega con el commit de H4 (watch paths). Cada servicio, `SUCCESS`. En el registro del despliegue: `core` con `Server running on http://localhost:3000/` y tareas registrándose (incluida `data-export`); `controlplane` sin `reason: migration_00NN_missing` en lo que se publica (`Withdrawals`, `Commerce`, `Limits`). `restore-drill` vuelve a `backup-job list` tras cada orden |
| **Stripe** | Ningún cambio en Stripe durante la publicación. Arranque del plano de control con Checkout desactivado y el portal apagado (sin `CP_BILLING_PORTAL_ENABLED`). La configuración por defecto del portal permite cancelar: no se usa mientras el portal esté apagado |
| **Postmark** | `MAIL_MODE=off`: nada se envía; los avisos quedan en la bandeja como omitidos. El webhook 26051423 responde 200 a «Send test» en Postmark (H7) |

### 1.4 Qué se publica y en qué orden

| Orden | Componente | Qué incluye | Requiere |
|---|---|---|---|
| 1 | `restore-drill` y `backup-job` (imagen del plano de control) | Paquete de migraciones de plataforma (`.mig`), `migrate-tenants`, `check-data-exports` | — |
| 2 | Copia de seguridad | Todas las empresas, registro y CRM | 1 |
| 3 | Migraciones de **plataforma** | Registro: sin pendientes previstas (está en 0013). CRM: **0020, 0021 y 0022** (en `production` estaba en 0019) | 2 |
| 4 | Migraciones de las **empresas** | 0011–0013. En `production`, las ficticias están en 0011 y `t5-skibox` (empresa real) en 0010 | 2 |
| 5 | `controlplane` | Paquete contractual con plazo y calendario de Madrid; portal preparado pero apagado; dirección de facturación, VIES y desistimiento (0020–0022) | 3 |
| 6 | `core` | Exportación de datos (pantalla, trabajo asíncrono, retirada a 7 días) y acceso con la marca de la empresa | 4 |
| 7 | `core-gateway` | Página central de acceso | 6 |
| 8 | CRM (repositorio `big-elephant-crm`) | Grupo «Datos de la empresa» en Comunicaciones | 5 |

**No se publica:**
- la web con textos legales nuevos;
- Checkout;
- el portal de facturación;
- envíos de correo;
- archivado o supresión con plazos (90/180 días).

### 1.5 Condiciones que impiden continuar

Además de las paradas de cada fase:
1. el token no es del proyecto o del entorno esperado;
2. Náyade se redespliega por un cambio solo en `.github`;
3. falta la copia de seguridad de alguna empresa, del registro o del CRM;
4. una simulación muestra algo distinto de lo previsto en 1.4, o una base con otro nombre (`es_registry`/`es_crm`);
5. falla el canario de las migraciones;
6. un servicio no queda en `SUCCESS` o arranca con errores;
7. falla cualquier comprobación manual de la fase 5.

La recuperación de cada caso está en su fase y en la sección «Recuperación».

## Dependencias

```
Fase 0 (personas) ──► Fase 1 (estado) ──► Fase 2 (copia) ──► Fase 3 (migraciones) ──► Fase 4 (servicios) ──► Fase 5 (verificación)
                                                                                                                  │
                                                                                         live sin incidencias ──► Fase 6 (production, con aprobación)
```

- Las migraciones (fase 3) necesitan la imagen nueva en `restore-drill` (2.1) y una copia verificada (2.3).
- El código nuevo (fase 4) necesita las migraciones verificadas (3.2 y 3.7). Son aditivas: el código anterior funciona con ellas, así que **primero se migra y después se despliega**, y volver atrás el código no exige revertir migraciones.
- `production` (clientes comerciales) solo después de terminar `live` y con aprobación humana en GitHub.

## Fase 0 — Preparación (manual, una sola vez)

| # | Acción (persona) | Criterio de aceptación |
|---|---|---|
| 0.1 | Crear un **token de proyecto** de Railway por entorno (proyecto Elephant Source → Settings → Tokens → *Project token*; uno para `live` y otro para `production`). Es una credencial nueva: la crea el propietario | Cada token solo ve su proyecto y su entorno |
| 0.2 | En GitHub (repositorio `nayade_experiences_platform` → Settings → Environments), crear `elephant-source-live` y `elephant-source-production`: secreto `RAILWAY_TOKEN` de su entorno, rama permitida solo `integration/elephant-source` y **revisores obligatorios** (el propietario). En `production` la aprobación es la autorización de producción comercial | Una ejecución queda «Waiting for review» hasta aprobarla |
| 0.3 | **Watch paths de Náyade** (su servicio en Railway → Settings → Watch Paths, configuración oficial; sin tocar su `railway.toml`). Los patrones de `docs/elephant-source/railway/watch-paths-nayade.txt`, uno por línea: `**`, `!/.github`, `!/.github/**` | Ver 0.4 |
| 0.4 | **Verificar la exclusión antes de confiar en ella**, sin tocar Náyade: un servicio de PRUEBA conectado al mismo repositorio, a una rama de pruebas y con esas mismas watch paths:<br>a) commit que solo cambia `.github/**` → **no** crea despliegue (aparece como omitido);<br>b) commit que cambia `server/` → **sí** despliega;<br>c) commit mixto (`.github` + `server`) → **sí** despliega.<br>Después, borrar el servicio de prueba y la rama | Los tres resultados como se indican. **Parada** si a) despliega o si b)/c) no: Railway no aplica la semántica documentada; no seguir con 0.5 |
| 0.5 | Con 0.3 y 0.4 correctos: llevar **únicamente** `.github/workflows/deploy-elephant-source.yml` a `main` (GitHub solo permite lanzar a mano flujos que estén en la rama por defecto). Claude prepara el PR; lo fusiona el propietario | En Railway, Náyade **no** crea despliegue por ese commit. Si lo crea: verificar que arranca limpio (mismo código) y quitar las watch paths hasta revisarlo |
| 0.6 | Confirmar a qué entorno apunta cada dominio (`www`, `app` y `admin.bigelephant.es` → `production`) | Anotado |

Hasta 0.5 el flujo está integrado en `integration/elephant-source` pero no se puede lanzar. No se crean etiquetas de despliegue.

> Comprobación previa ya hecha: las watch paths se validaron con la implementación de referencia de la sintaxis gitignore (`git check-ignore`) y con el historial real de `main` (`server/railwayWatchPaths.test.ts`; 399 commits revisados a mano: 0 que toquen código dejarían de desplegar). Ojo: el patrón «obvio» `** + !/.github/**` **no** excluye nada con esa sintaxis, porque no se puede reincluir un fichero cuyo directorio ya coincide.

## Pruebas previas (hechas en local; repetir si cambia el código de migraciones)

- **Ensayo de las migraciones de las empresas** en un MySQL aislado con datos anonimizados (`server/ensayoMigracionExportacion.mysql.test.ts`):
  - empresas con el esquema anterior a la exportación (hasta 0010) y clientes/leads ficticios;
  - copia cifrada (`backup-job`);
  - simulación: pendientes exactamente 0011, 0012 y 0013;
  - aplicación con canario;
  - verificación de esquema (`check-data-exports`), datos de negocio idénticos (`CHECKSUM TABLE`) y exportación funcionando;
  - segunda aplicación: `up_to_date`;
  - reversión A con `scripts/db/migrate.ts down --steps 3` y nueva aplicación;
  - reversión B restaurando la copia (`restoreTenant --switch`): esquema y datos de antes.
- El ensayo descubrió y corrigió un fallo: `migrate.ts down` se negaba a operar en las bases de las empresas por el registro `0000_baseline` del aprovisionamiento.
- **Migraciones de plataforma desde la imagen** (`Dockerfile.controlplane` construida en local, MySQL desechable):
  - CRM en 0019: `crm status` y `crm plan` muestran 0020–0022, `crm apply` las aplica y el estado final es 22/0;
  - registro en 0013: sin pendientes;
  - sin variable de conexión: código 1.
- Suites MySQL de exportación (de punta a punta, retirada a los 7 días, trabajo asíncrono).

## Fase 1 — Estado y puntos de vuelta atrás (`environment = live`)

| # | Acción del flujo | Comprobar | Parada / recuperación |
|---|---|---|---|
| 1.1 | `verificar-token` | «Token del proyecto de Elephant Source, entorno «live»» y la lista de servicios | **Parada** si es otro proyecto o entorno: revisar el secreto del entorno de GitHub |
| 1.2 | `estado` | Despliegue activo de cada servicio (`controlplane`, `core`, `core-gateway`, `backup-job`, `restore-drill`). **Anotar el commit** de cada uno (el flujo lo deja en el mensaje: `nayade_experiences_platform <sha>`): son los puntos de vuelta atrás | **Parada** si un servicio no tiene despliegue activo, o si el mensaje no lleva el commit y no se puede identificar en los registros anteriores: sin punto de vuelta atrás no se despliega |

## Fase 2 — Herramientas y copia de seguridad

| # | Acción | Comprobar | Parada / recuperación |
|---|---|---|---|
| 2.1 | `desplegar-restore-drill` | `SUCCESS`; el arranque queda en `backup-job list` (sin tráfico de clientes) | Fallo: `desplegar-restore-drill` con el commit de 1.2 |
| 2.2 | `desplegar-backup-job` | `SUCCESS` | Igual, con su commit de 1.2 |
| 2.3 | `copia-de-seguridad` | Sin errores y una copia de hoy de **cada empresa**, del **registro** y del **CRM** | **Parada:** sin copia verificada de todo no se migra. Revisar el destino de las copias |

## Fase 3 — Migraciones

**Plataforma (registro y CRM)**

| # | Acción | Comprobar | Parada / recuperación |
|---|---|---|---|
| 3.1 | `migraciones-plataforma-simulacion` | Registro: «BD «es_registry»», `pending: []` (o solo las previstas). CRM: «BD «es_crm»», pendientes **solo** las previstas (0020, 0021 y 0022 si estaba en 0019) | **Parada** si aparece otra base u otra migración. Si sale con error por falta de `PROVISIONING_DB_ADMIN_URL` en `restore-drill`: H6 y repetir |
| 3.2 | `migraciones-plataforma-aplicar` | Registro sin cambios o aplicadas; CRM «Aplicadas: N · pendientes: 0» | **Parada** si falla. Son aditivas: el código anterior sigue funcionando. Volver a un estado anterior es manual (persona): `restore-platform crm` desde la copia de 2.3 a una base de ensayo y cambio controlado (`DESPLIEGUE_LIVE.md`) |

**Empresas**

| # | Acción | Comprobar | Parada / recuperación |
|---|---|---|---|
| 3.3 | `migraciones-simulacion` | Pendientes por empresa: solo migraciones de `db/migrations` (0011–0013 en las anteriores a la exportación) | **Parada** si aparece algo inesperado |
| 3.4 | `migraciones-aplicar` con `only` = **una empresa interna** | `migrated` | **Parada** si falla. Recuperar esa empresa (ver «Recuperación») |
| 3.5 | `verificar-migraciones` con `only` = esa empresa | `ok: true`, `faltan: []` | Igual que 3.4 |
| 3.6 | `migraciones-aplicar` (todas; el canario automático va primero y, si falla, no se toca ninguna más) | `migrated`/`up_to_date` en todas | **Parada** al primer fallo. Recuperar las afectadas |
| 3.7 | `verificar-migraciones` (todas) | `ok: true` en todas; el paso falla si alguna no | Repetir 3.6 solo para las que falten (`only`) |

## Fase 4 — Servicios

| # | Acción | Comprobar en el registro | Parada / recuperación |
|---|---|---|---|
| 4.1 | `desplegar-controlplane` | `SUCCESS`; arranque limpio; sin `migration_00NN_missing` en `Withdrawals`, `Commerce` ni `Limits`; portal **apagado**; Checkout desactivado | Redesplegar el commit de 1.2 |
| 4.2 | `desplegar-core` | `SUCCESS`; `Server running on http://localhost:3000/`; tareas registrándose, incluida `data-export` | Redesplegar el commit de 1.2. Las migraciones no se revierten (aditivas) |
| 4.3 | `desplegar-core-gateway` | `SUCCESS`; página central nueva | Redesplegar el commit de 1.2 |
| 4.4 | CRM (repositorio `big-elephant-crm`, rama `integration/elephant-source`, `1bf6de1` o posterior; manual) | `SUCCESS`; «Comunicaciones» con «Datos de la empresa» | Redesplegar el anterior |

## Fase 5 — Verificación

1. `comprobar-salud`. Comprueba `https://app.bigelephant.es/`, que es el dominio de **`production`**. En `live` no prueba ese entorno: allí valen el `SUCCESS` y el registro de la fase 4.
2. **Manual, en una empresa interna:**
   - solicitar una exportación y ver que pasa por «En cola», «Generando» y «Lista»;
   - descargar el ZIP y comprobar `LEEME.txt` y `manifest.json` (`complete: true`);
   - el aviso «Exportación disponible» queda en la bandeja como omitido (`MAIL_MODE=off`);
   - el enlace caduca a las 24 h.
3. **Manual:**
   - acceso de dos empresas con su marca;
   - recuperación de contraseña;
   - acceso central.
4. **Manual:** webhook de Postmark 26051423 («Send test» → 200), pendiente desde la caída de Railway.
5. `estado`: anotar los commits activos nuevos.
6. Anotar las empresas que estén en `suspended`. Ninguna se archiva hasta tener los avisos previos (`CICLO_VIDA_TENANT.md`).

**Parada:** cualquier fallo en 1 a 3 → volver atrás el servicio afectado (fase 4) y abrir incidencia; no seguir a la fase 6.

## Fase 6 — Producción comercial (`environment = production`)

Solo con `live` terminado sin incidencias. Repetir las fases 1 a 5 en `production`, con su token. Cada ejecución requiere la **aprobación del propietario** en el entorno protegido.

- Antes de 3.2 y 3.6: confirmar que la copia de 2.3 incluye todas las empresas comerciales, el registro y el CRM.
- `t5-skibox` es una empresa real: se migra en 3.6, después del canario, nunca como canario.

## Recuperación

- **Código:** la acción del servicio con `commit` = el anotado en 1.2. El flujo comprueba que pertenece a `integration/elephant-source`.
- **Migraciones de una empresa** (ambas probadas en el ensayo; manuales, las hace una persona con acceso):
  - `scripts/db/migrate.ts down --dir db/migrations --steps N --apply --confirm-database <bd>`;
  - o `restore-tenant <empresa> --apply --switch` desde la copia de 2.3.
- **Migraciones de plataforma:** son aditivas, y volver atrás el código basta. Una reversión de datos se hace por restauración de la copia de 2.3 (`restore-platform`, `DESPLIEGUE_LIVE.md`), nunca con el flujo.
- **Watch paths de Náyade:** borrarlas en el panel devuelve el comportamiento anterior (todo despliega).
- **Nunca:** forzar despliegues, saltarse una fase, migrar sin copia verificada o desplegar código sin las migraciones verificadas.
