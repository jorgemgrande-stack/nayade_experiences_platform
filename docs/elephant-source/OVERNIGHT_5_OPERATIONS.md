# Overnight 5 · Brevo, almacenamiento persistente y copias externas (17/10/2026)

**Proyecto Railway:** «Elephant Source» `5f32ccca-3f72-4c48-bc63-57881cb9e166`. Náyade no se ha tocado.

**Versión desplegada del Core:** `fbae9f7` (rama `integration/elephant-source`, CI en verde). Servicios desplegados con ella: `core`, `controlplane`, `backup-job` y `restore-drill`.

## Resumen por bloque

| Bloque | Estado | Detalle |
|---|---|---|
| **A · Brevo** | **Integrado y desplegado, envío apagado** (`MAIL_MODE=off`) | Falta la clave de Brevo de la cuenta de Elephant Source, la autenticación del dominio y los destinatarios autorizados para la prueba real. |
| **B · Almacenamiento** | **Verificado en Railway** | Bucket privado `elephant-source-media` (Railway, `ams`). Persistencia tras redespliegue, permisos y aislamiento probados. |
| **C · Copias externas** | **Preparado, sin destino externo** | Las copias siguen solo en el bucket de Railway. El segundo destino independiente está implementado y probado en contenedores; falta elegir y contratar el proveedor. |

## A. Correo transaccional con Brevo

- **Diseño:** servicio central `server/mail/` (detalle en `docs/runbooks/CORREO_BREVO.md`).
  - Proveedor Brevo (API v3) detrás de un puerto.
  - Bandeja de salida persistente por empresa (`db/migrations/0010_mail_outbox`) y de plataforma (`db/crm/migrations/0011_platform_mail_outbox`).
  - Idempotencia por clave y reintentos con espera limitada.
  - Estados que separan «aceptado por la API» de «entregado» (evento de Brevo). La recepción solo la confirma una persona.
  - Límites por empresa y por destinatario, y supresiones.
  - Logs sin direcciones ni tokens.
- **Identidad de envío:**
  - `From: <nombre comercial> <no-reply@bigelephant.es>` y `Reply-To` de la empresa. Una empresa no puede enviar con la identidad de otra.
  - En multiempresa, un correo con enlaces a Náyade o a la URL global no se envía.
- **Correos conectados:**
  - verificación, bienvenida (alta asistida), invitación y recuperación de contraseña;
  - activación y vencimiento de la prueba;
  - contratación, pago de prueba, impago y cancelación;
  - presupuesto enviado y avisos operativos.
  - La «confirmación de alta» tiene plantilla, pero aún no tiene evento propio.
- **Webhook:** `POST /cp/v1/mail/brevo/webhook`.
  - Autenticado con el token que se configura al crear el webhook en Brevo (mecanismo documentado en developers.brevo.com, citado en el código).
  - El token está generado y configurado en `controlplane` (`BREVO_WEBHOOK_TOKEN`; el valor está en la carpeta privada).
  - Sin token válido no cambia nada.
- **Diagnóstico sin enviar:** `GET /cp/v1/mail/diagnostics` (operador). Usa solo lecturas oficiales: cuenta, remitentes y dominios.
- **Railway:** `MAIL_SENDING_DOMAIN=bigelephant.es` y `MAIL_MODE=off` en `core` y `controlplane`. **No hay `BREVO_API_KEY`.**
- **Dominio `bigelephant.es`** (consulta del 17/10/2026):

  | Registro | Estado |
  |---|---|
  | SPF | `v=spf1 a mx ~all` |
  | DKIM | Solo existe el del servidor actual, `default._domainkey` |
  | DMARC | No hay |
  | Brevo | No hay registros |

  **Plan** (`CORREO_BREVO.md` §7; lo aplica el propietario):
  - añadir el TXT `brevo-code`, el DKIM de Brevo (otro selector) y un `_dmarc` inicial `p=none`;
  - **no tocar** MX, `default._domainkey` ni el SPF salvo que el panel lo pida (y entonces, un único SPF combinado).
- **Pruebas:** 44 unitarias y 9 MySQL; sandbox, idempotencia, webhook, aislamiento y Brevo caído probados con un proveedor falso.
  - **No se ha enviado ningún correo real:** no hay clave y no está autorizado.
  - **No hay entregabilidad verificada.**

## B. Almacenamiento persistente de documentos e imágenes

- **Servicio central:** `server/_core/files/` (detalle en `docs/runbooks/ALMACENAMIENTO.md`).
  - El bucket es siempre privado.
  - Metadatos en `stored_objects` (`db/migrations/0009`) por empresa.
  - Validación del tipo por el contenido, tamaño máximo, claves generadas por el servidor (`t/<empresa>/o/...`), SHA-256 y sustitución segura.
- **Entrega:**
  - **Públicos** (catálogo, logotipos, web, blog): `/files/<id>/<nombre>`, solo en el host de su empresa.
  - **Privados:** `/api/files/<id>`, con sesión, permiso de la categoría y pertenencia a la empresa. Con `STORAGE_PRIVATE_DELIVERY=redirect` el Core redirige a un enlace firmado de 60 s.
