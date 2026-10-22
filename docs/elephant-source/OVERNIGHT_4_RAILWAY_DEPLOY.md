# Overnight 4 · Despliegue de Elephant Source en Railway (16–17/10/2026)

**Resultado:** Elephant Source funciona en un proyecto Railway **propio**: Web, Core, plano de control y CRM integrados, MySQL independiente, acceso restringido y copias cifradas automáticas. La prueba de aceptación multiempresa supera **33/33** pasos y la restauración individual se ha demostrado. **Náyade no se ha modificado.** No es comercializable todavía (ver §11 y §12).

Operación diaria: `docs/runbooks/RAILWAY_ELEPHANT_SOURCE.md`. Credenciales: solo en la carpeta privada del propietario.

## 1. Infraestructura creada

**Proyecto:** «Elephant Source» `5f32ccca-3f72-4c48-bc63-57881cb9e166` (entorno `production` `eecbe61e-…`), espacio de trabajo `jorgemgrande-stack's Projects`.

| Servicio | Origen | Acceso | Estado |
|---|---|---|---|
| `MySQL` (8.4.11, volumen) | Plantilla de Railway | Solo red privada (el proxy TCP temporal se borró) | Arrancado |
| `controlplane` | Core `Dockerfile.controlplane` | Privado (vía pasarelas de CRM y web) | Verificado |
| `core` (`TENANT_MODE=multi`, `CAPABILITY_ENFORCEMENT=on`) | Core `deploy/railway/core.Dockerfile` | Privado | Verificado |
| `core-gateway` | Pasarela Caddy | `elephant-source-core.up.railway.app` | Verificado (host sin empresa: 404) |
| `gw-demo-a`, `gw-demo-b` | Pasarela Caddy | `t3-empresa-demo-elephant-01…`, `t4-empresa-demo-elephant-02.up.railway.app` | Verificado |
| `crm` | CRM `deploy/railway/Dockerfile` (SPA + `/cp/v1`) | `elephant-source-crm.up.railway.app` | Verificado |
| `web` | Web `deploy/railway/Dockerfile` (estática + `/cp/v1/public`) | `elephant-source-web.up.railway.app` | Verificado |
| `backup-job` | Core (cron `*/15 * * * *`) | Sin red pública | Verificado (ejecuciones automáticas) |
| `restore-drill` | Core (de un solo uso) | Sin red pública | Simulacro hecho; arranque cambiado a `list` (inocuo) |
| Bucket `elephant-source-backups` | Railway Buckets, región `ams` | Credenciales S3 propias | En uso |

**Versiones desplegadas:**

| Repositorio | Commit | Rama |
|---|---|---|
| Core | `4162dc7` | `integration/elephant-source` |
| CRM | `7746f02` | `integration/elephant-source` |
| Web | `b76bbf4` | `feat/elephant-web-portfolio` |

Todas desplegadas con su CI en verde.

**Método de despliegue:** `git archive` del commit exacto (sin `railway.toml` ni `data/seed.json`) + `railway up` al servicio, con proyecto y entorno explícitos. Los servicios **no** están conectados a GitHub, por dos motivos:
- Railway ya no permite elegir un fichero de configuración por servicio;
- el `railway.toml` de la raíz es el de Náyade (Nixpacks).

Así, ningún push despliega solo y `main` no se ha tocado.

## 2. Aislamiento respecto de Náyade

**Proyecto de Náyade.** Comparado antes y después: nombre, servicios (`updatedAt`), últimos 3 despliegues y disparador (`main`, `checkSuites: false`). **Idéntico.**

**`main`, sin cambios en los tres repositorios:**

| Repositorio | `main` |
|---|---|
| Core | `baeca78` |
| CRM | `62183b1` |
| Web | `5aa098d` |

**Otros proyectos de la cuenta:** no se ha ejecutado ningún comando contra ellos.

**Salvaguardas:**
- los comandos llevan siempre `-p 5f32ccca…`;
- las mutaciones GraphQL pasan por una lista blanca de identificadores del proyecto nuevo;
- los scripts que tocan MySQL se detienen si `RAILWAY_PROJECT_ID` no es el del proyecto nuevo.

**Datos:** no se ha copiado ningún dato de Náyade. Las bases son nuevas, con semilla oficial y datos sintéticos (`.example`).

## 3. Bases de datos

| Base | Migraciones | Semilla |
|---|---|---|
| `es_registry` | Registro `0000`–`0010` (0010 = inventario de copias), con el ejecutor `registry-migrate.ts` (plan → ejecución → verificación de objetos) | Primer operador `jorge` (`scripts/cp-operators.ts bootstrap`, contraseña generada en la carpeta privada) |
| `es_crm` | `db/crm/0000_crm.sql` + carril CRM `0001`–`0010` (`migrate.ts`) | Catálogo oficial: 132 entradas y 60 precios; la repetición da `unchanged: 132` |
| `es_<empresa>` (4) | Baseline + carril de la app `0001`–`0008`, aplicados por el aprovisionamiento | Ajustes y flags del Core |

