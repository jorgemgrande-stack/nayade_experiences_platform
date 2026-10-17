# Operación del entorno Railway «Elephant Source» (restringido)

Es un proyecto Railway **propio**, independiente del de Náyade: proyecto, servicios, bases de datos, variables y dominios distintos. Náyade no comparte ningún recurso con él.

**Fuera de alcance, no tocar:** los proyectos «Nayade Experiences», «Skicenter_platforms», «Segolife», «efizientia» y «Cristina ViveConsciente».

## 1. Arquitectura

```
Internet ──► pasarelas Caddy (autenticación básica en todas las rutas, salvo /__gateway/health)
   web           elephant-source-web   → web estática + /cp/v1/public (solo la API pública) → controlplane
   crm           elephant-source-crm   → SPA del CRM  + /cp/v1/* (cookie de operador, mismo origen) → controlplane
   core-gateway  elephant-source-core  → core (host sin empresa: 404)
   gw-demo-a/b   <empresa>.up.railway.app → core (una pasarela y un dominio por empresa)
Red privada:  core (TENANT_MODE=multi) · controlplane (/cp/v1) · MySQL · backup-job (cron cada 15 min)
```

- **Por qué una pasarela por empresa.** El Core elige la empresa solo por la cabecera `Host`. Sin DNS propio, cada empresa recibe `<id>.up.railway.app`: el dominio de plataforma es `CP_PLATFORM_DOMAIN=up.railway.app` y Railway da un solo dominio por servicio.
  - Con un dominio propio y comodín (`*.<dominio>`), una única pasarela atendería a todas las empresas.
- **Por qué CRM y plano de control en el mismo origen.** La cookie de operador es `SameSite=Strict` con `Path=/cp/v1`. Al compartir origen, el navegador la envía sin CORS que atraviese la autenticación básica.

**MySQL.** Una instancia, con estas bases lógicas:

| Base | Contenido | Usuario de mínimo privilegio |
|---|---|---|
| `es_registry` | Registro de empresas, licencias e inventario de copias | `es_cp` (escritura) y `es_core` (solo lectura) |
| `es_crm` | CRM comercial, catálogo, suscripciones, pruebas y pedidos | `es_cp` |
| `es_<empresa>` | Una base por empresa, creada por el aprovisionamiento | Usuario propio de la empresa |

- **Sin acceso público.** El proxy TCP solo se abre de forma temporal para migrar o sembrar, y se borra al terminar.
- **Conexiones.** Presupuesto de 60 por proceso del Core, con 4 por empresa (`docs/runbooks/OPERACIONES_MULTITENANT.md`). El límite del servidor es 151.

## 2. Acceso

- **Credenciales.** Las de la pasarela (usuario y contraseña) y la del primer operador del CRM (`jorge`) están en la carpeta privada del propietario, fuera de cualquier repositorio. En Railway solo existe el **hash** bcrypt de la contraseña de la pasarela.
- **Entrada.** Abrir el dominio, introducir las credenciales de la pasarela y, después, iniciar sesión en la aplicación: el operador en el CRM, o el propietario o empleado en la web de su empresa.
- **Nada de lo anterior se ha enviado por correo.** El envío está apagado.

## 3. Desplegar (desde un commit verificado)

Los servicios **no** están conectados a GitHub. Así se evita el `railway.toml` de la raíz (Nixpacks, el de Náyade) y ningún push despliega solo. Para desplegar:

1. **CI en verde** del commit exacto en su rama candidata: Core `integration/elephant-source`, CRM `integration/elephant-source`, web `feat/elephant-web-portfolio`.
2. **Exportar el commit sin ficheros ajenos.**
   ```bash
   git archive <sha> | tar -x -C <dir>
   rm <dir>/railway.toml <dir>/data/seed.json
   ```