- **Railway:**
  - bucket privado `elephant-source-media` (Railway Buckets, `ams`);
  - `S3_*`, `STORAGE_OBJECTS=on` y `STORAGE_PRIVATE_DELIVERY=redirect` en `core`;
  - migración 0009 aplicada a las 4 empresas desde la red privada (`backup-job.js migrate-tenants --apply`).
- **Prueba real en Railway:** `almacen-railway.cjs`. **16/16**: 14 en la subida y 2 tras el redespliegue.
  - imagen pública: nombre peligroso saneado, solo en su host, contenido falso rechazado;
  - PDF privado: 401 sin sesión, descarga íntegra con permiso, no accesible por la ruta pública;
  - aislamiento: la 02 no lo ve (404), no lo borra, y la sesión de la 01 no vale en la 02;
  - bucket no legible de forma anónima (403 por ruta y por host virtual);
  - enlace firmado caducado (403);
  - **persistencia tras redesplegar el Core:** imagen y PDF íntegros.
- **Copias de ficheros:** `BACKUP_MEDIA=1` en `backup-job`. La copia de la empresa 01 incluye 4 objetos, cifrados con la clave `bk1`. La **restauración de ficheros** desde la copia (`restore-files`) recupera los 4.

## C. Copias externas a Railway

- **Implementado** (`docs/runbooks/BACKUPS_Y_RECUPERACION.md` §16–20 y `docs/runbooks/RECUPERACION_TOTAL.md`):
  - segundo destino independiente (`BACKUP_SECONDARY_*`), con verificación por SHA-256, estado por destino (`backup_copies`, registro 0011, **aplicada**), alertas, retención independiente y restauración `--source secondary`;
  - reconstrucción total (`rebuild`);
  - paquete de configuración cifrado y sin secretos;
  - estimación de coste (`estimate`).
- **Probado en contenedores:** pérdida del primario y empresa A restaurada desde el secundario (datos y ficheros) con B intacta; reconstrucción total de la plataforma en 8,8–10,6 s. **No probado en Railway**, porque no hay destino externo.
- **Pendiente:** elegir y contratar el proveedor (requiere autorización). Comparativa de precios oficiales consultados el 17/10/2026 en `BACKUPS_Y_RECUPERACION.md` y `ALMACENAMIENTO.md`; con el volumen actual el coste es prácticamente nulo con cualquiera.
- **La clave de copias (`BACKUP_KEYS`)** está en Railway y en la carpeta privada del propietario. **Debe custodiarse además fuera del ordenador y de Railway**, por ejemplo en un gestor de secretos o en una copia física: sin ella no se descifra nada.
- **RPO y RTO:**

  | Objetivo | Previsto | Demostrado |
  |---|---|---|
  | RPO | 15 min | La copia se ejecuta cada 15 min y dura unos 3 s. Sin destino externo, ante la pérdida del proyecto el RPO real es **ilimitado**. |
  | RTO | 4 h | Solo en contenedores, con 2 empresas. No hay ensayo en Railway ni con volumen real. |

- **PITR:** propuesta escrita (`BACKUPS_Y_RECUPERACION.md`). La imagen de MySQL **no se ha cambiado**.

## Despliegue de esta operación

1. Migraciones de plataforma por proxy temporal (borrado después): registro 0011 y CRM 0011.
2. Migraciones de las 4 empresas (0009 y 0010) desde la red privada con el servicio de un solo uso `restore-drill`, primero en simulación y después aplicadas.
3. `railway up` del commit `fbae9f7` a `controlplane`, `backup-job` y `core`. Después, un redespliegue adicional del Core para probar la persistencia.
4. **Incidencia:** `railway deployment redeploy` volvió a construir una imagen sin `dist-cp/backup-job.js`. Hay que desplegar siempre con `railway up` desde el export verificado.

## Costes verificables

- Uso del proyecto: céntimos en lo que va de periodo.
- **Previsión de Railway Buckets:** 0,015 $/GB-mes, sin coste de operaciones ni de salida. El volumen actual es de kilobytes.
- **Salida de ficheros servidos por el Core:** 0,05 $/GB; con `redirect`, los privados se descargan del bucket directamente.

## Autorizaciones e intervención pendientes

1. **Brevo:**
   - poner `BREVO_API_KEY` (cuenta propia de Elephant Source) en `core` y `controlplane`;
   - autenticar `bigelephant.es` con los registros del panel de Brevo;
   - decidir la dirección de informes DMARC;
   - crear el webhook con el token de la carpeta privada;
   - indicar los **destinatarios autorizados** para la prueba real (`MAIL_SANDBOX_ALLOWLIST`);
   - pasar a `MAIL_MODE=sandbox`.
   - `live` solo con autorización (`MAIL_LIVE_AUTHORIZED=1`).
2. **Copias externas:** elegir y contratar el proveedor y crear un bucket privado con credenciales propias. Después: variables `BACKUP_SECONDARY_*`, primera copia y simulacro de restauración desde el externo.
3. **Dirección de soporte** (`ELEPHANT_SUPPORT_EMAIL`).
4. **PITR:** decidir si se ensaya la imagen `mysql-ha` en una instancia temporal.