**Usuarios MySQL de mínimo privilegio:**
- `es_cp`: escritura en el registro y el CRM, más `TRIGGER` y `SHOW VIEW` para los volcados;
- `es_core`: solo lectura del registro;
- uno propio por cada empresa.

`root` solo lo usa el aprovisionamiento por la red privada.

**Conexiones:**
- presupuesto de 60 por proceso del Core y 4 por empresa (PR #117);
- con los valores actuales, el uso estimado es de unas 103 conexiones de las 151 del servidor;
- antes de añadir réplicas hay que subir `max_connections` a unas 250 (ver la fórmula en `OPERACIONES_MULTITENANT.md`).

## 4. Seguridad

**Dependencias** (`pnpm audit`, crítico / alto):

| Repositorio | Alcance | Antes | Después |
|---|---|---|---|
| Core | Producción | 2 / 52 | **0 / 0** (quedan 2 bajos) |
| CRM | Todo | 4 / 1 | **0 / 0** |
| Web | Producción | 1 / 5 | **0 / 0** (queda 1 bajo) |

Pendiente: en el Core quedan 2 críticos de `tinypool`, una dependencia solo de pruebas (vitest 4 en tarea aparte). Detalle en `docs/seguridad/DEPENDENCIAS.md` (PR #119, CRM #18 y web #7).

**Controles:**
- pasarela con autenticación básica previa en todas las rutas y APIs;
- la pasarela no reenvía las credenciales a la aplicación;
- `X-Robots-Tag: noindex`;
- además, la autenticación propia de cada aplicación sigue activa (cookies, CSRF, antifuerza bruta, roles);
- el registro público, los cobros reales, el orquestador con cobro automático y los correos están **apagados en el servidor**;
- MySQL no es accesible desde Internet (comprobado tras borrar el proxy).

**Secretos:** todos nuevos y propios del proyecto, generados localmente. Están en variables de Railway y en la carpeta privada; no hay ninguno en Git ni en los logs. No se ha reutilizado ninguno de Náyade.

## 5. Acceso restringido

**Cómo se entra:**
1. Abrir el dominio del servicio.
2. Introducir el usuario y la contraseña de la pasarela (carpeta privada).
3. Iniciar sesión en la aplicación: el operador en el CRM, o el propietario o empleado de cada empresa en su dominio.

**Verificado en los dominios reales:**

| Petición | Respuesta |
|---|---|
| Sin credenciales | 401 |
| Credenciales erróneas | 401 |
| Rutas directas y APIs sin credenciales | 401 |
| Salud de la pasarela | 200 |
| Desde la web, APIs privadas del plano de control | 404 (no accesibles) |

## 6. Prueba multiempresa en Railway

Ejecutada con `scripts/railway/aceptacion-railway.cjs` contra los servicios desplegados: **33/33 pasos** en una sola ejecución.

| Bloque | Pasos |
|---|---|
| **Empresa Demo 01** (alta asistida por operador; prueba de 15 días con 29 licencias) | Contraseña por enlace y login en su host → asistente → cliente → producto → presupuesto → pedido. Checkout sin dinero real (Redsys en entorno de pruebas con clave ficticia propia; la firma falsa se rechaza) → factura `FAC-2026-000x` en la empresa sintética. Empleada (agente) con permisos limitados → plan y límites (usuarios 2/3). Vencimiento simulado: lecturas sí, escrituras 403 → pedido de contratación → pago de PRUEBA firmado (firma falsa: 400) → licencias activas → escritura recuperada → datos conservados, sin nada escrito en solo lectura. |
| **Empresa Demo 02 · aislamiento** | No ve clientes ni facturas de la 01. El id del presupuesto de la 01 da 404 y su factura por REST también. La cookie de una empresa no vale en la otra. Las credenciales de la 01 no entran en la 02. No modifica datos de la 01. Sus licencias no cambian con la contratación de la 01. |
| **Concurrencia** | 40 peticiones simultáneas A/B en 527 ms, sin errores ni cruces. 10 logins simultáneos en 2,9 s. 10 presupuestos simultáneos con números únicos. |

**Incidencias durante la prueba:**
- **Caché de licencias del Core (30 s).** Los cambios de licencia tardan hasta 30 s en aplicarse; la prueba espera 35 s.
- **Reejecución.** Las primeras ejecuciones dejaron datos que impedían repetir la prueba: correos y claves de pedido repetidos. La prueba usa ahora identificadores por ejecución.

## 7. Copias y recuperación (anexo)

| Requisito | Estado |
|---|---|
| Base por empresa | **Sí**: cada empresa tiene su base lógica y su usuario en la instancia |
| Alta automática | **Sí**: el alta crea la base, migra, registra la ubicación y verifica, sin intervención en Railway (4 empresas) |
| Directorio central | **Sí**: registro con empresa, base, servidor, versión de esquema y estado |
| Copias automáticas | **Sí, verificadas**: cron cada 15 min. Cada empresa, el registro y el CRM, cifrados (AES-256-GCM), a un bucket con SHA-256 releído y manifiesto firmado. Unos 2 s por empresa. |
| Fuera de Railway | **No**: el bucket es del proyecto. Una copia externa requiere un proveedor externo (autorización y coste) |
| Restauración individual | **Demostrada en Railway** (ver abajo) |
| Retención 30/12/12 | Configurada (`BACKUP_APPLY_RETENTION=1`) |
| Varias instancias | Preparado (`PROVISIONING_DB_SERVERS`, colocación `least_used`/`explicit`, probado con dos servidores en local); en Railway hay una instancia |
| Supervisión | `GET /cp/v1/backups` (frescas / caducadas / nunca / fallidas por empresa), alerta `backup.stale` a 2 h |
| RPO 15 min / RTO 4 h | Ver abajo |

**Simulacro de restauración individual** (Empresa Demo 01):
1. Copia nº 13 a las 22:06.
2. Después de la copia se creó un cliente.
3. `restore-tenant t3-… --backup 13 --apply --switch`, ejecutado dentro de la red privada:
   - base nueva `es_t3_…_r20261016221031`;
   - verificación correcta (162 tablas, 160 filas, checksums y triggers);
   - registro conmutado (versión 10).
4. Resultado:
   - la empresa 01 vuelve exactamente al estado de la copia, sin el cliente posterior;
   - la empresa 02 queda **sin cambios**;
   - la base original queda retirada, **no borrada**.

**Objetivos de recuperación:**
- **RPO:** con copias cada 15 min, el RPO teórico es de 15 min más la duración de la copia (unos 10 s con 4 empresas). **No se promete** hasta medirlo con volúmenes reales y durante un periodo.
- **RTO:** no demostrado con volúmenes reales. La restauración de una empresa pequeña tarda segundos; falta un simulacro cronometrado con datos realistas.
- **PITR de Railway:** no está disponible con la imagen `mysql:8` (exige las imágenes `mysql-ha` de Railway). Cambiar la imagen es una operación de riesgo que queda propuesta.

## 8. Rendimiento y conexiones

- **Medidas en Railway:** las de la prueba de concurrencia (§6).
- **Medidas en local:** `docs/elephant-source/RENDIMIENTO_ESSENTIAL.md`.
- **Login, limitación conocida:** unos 4 por segundo por proceso, por `bcryptjs` de coste 12.
- **Conexiones:** presupuesto por proceso (§3).

## 9. Dominio `www.bigelephant.es`

**Estado actual** (consulta DNS de solo lectura del 16/10/2026):
- DNS en `gestiondecuenta.com`.
- `www.bigelephant.es` **no existe** (NXDOMAIN) y la raíz no tiene registro A: no hay web publicada.
- **Correo activo:** MX `mail.bigelephant.es` (82.98.164.82) y SPF `v=spf1 a mx ~all`. **No hay que tocarlos.**

**Propuesta, pendiente de autorización:**

| Uso | Nombre | Registro |
|---|---|---|
| Web comercial | `www.bigelephant.es` | `railway domain www.bigelephant.es --service web` → CNAME al destino que indique Railway, más el TXT de verificación |
| Raíz | `bigelephant.es` → `https://www.bigelephant.es` | Redirección en el proveedor DNS si admite ALIAS o redirección web; si no, se deja sin web |
| Empresas | `*.app.bigelephant.es` | CNAME comodín a `core-gateway` (una sola pasarela para todas) y `CP_PLATFORM_DOMAIN=app.bigelephant.es` |
| CRM interno | `crm.bigelephant.es` | CNAME a `crm`, con la pasarela o una restricción por IP |
| Plano de control | — | **Sin nombre público** |

- **HTTPS:** el certificado lo emite Railway al verificar.
- **Reversión:** borrar los registros añadidos. No afecta al correo si no se tocan MX, SPF ni `mail`.
- **Antes de publicar `www`:** completar los textos legales.

## 10. Essential: limitaciones priorizadas

De la matriz `ESSENTIAL_CAPACIDADES.md`: 6 capacidades funcionales y 23 con limitaciones. **Ninguna** está sin implementar ni incompleta.

| Prioridad | Limitación | Impacto | ¿Impide vender? | Solución |
|---|---|---|---|---|
| **P0** | Sin proveedor de correo configurado: no salen invitaciones, recuperación, verificación ni presupuestos | El cliente no recibe accesos ni documentos | **Sí** | Proveedor y remitente (autorización) |
| **P0** | Medios en almacenamiento local efímero: el Core usa URL públicas del bucket y Railway Buckets es privado | Se pierden imágenes, PDF y blog al redesplegar | **Sí** | Bucket público externo (autorización y coste) o proxy de medios en el Core (desarrollo pequeño) |
| P1 | El checkout solo funciona con Redsys propio de cada empresa | La empresa debe tener su TPV virtual | No (requisito documentado) | — |
| P1 | No hay factura libre: siempre nace de una operación | Flujo de facturación limitado | Parcial | Alta manual de factura |
| P1 | Cupones solo en porcentaje; impuestos sin IRPF ni recargo de equivalencia | Casos fiscales comunes no cubiertos | Parcial | Desarrollo |
| P2 | Cuentas sin distinción empresa/persona; actividad sin registro manual; etiquetas no visibles en Oportunidades | Usabilidad del CRM | No | Desarrollo |
| P2 | SEO sin datos estructurados ni `canonical` en la web de la empresa; blog en HTML básico | Visibilidad | No | Desarrollo |
| P2 | Dominio propio de la empresa solo por el operador; TPV sin selector de caja | Autoservicio | No | Desarrollo |

**Conclusión:** Essential **no** puede anunciarse como completo mientras los dos P0 sigan abiertos.

## 11. Criterios de éxito (§17)

| # | Criterio | Estado |
|---|---|---|
| 1 | Proyecto Railway nuevo | ✓ |
| 2 | Náyade sin modificar | ✓ (comparado) |
| 3 | Bases independientes | ✓ |
| 4 | Migraciones aplicadas | ✓ (registro 0010, CRM 0010, app 0008) |
| 5–7 | Core, CRM y Web arrancan | ✓ |
| 8 | Servicios conectados | ✓ (verificado de punta a punta) |
| 9 | Acceso restringido | ✓ |
| 10 | Sin secretos expuestos | ✓ |
| 11 | Vulnerabilidades críticas explotables | ✓ en producción (0/0) |
| 12–13 | Pruebas multiempresa y flujo de cliente ficticio | ✓ (33/33) |
| 14 | Precios correctos | ✓ (29/279, 79/759, 199/1.899 en la web desplegada) |
| 15–17 | Sin cobros reales, sin registro público, sin correos | ✓ |
| 18 | Logs sin errores críticos | ✓ (avisos de ajustes vacíos y mensajes de sistema de MySQL, no fallos) |
| 19 | Procedimiento de recuperación | ✓ (runbooks y simulacro) |
| 20 | Estado del dominio documentado | ✓ |

**Distinción de estados:**

| Estado | Situación |
|---|---|
| Código preparado | Sí |
| Desplegado y arrancado | Sí |
| Funcional y verificado | Sí, en entorno restringido |
| **Listo para apertura pública** | **No** (ver §12) |

## 12. Autorizaciones pendientes y siguiente paso

1. **Correo:** proveedor transaccional y remitente; dirección de soporte (`ELEPHANT_SUPPORT_EMAIL`).
2. **Medios:** bucket público externo, o encargar el proxy de medios del Core.
3. **Copia fuera de Railway:** proveedor externo para replicar el bucket de copias.
4. **Dominio:** registros DNS de §9 en `gestiondecuenta.com`. Después, `CP_PLATFORM_DOMAIN=app.bigelephant.es` y una sola pasarela de empresas.
5. **Textos legales** revisados, con los datos societarios.
6. **PITR:** decidir si se migra MySQL a la imagen `mysql-ha` de Railway (RPO continuo).
7. **Integración en `main`:**
   - Core #98 sigue bloqueado por el disparador de Náyade (`checkSuites: false`);
   - CRM #16 y Web #5 requieren fusión humana.

**Para avanzar:**

| Objetivo | Qué falta |
|---|---|
| Publicar la web comercial | Puntos 4 y 5 (la web ya está desplegada) |
| Abrir la beta privada | Puntos 1 y 2. Las empresas invitadas se dan de alta con `POST /cp/v1/trials` (alta asistida) |
| Activar la prueba pública | Lo anterior, más el dominio comodín de empresas, el proveedor de correo con verificación, `CP_PUBLIC_TRIAL_ENABLED=1` y `PUBLIC_TRIAL_SIGNUP=1` en la web, con autorización expresa |
| Vender Essential | Lo anterior, más los dos P0 de §10, la pasarela de pagos en modo pruebas con credenciales, la autorización de cobros reales y la decisión de `max_connections` y réplicas |