3. **Subirlo al servicio, con proyecto y entorno explícitos.**
   ```bash
   railway up <dir> --path-as-root -s <servicio> -p 5f32ccca-3f72-4c48-bc63-57881cb9e166 -e production --detach -m "<repo> <sha>"
   ```
   - Core: `core`, `core-gateway`, `gw-demo-*`, `controlplane` y `backup-job`, desde la misma exportación.
   - CRM: `crm`.
   - Web: `web`.
4. **Comprobar.** Despliegue en `SUCCESS` y logs de arranque sin errores (`Server running` en el Core; sin `ctx` de error en el plano de control). Después, `/__gateway/health` = 200, y 401 sin credenciales.

Cada servicio fija su `dockerfilePath` y su healthcheck en la configuración de Railway:

| Servicio | `dockerfilePath` |
|---|---|
| `core` | `deploy/railway/core.Dockerfile` |
| `controlplane`, `backup-job` | `Dockerfile.controlplane` |
| pasarelas | `deploy/railway/gateway/Dockerfile` |
| CRM y web | `deploy/railway/Dockerfile` (de su repositorio) |

## 4. Volver atrás

- **Código.** En Railway, redesplegar el despliegue anterior del servicio (Deployments → «Redeploy»), o repetir el paso 3 con el commit anterior.
- **Detener despliegues.** No hay despliegues automáticos: basta con no ejecutar `railway up`.
- **Base de datos.** Restauración individual por empresa desde las copias cifradas (`docs/runbooks/BACKUPS_Y_RECUPERACION.md`, sección 7). Se **demostró** en este entorno (ver el informe de Overnight 4).
  - **No hay vuelta atrás automática de la base completa:** PITR no está disponible con la imagen `mysql:8` actual.
- **Operaciones irreversibles.** Borrar una base retirada, borrar objetos del bucket (la retención lo hace con su política) y borrar servicios o el proyecto.

## 5. Copias

- **Servicio.** `backup-job`, un cron `*/15 * * * *` que ejecuta `node dist-cp/backup-job.js run`. Copia cada empresa, el registro y el CRM comercial, cifrados con AES-256-GCM (clave `bk1`), al bucket del proyecto `elephant-source-backups` (región `ams`), con retención 30/12/12.
- **Inventario.** `GET /cp/v1/backups`. Alerta `backup.stale` si una copia tiene más de 2 h.
- **La clave de cifrado también está en la carpeta privada.** Sin ella, las copias no se pueden descifrar.
- **Pendiente.** El bucket está **dentro** de Railway: no protege ante la pérdida del proyecto o de la cuenta. El código ya admite un destino externo independiente (`BACKUP_SECONDARY_*`, `BACKUPS_Y_RECUPERACION.md` sección 16) y la reconstrucción total (`RECUPERACION_TOTAL.md`), pero falta elegir y contratar el proveedor, lo que requiere autorización y tiene coste. Antes de configurarlo hay que aplicar la migración `0011` del registro.

## 6. Añadir una empresa de prueba (beta privada)

1. Dar de alta la prueba: `POST /cp/v1/trials {email, companyName, idempotencyKey}` (operador).
   - Devuelve `tenantId` y el enlace de acceso del propietario.
   - No envía correo: el enlace se entrega por un canal acordado.
2. Crear su pasarela:
   - servicio nuevo con las mismas variables que `gw-demo-a` y `dockerfilePath` de pasarela;
   - dominio generado y renombrado a `<tenantId>` (`railway domain update … --domain <tenantId>`);
   - desplegar como en el paso 3.
3. Comprobar `https://<tenantId>.up.railway.app/` con las credenciales de la pasarela.

## 7. Prueba de aceptación

Se ejecuta con `ES_PRIVATE_DIR=<carpeta privada> MSYS_NO_PATHCONV=1 node scripts/railway/aceptacion-railway.cjs`.

- **Necesita:** en la carpeta privada, `alta-A.json` y `alta-B.json` (respuestas del alta asistida) y el estado de la prueba.
- **Recorre:** 33 pasos, incluidos aislamiento y concurrencia.
- **Termina con código 1** si falla cualquier paso esencial.
